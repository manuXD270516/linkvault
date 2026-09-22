# auth/credentials Specification

## Purpose

Permite crear una cuenta con email y contraseña, iniciar sesión con ella y cambiar la contraseña, guardando solo un hash
Argon2id y resistiendo la enumeración de cuentas y los ataques de fuerza bruta.

## Requirements

### Requirement: Registro con email y contraseña

`POST /api/auth/register` SHALL aceptar `email`, `password` y `displayName`, crear el usuario con el perfil por defecto
y responder `201` con una sesión iniciada (ver `auth/sessions`). El email SHALL normalizarse (espacios exteriores
eliminados y minúsculas) antes de validarlo y guardarlo, y SHALL ser único sobre su forma normalizada. `displayName`
SHALL tener entre 1 y 60 caracteres tras eliminar espacios exteriores. Una petición inválida SHALL responder `400`
nombrando los campos inválidos sin devolver sus valores.

#### Scenario: Registro correcto

- **GIVEN** que no existe ningún usuario con `ana@example.com`
- **WHEN** se registra `  Ana@Example.com ` con una contraseña válida y `displayName` "Ana"
- **THEN** la respuesta SHALL ser `201` con un access token y la cookie de refresh
- **AND** el usuario guardado SHALL tener el email `ana@example.com`

#### Scenario: Email ya registrado

- **GIVEN** un usuario con `ana@example.com`
- **WHEN** se registra `ANA@example.com`
- **THEN** la respuesta SHALL ser `409` con el código `email_taken`
- **AND** NO SHALL crearse un segundo usuario

#### Scenario: Registro inválido

- **WHEN** se registra un email sin `@` y un `displayName` vacío
- **THEN** la respuesta SHALL ser `400` nombrando `email` y `displayName`

#### Scenario: Fallo al abrir la sesión tras crear el usuario

- **GIVEN** que la creación de la sesión falla después de guardar el usuario
- **WHEN** el registro responde con error
- **THEN** un login posterior con ese email y contraseña SHALL responder `200`

### Requirement: Política de contraseñas

La contraseña SHALL tener entre 10 y 128 caracteres y NO SHALL coincidir con el email normalizado. No SHALL exigirse
composición de caracteres. La política SHALL aplicarse en el registro y en el cambio de contraseña.

#### Scenario: Contraseña corta

- **WHEN** se registra con una contraseña de 9 caracteres
- **THEN** la respuesta SHALL ser `400` nombrando `password`

#### Scenario: Contraseña igual al email

- **WHEN** se registra `ana@example.com` con la contraseña `ana@example.com`
- **THEN** la respuesta SHALL ser `400` nombrando `password`

### Requirement: Almacenamiento de contraseñas

La contraseña SHALL guardarse solo como hash Argon2id con sal por usuario. Ni la contraseña ni su hash SHALL aparecer en
respuestas HTTP ni en logs.

#### Scenario: Hash Argon2id

- **WHEN** se registra un usuario
- **THEN** el documento guardado SHALL contener un hash con prefijo `$argon2id$` y no la contraseña

#### Scenario: Respuestas sin hash

- **WHEN** se registra un usuario o se consulta su perfil
- **THEN** ninguna respuesta SHALL contener la contraseña ni el hash

### Requirement: Login con email y contraseña

`POST /api/auth/login` SHALL aceptar `email` y `password`, normalizar el email y, si coinciden, responder `200` con una
sesión iniciada. Si el email no existe o la contraseña no coincide, SHALL responder `401` con el mismo código
`invalid_credentials` y el mismo cuerpo en ambos casos, y el tiempo de respuesta NO SHALL depender de si el email existe
(se verifica contra un hash ficticio cuando no existe).

#### Scenario: Login correcto

- **GIVEN** un usuario `ana@example.com` con contraseña conocida
- **WHEN** hace login con `Ana@example.com` y esa contraseña
- **THEN** la respuesta SHALL ser `200` con un access token y la cookie de refresh

#### Scenario: Credenciales inválidas indistinguibles

- **GIVEN** un usuario `ana@example.com`
- **WHEN** se hace login con `ana@example.com` y una contraseña incorrecta, y con `nadie@example.com`
- **THEN** ambas respuestas SHALL ser `401` con código `invalid_credentials` y cuerpos idénticos
- **AND** ambas SHALL verificar un hash Argon2id

### Requirement: Límite de intentos

La API SHALL limitar los intentos con contadores por ventana fija de 15 minutos: como máximo 5 intentos fallidos por email
normalizado (exista o no la cuenta), 50 logins fallidos por IP (IPv6 agrupada por su prefijo /64) y 10 registros por IP.
Cada intento SHALL contarse antes de verificar la contraseña, de modo que peticiones concurrentes no superen el límite.
Superado un límite, SHALL responder `429` con código `too_many_attempts` y cabecera `Retry-After` en segundos, sin
verificar la contraseña. Un login correcto SHALL poner a cero el contador de su email. Los intentos fallidos de
`currentPassword` en el cambio de contraseña SHALL contar para el email del usuario. Si el almacén de contadores no está
disponible, las peticiones SHALL procesarse sin límite y SHALL registrarse un aviso sin el email al empezar cada racha de
fallos del almacén.

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

### Requirement: Cambio de contraseña

`POST /api/auth/password` SHALL exigir un access token válido y aceptar `currentPassword` y `newPassword`. Si
`currentPassword` coincide y `newPassword` cumple la política, SHALL revocar todas las sesiones del usuario salvo la del
access token de la petición, guardar después el nuevo hash y responder `204`. Si `currentPassword` no coincide, SHALL
responder `401` con código `invalid_credentials`; superado el límite del email, SHALL responder `429` sin verificar.

#### Scenario: Cambio correcto revoca las otras sesiones

- **GIVEN** un usuario con dos sesiones abiertas A y B
- **WHEN** cambia la contraseña desde la sesión A
- **THEN** la respuesta SHALL ser `204`
- **AND** el refresh de la sesión B SHALL responder `401`
- **AND** el refresh de la sesión A SHALL responder `200`
- **AND** el login con la contraseña anterior SHALL responder `401`

#### Scenario: Contraseña actual incorrecta

- **WHEN** un usuario autenticado cambia la contraseña con un `currentPassword` incorrecto
- **THEN** la respuesta SHALL ser `401` con código `invalid_credentials`
- **AND** el hash guardado NO SHALL cambiar

#### Scenario: Fuerza bruta de la contraseña actual

- **GIVEN** 5 intentos fallidos de `currentPassword` para el usuario en la ventana actual
- **WHEN** intenta de nuevo cambiar la contraseña
- **THEN** la respuesta SHALL ser `429` sin verificar la contraseña

### Requirement: IP del cliente detrás de Traefik de confianza

Cuando `api` corre detrás del proxy de confianza documentado (Traefik del compose prod), SHALL activar `trustProxy` (o
equivalente de Fastify) de forma que los límites por IP de login, registro y el contador de IP del join heredado usen la
IP del cliente, no la del proxy. La activación SHALL hacerse con la variable de entorno `TRUST_PROXY=true`, presente
**solo** en el compose de producción detrás de Traefik. Activar `trustProxy` sin ese proxy de confianza NO SHALL formar
parte del camino soportado; local/dev/tests genéricos SHALL dejar la variable ausente o en falso.

#### Scenario: Límite de login por IP del cliente

- **GIVEN** `api` detrás de Traefik con `TRUST_PROXY=true` según la documentación de prod
- **WHEN** llegan 50 logins fallidos desde la misma IP de cliente (vía cabeceras de proxy de confianza) en la ventana
- **THEN** el intento siguiente desde esa IP SHALL responder `429`
- **AND** peticiones desde otra IP de cliente NO SHALL compartir ese contador

#### Scenario: Join usa la misma IP de cliente

- **GIVEN** el stack prod con Traefik de confianza
- **WHEN** se aplican los límites por IP del flujo de unirse a un grupo
- **THEN** la IP contada SHALL ser la del cliente vista a través del proxy
- **AND** NO SHALL ser únicamente la IP interna de Traefik para todos los clientes

#### Scenario: Sin TRUST_PROXY fuera de compose prod

- **GIVEN** un arranque local o de test sin `TRUST_PROXY=true`
- **WHEN** se inspecciona la configuración de Fastify/Nest
- **THEN** `trustProxy` NO SHALL estar activado como en prod
- **AND** los límites NO SHALL confiar en `X-Forwarded-For` de clientes no autenticados por un proxy de confianza

### Requirement: Reseteo manual de contraseña por operador

`docs/RUNBOOK.md` SHALL documentar el procedimiento de reseteo manual de contraseña por un operador como **fallback**
cuando no es posible el flujo de recuperación por email (`auth/password-recovery`): generar un hash Argon2id de la
nueva contraseña, sustituirlo en el documento del usuario y revocar todas las sesiones de esa persona. El procedimiento
SHALL mencionar que el camino normal para la persona usuaria es “Olvidé mi contraseña”.

#### Scenario: Operador sigue el RUNBOOK

- **GIVEN** una persona que no puede usar el correo de recuperación (buzón inaccesible) y un operador autorizado
- **WHEN** el operador aplica el procedimiento del RUNBOOK
- **THEN** el documento del usuario SHALL quedar con un hash `$argon2id$` nuevo
- **AND** las sesiones previas SHALL quedar revocadas
- **AND** un login con la contraseña nueva SHALL responder `200`

### Requirement: Registro dispara la verificación por email

Tras un registro correcto (`201`), además de abrir la sesión, el sistema SHALL iniciar el flujo de verificación de
email definido en `auth/email-verification` (usuario con `emailVerified = false` y intento de envío del correo). Este
requirement no sustituye la política de contraseñas ni la unicidad del email.

#### Scenario: Registro encola verificación

- **GIVEN** un registro correcto de `ana@example.com`
- **WHEN** termina la respuesta `201`
- **THEN** el usuario SHALL tener `emailVerified` `false`
- **AND** SHALL haberse intentado el envío del correo de verificación (ver `auth/email-verification` y
  `platform/email`)
