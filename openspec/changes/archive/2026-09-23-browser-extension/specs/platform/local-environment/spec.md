## ADDED Requirements

### Requirement: CORS y origen de la extensión en local

El entorno local documentado SHALL permitir configurar allowlist de orígenes
`chrome-extension://<extension-id>` (variable de entorno documentada en `.env.example`) para que
la API acepte peticiones CORS preflight/simple desde la extensión unpacked. El README o RUNBOOK
SHALL documentar cómo cargar la extensión unpacked y cómo obtener el extension id.

#### Scenario: Variable documentada

- **WHEN** un desarrollador abre `.env.example`
- **THEN** SHALL existir la variable de allowlist CORS de extensión documentada
- **AND** la guía local SHALL indicar pasos para cargar el build unpacked
