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
- Servicio no disponible (respuesta `502`, `503` o `504` sin código o con un código cuya entrada en `API_ERROR_COPY`
  es `fallback`): "LinkVault no está disponible en este momento. Inténtalo en unos minutos", con la referencia técnica
  de «Referencia técnica del fallo» de `web/request-errors`.
- Cualquier otro error: "Algo salió mal. Inténtalo de nuevo", con la misma referencia técnica cuando hubo respuesta
  HTTP.

Los tres últimos mensajes son los comunes de «Mensajes comunes de fallo de una petición» de `web/request-errors`; el
formulario solo añade los suyos propios.

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

#### Scenario: Login con el servicio no disponible

- **WHEN** el login responde `503` sin cuerpo de error de la API
- **THEN** el formulario SHALL mostrar "LinkVault no está disponible en este momento. Inténtalo en unos minutos" y
  conservar el email
- **AND** NO SHALL mostrar "Algo salió mal. Inténtalo de nuevo"

#### Scenario: Login con un fallo inesperado

- **WHEN** el login responde `500` con `internal_error`
- **THEN** el formulario SHALL mostrar "Algo salió mal. Inténtalo de nuevo", conservar el email y mostrar la
  referencia "Si lo reportas, menciona: 500 · internal_error"

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
