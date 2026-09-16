#!/usr/bin/env bash
# Bloquea ediciones en apps/ o libs/ si no hay un change activo de OpenSpec.
#
# Escrito solo con builtins de bash, a proposito. En Windows este hook se ejecuta
# con el PATH del proceso padre, que puede venir en formato Windows ('C:\...;C:\...');
# en ese caso NINGUN binario de /usr/bin resuelve. La version anterior dependia de
# jq/grep/sed/find/head/cat: si alguno fallaba, $path quedaba vacio y el hook salia
# con 0, es decir, dejaba de proteger sin decir nada.
set -u

# 1) Leer el JSON de stdin sin 'cat'.
input=""
while IFS= read -r __line || [ -n "$__line" ]; do input="$input$__line"; done

# 2) Extraer la ruta sin 'jq' ni 'grep'.
path=""
if [[ "$input" =~ \"file_path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
  path="${BASH_REMATCH[1]}"
elif [[ "$input" =~ \"path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
  path="${BASH_REMATCH[1]}"
fi
[ -n "$path" ] || exit 0

# 3) Normalizar separadores: en Windows llegan rutas 'D:\proyecto\apps\api\main.ts'
#    (y en JSON con las barras escapadas), que no casaban con los patrones '*/apps/*'.
bs=$(printf '\134')
path="${path//"$bs"/'/'}"
while [[ "$path" == *//* ]]; do path="${path//'//'/'/'}"; done

case "$path" in
  */apps/*|*/libs/*|apps/*|libs/*) ;;
  *) exit 0 ;;
esac

# 4) Buscar un change activo sin 'find': glob + builtins.
root="${BASH_SOURCE[0]%/*}/../.."
shopt -s nullglob
active=""
for d in "$root"/openspec/changes/*/; do
  name="${d%/}"; name="${name##*/}"
  [ "$name" = "archive" ] && continue
  active="$d"; break
done

if [ -z "$active" ]; then
  echo "No hay un change activo en openspec/changes/. Crea uno con /opsx:new antes de editar codigo." >&2
  exit 2
fi
exit 0
