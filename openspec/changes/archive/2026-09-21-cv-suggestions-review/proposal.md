## Why

El análisis de encaje ya llega a pantalla, pero las sugerencias salen de un solo paso y la espera solo se ve preguntando. Este change sube la calidad de lo que vuelve —un juez acotado y feedback «no me convence»— y avisa el progreso en vivo, sin reabrir la privacidad que `cv-match-suggestions` ya cerró (ADR-029, ADR-030 §9).

## What Changes

- Tarea `critique-suggestions` y **como máximo una** crítica más **como máximo una** revisión del informe. Para si el score del juez es ≥ 0.8 o si el `score` entero del informe no sube al menos 1 punto. Si hay dos proveedores elegibles, el juez no es el mismo que el generador. El informe guarda `judgeScore` y `judgeModel` de la iteración elegida.
- El input del juez es la oferta y un informe **sin** `cvFragment` ni `before`; los `after` van con marcadores, sin PII reinyectada.
- Pasos nuevos visibles: `critiquing-suggestions` y `revising-suggestions`, con rótulos en el diálogo.
- Feedback «no me convence» por sugerencia (`ai_feedback`, con índice + hash de `after`) y export a `candidates.jsonl` sin entrar solo al golden.
- Aviso `analysis.step` por SSE **además** del sondeo (el sondeo sigue siendo suficiente si el canal cae): solo al dueño, sin CV ni informe.
- Métricas del eval: correlación del `score` con etiquetas 1–5 y coste por vuelta.
- **No** hay aceptar/rechazar diff en este change: Copiar y «no me convence» bastan (el diff sin rastro era un gesto vacío).

## Capabilities

### New Capabilities

- `cv/suggestion-feedback`: marcar «no me convence» y exportar candidatos sin meterlos solos al golden.

### Modified Capabilities

- `cv/match`: bucle de una vuelta, pasos nuevos, `judgeScore`/`judgeModel`, hasta tres envíos del CV redactado en una ejecución; cuota de análisis sigue siendo uno.
- `web/cv-match`: pasos nuevos + SSE opcional encima del sondeo; acción «no me convence» junto a Copiar. Aceptar/rechazar **no** entra.
- `platform/realtime`: `analysis.step` solo al dueño, payload cerrado.
- `ai/task-execution`: tarea `critique-suggestions`, no cacheable.
- `ai/eval-harness`: correlación y coste por vuelta.

## Impact

- `libs/ai`, `apps/worker`, `apps/api`, `apps/web` como en el diseño.
- Enmienda documentada en ADR-031 (envíos del CV en una ejecución).
- Privacidad: el juez no ve texto de CV reinyectado; el SSE no es canal nuevo de PII.
