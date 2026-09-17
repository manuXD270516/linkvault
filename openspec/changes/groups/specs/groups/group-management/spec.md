## Purpose

Permite a una persona crear el espacio compartido donde luego vivirán los links de empleo de su círculo, consultarlo,
renombrarlo, borrarlo y repartir el código con el que los demás entran.

## ADDED Requirements

### Requirement: Creación de un grupo

`POST /api/groups` SHALL aceptar `name` (1 a 60 caracteres tras eliminar espacios exteriores), crear el grupo y la
membresía `owner` del creador de forma atómica, generar su código de invitación y responder `201` con `id`, `name`,
`role`, `memberCount`, `createdAt` e `inviteCode`. Un `name` inválido SHALL responder `400` nombrando `name`.

#### Scenario: Grupo creado

- **GIVEN** un usuario autenticado
- **WHEN** crea el grupo "  Backend Bolivia "
- **THEN** la respuesta SHALL ser `201` con `name` "Backend Bolivia", `role` `owner`, `memberCount` 1 e `inviteCode`
- **AND** el creador SHALL aparecer como miembro del grupo

#### Scenario: Nombre inválido

- **WHEN** se crea un grupo con `name` vacío
- **THEN** la respuesta SHALL ser `400` nombrando `name`

#### Scenario: Nombres repetidos

- **GIVEN** un usuario con un grupo "Backend Bolivia"
- **WHEN** crea otro grupo con el mismo nombre
- **THEN** la respuesta SHALL ser `201` con un grupo distinto

#### Scenario: Grupo sin owner imposible

- **GIVEN** que la creación de la membresía del creador falla
- **WHEN** termina la petición
- **THEN** NO SHALL quedar ningún grupo creado

### Requirement: Grupos del usuario

`GET /api/groups` SHALL devolver los grupos de los que el usuario es miembro, cada uno con `id`, `name`, `role`,
`memberCount` y `joinedAt`, ordenados por `joinedAt` descendente, y NO SHALL incluir el código de invitación. Una
membresía cuyo grupo ya no existe NO SHALL aparecer en la lista.

#### Scenario: Lista con rol

- **GIVEN** un usuario que creó un grupo y se unió a otro
- **WHEN** consulta sus grupos
- **THEN** la respuesta SHALL ser `200` con los dos grupos, con `role` `owner` y `member` respectivamente
- **AND** ningún grupo SHALL incluir el código de invitación

#### Scenario: Sin grupos

- **GIVEN** un usuario sin grupos
- **WHEN** consulta sus grupos
- **THEN** la respuesta SHALL ser `200` con una lista vacía

#### Scenario: Membresía huérfana

- **GIVEN** una membresía cuyo grupo ya no existe
- **WHEN** el usuario consulta sus grupos
- **THEN** la respuesta SHALL ser `200` y NO SHALL incluir ese grupo

### Requirement: Detalle de un grupo

`GET /api/groups/:id` SHALL devolver `id`, `name`, `role`, `memberCount` y `createdAt` del grupo si quien pregunta es
miembro, e incluir `inviteCode` solo si es `owner`. Si el grupo no existe, el usuario no es miembro o el identificador no
tiene el formato de un identificador de grupo, SHALL responder `404` con el código `group_not_found` y el mismo cuerpo en
todos los casos.

#### Scenario: Detalle para el owner

- **GIVEN** el owner de un grupo
- **WHEN** consulta su detalle
- **THEN** la respuesta SHALL ser `200` con `inviteCode`

#### Scenario: Detalle para un miembro

- **GIVEN** un miembro que no es owner
- **WHEN** consulta el detalle del grupo
- **THEN** la respuesta SHALL ser `200` sin `inviteCode`

#### Scenario: Grupo ajeno indistinguible de uno inexistente

- **GIVEN** un grupo del que el usuario no es miembro
- **WHEN** consulta ese grupo, otro con un identificador que no existe y otro con el identificador `no-es-un-id`
- **THEN** las tres respuestas SHALL ser `404` con código `group_not_found` y cuerpos idénticos

### Requirement: Renombrado por el owner

`PATCH /api/groups/:id` SHALL aceptar `name` con las mismas reglas que la creación y responder `200` con el detalle
actualizado solo si quien pide es el `owner`. Un miembro que no es owner SHALL recibir `403` con código `forbidden` y el
nombre NO SHALL cambiar.

#### Scenario: El owner renombra

- **GIVEN** el owner de un grupo
- **WHEN** lo renombra a "Backend LatAm"
- **THEN** la respuesta SHALL ser `200` con el nombre nuevo

#### Scenario: Un miembro no puede renombrar

- **GIVEN** un miembro que no es owner
- **WHEN** intenta renombrar el grupo
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** el nombre NO SHALL cambiar

### Requirement: Código de invitación

Cada grupo SHALL tener un código de invitación de 8 caracteres de un alfabeto sin caracteres ambiguos, único entre todos
los grupos, sin caducidad y reutilizable. `POST /api/groups/:id/invite-code` SHALL generar uno nuevo y responder `200` con
`{ "inviteCode": "..." }` solo para el `owner`; el código anterior SHALL dejar de servir. Un miembro que no es owner SHALL
recibir `403`.

#### Scenario: Regenerar el código

- **GIVEN** el owner de un grupo con el código C1
- **WHEN** regenera el código
- **THEN** la respuesta SHALL ser `200` con `inviteCode` distinto de C1
- **AND** unirse con C1 SHALL responder `404`

#### Scenario: Un miembro no puede regenerar

- **GIVEN** un miembro que no es owner
- **WHEN** intenta regenerar el código
- **THEN** la respuesta SHALL ser `403` con código `forbidden`

### Requirement: Borrado por el owner

`DELETE /api/groups/:id` SHALL borrar el grupo y todas sus membresías de forma atómica y responder `204` solo si quien
pide es el `owner`; un miembro que no es owner SHALL recibir `403`. Tras el borrado, el grupo SHALL responder `404` a
todos sus antiguos miembros y su código de invitación NO SHALL servir.

#### Scenario: El owner borra el grupo

- **GIVEN** un grupo con dos miembros
- **WHEN** el owner lo borra
- **THEN** la respuesta SHALL ser `204`
- **AND** el grupo NO SHALL aparecer en la lista de ninguno de los dos
- **AND** unirse con su código SHALL responder `404`

#### Scenario: Un miembro no puede borrar

- **GIVEN** un miembro que no es owner
- **WHEN** intenta borrar el grupo
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** el grupo SHALL seguir existiendo

### Requirement: Límite de grupos por usuario

Un usuario SHALL pertenecer como máximo a 20 grupos. Crear o unirse superando ese límite SHALL responder `409` con código
`too_many_groups`, sin crear el grupo ni la membresía.

#### Scenario: Límite alcanzado al crear

- **GIVEN** un usuario que ya pertenece a 20 grupos
- **WHEN** intenta crear otro
- **THEN** la respuesta SHALL ser `409` con código `too_many_groups`
- **AND** NO SHALL crearse ningún grupo

### Requirement: Pertenencia disponible para otros módulos

El módulo de grupos SHALL exponer al resto de la API una única entrada con `isMember(groupId, userId)` y
`getGroupsOf(userId)`, y ningún archivo de dominio, aplicación o infraestructura de otro módulo SHALL leer sus
colecciones. El incumplimiento SHALL ser detectado por el lint.

#### Scenario: Otro módulo comprueba pertenencia

- **GIVEN** un usuario miembro de un grupo
- **WHEN** otro módulo pregunta por su pertenencia a ese grupo y a otro del que no es miembro
- **THEN** la respuesta SHALL ser verdadera y falsa respectivamente

#### Scenario: Acceso directo a las colecciones de grupos

- **GIVEN** un archivo de dominio, aplicación o infraestructura de otro módulo de `apps/api`
- **WHEN** importa el repositorio o los schemas de `groups`
- **THEN** el lint SHALL fallar
