## Purpose

Permite a cada usuario consultar y editar su perfil: nombre visible, consentimiento para proveedores de IA externos,
idioma de salida de la IA y redacción del nombre propio, valores que alimentan el contexto de `runTask` (ADR-018).

## ADDED Requirements

### Requirement: Perfil por defecto

Todo usuario nuevo SHALL tener `aiConsent.externalProviders = false`, `outputLanguage = "es"` y `redactName = false`.

#### Scenario: Perfil tras el registro

- **WHEN** un usuario se registra
- **THEN** su perfil SHALL tener `aiConsent.externalProviders` `false`, `outputLanguage` `es` y `redactName` `false`

### Requirement: Consulta del perfil propio

`GET /api/users/me` SHALL devolver el perfil del usuario del access token: `id`, `email`, `displayName`, `aiConsent`,
`outputLanguage`, `redactName` y `createdAt`, y ningún otro campo. No SHALL existir forma de consultar el perfil de otro
usuario en este change.

#### Scenario: Consulta correcta

- **GIVEN** un usuario autenticado
- **WHEN** llama a `GET /api/users/me`
- **THEN** la respuesta SHALL ser `200` con exactamente esos campos

### Requirement: Edición del perfil propio

`PATCH /api/users/me` SHALL aceptar cualquier subconjunto no vacío de `displayName` (1 a 60 caracteres),
`aiConsent.externalProviders` (booleano), `outputLanguage` (`es` o `en`) y `redactName` (booleano), aplicar solo los
campos enviados y responder `200` con el perfil completo actualizado. Un cuerpo vacío, un campo desconocido (incluidos
`email` y `password`) o un valor inválido SHALL responder `400` sin modificar el perfil.

#### Scenario: Activar el consentimiento

- **GIVEN** un usuario con `aiConsent.externalProviders` `false` y `outputLanguage` `es`
- **WHEN** envía `{ "aiConsent": { "externalProviders": true } }`
- **THEN** la respuesta SHALL ser `200` con `aiConsent.externalProviders` `true` y `outputLanguage` `es`

#### Scenario: Campo no editable

- **WHEN** un usuario envía `{ "email": "otro@example.com" }`
- **THEN** la respuesta SHALL ser `400`
- **AND** su email NO SHALL cambiar

#### Scenario: Idioma no soportado

- **WHEN** un usuario envía `{ "outputLanguage": "fr" }`
- **THEN** la respuesta SHALL ser `400` nombrando `outputLanguage`
