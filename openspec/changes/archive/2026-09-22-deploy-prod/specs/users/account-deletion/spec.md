## Purpose

Permite a una persona borrar su cuenta de forma autenticada, con reintroducción de contraseña y cascada atómica de sus
datos personales, de modo que tras el éxito no queden sesiones ni residuos identificables bajo su identidad en el producto.

## ADDED Requirements

### Requirement: Borrar mi cuenta con reintroducción de contraseña

`DELETE /api/users/me` SHALL exigir un access token válido y un cuerpo JSON `{ "password": "<contraseña actual>" }`. Si
la contraseña coincide, SHALL ejecutar la cascada de borrado de este capability y responder `204`. Si la contraseña no
coincide, SHALL responder `401` con código `invalid_credentials` (equivalente a rechazar la confirmación; NO SHALL
usar un cuerpo distinto que permita enumerar cuentas). Sin sesión válida, SHALL responder `401`. Un cuerpo inválido
SHALL responder `400` nombrando el campo.

#### Scenario: Borrado correcto

- **GIVEN** Ana autenticada con contraseña correcta y sin grupos bloqueantes
- **WHEN** llama a `DELETE /api/users/me` con `{ "password": "<su contraseña>" }`
- **THEN** la respuesta SHALL ser `204`
- **AND** un login posterior con el mismo email SHALL fallar como cuenta inexistente o credenciales inválidas
  (`invalid_credentials`)

#### Scenario: Contraseña incorrecta

- **GIVEN** Ana autenticada
- **WHEN** llama a `DELETE /api/users/me` con una contraseña incorrecta
- **THEN** la respuesta SHALL ser `401` con código `invalid_credentials`
- **AND** NO SHALL borrarse el usuario ni sus datos

#### Scenario: Sin sesión

- **GIVEN** una petición sin access token válido
- **WHEN** llama a `DELETE /api/users/me`
- **THEN** la respuesta SHALL ser `401`
- **AND** NO SHALL borrarse ningún usuario

### Requirement: Cascada atómica de datos personales

El borrado exitoso SHALL ocurrir en una misma unidad de commit / transacción multi-documento donde aplique (Mongo
replica set), de modo que un fallo a mitad NO SHALL dejar al usuario a medias. La cascada SHALL eliminar o deshacer, al
menos:

- el documento de usuario;
- todas sus sesiones (refresh / sesiones activas);
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
  análisis, filas en `ai_usage`, clave BYOK, roadmap y feedback
- **WHEN** borra la cuenta con contraseña correcta
- **THEN** tras el `204` NO SHALL quedar documento de usuario, sesión, membresía de Ana, postulación/eventos,
  comentarios de Ana, `user_links` de Ana, CV/contadores, `ai_analyses`, filas `ai_usage`, `user_ai_keys`, roadmap ni
  `ai_feedback` de Ana
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

### Requirement: Regla de ownership al borrar

Antes de borrar, la API SHALL evaluar los grupos donde la persona es `owner`:

- Si es el **único owner** de un grupo que **tiene otros miembros**, el borrado SHALL **bloquearse** con `409` y un
  código estable documentado (p. ej. `sole_owner_with_members`), sin mutar datos.
- Si es el único miembro del grupo (owner único y sin otros miembros), SHALL **borrar el grupo** (y sus datos de grupo
  asociados según las cascadas ya definidas del dominio, vía `GroupDeletionHooks` en la misma sesión) dentro de la misma
  unidad de commit.

#### Scenario: Owner único con otros miembros

- **GIVEN** Ana como única owner del grupo "Backend" donde también está Luis
- **WHEN** intenta borrar su cuenta con contraseña correcta
- **THEN** la respuesta SHALL ser `409`
- **AND** el grupo, Ana y Luis SHALL seguir existiendo

#### Scenario: Owner único y único miembro

- **GIVEN** Ana como única owner y única miembro del grupo "Personal"
- **WHEN** borra su cuenta con contraseña correcta
- **THEN** la respuesta SHALL ser `204`
- **AND** el grupo "Personal" SHALL haberse eliminado junto con la cuenta

### Requirement: Sesiones invalidadas tras el borrado

Tras un `204` de borrado, todas las sesiones de esa persona SHALL quedar invalidadas. Un refresh o un access token
previos NO SHALL poder usarse. Un intento de login con el email y la contraseña anteriores SHALL responder como
credenciales inválidas / cuenta inexistente, sin revelar si el email existió.

#### Scenario: No se puede seguir con la sesión

- **GIVEN** Ana acaba de borrar la cuenta recibiendo `204`
- **WHEN** reutiliza el access token anterior contra una ruta autenticada
- **THEN** SHALL responder `401`
- **AND** un login con el mismo email y contraseña NO SHALL abrir sesión
