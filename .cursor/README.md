# Cursor ↔ Claude Code (OpenSpec / LinkVault)

Mirror del flujo Spec-Driven pensado en Claude Code, usable desde Cursor Agent.

## Skills (auto-descubrimiento)

| Skill Cursor | Canónico | Slash |
|---|---|---|
| `.cursor/skills/openspec-propose` | `.claude/skills/openspec-propose` | `/opsx:propose` → `opsx-propose` |
| `.cursor/skills/openspec-apply-change` | `.claude/skills/openspec-apply-change` | `/opsx:apply` → `opsx-apply` |
| `.cursor/skills/openspec-update-change` | `.claude/skills/openspec-update-change` | `/opsx:update` → `opsx-update` |
| `.cursor/skills/openspec-explore` | `.claude/skills/openspec-explore` | `/opsx:explore` → `opsx-explore` |
| `.cursor/skills/openspec-sync-specs` | `.claude/skills/openspec-sync-specs` | `/opsx:sync` → `opsx-sync` |
| `.cursor/skills/openspec-archive-change` | `.claude/skills/openspec-archive-change` | `/opsx:archive` → `opsx-archive` |

Los `SKILL.md` de `.cursor/skills/` son **wrappers**: el workflow vive en `.claude/skills/`. Al regenerar OpenSpec en Claude, actualiza solo el canónico.

## Commands LinkVault (`/lv:*`)

| Command Cursor | Canónico |
|---|---|
| `lv-new`, `lv-apply`, `lv-archive`, `lv-ship`, … | `.claude/commands/lv/<name>.md` |

## Flujo habitual

1. `lv-new` / `opsx-propose` → artifacts  
2. `lv-debate` (critic + business) → ADRs si hace falta  
3. `lv-apply` / `opsx-apply` → implementación  
4. `lv-qa` + `lv-smoke` → verde  
5. `lv-archive` / `opsx-archive` → sync specs + archive  
6. `lv-ship` → PR  

## Lo que Cursor no hereda de Claude

- Hook `require-openspec-change.mjs` (PreToolUse) — no corre aquí; respeta `CLAUDE.md`.
- `settings.json` permissions/deny de `.env` — no aplica; no leas `.env` con secretos en el chat.
- Agentes: usa Task + `.claude/agents/*.md`.
