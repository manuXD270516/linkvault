# auth/password-recovery Specification

## Purpose
Permite restablecer la contraseña con un enlace de un solo uso enviado al email de la cuenta, sin revelar si el email
está registrado y revocando todas las sesiones al completar el cambio, en el mismo orden que el cambio de contraseña
autenticado (revocar primero, luego hash).

## Requirements

### Requirement: Solicitud de recuperación sin enumeración

`POST /api/auth/forgot-password` SHALL ser público, exigir cabecera CSRF de auth y cuerpo `{ "email" }` (normalizado
como en el login). Tras aplicar el límite de intentos, SHALL responder siempre `200` con el mismo cuerpo genérico
(“si existe una cuenta, enviamos instrucciones”), exista o no el usuario. Solo si existe SHALL invalidar tokens previos
de propósito `reset_password`, emitir uno nuevo con TTL de **1 hora** e intentar el envío del correo con el enlace del
SPA. Si el envío falla, la respuesta HTTP SHALL seguir siendo `200` genérica y SHALL registrarse un aviso sin token.

#### Scenario: Forgot con cuenta existente

- **GIVEN** un usuario `ana@example.com`
- **WHEN** se llama a forgot-password con `Ana@example.com`
- **THEN** la respuesta SHALL ser `200` genérica
- **AND** SHALL emitirse un correo de restablecimiento capturable en test

#### Scenario: Forgot con email inexistente

- **WHEN** se llama a forgot-password con `nadie@example.com`
- **THEN** la respuesta SHALL ser `200` con el mismo cuerpo que el escenario de cuenta existente
- **AND** NO SHALL crearse ningún token

#### Scenario: Límite de forgot-password

- **GIVEN** 3 solicitudes forgot para el mismo email en la ventana actual
- **WHEN** llega una cuarta
- **THEN** la respuesta SHALL ser `429` con `Retry-After`

### Requirement: Restablecer con token de un solo uso

`POST /api/auth/reset-password` SHALL ser público y aceptar `{ "token", "newPassword" }`. Si el token es válido (propósito
`reset_password`, no usado, no caducado) y `newPassword` cumple la política de `auth/credentials`, SHALL, **en este
orden**: (1) revocar **todas** las sesiones del usuario vía `SessionRepository.revokeAllUserSessions(userId)`; (2)
guardar el nuevo hash Argon2id y fijar `passwordChangedAt` (vía `UsersFacade` / `UserAccounts`); (3) invalidar el token
de reset **en la misma transacción Mongo** que el paso (2); (4) resetear el contador Redis de intentos `login-email` de
ese usuario. Responderá `204`. Si la revocación de sesiones falla, el hash NO SHALL cambiar. Si el token es inválido,
usado o caducado, SHALL responder `400` con código `invalid_token` sin cambiar el hash ni revocar. Si la contraseña no
cumple la política, SHALL responder `400` nombrando `newPassword` sin consumir el token ni revocar sesiones.

#### Scenario: Reset correcto cierra todas las sesiones

- **GIVEN** Ana con dos sesiones abiertas y un token de reset válido
- **WHEN** llama a reset-password con ese token y una contraseña nueva válida
- **THEN** la respuesta SHALL ser `204`
- **AND** el refresh de ambas sesiones SHALL responder `401`
- **AND** el login con la contraseña anterior SHALL responder `401`
- **AND** el login con la nueva SHALL responder `200`
- **AND** un segundo uso del mismo token SHALL responder `400` con `invalid_token`

#### Scenario: Orden revocar antes del hash

- **GIVEN** un doble de sesiones que falla al revocar y un token de reset válido
- **WHEN** se llama a reset-password con contraseña válida
- **THEN** la respuesta SHALL ser error
- **AND** el hash de la contraseña NO SHALL haber cambiado

#### Scenario: Reset limpia el límite de login por email

- **GIVEN** Ana con el contador `login-email` agotado y un token de reset válido
- **WHEN** completa reset-password con éxito
- **THEN** un login inmediato con la contraseña nueva SHALL responder `200` (no `429` por ese contador)

#### Scenario: Token de reset caducado

- **GIVEN** un token de reset emitido hace más de 1 hora
- **WHEN** se llama a reset-password con ese token y una contraseña válida
- **THEN** la respuesta SHALL ser `400` con `invalid_token`
- **AND** el hash de la contraseña NO SHALL cambiar

#### Scenario: Contraseña nueva inválida no consume el token

- **GIVEN** un token de reset válido
- **WHEN** se llama a reset-password con una contraseña de 9 caracteres
- **THEN** la respuesta SHALL ser `400` nombrando `newPassword`
- **AND** el mismo token SHALL seguir siendo usable a continuación con una contraseña válida
- **AND** las sesiones previas NO SHALL haberse revocado

### Requirement: Tokens de reset solo hasheados

El valor opaco del token de recuperación NO SHALL persistirse en claro ni aparecer en logs, respuestas HTTP ni métricas.
Solo SHALL guardarse su hash. El TTL del propósito `reset_password` SHALL ser de 1 hora desde la emisión.

#### Scenario: Persistencia sin claro

- **WHEN** se emite un token de reset
- **THEN** la base de datos NO SHALL contener el valor del token enviado en el correo
- **AND** `expiresAt` SHALL quedar a lo sumo 1 hora después de `createdAt`
