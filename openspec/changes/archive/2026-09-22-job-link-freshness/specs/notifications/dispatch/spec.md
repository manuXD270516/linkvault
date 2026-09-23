## ADDED Requirements

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
