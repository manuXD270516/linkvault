## Why

El grabador de fixtures y la auditoría de fixtures personales deciden si una tarea es `personal` comparando el campo
literal `task.dataSensitivity === 'personal'`, en lugar de usar `dataSensitivityOf(task)`
(`libs/ai/src/domain/task.ts`), que devuelve `personal` cuando la tarea no declara sensibilidad. El resto de `libs/ai`
(enrutado, `run-task`, registro de tareas) ya usa `dataSensitivityOf`. Consecuencia: una tarea que omitiera el campo, y
que por lo tanto es `personal` por defecto, podría grabarse contra un proveedor real (externo incluido) con datos
personales, escribirse a disco sin la comprobación de redacción y quedar fuera de la auditoría.

Hoy todas las tareas registradas declaran el campo, así que es un riesgo latente, no un incidente. Lo encontró el
crítico en el debate de `weekly-plan-llm` (W14). Es un `fix(ai)`: no hay decisiones de diseño, por eso el change va sin
`design.md`, sin ADR y sin fila en `docs/design-v0.2.md` §6.

## What Changes

- `libs/ai/src/evals/recording/record-fixtures.ts`: las dos comparaciones literales (rechazo del upstream no mock y
  comprobación de redacción antes de escribir) pasan a `dataSensitivityOf(task) === 'personal'`, y el error
  `PersonalTaskUpstreamRejected` recibe `dataSensitivityOf(task)` como sensibilidad (hoy recibiría `undefined` y el
  mensaje diría «is undefined»).
- `libs/ai/src/evals/recording/audit-personal-fixtures.ts`: el filtro de tareas auditadas pasa a
  `dataSensitivityOf(e.task) === 'personal'`.
- Spec `ai/deterministic-mock`: el requirement «Grabación de fixtures con un proveedor real» explicita que una tarea sin
  sensibilidad declarada es `personal` para el grabador y para la comprobación, con dos escenarios nuevos.

### Usos literales de `dataSensitivity` en `libs/ai` (relevamiento del 2026-11-25)

Comparaciones o lecturas con efecto fuera de `dataSensitivityOf` (las que este change corrige):

- `libs/ai/src/evals/recording/record-fixtures.ts:83` — `task.dataSensitivity === 'personal' && upstream !== 'mock'`.
- `libs/ai/src/evals/recording/record-fixtures.ts:86` — `task.dataSensitivity` como argumento de
  `PersonalTaskUpstreamRejected` (solo afecta al mensaje, pero se corrige junto con la línea 83).
- `libs/ai/src/evals/recording/record-fixtures.ts:136` — `task.dataSensitivity === 'personal'` antes de la
  comprobación de redacción.
- `libs/ai/src/evals/recording/audit-personal-fixtures.ts:41` — filtro del registro por `e.task.dataSensitivity === 'personal'`.

Usos literales sin efecto (no se tocan): las declaraciones de cada tarea en `libs/ai/src/tasks/*.task.ts`; el tipo
`Pick<…, 'dataSensitivity'>` de `externalOriginIssue` (`audit-personal-fixtures.ts:122`), que no lee el campo; los tipos
de `routing-policy.ts` y `provider-eligibility.ts`, que lo pasan a `dataSensitivityOf`; y los literales de los `*.spec.ts`,
que construyen tareas de prueba. Fuera de `libs/ai`, `apps/api/.../request-match-analysis.usecase.ts:138` solo copia el
campo de `matchCvTask` hacia la elegibilidad, que lo resuelve con `dataSensitivityOf`.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `ai/deterministic-mock`: «Grabación de fixtures con un proveedor real» trata como `personal` a la tarea sin
  sensibilidad declarada, tanto al grabar como en la comprobación de fixtures.

## Impact

- `libs/ai`: `evals/recording/record-fixtures.ts`, `evals/recording/audit-personal-fixtures.ts` y sus `*.spec.ts`.
- Sin cambios en `apps/**`, `libs/shared`, prompts, fixtures, línea base del eval, despliegue, CI ni variables de entorno.
- Sin ADR, sin fila en §6 y sin entrada en `openspec-changes.yaml`.
