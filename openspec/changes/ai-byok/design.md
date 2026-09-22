## Context

El routing ya ordena `byok:` primero (`routing-policy.ts`). No existe `secret-vault.port` ni proveedores Anthropic/OpenAI. OpenRouter de plataforma usa `OPENROUTER_API_KEY` y modelos `:free` con `data_collection: "deny"` (ADR-029/030). Las cuotas cuentan todo `success` del ledger sin mirar el proveedor.

## Goals / Non-Goals

**Goals:** guardar claves cifradas, usarlas en `runTask`, UI de perfil, no gastar cuota de plataforma, no filtrar secretos.

**Non-goals:** facturación, elección de modelo en UI, proveedores de plataforma Anthropic/OpenAI sin BYOK, exportar la clave, re-encrypt al rotar la vault key.

## Decisions (cerradas)

### D1 — Almacén

Colección Mongo `user_ai_keys` con índice único `(userId, vendor)`. Campos: `ciphertext`, `nonce`, `keyHint` (4 chars), `createdAt`, `updatedAt`. No embebido en `users`.

### D2 — Cifrado

libsodium `crypto_secretbox_easy` con `AI_VAULT_KEY` (32 bytes, base64 en env). Descifrado solo al construir el `LlmProvider` para esa ejecución; la clave en claro no se cachea en Redis.

### D3 — Modelos (**A**)

Modelos fijos por env: `BYOK_ANTHROPIC_MODEL`, `BYOK_OPENAI_MODEL`, `BYOK_OPENROUTER_MODEL`. Sin picker en MVP.

### D4 — Arranque de `AI_VAULT_KEY` (**A**)

En **producción** (`NODE_ENV=production`) `AI_VAULT_KEY` es **obligatoria** al arrancar api y worker (parse config falla si falta o no decodifica a 32 bytes). En desarrollo local: valor de ejemplo en `.env.example`. Rotación = revocar claves de usuario y volver a pegar (sin re-encrypt).

### D5 — Consentimiento vs claves (**A**)

Revocar `aiConsent` **no** borra las claves; solo impide elegir proveedores `external` (incluidos `byok:*`). Borrar cuenta sí borra `user_ai_keys`.

### D6 — OpenRouter BYOK (**C** híbrido)

- Si `BYOK_OPENROUTER_MODEL` termina en `:free`, el provider BYOK **SHALL** enviar `provider: { data_collection: "deny" }` (misma política que la OpenRouter de plataforma).
- Si el modelo **no** termina en `:free`, **NO** se fuerza `:free` ni `data_collection: deny`: aplica el contrato del usuario con OpenRouter.
- Anthropic/OpenAI BYOK no usan ese header (APIs propias).
- El consentimiento externo sigue siendo requisito para cualquier `byok:*`.

Implementación: parametrizar `OpenRouterProvider` (o un wrapper BYOK) con `dataCollection: 'deny' | 'omit'` según el sufijo del modelo, en lugar de hardcodear siempre `deny`.

### D7 — Cuota (**B**)

Contar solo `success` cuyo `providerId` **no** empieza por `byok:`. Si ese conteo ≥ límite y hay BYOK elegible (consent + clave + capabilities), la ejecución continúa; si no hay BYOK, `quota_exceeded`.

### D8 — Inyección en registry

`buildProviders` sigue leyendo `AI_CHAIN` de plataforma. `ByokProviderFactory.resolve(userId)` añade 0–3 providers al frente. No van en `AI_CHAIN`.

### D9 — HTTP

- `GET /api/users/me/ai-keys` → `[{ vendor, keyHint, updatedAt }]`
- `PUT /api/users/me/ai-keys/:vendor` body `{ apiKey: string }`
- `DELETE /api/users/me/ai-keys/:vendor`

Fuera de `PATCH /users/me`.

### D10 — Redactor

Redactor pino para `apiKey`, `authorization`, `AI_VAULT_KEY`, ciphertext.

## Risks / Trade-offs

| Riesgo | Mitigación |
|---|---|
| Rotación de `AI_VAULT_KEY` deja claves ilegibles | RUNBOOK: revocar y volver a pegar |
| Modelo OpenRouter de pago sin `data_collection` | Decisión C consciente; consentimiento + aviso en UI |
| Clave mala / vendor caído | `provider_error` → siguiente en cadena |
| Worker sin la misma vault key | Misma env que api; prod no arranca sin ella |

## Migration

Ninguna. Colección nueva. `.env.example` + RUNBOOK + ADR-032.

## CONVERGENCIA

Decisiones humanas 1A / 2A / 3A / 4C aplicadas. Pendiente debate critic/business antes de apply.
