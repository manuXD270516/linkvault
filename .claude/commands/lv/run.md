---
description: Ejecuta un change completo de principio a fin (spec → review → debate → apply → fixtures → qa → smoke → archive → ship)
argument-hint: [nombre-del-change | next] [--no-ship]
---
Argumentos: "$ARGUMENTS". Change = primer token (o el siguiente pendiente si es "next"/vacío). Si incluye --no-ship omite la etapa ship.
Ejecuta en orden, deteniéndote SOLO si una etapa devuelve su marcador de fallo; no me pidas confirmaciones intermedias:
1) /lv:new <change>            → debe existir openspec/changes/<change>/
2) /lv:review <change>         → exige "SPEC: APROBADA" (si RECHAZADA por forma, corrige y repite una vez; si por fondo, detente)
3) /lv:debate <change>         → exige "CONVERGENCIA: SI"; luego `git add -A && git commit -m "spec(<change>): approved"`
4) /lv:apply <change>
5) /lv:fixtures                → solo si hay FixtureMissing; exige "FIXTURES: OK"
6) /lv:qa <change>             → exige "QA: VERDE"
7) /lv:smoke <change>          → exige "SMOKE: OK"
8) /lv:archive <change>        → luego `git add -A && git commit -m "feat(<área>): <change>"`
9) /lv:ship <change>           → salvo --no-ship
Al final imprime una tabla etapa/marcador/duración aproximada y la línea exacta "RUN: OK <change>" o "RUN: FALLO <etapa> (motivo)".
Si el siguiente change del manifiesto es ai-eval-harness, ejecuta /lv:golden 10 justo después de /lv:apply.
