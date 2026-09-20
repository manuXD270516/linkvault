# web/auth Specification

## Purpose

Da al SPA registro, login, perfil y una sesión que sobrevive a recargas sin guardar tokens en almacenamiento del
navegador: el access token vive en memoria y se renueva con la cookie de refresh de forma transparente.

## Requirements

### Requirement: Token solo en memoria

El SPA SHALL guardar el access token solo en memoria. NO SHALL escribir el access token ni el refresh token en
`localStorage`, `sessionStorage`, IndexedDB ni cookies accesibles desde JavaScript.

#### Scenario: Almacenamiento limpio tras el login

- **WHEN** un usuario hace login en el SPA
- **THEN** `localStorage`, `sessionStorage` e IndexedDB NO SHALL contener el access token

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

### Requirement: Renovación transparente del access token

El SPA SHALL adjuntar `Authorization: Bearer` a las peticiones a `/api` salvo a login, registro, refresh y logout, y
`X-Requested-With: linkvault` a todo `POST /api/auth/*`. Solo ante un `401` con código `unauthorized` SHALL hacer un único
refresh compartido por todas las peticiones en curso y reintentar cada una una sola vez. Los refresh de todas las pestañas del
mismo navegador SHALL ejecutarse de uno en uno. Ante `409 refresh_conflict` SHALL reintentar el refresh hasta 3 veces con
esperas de 250, 500 y 1000 ms con variación aleatoria; si se agotan, SHALL llamar a logout. Si el
refresh falla, SHALL cerrar la sesión local y navegar a `/login` recordando la ruta actual.

#### Scenario: Token caducado durante el uso

- **GIVEN** un usuario con sesión cuyo access token caducó
- **WHEN** dos peticiones a `/api` reciben `401 unauthorized` a la vez
- **THEN** el SPA SHALL hacer un solo refresh y repetir ambas peticiones con el token nuevo

#### Scenario: Refresh rechazado

- **GIVEN** un usuario cuyo refresh token fue revocado
- **WHEN** una petición recibe `401` y el refresh responde `401`
- **THEN** el SPA SHALL navegar a `/login`

#### Scenario: Conflicto de refresh entre pestañas

- **WHEN** el refresh responde `409 refresh_conflict` y el siguiente intento `200`
- **THEN** el SPA SHALL restaurar la sesión sin navegar a `/login`

#### Scenario: Cinco pestañas restauradas a la vez

- **WHEN** cinco pestañas del mismo navegador arrancan a la vez con sesión
- **THEN** los refresh SHALL ejecutarse de uno en uno
- **AND** ninguna pestaña SHALL llamar a logout

#### Scenario: Contraseña actual incorrecta no renueva

- **WHEN** el cambio de contraseña responde `401 invalid_credentials`
- **THEN** el SPA NO SHALL hacer refresh y SHALL mostrar el error en el formulario

### Requirement: Perfil, cambio de contraseña y logout

El SPA SHALL ofrecer `/perfil` con el email en solo lectura, `displayName` editable y un formulario de cambio de
contraseña ("Contraseña actual" y "Nueva contraseña", con mostrar u ocultar), y un botón de cerrar sesión visible en las
rutas autenticadas. Tras cambiar la contraseña SHALL mostrar "Contraseña cambiada. Cerramos tu sesión en los demás
dispositivos." y continuar con la sesión actual, renovando el access token en la petición siguiente. Los errores del cambio
de contraseña SHALL mostrarse así: `invalid_credentials` → "La contraseña actual no es correcta"; `too_many_attempts` → el
mismo mensaje de demasiados intentos del login; `400` → "La nueva contraseña debe tener al menos 10 caracteres y no puede ser
tu email"; y "Nueva contraseña" SHALL mostrar la pista "Mínimo 10 caracteres". Cerrar sesión SHALL llamar a logout, borrar la sesión local y navegar a
`/login` aunque la llamada falle. Los controles de consentimiento de IA, idioma de salida y redacción del nombre NO SHALL
mostrarse en este change.

#### Scenario: Guardar el nombre

- **GIVEN** un usuario en `/perfil`
- **WHEN** cambia `displayName` y guarda
- **THEN** el SPA SHALL enviar `PATCH /api/users/me` solo con `displayName` y mostrar el perfil devuelto

#### Scenario: Cambiar la contraseña

- **GIVEN** un usuario en `/perfil`
- **WHEN** envía la contraseña actual correcta y una nueva válida
- **THEN** el SPA SHALL mostrar "Contraseña cambiada. Cerramos tu sesión en los demás dispositivos." y seguir en `/perfil` con sesión
- **AND** la siguiente petición a `/api` SHALL completarse tras un único refresh

#### Scenario: Contraseña actual incorrecta en el perfil

- **WHEN** el cambio de contraseña responde `401` con `invalid_credentials`
- **THEN** el formulario SHALL mostrar "La contraseña actual no es correcta"

#### Scenario: Logout con red caída

- **GIVEN** un usuario con sesión y la API inaccesible
- **WHEN** pulsa cerrar sesión
- **THEN** el SPA SHALL navegar a `/login` sin sesión local

### Requirement: Textos en español e inglés

Todos los textos visibles de login, registro, perfil y mensajes de error SHALL estar marcados para i18n con
español como idioma fuente y traducción al inglés.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`
