## MODIFIED Requirements

### Requirement: Refresh de extensión por cuerpo

`POST /api/auth/extension/refresh` SHALL aceptar `{ refreshToken }` en JSON con cabecera CSRF.
Si es válido y la sesión `client=extension` no está revocada ni caducada, SHALL rotarlo
atómicamente (mismas reglas de TTL, reemisión y reuso que `auth/sessions`) y responder `200` con
`accessToken`, `expiresIn`, perfil y nuevo `refreshToken` en el cuerpo, sin cookie. Sin token,
desconocido, caducado, revocado o de sesión `client=web`: `401` `invalid_refresh`. Reuso tras
ventana de gracia: revoca la familia y `401` `invalid_refresh`. Dentro de la ventana, un token
cuyo sucesor no se usó SHALL reemitirse con `200` y un `refreshToken` nuevo en el cuerpo (respuesta
perdida, hasta 3 veces); si el sucesor ya se usó o se alcanzó el tope: `409` `refresh_conflict`.
En **cualquier** status de esta ruta, la API **NO SHALL** emitir ni borrar la cookie `lv_refresh`
(handlers extension-only; no reutilizar el presenter web que hace `Set-Cookie` en errores).

#### Scenario: Rotación por cuerpo

- **GIVEN** refresh R1 de una sesión `extension`
- **WHEN** se llama a refresh con `{ refreshToken: R1 }`
- **THEN** `200` con access nuevo y `refreshToken` R2 ≠ R1
- **AND** una vez usado R2, R1 NO SHALL volver a aceptar un refresh
- **AND** la respuesta NO SHALL incluir `Set-Cookie` de `lv_refresh`

#### Scenario: Respuesta perdida en la extensión

- **GIVEN** R1 de una sesión `extension` rotado a R2 hace 2 segundos y R2 nunca presentado
- **WHEN** se llama a refresh con `{ refreshToken: R1 }`
- **THEN** `200` con `refreshToken` R3 distinto de R1 y de R2
- **AND** la respuesta NO SHALL incluir `Set-Cookie` de `lv_refresh`
- **AND** la sesión NO SHALL quedar revocada

#### Scenario: Refresh de sesión web rechazado

- **GIVEN** un refresh emitido solo vía cookie del SPA (cliente web)
- **WHEN** se presenta en `POST /api/auth/extension/refresh`
- **THEN** SHALL responder `401` `invalid_refresh`
- **AND** NO SHALL incluir `Set-Cookie` (ni borrar cookie SPA)

#### Scenario: Error de refresh no toca cookie SPA

- **GIVEN** un navegador que adjunta `lv_refresh` web al origen API
- **WHEN** `POST /api/auth/extension/refresh` responde `401` o `409`
- **THEN** la respuesta NO SHALL incluir `Set-Cookie` que borre o reescriba `lv_refresh`
