#!/usr/bin/env bash
# Bloquea ediciones en apps/ o libs/ si no hay un change activo de OpenSpec.
input=$(cat)
if command -v jq >/dev/null 2>&1; then
  path=$(echo "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')
else
  path=$(echo "$input" | grep -oE '"(file_path|path)"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n1 | sed -E 's/.*:[[:space:]]*"([^"]+)"/\1/')
fi
case "$path" in
  *"/apps/"*|*"/libs/"*|apps/*|libs/*) ;;
  *) exit 0 ;;
esac
active=$(find openspec/changes -mindepth 1 -maxdepth 1 -type d ! -name archive 2>/dev/null | head -n1)
if [ -z "$active" ]; then
  echo "No hay un change activo en openspec/changes/. Crea uno con /opsx:new antes de editar código." >&2
  exit 2
fi
exit 0
