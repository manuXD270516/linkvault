## ADDED Requirements

### Requirement: Registro dispara la verificación por email

Tras un registro correcto (`201`), además de abrir la sesión, el sistema SHALL iniciar el flujo de verificación de
email definido en `auth/email-verification` (usuario con `emailVerified = false` y intento de envío del correo). Este
requirement no sustituye la política de contraseñas ni la unicidad del email.

#### Scenario: Registro encola verificación

- **GIVEN** un registro correcto de `ana@example.com`
- **WHEN** termina la respuesta `201`
- **THEN** el usuario SHALL tener `emailVerified` `false`
- **AND** SHALL haberse intentado el envío del correo de verificación (ver `auth/email-verification` y
  `platform/email`)

## MODIFIED Requirements

### Requirement: Reseteo manual de contraseña por operador

`docs/RUNBOOK.md` SHALL documentar el procedimiento de reseteo manual de contraseña por un operador como **fallback**
cuando no es posible el flujo de recuperación por email (`auth/password-recovery`): generar un hash Argon2id de la
nueva contraseña, sustituirlo en el documento del usuario y revocar todas las sesiones de esa persona. El procedimiento
SHALL mencionar que el camino normal para la persona usuaria es “Olvidé mi contraseña”.

#### Scenario: Operador sigue el RUNBOOK

- **GIVEN** una persona que no puede usar el correo de recuperación (buzón inaccesible) y un operador autorizado
- **WHEN** el operador aplica el procedimiento del RUNBOOK
- **THEN** el documento del usuario SHALL quedar con un hash `$argon2id$` nuevo
- **AND** las sesiones previas SHALL quedar revocadas
- **AND** un login con la contraseña nueva SHALL responder `200`
