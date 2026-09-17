## Why

`ai-gateway-core` dejó la IA funcionando, pero sin forma de saber si un cambio de prompt, de modelo o de proveedor la empeora
(Critic C6 de design-v0.2: "extender a modelos frontera es un salto de fe" sin golden set ni métricas). También dejó sin
resolver la grabación de fixtures con un proveedor real (ADR-018 §5), que `/lv:fixtures` necesita. Hacerlo ahora, antes de
`extract-job` y `match-cv`, permite que esas tareas nazcan con su golden set, sus métricas y su línea base.

## What Changes

- **Tareas evaluables registradas**, cada una con schema de `expected` y métricas propias agregadas sobre todo el conjunto;
  `classify-skills` es la primera, con `skills_recall` y `skills_precision`.
- **Golden sets versionados** en `libs/ai/src/evals/<task>/golden.jsonl` (`{ id, input, expected, tags, outputLanguage? }`),
  validados al cargar. Para `classify-skills`: 5 avisos de empleo sintéticos anonimizados (ES y EN), marcados `placeholder`,
  solo con valores de contacto reservados (`@example.com`, números ficticios).
- **Corredor `nx run ai:eval --task=<t>|--all --provider=<mock|ollama|openrouter>`** fuera de Vitest: ejecuta cada caso con
  `runTask` en secuencia, calcula métricas genéricas (`schema_validity_rate`, `degraded_rate`, `latency_p50`, `cost_per_run`) y
  de la tarea, y escribe un reporte Markdown en `reports/eval/` que avisa cuando el golden es `placeholder`.
- **Línea base estricta** en replay por tarea, con hash del golden y versión de prompt: cualquier diferencia en una métrica
  bloqueante (empeora o mejora) falla; `--update-baseline` la reescribe a propósito. Códigos de salida definidos.
- **Grabación de fixtures** con `nx run ai:record-fixtures`: `runTask` contra el proveedor real, solo salidas válidas, redacción
  hacia externos, fixture con proveedor y modelo, casos del golden. Proveedores externos solo con `--allow-external`.
- **Grabación con Ollama** (`qwen2.5:7b`) de los fixtures del golden, con confirmación humana previa para el modelo; la corrida
  de referencia se resume en el PR, no se versiona.
- **CI**: target `ai:eval-ci` ejecutado por afectación tras los tests; falla ante regresión de pipeline.
- **Documentación y automatización**: `/lv:fixtures` usa la grabación por comando; `/lv:golden` corrige rutas y `/lv:run` deja
  de lanzarlo en este change (pasa a `link-enrichment`); CLAUDE.md, RUNBOOK, README y `.env.example` describen la grabación como
  comando y el puerto alternativo de Ollama.

## Capabilities

### New Capabilities
- `ai/eval-harness`: tareas evaluables, golden sets, corredor, métricas genéricas y por tarea, reporte, línea base estricta y
  códigos de salida.

### Modified Capabilities
- `ai/deterministic-mock`: se añade la grabación de fixtures por comando. Los requisitos existentes no cambian: las
  aplicaciones siguen rechazando `AI_MOCK_MODE=record`.
- `platform/ci-pipeline`: se añade la etapa de evaluación de IA en replay por afectación.

## Impact

- **Código**: `libs/ai/src/evals/**`, ajuste de `parseAiConfig` (detalle del rechazo de `record`), targets `eval`, `eval-ci`
  y `record-fixtures`, bloque de lint para `evals/`.
- **Fixtures**: nuevos fixtures grabados del golden; los fixtures escritos a mano de los tests no cambian.
- **CI**: `.github/workflows/ci.yml` con `nx affected -t eval-ci`.
- **Configuración y docs**: `.env.example`, README, CLAUDE.md (sección del módulo IA), `docs/RUNBOOK.md`,
  `.claude/commands/lv/{fixtures,golden,run}.md`.
- **Dependencias**: `tsx` como devDependency.
- **Datos y red**: posible descarga de `qwen2.5:7b` (~4.7 GB), solo con confirmación humana y solo si ningún Ollama local lo tiene.
- **ADRs**: implementa §4.11 de design-v0.2; **ADR-019** modifica ADR-014 y cierra ADR-018 §5.
- **Diferido**: métricas de redacción a `cv-match-suggestions`; golden real de `extract-job` y registro de fixtures pendientes
  desde los tests a `link-enrichment` (todo en el
  manifiesto).
- **Fuera de alcance**: tareas `extract-job` y `match-cv`, `field_accuracy`, correlación de `score`, `candidates.jsonl`, vacantes
  reales (`/lv:golden`) y modelo `:free` de OpenRouter (requiere clave).
