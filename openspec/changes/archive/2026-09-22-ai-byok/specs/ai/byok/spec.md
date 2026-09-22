## Purpose

Permite a cada persona guardar claves de Anthropic, OpenAI u OpenRouter cifradas en el servidor, usarlas como proveedores `byok:*` en `runTask` con prioridad sobre la cadena de plataforma, y revocarlas sin que el secreto salga nunca en claro por HTTP ni por logs.

## ADDED Requirements

### Requirement: Guardar y revocar una clave por vendor

Una persona autenticada SHALL poder guardar exactamente una clave por vendor (`anthropic`, `openai`, `openrouter`) vía `PUT /api/users/me/ai-keys/:vendor` con cuerpo `{ apiKey }` (longitud mínima 16). El sistema SHALL cifrarla con libsodium secretbox y `AI_VAULT_KEY` antes de persistirla y SHALL responder `200` solo con `vendor`, `keyHint` (últimos 4 caracteres) y `updatedAt`. `GET /api/users/me/ai-keys` SHALL listar solo esas vistas. `DELETE /api/users/me/ai-keys/:vendor` SHALL borrar la fila. Ninguna respuesta ni el ledger SHALL incluir la clave en claro ni el ciphertext. Sin vault disponible fuera de producción, PUT SHALL responder `503` con código `vault_unavailable`.

#### Scenario: Upsert y listado

- **GIVEN** Ana autenticada y `AI_VAULT_KEY` configurada
- **WHEN** hace PUT con una clave de OpenAI y luego GET
- **THEN** el listado SHALL incluir `vendor: openai` y un `keyHint` de 4 caracteres
- **AND** ni GET ni PUT SHALL devolver la clave completa

#### Scenario: Revocar

- **GIVEN** Ana con clave de Anthropic guardada
- **WHEN** hace DELETE de ese vendor
- **THEN** GET ya no SHALL listar Anthropic
- **AND** las siguientes ejecuciones NO SHALL inyectar `byok:<ana>:anthropic`

#### Scenario: Vault no disponible en desarrollo

- **GIVEN** entorno no productivo sin `AI_VAULT_KEY` válida
- **WHEN** Ana hace PUT
- **THEN** SHALL responderse `503` con código `vault_unavailable`

### Requirement: Inyección BYOK en runTask

Cuando `runTask` recibe un `userId` con consentimiento externo vigente y al menos una clave descifrable, el sistema SHALL añadir proveedores `byok:<userId>:<vendor>` (`external: true`) al universo de la ejecución (delante en el orden de routing). Sin consentimiento o sin claves, NO SHALL inyectar BYOK. Un fallo al descifrar o al llamar al vendor SHALL registrarse como `provider_error` y continuar con el siguiente proveedor **elegible de esa cadena** (si la cuota de plataforma está agotada, la cadena solo tiene BYOK).

#### Scenario: BYOK gana a la plataforma

- **GIVEN** Ana con clave OpenRouter, consentimiento vigente, cuota de plataforma no agotada, y `AI_CHAIN` con openrouter de plataforma
- **WHEN** ejecuta una tarea personal
- **THEN** el primer intento SHALL usar `byok:<ana>:openrouter` si es elegible
- **AND** el ledger del success SHALL llevar ese `providerId`

#### Scenario: Sin consentimiento no usa la clave

- **GIVEN** Ana con clave guardada y consentimiento revocado
- **WHEN** ejecuta una tarea personal
- **THEN** ningún proveedor `byok:` SHALL recibir la petición

### Requirement: OpenRouter BYOK y data_collection

Cuando el proveedor BYOK es OpenRouter y el modelo configurado (`BYOK_OPENROUTER_MODEL`) termina en `:free`, la petición SHALL incluir `provider.data_collection = "deny"`. Si el modelo no termina en `:free`, la petición NO SHALL forzar `data_collection` ni restringir el modelo a `:free`.

#### Scenario: Modelo free con deny

- **GIVEN** BYOK OpenRouter de Ana y `BYOK_OPENROUTER_MODEL` terminado en `:free`
- **WHEN** ese provider completa una petición
- **THEN** el cuerpo enviado a OpenRouter SHALL llevar `data_collection: "deny"`

#### Scenario: Modelo de pago sin forzar deny

- **GIVEN** BYOK OpenRouter de Ana y `BYOK_OPENROUTER_MODEL` sin sufijo `:free`
- **WHEN** ese provider completa una petición
- **THEN** la petición NO SHALL exigir `data_collection: "deny"` por política de LinkVault

### Requirement: Cascada al borrar la cuenta

Al borrar la cuenta de una persona, el sistema SHALL borrar todas sus filas de `user_ai_keys` en la misma unidad de commit que el resto del borrado, vía el puerto del vault (sin evento in-process post-commit).

#### Scenario: Borrado

- **GIVEN** Ana con dos vendors configurados
- **WHEN** se elimina su cuenta
- **THEN** no SHALL quedar ninguna fila de claves para su userId
