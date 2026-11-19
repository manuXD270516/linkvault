#!/usr/bin/env bash
# ===================================================================================================================
# Respaldo nocturno de staging (ADR-066, change `staging-backups`, design D2, D4, D5, D8, D9, D10).
# ===================================================================================================================
# Corre EN EL HOST como el usuario de despliegue (lo lanza `linkvault-backup@<usuario>.service`; ver `infra/README.md`,
# «Respaldo programado»), o a mano: `bash /srv/linkvault-staging/infra/backup/run-backup.sh`.
#
# Una corrida tiene un identificador (`AAAAMMDDTHHMMSSZ`) y, POR DESTINO (primero `oci`, después `offsite`), una pasada completa
# con este orden fijo:
#   1. base:      `backup-mongo` (mongodump --archive --gzip --oplog) → tubería del host → `backup-push` (restic --stdin)
#   2. objetos:   `backup-objects` (rclone copy a su tmpfs y `tar`) → tubería del host → `backup-push`
#   3. manifiesto: JSON con el identificador, las horas del volcado, bytes y SHA-256 de cada flujo medidos EN EL HOST, objetos por
#      bucket con sus cabeceras, digests de las imágenes y `formatVersion`. Una corrida sin manifiesto NO es un respaldo.
# Las dos pasadas son independientes: si una falla, la otra sigue y la corrida termina en falla nombrando el destino.
#
# Ningún dato en claro toca un disco: los flujos viajan por tuberías, los servicios no guardan registros de Docker
# (`logging: none`) y este script NUNCA reproduce un flujo en su propia salida (ni `set -x` ni `tee` a la salida estándar:
# la prueba `test-run-backup.sh` lo vigila con un marcador binario). Ninguna credencial va en los argumentos de un proceso:
# `curl` recibe la dirección del monitor por `--config -`, y las claves de los destinos llegan a `backup-push` por el
# entorno de Compose (`BACKUP_DEST_*`), no por `-e VALOR`.
#
# Avisos (design D9): `start`, éxito o `fail` con un cuerpo de una línea (identificador y clase) a `BACKUP_PING_URL`.
# Clases: lock_busy, stack_unhealthy, images, ensure_user, mongo_dump, objects_read, objects_too_large, size_cap, push_oci,
# push_offsite, manifest, prune_overdue. (`ensure_identity` espera a la Q3 del change: ver design D3.)
#
# Estructura (design D4, C13): TODO el cuerpo va dentro de `main() { … }` y la última línea es `main "$@"; exit $?`: bash lee un
# script mientras lo ejecuta, y un despliegue que lo reemplace a mitad de corrida no puede mezclar dos versiones. Además, al
# tomar el candado se copian `infra/backup/` y el compose a `.backup-run-<id>/` y todo se ejecuta desde esa copia.
#
# Variables (todas opcionales; las de prueba están marcadas):
#   BACKUP_ROOT             directorio fijo del host (por defecto /srv/linkvault-staging)
#   BACKUP_ENV_FILE         fichero de entorno (por defecto $BACKUP_ROOT/.env.staging); se lee SIN `source`, solo las claves que usa
#   BACKUP_PROJECT          proyecto de Compose (por defecto linkvault-prod)
#   BACKUP_DESTINATIONS     destinos en orden (por defecto «oci offsite»)
#   BACKUP_EXTRA_COMPOSE    ficheros `-f` extra, separados por espacio (SOLO PRUEBAS: p. ej. un repositorio local)
#   BACKUP_HEALTH_TIMEOUT_SECONDS / BACKUP_HEALTH_POLL_SECONDS   espera de salud (600 / 5)
#   BACKUP_SKIP_REGISTRY    =1 omite el `pull` y la comprobación de plataformas (SOLO PRUEBAS locales: el registro limita las descargas anónimas)
# ===================================================================================================================

main() {
  set -euo pipefail
  umask 077

  local ROOT="${BACKUP_ROOT:-/srv/linkvault-staging}"
  local ENV_FILE="${BACKUP_ENV_FILE:-$ROOT/.env.staging}"
  local PROJECT="${BACKUP_PROJECT:-linkvault-prod}"
  local DESTINATIONS="${BACKUP_DESTINATIONS:-oci offsite}"
  local HEALTH_TIMEOUT="${BACKUP_HEALTH_TIMEOUT_SECONDS:-600}"
  local HEALTH_POLL="${BACKUP_HEALTH_POLL_SECONDS:-5}"
  # Globales a propósito: el `trap` de salida corre cuando `main` ya devolvió.
  ID="" RUN_DIR="" WORK="" PING_URL="" FINISHED=0
  ID="$(date -u +%Y%m%dT%H%M%SZ)"
  local -a COMPOSE_FILES=()
  local DEST_CLASS='' OVERDUE=''

  # Valor de una clave del fichero de entorno, sin `source` (el fichero guarda secretos y no se ejecuta).
  envval() {
    local line
    line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1)" || true
    line="${line#*=}"
    line="${line%$'\r'}"
    case "$line" in
      \"*\") line="${line#\"}"; line="${line%\"}" ;;
      \'*\') line="${line#\'}"; line="${line%\'}" ;;
    esac
    printf '%s' "$line"
  }

  now_ms() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }

  # Aviso al monitor. La dirección va por `--config -` (la entrada estándar): un `printf` es un builtin y no deja nada en
  # los argumentos de ningún proceso. Un monitor caído nunca rompe el respaldo.
  ping() {
    [ -n "$PING_URL" ] || return 0
    local suffix="${1:-}" body="${2:-}"
    {
      printf 'url = "%s%s"\n' "$PING_URL" "${suffix:+/$suffix}"
      if [ -n "$body" ]; then printf 'data = "%s"\n' "$body"; fi
      printf 'max-time = 10\nsilent\nshow-error\nretry = 2\n'
    } | curl --config - >/dev/null 2>&1 || true
  }

  cleanup() {
    local code=$?
    if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
    if [ -n "$RUN_DIR" ] && [ -d "$RUN_DIR" ]; then rm -rf "$RUN_DIR"; fi
    if [ "$FINISHED" -eq 0 ] && [ "$code" -ne 0 ]; then
      ping fail "$ID unexpected"
    fi
  }

  # Termina la corrida con una falla: un solo aviso, con el identificador y la clase, y nada más.
  abort() {
    FINISHED=1
    printf 'run-backup: falla %s\n' "$1" >&2
    ping fail "$ID $1"
    exit "${2:-1}"
  }

  dc() {
    docker compose --project-directory "$RUN_DIR" -p "$PROJECT" "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" "$@"
  }
  # Todo `run` del respaldo: efímero (`--rm`), sin tocar la pila (`--no-deps`) y sin pseudo-terminal (`-T`): con una TTY la
  # tubería se corrompe (design D4, C21).
  run_svc() { dc run --rm --no-deps -T "$@"; }

  [ -f "$ENV_FILE" ] || { printf 'run-backup: falta el fichero de entorno %s\n' "$ENV_FILE" >&2; return 2; }
  PING_URL="$(envval BACKUP_PING_URL)"

  # --- Candado común (respaldo, restauración y ensayo) ---
  exec 9>"$ROOT/.backup.lock"
  if ! flock -n 9; then
    FINISHED=1
    printf 'run-backup: ya hay un respaldo, una restauración o un ensayo en curso; no se toca nada\n' >&2
    ping fail "$ID lock_busy"
    return 75
  fi

  trap cleanup EXIT

  # --- Copia de lo que la corrida va a ejecutar (design D4, C13-a) ---
  RUN_DIR="$ROOT/.backup-run-$ID"
  mkdir -p "$RUN_DIR/infra/backup" "$RUN_DIR/infra/deploy"
  cp -- "$ROOT/docker-compose.prod.yml" "$RUN_DIR/docker-compose.prod.yml"
  cp -R -- "$ROOT/infra/backup/." "$RUN_DIR/infra/backup/"
  cp -- "$ROOT/infra/deploy/check-image-platforms.sh" "$RUN_DIR/infra/deploy/check-image-platforms.sh"
  cd "$RUN_DIR"
  COMPOSE_FILES=(-f "$RUN_DIR/docker-compose.prod.yml" -f "$RUN_DIR/infra/backup/docker-compose.backup.yml")
  local extra
  for extra in ${BACKUP_EXTRA_COMPOSE:-}; do COMPOSE_FILES+=(-f "$extra"); done
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/lv-backup-work.XXXXXX")"

  ping start "$ID"

  # --- 0. Preparación: salud de la pila e imágenes del respaldo (design D4, C26, C27) ---
  wait_healthy() {
    local svc cid status waited=0
    for svc in mongo object-store; do
      while :; do
        cid="$(dc ps -q "$svc" 2>/dev/null || true)"
        status=''
        if [ -n "$cid" ]; then status="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"; fi
        [ "$status" = healthy ] && break
        if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then return 1; fi
        sleep "$HEALTH_POLL"
        waited=$((waited + HEALTH_POLL))
      done
    done
  }
  wait_healthy || abort stack_unhealthy

  local -a images=()
  local image
  while IFS= read -r image; do
    image="${image%$'\r'}"
    if [ -n "$image" ]; then images+=("$image"); fi
  done < <(dc config --images backup-mongo backup-objects backup-push restore-objects | LC_ALL=C sort -u)
  [ "${#images[@]}" -gt 0 ] || abort images
  # `BACKUP_SKIP_REGISTRY=1` es SOLO de pruebas locales (el registro limita las descargas anónimas); en el host se hace siempre.
  if [ "${BACKUP_SKIP_REGISTRY:-0}" != 1 ]; then dc pull backup-mongo backup-objects backup-push restore-objects >/dev/null 2>&1 || abort images; fi
  if [ "${BACKUP_SKIP_REGISTRY:-0}" != 1 ]; then bash "$RUN_DIR/infra/deploy/check-image-platforms.sh" "${images[@]}" >/dev/null || abort images; fi

  # --- Usuario de respaldo de Mongo: se asegura en cada corrida (design D3) ---
  dc exec -T mongo mongosh --quiet --file /dev/stdin <"$RUN_DIR/infra/backup/ensure-backup-user.js" >/dev/null || abort ensure_user

  # Q3 (b): `backup-objects` lee con la identidad de la aplicación; no hay identidad de respaldo que asegurar ni comprobar.

  # Espera a que un fichero lo escriba un consumidor de una sustitución de procesos (termina un instante después que la
  # tubería). Un consumidor que no escribe nunca es un error, no una espera infinita.
  await_file() {
    local n=0
    while [ ! -s "$1" ]; do
      n=$((n + 1))
      if [ "$n" -gt 150 ]; then return 1; fi
      sleep 0.2
    done
  }

  # stream_to_repo <nombre> <fichero en restic> <servicio y argumentos del productor…>
  # Productor → `tee` (SHA-256 y bytes MEDIDOS EN EL HOST) → `backup-push`. Deja el estado de cada extremo en PS_PRODUCER y
  # PS_PUSH. Nada del flujo va a la salida estándar de este script: la salida de `tee` es la tubería.
  local PS_PRODUCER=0 PS_PUSH=0
  stream_to_repo() {
    local name="$1" fname="$2"
    shift 2
    local -a ps=()
    rm -f "$WORK/$name.sha" "$WORK/$name.bytes"
    set +e
    run_svc "$@" |
      tee >(sha256sum | cut -d' ' -f1 >"$WORK/$name.sha") >(wc -c | tr -d ' ' >"$WORK/$name.bytes") |
      run_svc backup-push backup --stdin --stdin-filename "$fname" --tag "run:$ID" --tag "kind:$name" --host linkvault-staging >/dev/null
    ps=("${PIPESTATUS[@]}")
    set -e
    PS_PRODUCER="${ps[0]}"
    PS_PUSH=$(( ${ps[1]} + ${ps[2]} ))
    await_file "$WORK/$name.sha" && await_file "$WORK/$name.bytes" || true
    [ "$PS_PRODUCER" -eq 0 ] && [ "$PS_PUSH" -eq 0 ]
  }

  # Una pasada completa a un destino (design D4 y D5). Deja la clase de la falla en DEST_CLASS (vacía si fue bien).
  backup_destination() {
    local d="$1" up repo key secret cap total started finished manifest_at
    up="$(printf '%s' "$d" | tr '[:lower:]' '[:upper:]')"
    DEST_CLASS=''
    repo="$(envval "BACKUP_${up}_REPOSITORY")"
    key="$(envval "BACKUP_${up}_ACCESS_KEY_ID")"
    secret="$(envval "BACKUP_${up}_SECRET_ACCESS_KEY")"
    if [ -z "$repo" ]; then
      printf 'run-backup: %s no tiene repositorio configurado\n' "$d" >&2
      DEST_CLASS="push_$d"
      return 0
    fi
    export BACKUP_DEST_REPOSITORY="$repo" BACKUP_DEST_ACCESS_KEY_ID="$key" BACKUP_DEST_SECRET_ACCESS_KEY="$secret"

    # El repositorio se crea la primera vez.
    if ! run_svc backup-push cat config >/dev/null 2>&1; then
      run_svc backup-push init >/dev/null 2>&1 || { DEST_CLASS="push_$d"; return 0; }
    fi

    # Tope de tamaño (design D8): antes de enviar nada.
    cap="$(envval BACKUP_MAX_REPO_BYTES)"
    cap="${cap:-4294967296}"
    total="$(run_svc backup-push stats --mode raw-data --json 2>/dev/null | sed -n 's/.*"total_size":\([0-9]*\).*/\1/p' | head -n 1)" || true
    if [ -z "$total" ]; then DEST_CLASS="push_$d"; return 0; fi
    if [ "$total" -gt "$cap" ]; then DEST_CLASS=size_cap; return 0; fi

    # 1. Base
    local mongo_started mongo_finished
    mongo_started="$(now_ms)"
    if ! stream_to_repo mongo mongo.archive.gz backup-mongo; then
      if [ "$PS_PRODUCER" -ne 0 ]; then DEST_CLASS=mongo_dump; else DEST_CLASS="push_$d"; fi
      return 0
    fi
    mongo_finished="$(now_ms)"

    # 2. Objetos (después de la base: todo objeto que la base referencia está en la copia)
    local objects_started objects_finished listing
    listing="$(run_svc --entrypoint /bin/sh backup-objects /backup/list-objects.sh)" || { DEST_CLASS=objects_read; return 0; }
    objects_started="$(now_ms)"
    if ! stream_to_repo objects objects.tar backup-objects; then
      if [ "$PS_PRODUCER" -eq 42 ]; then DEST_CLASS=objects_too_large
      elif [ "$PS_PRODUCER" -ne 0 ]; then DEST_CLASS=objects_read
      else DEST_CLASS="push_$d"; fi
      return 0
    fi
    objects_finished="$(now_ms)"

    # 3. Manifiesto: solo si las dos pasadas anteriores terminaron en 0.
    local mongo_sha mongo_bytes objects_sha objects_bytes image_json='' sep=''
    mongo_sha="$(cat "$WORK/mongo.sha")"; mongo_bytes="$(cat "$WORK/mongo.bytes")"
    objects_sha="$(cat "$WORK/objects.sha")"; objects_bytes="$(cat "$WORK/objects.bytes")"
    for image in "${images[@]}"; do image_json="$image_json$sep\"$image\""; sep=','; done
    manifest_at="$(now_ms)"
    manifest="$(printf '{"formatVersion":1,"runId":"%s","destination":"%s","mongoDumpStartedAt":"%s","mongoDumpFinishedAt":"%s","objectsStartedAt":"%s","objectsFinishedAt":"%s","manifestAt":"%s","streams":{"mongo":{"filename":"mongo.archive.gz","bytes":%s,"sha256":"%s"},"objects":{"filename":"objects.tar","bytes":%s,"sha256":"%s"}},"buckets":%s,"images":[%s]}' \
      "$ID" "$d" "$mongo_started" "$mongo_finished" "$objects_started" "$objects_finished" "$manifest_at" \
      "$mongo_bytes" "$mongo_sha" "$objects_bytes" "$objects_sha" "$listing" "$image_json")"
    printf '%s\n' "$manifest" |
      run_svc backup-push backup --stdin --stdin-filename manifest.json --tag "run:$ID" --tag kind:manifest --host linkvault-staging >/dev/null ||
      { DEST_CLASS=manifest; return 0; }

    # Aviso de poda vencida (design D4, B3): la instantánea más vieja del destino, después de haber respaldado.
    local oldest oldest_epoch now_epoch
    oldest="$(run_svc backup-push snapshots --json 2>/dev/null | grep -o '"time":"[^"]*"' | cut -d'"' -f4 | LC_ALL=C sort | head -n 1)" || true
    if [ -n "$oldest" ]; then
      oldest_epoch="$(date -u -d "$oldest" +%s 2>/dev/null || true)"
      now_epoch="$(date -u +%s)"
      if [ -n "$oldest_epoch" ] && [ $(( (now_epoch - oldest_epoch) / 86400 )) -gt 65 ]; then
        OVERDUE="${OVERDUE:+$OVERDUE,}prune_overdue@$d"
      fi
    fi
    return 0
  }

  local -a failures=()
  local d
  for d in $DESTINATIONS; do
    backup_destination "$d"
    if [ -n "$DEST_CLASS" ]; then
      case "$DEST_CLASS" in
        *"_$d") failures+=("$DEST_CLASS") ;;
        *) failures+=("$DEST_CLASS@$d") ;;
      esac
    fi
  done

  if [ "${#failures[@]}" -gt 0 ]; then
    local joined
    joined="$(IFS=,; printf '%s' "${failures[*]}")"
    abort "$joined"
  fi

  # Las dos pasadas dejaron manifiesto. Con una poda vencida el aviso es de falla, pero el respaldo ya está hecho.
  FINISHED=1
  if [ -n "$OVERDUE" ]; then
    printf 'run-backup: respaldo completo, pero la poda está vencida (%s)\n' "$OVERDUE" >&2
    ping fail "$ID $OVERDUE"
    return 0
  fi
  ping '' "$ID"
  printf 'run-backup: corrida %s completa\n' "$ID"
  return 0
}

main "$@"; exit $?
