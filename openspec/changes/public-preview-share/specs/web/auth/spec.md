## MODIFIED Requirements

### Requirement: Registro y login

El SPA SHALL ofrecer `/login` y `/registro` con formularios validados en cliente con las mismas reglas que la API, un
botón para mostrar u ocultar la contraseña y, en el registro, la pista visible "Mínimo 10 caracteres" y la línea "Usamos tu
email para iniciar sesión y tu nombre para mostrarte en tus grupos. No lo compartimos fuera de LinkVault." Los enlaces
entre ambas páginas SHALL conservar la ruta pedida antes del login y, si lo hay, el `import` con el que se llegó desde
una oferta pública. Tras una respuesta correcta SHALL guardar la sesión y
navegar según esta precedencia: si hay un `import` con forma de `slug`, a `/mis-links?import=<slug>`; si no, a la ruta
pedida; si no la hay, a `/grupos`. Un `import` que no tiene forma de `slug` SHALL ignorarse, igual que una ruta de
retorno externa. Los errores SHALL mostrarse sin borrar el email escrito, con estos mensajes:

- `invalid_credentials`: "Email o contraseña incorrectos".
- `too_many_attempts`: "Demasiados intentos. Vuelve a intentarlo en N minutos", con N = `Retry-After` en minutos
  redondeado hacia arriba.
- `email_taken`: "Ya existe una cuenta con este email. ¿Quieres iniciar sesión?", con enlace a `/login` que conserva el
  email sin ponerlo en la URL.
- Sin conexión: "No pudimos conectar con LinkVault. Revisa tu conexión".
- Cualquier otro error: "Algo salió mal. Inténtalo de nuevo".

#### Scenario: Login correcto con redirección

- **GIVEN** un usuario sin sesión que abrió `/perfil` y fue enviado a `/login`
- **WHEN** hace login con credenciales correctas
- **THEN** el SPA SHALL navegar a `/perfil`

#### Scenario: Registro conserva la ruta pedida

- **GIVEN** un usuario sin cuenta que abrió `/perfil`, fue enviado a `/login` y siguió el enlace a `/registro`
- **WHEN** se registra correctamente
- **THEN** el SPA SHALL navegar a `/perfil`

#### Scenario: Credenciales inválidas

- **WHEN** el login responde `401` con `invalid_credentials`
- **THEN** el formulario SHALL mostrar "Email o contraseña incorrectos" y conservar el email

#### Scenario: Demasiados intentos

- **WHEN** el login responde `429` con `Retry-After: 600`
- **THEN** el formulario SHALL mostrar "Demasiados intentos. Vuelve a intentarlo en 10 minutos"

#### Scenario: Email ya registrado

- **WHEN** el registro responde `409` con `email_taken`
- **THEN** el formulario SHALL mostrar el mensaje con enlace a `/login` y conservar el email
- **AND** al seguir el enlace, `/login` SHALL mostrar ese email sin que aparezca en la URL

#### Scenario: El import viaja entre registro y login

- **GIVEN** `/registro?import=<slug>`
- **WHEN** la persona sigue el enlace a `/login`
- **THEN** la URL SHALL conservar el mismo `import`

#### Scenario: El import gana a la ruta pedida

- **GIVEN** `/login?returnUrl=%2Fperfil&import=<slug>`
- **WHEN** la persona entra correctamente
- **THEN** el SPA SHALL navegar a `/mis-links` con ese `import` y NO SHALL navegar a `/perfil`

#### Scenario: Import inventado

- **GIVEN** `/registro?import=..%2Fotra-cosa`
- **WHEN** la persona se registra correctamente
- **THEN** el SPA SHALL navegar a `/grupos` y NO SHALL guardarse ninguna oferta

### Requirement: Rutas autenticadas y de invitado

Las rutas de la aplicación SHALL exigir sesión salvo `/login`, `/registro` y la vista pública de una oferta
(`/oferta/:slug`), que SHALL abrirse con sesión y sin ella. Sin sesión, una ruta autenticada SHALL
redirigir a `/login` recordando la ruta pedida; solo SHALL recordarse una ruta interna que empiece por `/` y no por `//`
ni `/\`. Con sesión, `/login` y `/registro` SHALL redirigir a la lista de grupos, salvo cuando lleven un `import` con
forma de `slug`: entonces SHALL redirigir a `/mis-links?import=<slug>`. `/` SHALL redirigir a `/grupos`.

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

### Requirement: Restauración de la sesión al cargar

Al arrancar, antes de resolver la primera navegación, el SPA SHALL mostrar "Conectando…" e intentar un refresh durante como
máximo 10 segundos; si responde `200`, SHALL restaurar la sesión sin pedir credenciales, y si falla o se agota el tiempo
SHALL continuar sin sesión, cancelar los reintentos pendientes y NO SHALL llamar a logout.

En una ruta pública (`/oferta/:slug`) NO SHALL intentarse la restauración al arrancar: la página SHALL pintarse sin
esperar a la API de sesión. Quien llega desde un chat, sin cookie de refresh, NO SHALL ver "Conectando…" ni esperar
ningún tiempo de espera antes de ver la oferta. La sesión SHALL resolverse al navegar fuera de esa ruta, en el guard
que corresponda, y NO SHALL resolverse dentro del gesto de pulsar el CTA.

#### Scenario: Recarga con sesión

- **GIVEN** un usuario con sesión
- **WHEN** recarga la página en `/perfil`
- **THEN** el SPA SHALL mostrar `/perfil` sin pasar por `/login`

#### Scenario: API sin respuesta al cargar

- **GIVEN** una API que no responde
- **WHEN** se carga el SPA en `/`
- **THEN** el SPA SHALL mostrar `/login` tras como máximo 10 segundos
- **AND** NO SHALL hacer más peticiones de refresh ni de logout

#### Scenario: La oferta pública no espera a la sesión

- **GIVEN** un navegador sin cookie de refresh
- **WHEN** se carga el SPA en `/oferta/:slug`
- **THEN** NO SHALL llamarse al refresh al arrancar
- **AND** la oferta SHALL verse sin pasar por "Conectando…"

#### Scenario: La sesión se resuelve en el guard, no en el botón

- **GIVEN** un usuario con cookie de refresh válida que abre `/oferta/:slug`
- **WHEN** pulsa "Guardar en LinkVault"
- **THEN** el SPA SHALL navegar a `/registro?import=<slug>` sin esperar a ninguna petición
- **AND** el guard de invitado SHALL restaurar la sesión y llevarlo a `/mis-links` con ese `import`, sin que llegue a
  verse el registro
