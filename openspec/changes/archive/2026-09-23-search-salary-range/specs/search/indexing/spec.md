## ADDED Requirements

### Requirement: salaryMin y salaryMax en job_preview

Al indexar un `job_preview`, el documento Meilisearch SHALL incluir `salaryMin` cuando
`preview.salary.min` es un número, y `salaryMax` cuando `preview.salary.max` es un número.
Ambos SHALL ser filterable en los clientes Meili de **api y worker**. Si el valor es null, el
documento SHALL escribir `null` (o omitir la clave de forma equivalente para `IS NULL` en
filtros) al limpiar el preview, de modo que el merge de Meili no conserve un número viejo. El
backfill de búsqueda SHALL rellenar estos campos en documentos existentes elegibles
(documentado en RUNBOOK; CLI `api:backfill-search`).

#### Scenario: Ambos extremos

- **GIVEN** un preview con `salary.min=3000` y `salary.max=5000`
- **WHEN** se indexa el `job_preview`
- **THEN** el documento SHALL llevar `salaryMin` 3000 y `salaryMax` 5000

#### Scenario: Solo min

- **GIVEN** `salary.min=4000` y `salary.max` null
- **WHEN** se indexa
- **THEN** SHALL incluir `salaryMin` 4000 y NO SHALL incluir `salaryMax`

#### Scenario: Solo max

- **GIVEN** `salary.min` null y `salary.max=7000`
- **WHEN** se indexa
- **THEN** SHALL incluir `salaryMax` 7000 y NO SHALL incluir `salaryMin`
