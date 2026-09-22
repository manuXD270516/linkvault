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

**Cada tipo de evento SHALL tener su propia cola.** El relay SHALL resolver, a partir del `type` del evento, su cola, el
schema con el que se valida su contenido y la función que calcula su `jobId`, todo declarado en el contrato compartido
de ese evento. Un evento cuyo contenido no cumple su schema NO SHALL encolarse. Un evento de un tipo **desconocido** NO
SHALL publicarse en ninguna cola ni descartarse en silencio: SHALL quedar pendiente y terminar marcado como `failed` con
su aviso, como cualquier otro que no se pudo publicar.

Con el relay apagado por configuración, NO SHALL crearse ninguna cola ni ninguna conexión a Redis por esa vía, y los
eventos de todos los tipos SHALL esperar en `outbox_events`.

**La primera vez que un evento no se puede publicar SHALL registrarse un aviso** con su identificador, su tipo y el
motivo, y los reintentos siguientes de ese mismo evento NO SHALL repetirlo. Sin eso, un error nuestro —un `jobId` que la
cola rechaza, un tipo desconocido o un payload que no valida— quedaría invisible hasta el aviso de las 24 horas, y un
corte de la cola llenaría el registro con una línea por vuelta.

#### Scenario: Publicación correcta

- **GIVEN** un evento pendiente
- **WHEN** corre el relay
- **THEN** la cola SHALL recibir un job con el `jobId` determinista del evento
- **AND** el evento SHALL quedar marcado como publicado

#### Scenario: Cada evento a su cola

- **GIVEN** un evento de alta de link, uno de CV subido y uno de CV borrado, los tres pendientes
- **WHEN** corre el relay
- **THEN** cada uno SHALL publicarse en la cola de su tipo, con el `jobId` de su contrato
- **AND** ninguno SHALL aparecer en la cola de otro tipo

#### Scenario: Tipo desconocido

- **GIVEN** un evento pendiente con un `type` que el relay no conoce
- **WHEN** corre el relay
- **THEN** NO SHALL publicarse en ninguna cola
- **AND** SHALL seguir pendiente hasta agotarse a las 24 horas, con su aviso

#### Scenario: Contenido que no cumple su contrato

- **GIVEN** un evento pendiente cuyo payload no valida contra el schema de su tipo
- **WHEN** corre el relay
- **THEN** NO SHALL encolarse ningún job
- **AND** el evento SHALL seguir pendiente

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

El trabajo publicado en la cola SHALL consumirse exactamente una vez en efecto: el consumidor SHALL ser idempotente por
sí mismo, de modo que un evento republicado tras expirar la retención de la cola NO SHALL duplicar su efecto. Un job que
falla SHALL reintentarse según la política de su cola y, agotados los reintentos, SHALL quedar registrado como fallido
sin que el agregado al que sirve se quede sin explicación: ni un link en `pending` para siempre, ni un CV "en lectura"
eterno. Ningún consumidor SHALL descartar trabajo en silencio.

#### Scenario: Cola sin consumidor

- **GIVEN** el worker apagado
- **WHEN** se guarda un link y su evento se publica
- **THEN** el job SHALL quedar esperando en la cola y el link SHALL seguir en `pending`
- **AND** al arrancar el worker SHALL procesarse sin haberse perdido

#### Scenario: Job consumido

- **GIVEN** un link guardado y su evento publicado
- **WHEN** el worker consume el job
- **THEN** el link SHALL dejar de estar en `pending`

#### Scenario: Evento republicado tras la retención

- **GIVEN** un job ya consumido y olvidado por la retención de la cola
- **WHEN** su evento vuelve a publicarse
- **THEN** el efecto SHALL ser el mismo que tras la primera vez

#### Scenario: Job que agota sus reintentos

- **GIVEN** un job cuyo procesamiento falla siempre
- **WHEN** se agotan sus reintentos
- **THEN** SHALL quedar registrado como fallido
- **AND** el agregado al que sirve SHALL quedar con un estado que explique que no se pudo procesar

### Requirement: Cola(s) de notificación

Los eventos de integración de notificación de este change SHALL declararse en el contrato compartido con cola propia,
schema zod y `jobId` determinista, igual que el resto de tipos del outbox. El relay SHALL publicarlos cuando esté
habilitado; con relay apagado SHALL permanecer pendientes en `outbox_events`.

#### Scenario: Tipo de notificación en el registro

- **WHEN** existe un evento pendiente de tipo de notificación de producto
- **THEN** el relay (encendido) SHALL publicarlo en su cola con `jobId` determinista
- **AND** un tipo desconocido seguirá la regla general de `failed` sin silencio

