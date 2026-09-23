# auth/extension-sessions Specification

## Purpose

Autentica la extensión Chromium sin depender de la cookie httpOnly del SPA, reutilizando
familias de sesión y rotación de refresh con el mismo rigor que ADR-012.

## Requirements

### Requirement: Login de extensión

`POST /api/auth/extension/login` SHALL aceptar credenciales email/password válidas y responder
`200` con `accessToken`, `expiresIn`, perfil de usuario y `refreshToken` opaco en el **cuerpo**
JSON. NO SHALL fijar cookie `lv_refresh` en esta respuesta. El refresh SHALL persistirse solo
como hash, en una sesión (familia) con `client=extension`. Credenciales inválidas SHALL
responder `401` con el mismo código que el login web (sin filtrar si el email existe). Los
límites de intentos SHALL ser los de `auth/credentials` (contadores compartidos con
`POST /api/auth/login`). Toda petición SHALL enviar `X-Requested-With: linkvault` y
`Content-Type: application/json` (defensa CSRF de `auth/sessions`).

#### Scenario: Login exitoso sin cookie

- **GIVEN** un usuario con contraseña correcta
- **WHEN** llama a `POST /api/auth/extension/login` con cabecera CSRF
- **THEN** el cuerpo SHALL incluir `accessToken`, `expiresIn`, perfil y `refreshToken`
- **AND** la respuesta NO SHALL incluir `Set-Cookie` de `lv_refresh`

#### Scenario: Credenciales inválidas

- **WHEN** se envía password incorrecto
- **THEN** SHALL responder `401` sin `refreshToken` ni access token

#### Scenario: Sin cabecera CSRF

- **WHEN** se llama a extension/login sin `X-Requested-With: linkvault`
- **THEN** SHALL responder `403` con código `csrf_header_missing`

### Requirement: Refresh de extensión por cuerpo

`POST /api/auth/extension/refresh` SHALL aceptar `{ refreshToken }` en JSON con cabecera CSRF.
Si es válido y la sesión `client=extension` no está revocada ni caducada, SHALL rotarlo
atómicamente (mismas reglas de TTL y reuso que `auth/sessions`) y responder `200` con
`accessToken`, `expiresIn`, perfil y nuevo `refreshToken` en el cuerpo, sin cookie. Sin token,
desconocido, caducado, revocado o de sesión `client=web`: `401` `invalid_refresh`. Reuso tras
ventana de gracia: revoca la familia y `401` `invalid_refresh`. Conflicto concurrente dentro de
la ventana: `409` `refresh_conflict`. En **cualquier** status de esta ruta, la API **NO SHALL**
emitir ni borrar la cookie `lv_refresh` (handlers extension-only; no reutilizar el presenter web
que hace `Set-Cookie` en errores).

#### Scenario: Rotación por cuerpo

- **GIVEN** refresh R1 de una sesión `extension`
- **WHEN** se llama a refresh con `{ refreshToken: R1 }`
- **THEN** `200` con access nuevo y `refreshToken` R2 ≠ R1
- **AND** R1 NO SHALL volver a aceptar un refresh
- **AND** la respuesta NO SHALL incluir `Set-Cookie` de `lv_refresh`

#### Scenario: Refresh de sesión web rechazado

- **GIVEN** un refresh emitido solo vía cookie del SPA (cliente web)
- **WHEN** se presenta en `POST /api/auth/extension/refresh`
- **THEN** SHALL responder `401` `invalid_refresh`
- **AND** NO SHALL incluir `Set-Cookie` (ni borrar cookie SPA)

#### Scenario: Error de refresh no toca cookie SPA

- **GIVEN** un navegador que adjunta `lv_refresh` web al origen API
- **WHEN** `POST /api/auth/extension/refresh` responde `401` o `409`
- **THEN** la respuesta NO SHALL incluir `Set-Cookie` que borre o reescriba `lv_refresh`

### Requirement: Logout de extensión

`POST /api/auth/extension/logout` SHALL exigir body JSON `{ refreshToken }` (obligatorio) y
cabecera CSRF. SHALL revocar esa familia de sesión y responder **`204`**. Idempotente: token ya
inválido SHALL responder `204` sin error de negocio. NO SHALL borrar cookies del SPA de otro
cliente. Bearer NO es requisito ni sustituto del refresh en body.

#### Scenario: Logout revoca

- **GIVEN** sesión extensión activa
- **WHEN** logout con su refresh
- **THEN** la respuesta SHALL ser `204`
- **AND** la respuesta NO SHALL incluir `Set-Cookie`
- **AND** un refresh posterior con ese token SHALL ser `401` `invalid_refresh`

### Requirement: Access token sirve a la API existente

Un `accessToken` emitido por login/refresh de extensión SHALL autenticar las mismas rutas
protegidas que el access del SPA (p. ej. `POST /api/links`, listado de grupos), vía
`Authorization: Bearer`.

#### Scenario: Guardar link con token de extensión

- **GIVEN** access token de extensión válido
- **WHEN** `POST /api/links` con Bearer
- **THEN** SHALL comportarse como un cliente autenticado web (mismo contrato `links/sharing`)

### Requirement: Revocación global alcanza sesiones extensión

Tras cambio de contraseña o reset que revoca todas las sesiones del usuario, cualquier
`refreshToken` de sesión `extension` SHALL fallar en refresh con `401` `invalid_refresh`.

#### Scenario: Tras reset de password

- **GIVEN** sesión extensión activa
- **WHEN** el usuario completa reset-password (revoca todas las sesiones)
- **THEN** `POST /api/auth/extension/refresh` con el refresh anterior SHALL ser `401`
