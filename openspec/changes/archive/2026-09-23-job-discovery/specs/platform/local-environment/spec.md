## ADDED Requirements

### Requirement: Flag FEATURE_DISCOVERY

`.env.example` y el RUNBOOK SHALL documentar `FEATURE_DISCOVERY` (default false) y
`DISCOVERY_CHAIN` (`mock` en CI). El profile compose no requiere servicio nuevo para
discovery (adapters HTTP salientes desde api).

#### Scenario: Documentación

- **WHEN** se revisa `.env.example`
- **THEN** SHALL existir `FEATURE_DISCOVERY` documentado
