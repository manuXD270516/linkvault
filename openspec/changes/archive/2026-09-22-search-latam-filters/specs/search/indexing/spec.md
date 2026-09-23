## ADDED Requirements

### Requirement: modality y status filterable

Los atributos Meilisearch `modality` y `status` SHALL figurar en `filterableAttributes` del
índice unificado (configuración aplicada por api y worker). Siguen siendo searchable según la
configuración vigente. Cambiar settings SHALL hacerse en ambos clientes sin drift.

#### Scenario: Settings admiten filtro por modality

- **GIVEN** el índice `lv_content` inicializado tras este change
- **WHEN** se inspeccionan `filterableAttributes`
- **THEN** SHALL incluir `modality` y `status`

### Requirement: Campo salaryCurrency en job_preview

Al indexar un `job_preview`, el documento Meilisearch SHALL incluir `salaryCurrency` cuando
`preview.salary.currency` sea un string no vacío, además de `salaryText` searchable.
`salaryCurrency` SHALL ser filterable. Si `salary` es null o `currency` es null/vacío, el
documento NO SHALL incluir `salaryCurrency`. El backfill de búsqueda SHALL rellenar el campo en
documentos existentes cuando el agregado Mongo ya tenga moneda.

#### Scenario: Preview con salario en USD

- **GIVEN** un JobLink enriquecido con `salary.currency` `USD`
- **WHEN** se indexa
- **THEN** el documento `job_preview` SHALL llevar `salaryCurrency` `USD`
- **AND** `salaryText` SHALL seguir siendo searchable

#### Scenario: Preview sin salario o sin currency

- **GIVEN** un JobLink sin `salary`, o con `salary.currency` null
- **WHEN** se indexa
- **THEN** el documento NO SHALL afirmar una `salaryCurrency`
