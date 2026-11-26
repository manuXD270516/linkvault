# auth/sessions Specification

## Purpose

Mantiene la sesión del usuario sin exponer credenciales persistentes a JavaScript: access token de vida corta en memoria
del cliente y refresh token rotativo en cookie `httpOnly`, con detección de reuso, cierre de sesión y rutas protegidas por
defecto (ADR-012).

## Requirements

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

### Requirement: Detección de reuso

Si se presenta un refresh token ya rotado hace 10 segundos o más, la API SHALL tratarlo como reuso: SHALL revocar la sesión
completa, responder `401` con código `invalid_refresh`, borrar la cookie y registrar un aviso con el identificador de
usuario y de sesión, sin tokens.

Si se rotó hace menos de 10 segundos, la API NO SHALL revocar la sesión y SHALL distinguir dos casos:

- **Sucesor sin usar** (ni el sucesor ni ningún hermano suyo se presentó todavía en un refresh) y menos de 3 reemisiones
  previas de ese token: la respuesta de la rotación anterior se dio por perdida. La API SHALL emitir de forma atómica un
  refresh token nuevo de la misma sesión, distinto de los anteriores, y un access token nuevo, y responder `200` como una
  sesión iniciada, con la caducidad del refresh calculada como en una rotación. La ventana de 10 segundos SHALL seguir
  contando desde la primera rotación del token presentado. SHALL registrar un aviso (informativo en la primera reemisión, de advertencia desde la segunda) con el identificador de
  usuario, de sesión y el número de reemisión, sin tokens.
- **Sucesor ya usado, o tope de 3 reemisiones alcanzado**: SHALL responder `409` con código `refresh_conflict` sin
  `Set-Cookie` (peticiones concurrentes del mismo navegador, que comparte la cookie).

Cuando se rota uno de los refresh tokens emitidos a partir del mismo token, los demás que no se hayan usado SHALL quedar
superados en ese instante: presentarlos después SHALL responder `409` `refresh_conflict` dentro de los 10 segundos
siguientes y SHALL tratarse como reuso a partir de entonces. Un token superado NO SHALL reemitirse, ni tampoco un token
rotado antes de que la API incorporara la reemisión (sin contador de reemisiones): ese responde `409` como antes. La base de datos
SHALL seguir guardando solo hashes de los refresh tokens.

#### Scenario: Reuso revoca la sesión

- **GIVEN** R1 rotado a R2 hace más de 10 segundos
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `401` con código `invalid_refresh`
- **AND** un refresh posterior con R2 SHALL responder `401`

#### Scenario: Respuesta de rotación perdida

- **GIVEN** R1 rotado a R2 hace 2 segundos y R2 nunca presentado
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `200` con un access token y una cookie con un refresh token R3 distinto de R1 y de R2
- **AND** la sesión NO SHALL quedar revocada
- **AND** un refresh posterior con R3 SHALL responder `200`

#### Scenario: Respuesta perdida fuera de la ventana

- **GIVEN** R1 rotado a R2 hace más de 10 segundos y R2 nunca presentado
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `401` con código `invalid_refresh`
- **AND** la sesión SHALL quedar revocada

#### Scenario: Refresh concurrente

- **GIVEN** R1 rotado a R2 hace 2 segundos y R2 ya rotado a R3
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `409` con código `refresh_conflict` y sin `Set-Cookie`
- **AND** la sesión NO SHALL quedar revocada
- **AND** un refresh posterior con R3 SHALL responder `200`

#### Scenario: El hermano usado deja superados a los demás

- **GIVEN** R1 rotado a R2 y reemitido como R3, ninguno de los dos presentado todavía
- **WHEN** se llama a refresh con R3 y responde `200`
- **THEN** un refresh con R2 dentro de los 10 segundos siguientes SHALL responder `409` con código `refresh_conflict`
- **AND** un refresh con R2 pasados 10 segundos SHALL responder `401` y revocar la sesión

#### Scenario: Tope de reemisiones

- **GIVEN** R1 rotado y reemitido 3 veces en los últimos 10 segundos, sin que ninguno de sus sucesores se haya presentado
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `409` con código `refresh_conflict` y sin `Set-Cookie`
- **AND** la sesión NO SHALL quedar revocada

#### Scenario: Token rotado antes de la reemisión

- **GIVEN** R1 rotado a R2 hace 2 segundos por una versión de la API sin reemisión, y R2 nunca presentado
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `409` con código `refresh_conflict` y sin `Set-Cookie`

#### Scenario: Tres refresh concurrentes con el mismo token

- **GIVEN** una sesión con refresh token R1
- **WHEN** llegan tres refresh con R1 a la vez
- **THEN** las tres respuestas SHALL ser `200`, con tres refresh tokens distintos entre sí
- **AND** la sesión NO SHALL quedar revocada
- **AND** cuando se usa uno de ellos, refrescar con cualquiera de los otros dos dentro de los 10 segundos siguientes SHALL
  responder `409`

#### Scenario: Reemisión y uso de un hermano a la vez

- **GIVEN** R1 rotado a R2 hace 2 segundos y R2 sin usar
- **WHEN** llegan a la vez un refresh con R1 y otro con R2
- **THEN** la respuesta de R2 SHALL ser `200` con un refresh token R4
- **AND** la de R1 SHALL ser `409` o `200`
- **AND** tras las dos, R4 SHALL ser el único refresh token de la sesión que un refresh posterior acepte con `200`

#### Scenario: Reemisión sin token en claro

- **GIVEN** R1 rotado a R2 y reemitido como R3
- **WHEN** se lee la colección de refresh tokens
- **THEN** NO SHALL contener el valor de R1, R2 ni R3 en claro

### Requirement: Logout

`POST /api/auth/logout` SHALL revocar la sesión del refresh token de la cookie, si existe, borrar la cookie y responder
`204`, también cuando la cookie falta, es inválida o pertenece a un token ya rotado. El access token emitido antes del
logout SHALL seguir siendo válido hasta su caducidad.

#### Scenario: Logout revoca el refresh

- **GIVEN** una sesión con refresh token R1
- **WHEN** se hace logout
- **THEN** la respuesta SHALL ser `204` y borrar la cookie `lv_refresh`
- **AND** un refresh posterior con R1 SHALL responder `401`

#### Scenario: Logout sin sesión

- **WHEN** se hace logout sin cookie
- **THEN** la respuesta SHALL ser `204`

### Requirement: Defensa CSRF de los endpoints de auth

Todo `POST /api/auth/*` SHALL exigir la cabecera `X-Requested-With: linkvault` y un cuerpo `application/json` cuando lleve
cuerpo; sin la cabecera SHALL responder `403` con código `csrf_header_missing`, y con otro tipo de contenido `415`, en
ambos casos sin tocar la sesión ni la cookie.

#### Scenario: Refresh sin cabecera

- **GIVEN** una sesión válida
- **WHEN** se llama a refresh con la cookie pero sin `X-Requested-With`
- **THEN** la respuesta SHALL ser `403` sin `Set-Cookie` y el refresh token NO SHALL rotarse

#### Scenario: Login desde un formulario ajeno

- **WHEN** se llama a login con `Content-Type: text/plain` y la cabecera `X-Requested-With`
- **THEN** la respuesta SHALL ser `415` sin `Set-Cookie`

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

### Requirement: Configuración de autenticación validada

`api` SHALL exigir al arrancar `AUTH_JWT_SECRET` con al menos 32 caracteres, `AUTH_ACCESS_TOKEN_TTL_SECONDS` entre 60 y
3600, `AUTH_REFRESH_TTL_DAYS` entre 1 y 90 y `AUTH_REFRESH_MAX_DAYS` mayor o igual que `AUTH_REFRESH_TTL_DAYS` y como
máximo 365. Con `NODE_ENV=production`, el secreto NO SHALL ser el valor de `.env.example`. Un valor inválido SHALL detener
el arranque nombrando la variable sin mostrar su valor.

#### Scenario: Secreto corto

- **WHEN** `api` arranca con `AUTH_JWT_SECRET` de 20 caracteres
- **THEN** el arranque SHALL fallar nombrando `AUTH_JWT_SECRET` sin mostrar su valor

#### Scenario: Secreto de ejemplo en producción

- **WHEN** `api` arranca con `NODE_ENV=production` y el `AUTH_JWT_SECRET` de `.env.example`
- **THEN** el arranque SHALL fallar nombrando `AUTH_JWT_SECRET`

#### Scenario: Máximo menor que la caducidad

- **WHEN** `api` arranca con `AUTH_REFRESH_TTL_DAYS=30` y `AUTH_REFRESH_MAX_DAYS=20`
- **THEN** el arranque SHALL fallar nombrando `AUTH_REFRESH_MAX_DAYS`
