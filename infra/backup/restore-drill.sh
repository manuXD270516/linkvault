#!/usr/bin/env bash
# ===================================================================================================================
# Ensayo de restauración EN EL HOST, en un proyecto de Compose aparte (ADR-066, design D13 de `staging-backups`).
# ===================================================================================================================
#   printf '%s\n' "$CONTRASEÑA_DE_LA_CUENTA_DE_ENSAYO" | bash infra/backup/restore-drill.sh --from oci|offsite [--run <id>]
#
# Toma el candado común; anota la memoria libre y, de cada contenedor de staging, `Id`, `State.StartedAt` y `RestartCount` (un
# reinicio no cambia el `Id` ni el `CreatedAt`: por eso los tres, C10); levanta `mongo`, `redis` y `object-store` del proyecto
# aparte (`linkvault-restore`, con `docker-compose.restore.yml`: sin Traefik, `web` ni `worker`, sin puertos, `api` sin salida y
# solo `backup-push` con salida); restaura con `restore.sh` (que en el ensayo SOLO CUENTA el reencolado); comprueba POR LA API del
# proyecto aparte el login de la cuenta permanente de ensayo (C11), sus links y su CV; imprime la conciliación y el RTO; termina
# con `down -v`; y FALLA si cambió cualquiera de los tres valores de algún contenedor de staging.
#
# La contraseña de la cuenta de ensayo se lee de la entrada estándar (`read -s`): nunca en los argumentos ni en el entorno de
# `docker`. El correo de la cuenta va en BACKUP_DRILL_EMAIL (no es un secreto; su `userId` está en `infra/backup/README.md`).
# Siempre en el host (`restore.sh` se niega a usar un repositorio remoto fuera de él), nunca en la PC del owner.
#
# Variables: BACKUP_ROOT, BACKUP_ENV_FILE, BACKUP_STAGING_PROJECT (por defecto linkvault-prod), BACKUP_DRILL_PROJECT (por defecto
# linkvault-restore), BACKUP_DRILL_EMAIL (obligatoria), BACKUP_DRILL_MIN_LINKS (por defecto 1), BACKUP_EXTRA_COMPOSE (solo pruebas).
# ===================================================================================================================

main() {
  set -euo pipefail
  umask 077

  local ROOT="${BACKUP_ROOT:-/srv/linkvault-staging}"
  local ENV_FILE="${BACKUP_ENV_FILE:-$ROOT/.env.staging}"
  local STAGING="${BACKUP_STAGING_PROJECT:-linkvault-prod}"
  local DRILL="${BACKUP_DRILL_PROJECT:-linkvault-restore}"
  local EMAIL="${BACKUP_DRILL_EMAIL:-}"
  local MIN_LINKS="${BACKUP_DRILL_MIN_LINKS:-1}"
  local FROM='' RUN_WANTED=''
  RUN_DIR='' WORK='' DRILL_UP=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --from) FROM="${2:-}"; shift 2 ;;
      --run) RUN_WANTED="${2:-}"; shift 2 ;;
      *) printf 'restore-drill: argumento desconocido: %s\n' "$1" >&2; return 2 ;;
    esac
  done
  case "$FROM" in oci | offsite) ;; *) printf 'restore-drill: --from debe ser oci u offsite\n' >&2; return 2 ;; esac
  [ -n "$EMAIL" ] || { printf 'restore-drill: falta BACKUP_DRILL_EMAIL (el correo de la cuenta permanente de ensayo)\n' >&2; return 2; }
  [ "$DRILL" != "$STAGING" ] || { printf 'restore-drill: el proyecto del ensayo no puede ser el de staging\n' >&2; return 2; }

  # La contraseña, sin eco y sin argumentos. En una terminal se pide; en una tubería se lee la primera línea.
  local PASSWORD=''
  if [ -t 0 ]; then
    printf 'restore-drill: contraseña de la cuenta de ensayo: ' >&2
    IFS= read -rs PASSWORD || true
    printf '\n' >&2
  else
    IFS= read -r PASSWORD || true
  fi
  [ -n "$PASSWORD" ] || { printf 'restore-drill: no llegó la contraseña de la cuenta de ensayo por la entrada estándar\n' >&2; return 2; }

  # --- Candado común (lo comparten respaldo, restauración y ensayo) ---
  local ID
  ID="$(date -u +%Y%m%dT%H%M%SZ)"
  exec 9>"$ROOT/.backup.lock"
  if ! flock -n 9; then
    printf 'restore-drill: ya hay un respaldo, una restauración o un ensayo en curso; no se toca nada\n' >&2
    return 75
  fi

  RUN_DIR="$ROOT/.backup-run-$ID-drill"
  mkdir -p "$RUN_DIR/infra/backup"
  cp -- "$ROOT/docker-compose.prod.yml" "$RUN_DIR/docker-compose.prod.yml"
  cp -R -- "$ROOT/infra/backup/." "$RUN_DIR/infra/backup/"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/lv-drill-work.XXXXXX")"
  local -a FILES=(-f "$RUN_DIR/docker-compose.prod.yml" -f "$RUN_DIR/infra/backup/docker-compose.backup.yml" -f "$RUN_DIR/infra/backup/docker-compose.restore.yml")
  local extra
  for extra in ${BACKUP_EXTRA_COMPOSE:-}; do FILES+=(-f "$extra"); done

  dc() { docker compose --project-directory "$RUN_DIR" -p "$DRILL" "${FILES[@]}" --env-file "$ENV_FILE" "$@"; }

  # `down -v` SIEMPRE al terminar, también si algo falla: el ensayo no deja restos.
  cleanup() {
    local code=$?
    if [ "$DRILL_UP" -eq 1 ]; then dc down -v --remove-orphans >/dev/null 2>&1 || true; fi
    if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
    if [ -n "$RUN_DIR" ] && [ -d "$RUN_DIR" ]; then rm -rf "$RUN_DIR"; fi
    return "$code"
  }
  trap cleanup EXIT

  say() { printf 'restore-drill: %s\n' "$*"; }
  die() { printf 'restore-drill: %s\n' "$*" >&2; exit 1; }

  # Contenedores de staging: nombre, Id, StartedAt y RestartCount (design C10).
  staging_state() {
    local id
    for id in $(docker ps -aq --filter "label=com.docker.compose.project=$STAGING" | LC_ALL=C sort); do
      docker inspect --format '{{.Name}} {{.Id}} {{.State.StartedAt}} {{.RestartCount}}' "$id"
    done | LC_ALL=C sort
  }
  staging_state >"$WORK/before"
  [ -s "$WORK/before" ] || die "no encuentro contenedores del proyecto $STAGING: sin staging no hay con qué comparar"
  if [ -r /proc/meminfo ]; then
    say "memoria disponible antes: $(awk '/MemAvailable/ { printf "%d MiB", $2 / 1024 }' /proc/meminfo)"
  fi

  local t0 t1
  t0="$(date +%s)"
  DRILL_UP=1
  say "levantando mongo, redis y object-store de $DRILL"
  dc up -d --wait mongo redis object-store >/dev/null || die 'el proyecto del ensayo no llegó a sano'

  say "restaurando desde $FROM con restore.sh (el reencolado del ensayo solo se cuenta)"
  local -a args=(--project "$DRILL" --from "$FROM")
  if [ -n "$RUN_WANTED" ]; then args+=(--run "$RUN_WANTED"); fi
  BACKUP_LOCK_HELD=1 BACKUP_STAGING_PROJECT="$STAGING" BACKUP_DRILL_PROJECT="$DRILL" BACKUP_ROOT="$ROOT" BACKUP_ENV_FILE="$ENV_FILE" \
    bash "$RUN_DIR/infra/backup/restore.sh" "${args[@]}" </dev/null || die 'restore.sh falló en el ensayo'

  # Comprobación POR LA API del proyecto aparte: login, links y CV de la cuenta de ensayo. La contraseña va por la entrada
  # estándar de `node`; el correo (no secreto) por su argumento.
  say 'comprobando la cuenta de ensayo por la API del proyecto aparte'
  local cid
  cid="$(dc ps -q api | head -n 1)"
  [ -n "$cid" ] || die 'la api del ensayo no está en marcha'
  # shellcheck disable=SC2016
  local check_script='
    const password = require("fs").readFileSync(0, "utf8").replace(/\r?\n$/, "");
    const email = process.argv[1];
    const minLinks = Number(process.argv[2]);
    const base = "http://127.0.0.1:3000/api";
    (async () => {
      const json = { "content-type": "application/json", "x-requested-with": "linkvault" };
      const login = await fetch(base + "/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email, password }) });
      if (login.status !== 200) { console.log("login: HTTP " + login.status); process.exit(10); }
      const { accessToken } = await login.json();
      const auth = { authorization: "Bearer " + accessToken };
      const links = await fetch(base + "/links/mine", { headers: auth });
      const linkItems = links.status === 200 ? (await links.json()).items.length : -1;
      const cvs = await fetch(base + "/cv", { headers: auth });
      const cvItems = cvs.status === 200 ? (await cvs.json()).items.length : -1;
      console.log("login: ok; links: " + linkItems + "; cv: " + cvItems);
      process.exit(linkItems >= minLinks && cvItems >= 1 ? 0 : 11);
    })().catch((error) => { console.log("error: " + error.message); process.exit(12); });'
  local api_out api_rc=0
  api_out="$(printf '%s\n' "$PASSWORD" | docker exec -i "$cid" node -e "$check_script" "$EMAIL" "$MIN_LINKS" 2>&1)" || api_rc=$?
  PASSWORD=''
  say "API del ensayo: $api_out"
  case "$api_rc" in
    0) ;;
    10) die 'el login de la cuenta de ensayo falló (¿contraseña o correo equivocados?)' ;;
    11) die 'la cuenta de ensayo entró, pero le faltan links o CV: la restauración no devolvió sus datos' ;;
    *) die "la comprobación por la API terminó con código $api_rc" ;;
  esac

  t1="$(date +%s)"
  say "RTO medido de este ensayo: $((t1 - t0)) s"
  if [ -r /proc/meminfo ]; then
    say "memoria disponible con el ensayo en pie: $(awk '/MemAvailable/ { printf "%d MiB", $2 / 1024 }' /proc/meminfo)"
  fi

  # Cierre: `down -v` y comprobación de que no queda nada; después, que staging no se haya movido.
  dc down -v --remove-orphans >/dev/null || die 'down -v del ensayo falló'
  DRILL_UP=0
  local left
  left="$(docker volume ls -q --filter "label=com.docker.compose.project=$DRILL" | head -n 3)"
  [ -z "$left" ] || die "quedan volúmenes del proyecto $DRILL: $left"
  left="$(docker ps -aq --filter "label=com.docker.compose.project=$DRILL" | head -n 3)"
  [ -z "$left" ] || die "quedan contenedores del proyecto $DRILL"

  staging_state >"$WORK/after"
  if ! diff -q "$WORK/before" "$WORK/after" >/dev/null; then
    local line name
    while IFS= read -r line; do
      name="${line%% *}"
      grep -qxF -- "$line" "$WORK/after" || printf 'restore-drill: CAMBIÓ el contenedor %s de %s (Id, StartedAt o RestartCount)\n' "$name" "$STAGING" >&2
    done <"$WORK/before"
    die "el ensayo tocó staging: algún contenedor de $STAGING cambió; es un fallo del ensayo aunque la restauración haya funcionado"
  fi
  say "staging intacto: $(wc -l <"$WORK/before" | tr -d ' ') contenedores con el mismo Id, StartedAt y RestartCount; el proyecto $DRILL ya no existe"
  return 0
}

main "$@"; exit $?
