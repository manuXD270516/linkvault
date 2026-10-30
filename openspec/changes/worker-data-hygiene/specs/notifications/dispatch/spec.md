## ADDED Requirements

### Requirement: Una entrega en vuelo se reintenta al vencer su lease

Cuando un job de avisos (`notify-fanout` o el digest semanal de grupo) encuentra una entrega del registro de
idempotencia en `claimed` dentro de su lease, el worker NO SHALL terminar el job dando esa entrega por resuelta: SHALL
procesar el resto de entregas del job y SHALL aplazar el job hasta después de que venza ese lease, sin gastar un intento
de la cola. En la nueva ejecución, las entregas ya completadas NO SHALL reenviarse. El número de aplazamientos por job
SHALL estar acotado; al agotarlo, el worker SHALL registrar un aviso con la cola, el `jobId` y el número de entregas en
vuelo, sin destinatarios ni direcciones de correo, y terminar el job.

#### Scenario: El worker murió a mitad de una entrega

- **GIVEN** una entrega email de Ana para el hecho H en `claimed` desde hace 1 minuto, con un lease de 5 minutos, cuyo worker murió antes de completarla
- **WHEN** el job recuperado vuelve a ejecutarse y encuentra la entrega en vuelo
- **THEN** el job SHALL aplazarse hasta después de que venza el lease
- **AND** en la ejecución aplazada la entrega SHALL retomarse y Ana SHALL recibir un email por H

#### Scenario: Quien la tenía terminó entretanto

- **GIVEN** un job aplazado porque la entrega de Ana para H estaba en vuelo
- **WHEN** el otro proceso completa esa entrega antes de que el job vuelva a ejecutarse
- **THEN** en la ejecución aplazada NO SHALL enviarse otro email a Ana por H

#### Scenario: Tope de aplazamientos

- **GIVEN** un job que ya se aplazó el número máximo de veces y sigue encontrando una entrega en vuelo
- **WHEN** vuelve a ejecutarse
- **THEN** el job SHALL terminar sin aplazarse
- **AND** SHALL registrarse un aviso con la cola, el `jobId` y el número de entregas en vuelo, sin direcciones de correo ni `userId`

## MODIFIED Requirements

### Requirement: Auto-expire de vacante cerrada sin outbox

Además de `application_stale`, el disparador `application_status_group` originado por **auto-expire
al cerrar una vacante** (worker) SHALL usar el mismo patrón de fiabilidad que stale: **claim/lease**
→ `Queue.add` de `ApplicationStatusNotify.v1` → **confirm** al add OK; si el add falla, **release**
del claim para que una pasada posterior reencole. NO SHALL escribir `outbox_events`. Los cambios de
estado iniciados por HTTP en la api siguen el fan-out con outbox.

`actorUserId` SHALL ser el `userId` dueño de la postulación. El `jobId` SHALL ser el de
`applicationStatusNotifyJobId` (tres segmentos). El claim NO SHALL borrarse solo porque el status
ya es `expired`: un expire confirmado en Mongo con notify aún pendiente SHALL seguir siendo
reencolable.

La selección por pasada de los links cerrados con trabajo de cascada pendiente (postulaciones abiertas o expiradas de
grupo sin ASN confirmada) SHALL acotarse **después** de descartar los links abiertos y las postulaciones cuya ASN ya
está confirmada: un link cerrado pendiente SHALL aparecer en la pasada aunque haya más links abiertos con postulaciones,
o más links cerrados ya avisados, que el límite de la pasada.

#### Scenario: Cierre con visibility group encola sin outbox

- **GIVEN** una postulación `visibility=group` que pasa a `expired` por cierre de vacante
- **WHEN** el claim y el `Queue.add` terminan OK
- **THEN** SHALL existir un job `ApplicationStatusNotify.v1` en la cola
- **AND** NO SHALL haberse escrito ese fan-out en `outbox_events`
- **AND** `actorUserId` SHALL ser el dueño
- **AND** el claim SHALL quedar confirmado

#### Scenario: Queue.add falla deja el notify reclamable

- **GIVEN** una postulación `visibility=group` ya en `expired` tras el cierre, con claim de notify
  pendiente
- **WHEN** `Queue.add` falla y se hace release del claim
- **THEN** una pasada posterior SHALL poder volver a reclamar y encolar el ASN
- **AND** NO SHALL haberse perdido el aviso solo por estar ya `expired`

#### Scenario: Opt-out de propias acciones aplica al dueño

- **GIVEN** Ana con `notifyOwnActions` `false` y postulación `visibility=group` auto-expirada
- **WHEN** se expanden destinatarios del ASN
- **THEN** Ana NO SHALL ser destinataria por ser el `actorUserId`
- **AND** los demás miembros del grupo con el tipo activo sí MAY serlo

#### Scenario: Link cerrado detrás de más de cuatro lotes de links abiertos

- **GIVEN** 201 links abiertos con postulaciones abiertas y un link cerrado L con una postulación abierta, con un límite de 50 links por pasada
- **WHEN** corre una pasada de la cascada de frescura
- **THEN** L SHALL estar entre los links seleccionados
- **AND** su postulación abierta SHALL pasar a `expired`

#### Scenario: Link cerrado ya avisado no tapa a uno pendiente

- **GIVEN** 201 links cerrados cuyas postulaciones de grupo están `expired` con su ASN confirmada, y un link cerrado L con una postulación abierta, con un límite de 50 links por pasada
- **WHEN** corre una pasada de la cascada de frescura
- **THEN** L SHALL estar entre los links seleccionados
- **AND** ninguno de los 201 links ya avisados SHALL volver a encolar un ASN
