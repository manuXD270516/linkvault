## ADDED Requirements

### Requirement: Auto-solicitud de roadmap al cerrar el análisis

Cuando un análisis pase a `done` no degradado y su informe tenga al menos una `missingSkill`, el sistema SHALL registrar en el outbox un `RoadmapRequested.v1` con `jobId` determinista `roadmap:{analysisId}` en la misma unidad de commit que deja el análisis resuelto (o equivalente outbox ya usado por el módulo). NO SHALL invocar `build-roadmap` dentro del consumer de `analyze-match`. Si el análisis está degradado, fallido o sin `missingSkills`, NO SHALL encolar.

#### Scenario: Match útil encola

- **GIVEN** análisis que termina `done` con missingSkills
- **WHEN** se persiste el resultado
- **THEN** SHALL existir outbox/job de roadmap para ese analysisId
- **AND** el consumer de match NO SHALL haber llamado a `runTask(build-roadmap)`

#### Scenario: Degradado no encola

- **GIVEN** análisis `done-degraded`
- **WHEN** termina
- **THEN** NO SHALL encolarse RoadmapRequested
