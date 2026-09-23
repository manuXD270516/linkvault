## MODIFIED Requirements

### Requirement: Límite de intentos

La API SHALL limitar los intentos con contadores por ventana fija de 15 minutos: como máximo 5 intentos fallidos por email
normalizado (exista o no la cuenta), 50 logins fallidos por IP (IPv6 agrupada por su prefijo /64) y 10 registros por IP.
Cada intento SHALL contarse antes de verificar la contraseña, de modo que peticiones concurrentes no superen el límite.
Superado un límite, SHALL responder `429` con código `too_many_attempts` y cabecera `Retry-After` en segundos, sin
verificar la contraseña. Un login correcto SHALL poner a cero el contador de su email. Los intentos fallidos de
`currentPassword` en el cambio de contraseña SHALL contar para el email del usuario. Si el almacén de contadores no está
disponible, las peticiones SHALL procesarse sin límite y SHALL registrarse un aviso sin el email al empezar cada racha de
fallos del almacén.

`POST /api/auth/login` y `POST /api/auth/extension/login` SHALL compartir los mismos contadores de email e IP (un fallo
en uno cuenta para el otro).

#### Scenario: Demasiados fallos por email

- **GIVEN** 5 logins fallidos para `ana@example.com` en la ventana actual
- **WHEN** se intenta un sexto login para ese email, incluso con la contraseña correcta
- **THEN** la respuesta SHALL ser `429` con `Retry-After` mayor que 0

#### Scenario: Email inexistente también se limita

- **GIVEN** 5 logins fallidos para `nadie@example.com`, que no tiene cuenta
- **WHEN** se intenta un sexto login para ese email
- **THEN** la respuesta SHALL ser `429`

#### Scenario: Fallos concurrentes

- **WHEN** llegan a la vez 20 logins con contraseña incorrecta para `ana@example.com`
- **THEN** como máximo 5 SHALL verificar un hash y el resto SHALL responder `429`

#### Scenario: Logins correctos no agotan el límite por IP

- **WHEN** se hacen 51 logins correctos desde la misma IP en la ventana actual
- **THEN** ninguno SHALL responder `429`

#### Scenario: Login correcto reinicia el contador

- **GIVEN** 4 logins fallidos para `ana@example.com`
- **WHEN** hace login con la contraseña correcta y después falla 4 veces más
- **THEN** ninguno de esos intentos SHALL responder `429`

#### Scenario: Almacén de contadores caído

- **GIVEN** Redis no disponible
- **WHEN** se hace login con credenciales correctas dos veces
- **THEN** ambas respuestas SHALL ser `200`
- **AND** SHALL registrarse un solo aviso, que no contiene el email

#### Scenario: Extension login comparte límite por email

- **GIVEN** 5 fallos en `POST /api/auth/login` para `ana@example.com`
- **WHEN** se llama a `POST /api/auth/extension/login` para el mismo email
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After` > 0
