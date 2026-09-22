## MODIFIED Requirements

### Requirement: Rutas protegidas por defecto

Toda ruta bajo `/api` SHALL exigir `Authorization: Bearer <accessToken>` válido y no caducado, salvo register, login,
refresh, logout, forgot-password, reset-password, verify-email y las rutas bajo el prefijo `/api/public/`, reservado a
lecturas sin sesión. `/health`, `/health/live` y la página pública `/p/:slug`, que se sirven fuera del prefijo `/api`,
SHALL seguir públicas. Sin token, con un token caducado, mal firmado, de un usuario inexistente o emitido antes del
último cambio de contraseña del usuario, la API SHALL responder `401` con código `unauthorized`.

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
- **THEN** SHALL ser exactamente register, login, refresh, logout, forgot-password, reset-password, verify-email, las
  de `/api/public/`, la salud y `/p/:slug`

#### Scenario: Forgot-password sin token

- **WHEN** se llama a `POST /api/auth/forgot-password` sin `Authorization` y con la cabecera CSRF de auth
- **THEN** la respuesta NO SHALL ser `401` por falta de access token

#### Scenario: Resend de verificación exige sesión

- **WHEN** se llama a `POST /api/auth/verify-email/resend` sin `Authorization` y con la cabecera CSRF de auth
- **THEN** la respuesta SHALL ser `401` con código `unauthorized`
