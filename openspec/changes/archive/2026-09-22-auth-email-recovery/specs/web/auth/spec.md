## ADDED Requirements

### Requirement: Aviso de email no verificado

En las rutas autenticadas, mientras `emailVerified` sea `false`, el SPA SHALL mostrar un aviso persistente (banner o
equivalente) indicando que el email no está verificado, con acción para reenviar el correo
(`POST /api/auth/verify-email/resend` autenticado, cuerpo vacío). El aviso NO SHALL incluir enlace de ayuda en V0. El
aviso NO SHALL bloquear el uso del resto de la aplicación. Tras pasar a `emailVerified` `true` (verificación o refresco
de perfil), el aviso SHALL desaparecer.

#### Scenario: Banner tras el registro

- **GIVEN** Ana recién registrada con `emailVerified` `false`
- **WHEN** navega a `/grupos`
- **THEN** el SPA SHALL mostrar el aviso de email no verificado
- **AND** SHALL poder usar el resto de la app

#### Scenario: Reenviar desde el aviso

- **GIVEN** Ana autenticada no verificada
- **WHEN** pulsa reenviar en el aviso y la API responde `200`
- **THEN** el SPA SHALL mostrar confirmación genérica de que, si procede, se envió el correo
- **AND** NO SHALL afirmar de forma distinta si ya estaba verificada (la API es genérica)

#### Scenario: Aviso desaparece al verificar

- **GIVEN** Ana con el aviso visible
- **WHEN** su perfil pasa a `emailVerified` `true`
- **THEN** el aviso NO SHALL seguir visible

### Requirement: Enlace a recuperar contraseña desde login

La página `/login` SHALL incluir un enlace visible a la página de recuperación de contraseña de `web/email-auth`.

#### Scenario: Desde login se llega a recuperar

- **GIVEN** una persona en `/login`
- **WHEN** sigue el enlace de olvidé / recuperar contraseña
- **THEN** el SPA SHALL navegar a la ruta de recuperación

## MODIFIED Requirements

### Requirement: Rutas autenticadas y de invitado

Las rutas de la aplicación SHALL exigir sesión salvo `/login`, `/registro`, `/recuperar-contrasena`,
`/restablecer-contrasena`, `/verificar-email` y la vista pública de una oferta (`/oferta/:slug`), que SHALL abrirse con
sesión y sin ella. Sin sesión, una ruta autenticada SHALL redirigir a `/login` recordando la ruta pedida; solo SHALL
recordarse una ruta interna que empiece por `/` y no por `//` ni `/\`. Con sesión, `/login` y `/registro` SHALL
redirigir a la lista de grupos, salvo cuando lleven un `import` con forma de `slug`: entonces SHALL redirigir a
`/mis-links?import=<slug>`. `/` SHALL redirigir a `/grupos`. Las páginas de recuperación, restablecimiento y
verificación SHALL permanecer usables con sesión (p. ej. verificar estando logueado) sin forzar redirección a `/grupos`.

#### Scenario: Ruta protegida sin sesión

- **GIVEN** un usuario sin sesión ni cookie de refresh válida
- **WHEN** abre `/`
- **THEN** el SPA SHALL mostrar `/login`

#### Scenario: Página de invitado con sesión

- **GIVEN** un usuario con sesión
- **WHEN** abre `/login`
- **THEN** el SPA SHALL navegar a `/grupos`

#### Scenario: Ruta de retorno externa

- **WHEN** un usuario hace login desde `/login?returnUrl=//evil.example`
- **THEN** el SPA SHALL navegar a `/grupos`

#### Scenario: Oferta pública sin sesión

- **GIVEN** un usuario sin sesión ni cookie de refresh válida
- **WHEN** abre `/oferta/:slug`
- **THEN** el SPA SHALL mostrar la vista pública y NO SHALL navegar a `/login`

#### Scenario: Página de invitado con sesión y con import

- **GIVEN** un usuario con sesión
- **WHEN** abre `/registro?import=<slug>`
- **THEN** el SPA SHALL navegar a `/mis-links` con ese `import`, y no a `/grupos`

#### Scenario: Recuperar contraseña sin sesión

- **GIVEN** un usuario sin sesión
- **WHEN** abre `/recuperar-contrasena`
- **THEN** el SPA SHALL mostrar el formulario y NO SHALL redirigir a `/login`

#### Scenario: Verificar email con sesión no redirige a grupos

- **GIVEN** un usuario con sesión y `emailVerified` `false`
- **WHEN** abre `/verificar-email?token=<válido>`
- **THEN** el SPA NO SHALL redirigir a `/grupos` antes de procesar la verificación
