## 1. Automatización y base

- [ ] 1.1 [infra] Quitar de `.claude/commands/lv/run.md` la invocación de `/lv:golden` asociada a `ai-eval-harness` y corregir `.claude/commands/lv/golden.md` (rutas `libs/ai/src/evals/<task>/`, sin `--validate`, cantidad por defecto 20, exige tarea registrada) (D11); verificar leyendo ambos archivos que no quedan rutas `libs/ai/evals/`, `--validate` ni disparos de `/lv:golden` ligados a este change.
- [ ] 1.2 [infra] Añadir `tsx` como devDependency y los targets `eval`, `eval-ci` (`cache: false`) y `record-fixtures` con `node --import tsx`, `TSX_TSCONFIG_PATH` y `cwd` en la raíz (D2), con un `cli/eval.ts` provisional (`main().catch`, sin top-level await) que imprime sus argumentos; verificar que `pnpm nx run ai:eval --task=x --provider=mock` los muestra exactamente, sin ningún `{args}` literal.
- [ ] 1.3 [infra] Añadir el bloque de lint de `libs/ai/src/evals/**` con la regla base `no-restricted-imports` (D1) y sus filas en el test tabular de `tools/workspace-rules`: import de `**/ai.module` y de `..` fallan, import de `../domain/task` pasa, e import de un SDK de IA desde `evals/` sigue fallando con la regla de SDKs; verificar que las filas positivas fallan si se quita el bloque y que `pnpm nx run-many -t lint` pasa.
- [ ] 1.4 [ai] Crear `evals/evaluable-task.ts`, `evals/golden.schema.ts` y el cargador JSONL con las validaciones de D4; verificar con "Golden set válido" (golden temporal), "Caso con input inválido" y "Casos con la misma clave de ejecución", más JSON mal formado, `id` duplicado y `expected` inválido.

## 2. Métricas

- [ ] 2.1 [ai] Implementar en `evals/metrics/` las métricas genéricas con su tipo (bloqueante o informativa) (D5); verificar con "Caso degradado" y p50 con número par e impar de casos.
- [ ] 2.2 [ai] Implementar `evals/classify-skills/metrics.ts` y registrar `classify-skills` en `evals/evaluable-tasks.ts` con su `expectedSchema` (D4, D5); verificar con "Recall y precision de classify-skills" y casos sin skills esperadas o no `success`.

## 3. Corredor

- [ ] 3.1 [ai] Implementar en `evals/runner/` los dobles propios (ledger en memoria, cuota permisiva, breaker nulo, logger a stderr) y la composición de `RunTask` de D3; verificar con tests unitarios de cada doble y que la composición con `AI_CHAIN=mock` construye un `RunTask` en replay sin leer `.env`.
- [ ] 3.2 [ai] Implementar la ejecución secuencial de casos con contexto por defecto, latencia, suma de registros del ledger por clave y resultado por caso, contando degradados y fallos de proveedor y propagando `AiProgrammingError`; verificar contra el mock en replay con fixtures temporales que un fixture ausente propaga el error con `id` y clave, y que un proveedor falso que falla se cuenta como degradado con sus dos registros.
- [ ] 3.3 [ai] Implementar el reporte Markdown de D6 con la advertencia de golden `placeholder`; verificar con un test sobre un resultado fijo (cabecera, tablas, advertencia) y que no contiene el texto de ningún input.
- [ ] 3.4 [ai] Implementar la línea base estricta de D5 (hash canónico del golden, versión de prompt, diferencia en ambos sentidos, línea base ausente, `--update-baseline`); verificar con "Sin regresión", "Regresión de recall", "Mejora sin actualizar la línea base", "Línea base ausente", "Golden set modificado" (incluido que convertir el golden a CRLF no cambia el hash) y "Actualización consciente de la línea base".
- [ ] 3.5 [ai] Implementar `cli/args.ts` y `cli/eval.ts` (`--task`, `--all`, `--provider`, `--update-baseline`, `--allow-external`, `--ollama-url`, `--timeout-ms`, `--evals-dir`, `--reports-dir`) y el registro de tareas para `--all`, con los códigos de D6; verificar con tests del parseo, "Tarea desconocida", "Proveedor externo sin permiso explícito" y "Coherencia entre registro y golden sets" sobre un `--evals-dir` temporal.
- [ ] 3.6 [ai] Test de humo del CLI con `spawn(process.execPath, ['--import', <URL absoluta de tsx>, ...])`, `TSX_TSCONFIG_PATH` absoluto, `--evals-dir`/`--reports-dir` temporales y entorno mínimo (`NODE_ENV=test`, sin `.env`); verificar código 0 con reporte escrito, código 1 con la línea base alterada y código 3 con un fixture ausente ("Fixture ausente en replay").
- [ ] 3.7 [ai] Verificar "Proveedor real no disponible": el CLI con `--provider=ollama --ollama-url` a un puerto cerrado cuenta los casos como degradados, escribe el reporte y termina con código 0.

## 4. Grabación

- [ ] 4.1 [ai] Implementar en `evals/recording/` la escritura de fixtures en `success` con `source`, `model` y `usage`, `--overwrite` y la lista de casos no grabados, con un upstream falso en memoria (D7); verificar con "Fixture existente" y "Respuesta inválida no se graba".
- [ ] 4.2 [ai] Verificar contra un servidor `node:http` local que imita Ollama "Grabar y reproducir".
- [ ] 4.3 [ai] Verificar contra un servidor local que imita OpenRouter "Upstream externo con datos personales" y "Upstream externo sin permiso explícito" (código 2).
- [ ] 4.4 [ai] Implementar `cli/record-fixtures.ts` (`--task`, `--upstream`, `--overwrite`, `--allow-external`, `--ollama-url`, `--timeout-ms`, `--evals-dir`) con rechazo en producción y códigos de D6, y cambiar en `parseAiConfig` el detalle del rechazo de `AI_MOCK_MODE=record` a "use nx run ai:record-fixtures"; verificar con "Grabación en producción" (código 2) en un proceso hijo y el test de configuración de `record`.

## 5. Datos de classify-skills

- [ ] 5.1 [ai] Escribir `evals/classify-skills/golden.jsonl` con los 5 casos placeholder de D4 (solo valores de contacto reservados); verificar que el cargador los valida y que "Coherencia entre registro y golden sets" pasa sobre el repo real.
- [ ] 5.2 [infra] Consultar si la app Ollama de escritorio (`127.0.0.1:11434`) ya tiene `qwen2.5:7b` y **pedir decisión humana**: usar la app o el contenedor en `OLLAMA_PORT=11435` con descarga de ~4.7 GB (D8); sin confirmación humana en la conversación, terminar con `APPLY: PAUSA (modelo)`. Verificar con `GET /api/tags` del Ollama elegido que el modelo está disponible.
- [ ] 5.3 [ai] Grabar los fixtures del golden con `nx run ai:record-fixtures --task=classify-skills --upstream=ollama --ollama-url=<elegida> --timeout-ms=300000`, aplicando la contingencia de D9 si algún caso falla; verificar que los 5 fixtures tienen `source` `recorded:ollama:qwen2.5:7b` y que el comando termina con código 0.
- [ ] 5.4 [ai] Ejecutar la corrida de referencia `nx run ai:eval --task=classify-skills --provider=ollama --ollama-url=<elegida>`, anotar sus métricas para la descripción del PR (D9) y escribir `baseline.json` con `--provider=mock --update-baseline`; verificar "Evaluación contra Ollama" en el reporte local y que `--provider=mock` sin `--update-baseline` termina con código 0.

## 6. CI y documentación

- [ ] 6.1 [infra] Tras 5.4, añadir a `.github/workflows/ci.yml` el step `pnpm nx affected -t eval-ci` después de `Test` con `NODE_ENV=test`, `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` (D10); verificar con actionlint, con `nx show projects --affected --files=libs/ai/src/index.ts -t eval-ci` (incluye `ai`) y `--files=apps/web/src/main.ts` (no), y ejecutando localmente `pnpm nx run ai:eval-ci` con ese entorno (código 0) y con la línea base alterada (código 1, restaurada después).
- [ ] 6.2 [infra] Actualizar `.claude/commands/lv/fixtures.md` al flujo de D11, CLAUDE.md (sección del módulo IA: grabación por comando), `docs/RUNBOOK.md` (menciones de `AI_MOCK_MODE=record`), `.env.example` (puerto alternativo de Ollama y promesa del modelo `:free`) y README (comandos `ai:eval` y `ai:record-fixtures`); verificar que no quedan referencias a `AI_MOCK_MODE=record` como forma de grabar y que los tests de configuración de api y worker pasan con `.env.example`.

## 7. Cierre

- [ ] 7.1 [infra] Ejecutar `pnpm nx affected -t lint,typecheck,test,build --base=main`, `pnpm nx run ai:eval-ci` con el entorno de CI y `pnpm exec openspec validate --all`; verificar que todo pasa en verde.
