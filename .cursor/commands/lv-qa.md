---
name: lv-qa
description: /opsx:verify + qa-reviewer en bucle hasta verde sobre el change activo (Cursor mirror of /lv:qa)
---

# lv-qa

**Canonical command:** follow `.claude/commands/lv/qa.md` verbatim for steps and rules.

## Cursor adaptations

- Slash `/lv:qa` → this command. `$ARGUMENTS` = text after the command name.
- Where the command says `/opsx:*`, use the matching `.cursor/commands/opsx-*.md` skill mirror.
- Subagents named in the command (`devops`, `backend-dev`, `frontend-dev`, `ai-engineer`, `critic`, `business`, `architect`, `qa-reviewer`): launch Cursor Task with that `subagent_type` and include the contents of `.claude/agents/<name>.md` in the prompt.
- Shell via PowerShell on Windows; do not assume bash.
- Do not bypass OpenSpec: no `apps/**` / `libs/**` edits without an active change.
