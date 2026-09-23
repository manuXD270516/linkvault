# links/salary-parse Specification

## Purpose

Inferir extremos salariales numéricos desde texto libre cuando el preview aún
no los tiene, para que el filtro de rango en búsqueda pueda incluir esas
vacantes.

## Requirements

### Requirement: Parse determinista de texto salarial

El sistema SHALL exponer una función pura de parseo que, dado un texto, devuelva
`{ min?, max?, currency?, period? }` o indique que no hay parse confiable.
SHALL reconocer rangos y montos únicos con monedas USD/BOB (y alias `$`, `Bs`,
`Bs.`) y periodos month/year/hour solo con anclas claras. SHALL NO convertir
entre periodos. Entrada insuficiente o ambigua → sin resultado (no inventar
números).

#### Scenario: Rango USD mensual

- **GIVEN** el texto `USD 3,000 - 5,000 / month`
- **WHEN** se parsea
- **THEN** el resultado SHALL incluir min=3000, max=5000, currency=USD,
  period=month

#### Scenario: Monto único Bs

- **GIVEN** el texto `Sueldo: Bs. 8500 mensuales`
- **WHEN** se parsea
- **THEN** el resultado SHALL tener `min=8500` y `max=8500` y currency BOB
  (o el código normalizado del preview)

#### Scenario: Miles LatAm

- **GIVEN** el texto `Salario Bs. 3.500 mensuales`
- **WHEN** se parsea
- **THEN** min=max SHALL ser 3500 (punto como miles)

#### Scenario: Sin ancla

- **GIVEN** el texto `5 años de experiencia en ventas`
- **WHEN** se parsea
- **THEN** SHALL no devolver extremos salariales

### Requirement: Completar preview sin pisar manual/pasted

En enrichment, el parse SHALL correr solo si **ambos** `salary.min` y
`salary.max` son null/ausentes. Si `previewSources.salary` es `manual` o
`pasted`, SHALL ser no-op. En caso contrario SHALL fusionar con source `auto`
y extractor `parse-salary-text` (nunca un kind nuevo). Campos numéricos ya
presentes NO SHALL sobrescribirse.

#### Scenario: Solo currency previo (auto)

- **GIVEN** preview auto con `salary: { currency: USD, min: null, max: null }` y
  texto candidato `from $4000 to $6000 per month`
- **WHEN** corre el paso de parse
- **THEN** min/max SHALL rellenarse y currency USD SHALL conservarse

#### Scenario: Manual no se toca

- **GIVEN** `previewSources.salary` = manual
- **WHEN** corre el paso de parse
- **THEN** el salary del preview NO SHALL cambiar
