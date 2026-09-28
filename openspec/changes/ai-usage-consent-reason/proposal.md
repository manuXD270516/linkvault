## Why

Al recorrer el camino crítico de `e2e-suite` (paso 7 con `--match-expectation consent-required`, rama `change/e2e-suite`,
2026-09-28) el worker registró `AI usage ledger write failed (ValidationError)` en cada análisis de match degradado por
falta de consentimiento para IA externa, y la fila de uso se perdió.

La causa es que el schema de Mongoose de la colección `ai_usage`
(`libs/ai/src/infrastructure/persistence/ai-usage.schema.ts`) mantiene su propia lista de motivos
(`no_providers`, `providers_failed`, `quota_exceeded`) mientras que el tipo de dominio `DegradedReason`
(`libs/ai/src/domain/ai-result.ts`) tiene cuatro desde `cv-match-suggestions` (ADR-030 §3): falta `consent_required`.
`runTask` y `embedTexts` registran un `degraded` con ese motivo cuando la cadena queda vacía y el consentimiento la
habilitaría, así que el `enum` del schema rechaza la escritura. Como el registro no es bloqueante (ADR-018 §10), el
resultado al usuario es correcto, pero el ledger deja de contar justo las degradaciones que la persona puede arreglar.

El fallo es de duplicación: dos listas que nadie obliga a coincidir. Lo mismo vale para los `outcome`.

## What Changes

- **Una sola lista de motivos**: `libs/ai/src/domain/ai-result.ts` exporta `DEGRADED_REASONS` (constante `as const`) y
  `DegradedReason` pasa a derivarse de ella. Es un array de literales, sin dependencias: `domain/` sigue sin importar
  frameworks.
- **Una sola lista de outcomes**: `libs/ai/src/domain/ports/usage-ledger.port.ts` exporta `USAGE_OUTCOMES` y
  `UsageOutcome` se deriva de ella.
- **El schema usa esas constantes**: `ai-usage.schema.ts` elimina sus listas locales y declara
  `enum: DEGRADED_REASONS` y `enum: USAGE_OUTCOMES`. Añadir un motivo o un outcome al dominio lo acepta el almacén sin
  otro cambio.
- **Tests**: `mongo-usage-ledger.spec.ts` (MongoMemoryReplSet de `@linkvault/testing`) escribe un `degraded` por cada
  motivo de `DEGRADED_REASONS` y un registro por cada outcome de `USAGE_OUTCOMES`, y comprueba que el documento se
  guarda con ese valor. El caso `consent_required` falla antes del arreglo con `ValidationError`.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `ai/usage-accounting`: "Registro de cada intento" nombra los motivos de un `degraded` (`no_providers`,
  `providers_failed`, `consent_required`) y exige que el ledger acepte cualquier motivo de degradación que
  `runTask`/`embedTexts` puedan devolver, con un escenario nuevo para la falta de consentimiento.

## Impact

- **Código**: `libs/ai/src/domain/ai-result.ts`, `libs/ai/src/domain/ports/usage-ledger.port.ts`,
  `libs/ai/src/infrastructure/persistence/ai-usage.schema.ts` y `mongo-usage-ledger.spec.ts`.
- **API, datos, eventos**: sin cambios de contrato. Los documentos existentes siguen siendo válidos (la lista solo
  crece). No hay migración: las filas perdidas antes del arreglo no se recuperan.
- **`libs/shared`**: `MATCH_DEGRADED_REASONS` es el contrato del informe de match y se queda donde está; `libs/ai` no
  depende de él para su dominio. Hoy ambas listas coinciden.
- **ADRs**: coherente con ADR-018 §10 (registro no bloqueante) y ADR-030 §3 (cuatro motivos). La decisión es local y no
  crea ADR nuevo.
- **Fuera de alcance**: el código `ai_consent_required` de ADR-023 para `api` y cualquier cambio en cómo se decide la
  degradación.
