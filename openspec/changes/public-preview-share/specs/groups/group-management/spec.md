## ADDED Requirements

### Requirement: Visibilidad por defecto de los links del grupo

Cada grupo SHALL tener un ajuste `defaultVisibility` con los valores `public` y `private`, que decide si un link que
**entra** en el grupo a partir de ese momento nace con un enlace público. Un grupo sin el ajuste guardado SHALL leerse
como `public`, y los grupos creados antes de este ajuste NO SHALL necesitar ninguna migración.

`PATCH /api/groups/:id/settings` SHALL aceptar `defaultVisibility` y responder `200` con el detalle del grupo
actualizado, solo si quien pide es el `owner`. Un miembro que no es owner SHALL recibir `403` con código `forbidden` y
el ajuste NO SHALL cambiar. Quien no es miembro, o un identificador mal formado, SHALL recibir `404` con código
`group_not_found`. Un valor fuera de los dos admitidos SHALL responder `400` nombrando `defaultVisibility`.

Cambiar el ajuste NO SHALL publicar ni despublicar ningún link ya compartido en el grupo, ni escribir nada en ellos.

#### Scenario: El owner apaga la visibilidad por defecto

- **GIVEN** el owner de un grupo con `defaultVisibility` `public`
- **WHEN** lo cambia a `private`
- **THEN** la respuesta SHALL ser `200` con `defaultVisibility` `private`
- **AND** los links que se guarden a partir de entonces NO SHALL nacer publicados

#### Scenario: Un miembro no cambia el ajuste

- **GIVEN** un miembro que no es owner
- **WHEN** intenta cambiar `defaultVisibility`
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** el ajuste NO SHALL cambiar

#### Scenario: Grupo nuevo

- **WHEN** se crea un grupo
- **THEN** su `defaultVisibility` SHALL ser `public`

#### Scenario: Grupo anterior al ajuste

- **GIVEN** un grupo guardado sin el campo `settings`
- **WHEN** un miembro consulta su detalle
- **THEN** `defaultVisibility` SHALL ser `public`
- **AND** sus links ya compartidos SHALL seguir sin enlace público

#### Scenario: Valor inválido

- **WHEN** el owner envía `defaultVisibility` con el valor `todos`
- **THEN** la respuesta SHALL ser `400` nombrando `defaultVisibility`

#### Scenario: Cambiar el ajuste no toca los links

- **GIVEN** un grupo con dos links publicados y uno sin publicar
- **WHEN** el owner pone `defaultVisibility` en `private`
- **THEN** los dos publicados SHALL seguir publicados con el mismo `slug`
- **AND** el tercero SHALL seguir sin publicar

## MODIFIED Requirements

### Requirement: Detalle de un grupo

`GET /api/groups/:id` SHALL devolver `id`, `name`, `role`, `memberCount`, `createdAt` y `defaultVisibility` del grupo si
quien pregunta es miembro, e incluir `inviteCode` solo si es `owner`. `defaultVisibility` SHALL viajar para cualquier
miembro, no solo para el `owner`: quien comparte un link necesita saber si nacerá publicado. Si el grupo no existe, el
usuario no es miembro o el identificador no tiene el formato de un identificador de grupo, SHALL responder `404` con el
código `group_not_found` y el mismo cuerpo en todos los casos.

#### Scenario: Detalle para el owner

- **GIVEN** el owner de un grupo
- **WHEN** consulta su detalle
- **THEN** la respuesta SHALL ser `200` con `inviteCode`

#### Scenario: Detalle para un miembro

- **GIVEN** un miembro que no es owner
- **WHEN** consulta el detalle del grupo
- **THEN** la respuesta SHALL ser `200` sin `inviteCode`
- **AND** SHALL incluir `defaultVisibility`

#### Scenario: Grupo ajeno indistinguible de uno inexistente

- **GIVEN** un grupo del que el usuario no es miembro
- **WHEN** consulta ese grupo, otro con un identificador que no existe y otro con el identificador `no-es-un-id`
- **THEN** las tres respuestas SHALL ser `404` con código `group_not_found` y cuerpos idénticos
