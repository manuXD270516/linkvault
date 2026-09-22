## Context

El routing ya ordena `byok:` primero (`routing-policy.ts`). No existe `secret-vault.port` ni proveedores Anthropic/OpenAI. OpenRouter de plataforma usa `OPENROUTER_API_KEY` y modelos `:free` con `data_collection: "deny"` (ADR-029/030). Las cuotas cuentan todo `success` del ledger sin mirar el proveedor.

## Goals / Non-Goals

**Goals:** guardar claves cifradas, usarlas en `runTask`, UI de perfil con avisos honestos, no gastar cuota de plataforma en BYOK, no filtrar secretos.

**Non-goals:** facturación, picker de modelo, Anthropic/OpenAI de plataforma sin BYOK, exportar la clave, re-encrypt al rotar la vault key.

## Decisions (cerradas — humano + reflect)

### D1 — Almacén

Colección Mongo `user_ai_keys`, índice único `(userId, vendor)`. Puerto + implementación en **`libs/ai`** (compartida por api y worker). HTTP thin en el módulo users de api.

### D2 — Cifrado

libsodium `crypto_secretbox_easy` con `AI_VAULT_KEY` (32 bytes, base64). Descifrado solo al construir el provider de esa ejecución.

### D3 — Modelos (**1A**)

`BYOK_ANTHROPIC_MODEL`, `BYOK_OPENAI_MODEL`, `BYOK_OPENROUTER_MODEL`. Sin picker.

### D4 — `AI_VAULT_KEY` (**2A**)

Obligatoria en **producción** al arrancar api y worker. Fuera de prod: sin vault → `PUT` responde `503 vault_unavailable`; GET vacío OK.

### D5 — Consentimiento vs claves (**3A**)

Revocar consent **no** borra claves. Borrar cuenta borra `user_ai_keys` en la **misma txn** vía puerto (cuando exista delete-account); hasta entonces solo el puerto + test de repo, **sin** EventEmitter.

### D6 — OpenRouter BYOK (**4C**)

`:free` → `data_collection: "deny"`; sin `:free` → no forzar. `OpenRouterProvider` acepta `id` y `dataCollection: 'deny' | 'omit'`.

### D7 — Cuota ledger (**B** + endurecido reflect)

- Conteo de `AI_QUOTAS`: solo `success` con `providerId` que **no** empiece por `byok:`.
- Si conteo ≥ límite **y** hay ≥1 BYOK elegible: la cadena de esa ejecución SHALL ser **solo** `byok:*` (sin fallback a plataforma). Si no hay BYOK → `quota_exceeded`.
- **`MATCH_ANALYSES_PER_USER` no se exime** por BYOK (cuota de producto distinta).

### D8 — Universo de proveedores

Universo efectivo = proveedores de `AI_CHAIN` ∪ `byok:<ctx.userId>:*` del vault. BYOK no se lista en `AI_CHAIN`. Spec `provider-routing` **MODIFIED**.

### D9 — HTTP

`GET/PUT/DELETE /api/users/me/ai-keys…` como antes. `apiKey` min length 16.

### D10 — Redactor

Paths: `apiKey`, `authorization`, `AI_VAULT_KEY`, `ciphertext`, `vaultKey` (api y worker).

### D11 — Vigencia `quota_exceeded` en match (reflect / P0)

Un degradado por `quota_exceeded` **NO** se considera vigente si, en el momento del POST, hay ≥1 BYOK elegible (consent vigente + clave descifrable + caps). Así “Reintentar” / nuevo POST no queda bloqueado tras pegar una clave. `ProviderEligibility` SHALL poder considerar BYOK del `userId` sin ejecutar la tarea.

### D12 — UI avisos (V0 business)

En `/perfil`, junto al formulario BYOK: aviso que nombra el vendor y que, con consentimiento, el CV puede salir ahí (y si OpenRouter no-`:free`, sin `data_collection: deny` de LinkVault). Con hint + consentimiento off: copy de que las claves siguen guardadas pero **no se usan**.

## Risks / Trade-offs

| Riesgo | Mitigación |
|---|---|
| Rotación vault | RUNBOOK: revocar y re-pegar |
| BYOK caído con cuota ok | Cadena normal (plataforma); con cuota agotada solo BYOK |
| Circuit breaker por userId | Documentar en RUNBOOK; opcional agregar por vendor después |

## Migration

Colección nueva. `.env.example` + RUNBOOK + **ADR-032**.

## CONVERGENCIA (reflect)

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| P0-chain | critic | Aceptado → D8 | Spec base contradecía BYOK |
| P0-quota-count | critic | Aceptado → D7 | |
| P0-no-platform-fallback | critic | Aceptado → D7 | |
| P0-match-vigencia | critic | Aceptado → D11 | |
| P0-wiring | critic | Aceptado → D1 libs/ai | |
| P0-task-execution | critic it2 | Aceptado → MODIFIED task-execution | Alineado a D7 |
| P0-consentWouldEnable | critic it2 | Aceptado → MODIFIED filtrado | Universo efectivo |
| V0-aviso | business | Aceptado → D12 + escenarios (incl. OpenRouter no-free) | |
| V0-copy-consent | business | Aceptado → D12 | |
| P1-* relevantes | critic | Aceptados/adaptados en D5–D10 | Ver ADR-032 |

**P0 abiertos: 0 · V0 abiertos: 0**
