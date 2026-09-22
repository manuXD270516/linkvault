## Purpose

Produce el evento `ApplicationStale.v1` cuando una postulación activa lleva N días sin cambio de estado ni de etapa, y
dispara el aviso al dueño (B4), cerrando el hueco de “solo modelado” en applications-tracking.

## ADDED Requirements

### Requirement: Detección periódica

Un proceso del **worker** SHALL recorrer periódicamente postulaciones en estados **no cerrados** (alineado a
`CLOSED_STATUSES` / `isClosedStatus` del dominio de applications) cuyo `statusChangedAt` tenga al menos
`APPLICATION_STALE_AFTER_DAYS` (10) días de antigüedad, y para cada una elegible SHALL reclamar una marca durable y
encolar el aviso al dueño vía cola BullMQ (**sin** escribir `outbox_events` desde el worker). La detección NO SHALL usar
`updatedAt` (ADR-024).

#### Scenario: Cumple 10 días

- **GIVEN** una postulación `applied` de Ana con `statusChangedAt` hace 10 días
- **WHEN** corre el detector
- **THEN** SHALL reclamarse la marca de stale y encolarse el aviso hacia Ana

#### Scenario: Nota no reinicia el reloj

- **GIVEN** Ana edita solo la nota ayer y el estado no cambió en 10 días
- **WHEN** corre el detector
- **THEN** la postulación SHALL seguir siendo elegible por `statusChangedAt`

#### Scenario: Cerrada no se avisa

- **GIVEN** una postulación en estado cerrado (`rejected` u otro de `CLOSED_STATUSES`) con `statusChangedAt` antiguo
- **WHEN** corre el detector
- **THEN** NO SHALL encolarse aviso de stale para ella

### Requirement: Un aviso por estancamiento

Tras emitir stale para una postulación, el sistema NO SHALL reemitir otro `ApplicationStale.v1` para la misma
postulación hasta que ocurra un nuevo cambio de estado o etapa (nuevo `statusChangedAt`). El design documentará la marca
de dedupe (campo o colección).

#### Scenario: Segunda pasada del cron

- **GIVEN** ya se emitió stale para la postulación P sin cambio de estado posterior
- **WHEN** el detector vuelve a correr
- **THEN** NO SHALL emitirse otro `ApplicationStale.v1` para P

### Requirement: Despacho al dueño

La emisión de `ApplicationStale.v1` SHALL encolar la entrega de notificación tipo `application_stale` hacia el dueño
según `notifications/dispatch` y preferencias.

#### Scenario: Dueño con opt-out

- **GIVEN** Ana con `application_stale` en opt-out
- **WHEN** se emite stale de su postulación
- **THEN** NO SHALL enviarse email ni push de ese tipo a Ana
