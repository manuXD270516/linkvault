## Why

Hoy la cadena de IA depende de Ollama local y del free tier de OpenRouter. Quien ya paga Anthropic/OpenAI/OpenRouter quiere usar **su** clave para modelos frontera sin que LinkVault asuma el costo. El routing ya prioriza ids `byok:*` (ADR-014 / ADR-018 §8); falta el vault, la API de gestión y los proveedores reales.

## What Changes

- Vault libsodium `secretbox` con `AI_VAULT_KEY`: cifrar/descifrar solo en memoria del proceso que ejecuta `runTask` (api o worker).
- Colección `user_ai_keys`: una fila por `(userId, vendor)` ∈ {`anthropic`,`openai`,`openrouter`}; ciphertext + nonce + `keyHint` (últimos 4) + timestamps. Nunca plaintext en DB ni en respuestas HTTP.
- HTTP autenticado: listar vendors configurados (hints), upsert clave, revocar. Cascada al borrar cuenta.
- Proveedores `AnthropicProvider` y `OpenAIProvider` en `libs/ai/infrastructure/providers`; OpenRouter reutiliza el existente con clave del usuario. Ids `byok:<userId>:<vendor>`, `external: true`, prioridad 0 en routing.
- Al ejecutar `runTask` con `userId`, el registry inyecta los BYOK elegibles del dueño **antes** de la cadena de plataforma; consentimiento externo sigue aplicando.
- Cuota de plataforma: un `success` cuyo `providerId` empieza por `byok:` **no** cuenta contra `AI_QUOTAS` (el costo es del usuario). El ledger sí registra el intento.
- Redactor pino: nunca loguear `apiKey` / `authorization` / ciphertext descifrado.
- SPA `/perfil`: sección de claves BYOK (añadir / rotar / revocar) con aviso de que el CV puede salir a ese vendor si hay consentimiento.

## Capabilities

### New Capabilities

- `ai/byok`: vault, persistencia, HTTP de gestión, inyección de proveedores `byok:*`, exención de cuota de plataforma.
- `web/byok`: UI de claves en perfil.

### Modified Capabilities

- `ai/provider-routing`: escenarios BYOK reales (no solo orden teórico).
- `ai/usage-accounting`: success vía BYOK no consume cuota de plataforma.
- `users/profile` / borrado de cuenta: cascada de claves (si el borrado ya está en deploy-prod, documentar el hook aquí).
- `ai/data-protection`: claves de usuario como secreto (nunca en logs ni respuestas).

## Impact

- `libs/ai`, `libs/shared`, `apps/api`, `apps/worker`, `apps/web`.
- ADRs: **014** (BYOK), **018** (orden cadena / cuotas), consentimiento externo existente.
- Nuevo ADR si hace falta concretar modelo por vendor, forma de `AI_VAULT_KEY` y colección.
- **Fuera de alcance:** BYOK como único proveedor de plataforma; marketplace de modelos; compartir claves entre usuarios; cifrado client-side; Anthropic/OpenAI de plataforma sin BYOK.

## Open questions (para debate / aprobación)

1. ¿Modelos por vendor fijos en env (`BYOK_ANTHROPIC_MODEL`, …) o el usuario elige modelo al guardar la clave?
2. ¿`AI_VAULT_KEY` obligatoria siempre al arrancar, o solo si existe al menos una clave / `FEATURE_BYOK=true`?
3. ¿Revocar consentimiento externo deja las claves cifradas o las borra?
4. ¿OpenRouter BYOK permite cualquier modelo o solo los que el usuario pague (sin forzar `:free` / `data_collection`)?
