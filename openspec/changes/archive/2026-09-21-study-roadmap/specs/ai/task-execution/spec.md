## ADDED Requirements

### Requirement: Construcción de roadmap

El sistema SHALL ejecutar `build-roadmap` solo vía `runTask`. Entrada: `missingSkills` priorizables + contexto mínimo de vacante (sin texto completo del CV en MVP). Salida: roadmap estructurado. Tras la salida (o solo catálogo), el sistema SHALL forzar `verified: true` únicamente en hits de `searchCatalog` y `verified: false` en el resto. Tarea NO cacheable. Datos personales a efectos de consentimiento si la cadena usa proveedores external.

#### Scenario: Salida que no valida

- **GIVEN** JSON inválido del modelo
- **WHEN** `build-roadmap`
- **THEN** NO inventar roadmap tras repair
- **AND** NO marcar como verificados recursos inventados

#### Scenario: El modelo miente verified

- **GIVEN** salida con `verified: true` en un recurso que no está en el catálogo
- **WHEN** termina el post-proceso
- **THEN** ese recurso SHALL quedar `verified: false`
