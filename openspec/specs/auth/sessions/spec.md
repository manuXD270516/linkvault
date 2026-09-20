# auth/sessions Specification

## Purpose

Mantiene la sesión del usuario sin exponer credenciales persistentes a JavaScript: access token de vida corta en memoria
del cliente y refresh token rotativo en cookie `httpOnly`, con detección de reuso, cierre de sesión y rutas protegidas por
defecto (ADR-012).

## Requirements

### Requirement: Sesión iniciada

Una respuesta que inicia o renueva sesión (registro, login, refresh) SHALL devolver en el cuerpo `accessToken`,
`expiresIn` (segundos) y el perfil del usuario, y SHALL fijar la cookie `lv_refresh` con un refresh token opaco y los
atributos `HttpOnly`, `SameSite=Lax`, `Path=/api/auth` y `Max-Age` igual a los segundos que faltan para su caducidad; con
`NODE_ENV=production` SHALL añadir `Secure`. Cada login o registro SHALL abrir una sesión nueva (familia de refresh
tokens) y el access token SHALL identificar esa sesión. El access token SHALL caducar a los
`AUTH_ACCESS_TOKEN_TTL_SECONDS` (900 en `.env.example`) y NO SHALL enviarse en ninguna cookie. El refresh token SHALL
guardarse solo como hash.

#### Scenario: Login fija la cookie de refresh

- **WHEN** un usuario hace login con `NODE_ENV=development`
- **THEN** la respuesta SHALL incluir `Set-Cookie` de `lv_refresh` con `HttpOnly`, `SameSite=Lax` y `Path=/api/auth`, sin `Secure`
- **AND** el cuerpo SHALL incluir `accessToken`, `expiresIn` igual a 900 y el perfil

#### Scenario: Cookie segura en producción

- **WHEN** un usuario hace login con `NODE_ENV=production`
- **THEN** la cookie `lv_refresh` SHALL incluir `Secure`

#### Scenario: Refresh token no guardado en claro

- **WHEN** se inicia una sesión
- **THEN** la base de datos NO SHALL contener el valor del refresh token de la cookie

### Requirement: Rotación del refresh token

`POST /api/auth/refresh` SHALL aceptar el refresh token solo desde la cookie `lv_refresh`. Si es válido y su sesión no está
revocada ni caducada, SHALL invalidarlo y emitir de forma atómica un refresh token nuevo de la misma sesión y un access
token nuevo, y responder `200` como una sesión iniciada. La caducidad del nuevo refresh SHALL ser `AUTH_REFRESH_TTL_DAYS`
(30) desde la rotación, sin superar `AUTH_REFRESH_MAX_DAYS` (90) desde el login o registro que abrió la sesión. Sin cookie,
o con un token desconocido, caducado o de una sesión revocada, SHALL responder `401` con código `invalid_refresh` y borrar
la cookie.

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

### Requirement: Detección de reuso

Si se presenta un refresh token ya rotado hace 10 segundos o más, la API SHALL tratarlo como reuso: SHALL revocar la sesión
completa, responder `401` con código `invalid_refresh`, borrar la cookie y registrar un aviso con el identificador de
usuario y de sesión, sin tokens. Si se rotó hace menos de 10 segundos, SHALL responder `409` con código
`refresh_conflict` sin revocar la sesión y sin `Set-Cookie`, aunque su sucesor ya se haya usado (peticiones concurrentes
del mismo navegador, que comparte la cookie).

#### Scenario: Reuso revoca la sesión

- **GIVEN** R1 rotado a R2 hace más de 10 segundos
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `401` con código `invalid_refresh`
- **AND** un refresh posterior con R2 SHALL responder `401`

#### Scenario: Refresh concurrente

- **GIVEN** R1 rotado a R2 hace 2 segundos
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `409` con código `refresh_conflict` y sin `Set-Cookie`
- **AND** un refresh posterior con R2 SHALL responder `200`

#### Scenario: Tres refresh concurrentes con el mismo token

- **GIVEN** una sesión con refresh token R1
- **WHEN** llegan tres refresh con R1 a la vez
- **THEN** exactamente una respuesta SHALL ser `200` y las otras dos `409`
- **AND** la sesión NO SHALL quedar revocada

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
refresh, logout y las rutas bajo el prefijo `/api/public/`, reservado a lecturas sin sesión. `/health`, `/health/live` y
la página pública `/p/:slug`, que se sirven fuera del prefijo `/api`, SHALL seguir públicas. Sin token, con un token
caducado, mal firmado, de un usuario inexistente o emitido antes del último cambio de contraseña del usuario, la API
SHALL responder `401` con código `unauthorized`.

Ninguna ruta bajo `/api/public/` SHALL escribir nada ni devolver datos de una persona identificable.

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
- **THEN** SHALL ser exactamente register, login, refresh, logout, las de `/api/public/`, la salud y `/p/:slug`

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
