#!/usr/bin/env bash
# ===================================================================================================================
# Ejecuta un script `mongosh` de solo lectura en el Mongo de staging (design D15 y D16 de `staging-host`, tarea 9.12).
# ===================================================================================================================
# Se ejecuta **en la máquina del operador**, desde el repositorio:
#
#   STAGING_SSH_DEST=<usuario>@<ip> STAGING_EXCLUDED_IDS_FILE=<fichero fuera del repositorio> \
#     bash infra/staging/run.sh infra/staging/measure.mongosh.js
#
# Mongo no tiene autenticación y el operador tiene acceso total; la garantía de solo lectura es la comprobación
# estática `infra/staging/assert-readonly.mjs`, y este envoltorio la aplica **antes de abrir ninguna sesión**: si no
# pasa, no se llama a `ssh`. Lo que se comprueba es una copia del script, y es esa copia la que se envía, para que el
# texto revisado y el ejecutado sean el mismo.
#
# Después, `ssh <destino> '<orden>' < <copia>`: en el host, desde el directorio fijo, la orden lee la lista de
# invitados (`invited-ids.txt`, que vive solo allí: son datos personales) y ejecuta
# `docker compose … exec -T mongo mongosh --quiet --eval <listas> /dev/stdin` con las dos listas inyectadas por
# `--eval`. El `/dev/stdin` explícito es necesario: con `--eval`, `mongosh` ignora la entrada estándar si no se le
# nombra como fichero (medido con `mongosh` 2.10.0, el de `mongo:7.0.43`).
#
# Entorno:
#   STAGING_SSH_DEST           destino `ssh`: `usuario@host` o un alias de `~/.ssh/config`. La clave del host tiene que
#                              estar ya en `known_hosts` (`StrictHostKeyChecking=yes`, sin preguntas: `BatchMode=yes`).
#   STAGING_EXCLUDED_IDS_FILE  lista de excluidos (autor + cuentas E2E, design D15): un id de 24 caracteres
#                              hexadecimales por línea; se ignoran las vacías y las que empiezan por `#`. Tiene que vivir
#                              **fuera del repositorio** y contener al menos un id (el del autor).
#
# Salidas: la del script en el host (0 si terminó); 1 si la comprobación de solo lectura falla; 2 por un error de uso
# o de configuración local; 3 si en el host falta o está mal la lista de invitados.
# ===================================================================================================================
set -euo pipefail

STAGING_DIR=/srv/linkvault-staging
INVITED_FILE=invited-ids.txt

fail() {
  printf 'run.sh: %s\n' "$1" >&2
  exit "${2:-2}"
}

[ "$#" -eq 1 ] || fail 'uso: bash infra/staging/run.sh <script.mongosh.js>'
script="$1"
[ -f "$script" ] && [ -r "$script" ] || fail "no se puede leer el script: $script"

here="$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
copy="$work/$(basename -- "$script")"
cp -- "$script" "$copy"

# 1. Solo lectura, en local y antes de nada más. Su informe va a stderr: stdout es solo la salida del script.
if ! node "$here/assert-readonly.mjs" "$copy" >&2; then
  fail "no se ejecuta $script: no ha pasado infra/staging/assert-readonly.mjs" 1
fi

# 2. Destino y lista de excluidos.
dest="${STAGING_SSH_DEST:-}"
[ -n "$dest" ] || fail 'falta STAGING_SSH_DEST (usuario@host o alias de ~/.ssh/config)'
[[ "$dest" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9._-]*)?$ ]] ||
  fail 'STAGING_SSH_DEST no tiene la forma usuario@host o alias'

excluded_file="${STAGING_EXCLUDED_IDS_FILE:-}"
[ -n "$excluded_file" ] || fail 'falta STAGING_EXCLUDED_IDS_FILE (lista de excluidos, fuera del repositorio)'
[ -f "$excluded_file" ] && [ -r "$excluded_file" ] || fail "no se puede leer STAGING_EXCLUDED_IDS_FILE: $excluded_file"

repo="$(cd "$(git -C "$here" rev-parse --show-toplevel)" && pwd -P)" || fail 'no se encuentra la raíz del repositorio'
excluded_real="$(cd "$(dirname -- "$excluded_file")" && pwd -P)/$(basename -- "$excluded_file")"
case "$excluded_real/" in
  "$repo"/*) fail 'STAGING_EXCLUDED_IDS_FILE está dentro del repositorio: la lista vive fuera (design D15)' ;;
esac

excluded_js=''
count=0
line_no=0
while IFS= read -r line || [ -n "$line" ]; do
  line_no=$((line_no + 1))
  line="${line%$'\r'}"
  case "$line" in
    '' | '#'*) continue ;;
  esac
  [[ "$line" =~ ^[0-9a-f]{24}$ ]] ||
    fail "STAGING_EXCLUDED_IDS_FILE, línea $line_no: no es un id de 24 caracteres hexadecimales"
  excluded_js="${excluded_js:+$excluded_js,}'$line'"
  count=$((count + 1))
done <"$excluded_file"
[ "$count" -gt 0 ] || fail 'STAGING_EXCLUDED_IDS_FILE no tiene ningún id: falta al menos el del autor'

# 3. La orden del host. Va entre comillas simples: nada se expande aquí salvo la lista de excluidos, ya validada (solo
#    hexadecimales, comas y comillas simples). La de invitados se valida y se monta en el host.
remote=$(
  cat <<'REMOTE'
set -eu
cd __STAGING_DIR__
f=__INVITED_FILE__
if [ ! -f "$f" ]; then echo "run.sh (host): falta __STAGING_DIR__/$f" >&2; exit 3; fi
if grep -qvE '^(#.*|[0-9a-f]{24})?$' "$f"; then echo "run.sh (host): __STAGING_DIR__/$f tiene líneas que no son ids" >&2; exit 3; fi
inv=$(grep -E '^[0-9a-f]{24}$' "$f" | sed "s/.*/'&'/" | paste -sd, -)
exec docker compose -f docker-compose.prod.yml --env-file .env.staging exec -T mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval "globalThis.LV_EXCLUDED_IDS=[__EXCLUDED__];globalThis.LV_INVITED_IDS=[$inv];void 0" /dev/stdin
REMOTE
)
remote="${remote//__STAGING_DIR__/$STAGING_DIR}"
remote="${remote//__INVITED_FILE__/$INVITED_FILE}"
remote="${remote//__EXCLUDED__/$excluded_js}"

printf 'run.sh: %s en %s (%d excluidos)\n' "$script" "$dest" "$count" >&2
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -- "$dest" "$remote" <"$copy"
