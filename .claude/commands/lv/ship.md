---
description: Rama, push y Pull Request del change con cuerpo generado desde la spec
argument-hint: [nombre-del-change]
---
Change: "$ARGUMENTS". Requiere `gh` autenticado (`gh auth status`); si no lo está, detente y dímelo.
1) Si estás en main con los commits del change, crea la rama `change/<nombre>` desde HEAD y mueve main atrás al último commit anterior al
   change (`git branch -f main <sha>`); si ya estás en una rama del change, sigue.
2) `git push -u origin change/<nombre>`.
3) `gh pr create --fill --title "feat: <nombre>" --body` con: resumen de proposal.md, lista de Requirements, ADRs tocados, checklist DoD de
   docs/RUNBOOK.md §7 marcada según los marcadores de los logs (SPEC, CONVERGENCIA, QA, SMOKE), enlace a reports/smoke/<nombre>/REPORT.md.
4) Si el repo tiene auto-merge habilitado y CI pasa, activa `gh pr merge --auto --squash`.
Termina con la URL del PR y la línea exacta "SHIP: OK <url>" o "SHIP: FALLO (motivo)".
