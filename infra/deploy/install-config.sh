#!/usr/bin/env bash
# ===================================================================================================================
# Instala en el host de staging la configuración de un despliegue (design D4 de `staging-host`, tareas 4.2 y 4.3).
# ===================================================================================================================
# Corre **en el host**, desde el árbol `.incoming-<sha12>/` que el corredor dejó en el directorio fijo con `tar | ssh`.
# Copia a su sitio, en el directorio del compose, **los ficheros de `infra/deploy/config-files.txt` y solo esos**; no
# toca `.env.staging` ni nada fuera de la lista. La lista se declara una vez y la usan la copia del corredor y este
# script; no admite comentarios porque `tar -T` lee cada línea como un nombre.
#
# --- Sobre el mismo fichero, nunca por renombrado ------------------------------------------------------------------
# Traefik monta `./infra/traefik/dynamic.yml` como **fichero suelto** y lo vigila (`--providers.file.watch=true`). El
# montaje de un fichero suelto queda atado a su **inodo**: escribir por renombrado (temporal + `mv`) dejaría al
# contenedor viendo el inodo viejo, el cambio no llegaría y nada fallaría. Por eso un fichero que ya existe se
# reescribe con `cat src > dst`, que conserva el inodo.
#
# --- Retención ------------------------------------------------------------------------------------------------------
# Conserva los **5** `.incoming-*` más recientes (por fecha de modificación) y **nunca** borra el del despliegue en
# curso, aunque no estuviera entre ellos. Son los que sirven para volver atrás sin GitHub (RUNBOOK).
#
# Uso: bash <directorio fijo>/.incoming-<sha12>/infra/deploy/install-config.sh <directorio del compose>
# Sale ≠0 sin copiar nada si el directorio del compose no existe o si el árbol de origen no es un `.incoming-<sha12>`.
# ===================================================================================================================
set -euo pipefail

KEEP=5

fail() {
  printf 'install-config: %s\n' "$1" >&2
  exit 1
}

target="${1:-}"
[ -n "$target" ] || fail 'falta el directorio del compose (primer argumento)'
[ -d "$target" ] || fail "no existe el directorio del compose: $target (no se crea: es el directorio fijo del host)"
target="$(cd "$target" && pwd)"

# El árbol de origen es el `.incoming-<sha12>` que contiene este script (dos niveles por encima de infra/deploy).
script_dir="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
incoming="$(cd "$script_dir/../.." && pwd)"
incoming_name="${incoming##*/}"
[[ "$incoming_name" =~ ^\.incoming-[0-9a-f]{12}$ ]] ||
  fail "el árbol de origen no es un .incoming-<sha12>: $incoming"
list="$incoming/infra/deploy/config-files.txt"
[ -f "$list" ] || fail "falta la lista de ficheros: $list"

# Primero se valida la lista entera; si algo falla, no se ha copiado nada.
files=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  [ -n "$line" ] || continue
  case "$line" in
    /* | *..* | -*) fail "ruta no válida en la lista: $line" ;;
  esac
  [ -f "$incoming/$line" ] || fail "la lista nombra un fichero que no llegó: $line"
  files+=("$line")
done <"$list"
[ "${#files[@]}" -gt 0 ] || fail "la lista está vacía: $list"

for file in "${files[@]}"; do
  destination="$target/$file"
  parent="${destination%/*}"
  [ -d "$parent" ] || mkdir -p -- "$parent"
  # `cat >` reescribe el mismo inodo si el fichero existe y lo crea si no.
  cat -- "$incoming/$file" >"$destination"
  printf 'instalado: %s\n' "$file"
done

# Retención: los .incoming-* del directorio, del más reciente al más antiguo.
entries=()
for dir in "$target"/.incoming-*; do
  [ -d "$dir" ] || continue
  [[ "${dir##*/}" =~ ^\.incoming-[0-9a-f]{12}$ ]] || continue
  entries+=("$(stat -c %Y -- "$dir") $dir")
done
kept=0
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  dir="${entry#* }"
  if [ "$dir" = "$incoming" ]; then
    kept=$((kept + 1))
  elif [ "$kept" -lt "$KEEP" ]; then
    kept=$((kept + 1))
  else
    rm -rf -- "$dir"
    printf 'retención: borrado %s\n' "${dir##*/}"
  fi
done < <(printf '%s\n' "${entries[@]}" | sort -rn)
