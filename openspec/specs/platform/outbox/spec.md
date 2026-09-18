# platform/outbox Specification

## Purpose

Garantiza que ningún trabajo en segundo plano se pierda ni se duplique por culpa de dos escrituras separadas: lo que se
guarda en Mongo y lo que se encola en BullMQ se deciden en la misma transacción (ADR-009).

## Requirements

### Requirement: Evento escrito con el agregado

Un caso de uso que deba encolar trabajo SHALL escribir su agregado y el evento en `outbox_events` dentro de la misma
transacción de Mongo, y NO SHALL publicar en la cola dentro de ella. Si la transacción falla, NO SHALL quedar ni el
agregado ni el evento.

#### Scenario: Alta con evento

- **WHEN** se guarda un link nuevo
- **THEN** SHALL existir el link, su relación con el grupo y un evento pendiente en `outbox_events`

#### Scenario: Fallo al escribir el evento

- **GIVEN** que la escritura del evento falla
- **WHEN** termina la petición
- **THEN** NO SHALL quedar ningún link creado por esa petición

#### Scenario: Cola caída al guardar

- **GIVEN** Redis no disponible
- **WHEN** se guarda un link
- **THEN** la respuesta SHALL ser `201`
- **AND** el evento SHALL quedar pendiente en `outbox_events`

### Requirement: Publicación por el relay

Un relay SHALL tomar periódicamente los eventos pendientes cuyo momento de reintento ya pasó, en orden de creación,
publicarlos en su cola con un `jobId` determinista derivado del evento y marcarlos como publicados solo cuando la cola
confirma. Un evento cuya publicación falla SHALL seguir pendiente y reintentarse con espera creciente (1 s, 2 s, 4 s… con
un tope de 5 minutos), de modo que un corte de la cola de minutos u horas NO SHALL agotar sus intentos. Solo tras 24 horas
sin conseguir publicarlo SHALL marcarse como `failed` y registrarse un aviso con el identificador del evento, sin datos
del usuario.

#### Scenario: Publicación correcta

- **GIVEN** un evento pendiente
- **WHEN** corre el relay
- **THEN** la cola SHALL recibir un job con el `jobId` determinista del evento
- **AND** el evento SHALL quedar marcado como publicado

#### Scenario: Reintento tras un fallo de la cola

- **GIVEN** un evento pendiente y la cola rechazando publicaciones
- **WHEN** corre el relay varias veces y después la cola vuelve
- **THEN** el evento SHALL publicarse en cuanto su espera venza
- **AND** SHALL publicarse una sola vez

#### Scenario: Corte largo de la cola

- **GIVEN** un evento pendiente y la cola caída durante una hora
- **WHEN** la cola vuelve
- **THEN** el evento SHALL publicarse y NO SHALL estar marcado como `failed`

#### Scenario: Evento agotado

- **GIVEN** un evento que lleva más de 24 horas sin poder publicarse
- **WHEN** corre el relay de nuevo
- **THEN** el evento SHALL quedar como `failed` y NO SHALL volver a intentarse
- **AND** el aviso registrado SHALL contener el identificador del evento y ningún dato personal

### Requirement: Entrega idempotente

El `jobId` SHALL ser determinista para el mismo evento, de modo que publicarlo dos veces mientras el job sigue en la cola
NO SHALL producir dos jobs. Como la cola olvida los jobs completados pasado su periodo de retención, la garantía última
SHALL ser que el consumidor pueda ejecutarse más de una vez sobre el mismo evento sin efectos adicionales; el consumidor
de cada cola SHALL documentar y probar esa idempotencia.

#### Scenario: Relay que publica dos veces

- **GIVEN** un evento ya publicado cuya marca no se guardó
- **WHEN** el relay lo vuelve a publicar
- **THEN** la cola SHALL contener un solo job para ese evento

### Requirement: El trabajo encolado no se pierde

Mientras ningún consumidor procese la cola, sus jobs SHALL permanecer en ella, y los links afectados SHALL seguir con
`previewStatus` `pending`, de modo que el change que implemente el consumidor pueda procesarlos. El worker NO SHALL
registrar un consumidor que descarte trabajo.

#### Scenario: Cola sin consumidor

- **GIVEN** un link guardado y su evento publicado
- **WHEN** se inspecciona el worker
- **THEN** NO SHALL existir ningún consumidor registrado para esa cola
- **AND** el `previewStatus` del link SHALL seguir siendo `pending`
