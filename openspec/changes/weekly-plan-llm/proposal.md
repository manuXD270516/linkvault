## Why

«Tu semana» (`weekly-plan`, ADR-068) elige como mucho 3 acciones con reglas fijas: una candidata por postulación, la
de la primera regla que cumple, y turnos de una por regla. Eso pierde las señales secundarias —una oferta que cierra
en 5 días, encaja 85/100 y tiene dos contactos en el grupo compite como cualquier cierre— y no sabe preferir una
postulación quieta hace 40 días a un contacto de poca monta. El panel multiagente del 2026-11-25 dejó diseñado el corte
2: un LLM que **solo elige** entre las candidatas que ya calcularon las reglas, con un enum cerrado, validación
determinista, tope en código y degradación honesta. Este change lo especifica sobre lo que ya está en `main`.

## What Changes

- **`LlmWeeklyPlanner` detrás del puerto `WeeklyPlanner`**, que gana un contexto `{ userId, mayStartRun }` fuera de la
  entrada canónica. Con más de 3 candidatas visibles, elige 3 por `runTask('plan-week')` entre hasta 9 (ids
  sintéticos `c1…cN` en orden de reglas); lo urgente (cierra hoy o mañana) va siempre primero y los huecos se llenan
  por reglas. `planner` del contrato pasa a `'rules' | 'llm'`.
- **On-read con espera corta**: el `GET` espera la ejecución 2,5 s y, si no llega, responde por reglas mientras la
  ejecución termina y se guarda. El `POST` de decisiones nunca ejecuta.
- **Tope en código**: 1 ejecución por persona y semana y 20 por día en total, con `$inc` condicionado en Mongo;
  independiente de `AI_QUOTAS`. Colecciones `weekly_plan_llm_picks` (TTL 35 días) y `weekly_plan_llm_budget` (TTL 3).
- **Entrada sin nada que identifique**: regla, estado y enteros relativos; sin fechas, ids reales, títulos ni texto.
  La tarea es `public` y el llamador exige el consentimiento de proveedores externos.
- **`libs/ai`**: `AiTask.outputSchemaFor(input)` (enum cerrado por petición en la validación, la reparación y el
  siguiente proveedor), tarea `plan-week` con prompt `v1`, golden sintético, métricas `valid_pick_rate`,
  `must_include_rate` y `rules_agreement`, fixtures del mock y línea base.
- **Atribución**: cada decisión guarda `source: 'llm' | 'rules'` para medir si el LLM vale la pena.
- **SPA**: aviso «Elegidas con IA entre tus sugerencias de la semana.» con `planner` `llm`; los motivos siguen siendo
  i18n.
- **Flag `FEATURE_WEEKLY_PLAN_LLM`**, opcional y apagado por defecto. Borrado de cuenta: la cascada elimina las
  elecciones.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `applications/weekly-plan`: el plan admite `planner` `llm`; selección con LLM, tope de ejecuciones, entrada canónica
  y atribución de decisiones.
- `web/weekly-plan`: aviso de selección con IA.
- `users/account-deletion`: la cascada borra `weekly_plan_llm_picks`.
- `ai/task-execution`: schema de salida por petición y tarea `plan-week`.
- `ai/eval-harness`: calidad de la selección del plan semanal.

## Impact

- `apps/api`: `applications` (dominio `weekly-plan/`, `LlmWeeklyPlanner`, dos puertos, adaptador Mongo, adaptador de
  `runTask`, `source` en decisiones, cableado con `RUN_TASK`), `users` (cascada), configuración (flag opcional).
- `libs/ai`: `domain/task.ts`, `run-task.usecase.ts`, `task-registry.ts`, `tasks/plan-week.task.ts`, prompt,
  `evals/plan-week/`, fixtures, `KNOWN_TASK_NAMES`, exportaciones del índice.
- `libs/shared`: `weekly-plan.schema.ts` (`planner`, constante, validador).
- `apps/web`: tarjeta «Tu semana» y catálogo i18n.
- `docs/RUNBOOK.md`, `.env.example`. Sin cambios de compose, CI, despliegue ni worker. ADR nuevo: **ADR-071**.
- **Dependencia del owner**: los fixtures reales se graban con su clave (tarea 2.7); el resto se implementa y prueba con
  el mock. **Plan**: fila 41 **candidata** en `docs/design-v0.2.md` §6; no está en `openspec-changes.yaml`; no altera la
  precedencia de la fila 35 y no se fusiona sin ventana del owner.
