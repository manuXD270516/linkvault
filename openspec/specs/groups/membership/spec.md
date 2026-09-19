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
salir mientras lo sea: SHALL recibir `409` con código `owner_cannot_leave` y seguir siendo miembro; para irse, primero
SHALL transferir la propiedad a otro miembro. Quien no es miembro SHALL recibir
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

#### Scenario: El antiguo owner sale tras transferir

- **GIVEN** un owner que acaba de transferir la propiedad a otro miembro
- **WHEN** sale del grupo
- **THEN** la respuesta SHALL ser `204`
- **AND** el grupo SHALL seguir existiendo con su nuevo owner, sus links y el resto de miembros

### Requirement: Expulsar a un miembro

`DELETE /api/groups/:id/members/:userId` SHALL eliminar la membresía indicada y responder `204` solo si quien pide es el
`owner`. Un miembro que no es owner SHALL recibir `403` con código `forbidden`. El owner sobre sí mismo SHALL recibir
`409` con código `owner_cannot_leave`. Un usuario que no es miembro del grupo, o un `userId` sin el formato de un identificador de usuario, SHALL responder `404`
con código `member_not_found`. La membresía `owner` NO SHALL poder eliminarse: si, al borrar, la membresía indicada ya
es la del owner —porque quien expulsa acaba de cederle la propiedad—, SHALL responder `403` con código `forbidden` y NO
SHALL borrarse nada.

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

#### Scenario: Expulsar a quien acaba de recibir la propiedad

- **GIVEN** un grupo en el que Ana acaba de nombrar owner a Beto, mientras una petición de Ana para expulsar a Beto ya
  había comprobado que Ana era la owner
- **WHEN** esa expulsión intenta borrar la membresía de Beto
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** Beto SHALL seguir siendo el owner del grupo

### Requirement: Transferir la propiedad

`POST /api/groups/:id/owner` SHALL aceptar `userId` y, si quien pide es el `owner` y `userId` es otro miembro del grupo,
hacer a ese miembro `owner` y a quien pide `member` en una sola escritura atómica, sin cambiar la fecha de alta de
ninguno, y responder `200` con el detalle del grupo visto por quien pide (`role` `member`, sin `inviteCode`). El grupo
SHALL tener exactamente una membresía `owner` en todo momento, también ante peticiones simultáneas: un índice único
sobre la membresía `owner` de cada grupo SHALL impedir que haya más de una, y degradar a quien pide y promover al
elegido SHALL confirmarse juntos o no confirmarse ninguno, de modo que nunca quede ninguna. Quien no es miembro, o un `:id` mal formado, SHALL recibir `404`
con código `group_not_found`; un miembro que no es owner, `403` con código `forbidden`; un `userId` que no es miembro del
grupo o mal formado, `404` con código `member_not_found`; y el owner sobre sí mismo, `409` con código `already_owner`.
Transferir NO SHALL cambiar el código de invitación ni los links del grupo.

#### Scenario: El owner nombra a otro

- **GIVEN** un grupo con el owner Ana y los miembros Beto y Carla
- **WHEN** Ana nombra owner a Beto
- **THEN** la respuesta SHALL ser `200` con `role` `member` y sin `inviteCode`
- **AND** la lista de miembros SHALL mostrar a Beto como `owner` y a Ana como `member`, con sus fechas de alta de antes
- **AND** el grupo SHALL tener una sola membresía `owner`

#### Scenario: El nuevo owner ve el código y el anterior no

- **GIVEN** un grupo cuya propiedad Ana acaba de transferir a Beto
- **WHEN** ambos consultan el detalle del grupo
- **THEN** Beto SHALL recibir `inviteCode` y Ana NO

#### Scenario: El nuevo owner puede expulsar al anterior

- **GIVEN** un grupo cuya propiedad Ana acaba de transferir a Beto
- **WHEN** Beto expulsa a Ana
- **THEN** la respuesta SHALL ser `204`

#### Scenario: Un miembro no puede transferir

- **GIVEN** un miembro que no es owner
- **WHEN** intenta nombrar owner a otro miembro
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** el owner SHALL seguir siendo el mismo

#### Scenario: Transferir a quien no es miembro

- **GIVEN** el owner de un grupo
- **WHEN** intenta nombrar owner a un usuario que no pertenece al grupo y a otro con el identificador `no-es-un-id`
- **THEN** ambas respuestas SHALL ser `404` con código `member_not_found`
- **AND** quien pedía SHALL seguir siendo el único owner del grupo

#### Scenario: Transferirse a sí mismo

- **GIVEN** el owner de un grupo
- **WHEN** se nombra owner a sí mismo
- **THEN** la respuesta SHALL ser `409` con código `already_owner`

#### Scenario: Dos transferencias a la vez

- **GIVEN** un grupo con el owner Ana y los miembros Beto y Carla
- **WHEN** llegan a la vez una petición de Ana para nombrar owner a Beto y otra para nombrar owner a Carla
- **THEN** una respuesta SHALL ser `200` y la otra `403` con código `forbidden`
- **AND** el grupo SHALL tener una sola membresía `owner`, la de Beto o la de Carla

#### Scenario: Transferir mientras el elegido se va

- **GIVEN** un grupo con el owner Ana y el miembro Beto
- **WHEN** llegan a la vez la transferencia de Ana a Beto y la salida de Beto
- **THEN** el grupo SHALL terminar con una sola membresía `owner`
- **AND** o bien la transferencia SHALL responder `200` y la salida `409` con código `owner_cannot_leave`, o bien la
  salida SHALL responder `204` y la transferencia `404` con código `member_not_found`

#### Scenario: Salir justo después de recibir la propiedad

- **GIVEN** un grupo en el que Beto acaba de pasar a ser owner, mientras una petición de salida de Beto ya había leído
  su rol `member`
- **WHEN** esa salida intenta borrar su membresía
- **THEN** la respuesta SHALL ser `409` con código `owner_cannot_leave`
- **AND** Beto SHALL seguir siendo el owner del grupo

### Requirement: Límite de intentos al unirse

`POST /api/groups/join` SHALL contar los intentos con códigos incorrectos con contadores por ventana fija de 15 minutos:
como máximo 10 por usuario y 100 por IP (IPv6 agrupada por su prefijo /64). Cada intento SHALL contarse **antes** de
resolver el código, de modo que peticiones concurrentes no superen el límite: primero en el contador del usuario y,
solo si este no lo rechaza, en el de la IP. Si el contador del usuario rechaza, SHALL responderse `429` sin contar nada
en el de la IP. Si el de la IP rechaza, SHALL devolverse el intento al del usuario y responderse `429`. El intento
SHALL devolverse también cuando el resultado no sea un código desconocido o mal formado —se una, ya fuera miembro, el
grupo esté completo, se haya llegado al límite de grupos o la unión falle por cualquier otro error—, y solo en los
contadores donde de verdad se contó. Un código válido NO SHALL poner a cero ningún contador. El `429` SHALL llevar
código `too_many_attempts` y cabecera `Retry-After` en segundos, la del contador que rechazó, sin resolver el código
aunque sea válido. Si el almacén de contadores no está disponible, la unión SHALL procesarse sin límite y SHALL
registrarse como mucho un aviso por racha de fallos del almacén, sin el código ni el usuario.

#### Scenario: Demasiados códigos incorrectos

- **GIVEN** un usuario con 10 intentos con códigos desconocidos en la ventana actual
- **WHEN** intenta unirse con un código válido
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After` mayor que 0
- **AND** NO SHALL crearse la membresía

#### Scenario: Los códigos válidos no cuentan

- **WHEN** un usuario se une 30 veces seguidas con el código de un grupo del que ya es miembro
- **THEN** ninguna respuesta SHALL ser `429`

#### Scenario: Un grupo completo no gasta intentos

- **GIVEN** un grupo con 50 miembros
- **WHEN** otro usuario intenta unirse 15 veces con su código
- **THEN** todas las respuestas SHALL ser `409` con código `group_full`

#### Scenario: Un código válido no reinicia la cuenta

- **GIVEN** un usuario con 9 intentos con códigos desconocidos en la ventana actual
- **WHEN** se une con un código válido y después prueba otro código desconocido
- **THEN** la respuesta al código desconocido SHALL ser `404` con código `invalid_invite_code`
- **AND** su siguiente intento, con cualquier código, SHALL responder `429`

#### Scenario: Los mal formados también cuentan

- **GIVEN** un usuario con 10 intentos con el código `ABC-12` en la ventana actual
- **WHEN** intenta unirse con cualquier código
- **THEN** la respuesta SHALL ser `429`

#### Scenario: Límite por IP

- **GIVEN** 100 intentos con códigos desconocidos de distintos usuarios desde la misma IP en la ventana actual
- **WHEN** otro usuario intenta unirse desde esa IP
- **THEN** la respuesta SHALL ser `429`

#### Scenario: Un usuario bloqueado no gasta intentos de la IP

- **GIVEN** 90 intentos con códigos desconocidos desde una IP en la ventana actual, 10 de ellos de Ana, que ya está
  bloqueada
- **WHEN** Ana hace 20 intentos más desde esa IP
- **THEN** las 20 respuestas SHALL ser `429`
- **AND** Beto SHALL poder probar desde esa IP 10 códigos desconocidos y recibir `404` con código
  `invalid_invite_code` en todos

#### Scenario: El bloqueo de la IP no gasta intentos del usuario

- **GIVEN** 100 intentos con códigos desconocidos de otros usuarios desde una IP en la ventana actual
- **WHEN** Ana, sin intentos en la ventana, prueba 5 códigos desde esa IP y recibe `429`
- **THEN** desde otra IP SHALL poder probar 10 códigos desconocidos antes de recibir `429`

#### Scenario: Intentos concurrentes

- **WHEN** llegan a la vez 30 intentos del mismo usuario con códigos desconocidos
- **THEN** como máximo 10 SHALL resolver el código y el resto SHALL responder `429`

#### Scenario: Almacén de contadores caído

- **GIVEN** Redis no disponible
- **WHEN** un usuario se une dos veces con códigos válidos
- **THEN** ambas respuestas SHALL ser `200`
- **AND** SHALL registrarse como mucho un aviso, que no contiene el código ni el usuario
