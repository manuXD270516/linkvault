## ADDED Requirements

### Requirement: Variables VAPID documentadas

`.env.example` SHALL documentar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (mailto: o URL) usadas por el
worker/api para web push. En local, valores de desarrollo son suficientes; Mailpit sigue cubriendo el canal email.
El RUNBOOK SHALL indicar cómo generar un par VAPID.

#### Scenario: Arranque local sin push real

- **GIVEN** un entorno local con VAPID de desarrollo en `.env`
- **WHEN** arrancan api y worker
- **THEN** el arranque NO SHALL fallar solo por usar claves de desarrollo
- **AND** el email de producto sigue pudiendo comprobarse en Mailpit
