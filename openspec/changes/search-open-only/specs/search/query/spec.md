## MODIFIED Requirements

### Requirement: Endpoint de búsqueda autenticado

`GET /api/search` SHALL exigir sesión válida. Además de los parámetros ya vigentes (`q`,
paginación, `docType`, `groupId`, `modality`, `applicationStatus`, `salaryCurrency`, `mode`),
SHALL aceptar **`openOnly`** como query `true`|`false` (ausente = no filtrar). Cuando
`openOnly=true`, el servidor SHALL AND-filtrar con Meili **`closedAt IS NULL`** (vacantes
abiertas; el loader omite el campo si no hay cierre). Un valor distinto de `true`/`false` SHALL
responder `400` `validation_error` nombrando `openOnly`.
Sin sesión: `401`. Feature/Meili caídos: `503` `search_unavailable`.

#### Scenario: openOnly inválido

- **GIVEN** Ana autenticada
- **WHEN** busca con `openOnly=maybe`
- **THEN** SHALL responder `400` con código `validation_error` nombrando `openOnly`

### Requirement: Filtros y ranking estables

Los filtros (`docType`, `groupId`, `modality`, `applicationStatus`→`status`, `salaryCurrency`,
**`openOnly`→filtro `closedAt`**) SHALL combinar (AND) con el filtro ACL. Queries vacías SHALL
seguir `400` `empty_query` aunque `openOnly=true`.

#### Scenario: openOnly excluye cerradas

- **GIVEN** Ana autenticada, un `job_preview` abierto (sin `closedAt`) y otro cerrado (`closedAt`
  presente), ambos matchean el texto
- **WHEN** busca con `openOnly=true` y ese `q`
- **THEN** el hit cerrado NO SHALL aparecer
- **AND** el abierto MAY aparecer

#### Scenario: openOnly ausente no filtra cierre

- **GIVEN** los mismos dos previews
- **WHEN** busca sin `openOnly` (o `openOnly=false`)
- **THEN** ambos MAY aparecer si matchean el texto

#### Scenario: Query vacía con openOnly

- **GIVEN** Ana autenticada
- **WHEN** busca con `q` vacío y `openOnly=true`
- **THEN** SHALL responder `400` con código `empty_query`
