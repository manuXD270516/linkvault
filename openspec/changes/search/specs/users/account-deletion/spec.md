## MODIFIED Requirements

### Requirement: Cascada atómica de datos personales

El borrado exitoso SHALL ocurrir en una misma unidad de commit / transacción multi-documento donde aplique (Mongo
replica set), de modo que un fallo a mitad NO SHALL dejar al usuario a medias. La cascada SHALL eliminar o deshacer, al
menos:

- el documento de usuario;
- todas sus sesiones (refresh / sesiones activas);
- tokens de email pendientes (`auth_email_tokens` o colección equivalente de verificación y reset) de esa persona;
- preferencias de notificación, suscripciones web push y filas de ledger de entregas (`notification_deliveries` o
  equivalente) de esa persona;
- membresías: ver regla de ownership más abajo; el borrado de grupos permitidos SHALL reutilizar `GroupDeletionHooks`
  con la sesión Mongo de la txn inyectada (un solo camino);
- postulaciones (`applications`) y sus eventos asociados;
- `group_link_comments` de esa persona (**borrar**, no anonimizar); al borrar, SHALL actualizar `commentCount` y
  `commentsRevision` en las `group_links` afectadas como el procedimiento del RUNBOOK (ADR-026);
- `$unset` de `note` en `group_links` donde `sharedBy` es esa persona (la relación MAY permanecer);
- `publicShare` de las relaciones que esa persona publicó (unset / despublicar; ver `links/public-share`);
- `user_links` de esa persona (`deleteMany` por `userId`);
- `cv_documents`, contadores de CV asociados y objetos S3 bajo el prefijo `userId/` del bucket de CV;
- `ai_analyses` de esa persona;
- filas de `ai_usage` de esa persona (**DELETE**, sin residuo);
- `user_ai_keys`;
- roadmaps de esa persona;
- `ai_feedback` de esa persona;
- **documentos de Meilisearch** atribuibles a esa persona (al menos `application`, `cv`, `roadmap`, previews/alcance
  privado, comentarios y notas suyas) y los documentos cuyo único alcance era un grupo borrado en la misma cascada.

**Purga Meilisearch (FEATURE_SEARCH):**

- Cuando `FEATURE_SEARCH=true`, el sistema SHALL ejecutar **delete-by-filter** en Meilisearch (`ownerUserId` de la
  persona y documentos de grupos que la cascada va a eliminar) **antes** de committear la cascada Mongo destructiva.
  Solo tras purge OK MAY completarse el borrado Mongo y devolver `204`. Si Meilisearch es inalcanzable o el
  delete-by-filter falla, la API SHALL responder `503` con código estable `search_purge_failed`, NO SHALL devolver
  `204`, y la cuenta / datos Mongo SHALL permanecer intactos.
- Cuando `FEATURE_SEARCH=false`, la cascada SHALL omitir la purga Meili.
- Jobs BullMQ / outbox de indexación en vuelo: los consumers SHALL hacer **ack** si el usuario o el agregado ya no
  existe; el comportamiento SHALL documentarse en design/RUNBOOK.

Los objetos del almacén bajo `userId/` SHALL borrarse como parte del caso de uso o en el mismo flujo atómico documentado;
si el object store falla tras la txn de Mongo, el RUNBOOK SHALL documentar la recogida, pero el caso feliz SHALL borrar
ambos.

#### Scenario: Cascada completa en una txn

- **GIVEN** Ana con sesión, membresía, postulación, comentario, nota en un link que compartió, `user_links`, CV en S3,
  análisis, filas en `ai_usage`, clave BYOK, roadmap, feedback, tokens de email pendientes, preferencias de
  notificación, suscripción push, filas de ledger de entregas y documentos correspondientes en Meilisearch
- **AND** `FEATURE_SEARCH=true` y Meilisearch saludable
- **WHEN** borra la cuenta con contraseña correcta
- **THEN** tras el `204` NO SHALL quedar documento de usuario, sesión, membresía de Ana, postulación/eventos,
  comentarios de Ana, `user_links` de Ana, CV/contadores, `ai_analyses`, filas `ai_usage`, `user_ai_keys`, roadmap,
  `ai_feedback`, tokens de email, preferencias de notificación, suscripciones push ni ledger de entregas de Ana
- **AND** el prefijo de objetos `userId/` de Ana en el bucket de CV SHALL quedar vacío
- **AND** las `group_links` donde Ana era `sharedBy` NO SHALL conservar `note`
- **AND** NO SHALL quedar en Meilisearch documentos atribuibles a Ana (`cv` / `application` / `roadmap` / comentarios
  / notas / previews de alcance suyo) ni docs cuyo único alcance era un grupo borrado en la cascada
- **AND** una búsqueda autenticada como otra persona NO SHALL devolver hits cuyo único dueño era Ana

#### Scenario: Comentarios se borran y contadores se actualizan

- **GIVEN** Ana con un comentario en un link de grupo cuyo `commentCount` era 3
- **WHEN** borra la cuenta
- **THEN** ese comentario SHALL eliminarse
- **AND** NO SHALL quedar un comentario anonimizado con su `userId`
- **AND** el `commentCount` de esa relación SHALL decrementar en lo borrado y `commentsRevision` SHALL incrementar

#### Scenario: user_links eliminados

- **GIVEN** Ana con entradas en `user_links`
- **WHEN** borra la cuenta
- **THEN** NO SHALL quedar ninguna fila de `user_links` con su `userId`

#### Scenario: ai_usage sin residuo

- **GIVEN** Ana con filas en `ai_usage`
- **WHEN** borra la cuenta
- **THEN** NO SHALL quedar filas de `ai_usage` con su `userId`

#### Scenario: Índice de búsqueda purgado antes del 204

- **GIVEN** `FEATURE_SEARCH=true`, Meilisearch saludable, Ana con documentos Meili (`cv`, `application`, comentario de
  grupo visible a Luis)
- **WHEN** Ana borra la cuenta con contraseña correcta
- **THEN** el delete-by-filter en Meili SHALL completarse **antes** del commit de la cascada Mongo
- **AND** la API SHALL responder `204` solo después de esa purga y de la cascada Mongo
- **AND** Luis NO SHALL encontrar el comentario de Ana al buscar su texto
- **AND** NO SHALL existir en Meilisearch documentos `cv` / `application` / `roadmap` de Ana

#### Scenario: Meili caído bloquea el 204 de borrado

- **GIVEN** `FEATURE_SEARCH=true` y Meilisearch inalcanzable
- **WHEN** Ana intenta borrar la cuenta con contraseña correcta
- **THEN** la API SHALL responder `503` con código `search_purge_failed`
- **AND** NO SHALL haberse completado el borrado de cuenta como éxito observable (`204`)
- **AND** el documento de usuario de Ana y sus sesiones SHALL seguir existiendo en Mongo

#### Scenario: Feature search apagada omite purga Meili

- **GIVEN** `FEATURE_SEARCH=false`
- **WHEN** Ana borra la cuenta con contraseña correcta
- **THEN** la cascada Mongo SHALL completarse sin llamar a Meilisearch
- **AND** la API MAY responder `204` sin exigir purge de índice

#### Scenario: Fallo a mitad no deja residuos parciales

- **GIVEN** una escritura de la cascada que falla dentro de la unidad de commit
- **WHEN** la API responde error
- **THEN** el usuario y sus datos principales SHALL seguir existiendo de forma consistente
- **AND** Ana SHALL poder volver a intentar el borrado
