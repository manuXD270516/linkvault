## MODIFIED Requirements

### Requirement: Endpoint de búsqueda autenticado

`GET /api/search` SHALL exigir sesión válida (único verbo canónico). La petición SHALL aceptar: `q`
(texto), paginación `limit`/`offset`, filtros opcionales por `docType`, `groupId`, **`modality`**
(enum de modalidad del preview), **`applicationStatus`** (estado canónico de postulación; el
servidor SHALL traducirlo al filtro Meili sobre el atributo de documento **`status`**), y
**`salaryCurrency`** (string no vacío; pass-through al atributo Meili `salaryCurrency`), y
`mode=hybrid|fulltext|semantic` (default `hybrid`; el parámetro existe para tests/debug — la SPA
no lo expone como toggle). Respuesta SHALL incluir hits con `id`, `docType`, snippet/highlights
seguros, score y enlace o identificadores para navegar al recurso en la SPA. Sin sesión: `401`.
Con `FEATURE_SEARCH=false` o Meilisearch no disponible: `503` con código estable
`search_unavailable`. Un valor de `modality` o `applicationStatus` fuera del enum documentado
SHALL responder `400` con código `validation_error` nombrando el campo. `salaryCurrency` vacío o
solo espacios SHALL responder `400` `validation_error` nombrando `salaryCurrency`.

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

### Requirement: Filtros y ranking estables

Los filtros (`docType`, `groupId`, `modality`, `applicationStatus`→`status`, `salaryCurrency`)
SHALL combinar (AND) con el filtro ACL. El orden de hits SHALL ser estable para la misma query,
modo, filtros y conjunto de documentos (desempate por id). `limit` máximo es **50**; valores
mayores SHALL **clamparse a 50** (no `400`). Queries vacías (`q` ausente o solo espacios) SHALL
rechazarse con **`400`** y código estable `empty_query`, **aunque** vengan filtros LatAm. Un
AND entre filtros de tipos distintos (p. ej. `modality` + `applicationStatus` sin docs que
tengan ambos campos) MAY devolver cero hits; eso NO es error de API.

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

#### Scenario: ACL no se amplía con filtros LatAm

- **GIVEN** Ana autenticada y una postulación de otro usuario indexada con `status` `applied`
- **WHEN** busca con `applicationStatus=applied` y un `q` que textualmente podría coincidir
- **THEN** esa postulación ajena NO SHALL aparecer
