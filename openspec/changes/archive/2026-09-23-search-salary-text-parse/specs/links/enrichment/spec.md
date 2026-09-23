## ADDED Requirements

### Requirement: Parse salarial post-extract

Tras la cadena de extractores, si el preview aún no tiene `salary.min` ni
`salary.max` numéricos y existe texto candidato (baseSalary textual o anclas en
summary), el worker SHALL aplicar el parse determinista y fusionar solo campos
vacíos. Procedencia distinta de `manual`. Fallo de parse → preview sin cambio.

#### Scenario: Enrichment rellena rango

- **GIVEN** una página cuyo JSON-LD no trae montos pero el summary contiene
  `USD 4000-6000 monthly`
- **WHEN** termina el enrichment
- **THEN** el preview SHALL tener min/max numéricos parseados (si el parse
  confía) sin marcar el campo como manual
