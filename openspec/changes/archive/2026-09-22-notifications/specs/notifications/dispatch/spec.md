## Purpose

Define cómo LinkVault decide destinatarios y entrega avisos de producto (email y web push) de forma asíncrona e
idempotente, sin revertir el hecho de negocio si un canal falla.

## ADDED Requirements

### Requirement: Fan-out tras hechos HTTP

Cuando ocurra un disparador HTTP V0 (`group_new_link`, `application_status_group`), la **api** SHALL escribir en
`outbox_events` **un** evento de fan-out **en la misma unidad de commit** que el hecho. El worker expandirá destinatarios
y entregas. NO SHALL enviar email ni push dentro de la petición HTTP. Un fallo posterior del canal NO SHALL deshacer el
hecho ya confirmado.

El disparador `application_stale` NO SHALL usar este requisito: sigue `notifications/stale-applications` (claim +
`Queue.add` en el worker, sin `outbox_events`).

#### Scenario: Nuevo link encola sin enviar en el request

- **GIVEN** un miembro guarda una URL en un grupo con relación nueva
- **WHEN** la API responde `201`
- **THEN** SHALL existir al menos un evento de notificación pendiente en `outbox_events`
- **AND** el cuerpo de la respuesta NO SHALL depender de que Mailpit o el push hayan entregado nada

#### Scenario: Fallo de Mailer no tumba el hecho

- **GIVEN** un job de entrega cuyo adaptador de email rechaza el envío
- **WHEN** el worker agota o registra el fallo del canal email
- **THEN** el link (o el cambio de estado) SHALL seguir existiendo
- **AND** el sistema MAY reintentar el job según la política de la cola sin revertir Mongo del hecho

### Requirement: Destinatarios de nuevo link en grupo

Para `group_new_link`, los destinatarios SHALL ser **todos los miembros actuales del grupo**, incluido quien guardó el
link, excepto: (1) quien tenga opt-out del tipo `group_new_link`; (2) quien tenga `notifyOwnActions=false` y sea el
actor del hecho; (3) cuentas sin `emailVerified` para el canal email (el push MAY enviarse si hay suscripción activa y el
tipo no está en opt-out).

#### Scenario: Incluye al autor por defecto

- **GIVEN** Ana y Beto miembros; Ana con preferencias por defecto
- **WHEN** Ana guarda un link nuevo en el grupo
- **THEN** el fan-out SHALL incluir a Ana y a Beto como destinatarios candidatos

#### Scenario: Opt-out de propias acciones

- **GIVEN** Ana con `notifyOwnActions` `false`
- **WHEN** Ana guarda un link nuevo en el grupo
- **THEN** Ana NO SHALL ser destinataria de ese aviso
- **AND** Beto SHALL seguir siendo candidato si no optó out

### Requirement: Destinatarios de cambio de estado al grupo

Para `application_status_group`, solo SHALL encolarse fan-out si la postulación tiene `visibility` `group` y el hecho
es un cambio de **estado canónico** (un cambio solo de `stageLabel` NO SHALL encolar). Por defecto, los destinatarios
SHALL ser la **unión** de miembros de los grupos donde el `linkId` está compartido y el dueño es miembro (deduplicando
`userId`), evaluados al **procesar** el job (membership actual). Alcance:

1. Si el evento trae `groupId`, solo ese grupo (**y** el `groupId` SHALL ser válido: relación link↔grupo existente y
   actor miembro; si no, la api NO SHALL encolar — ver applications/tracking).
2. Si no, y la preferencia `applicationStatusGroupId` está definida, solo ese grupo **si** el `linkId` está en ese
   grupo; si la intersección es vacía, NO SHALL avisarse.
3. Si no, unión.

Excepciones: opt-out del tipo; `notifyOwnActions=false` para el actor; email solo si `emailVerified`. Los payloads de
email/push de este tipo NO SHALL incluir `stageLabel`, notas ni historial.

#### Scenario: Privada no avisa al grupo

- **GIVEN** Ana con postulación `private` en un link del grupo
- **WHEN** Ana cambia el estado
- **THEN** NO SHALL encolarse fan-out `application_status_group` hacia otros miembros

#### Scenario: Solo etapa no avisa

- **GIVEN** Ana con postulación `visibility` `group` en `in_process`
- **WHEN** Ana cambia solo el `stageLabel`
- **THEN** NO SHALL encolarse `application_status_group`

#### Scenario: Compartida avisa a la unión de grupos

- **GIVEN** Ana con postulación `visibility` `group` y el link en dos grupos donde ella es miembro
- **WHEN** Ana pasa de `applied` a `in_process` sin `groupId` en el evento y sin pref de alcance
- **THEN** SHALL encolarse fan-out hacia los miembros candidatos de la unión de ambos grupos

#### Scenario: Acotado por evento groupId

- **GIVEN** el mismo enlace en dos grupos
- **WHEN** el cambio de estado se despacha con `groupId` del grupo A
- **THEN** solo los miembros candidatos del grupo A SHALL ser destinatarios

#### Scenario: Acotado por preferencia

- **GIVEN** Ana con `applicationStatusGroupId` = grupo A y evento sin `groupId`
- **WHEN** cambia el estado canónico compartido
- **THEN** solo el grupo A SHALL usarse para destinatarios

#### Scenario: Payload sin etapa

- **WHEN** se renderiza el email o push de `application_status_group`
- **THEN** el cuerpo NO SHALL contener `stageLabel` ni notas privadas
### Requirement: Aviso de postulación estancada solo al dueño

Para `application_stale`, el único destinatario candidato SHALL ser el `userId` dueño de la postulación (B4). NO SHALL
notificarse a otros miembros del grupo por este tipo.

#### Scenario: Solo el dueño

- **GIVEN** una postulación de Ana marcada estancada
- **WHEN** se despacha `application_stale`
- **THEN** el único destinatario candidato SHALL ser Ana

### Requirement: Entrega por canales independientes

Cada destinatario elegible SHALL poder recibir el aviso por **email** (si `emailVerified` y el tipo no está en opt-out) y
por **web push** (si tiene al menos una suscripción activa y el tipo no está en opt-out). Fallar un canal NO SHALL
impedir intentar el otro para el mismo destinatario en el mismo ciclo de entrega.

#### Scenario: Email sin push

- **GIVEN** Beto verificado, sin suscripciones push, tipo habilitado
- **WHEN** llega un `group_new_link` para Beto
- **THEN** SHALL intentarse el email
- **AND** NO SHALL fallar el job solo porque no haya push

#### Scenario: Push sin email verificado

- **GIVEN** Carla con `emailVerified` `false` y una suscripción push activa
- **WHEN** llega un aviso de tipo habilitado
- **THEN** SHALL intentarse el push
- **AND** NO SHALL enviarse email de producto a Carla

### Requirement: Idempotencia de entrega

Antes de enviar por un canal, el worker SHALL registrar o reclamar una entrega en un almacén durable keyed por tipo de
aviso + clave del hecho + `userId` + canal. Si la entrega ya está completada, NO SHALL reenviar. El `jobId` de BullMQ
MAY deduplicar trabajos en vuelo pero NO SHALL ser la única garantía tras `removeOnComplete`.

#### Scenario: Reproceso tras completar

- **GIVEN** una entrega email ya marcada completada para Ana y un hecho H
- **WHEN** el mismo job se vuelve a ejecutar
- **THEN** NO SHALL enviarse otro email a Ana por H
- **AND** el job SHALL terminar sin error de negocio

#### Scenario: Mismo jobId en vuelo

- **WHEN** el relay o el producer publica dos veces el mismo trabajo mientras sigue en la cola
- **THEN** BullMQ MAY deduplicar por `jobId` determinista
