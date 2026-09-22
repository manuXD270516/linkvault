## Purpose

Expone una búsqueda autenticada híbrida (full-text + semántica) sobre el índice de contenido, con filtros, ranking
estable y ACL que impide ver resultados ajenos.

## ADDED Requirements

### Requirement: Endpoint de búsqueda autenticado

`GET /api/search` SHALL exigir sesión válida (único verbo canónico). La petición SHALL aceptar: `q` (texto),
paginación `limit`/`offset`, filtros opcionales por `docType` y `groupId`, y `mode=hybrid|fulltext|semantic` (default
`hybrid`; el parámetro existe para tests/debug — la SPA V0 no lo expone). Respuesta SHALL incluir hits con `id`,
`docType`, snippet/highlights seguros, score y enlace o identificadores para navegar al recurso en la SPA. Sin sesión:
`401`. Con `FEATURE_SEARCH=false` o Meilisearch no disponible: `503` con código estable `search_unavailable`.

#### Scenario: Búsqueda con sesión

- **GIVEN** Ana autenticada, `FEATURE_SEARCH=true`, Meili saludable, con contenido indexado que coincide con
  "remoto Nest"
- **WHEN** llama `GET /api/search?q=remoto%20Nest`
- **THEN** la respuesta SHALL ser `200` con al menos un hit cuyo texto o embedding coincida
- **AND** cada hit SHALL incluir `docType` e identificadores de navegación

#### Scenario: Sin sesión

- **GIVEN** una petición sin access token válido
- **WHEN** llama a la búsqueda
- **THEN** SHALL responder `401`
- **AND** NO SHALL devolver hits

#### Scenario: Feature search apagada

- **GIVEN** `FEATURE_SEARCH=false` y Ana autenticada
- **WHEN** llama a la búsqueda
- **THEN** SHALL responder `503` con código `search_unavailable`

### Requirement: ACL en el filtro de consulta

Toda consulta SHALL aplicar un filtro de autorización construido en el servidor a partir de la identidad autenticada.
Los hits SHALL restringirse a documentos donde:

- el dueño es la persona autenticada y `visibilityScope` es `owner` o `owner_and_groups` (privado / application / cv /
  roadmap / …), **o**
- el documento pertenece a un `groupId` del que la persona es miembro **y** `visibilityScope` es `group` o
  `owner_and_groups`, y `docType` es uno de `job_preview`, `group_comment`, `group_link_note`.

NO SHALL confiarse en filtros enviados por el cliente para ampliar el alcance. Un `groupId` en la query que no sea
membresía de la persona SHALL ignorarse o responder `403`/`400` documentado sin filtrar resultados ajenos. CV y
roadmap de otra persona NUNCA SHALL aparecer.

#### Scenario: Contenido de otro grupo no aparece

- **GIVEN** Luis tiene un comentario en el grupo "A" al que Ana no pertenece
- **WHEN** Ana busca el texto de ese comentario
- **THEN** ese hit NO SHALL aparecer en la respuesta

#### Scenario: CV ajeno no aparece

- **GIVEN** el CV de Luis indexado
- **WHEN** Ana busca un fragmento único de ese CV
- **THEN** NO SHALL haber hits `cv` de Luis

#### Scenario: Filtro de grupo propio

- **GIVEN** Ana miembro del grupo "Backend"
- **WHEN** busca con filtro `groupId` de "Backend"
- **THEN** los hits SHALL poder incluir contenido de ese grupo visible para miembros
- **AND** NO SHALL incluir contenido solo privado de otras personas

### Requirement: Búsqueda híbrida y degradación

Con `mode=hybrid` (default), el sistema SHALL combinar recuperación full-text y recuperación vectorial/semántica sobre
Meilisearch y fusionar rankings de forma determinista documentada. Si no hay embedding del query o el índice no tiene
vectores listos, SHALL degradar a full-text y señalarlo en la respuesta (`degraded: true` y motivo estable, p. ej.
`embeddings_unavailable`). Si Meilisearch no está disponible o `FEATURE_SEARCH=false`, SHALL responder `503`
`search_unavailable` sin inventar resultados desde Mongo como si fueran el índice primario.

#### Scenario: Hybrid con embeddings listos

- **GIVEN** Meilisearch saludable e embeddings disponibles
- **WHEN** Ana busca con `mode=hybrid` un sinónimo cercano a un título indexado
- **THEN** la respuesta SHALL poder incluir ese documento aunque la coincidencia léxica exacta sea débil
- **AND** `degraded` NO SHALL ser `true` por falta de embeddings

#### Scenario: Degradación sin embeddings

- **GIVEN** embeddings no disponibles
- **WHEN** Ana busca con `mode=hybrid`
- **THEN** SHALL ejecutarse full-text
- **AND** la respuesta SHALL marcar `degraded: true` con motivo de embeddings

#### Scenario: Meilisearch caído

- **GIVEN** Meilisearch no responde y `FEATURE_SEARCH=true`
- **WHEN** Ana busca
- **THEN** SHALL responder `503` con código `search_unavailable`
- **AND** NO SHALL devolver un listado inventado desde Mongo presentándolo como búsqueda full-text primaria

### Requirement: Filtros y ranking estables

Los filtros SHALL combinar (AND) con el filtro ACL. El orden de hits SHALL ser estable para la misma query, modo y
conjunto de documentos (desempate por id). `limit` máximo es **50**; valores mayores SHALL **clamparse a 50** (no
`400`). Queries vacías (`q` ausente o solo espacios) SHALL rechazarse con **`400`** y código estable `empty_query`.

#### Scenario: Límite de página clampeado

- **GIVEN** Ana autenticada
- **WHEN** pide `limit=999`
- **THEN** la respuesta efectiva SHALL usar `limit` ≤ 50
- **AND** NO SHALL devolver más de 50 hits

#### Scenario: Query vacía

- **GIVEN** Ana autenticada
- **WHEN** busca con `q` vacío o solo espacios
- **THEN** SHALL responder `400` con código `empty_query`
- **AND** NO SHALL listar todo el índice
