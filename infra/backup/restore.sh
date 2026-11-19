#!/usr/bin/env bash
# ===================================================================================================================
# Restauración de un respaldo de staging (ADR-066, change `staging-backups`, design D11, D12, D13).
# ===================================================================================================================
#   bash infra/backup/restore.sh --project <nombre> --from oci|offsite [--run <id>] [--count-only] [--confirm-host]
#
# Proyectos:
#   linkvault-prod     staging de verdad (vuelta atrás de datos). Exige escribir «CD DESACTIVADO» antes de tocar nada.
#   linkvault-restore  el ensayo (`restore-drill.sh`, `docker-compose.restore.yml`): solo CUENTA lo que se reencolaría.
#   otro nombre        una pila de prueba (las pruebas de desarrollo usan `linkvault-bktest`): como staging, sin la
#                      confirmación del CD.
#
# Orden (design D11): candado y copia de los scripts → confirmación del CD → etiqueta `sha-<12>` de la `api` de staging → elegir la
# corrida con manifiesto y VERIFICAR LAS SUMAS bajando los flujos una vez (todo esto antes de tocar nada) → parar `api` y `worker`,
# dejar `mongo` solo → `mongorestore` DENTRO de `mongo` (sin `admin.*` y sin `--oplogReplay`, que `mongorestore` no admite junto a `--nsExclude`: ver la nota en el código;
# credenciales raíz leídas de su entorno, nada en los argumentos) → asegurar el usuario de respaldo → aprovisionar los buckets y recargar los objetos por la API S3 con un proceso sin
# salida → recrear Redis y reencolar el outbox (con recuento por tipo y confirmación) → informe de conciliación → recordatorio.
#
# Guardia «nunca en la PC del owner» (B1, design D11): el script se niega a usar un repositorio remoto si NO existe
# `<BACKUP_ROOT>/.env.staging` y no se pasó `--confirm-host`; no mira la arquitectura (un plan B `amd64` también es un host).
# Una restauración lleva datos en claro por una tubería: en una PC, un repositorio local con datos sintéticos.
#
# Ningún flujo se reproduce en la salida de este script; ninguna credencial va en los argumentos.
#
# Variables: BACKUP_ROOT (por defecto /srv/linkvault-staging), BACKUP_ENV_FILE, BACKUP_STAGING_PROJECT (proyecto cuya `api` da la
# etiqueta; por defecto linkvault-prod), BACKUP_REQUEUE_WINDOW_HOURS (ventana W; por defecto 1), BACKUP_EXTRA_COMPOSE (solo
# pruebas).
# ===================================================================================================================

main() {
  set -euo pipefail
  umask 077

  local ROOT="${BACKUP_ROOT:-/srv/linkvault-staging}"
  local ENV_FILE="${BACKUP_ENV_FILE:-$ROOT/.env.staging}"
  local STAGING_PROJECT="${BACKUP_STAGING_PROJECT:-linkvault-prod}"
  local PROJECT='' FROM='' RUN_WANTED='' CONFIRM_HOST=0 COUNT_ONLY=0
  RUN_DIR='' WORK='' STAGED=0

  say() { printf 'restore: %s\n' "$*"; }
  die() { printf 'restore: %s\n' "$*" >&2; exit 1; }

  while [ $# -gt 0 ]; do
    case "$1" in
      --project) PROJECT="${2:-}"; shift 2 ;;
      --from) FROM="${2:-}"; shift 2 ;;
      --run) RUN_WANTED="${2:-}"; shift 2 ;;
      --confirm-host) CONFIRM_HOST=1; shift ;;
      --count-only) COUNT_ONLY=1; shift ;;
      *) printf 'restore: argumento desconocido: %s\n' "$1" >&2; return 2 ;;
    esac
  done
  [[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { printf 'restore: falta --project <nombre> válido\n' >&2; return 2; }
  case "$FROM" in oci | offsite) ;; *) printf 'restore: --from debe ser oci u offsite\n' >&2; return 2 ;; esac
  if [ -n "$RUN_WANTED" ]; then
    [[ "$RUN_WANTED" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { printf 'restore: --run no es un identificador de corrida\n' >&2; return 2; }
  fi

  local MODE=sandbox
  case "$PROJECT" in
    linkvault-prod) MODE=prod ;;
  esac
  if [ "$PROJECT" = "${BACKUP_DRILL_PROJECT:-linkvault-restore}" ]; then MODE=drill; COUNT_ONLY=1; fi

  # --- Guardia B1: antes de leer nada ---
  envval() {
    local line=''
    if [ -f "$ENV_FILE" ]; then line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1)" || true; fi
    line="${line#*=}"
    line="${line%$'\r'}"
    case "$line" in
      \"*\") line="${line#\"}"; line="${line%\"}" ;;
      \'*\') line="${line#\'}"; line="${line%\'}" ;;
    esac
    printf '%s' "$line"
  }
  local up repo
  up="$(printf '%s' "$FROM" | tr '[:lower:]' '[:upper:]')"
  # El entorno del proceso gana al fichero (así una prueba o una PC pasan el repositorio sin fichero).
  eval "repo=\"\${BACKUP_${up}_REPOSITORY:-}\""
  [ -n "$repo" ] || repo="$(envval "BACKUP_${up}_REPOSITORY")"
  [ -n "$repo" ] || { printf 'restore: el destino %s no tiene repositorio configurado\n' "$FROM" >&2; return 2; }
  case "$repo" in
    /*) ;; # directorio local
    *)
      if [ ! -f "$ROOT/.env.staging" ] && [ "$CONFIRM_HOST" -ne 1 ]; then
        printf 'restore: me niego a usar un repositorio remoto fuera del host de staging (no existe %s y no pasaste --confirm-host).\n' "$ROOT/.env.staging" >&2
        printf 'restore: una restauración baja datos en claro; en una PC solo se prueba con un repositorio local de datos sintéticos.\n' >&2
        return 4
      fi
      ;;
  esac

  # Los avisos y las confirmaciones usan el fd 3; ningún `docker` hereda la entrada estándar (se la comería).
  exec 3<&0 0</dev/null

  # --- Candado común ---
  local ID
  ID="$(date -u +%Y%m%dT%H%M%SZ)"
  # `restore-drill.sh` ya tiene el candado (es el mismo fichero) y lo declara con BACKUP_LOCK_HELD=1; nadie más debería hacerlo.
  if [ "${BACKUP_LOCK_HELD:-0}" != 1 ]; then
    exec 9>"$ROOT/.backup.lock"
    if ! flock -n 9; then
      printf 'restore: ya hay un respaldo, una restauración o un ensayo en curso; no se toca nada\n' >&2
      return 75
    fi
  fi
  cleanup() {
    if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
    if [ -n "$RUN_DIR" ] && [ -d "$RUN_DIR" ]; then rm -rf "$RUN_DIR"; fi
  }
  trap cleanup EXIT

  # --- Confirmación del CD (staging de verdad): antes de cualquier llamada a docker ---
  if [ "$MODE" = prod ]; then
    local answer=''
    printf 'restore: restaurar en %s pisa los datos de staging. ¿Está desactivado el despliegue continuo (gh workflow disable cd-staging)?\n' "$PROJECT" >&2
    printf 'restore: escribí CD DESACTIVADO para continuar: ' >&2
    IFS= read -r -u 3 answer || true
    [ "$answer" = 'CD DESACTIVADO' ] || { printf '\nrestore: sin la confirmación no se toca nada.\n' >&2; return 3; }
  fi

  # --- Copia de lo que se va a ejecutar ---
  RUN_DIR="$ROOT/.backup-run-$ID"
  mkdir -p "$RUN_DIR/infra/backup"
  cp -- "$ROOT/docker-compose.prod.yml" "$RUN_DIR/docker-compose.prod.yml"
  cp -R -- "$ROOT/infra/backup/." "$RUN_DIR/infra/backup/"
  cd "$RUN_DIR"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/lv-restore-work.XXXXXX")"
  local -a FILES=(-f "$RUN_DIR/docker-compose.prod.yml" -f "$RUN_DIR/infra/backup/docker-compose.backup.yml")
  if [ "$MODE" = drill ]; then FILES+=(-f "$RUN_DIR/infra/backup/docker-compose.restore.yml"); fi
  local extra
  for extra in ${BACKUP_EXTRA_COMPOSE:-}; do FILES+=(-f "$extra"); done

  dc() { docker compose --project-directory "$RUN_DIR" -p "$PROJECT" "${FILES[@]}" --env-file "$ENV_FILE" "$@"; }
  run_svc() { dc run --rm --no-deps -T "$@"; }

  # --- Etiqueta de la imagen: la misma `sha-<12>` que corre en staging, o error (design D11, C12) ---
  local cid image tag
  cid="$(docker compose --project-directory "$RUN_DIR" -p "$STAGING_PROJECT" "${FILES[@]}" --env-file "$ENV_FILE" ps -q api 2>/dev/null | head -n 1)" || true
  [ -n "$cid" ] || die "no encuentro la api de $STAGING_PROJECT: sin ella no sé qué imagen usar (nunca :latest)"
  image="$(docker inspect --format '{{.Config.Image}}' "$cid")"
  tag="${image##*:}"
  [[ "$tag" =~ ^sha-[0-9a-f]{12}$ ]] || die "la api de $STAGING_PROJECT corre con la etiqueta '$tag', que no es sha-<12 hexadecimales>: no restauro con una imagen que no es de commit"
  export IMAGE_TAG="$tag"
  export API_IMAGE="${image%:*}"

  # --- Destino: el repositorio y sus credenciales, por el entorno de Compose ---
  export BACKUP_DEST_REPOSITORY="$repo"
  eval "BACKUP_DEST_ACCESS_KEY_ID=\"\${BACKUP_${up}_ACCESS_KEY_ID:-}\""
  [ -n "$BACKUP_DEST_ACCESS_KEY_ID" ] || BACKUP_DEST_ACCESS_KEY_ID="$(envval "BACKUP_${up}_ACCESS_KEY_ID")"
  eval "BACKUP_DEST_SECRET_ACCESS_KEY=\"\${BACKUP_${up}_SECRET_ACCESS_KEY:-}\""
  [ -n "$BACKUP_DEST_SECRET_ACCESS_KEY" ] || BACKUP_DEST_SECRET_ACCESS_KEY="$(envval "BACKUP_${up}_SECRET_ACCESS_KEY")"
  export BACKUP_DEST_ACCESS_KEY_ID BACKUP_DEST_SECRET_ACCESS_KEY

  # --- Elegir la corrida y verificar las sumas, antes de tocar nada ---
  # `snap_lines <filtros de restic…>` → «id|hora|etiquetas» por instantánea.
  snap_lines() {
    local l id t tags
    run_svc backup-push snapshots --json "$@" | sed 's/{"time"/\n{"time"/g' |
      while IFS= read -r l; do
        case "$l" in '{"time"'*) ;; *) continue ;; esac
        id="$(printf '%s' "$l" | sed -n 's/.*"id":"\([0-9a-f]\{64\}\)".*/\1/p')"
        t="$(printf '%s' "$l" | sed -n 's/^{"time":"\([^"]*\)".*/\1/p')"
        tags="$(printf '%s' "$l" | sed -n 's/.*"tags":\[\([^]]*\)\].*/\1/p' | tr -d '"')"
        printf '%s|%s|%s\n' "$id" "$t" "$tags"
      done
  }

  local runs run
  runs="$(snap_lines --tag kind:manifest | sed -n 's/.*|.*run:\([0-9]\{8\}T[0-9]\{6\}Z\).*/\1/p' | LC_ALL=C sort -u)" || true
  [ -n "$runs" ] || die "el destino $FROM no tiene ninguna corrida con manifiesto"
  if [ -n "$RUN_WANTED" ]; then
    printf '%s\n' "$runs" | grep -qx "$RUN_WANTED" || die "la corrida $RUN_WANTED no tiene manifiesto en $FROM"
    run="$RUN_WANTED"
  else
    run="$(printf '%s\n' "$runs" | tail -n 1)"
  fi
  say "corrida elegida: $run (destino $FROM)"

  local kind lines n
  local man_snap='' mongo_snap='' objects_snap=''
  for kind in manifest mongo objects; do
    lines="$(snap_lines --tag "kind:$kind,run:$run")"
    n="$(printf '%s' "$lines" | grep -c . || true)"
    [ "$n" -eq 1 ] || die "la corrida $run tiene $n instantáneas de tipo $kind (se espera exactamente una): duplicados o faltantes son un error, no elijo una"
    case "$kind" in
      manifest) man_snap="${lines%%|*}" ;;
      mongo) mongo_snap="${lines%%|*}" ;;
      objects) objects_snap="${lines%%|*}" ;;
    esac
  done

  local manifest
  manifest="$(run_svc backup-push dump "$man_snap" /manifest.json)" || die 'no pude leer el manifiesto'
  mfield() { printf '%s' "$manifest" | sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p"; }
  mstream() { printf '%s' "$manifest" | sed -n "s/.*\"$1\":{\"filename\":\"[^\"]*\",\"bytes\":\\([0-9]*\\),\"sha256\":\"\\([0-9a-f]*\\)\"}.*/\\$2/p"; }
  local dump_started want_sha want_bytes got_sha got_bytes
  dump_started="$(mfield mongoDumpStartedAt)"
  [ -n "$dump_started" ] || die 'el manifiesto no trae mongoDumpStartedAt'

  verify_stream() {
    local name="$1" snap="$2" file="$3"
    want_bytes="$(mstream "$name" 1)"; want_sha="$(mstream "$name" 2)"
    [ -n "$want_sha" ] && [ -n "$want_bytes" ] || die "el manifiesto no trae las sumas de $name"
    rm -f "$WORK/v.sha" "$WORK/v.bytes"
    set +e
    run_svc backup-push dump "$snap" "$file" | tee >(wc -c | tr -d ' ' >"$WORK/v.bytes") | sha256sum | cut -d' ' -f1 >"$WORK/v.sha"
    local ps=("${PIPESTATUS[@]}")
    set -e
    [ "${ps[0]}" -eq 0 ] || die "no pude bajar el flujo $name para verificarlo"
    local n=0
    while [ ! -s "$WORK/v.bytes" ] && [ "$n" -lt 150 ]; do sleep 0.2; n=$((n + 1)); done
    got_sha="$(cat "$WORK/v.sha")"; got_bytes="$(cat "$WORK/v.bytes")"
    [ "$got_sha" = "$want_sha" ] && [ "$got_bytes" = "$want_bytes" ] ||
      die "las sumas del flujo $name NO coinciden con el manifiesto de la corrida $run: no se restaura (nada se tocó)"
    say "flujo $name verificado ($got_bytes bytes, SHA-256 coincide)"
  }
  verify_stream mongo "$mongo_snap" /mongo.archive.gz
  verify_stream objects "$objects_snap" /objects.tar

  # --- A partir de aquí se toca la pila ---
  say "parando api y worker en $PROJECT; mongo y el almacén quedan solos"
  dc stop api worker >/dev/null 2>&1 || true
  dc up -d --no-deps --wait mongo object-store >/dev/null || die 'mongo u object-store no llegaron a sanos'

  # Base: `mongorestore` dentro de `mongo`, con un `--config` escrito en su /tmp desde su propio entorno (raíz del fichero de
  # entorno). Sin `admin.*`: no se pisa `admin.system.users` (design D11, H7).
  # PENDIENTE (design D11 dice `--oplogReplay`): medido en la tarea 6.1b, `mongorestore` 100.x rechaza `--oplogReplay` junto a
  # `--nsExclude` y a `--nsInclude` («cannot use --oplogReplay with excludes specified»). Se restaura sin reproducir el oplog
  # (los datos quedan como al empezar el volcado, no en un instante único); ver el informe de la tarea 6.1b.
  say 'restaurando la base dentro de mongo (sin admin.*)'
  # shellcheck disable=SC2016
  local restore_script='umask 077
printf "uri: mongodb://%s:%s@localhost:27017/?authSource=admin\n" "$MONGO_INITDB_ROOT_USERNAME" "$MONGO_INITDB_ROOT_PASSWORD" >/tmp/mongorestore.yml
mongorestore --quiet --config /tmp/mongorestore.yml --archive --gzip --drop --nsExclude "admin.*"
rc=$?
rm -f /tmp/mongorestore.yml
exit $rc'
  set +e
  run_svc backup-push dump "$mongo_snap" /mongo.archive.gz | dc exec -T mongo sh -c "$restore_script"
  local ps=("${PIPESTATUS[@]}")
  set -e
  [ "${ps[0]}" -eq 0 ] && [ "${ps[1]}" -eq 0 ] || die "mongorestore falló (restic: ${ps[0]}, mongorestore: ${ps[1]})"
  dc exec -T mongo mongosh --quiet --file /dev/stdin <"$RUN_DIR/infra/backup/ensure-backup-user.js" >/dev/null || die 'no pude asegurar el usuario de respaldo'

  # Objetos: primero `provision` (sobre un almacén nuevo los buckets no existen), después la recarga por la API S3 (design D11-a).
  say 'aprovisionando los buckets y recargando los objetos por la API S3'
  run_svc api node object-store.js provision >/dev/null || die 'object-store.js provision falló'
  # La identidad S3 de respaldo (y su comprobación de que lista los dos buckets) espera a la Q3 del change (design D3).
  set +e
  run_svc backup-push dump "$objects_snap" /objects.tar | run_svc restore-objects
  ps=("${PIPESTATUS[@]}")
  set -e
  [ "${ps[0]}" -eq 0 ] && [ "${ps[1]}" -eq 0 ] || die "la recarga de objetos falló (restic: ${ps[0]}, restore-objects: ${ps[1]})"

  # --- Outbox (design D12) ---
  local window="${BACKUP_REQUEUE_WINDOW_HOURS:-1}" since
  [[ "$window" =~ ^[0-9]+$ ]] || die 'BACKUP_REQUEUE_WINDOW_HOURS no es un entero'
  since="$(date -u -d "$dump_started - $window hours" +%Y-%m-%dT%H:%M:%S.000Z)" || die 'no pude calcular el inicio de la ventana de reencolado'
  requeue() { # $1 = 1 (solo contar) | 0 (reencolar)
    dc exec -T -e "REQUEUE_SINCE=$since" -e "REQUEUE_COUNT_ONLY=$1" mongo mongosh --quiet --file /dev/stdin <"$RUN_DIR/infra/backup/requeue-outbox.js"
  }
  local requeued='ninguno (ensayo: solo se cuenta)'
  if [ "$MODE" != drill ]; then
    say "recreando el volumen de Redis de $PROJECT (sus jobs son de un estado posterior al volcado)"
    dc stop redis >/dev/null 2>&1 || true
    dc rm -f redis >/dev/null 2>&1 || true
    docker volume rm "${PROJECT}_redis-data" >/dev/null 2>&1 || true
    dc up -d --no-deps --wait redis >/dev/null || die 'redis no llegó a sano'
  fi
  say "eventos publicados desde $since (inicio del volcado de $FROM menos $window h), por tipo:"
  requeue 1
  if [ "$MODE" != drill ] && [ "$COUNT_ONLY" -ne 1 ]; then
    local reply=''
    printf 'restore: escribí REENCOLAR para volver a poner esos eventos como pendientes: ' >&2
    IFS= read -r -u 3 reply || true
    if [ "$reply" = REENCOLAR ]; then
      requeue 0
      requeued='sí (ver el recuento de arriba)'
    else
      printf '\nrestore: no se reencoló nada; para hacerlo después: bash infra/backup/requeue-outbox.sh --since %s\n' "$since" >&2
      requeued='no (sin confirmación)'
    fi
  fi

  # En el ensayo la API del proyecto aparte queda arriba para que `restore-drill.sh` compruebe la cuenta de ensayo.
  if [ "$MODE" = drill ]; then dc up -d --no-deps --wait api >/dev/null || die 'la api del ensayo no llegó a sana'; fi

  # --- Conciliación (design D11, paso 7) ---
  say '--- informe de conciliación ---'
  local keys_db keys_obj
  keys_db="$(dc exec -T mongo mongosh --quiet --eval '
    db.getSiblingDB("admin").auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
    db.getSiblingDB("linkvault").cv_documents.find({}, { fileKey: 1 }).forEach((d) => print(d.fileKey));' </dev/null | LC_ALL=C sort -u)" || die 'no pude leer los CV de la base'
  keys_obj="$(run_svc --entrypoint rclone restore-objects lsf -R --files-only store:"${S3_BUCKET:-cvs}" </dev/null | tr -d '\r' | LC_ALL=C sort -u)" || die 'no pude listar los objetos del bucket de CV'
  local missing orphan
  missing="$(comm -23 <(printf '%s\n' "$keys_db" | sed '/^$/d') <(printf '%s\n' "$keys_obj" | sed '/^$/d'))"
  orphan="$(comm -13 <(printf '%s\n' "$keys_db" | sed '/^$/d') <(printf '%s\n' "$keys_obj" | sed '/^$/d'))"
  say "CV de la base sin objeto: $(printf '%s' "$missing" | grep -c . || true)"
  if [ -n "$missing" ]; then printf '%s\n' "$missing" | sed 's/^/restore:   falta el objeto de /'; fi
  say "objetos sin documento: $(printf '%s' "$orphan" | grep -c . || true) (borrarlos es el procedimiento de dos pasos del RUNBOOK, «Paso 6 octies»)"
  if [ -n "$orphan" ]; then printf '%s\n' "$orphan" | sed 's/^/restore:   objeto sin documento: /'; fi

  # Cabeceras (design C28): ruta, tamaño y tipo de contenido de cada objeto del bucket de CV contra los del manifiesto.
  heads() { sed 's/},{"Path"/}\n{"Path"/g' | sed -n 's/.*"Path":"\([^"]*\)".*"Size":\([0-9]*\).*"MimeType":"\([^"]*\)".*/\1|\2|\3/p' | LC_ALL=C sort; }
  local want_heads got_heads diff_heads
  want_heads="$(printf '%s' "$manifest" | sed -n "s/.*\"buckets\":{\"${S3_BUCKET:-cvs}\":{\"count\":[0-9]*,\"objects\":\\(\\[.*\\]\\)},\"[a-z]*\":{.*/\\1/p" | heads)" || true
  got_heads="$(run_svc --entrypoint rclone restore-objects lsjson -R --files-only store:"${S3_BUCKET:-cvs}" </dev/null | tr -d '\n' | heads)" || true
  # Solo los objetos del manifiesto cuya cabecera restaurada difiere o falta (un objeto que sobra ya se informó arriba).
  diff_heads="$(comm -23 <(printf '%s\n' "$want_heads" | sed '/^$/d') <(printf '%s\n' "$got_heads" | sed '/^$/d'))"
  say "cabeceras distintas (Content-Length o Content-Type) frente al manifiesto: $(printf '%s' "$diff_heads" | grep -c . || true)"
  if [ -n "$diff_heads" ]; then printf '%s\n' "$diff_heads" | sed 's/^/restore:   /'; fi
  say "eventos reencolados: $requeued"

  if [ "$MODE" != drill ]; then say "api y worker de $PROJECT siguen PARADOS: levantalos con 'docker compose up -d' cuando hayas revisado el informe."; fi
  say '--- paso posterior (a mano) ---'
  say "Esta restauración devuelve el estado del volcado ($dump_started): lo borrado después (cuentas, CV) volvió. Volvé a aplicar los borrados de cuenta o de CV que te consten, por correo o por tu registro, posteriores a esa hora."
  return 0
}

main "$@"; exit $?
