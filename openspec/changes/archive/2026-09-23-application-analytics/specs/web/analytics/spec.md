## Purpose

Permite al usuario ver en la SPA un resumen del embudo personal y actuar sobre
postulaciones estancadas sin sustituir el kanban.

## ADDED Requirements

### Requirement: Vista de insights personal

La SPA SHALL exponer una ruta autenticada de insights que muestre
`GET /api/applications/analytics`: conteos (`byStatus` / open / closed / accepted) y lista
de estancadas. i18n ES/EN. Empty state cuando no hay postulaciones. Cada ítem stale SHALL
permitir navegar al tablero o detalle existente. NO SHALL mostrar dwell en este change.

#### Scenario: Empty state

- **GIVEN** el usuario no tiene applications
- **WHEN** abre la vista de insights
- **THEN** SHALL ver un empty state que invite a registrar postulaciones

#### Scenario: Con estancadas

- **GIVEN** el API devuelve ítems en `stale`
- **WHEN** el usuario abre insights
- **THEN** SHALL listar esas estancadas con navegación al flujo existente
