## Context

El routing ya ordena `byok:` primero (`routing-policy.ts`). No existe `secret-vault.port` ni proveedores Anthropic/OpenAI. OpenRouter de plataforma usa `OPENROUTER_API_KEY` y modelos `:free` (ADR-029/030). Las cuotas cuentan todo `success` del ledger sin mirar el proveedor.

## Goals / Non-Goals

**Goals:** guardar claves cifradas, usarlas en `runTask`, UI de perfil, no gastar cuota de plataforma, no filtrar secretos.

**Non-goals:** facturación, elección rica de modelos en UI (MVP: modelo por env), proveedores de plataforma Anthropic/OpenAI sin BYOK, exportar la clave.

## Decisions (provisionales — debate)

### D1 — Almacén

Colección Mongo `user_ai_keys` con índice único `(userId, vendor)`. Campos: `ciphertext`, `nonce`, `keyHint` (4 chars), `createdAt`, `updatedAt`. No va embebido en `users` para no hinchar el perfil ni mezclar con PATCH de perfil.

### D2 — Cifrado

libsodium `crypto_secretbox_easy` con `AI_VAULT_KEY` (32 bytes, base64 en env). Descifrado solo al construir el `LlmProvider` para esa ejecución; la clave en claro vive el tiempo del `complete()` y no se cachea en Redis.

### D3 — Modelos (provisional A)

Modelos fijos por env: `BYOK_ANTHROPIC_MODEL`, `BYOK_OPENAI_MODEL`, `BYOK_OPENROUTER_MODEL` (defaults sensatos en `.env.example`). Sin picker de modelo en MVP.

### D4 — Arranque de `AI_VAULT_KEY` (provisional A)

Obligatoria si `FEATURE_BYOK=true` (default true en no-prod cuando se implemente; en prod explícita). Sin feature flag, validar la clave al primer upsert o al cargar BYOK en `runTask`. Preferencia del debate: **obligatoria siempre** en prod para no desplegar a medias.

### D5 — Consentimiento vs claves (provisional A)

Revocar `aiConsent` **no** borra las claves; solo impide elegir proveedores `external` (incluidos `byok:*`). Borrar cuenta sí borra `user_ai_keys`.

### D6 — OpenRouter BYOK (provisional A)

Con clave del usuario **no** se fuerza `:free` ni `data_collection: deny` de la plataforma: es su contrato con OpenRouter. El consentimiento externo sigue siendo requisito.

### D7 — Cuota

`ConfigQuotaPolicy` (o capa en `runTask`) excluye del conteo los `success` cuyo `providerId` empieza por `byok:`. Los `success` de plataforma siguen contando. BYOK no “salta” el chequeo previo si el usuario ya agotó cuota **solo con plataforma** — si solo tiene BYOK y cuota agotada por usos previos de plataforma, ¿puede usar BYOK?

**Provisional A:** el chequeo de cuota **antes** de la cadena se salta si el usuario tiene al menos un BYOK usable (consent + clave) para la tarea; si no, aplica cuota normal. Alternativa B: cuota siempre se aplica al conteo no-BYOK y BYOK siempre permitido.

Preferencia: **B** (más simple y alineada a “BYOK no consume cuota”): contar solo success no-BYOK; si ese conteo ≥ límite, aún se permite la ejecución si hay BYOK elegible; si no hay BYOK, `quota_exceeded`.

### D8 — Inyección en registry

`buildProviders` sigue leyendo `AI_CHAIN` de plataforma. Un `ByokProviderFactory.resolve(userId)` añade 0–3 providers al frente de la lista pasada a `runTask` (o `RunTaskUseCase` los concatena). No van en `AI_CHAIN`.

### D9 — HTTP

- `GET /api/users/me/ai-keys` → `[{ vendor, keyHint, updatedAt }]`
- `PUT /api/users/me/ai-keys/:vendor` body `{ apiKey: string }` (min length)
- `DELETE /api/users/me/ai-keys/:vendor`

Fuera de `PATCH /users/me` para no mezclar secretos con perfil.

### D10 — Redactor

Extender redactor pino existente (o añadir) para claves `apiKey`, `authorization`, `AI_VAULT_KEY`, ciphertext.

## Risks / Trade-offs

| Riesgo | Mitigación |
|---|---|
| Rotación de `AI_VAULT_KEY` deja claves ilegibles | Documentar: revocar todas y volver a pegar; sin re-encrypt MVP |
| Clave mala / vendor caído | `provider_error` → siguiente en cadena (plataforma) |
| UI guarda clave en telemetría | Solo `keyHint` en respuestas; inputs type=password |
| Worker sin `AI_VAULT_KEY` | Misma env que api; health falla o BYOK se omite con log warn |

## Migration

Ninguna. Colección nueva. `.env.example` + RUNBOOK §6 (operar BYOK).

## Open questions

Ver `proposal.md`. Cerrar en debate critic/business antes de `/opsx:apply`.
