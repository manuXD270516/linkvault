#!/usr/bin/env bash
# ===================================================================================================================
# Reencola el outbox suelto (ADR-066, design D12 de `staging-backups`): sirve si se pierde SOLO Redis. `restore.sh` hace lo
# mismo dentro de una restauración (con el recuento y la confirmación); aquí es el paso aislado.
#
#   bash infra/backup/requeue-outbox.sh --since <hora ISO> [--count-only] [--project <nombre>]
#
# Pone como pendientes (`publishedAt: null`, `attempts: 0`, `nextAttemptAt` = ahora) los eventos publicados desde `--since`, sin
# tocar los agotados (`failedAt`), e imprime el recuento por tipo. Con `--count-only` no cambia nada. El relay de `api` los vuelve
# a publicar. Toma el mismo candado que el respaldo y la restauración (salvo que ya lo tenga quien lo llama).
#
# Variables de prueba: BACKUP_ROOT (directorio fijo, por defecto /srv/linkvault-staging), BACKUP_ENV_FILE, BACKUP_EXTRA_COMPOSE.
# ===================================================================================================================
main() {
  set -euo pipefail
  umask 077
  local ROOT="${BACKUP_ROOT:-/srv/linkvault-staging}"
  local ENV_FILE="${BACKUP_ENV_FILE:-$ROOT/.env.staging}"
  local PROJECT="${BACKUP_PROJECT:-linkvault-prod}"
  local since='' count_only=0
  local here
  here="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"

  while [ $# -gt 0 ]; do
    case "$1" in
      --since) since="${2:-}"; shift 2 ;;
      --count-only) count_only=1; shift ;;
      --project) PROJECT="${2:-}"; shift 2 ;;
      *) printf 'requeue-outbox: argumento desconocido: %s\n' "$1" >&2; return 2 ;;
    esac
  done
  [ -n "$since" ] || { printf 'requeue-outbox: falta --since <hora ISO>\n' >&2; return 2; }
  [ -f "$ENV_FILE" ] || { printf 'requeue-outbox: falta el fichero de entorno %s\n' "$ENV_FILE" >&2; return 2; }

  if [ "${BACKUP_LOCK_HELD:-0}" != 1 ]; then
    exec 9>"$ROOT/.backup.lock"
    if ! flock -n 9; then
      printf 'requeue-outbox: ya hay un respaldo, una restauración o un ensayo en curso; no se toca nada\n' >&2
      return 75
    fi
  fi

  local -a files=(-f "$ROOT/docker-compose.prod.yml")
  local extra
  for extra in ${BACKUP_EXTRA_COMPOSE:-}; do files+=(-f "$extra"); done
  docker compose --project-directory "$ROOT" -p "$PROJECT" "${files[@]}" --env-file "$ENV_FILE" \
    exec -T -e "REQUEUE_SINCE=$since" -e "REQUEUE_COUNT_ONLY=$count_only" mongo \
    mongosh --quiet --file /dev/stdin <"$here/requeue-outbox.js"
}

main "$@"; exit $?
