## ADDED Requirements

### Requirement: Reopen y detector de frescura

Tras un reopen exitoso que deja `expiresAt` futuro o null y actualiza
`lastFreshnessCheckAt`, el detector NO SHALL cerrar por **calendar** en la siguiente pasada
solo por la caducidad anterior. Un job enrich de recheck **ya en vuelo** MAY volver a cerrar
(documentado en ADR-041); el bump de `lastFreshnessCheckAt` reduce re-selección inmediata.

#### Scenario: Reopen con expiresAt futuro no calendar-cierra

- **GIVEN** un link reabierto con `expiresAt` mañana UTC
- **WHEN** corre el detector
- **THEN** NO SHALL setear `closedAt` por calendar en esa pasada

#### Scenario: Reopen con expiresAt null no calendar-cierra

- **GIVEN** un link reabierto con `expiresAt=null` y `lastFreshnessCheckAt` actualizado
- **WHEN** corre el detector
- **THEN** NO SHALL setear `closedAt` por calendar en esa pasada
