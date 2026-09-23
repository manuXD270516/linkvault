# search/query Specification

## Purpose

Expone una búsqueda autenticada híbrida (full-text + semántica) sobre el índice de contenido, con filtros, ranking
estable y ACL que impide ver resultados ajenos.

## Requirements

### Requirement: Endpoint de búsqueda autenticado

`GET /api/search` SHALL exigir sesión válida (único verbo canónico). La petición SHALL aceptar: `q`
(texto), paginación `limit`/`offset`, filtros opcionales por `docType`, `groupId`, **`modality`**
(enum de modalidad del preview), **`applicationStatus`** (estado canónico de postulación; el
servidor SHALL traducirlo al filtro Meili sobre el atributo de documento **`status`**),
**`salaryCurrency`** (string no vacío; pass-through al atributo Meili `salaryCurrency`),
**`openOnly`** (query `true`|`false`; ausente = no filtrar; cuando `true`, AND Meili
`closedAt IS NULL`), **`minSalary`** y **`maxSalary`** (enteros ≥ 0; ausente o vacío = no filtrar
ese lado; detalle en «Filtro de rango salarial»), y
`mode=hybrid|fulltext|semantic` (default `hybrid`; el parámetro existe para tests/debug — la SPA
no lo expone como toggle). Respuesta SHALL incluir hits con `id`, `docType`, snippet/highlights
seguros, score y enlace o identificadores para navegar al recurso en la SPA. Sin sesión: `401`.
Con `FEATURE_SEARCH=false` o Meilisearch no disponible: `503` con código estable
`search_unavailable`. Un valor de `modality` o `applicationStatus` fuera del enum documentado
SHALL responder `400` con código `validation_error` nombrando el campo. `salaryCurrency` vacío o
solo espacios SHALL responder `400` `validation_error` nombrando `salaryCurrency`. Un valor de
`openOnly` distinto de `true`/`false` SHALL responder `400` `validation_error` nombrando
`openOnly`.

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

#### Scenario: modality inválida

- **GIVEN** Ana autenticada
- **WHEN** busca con `modality=hibrido`
- **THEN** SHALL responder `400` con código `validation_error` nombrando `modality`

#### Scenario: openOnly inválido

- **GIVEN** Ana autenticada
- **WHEN** busca con `openOnly=maybe`
- **THEN** SHALL responder `400` con código `validation_error` nombrando `openOnly`

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

Los filtros (`docType`, `groupId`, `modality`, `applicationStatus`→`status`, `salaryCurrency`,
**`openOnly`→`closedAt IS NULL`**, **`minSalary`/`maxSalary`→solape D1**) SHALL combinar (AND)
con el filtro ACL. El orden de hits SHALL ser estable para la misma query, modo, filtros y
conjunto de documentos (desempate por id). `limit` máximo es **50**; valores mayores SHALL
**clamparse a 50** (no `400`). Queries vacías (`q` ausente o solo espacios) SHALL rechazarse con
**`400`** y código estable `empty_query`, **aunque** vengan filtros LatAm, `openOnly` o rango
salarial. Un AND entre filtros de tipos distintos (p. ej. `modality` + `applicationStatus` sin
docs que tengan ambos campos) MAY devolver cero hits; eso NO es error de API.

#### Scenario: Límite de página clampeado

- **GIVEN** Ana autenticada
- **WHEN** pide `limit=999`
- **THEN** la respuesta efectiva SHALL usar `limit` ≤ 50
- **AND** NO SHALL devolver más de 50 hits

#### Scenario: Query vacía con filtros

- **GIVEN** Ana autenticada
- **WHEN** busca con `q` vacío y `modality=remote`
- **THEN** SHALL responder `400` con código `empty_query`
- **AND** NO SHALL listar el índice solo por filtros

#### Scenario: Query vacía con openOnly

- **GIVEN** Ana autenticada
- **WHEN** busca con `q` vacío y `openOnly=true`
- **THEN** SHALL responder `400` con código `empty_query`

#### Scenario: Query vacía con minSalary

- **GIVEN** Ana autenticada
- **WHEN** busca con `q` vacío y `minSalary=3000`
- **THEN** SHALL responder `400` con código `empty_query`

#### Scenario: Filtro por modality

- **GIVEN** Ana autenticada, un `job_preview` indexado con `modality` `remote` y otro `onsite`
- **WHEN** busca con texto que matchea ambos y `modality=remote`
- **THEN** el hit `onsite` NO SHALL aparecer
- **AND** el hit `remote` MAY aparecer

#### Scenario: Filtro por applicationStatus mapea a status

- **GIVEN** Ana con una postulación `applied` y otra `interested` indexadas (campo Meili `status`)
- **WHEN** busca con `applicationStatus=applied` y un `q` que las alcanza
- **THEN** solo la de `applied` SHALL poder aparecer entre hits `application`
- **AND** el servidor SHALL haber aplicado filtro Meili sobre `status`

#### Scenario: Filtro por salaryCurrency (BOB/USD)

- **GIVEN** un preview indexado con `salaryCurrency` `USD` y otro `BOB`
- **WHEN** Ana busca con `salaryCurrency=USD` y un `q` compartido
- **THEN** el hit en `BOB` NO SHALL aparecer

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

#### Scenario: ACL no se amplía con filtros LatAm

- **GIVEN** Ana autenticada y una postulación de otro usuario indexada con `status` `applied`
- **WHEN** busca con `applicationStatus=applied` y un `q` que textualmente podría coincidir
- **THEN** esa postulación ajena NO SHALL aparecer

### Requirement: Filtro de rango salarial

Cuando la petición incluye `minSalary` y/o `maxSalary` (enteros ≥ 0 parseados según design D2),
el servidor SHALL aplicar filtros Meili sobre `salaryMin`/`salaryMax` con la fórmula de solape
de design D1 / ADR-040. Docs sin ningún número salarial quedan fuera. `minSalary` > `maxSalary`
(ambos presentes) SHALL responder `400` `validation_error`. Valores vacíos que se interpretan
como ausentes NO SHALL filtrar. No numéricos, decimales o negativos: `400` nombrando el campo.

#### Scenario: Solape de rango completo

- **GIVEN** un `job_preview` con `salaryMin=3000` y `salaryMax=5000`
- **WHEN** Ana busca con `minSalary=4000&maxSalary=6000&docType=job_preview` y `q` no vacío
- **THEN** ese hit SHALL poder aparecer
- **AND** un doc con `salaryMax=2000` (y sin min, o max solo) que no cumpla D1 NO SHALL aparecer

#### Scenario: Solo salaryMin en el doc

- **GIVEN** un doc con solo `salaryMin=4500` (sin `salaryMax`)
- **WHEN** Ana busca con `minSalary=4000`
- **THEN** ese hit SHALL poder aparecer (proxy: `salaryMin >= 4000`)

#### Scenario: Solo salaryMax en el doc

- **GIVEN** un doc con solo `salaryMax=3500` (sin `salaryMin`)
- **WHEN** Ana busca con `maxSalary=4000`
- **THEN** ese hit SHALL poder aparecer (proxy: `salaryMax <= 4000`)

#### Scenario: Sin salario numérico excluido

- **GIVEN** un `job_preview` sin `salaryMin` ni `salaryMax`
- **WHEN** Ana busca con `minSalary=1000`
- **THEN** ese documento NO SHALL aparecer en los hits

#### Scenario: min mayor que max

- **WHEN** busca con `minSalary=8000&maxSalary=2000`
- **THEN** SHALL responder `400` con código `validation_error`

#### Scenario: Param inválido

- **WHEN** busca con `minSalary=abc` o `minSalary=-1`
- **THEN** SHALL responder `400` con código `validation_error` nombrando `minSalary`

