## ADDED Requirements

### Requirement: Index refleja salario parseado

Tras parse/backfill que rellena `preview.salary.min`/`max`, el documento
`job_preview` en Meili SHALL exponer `salaryMin`/`salaryMax` con la misma
semántica que ADR-040 (null para limpiar extremos).

#### Scenario: Backfill reindexa

- **GIVEN** un link cuyo preview pasó de salary sin números a min/max parseados
- **WHEN** se procesa el upsert de search
- **THEN** el doc Meili SHALL tener `salaryMin`/`salaryMax` numéricos
  correspondientes
