## ADDED Requirements

### Requirement: Acción reabrir en UI de link cerrado

Cuando el summary del link tiene `closedAt` y el usuario puede **ver/editar el preview**, la
SPA SHALL ofrecer una acción para reabrir (i18n ES/EN). Si el API responde 400 por
`expiresAt`, la UI SHALL pedir una fecha `YYYY-MM-DD` o limpiar caducidad antes de
reintentar. Tras éxito, SHALL quitar el badge de cerrado (SSE o refetch). NO SHALL afirmar
que las postulaciones `expired` se reabrieron solas.

#### Scenario: Reopen exitoso

- **GIVEN** un link cerrado visible
- **WHEN** Ana confirma reopen (con expiresAt date-only si hace falta)
- **THEN** el badge de cerrado SHALL desaparecer

#### Scenario: Calendar pide fecha

- **GIVEN** cierre calendar
- **WHEN** intenta reopen y el API pide expiresAt
- **THEN** la UI SHALL mostrar un control de fecha (día) antes de reenviar
