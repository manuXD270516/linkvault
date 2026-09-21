---
name: lv-new
description: Crea el change indicado (o el siguiente pendiente) con /opsx:new + /opsx:ff usando el alcance del manifiesto (Cursor mirror of /lv:new)
---

# lv-new

**Canonical command:** follow `.claude/commands/lv/new.md` verbatim for steps and rules.

## Cursor adaptations

- Slash `/lv:new` → this command. `$ARGUMENTS` = text after the command name.
- Where the command says `/opsx:*`, use the matching `.cursor/commands/opsx-*.md` skill mirror.
- Subagents named in the command (`devops`, `backend-dev`, `frontend-dev`, `ai-engineer`, `critic`, `business`, `architect`, `qa-reviewer`): launch Cursor Task with that `subagent_type` and include the contents of `.claude/agents/<name>.md` in the prompt.
- Shell via PowerShell on Windows; do not assume bash.
- Do not bypass OpenSpec: no `apps/**` / `libs/**` edits without an active change.
