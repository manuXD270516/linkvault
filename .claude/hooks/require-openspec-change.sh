#!/usr/bin/env bash
# Prefer Node on Windows/CI where bash may fail to start; fall back to inline bash.
set -u
root="${BASH_SOURCE[0]%/*}"
if command -v node >/dev/null 2>&1; then
  exec node "$root/require-openspec-change.js"
fi

allow() { printf '%s\n' '{"permission":"allow"}'; exit 0; }
deny() { printf '%s\n' '{"permission":"deny","agent_message":"No hay un change activo en openspec/changes/. Crea uno con /opsx:new antes de editar codigo."}'; exit 0; }

input=""
while IFS= read -r __line || [ -n "$__line" ]; do input="$input$__line"; done

path=""
if [[ "$input" =~ \"file_path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
  path="${BASH_REMATCH[1]}"
elif [[ "$input" =~ \"path\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
  path="${BASH_REMATCH[1]}"
fi
[ -n "$path" ] || allow

bs=$(printf '\134')
path="${path//"$bs"/'/'}"
while [[ "$path" == *//* ]]; do path="${path//'//'/'/'}"; done

case "$path" in
  */apps/*|*/libs/*|apps/*|libs/*) ;;
  *) allow ;;
esac

repo="${BASH_SOURCE[0]%/*}/../.."
shopt -s nullglob
active=""
for d in "$repo"/openspec/changes/*/; do
  name="${d%/}"; name="${name##*/}"
  [ "$name" = "archive" ] && continue
  active="$d"; break
done

if [ -z "$active" ]; then
  deny
fi
allow