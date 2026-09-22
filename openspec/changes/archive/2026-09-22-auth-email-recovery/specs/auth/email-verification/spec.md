## Purpose

Emite, reenvía y consume el token de verificación del email de la cuenta, permitiendo el uso del producto mientras el
buzón no esté confirmado. El reenvío en V0 es solo para sesión autenticada (sin resend público por email).

## ADDED Requirements

### Requirement: Verificación pendiente tras el registro

Todo usuario creado por `POST /api/auth/register` SHALL nacer con `emailVerified = false`. Tras crear el usuario, el
sistema SHALL emitir un token de propósito `verify_email` (un solo uso, TTL según configuración de verificación, por
defecto 24 h) y SHALL intentar enviar el correo de verificación con el enlace del SPA. Si el envío **o la persistencia
del token** falla, el registro SHALL seguir respondiendo `201` con sesión iniciada y SHALL registrarse un aviso sin el
token ni el cuerpo del correo.

#### Scenario: Registro deja la cuenta sin verificar

- **GIVEN** que no existe `ana@example.com`
- **WHEN** se registra con email y contraseña válidos
- **THEN** la respuesta SHALL ser `201` con sesión
- **AND** el perfil SHALL tener `emailVerified` `false`
- **AND** SHALL existir un correo de verificación capturable en el entorno de test (o un intento de envío registrado)

#### Scenario: Fallo de envío no tumba el registro

- **GIVEN** un Mailer que rechaza el envío
- **WHEN** se registra un usuario nuevo
- **THEN** la respuesta SHALL ser `201`
- **AND** `emailVerified` SHALL ser `false`

#### Scenario: Fallo al persistir el token no tumba el registro

- **GIVEN** un repositorio de tokens que rechaza la escritura
- **WHEN** se registra un usuario nuevo
- **THEN** la respuesta SHALL ser `201`
- **AND** `emailVerified` SHALL ser `false`

### Requirement: Consumir el enlace de verificación

`POST /api/auth/verify-email` SHALL ser público, exigir cabecera CSRF de auth y cuerpo `{ "token": "<opaco>" }`. Si el
token es válido, no usado y no caducado, SHALL marcar `emailVerified = true` para su usuario vía `UsersFacade` (o
puerto equivalente de users), invalidar ese token **en la misma transacción Mongo** y responder `204`. Si el token
falta, es inválido, usado o caducado, SHALL responder `400` con código `invalid_token` sin revelar detalles. Un usuario
ya verificado cuyo token aún fuera válido SHALL responder `204` e invalidar el token (idempotente hacia verificado).

#### Scenario: Verificación correcta

- **GIVEN** Ana registrada con `emailVerified` `false` y un token de verificación válido
- **WHEN** llama a `POST /api/auth/verify-email` con ese token
- **THEN** la respuesta SHALL ser `204`
- **AND** `GET /api/users/me` SHALL devolver `emailVerified` `true`
- **AND** un segundo POST con el mismo token SHALL responder `400` con `invalid_token`

#### Scenario: Token caducado o inventado

- **WHEN** se llama a verify-email con un token inexistente o caducado
- **THEN** la respuesta SHALL ser `400` con código `invalid_token`

### Requirement: Reenvío autenticado

`POST /api/auth/verify-email/resend` SHALL exigir sesión autenticada y cabecera CSRF de auth. El cuerpo SHALL ser vacío
o ignorarse: el destinatario SHALL ser siempre el email del usuario de la sesión. Si el cuerpo incluye un `email`
distinto al de la sesión, la API SHALL **ignorarlo** (NO SHALL reenviar a ese email). Tras aplicar el límite de
intentos, SHALL responder `200` con el mismo cuerpo genérico. Solo si `emailVerified` es `false` SHALL invalidar tokens
previos de verificación, emitir uno nuevo e intentar el envío. Si ya está verificada, SHALL responder `200` sin enviar.
Sin sesión válida SHALL responder `401`.

#### Scenario: Reenvío autenticado de cuenta pendiente

- **GIVEN** Ana autenticada con `emailVerified` `false`
- **WHEN** llama a `POST /api/auth/verify-email/resend` sin cuerpo útil
- **THEN** la respuesta SHALL ser `200` genérica
- **AND** SHALL emitirse un correo de verificación nuevo a Ana

#### Scenario: Resend ignora email ajeno en el cuerpo

- **GIVEN** Ana autenticada con `emailVerified` `false`
- **WHEN** llama a resend con cuerpo `{ "email": "otra@example.com" }`
- **THEN** la respuesta SHALL ser `200` genérica
- **AND** si se envía correo, el destinatario SHALL ser el email de Ana, no `otra@example.com`

#### Scenario: Resend sin sesión

- **WHEN** se llama a `POST /api/auth/verify-email/resend` sin `Authorization`
- **THEN** la respuesta SHALL ser `401` con código `unauthorized`

#### Scenario: Límite de reenvíos

- **GIVEN** Ana autenticada no verificada y 3 reenvíos en la ventana actual (cupo por su email e IP)
- **WHEN** intenta un cuarto
- **THEN** la respuesta SHALL ser `429` con `Retry-After`

### Requirement: Login sin exigir verificación

`POST /api/auth/login` y el refresh de sesión NO SHALL rechazar a un usuario por `emailVerified = false`. La API NO
SHALL exigir verificación para rutas autenticadas salvo las que este u otro capability declaren explícitamente.

#### Scenario: Login de cuenta no verificada

- **GIVEN** Ana con `emailVerified` `false` y contraseña correcta
- **WHEN** hace login
- **THEN** la respuesta SHALL ser `200` con sesión y `emailVerified` `false` en el perfil embebido
