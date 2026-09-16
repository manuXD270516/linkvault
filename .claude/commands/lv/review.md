---
description: Revisión automática de la spec del change (architect + qa-reviewer) en lugar de la lectura humana
argument-hint: [nombre-del-change]
---
Change: "$ARGUMENTS" (si vacío, el activo en openspec/changes/ distinto de archive).
Convoca a architect y qa-reviewer sobre proposal.md, design.md, tasks.md y specs/ con esta checklist:
1) proposal.md cita todos los ADRs listados para el change en openspec-changes.yaml y no contradice ninguno.
2) El alcance coincide con el scope del manifiesto: nada de fases posteriores, nada faltante.
3) Cada Requirement tiene ≥ 1 Scenario en formato GIVEN/WHEN/THEN; cada Scenario es verificable por un test.
4) Cada tarea de tasks.md tiene etiqueta [infra]|[backend]|[frontend]|[ai], es < 1 hora y está ordenada por dependencias.
5) design.md respeta clean architecture, outbox, runTask y las reglas duras de CLAUDE.md.
Corrige tú mismo los fallos de forma (formato, etiquetas, orden). Los fallos de fondo (alcance, ADR) repórtalos.
Termina con la tabla checklist/estado/acción y la línea exacta "SPEC: APROBADA" o "SPEC: RECHAZADA (motivos)".
