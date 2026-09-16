---
description: Crea el change indicado (o el siguiente pendiente) con /opsx:new + /opsx:ff usando el alcance del manifiesto
argument-hint: [nombre-del-change | next]
---
Change solicitado: "$ARGUMENTS" (si es "next" o vacío, toma el primer change de openspec-changes.yaml que no esté en openspec/changes/archive/ ni activo en openspec/changes/).
1) Lee openspec-changes.yaml y extrae name, adrs y scope de ese change. Lee los docs/adr/ADR-<n>.md listados.
2) Ejecuta /opsx:new <name>.
3) Ejecuta /opsx:ff pasando como contexto: el scope literal, la lista de ADRs a referenciar en proposal.md, y la regla de que cada Requirement
   de specs/ tenga al menos un Scenario y cada tarea de tasks.md lleve etiqueta [infra]|[backend]|[frontend]|[ai] y sea completable en < 1 hora.
4) Termina mostrando un resumen de proposal.md, la lista de tareas y la ruta del change. No implementes nada.
Nota: si /opsx:new no existe en esta instalación, usa el equivalente registrado por OpenSpec (/openspec:proposal); igual para ff/apply/verify/archive.
