# groups/membership Specification

## Purpose

Gobierna quién está dentro de un grupo: cómo se entra con el código que circula por WhatsApp, qué puede hacer cada rol,
cómo se sale y a quién puede sacar el owner.

## Requirements

### Requirement: Unirse con un código

`POST /api/groups/join` SHALL aceptar `code`, normalizarlo (espacios exteriores eliminados y mayúsculas) y, si
corresponde a un grupo, añadir al usuario como `member` y responder `200` con `id`, `name`, `role`,
`memberCount` y `joinedAt`, nunca con el código de invitación, tampoco si el rol resuelto es `owner`. Si el código no corresponde a ningún grupo o no tiene el formato de un código (longitud o
caracteres fuera del alfabeto), SHALL responder `404` con código `invalid_invite_code` y el mismo cuerpo en ambos casos. Si el usuario ya es
miembro, SHALL responder `200` con el grupo y su rol actual, sin crear una segunda membresía.

#### Scenario: Unirse por código

- **GIVEN** un grupo con un código y un usuario que no es miembro
- **WHEN** se une con ese código en minúsculas y con espacios alrededor
- **THEN** la respuesta SHALL ser `200` con `role` `member` y sin el código de invitación
- **AND** el grupo SHALL aparecer en su lista de grupos
- **AND** el número de miembros SHALL aumentar en 1

#### Scenario: Código desconocido

- **WHEN** un usuario se une con un código que no existe
- **THEN** la respuesta SHALL ser `404` con código `invalid_invite_code`

#### Scenario: Código con formato inválido

- **WHEN** un usuario se une con el código `ABC-12`
- **THEN** la respuesta SHALL ser `404` con código `invalid_invite_code` y el mismo cuerpo que un código desconocido

#### Scenario: Unirse dos veces

- **GIVEN** un miembro de un grupo
- **WHEN** vuelve a unirse con el mismo código
- **THEN** la respuesta SHALL ser `200` con su rol actual
- **AND** el número de miembros NO SHALL cambiar

#### Scenario: El owner se une a su propio grupo

- **GIVEN** el owner de un grupo
- **WHEN** se une con el código de ese grupo
- **THEN** la respuesta SHALL ser `200` con `role` `owner`

### Requirement: Límite de grupos al unirse

Unirse a un grupo nuevo estando ya en 20 grupos SHALL responder `409` con código `too_many_groups`, sin crear la
membresía. Volver a unirse a un grupo del que ya se es miembro SHALL seguir respondiendo `200` aunque se esté en el
límite.

#### Scenario: Límite alcanzado al unirse

- **GIVEN** un usuario que ya pertenece a 20 grupos
- **WHEN** se une con el código de otro grupo
- **THEN** la respuesta SHALL ser `409` con código `too_many_groups`
- **AND** NO SHALL crearse la membresía

#### Scenario: En el límite, volver a un grupo propio

- **GIVEN** un usuario que pertenece a 20 grupos, uno de ellos con el código C1
- **WHEN** se une con C1
- **THEN** la respuesta SHALL ser `200` con su rol actual

### Requirement: Límite de miembros por grupo

Un grupo SHALL tener como máximo 50 miembros. Unirse a un grupo completo SHALL responder `409` con código `group_full`,
sin crear la membresía.

#### Scenario: Grupo completo

- **GIVEN** un grupo con 50 miembros
- **WHEN** otro usuario se une con su código
- **THEN** la respuesta SHALL ser `409` con código `group_full`
- **AND** el grupo SHALL seguir con 50 miembros

### Requirement: Lista de miembros

`GET /api/groups/:id/members` SHALL devolver, para cualquier miembro del grupo, la lista de miembros con `userId`,
`displayName`, `role` y `joinedAt`, ordenada por `joinedAt` ascendente. NO SHALL incluir el email ni ningún otro dato de
contacto. Quien no es miembro SHALL recibir `404` con código `group_not_found`.

#### Scenario: Un miembro ve la lista

- **GIVEN** un grupo con el owner y dos miembros
- **WHEN** uno de los miembros consulta la lista
- **THEN** la respuesta SHALL ser `200` con los tres, el owner primero por antigüedad
- **AND** ninguna entrada SHALL contener un email

#### Scenario: Un extraño no ve la lista

- **GIVEN** un usuario que no es miembro del grupo
- **WHEN** consulta su lista de miembros
- **THEN** la respuesta SHALL ser `404` con código `group_not_found`

### Requirement: Salir de un grupo

`DELETE /api/groups/:id/members/me` SHALL eliminar la membresía del usuario y responder `204`, incluso si el grupo ya no
existe (membresía huérfana). El `owner` NO SHALL poder
salir: SHALL recibir `409` con código `owner_cannot_leave` y seguir siendo miembro. Quien no es miembro SHALL recibir
`404` con código `group_not_found`.

#### Scenario: Un miembro sale

- **GIVEN** un miembro que no es owner
- **WHEN** sale del grupo
- **THEN** la respuesta SHALL ser `204`
- **AND** el grupo NO SHALL aparecer en su lista
- **AND** el número de miembros SHALL bajar en 1

#### Scenario: El owner no puede salir

- **GIVEN** el owner de un grupo
- **WHEN** intenta salir
- **THEN** la respuesta SHALL ser `409` con código `owner_cannot_leave`
- **AND** SHALL seguir siendo miembro

### Requirement: Expulsar a un miembro

`DELETE /api/groups/:id/members/:userId` SHALL eliminar la membresía indicada y responder `204` solo si quien pide es el
`owner`. Un miembro que no es owner SHALL recibir `403` con código `forbidden`. El owner sobre sí mismo SHALL recibir
`409` con código `owner_cannot_leave`. Un usuario que no es miembro del grupo, o un `userId` sin el formato de un identificador de usuario, SHALL responder `404`
con código `member_not_found`. La membresía `owner` NO SHALL poder eliminarse.

#### Scenario: El owner expulsa

- **GIVEN** un grupo con el owner y un miembro
- **WHEN** el owner expulsa al miembro
- **THEN** la respuesta SHALL ser `204`
- **AND** el expulsado NO SHALL ver el grupo en su lista
- **AND** el expulsado SHALL poder volver a unirse con el código vigente

#### Scenario: Un miembro no puede expulsar

- **GIVEN** dos miembros que no son owner
- **WHEN** uno intenta expulsar al otro
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** ambos SHALL seguir siendo miembros

#### Scenario: Expulsar a quien no es miembro

- **GIVEN** el owner de un grupo
- **WHEN** intenta expulsar a un usuario que no pertenece al grupo y a otro con el identificador `no-es-un-id`
- **THEN** ambas respuestas SHALL ser `404` con código `member_not_found`
