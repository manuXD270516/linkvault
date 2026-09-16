#!/usr/bin/env bash
# Orquesta un change con Claude Code headless. Etapas: spec review debate apply fixtures qa smoke archive ship
# Uso: bash scripts/change.sh <nombre|next> [--from <etapa>] [--auto] [--no-ship]
#   --auto   : sin puertas humanas (la revisión de spec la hace /lv:review)
#   --no-ship: no crea rama/push/PR
set -euo pipefail
NAME="${1:-next}"; shift || true
FROM="spec"; AUTO=0; SHIP=1
while [ $# -gt 0 ]; do case "$1" in --from) FROM="$2"; shift 2;; --auto|--yes) AUTO=1; shift;; --no-ship) SHIP=0; shift;; *) shift;; esac; done
LOG=".claude/logs"; mkdir -p "$LOG"; LAST_LOG=""
run(){ echo -e "\n══ $1 ══"; LAST_LOG="$LOG/$(date +%Y%m%d-%H%M%S)-$1.log"
  claude -p "$2" --permission-mode acceptEdits --output-format text 2>&1 | tee "$LAST_LOG"; }
need(){ grep -q "$1" "$LAST_LOG" || { echo "✗ $2 — log: $LAST_LOG. Reanuda con --from $3"; exit 1; }; }
gate(){ [ "$AUTO" = 1 ] && return 0; read -r -p "→ $1 ¿Continuar? [s/N] " a; [[ "$a" =~ ^[sSyY]$ ]] || { echo "Detenido. Reanuda con --from <etapa>."; exit 0; }; }
stage(){ [[ "$FROM" == "$1" ]] && FROM="__go__"; [[ "$FROM" == "__go__" ]]; }
active(){ basename "$(find openspec/changes -mindepth 1 -maxdepth 1 -type d ! -name archive | head -n1)"; }

if stage spec;     then run spec "/lv:new $NAME"; NAME=$(active); fi
if stage review;   then run review "/lv:review $NAME"; need "SPEC: APROBADA" "spec rechazada" review
                        gate "Spec aprobada por architect+qa. Siguiente: debate."; fi
if stage debate;   then run debate "/lv:debate $NAME"; need "CONVERGENCIA: SI" "sin convergencia" debate
                        git add -A && git commit -qm "spec($NAME): approved" || true
                        gate "Debate convergido. Siguiente: implementación."; fi
if stage apply;    then run apply "/lv:apply $NAME"
                        [ "$NAME" = "ai-eval-harness" ] && run golden "/lv:golden 10"; fi
if stage fixtures; then run fixtures "/lv:fixtures"; grep -q "FIXTURES: FALLO" "$LAST_LOG" && { echo "✗ fixtures"; exit 1; }; fi
if stage qa;       then run qa "/lv:qa $NAME"; need "QA: VERDE" "QA en rojo" qa; fi
if stage smoke;    then run smoke "/lv:smoke $NAME"; need "SMOKE: OK" "smoke falló" smoke
                        gate "Smoke OK. Siguiente: archivar y publicar."; fi
if stage archive;  then run archive "/lv:archive $NAME"; git add -A && git commit -qm "feat: $NAME" || true; fi
if stage ship && [ "$SHIP" = 1 ]; then run ship "/lv:ship $NAME"; need "SHIP: OK" "ship falló" ship; fi
echo "✓ RUN OK: $NAME"
