## ADDED Requirements

### Requirement: Retención de los eventos publicados

Un evento de `outbox_events` marcado como publicado SHALL borrarse automáticamente cuando hayan pasado 7 días desde su
`publishedAt`. Un evento pendiente o agotado NO SHALL borrarse nunca por esta retención. La retención de los publicados
SHALL ser mayor o igual que la retención de los jobs fallidos de todas las colas que alimenta el relay, de modo que un
job fallido que siga en su cola conserve su evento.

#### Scenario: Publicado hace más de 7 días

- **GIVEN** un evento con `publishedAt` de hace 8 días
- **WHEN** corre el monitor de caducidad de Mongo
- **THEN** el evento SHALL desaparecer de `outbox_events`

#### Scenario: Publicado reciente

- **GIVEN** un evento con `publishedAt` de hace 6 días
- **WHEN** corre el monitor de caducidad de Mongo
- **THEN** el evento SHALL seguir en `outbox_events`

#### Scenario: Pendiente antiguo

- **GIVEN** un evento pendiente creado hace 10 días con el relay apagado
- **WHEN** corre el monitor de caducidad de Mongo
- **THEN** el evento SHALL seguir pendiente
- **AND** al encender el relay SHALL publicarse

#### Scenario: Agotado antiguo

- **GIVEN** un evento marcado como `failed` hace 30 días
- **WHEN** corre el monitor de caducidad de Mongo
- **THEN** el evento SHALL seguir en `outbox_events` con su `failedAt`

#### Scenario: Retenciones coherentes

- **GIVEN** la retención de los publicados y la de los jobs fallidos de cada cola del relay
- **WHEN** se comprueban en los tests
- **THEN** la de los publicados SHALL ser mayor o igual que cada una de las otras
