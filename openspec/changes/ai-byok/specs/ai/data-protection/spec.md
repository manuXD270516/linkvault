## ADDED Requirements

### Requirement: Secretos BYOK fuera de logs y respuestas

El sistema NO SHALL escribir en logs la clave en claro, el material descifrado, `AI_VAULT_KEY`, ni el `ciphertext` del vault. Las respuestas HTTP de gestión de claves NO SHALL incluir más que `vendor`, `keyHint` y timestamps. El redactor de logs de api y worker SHALL cubrir al menos las claves de objeto `apiKey`, `authorization`, `AI_VAULT_KEY`, `ciphertext` y `vaultKey`.

#### Scenario: Log de error de proveedor

- **GIVEN** un BYOK que falla con error HTTP del vendor
- **WHEN** se registra el fallo
- **THEN** el mensaje de log NO SHALL contener la apiKey ni un Bearer token completo
