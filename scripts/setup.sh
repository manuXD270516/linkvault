#!/usr/bin/env bash
# Paso 0-2 del RUNBOOK en un comando. Uso: bash scripts/setup.sh   (desde la raíz del repo, con el kit ya copiado)
set -euo pipefail
need(){ command -v "$1" >/dev/null 2>&1 || { echo "✗ falta $1"; exit 1; }; }
need node; need git; need docker
NODE_MAJOR=$(node -v | sed -E 's/v([0-9]+).*/\1/'); [ "$NODE_MAJOR" -ge 22 ] || { echo "✗ Node ≥ 22 requerido"; exit 1; }
command -v pnpm >/dev/null || { corepack enable && corepack prepare pnpm@latest --activate; }
command -v claude >/dev/null || npm i -g @anthropic-ai/claude-code
command -v openspec >/dev/null || npm i -g @fission-ai/openspec@latest
echo "✓ node $(node -v) · pnpm $(pnpm -v) · claude $(claude --version 2>/dev/null | head -n1) · openspec $(openspec --version 2>/dev/null | head -n1)"

[ -d .git ] || git init -b main
chmod +x .claude/hooks/*.sh scripts/*.sh
[ -f .gitignore ] || cat > .gitignore <<'GI'
node_modules/
dist/
.nx/
.env
.env.*
coverage/
*.log
reports/
.claude/settings.local.json
GI

if [ ! -d openspec ]; then
  echo "→ openspec init (elige Claude Code si pregunta)"
  openspec init --tools claude 2>/dev/null || openspec init
fi
if ! grep -q "LinkVault" openspec/project.md 2>/dev/null; then
cat > openspec/project.md <<'PM'
# LinkVault
Repositorio colaborativo de vacantes: cuentas personales, grupos, links compartidos con preview enriquecido,
tracking de postulación por usuario, y análisis de CV + roadmap con IA.

## Stack
Nx monorepo · NestJS 11 (Fastify) api + worker (BullMQ) · Angular 22 · MongoDB (replset) · Redis · MinIO · Vitest · Docker.

## Convenciones
Ver CLAUDE.md. Decisiones vigentes en docs/design-v0.2.md y docs/adr/. Specs en español; código en inglés.
Cada Requirement de spec debe tener al menos un Scenario y cada Scenario un test.
PM
fi
git add -A && git commit -qm "chore: bootstrap context, openspec, Claude Code automation" || true
echo "✓ listo. Siguiente: claude → /lv:context   |   o headless: make change NAME=bootstrap-monorepo"
