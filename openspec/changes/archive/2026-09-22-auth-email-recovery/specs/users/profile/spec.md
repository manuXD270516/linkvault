## ADDED Requirements

### Requirement: Campo emailVerified

Todo perfil SHALL exponer el booleano `emailVerified`. **`UsersFacade` SHALL ser el dueño** del campo: creación en
registro (`false`), default de lectura `true` para documentos antiguos sin el campo, exposición en `GET /api/users/me`
y marcado a `true` al consumir un token de verificación válido. Los módulos de auth NO SHALL escribir la colección
`users` directamente para este campo. Los usuarios creados por registro tras este change SHALL nacer en `false` hasta
completar la verificación (`auth/email-verification`). `PATCH /api/users/me` NO SHALL aceptar `emailVerified`.

#### Scenario: Registro nuevo sin verificar

- **WHEN** un usuario se registra
- **THEN** `GET /api/users/me` SHALL incluir `emailVerified` `false`

#### Scenario: Cuentas previas siguen verificadas

- **GIVEN** un documento de usuario creado antes del change sin campo `emailVerified`
- **WHEN** se consulta su perfil
- **THEN** `emailVerified` SHALL ser `true`

#### Scenario: No se puede marcar a mano

- **WHEN** un usuario envía `{ "emailVerified": true }` en `PATCH /api/users/me`
- **THEN** la respuesta SHALL ser `400`
- **AND** su `emailVerified` NO SHALL cambiar por ese campo

## MODIFIED Requirements

### Requirement: Consulta del perfil propio

`GET /api/users/me` SHALL devolver el perfil del usuario del access token: `id`, `email`, `displayName`,
`emailVerified`, `aiConsent`, `outputLanguage`, `redactName` y `createdAt`, y ningún otro campo. `aiConsent` SHALL
tener exactamente `externalProviders` (booleano), `consentedAt` (instante ISO-8601 en UTC o `null`), `textVersion`
(identificador del texto aceptado o `null`) y `currentTextVersion` (la versión vigente del texto de consentimiento,
siempre presente), para que el cliente pueda detectar por sí solo que el texto cambió sin que el servidor mienta sobre
lo que el usuario aceptó. El consentimiento SHALL considerarse vigente solo si `externalProviders` es `true` y
`textVersion` es igual a `currentTextVersion`. El perfil completo SHALL consultarlo solo su dueño; de otro usuario solo
SHALL ser visible su `displayName`, y únicamente para los miembros de sus grupos (spec `groups/membership`). Ningún
otro campo, en particular el email, SHALL exponerse a terceros.

#### Scenario: Consulta correcta

- **GIVEN** un usuario autenticado
- **WHEN** llama a `GET /api/users/me`
- **THEN** la respuesta SHALL ser `200` con exactamente esos campos, incluido `emailVerified`

#### Scenario: Un tercero no ve el perfil

- **GIVEN** dos usuarios miembros del mismo grupo
- **WHEN** uno consulta la lista de miembros del grupo
- **THEN** SHALL ver el `displayName` del otro
- **AND** la respuesta NO SHALL contener ningún email

#### Scenario: Consentimiento aceptado sobre un texto anterior

- **GIVEN** un usuario que aceptó la versión `2026-09-20` y una versión vigente `2026-11-02`
- **WHEN** llama a `GET /api/users/me`
- **THEN** `aiConsent` SHALL devolver `externalProviders` `true`, `textVersion` `2026-09-20` y `currentTextVersion` `2026-11-02`
- **AND** su consentimiento NO SHALL considerarse vigente hasta que acepte el texto actual
