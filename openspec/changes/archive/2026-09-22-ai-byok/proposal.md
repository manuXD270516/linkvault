## Why

Hoy la cadena de IA depende de Ollama local y del free tier de OpenRouter. Quien ya paga Anthropic/OpenAI/OpenRouter quiere usar **su** clave para modelos frontera sin que LinkVault asuma el costo. El routing ya prioriza ids `byok:*` (ADR-014 / ADR-018 §8); falta el vault, la API de gestión y los proveedores reales.

## What Changes

- Vault libsodium `secretbox` con `AI_VAULT_KEY`: cifrar/descifrar solo en memoria del proceso que ejecuta `runTask` (api o worker). En **producción** la clave es obligatoria al arrancar.
- Colección `user_ai_keys`: una fila por `(userId, vendor)` ∈ {`anthropic`,`openai`,`openrouter`}; ciphertext + nonce + `keyHint` (últimos 4) + timestamps. Nunca plaintext en DB ni en respuestas HTTP.
- HTTP autenticado: listar vendors configurados (hints), upsert clave, revocar. Cascada al borrar cuenta. Revocar consentimiento **no** borra las claves.
- Proveedores `AnthropicProvider` y `OpenAIProvider`; OpenRouter BYOK reutiliza el existente con clave del usuario. Ids `byok:<userId>:<vendor>`, `external: true`, prioridad 0. Modelos fijos por env (`BYOK_*_MODEL`).
- OpenRouter BYOK **híbrido**: si el modelo termina en `:free`, se envía `data_collection: "deny"` (igual que la plataforma); si no, no se fuerza esa política (contrato del usuario con OpenRouter).
- Al ejecutar `runTask` con `userId`, se inyectan los BYOK elegibles delante de la cadena de plataforma; consentimiento externo sigue aplicando.
- Cuota de plataforma: solo cuentan `success` cuyo `providerId` **no** empieza por `byok:`; con cuota de plataforma agotada aún se permite la ejecución si hay BYOK elegible.
- Redactor pino: nunca loguear `apiKey` / `authorization` / ciphertext descifrado.
- SPA `/perfil`: sección de claves BYOK (añadir / rotar / revocar) con aviso de que el CV puede salir a ese vendor si hay consentimiento.

## Capabilities

### New Capabilities

- `ai/byok`: vault, persistencia, HTTP de gestión, inyección de proveedores `byok:*`, exención de cuota de plataforma.
- `web/byok`: UI de claves en perfil.

### Modified Capabilities

- `ai/provider-routing`: universo `AI_CHAIN` ∪ BYOK; `consentWouldEnable` sobre universo efectivo.
- `ai/usage-accounting` + `ai/task-execution`: cuota no-BYOK; cadena solo BYOK si tope; `quota_exceeded` solo sin BYOK.
- `cv/match`: vigencia de degradado por cuota cede si hay BYOK elegible.
- `ai/data-protection`: secretos BYOK fuera de logs.
- Borrado de cuenta: cascada de claves (puerto en libs/ai).

## Impact

- `libs/ai`, `libs/shared`, `apps/api`, `apps/worker`, `apps/web`.
- ADRs: **014**, **018**, **029/030** (OpenRouter plataforma); **ADR-032** (este change).
- **Fuera de alcance:** picker de modelo en UI; marketplace; compartir claves; cifrado client-side; Anthropic/OpenAI de plataforma sin BYOK; re-encrypt al rotar `AI_VAULT_KEY`.

## Decisions locked (humano + reflect)

1. Modelos por env — **A**
2. `AI_VAULT_KEY` obligatoria en prod — **A**
3. Revocar consentimiento deja claves — **A**
4. OpenRouter BYOK híbrido — **C**
5. Reflect: cadena solo BYOK si cuota plataforma agotada; vigencia match; vault en `libs/ai`; avisos UI (ver design D7–D12 / ADR-032)
