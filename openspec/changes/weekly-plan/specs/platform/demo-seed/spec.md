## ADDED Requirements

### Requirement: El dataset demo cubre las tres reglas de «Tu semana»

El seed demo SHALL incluir, además de lo existente, un link guardado por Ana y seguido con estado `saved` cuyo
`preview.expiresAt` sea la fecha UTC de la corrida más 3 días, fijado por el mismo camino de edición de preview que el
resto del dataset. Tras la corrida, el plan semanal de Ana SHALL contener exactamente una acción de cada regla:
`apply_before_close` para ese link, `follow_up` para la postulación quieta y `ask_know_someone` para el link marcado
por Bob. Para que el plan siga igual en corridas posteriores, cada corrida SHALL fijar `statusChangedAt` de la
postulación del link marcado por Bob a la hora de la corrida. Una segunda corrida SHALL mover `expiresAt` a la nueva
fecha + 3 sin duplicar links ni postulaciones.

#### Scenario: Ana ve su semana

- **GIVEN** Mongo local sin datos demo y guards OK
- **WHEN** se ejecuta `api:seed-demo` y Ana pide `GET /api/applications/weekly-plan`
- **THEN** SHALL recibir tres acciones con reglas `apply_before_close`, `follow_up` y `ask_know_someone`

#### Scenario: Segunda corrida

- **GIVEN** el seed ya aplicado hace 12 días
- **WHEN** se vuelve a ejecutar `api:seed-demo` y Ana pide el plan
- **THEN** el link que vence pronto SHALL tener `expiresAt` igual a hoy + 3 días
- **AND** el plan de Ana SHALL seguir teniendo una acción de cada regla, con `ask_know_someone` para el link marcado
  por Bob
- **AND** NO SHALL haber links ni postulaciones duplicadas
