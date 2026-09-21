---
name: openspec-sync-specs
description: >-
  update main specs from a change delta without archiving. Triggers: /opsx:sync, sync specs. Cursor mirror — follow the canonical skill at .claude/skills/openspec-sync-specs/SKILL.md.
compatibility: Requires openspec CLI on PATH. Project skill mirroring Claude Code OpenSpec skills.
metadata:
  mirrorOf: .claude/skills/openspec-sync-specs/SKILL.md
  generatedFor: cursor
---

# openspec-sync-specs (Cursor mirror)

**Canonical instructions:** read and execute every step in `.claude/skills/openspec-sync-specs/SKILL.md`.
Do not invent a parallel workflow; that file is the source of truth (kept in sync with Claude Code / openspec generator).

## Cursor adaptations (apply while following the canonical skill)

1. **Shell:** run `openspec …` via the Shell tool. Ignore Claude `allowed-tools: Bash(openspec:*)`.
2. **Windows:** translate Unix snippets (`mkdir -p`, `mv`, `tail`, `cat`) to PowerShell (`New-Item -Force`, `Move-Item`, `Get-Content -Tail`, `Get-Content`).
3. **Slash commands:** `/opsx:sync` maps to `.cursor/commands/` (see `.cursor/README.md`). Natural language that matches the description also invokes this skill.
4. **Subagents:** when the skill or an `/lv:*` command names Claude agents (`backend-dev`, `frontend-dev`, …), use Cursor Task with the matching `subagent_type` and point the prompt at `.claude/agents/<name>.md`.
5. **Hooks:** `.claude/hooks/require-openspec-change.mjs` does **not** run in Cursor. Still honor `CLAUDE.md`: never edit `apps/**` or `libs/**` without an active change under `openspec/changes/`.
