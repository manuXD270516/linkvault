# applications/group-visibility Specification

## Purpose

Deja que quien quiera cuente a sus grupos en qué punto está de una oferta —y solo eso—, para que el grupo sepa quién más
está detrás de cada vacante sin que postular deje de ser algo privado por defecto.

## Requirements

### Requirement: Privada por defecto

Toda postulación SHALL nacer con `visibility` `private`. Una postulación privada NO SHALL aparecer, ni con su nombre ni
con su estado, en ninguna respuesta dirigida a otra persona.

#### Scenario: Seguir no avisa al grupo

- **GIVEN** un link compartido en un grupo de Ana y Beto
- **WHEN** Ana lo sigue con `status` `applied` sin cambiar nada más
- **THEN** los estados compartidos de ese link que consulta Beto NO SHALL incluir a Ana

### Requirement: Un interruptor para compartir el estado

`PATCH /api/applications/:id` SHALL aceptar `visibility` `group` o `private` y responder `200` con la postulación. Es un
único interruptor por postulación: la postulación NO SHALL guardar ninguna lista de grupos. Con `group`, el estado SHALL
verse en la tarjeta de ese link de **cada** grupo del que su dueño es miembro y en el que el link está compartido, hoy y
en adelante; con `private`, en ninguno. Cambiar la visibilidad NO SHALL escribir ningún evento de historial ni cambiar
`version`.

#### Scenario: Compartir con los grupos donde está la oferta

- **GIVEN** Ana, miembro de G1, G2 y G3, que sigue un link compartido en G1 y G2 pero no en G3
- **WHEN** activa `visibility` `group`
- **THEN** los miembros de G1 y de G2 SHALL verla en la tarjeta de ese link
- **AND** en G3 NO SHALL aparecer en ningún sitio

#### Scenario: Dejar de compartir

- **GIVEN** una postulación de Ana compartida con sus grupos
- **WHEN** Ana vuelve a `visibility` `private`
- **THEN** ningún miembro de sus grupos SHALL volver a ver a Ana en esa tarjeta

#### Scenario: La oferta llega después a otro grupo

- **GIVEN** una postulación de Ana compartida, sobre un link que solo estaba en G1
- **WHEN** alguien comparte ese link en G2, del que Ana también es miembro
- **THEN** los miembros de G2 SHALL ver a Ana en esa tarjeta sin que Ana haga nada

### Requirement: Lo que ve el grupo

A los demás miembros SHALL llegarles de una postulación compartida únicamente el identificador y el nombre visible de su
dueño y su estado canónico. NO SHALL llegarles la etapa libre, las notas, el historial, `appliedAt`, `version` ni el
identificador de la postulación.

#### Scenario: La etapa sigue siendo privada

- **GIVEN** una postulación compartida de Ana en `in_process` con la etapa "Entrevista con el CTO" y una nota
- **WHEN** Beto consulta los estados compartidos de esa tarjeta
- **THEN** SHALL ver a Ana con el estado `in_process`
- **AND** la respuesta NO SHALL contener la etapa, la nota ni ningún evento

### Requirement: Estados compartidos de una página de tarjetas

`GET /api/groups/:id/applications` SHALL aceptar `linkIds` (de 1 a 50 identificadores separados por comas) y devolver,
a un miembro del grupo, por cada uno de esos links que está compartido en ese grupo, quiénes de sus miembros actuales lo
siguen con `visibility` `group`, con su `userId`, su `displayName` y su estado, del último cambio de estado o de etapa
más reciente al más antiguo (editar notas o visibilidad no cambia ese orden). Quien pide SHALL aparecer también si
comparte el suyo. Un link que no está en ese grupo, o un identificador mal formado,
NO SHALL aparecer en la respuesta. El número de lecturas que hace para responder —miembros del grupo, links del grupo,
postulaciones compartidas y nombres, una de cada— NO SHALL depender del número de links pedidos. Quien no es miembro, o un `:id` mal formado, SHALL recibir `404` con código `group_not_found`; más de 50
identificadores, o ninguno, SHALL responder `400` con código `validation_error` nombrando `linkIds`.

#### Scenario: Página de un grupo con procesos compartidos

- **GIVEN** un grupo con los links L1 y L2, donde Ana comparte que está en `in_process` en L1 y Beto que está en
  `applied` en L1 y L2
- **WHEN** Carla, miembro del grupo, consulta los estados compartidos de L1 y L2
- **THEN** la respuesta SHALL traer a Ana y a Beto en L1 y solo a Beto en L2, cada uno con su nombre y su estado

#### Scenario: Una nota no reordena los avatares

- **GIVEN** un link del grupo donde Ana cambió de estado ayer y Beto hoy, ambos compartiendo
- **WHEN** Ana edita la nota de su postulación y un miembro consulta los estados compartidos de ese link
- **THEN** Beto SHALL aparecer antes que Ana

#### Scenario: Link que no está en el grupo

- **GIVEN** un link que Ana sigue y comparte, pero que no está compartido en el grupo G
- **WHEN** un miembro de G consulta los estados compartidos de G con ese link
- **THEN** la respuesta NO SHALL incluir ese link

#### Scenario: Extraño

- **GIVEN** un usuario que no es miembro del grupo
- **WHEN** consulta sus estados compartidos
- **THEN** la respuesta SHALL ser `404` con código `group_not_found`

#### Scenario: Consultas fijas

- **GIVEN** un grupo con 50 links y postulaciones compartidas en todos
- **WHEN** un miembro consulta los estados compartidos de los 50 y después de solo 2
- **THEN** ambas peticiones SHALL hacer el mismo número de lecturas: una de los miembros, una de los links del grupo,
  una de las postulaciones compartidas y una de los nombres

#### Scenario: Demasiados links

- **WHEN** se consultan los estados compartidos de 51 links
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `linkIds`

### Requirement: La visibilidad se deriva, la postulación se conserva

Que una postulación compartida aparezca en la tarjeta de un grupo SHALL decidirse en cada lectura con la pertenencia y
los links compartidos de ese momento. Salir de un grupo, ser expulsado, que se quite el link del grupo o que se borre el
grupo SHALL hacer que deje de aparecer en él al instante, y NO SHALL cambiar ni borrar la postulación: su estado, su
etapa, sus notas, su visibilidad y su historial siguen intactos para su dueño. Si la situación se revierte —vuelve a
entrar, se vuelve a compartir el link—, SHALL volver a aparecer sin que su dueño haga nada.

#### Scenario: Sale del grupo

- **GIVEN** Ana, que comparte su postulación sobre un link del grupo G
- **WHEN** Ana sale de G
- **THEN** los miembros de G NO SHALL ver a Ana en esa tarjeta
- **AND** la postulación de Ana SHALL seguir con su estado, su visibilidad `group` y su historial

#### Scenario: Expulsada

- **GIVEN** Ana, que comparte su postulación sobre un link del grupo G
- **WHEN** el owner la expulsa de G
- **THEN** los miembros de G NO SHALL ver a Ana en esa tarjeta
- **AND** la postulación de Ana NO SHALL cambiar

#### Scenario: Quitan la oferta del grupo

- **GIVEN** Ana, que comparte su postulación sobre un link del grupo G
- **WHEN** quien lo compartió lo quita de G
- **THEN** la postulación de Ana NO SHALL cambiar
- **AND** si el link se vuelve a compartir en G, los miembros SHALL volver a ver a Ana en esa tarjeta

#### Scenario: Borran el grupo

- **GIVEN** Ana y Beto, que siguen un link que solo estaba en el grupo G
- **WHEN** el owner borra G
- **THEN** las postulaciones de Ana y de Beto SHALL seguir existiendo con su estado, su historial y la ficha de la oferta

#### Scenario: Vuelve a entrar

- **GIVEN** Ana, que salió del grupo G con una postulación compartida sobre un link de G
- **WHEN** vuelve a unirse a G con el código
- **THEN** los miembros de G SHALL volver a ver a Ana en esa tarjeta
