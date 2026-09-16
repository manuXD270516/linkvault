#!/usr/bin/env bash
# Recorre openspec-changes.yaml en orden y ejecuta cada change pendiente en modo --auto. Se detiene en el primer fallo.
# Uso: bash scripts/autopilot.sh [--until <change>] [--no-ship]
set -euo pipefail
UNTIL=""; EXTRA=""
while [ $# -gt 0 ]; do case "$1" in --until) UNTIL="$2"; shift 2;; --no-ship) EXTRA="--no-ship"; shift;; *) shift;; esac; done
for c in $(grep -E '^\s*- name:' openspec-changes.yaml | awk '{print $3}'); do
  if [ -d "openspec/changes/archive" ] && ls openspec/changes/archive | grep -q -- "-$c\$\|^$c\$"; then echo "· $c ya archivado"; continue; fi
  echo -e "\n################ $c ################"
  bash scripts/change.sh "$c" --auto $EXTRA
  [ -n "$UNTIL" ] && [ "$c" = "$UNTIL" ] && { echo "Alcanzado --until $c"; break; }
done
echo "✓ autopilot terminado"
