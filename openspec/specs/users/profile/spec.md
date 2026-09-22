# users/profile Specification

## Purpose

Permite a cada usuario consultar y editar su perfil: nombre visible, consentimiento para proveedores de IA externos,
idioma de salida de la IA y redacción del nombre propio, valores que alimentan el contexto de `runTask` (ADR-018).

## Requirements

### Requirement: Perfil por defecto

Todo usuario nuevo SHALL tener `aiConsent.externalProviders = false`, `aiConsent.consentedAt = null`,
`aiConsent.textVersion = null`, `outputLanguage = "es"` y `redactName = true`.

`redactName` SHALL nacer en `true` porque el nombre propio **no aporta ninguna señal de encaje** y, sin embargo, es el
dato que más identifica a una persona ante un proveedor externo: el valor por defecto SHALL ser el que menos envía, y
enviarlo SHALL requerir que su dueño lo decida.

#### Scenario: Perfil tras el registro

- **WHEN** un usuario se registra
- **THEN** su perfil SHALL tener `aiConsent.externalProviders` `false`, `outputLanguage` `es` y `redactName` `true`

#### Scenario: El nombre no viaja por defecto

- **GIVEN** un usuario recién registrado que después da su consentimiento y nunca tocó `redactName`
- **WHEN** una tarea de IA prepara su CV para un proveedor externo
- **THEN** su nombre SHALL ir sustituido por un marcador

#### Scenario: Sin fecha ni versión de consentimiento

- **WHEN** un usuario se registra
- **THEN** `aiConsent.consentedAt` y `aiConsent.textVersion` SHALL ser `null`
- **AND** ninguna tarea de IA SHALL poder elegir un proveedor externo para él

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

### Requirement: Edición del perfil propio

`PATCH /api/users/me` SHALL aceptar cualquier subconjunto no vacío de `displayName` (1 a 60 caracteres),
`aiConsent` (objeto con `externalProviders` booleano y, cuando vale `true`, `textVersion` obligatorio),
`outputLanguage` (`es` o `en`) y `redactName` (booleano), aplicar solo los
campos enviados y responder `200` con el perfil completo actualizado. Activar el consentimiento SHALL exigir la versión del
texto que el usuario tenía delante: sin `textVersion` SHALL responder `400`, y con una `textVersion` que no sea la vigente
SHALL responder `409 consent_text_outdated` sin modificar el perfil, para que el usuario vuelva a leer el texto vigente
antes de aceptarlo. Al activarlo, el servidor SHALL guardar `consentedAt` con el instante de la petición y `textVersion` con
la versión aceptada. Revocarlo (`externalProviders: false`) NO SHALL exigir `textVersion`, SHALL dejar `consentedAt` y
`textVersion` en `null`, SHALL tener efecto inmediato sobre los análisis siguientes y NO SHALL borrar los análisis ya
guardados. Un cuerpo vacío, un campo desconocido (incluidos
`email`, `password`, `consentedAt` y `currentTextVersion`) o un valor inválido SHALL responder `400` sin modificar el perfil.

#### Scenario: Activar el consentimiento

- **GIVEN** un usuario con `aiConsent.externalProviders` `false`, `outputLanguage` `es` y una versión vigente `2026-11-02`
- **WHEN** envía `{ "aiConsent": { "externalProviders": true, "textVersion": "2026-11-02" } }`
- **THEN** la respuesta SHALL ser `200` con `aiConsent.externalProviders` `true` y `outputLanguage` `es`
- **AND** `aiConsent.consentedAt` SHALL ser el instante de la petición y `aiConsent.textVersion` `2026-11-02`

#### Scenario: Activar sin decir qué texto se aceptó

- **WHEN** un usuario envía `{ "aiConsent": { "externalProviders": true } }`
- **THEN** la respuesta SHALL ser `400` nombrando `textVersion`
- **AND** su consentimiento NO SHALL cambiar

#### Scenario: Activar sobre un texto que ya caducó

- **GIVEN** una versión vigente `2026-11-02`
- **WHEN** un usuario envía `{ "aiConsent": { "externalProviders": true, "textVersion": "2026-09-20" } }`
- **THEN** la respuesta SHALL ser `409` con código `consent_text_outdated`
- **AND** su perfil NO SHALL cambiar

#### Scenario: Revocar el consentimiento

- **GIVEN** un usuario con el consentimiento activo y análisis ya guardados
- **WHEN** envía `{ "aiConsent": { "externalProviders": false } }`
- **THEN** la respuesta SHALL ser `200` con `externalProviders` `false`, `consentedAt` `null` y `textVersion` `null`
- **AND** sus análisis anteriores SHALL seguir siendo consultables

#### Scenario: Campo no editable

- **WHEN** un usuario envía `{ "email": "otro@example.com" }`
- **THEN** la respuesta SHALL ser `400`
- **AND** su email NO SHALL cambiar

#### Scenario: Idioma no soportado

- **WHEN** un usuario envía `{ "outputLanguage": "fr" }`
- **THEN** la respuesta SHALL ser `400` nombrando `outputLanguage`

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
