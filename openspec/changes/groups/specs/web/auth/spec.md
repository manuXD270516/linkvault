## MODIFIED Requirements

### Requirement: Rutas autenticadas y de invitado

Las rutas de la aplicación SHALL exigir sesión salvo `/login` y `/registro`. Sin sesión, una ruta autenticada SHALL
redirigir a `/login` recordando la ruta pedida; solo SHALL recordarse una ruta interna que empiece por `/` y no por `//`
ni `/\`. Con sesión, `/login` y `/registro` SHALL redirigir a la lista de grupos. `/` SHALL redirigir a `/grupos`.

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

### Requirement: Registro y login

El SPA SHALL ofrecer `/login` y `/registro` con formularios validados en cliente con las mismas reglas que la API, un
botón para mostrar u ocultar la contraseña y, en el registro, la pista visible "Mínimo 10 caracteres" y la línea "Usamos tu
email para iniciar sesión y tu nombre para mostrarte en tus grupos. No lo compartimos fuera de LinkVault." Los enlaces
entre ambas páginas SHALL conservar la ruta pedida antes del login. Tras una respuesta correcta SHALL guardar la sesión y
navegar a esa ruta o, si no la hay, a `/grupos`. Los errores SHALL mostrarse sin borrar el email escrito, con estos mensajes:

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

### Requirement: Textos en español e inglés

Todos los textos visibles de login, registro, perfil y mensajes de error SHALL estar marcados para i18n con
español como idioma fuente y traducción al inglés.

#### Scenario: Traducciones completas

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes
- **THEN** cada unidad de traducción SHALL tener `target`
