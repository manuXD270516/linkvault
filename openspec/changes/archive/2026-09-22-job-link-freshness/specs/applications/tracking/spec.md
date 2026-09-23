## ADDED Requirements

### Requirement: Expiración automática al cerrar la vacante

Cuando el sistema marca un JobLink como cerrado, SHALL actualizar las postulaciones de ese link
según `links/freshness`: estados abiertos (no `accepted`) → `expired` con historial atómico
idempotente (sin segundo evento si ya estaba `expired`). NO SHALL exigirse `version` del cliente.
El historial V0 conserva su forma actual (origen, destino, etapas, fecha) **sin** campo actor
nuevo. Reabrir después sigue siendo decisión humana vía `PATCH` existente.

#### Scenario: Auto-expire sin versión del SPA

- **GIVEN** una postulación en `applied` con `version` 3
- **WHEN** su link se cierra por frescura
- **THEN** SHALL quedar `expired` con `version` 4 y un evento `applied` → `expired`
- **AND** NO SHALL haber fallado por conflicto de versión de cliente

#### Scenario: Humano puede reabrir

- **GIVEN** una postulación auto-expirada
- **WHEN** su dueño la pasa a `interested` con la versión actual
- **THEN** la respuesta SHALL ser `200` con `status` `interested`
