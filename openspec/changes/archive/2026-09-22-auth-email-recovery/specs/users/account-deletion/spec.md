## MODIFIED Requirements

### Requirement: Cascada atómica de datos personales

El borrado exitoso SHALL ocurrir en una misma unidad de commit / transacción multi-documento donde aplique (Mongo
replica set), de modo que un fallo a mitad NO SHALL dejar al usuario a medias. La cascada SHALL eliminar o deshacer, al
menos:

- el documento de usuario;
- todas sus sesiones (refresh / sesiones activas);
- tokens de email pendientes (`auth_email_tokens` o colección equivalente de verificación y reset) de esa persona;
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
- `ai_feedback` de esa persona.

Los objetos del almacén bajo `userId/` SHALL borrarse como parte del caso de uso o en el mismo flujo atómico documentado;
si el object store falla tras la txn de Mongo, el RUNBOOK SHALL documentar la recogida, pero el caso feliz SHALL borrar
ambos.

Jobs BullMQ en vuelo cuyo `userId` ya no existe tras el borrado: los consumers SHALL hacer **ack** (no reintentar de
forma indefinida); el comportamiento SHALL documentarse en design/RUNBOOK.

#### Scenario: Cascada completa en una txn

- **GIVEN** Ana con sesión, membresía, postulación, comentario, nota en un link que compartió, `user_links`, CV en S3,
  análisis, filas en `ai_usage`, clave BYOK, roadmap, feedback y tokens de email pendientes
- **WHEN** borra la cuenta con contraseña correcta
- **THEN** tras el `204` NO SHALL quedar documento de usuario, sesión, membresía de Ana, postulación/eventos,
  comentarios de Ana, `user_links` de Ana, CV/contadores, `ai_analyses`, filas `ai_usage`, `user_ai_keys`, roadmap,
  `ai_feedback` ni tokens de email de Ana
- **AND** el prefijo de objetos `userId/` de Ana en el bucket de CV SHALL quedar vacío
- **AND** las `group_links` donde Ana era `sharedBy` NO SHALL conservar `note`

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

#### Scenario: Fallo a mitad no deja residuos parciales

- **GIVEN** una escritura de la cascada que falla dentro de la unidad de commit
- **WHEN** la API responde error
- **THEN** el usuario y sus datos principales SHALL seguir existiendo de forma consistente
- **AND** Ana SHALL poder volver a intentar el borrado
