# applications/analytics Specification

## Purpose

Expone un embudo de lectura sobre las postulaciones del usuario autenticado: distribución
por estado y lista corta de estancadas, sin métricas de grupo ni dwell.

## Requirements

### Requirement: Funnel personal

`GET /api/applications/analytics` autenticado SHALL devolver un resumen del embudo **solo**
del usuario autenticado con:

- `byStatus`: conteo por cada valor del enum de status de applications;
- `openCount`, `closedCount`, `acceptedCount` según ADR-024 / design D2:
  - `closedCount` = statuses en `CLOSED_STATUSES` (`rejected`, `withdrawn`, `expired`);
  - `acceptedCount` = status `accepted`;
  - `openCount` = total − `closedCount` − `acceptedCount`;
- `stale`: hasta **20** postulaciones con `status` no en `CLOSED_STATUSES`, `status !== 'accepted'`,
  y `now - statusChangedAt ≥ 10` días, ordenadas de más antiguas a más recientes en
  `statusChangedAt`, cada ítem `{ applicationId, linkId, status, statusChangedAt }`.

Sin postulaciones: SHALL responder `200` con conteos en cero y `stale` vacío.
NO SHALL incluir applications de otro usuario.
NO SHALL incluir dwell / tiempos medios en este change.

#### Scenario: Usuario con postulaciones

- **GIVEN** un usuario con una application `applied` y otra `rejected`
- **WHEN** llama a `GET /api/applications/analytics`
- **THEN** `byStatus.applied` ≥ 1 y `byStatus.rejected` ≥ 1
- **AND** `closedCount` ≥ 1 y `openCount` ≥ 1
- **AND** la respuesta NO SHALL incluir applications de otro usuario

#### Scenario: Accepted no es closed

- **GIVEN** solo una application `accepted`
- **WHEN** consulta el funnel
- **THEN** `acceptedCount` = 1 y `closedCount` = 0 y `openCount` = 0
- **AND** esa application NO SHALL aparecer en `stale` aunque `statusChangedAt` sea antiguo

#### Scenario: Vacío

- **GIVEN** un usuario sin applications
- **WHEN** llama al endpoint
- **THEN** SHALL ser `200` con todos los conteos en 0 y `stale` = []

#### Scenario: Estancada a 10 días

- **GIVEN** una application `applied` con `statusChangedAt` hace 11 días
- **WHEN** se consulta el funnel
- **THEN** SHALL aparecer en `stale`

#### Scenario: Cap de stale

- **GIVEN** 25 applications `applied` todas con `statusChangedAt` hace ≥ 11 días
- **WHEN** se consulta el funnel
- **THEN** `stale.length` SHALL ser 20
