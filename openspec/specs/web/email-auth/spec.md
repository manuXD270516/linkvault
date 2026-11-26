# web/email-auth Specification

## Purpose
Ofrece en el SPA las pantallas para verificar el email y restablecer la contraseña a partir del enlace del correo,
mostrando resultados claros sin filtrar el token a almacenamiento persistente del navegador.

## Requirements

### Requirement: Página de verificación por enlace

El SPA SHALL ofrecer la ruta pública `/verificar-email` que lea `token` de la query, llame a
`POST /api/auth/verify-email` con ese token y muestre éxito (“Email verificado”) o error (`invalid_token` → mensaje
claro de enlace inválido o caducado). Tras éxito, si hay sesión SHALL refrescar el perfil para ver `emailVerified`
`true`; si no hay sesión, SHALL ofrecer enlace a `/login`. El token NO SHALL guardarse en `localStorage` ni
`sessionStorage`.

Si la restauración de la sesión que arranca al cargar el SPA todavía no terminó, la página SHALL esperarla antes de
decidir si hay sesión, y SHALL pedir el perfil **después** de que la verificación haya respondido con éxito; así el
perfil en memoria termina en `emailVerified` `true` sea cual sea el orden en que respondan la restauración y la
verificación, y el aviso de email no verificado NO SHALL seguir visible sin recargar. Mientras espera, la página SHALL
seguir diciendo "Comprobando el enlace…". También cuando la verificación falla, la página SHALL esperar a que termine
la restauración antes de mostrar el enlace no válido o el error, para que lo que depende de si hay sesión no aparezca
y desaparezca. Si la verificación tuvo éxito pero la petición del perfil falla, la página SHALL mostrar igualmente
"Email verificado" y NO SHALL presentar ese fallo como un error de la verificación; si sigue habiendo un perfil en
memoria, SHALL pasar a `emailVerified` `true`, y si la sesión se perdió por el camino, NO SHALL fabricar un perfil.

#### Scenario: Verificación con sesión

- **GIVEN** Ana autenticada no verificada que abre `/verificar-email?token=<válido>`
- **WHEN** el SPA completa el POST
- **THEN** SHALL mostrar el mensaje de éxito
- **AND** el perfil en memoria SHALL pasar a `emailVerified` `true`

#### Scenario: La verificación responde antes que la restauración de la sesión

- **GIVEN** Ana con sesión y `emailVerified` `false` que abre el enlace del correo en una carga completa del SPA
- **AND** la verificación responde con éxito antes que el refresh de la restauración, y ese refresh devuelve su
  perfil con `emailVerified` `false`
- **WHEN** termina la restauración
- **THEN** el SPA SHALL pedir el perfil después de ella y mostrar "Email verificado" con "Ir a la aplicación"
- **AND** en `/grupos` el aviso de email no verificado NO SHALL verse

#### Scenario: El perfil falla después de verificar

- **GIVEN** Ana autenticada no verificada que abre `/verificar-email?token=<válido>`
- **WHEN** la verificación responde con éxito y la petición del perfil falla
- **THEN** el SPA SHALL mostrar "Email verificado"
- **AND** el perfil en memoria SHALL pasar a `emailVerified` `true`
- **AND** NO SHALL mostrar ningún error

#### Scenario: El perfil responde 401 y el refresh falla

- **GIVEN** Ana autenticada no verificada que abre `/verificar-email?token=<válido>`
- **WHEN** la verificación responde con éxito, la petición del perfil responde `401` y el refresh posterior falla
- **THEN** el SPA SHALL mostrar "Email verificado"
- **AND** NO SHALL lanzar ninguna excepción ni guardar un perfil en memoria sin sesión

#### Scenario: Enlace inválido mientras se restaura la sesión

- **GIVEN** Ana con sesión que abre `/verificar-email?token=basura` en una carga completa del SPA
- **WHEN** la verificación responde `invalid_token` antes que el refresh de la restauración
- **THEN** el SPA SHALL mostrar que el enlace no es válido solo cuando termine la restauración
- **AND** NO SHALL mostrar en ningún momento la indicación para quien no tiene sesión ("Inicia sesión y usa el aviso…")

#### Scenario: Enlace inválido

- **WHEN** se abre `/verificar-email?token=basura`
- **THEN** el SPA SHALL mostrar que el enlace no es válido o caducó
- **AND** NO SHALL escribir el token en almacenamiento del navegador
- **AND** NO SHALL ofrecer un formulario público de reenvío por email (V0: reenvío solo autenticado vía banner tras login)

### Requirement: Olvidé mi contraseña

El SPA SHALL ofrecer `/recuperar-contrasena` (o ruta i18n equivalente documentada en tasks) con formulario de email que
llame a `POST /api/auth/forgot-password`. Ante `200` SHALL mostrar siempre el mismo mensaje genérico de “si existe una
cuenta, te enviamos instrucciones”, también si la API respondiera igual ante email desconocido. Ante `429` SHALL
mostrar el mismo patrón de demasiados intentos que el login. La página SHALL ser de invitado (sin sesión obligatoria).

#### Scenario: Envío genérico

- **WHEN** la persona envía un email en `/recuperar-contrasena` y la API responde `200`
- **THEN** el SPA SHALL mostrar el mensaje genérico sin afirmar que la cuenta existe

### Requirement: Restablecer contraseña

El SPA SHALL ofrecer `/restablecer-contrasena` que lea `token` de la query, pida la nueva contraseña (misma política
visible que el registro: mínimo 10 caracteres, mostrar/ocultar) y llame a `POST /api/auth/reset-password`. Ante `204`
SHALL mostrar éxito e invitar a `/login`. Ante `invalid_token` o validación de contraseña SHALL mostrar el error sin
borrar innecesariamente el campo de contraseña en errores de política. El token NO SHALL persistirse fuera de la
memoria de la página.

#### Scenario: Reset correcto

- **GIVEN** `/restablecer-contrasena?token=<válido>`
- **WHEN** la persona envía una contraseña nueva válida y la API responde `204`
- **THEN** el SPA SHALL mostrar éxito y un enlace o redirección a `/login`

#### Scenario: Token inválido en reset

- **WHEN** el reset responde `400` con `invalid_token`
- **THEN** el SPA SHALL indicar que el enlace no es válido o caducó

### Requirement: Textos i18n de email-auth

Todos los textos visibles de verificación, recuperación y restablecimiento SHALL estar marcados para i18n con español
como idioma fuente y traducción al inglés.

#### Scenario: Traducciones de email-auth

- **WHEN** se comprueba `messages.en.xlf` tras extraer los mensajes de estas páginas
- **THEN** cada unidad nueva de email-auth SHALL tener `target`
