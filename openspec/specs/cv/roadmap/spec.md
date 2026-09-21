# cv/roadmap Specification

## Purpose

Plan de estudio a partir de un análisis de encaje: prioriza habilidades faltantes, ancla recursos al catálogo curado y completa con el modelo solo lo que falta, con marca de verificación honesta y disparo idempotente.

## Requirements

### Requirement: Generar roadmap desde un análisis propio

Quien tiene un análisis `done` no degradado con al menos una `missingSkill` SHALL poder pedir un roadmap (`POST /api/analyses/:analysisId/roadmap`). El sistema SHALL hacer claim-before-run (`status: generating`, índice único por `analysisId`) y SHALL priorizar must antes que nice, rellenando primero el catálogo. Recursos de catálogo SHALL quedar `verified: true`; los demás `verified: false` tras post-proceso obligatorio. Informe degradado o sin `missingSkills` NO SHALL crear roadmap. Otra persona NO SHALL generar ni leer el de un análisis ajeno.

#### Scenario: Catálogo cubre la habilidad

- **GIVEN** un análisis de Ana con TypeScript faltante y el catálogo tiene recursos para TypeScript
- **WHEN** el job completa
- **THEN** el ítem TypeScript SHALL incluir un recurso `verified: true` del catálogo

#### Scenario: El modelo completa un hueco

- **GIVEN** una habilidad must sin entradas en el catálogo
- **WHEN** el job completa
- **THEN** MAY haber recurso `verified: false`
- **AND** aunque el modelo diga `verified: true`, el sistema SHALL dejarlo en `false`

#### Scenario: Informe degradado o sin skills

- **GIVEN** análisis degradado o `missingSkills` vacío
- **WHEN** se pide POST o corre el auto-enqueue
- **THEN** NO SHALL crearse documento `roadmaps`
- **AND** NO SHALL llamarse `build-roadmap`

#### Scenario: Beto no lee el de Ana

- **GIVEN** roadmap de Ana
- **WHEN** Beto hace GET o POST
- **THEN** SHALL responderse no encontrado / no autorizado

### Requirement: Idempotencia por análisis

Un `analysisId` SHALL tener como máximo un documento roadmap. Si ya existe (`generating`, `ready` o `failed`), `POST` SHALL responder **200** con ese documento y NO SHALL ejecutar un `build-roadmap` nuevo. Regenerar queda fuera de MVP.

#### Scenario: Segunda petición

- **GIVEN** roadmap `ready` para A
- **WHEN** Ana hace POST otra vez
- **THEN** SHALL ser 200 con el mismo roadmap
- **AND** el ledger NO SHALL registrar otra ejecución de `build-roadmap`

#### Scenario: Carrera POST y auto-enqueue

- **GIVEN** dos intentos concurrentes de crear el roadmap de A
- **WHEN** ambos intentan el claim
- **THEN** solo uno SHALL ganar el insert
- **AND** solo ese SHALL llamar a `build-roadmap`

### Requirement: Estados y lectura

`GET /api/analyses/:analysisId/roadmap` SHALL devolver `status` ∈ {`generating`,`ready`,`failed`} y el cuerpo del plan solo cuando `ready`. Publicar el aviso de generación NO SHALL usar los pasos del análisis de encaje.

#### Scenario: Mientras genera

- **GIVEN** claim `generating`
- **WHEN** Ana hace GET
- **THEN** `status` SHALL ser `generating`
- **AND** NO SHALL inventarse ítems

### Requirement: Export Markdown

`GET /api/analyses/:analysisId/roadmap.md` SHALL devolver `text/markdown` del documento `ready` sin llamar al modelo. Si no está `ready`, SHALL ser 404.

#### Scenario: Export sin regenerar

- **GIVEN** roadmap `ready`
- **WHEN** Ana pide el `.md`
- **THEN** content-type Markdown
- **AND** sin nueva fila de `build-roadmap` en el ledger

### Requirement: Cascada al borrar el análisis

Al borrar el CV/análisis que originó el roadmap, el sistema SHALL borrar el documento `roadmaps` asociado.

#### Scenario: Borra el CV

- **GIVEN** roadmap ligado al análisis del CV
- **WHEN** Ana elimina ese CV (y sus análisis)
- **THEN** el roadmap SHALL dejar de existir
