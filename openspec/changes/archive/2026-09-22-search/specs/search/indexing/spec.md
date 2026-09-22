## Purpose

Mantiene un índice de búsqueda eventualmente consistente con el contenido que cada persona puede ver: previews,
postulaciones, comentarios, notas de grupo, CV y roadmaps, sin dual-write síncrono hacia Meilisearch.

## ADDED Requirements

### Requirement: Documentos indexables por tipo

El sistema SHALL indexar, como documentos de búsqueda distintos, al menos estos tipos cuando existan en Mongo y sean
visibles según las reglas de ACL del producto:

- **job_preview**: campos de preview de un JobLink (title, company, description, skills, location, modality, salary) y
  metadatos de alcance (privado del dueño y/o grupos donde el link está compartido).
- **application**: status, stageLabel y notes de la postulación del dueño.
- **group_comment**: texto del comentario plano en un link de grupo.
- **group_link_note**: nota asociada a la relación group-link.
- **cv**: texto extraído y skills del CV del dueño (nunca de otra persona).
- **roadmap**: contenido del roadmap del dueño (nunca de otra persona).

Cada documento SHALL tener un identificador estable derivado del tipo y del id del agregado (p. ej.
`job_preview:<linkId>`, `cv:<cvId>`), de modo que reindexar el mismo agregado reemplace el documento anterior.
Los documentos SHALL poder llevar `embedModelId` y `embeddingDim` cuando tengan vector.

#### Scenario: Preview enriquecido entra al índice

- **GIVEN** un JobLink con preview enriquecido visible para Ana (privado o en un grupo suyo)
- **WHEN** se procesa el trabajo de indexación correspondiente
- **THEN** SHALL existir un documento `job_preview` con title/company/description/skills/location/modality/salary
  indexables
- **AND** el documento SHALL llevar metadatos de alcance suficientes para filtrar por ACL en la consulta

#### Scenario: CV solo del dueño

- **GIVEN** el CV de Ana con texto extraído
- **WHEN** se indexa
- **THEN** el documento `cv` SHALL estar etiquetado como visible únicamente para Ana
- **AND** NO SHALL indexarse el binario del archivo

#### Scenario: Roadmap solo del dueño

- **GIVEN** un roadmap de Ana
- **WHEN** se indexa
- **THEN** el documento `roadmap` SHALL ser visible únicamente para Ana

### Requirement: Indexación asíncrona vía outbox

Los casos de uso que crean o actualizan un agregado indexable SHALL escribir, en la misma transacción Mongo que el
agregado (ADR-009), un evento de outbox de indexación (upsert) o borrado **cuando `FEATURE_SEARCH=true`**. NO SHALL
llamar a Meilisearch dentro de esa transacción. El worker SHALL consumir la cola, construir el documento (y, si aplica,
su embedding vía `embedTexts`) y hacer upsert o delete en Meilisearch de forma idempotente. El `jobId` SHALL ser
determinista a partir de `docType`, `aggregateId` y un hash del contenido indexable canónico.

Cuando `FEATURE_SEARCH=false`, los emitters SHALL NOT escribir eventos `SearchUpsert` / `SearchDelete`. Si el consumer
recibe un job con el flag en false o Meilisearch no configurado, SHALL hacer ack no-op.

#### Scenario: Alta con evento pendiente si Meili caído

- **GIVEN** `FEATURE_SEARCH=true`, Redis disponible y Meilisearch caído
- **WHEN** Ana actualiza una nota de postulación
- **THEN** la API SHALL responder éxito
- **AND** el evento de indexación SHALL quedar en `outbox_events` / cola hasta poder aplicarse
- **AND** NO SHALL haberse perdido el cambio en Mongo

#### Scenario: Reproceso idempotente

- **GIVEN** un evento de upsert ya aplicado al índice
- **WHEN** el mismo evento se consume de nuevo
- **THEN** el efecto en Meilisearch SHALL ser el mismo documento (sin duplicados por id)

#### Scenario: Feature search apagada no encola

- **GIVEN** `FEATURE_SEARCH=false`
- **WHEN** Ana actualiza una nota de postulación u otro agregado indexable
- **THEN** NO SHALL escribirse ningún evento `SearchUpsert` / `SearchDelete` en `outbox_events`
- **AND** el consumer, si recibe un job residual, SHALL hacer ack sin llamar a Meili

### Requirement: ACL de índice tras compartir / dejar de compartir

Los casos de uso de share `GroupLink`, unshare, delete `GroupLink` y los hooks de borrado de grupo SHALL emitir outbox
de búsqueda (con `FEATURE_SEARCH=true`) de modo que el worker recalcule `groupIds` y `visibilityScope` **desde Mongo**
y actualice o borre el documento. Tras unshare, los miembros del grupo NO SHALL seguir viendo ese hit; tras share,
SHALL poder verlo cuando el índice se haya aplicado.

#### Scenario: Share hace visible el preview en el grupo

- **GIVEN** Ana comparte un JobLink al grupo "Backend" donde Luis es miembro y `FEATURE_SEARCH=true`
- **WHEN** se procesa el upsert de indexación
- **THEN** el documento `job_preview` SHALL incluir el `groupId` de "Backend" en `groupIds`
- **AND** Luis SHALL poder encontrar ese preview buscando su título (tras indexar)

#### Scenario: Unshare quita el hit para miembros

- **GIVEN** un preview indexado visible en el grupo "Backend" y Luis miembro
- **WHEN** Ana deja de compartir ese link y se procesa el job de indexación
- **THEN** el documento SHALL ya no incluir ese `groupId` (o el doc de alcance de grupo SHALL borrarse según tipo)
- **AND** Luis NO SHALL obtener ese hit al buscar el mismo texto

### Requirement: Borrado del índice al borrar el agregado

Cuando se borra un agregado indexable (comentario, CV, postulación, roadmap, nota, relación de grupo, etc.), el sistema
SHALL encolar un borrado del documento Meilisearch correspondiente (si `FEATURE_SEARCH=true`). Si el borrado en Meili
falla de forma transitoria, SHALL reintentarse; si el documento ya no está, SHALL contarse como éxito.

#### Scenario: Borrar CV limpia el índice

- **GIVEN** un documento `cv:<cvId>` en Meilisearch
- **WHEN** Ana borra ese CV
- **THEN** tras procesar el job de borrado NO SHALL quedar ese documento en el índice

### Requirement: Vectores en el mismo documento Meili

Cada documento indexable SHALL poder almacenar un campo vectorial (embedding) generado por el módulo IA, además de los
campos de texto buscables. Si la generación del embedding falla o no hay proveedor disponible, el documento SHALL poder
indexarse igual en modo solo full-text, con una marca observable de `embeddingStatus` (`ready` | `missing` |
`failed`) para degradación honesta en la consulta.

#### Scenario: Indexación sin embedding

- **GIVEN** el proveedor de embeddings no disponible
- **WHEN** se indexa un preview
- **THEN** el documento SHALL existir en Meilisearch con texto buscable
- **AND** `embeddingStatus` SHALL ser `missing` o `failed` (no `ready`)

### Requirement: Backfill operativo

El sistema SHALL ofrecer un procedimiento documentado (comando o job administrativo) para reindexar el contenido
existente de un usuario o de todo el entorno, de modo que un índice vacío tras recrear Meilisearch pueda reconstruirse
desde Mongo sin pedir a las personas que reediten datos. El backfill SHALL respetar un rate limit configurable
(`SEARCH_BACKFILL_RATE` o equivalente) con default conservador en entorno local. Si cambia el modelo de embedding
activo, el procedimiento SHALL poder re-embedar documentos con `embedModelId` / dimensión distintos.

#### Scenario: Reindex tras volumen nuevo

- **GIVEN** Meilisearch vacío y Mongo con links y CVs de Ana
- **WHEN** se ejecuta el backfill documentado
- **THEN** los documentos visibles de Ana SHALL aparecer en el índice
