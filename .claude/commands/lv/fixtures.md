---
description: Graba con un proveedor real los fixtures del mock que faltan para los golden sets de las tareas evaluables
argument-hint: [proveedor: ollama|openrouter, por defecto ollama]
---
Proveedor: "$ARGUMENTS" (por defecto ollama en `OLLAMA_URL`). Si Ollama no responde en `OLLAMA_URL`, detente y dímelo: NO
cambies a openrouter por tu cuenta. `--allow-external` solo se usa si el humano lo pidió explícitamente en esta conversación
(argumento `openrouter` o confirmación directa), porque envía los textos a un tercero (ADR-019 §6). La grabación es un comando, no un modo del mock
(ADR-019): `AI_MOCK_MODE` solo admite `replay` y `synth`.

> Nota: el registro automático de fixtures pendientes desde los tests llega con `link-enrichment`. Hasta entonces, los fixtures
> que pidan los tests (`FixtureMissing` de una clave que no sale de ningún golden) se escriben a mano con `"source": "handwritten"`.

1) Tareas: las registradas como evaluables en `libs/ai/src/evals/evaluable-tasks.ts`. Para cada una graba los casos del golden
   que no tengan fixture (los existentes se omiten sin contactar al proveedor):
   - Ollama: `pnpm nx run ai:record-fixtures --task=<t> --upstream=ollama --ollama-url=<OLLAMA_URL> --timeout-ms=300000`
   - OpenRouter (externo, solo con confirmación humana explícita; la redacción de datos personales la aplica `runTask`):
     `pnpm nx run ai:record-fixtures --task=<t> --upstream=openrouter --allow-external --timeout-ms=300000`
   Código 1 = grabación incompleta (el comando lista los casos no grabados): repite una vez. Código 2 = uso o configuración:
   detente con el motivo.
2) Revisa cada fixture nuevo en `<AI_FIXTURES_DIR>/<t>/<clave>.json`: `source` es `recorded:<proveedor>:<modelo>`, `text` valida
   contra el outputSchema de la tarea, no hay texto truncado y solo contiene valores del input (reinyectados), nunca datos
   personales inventados (emails, teléfonos, nombres). Si uno no cumple, bórralo y regrábalo una vez; si sigue mal, detente.
3) Comprueba replay: `pnpm nx run ai:eval --task=<t> --provider=mock` debe terminar con código 0. Si falla porque cambiaron los
   fixtures del golden (métricas distintas de la línea base), revisa el reporte en `reports/eval/<t>/mock.md` y, si el cambio es
   el esperado, ejecuta `pnpm nx run ai:eval --task=<t> --provider=mock --update-baseline` para commitear la línea base junto a los
   fixtures. Después, `AI_CHAIN=mock AI_MOCK_MODE=replay pnpm nx run-many -t test` en verde.
4) Commit `test(ai): fixtures grabados con <proveedor> (N)` (fixtures y, si cambió, `baseline.json` en el mismo commit).
Termina con la línea exacta "FIXTURES: OK (N)" o "FIXTURES: FALLO (motivo)".
