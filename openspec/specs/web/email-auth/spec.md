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

#### Scenario: Verificación con sesión

- **GIVEN** Ana autenticada no verificada que abre `/verificar-email?token=<válido>`
- **WHEN** el SPA completa el POST
- **THEN** SHALL mostrar el mensaje de éxito
- **AND** el perfil en memoria SHALL pasar a `emailVerified` `true`

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
