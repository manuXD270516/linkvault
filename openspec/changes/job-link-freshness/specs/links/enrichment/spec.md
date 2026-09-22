## ADDED Requirements

### Requirement: Re-check de frescura reutiliza enrich

Cuando frescura pide releer un link, SHALL reutilizarse el mismo consumidor/pipeline de
`enrich-link` (cortesía, robots, cadena, merge, `previewVersion`, snapshots), con
`triggeredBy: freshness` y `jobId` `fresh:{linkId}:{bucket}`. Un job de frescura cuyo
`previewVersion` sea anterior al del link SHALL descartarse sin trabajo (igual que enrich).

#### Scenario: Misma cadena con triggeredBy

- **GIVEN** un link elegible para re-check de página
- **WHEN** se encola la lectura de frescura
- **THEN** SHALL ejecutarse la cadena de extracción lícita existente
- **AND** un campo `manual` NO SHALL sobrescribirse

### Requirement: Motivo not_found distinto de http_error

El descargador SHALL clasificar HTTP **404** y **410** como motivo `not_found`, distinto de
`http_error` (p. ej. 5xx o fallo de red). Ese motivo SHALL registrarse en `lastEnrichmentError` y
SHALL ser **no reintentable** (misma clase que `robots_disallowed`, `blocked` y `not_a_job`).

#### Scenario: 404 es not_found

- **WHEN** la página responde `404`
- **THEN** el motivo SHALL ser `not_found`
- **AND** NO SHALL ser `http_error`

#### Scenario: 500 sigue http_error

- **WHEN** la página responde `500`
- **THEN** el motivo SHALL ser `http_error`

#### Scenario: not_found no se reintenta

- **GIVEN** un enrich que falló con `not_found`
- **WHEN** se evalúa si el fallo es reintentable
- **THEN** SHALL ser no reintentable


### Requirement: Cierre en lugar de failed vacío tras frescura

Si la lectura lleva `triggeredBy: freshness` y la señal es de oferta desaparecida (`not_found`, o
`isJobPosting: false` sin JSON-LD `JobPosting` con preview previo), el resultado SHALL ser el
cierre de vacante de `links/freshness`, **no** un `previewStatus` `failed` vacío. Fallos
transitorios y primera lectura (sin freshness) conservan el comportamiento actual.

#### Scenario: Frescura + not_found no deja failed vacío

- **GIVEN** un link `enriched` cuyo re-check de frescura obtiene `not_found`
- **WHEN** termina el job
- **THEN** el link SHALL quedar cerrado según frescura
- **AND** NO SHALL quedar `failed` sin preview

#### Scenario: Primera lectura not_found sigue failed

- **GIVEN** un link `pending` sin preview
- **WHEN** su primer enrich obtiene `not_found`
- **THEN** el link SHALL quedar `failed` con motivo `not_found`
- **AND** NO SHALL marcarse cerrado por frescura
