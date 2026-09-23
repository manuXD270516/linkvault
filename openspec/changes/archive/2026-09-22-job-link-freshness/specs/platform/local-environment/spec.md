## ADDED Requirements

### Requirement: Variables de frescura de links documentadas

`.env.example` SHALL documentar `FEATURE_LINK_FRESHNESS` (default seguro `false` en ejemplo local
salvo que el RUNBOOK indique lo contrario para demos), el intervalo de cadencia (p. ej.
`LINK_FRESHNESS_INTERVAL_DAYS=7`) y el tope por pasada (`LINK_FRESHNESS_BATCH_LIMIT`). El worker
SHALL leerlas; con el flag en `false` el detector SHALL ser no-op.

#### Scenario: Defaults documentados

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `FEATURE_LINK_FRESHNESS`, el intervalo y el límite de lote
- **AND** `FEATURE_LINK_FRESHNESS` SHALL valer `false` por defecto en el ejemplo
