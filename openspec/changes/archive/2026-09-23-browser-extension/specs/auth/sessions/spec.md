## MODIFIED Requirements

### Requirement: Sesión iniciada

Una respuesta que inicia o renueva sesión en el **cliente web** (`POST /api/auth/register`,
`POST /api/auth/login`, `POST /api/auth/refresh`) SHALL devolver en el cuerpo `accessToken`,
`expiresIn` (segundos) y el perfil del usuario, y SHALL fijar la cookie `lv_refresh` con un refresh token opaco y los
atributos `HttpOnly`, `SameSite=Lax`, `Path=/api/auth` y `Max-Age` igual a los segundos que faltan para su caducidad; con
`NODE_ENV=production` SHALL añadir `Secure`. Cada login o registro web SHALL abrir una sesión nueva (familia de refresh
tokens) con `client=web` (o equivalente) y el access token SHALL identificar esa sesión. El access token SHALL caducar a los
`AUTH_ACCESS_TOKEN_TTL_SECONDS` (900 en `.env.example`) y NO SHALL enviarse en ninguna cookie. El refresh token SHALL
guardarse solo como hash.

Las respuestas de `POST /api/auth/extension/login` y `POST /api/auth/extension/refresh` (éxito) SHALL devolver
`accessToken`, `expiresIn`, perfil y `refreshToken` en el cuerpo JSON y **NO SHALL** fijar ni renovar la cookie
`lv_refresh` (ver `auth/extension-sessions`).

#### Scenario: Login fija la cookie de refresh

- **WHEN** un usuario hace login web con `NODE_ENV=development`
- **THEN** la respuesta SHALL incluir `Set-Cookie` de `lv_refresh` con `HttpOnly`, `SameSite=Lax` y `Path=/api/auth`, sin `Secure`
- **AND** el cuerpo SHALL incluir `accessToken`, `expiresIn` igual a 900 y el perfil

#### Scenario: Cookie segura en producción

- **WHEN** un usuario hace login web con `NODE_ENV=production`
- **THEN** la cookie `lv_refresh` SHALL incluir `Secure`

#### Scenario: Refresh token no guardado en claro

- **WHEN** se inicia una sesión
- **THEN** la base de datos NO SHALL contener el valor del refresh token en claro

#### Scenario: Extension login no fija cookie

- **WHEN** un usuario hace `POST /api/auth/extension/login` con éxito
- **THEN** la respuesta NO SHALL incluir `Set-Cookie` de `lv_refresh`
- **AND** el cuerpo SHALL incluir `refreshToken`

### Requirement: Rutas protegidas por defecto

Toda ruta bajo `/api` SHALL exigir `Authorization: Bearer <accessToken>` válido y no caducado, salvo register, login,
refresh, logout, forgot-password, reset-password, verify-email, **extension/login, extension/refresh, extension/logout**
y las rutas bajo el prefijo `/api/public/`, reservado a lecturas sin sesión. `/health`, `/health/live` y la página
pública `/p/:slug`, que se sirven fuera del prefijo `/api`, SHALL seguir públicas. Sin token, con un token caducado,
mal firmado, de un usuario inexistente o emitido antes del último cambio de contraseña del usuario, la API SHALL
responder `401` con código `unauthorized`.

Ninguna ruta bajo `/api/public/` SHALL escribir nada ni devolver datos de una persona identificable.

`POST /api/auth/verify-email/resend` NO SHALL ser pública: exige access token (ver `auth/email-verification`).

#### Scenario: Perfil sin token

- **WHEN** se llama a `GET /api/users/me` sin `Authorization`
- **THEN** la respuesta SHALL ser `401` con código `unauthorized`

#### Scenario: Token caducado

- **GIVEN** un access token emitido hace más de `AUTH_ACCESS_TOKEN_TTL_SECONDS`
- **WHEN** se llama a `GET /api/users/me` con ese token
- **THEN** la respuesta SHALL ser `401`

#### Scenario: Token anterior al cambio de contraseña

- **GIVEN** un access token de la sesión B emitido antes de que el usuario cambiara la contraseña desde la sesión A
- **WHEN** se llama a `GET /api/users/me` con ese token
- **THEN** la respuesta SHALL ser `401` con código `unauthorized`

#### Scenario: Salud pública

- **WHEN** se llama a `/health` sin `Authorization`
- **THEN** la respuesta NO SHALL ser `401`

#### Scenario: Preview público sin token

- **WHEN** se llama a `GET /api/public/previews/:slug` sin `Authorization`
- **THEN** la respuesta NO SHALL ser `401`

#### Scenario: Lo público se limita a su prefijo

- **GIVEN** las rutas registradas por la API
- **WHEN** se listan las que no exigen access token
- **THEN** SHALL ser exactamente register, login, refresh, logout, forgot-password, reset-password, verify-email,
  extension/login, extension/refresh, extension/logout, las de `/api/public/`, la salud y `/p/:slug`

#### Scenario: Forgot-password sin token

- **WHEN** se llama a `POST /api/auth/forgot-password` sin `Authorization` y con la cabecera CSRF de auth
- **THEN** la respuesta NO SHALL ser `401` por falta de access token

#### Scenario: Resend de verificación exige sesión

- **WHEN** se llama a `POST /api/auth/verify-email/resend` sin `Authorization` y con la cabecera CSRF de auth
- **THEN** la respuesta SHALL ser `401` con código `unauthorized`

#### Scenario: Extension login sin Bearer

- **WHEN** se llama a `POST /api/auth/extension/login` sin `Authorization` y con la cabecera CSRF de auth
- **THEN** la respuesta NO SHALL ser `401` por falta de access token

### Requirement: Rotación del refresh token

`POST /api/auth/refresh` SHALL aceptar el refresh token solo desde la cookie `lv_refresh`. Si es válido y su sesión no está
revocada ni caducada, SHALL invalidarlo y emitir de forma atómica un refresh token nuevo de la misma sesión y un access
token nuevo, y responder `200` como una sesión iniciada. La caducidad del nuevo refresh SHALL ser `AUTH_REFRESH_TTL_DAYS`
(30) desde la rotación, sin superar `AUTH_REFRESH_MAX_DAYS` (90) desde el login o registro que abrió la sesión. Sin cookie,
o con un token desconocido, caducado o de una sesión revocada, SHALL responder `401` con código `invalid_refresh` y borrar
la cookie. Si el refresh pertenece a una sesión con `client=extension`, SHALL responder `401` `invalid_refresh` y NO
SHALL emitir cookie nueva (aislamiento de cliente).

#### Scenario: Rotación correcta

- **GIVEN** una sesión con refresh token R1
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `200` con un access token y una cookie con un refresh token R2 distinto de R1

#### Scenario: Caducidad deslizante con máximo absoluto

- **GIVEN** una sesión abierta hace 80 días cuyo último refresh fue hace 20 días
- **WHEN** se rota su refresh token
- **THEN** el nuevo refresh SHALL caducar a los 90 días de la apertura de la sesión, no a los 30 días de la rotación

#### Scenario: Refresh sin cookie

- **WHEN** se llama a refresh sin cookie
- **THEN** la respuesta SHALL ser `401` con código `invalid_refresh`

#### Scenario: Revocación durante un refresh

- **GIVEN** una sesión con refresh token R1
- **WHEN** se ejecutan a la vez un refresh con R1 y un logout de esa sesión
- **THEN** cualquier refresh token emitido por ese refresh SHALL responder `401` en un refresh posterior

#### Scenario: Refresh extensión rechazado en path cookie

- **GIVEN** un refresh token de sesión `client=extension` colocado artificialmente en cookie `lv_refresh`
- **WHEN** se llama a `POST /api/auth/refresh`
- **THEN** SHALL responder `401` con código `invalid_refresh`
- **AND** NO SHALL emitir un refresh sucesor
