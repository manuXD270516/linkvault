## ADDED Requirements

### Requirement: Comentar un link del grupo

`POST /api/groups/:id/links/:linkId/comments` SHALL aceptar `text` y, si quien pide es miembro del grupo y el link está
compartido en ese grupo, guardar un comentario con su texto normalizado, su autor y su fecha, y responder `201` con el
comentario (`id`, `author` con `userId` y `displayName`, `authorLeft` `false`, `text`, `createdAt`) y el resumen de
comentarios de ese link en el grupo (`count` y `latest`). Quien no es miembro, un grupo inexistente o un `:id` mal
formado SHALL recibir `404` con código `group_not_found` y el mismo cuerpo en los tres casos. Un link que no está
compartido en ese grupo, o un `:linkId` mal formado, SHALL recibir `404` con código `link_not_found`. Un texto que tras
normalizarse quede vacío o pase de 500 caracteres SHALL recibir `400` con código `validation_error` nombrando `text`, y
NO SHALL guardarse nada.

#### Scenario: Comentar una oferta del grupo

- **GIVEN** Beto, miembro de un grupo donde está compartido un link
- **WHEN** comenta "Piden inglés C1" en ese link
- **THEN** la respuesta SHALL ser `201` con el comentario, su autor Beto y su fecha
- **AND** el resumen SHALL tener `count` 1 y ese comentario en `latest`

#### Scenario: Extraño no comenta

- **GIVEN** un usuario que no es miembro del grupo
- **WHEN** comenta en un link de ese grupo, en el mismo link con un `:id` de grupo inexistente y con el `:id` `no-es-un-id`
- **THEN** las tres respuestas SHALL ser `404` con código `group_not_found` y cuerpos idénticos
- **AND** NO SHALL guardarse ningún comentario

#### Scenario: Link que no está en el grupo

- **GIVEN** un miembro de un grupo y un link que solo está compartido en otro grupo
- **WHEN** comenta ese link en su grupo
- **THEN** la respuesta SHALL ser `404` con código `link_not_found`

#### Scenario: Comentario vacío

- **WHEN** un miembro comenta "   " (solo espacios)
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `text`

#### Scenario: Comentario demasiado largo

- **WHEN** un miembro comenta un texto de 501 caracteres
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `text`
- **AND** NO SHALL guardarse ningún comentario

#### Scenario: Justo en el límite

- **WHEN** un miembro comenta un texto de 500 caracteres rodeado de espacios
- **THEN** la respuesta SHALL ser `201` con el texto sin los espacios exteriores

### Requirement: Texto plano, tal como lo escribe el miembro

El texto de un comentario SHALL normalizarse así antes de validarse y guardarse:
- los saltos de línea `\r\n` y `\r` SHALL pasar a `\n`;
- SHALL quitarse los caracteres de control salvo `\n`, y los caracteres de formato que cambian la dirección del texto
  (U+202A–U+202E y U+2066–U+2069);
- SHALL quitarse los espacios y saltos exteriores.

La longitud SHALL contarse en code points tras normalizar. Los emails, teléfonos y enlaces que escriba el miembro NO
SHALL alterarse. El texto SHALL tratarse siempre como texto plano: NO SHALL interpretarse como HTML ni como Markdown, y
lo que parezca una etiqueta SHALL guardarse y devolverse tal cual. El texto de un comentario NO SHALL aparecer en los
logs ni en ningún aviso que viaje por Redis.

#### Scenario: Un teléfono se conserva

- **WHEN** un miembro comenta "Escríbele a Juan de RRHH al +591 70000000"
- **THEN** el comentario guardado y devuelto SHALL contener "+591 70000000"

#### Scenario: HTML como texto

- **WHEN** un miembro comenta `<b>ojo</b> <script>alert(1)</script>`
- **THEN** la respuesta SHALL devolver exactamente ese texto
- **AND** el hilo SHALL devolverlo igual, sin quitar ni escapar nada

#### Scenario: Caracteres invisibles fuera

- **WHEN** un miembro comenta un texto con `\r\n`, un carácter nulo y un U+202E
- **THEN** el comentario guardado SHALL tener `\n` en lugar de `\r\n` y NO SHALL contener ni el nulo ni el U+202E

#### Scenario: El texto no se registra

- **WHEN** un miembro comenta "Piden inglés C1" y otro miembro intenta borrarlo sin ser su autor
- **THEN** ningún log de la API SHALL contener "Piden inglés C1"

### Requirement: Hilo de un link en el grupo

`GET /api/groups/:id/links/:linkId/comments` SHALL devolver, a los miembros actuales del grupo, los comentarios de ese
link **en ese grupo**, del más reciente al más antiguo y, a igual fecha, por identificador, ambos descendentes. SHALL
paginarse con `limit` (20 por defecto, 50 como máximo) y un `cursor` opaco, e incluir `total`, el número de comentarios
del link en el grupo. Un cursor manipulado SHALL responder `400` con código `validation_error` nombrando `cursor`.
Quien no es miembro SHALL recibir `404` con código `group_not_found`; un link que no está en el grupo, `404` con código
`link_not_found`. Los comentarios que ese mismo link tenga en otro grupo NO SHALL aparecer.

#### Scenario: Hilo paginado sin saltos ni repetidos

- **GIVEN** un link con 45 comentarios en un grupo, 30 de ellos escritos en el mismo instante
- **WHEN** un miembro recorre el hilo de 20 en 20 con el cursor devuelto
- **THEN** SHALL ver los 45 exactamente una vez, del más reciente al más antiguo
- **AND** cada página SHALL traer `total` 45

#### Scenario: Cada grupo tiene su hilo

- **GIVEN** un link compartido en los grupos A y B, con un comentario en A
- **WHEN** un miembro de los dos pide el hilo del link en B
- **THEN** la respuesta SHALL ser `200` con `total` 0 y sin el comentario de A

#### Scenario: Extraño no lee el hilo

- **GIVEN** un usuario que tiene el link en su lista privada y no es miembro del grupo
- **WHEN** pide el hilo de ese link en el grupo
- **THEN** la respuesta SHALL ser `404` con código `group_not_found`

### Requirement: Borrar un comentario propio

`DELETE /api/groups/:id/links/:linkId/comments/:commentId` SHALL borrar el comentario y responder `204` solo si quien
pide es su autor y miembro actual del grupo. Cualquier otro miembro SHALL recibir `403` con código `forbidden`, también
el propietario del grupo, y el comentario NO SHALL borrarse. Un comentario que no existe, que ya se borró, que es de otro
link o de otro grupo, o un `:commentId` mal formado SHALL responder `404` con código `comment_not_found`. Quien no es
miembro SHALL recibir `404` con código `group_not_found`. Borrar SHALL bajar en uno el contador del link en el grupo.
Los comentarios NO SHALL poder editarse: no existe ninguna operación que cambie su texto.

#### Scenario: Borrar el propio

- **GIVEN** un link con dos comentarios en un grupo, uno de Beto
- **WHEN** Beto borra el suyo
- **THEN** la respuesta SHALL ser `204`
- **AND** el hilo SHALL tener `total` 1 y NO SHALL contener el de Beto

#### Scenario: El propietario no borra lo ajeno

- **GIVEN** un comentario de Beto
- **WHEN** Ana, propietaria del grupo, intenta borrarlo
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** el comentario SHALL seguir en el hilo

#### Scenario: Borrar dos veces

- **GIVEN** un comentario que su autor acaba de borrar
- **WHEN** vuelve a pedir que se borre
- **THEN** la respuesta SHALL ser `404` con código `comment_not_found`

#### Scenario: Comentario de otro link

- **GIVEN** un comentario de Beto en el link L1 de un grupo
- **WHEN** Beto pide borrarlo con la ruta del link L2 del mismo grupo
- **THEN** la respuesta SHALL ser `404` con código `comment_not_found`
- **AND** el comentario SHALL seguir en el hilo de L1

#### Scenario: Sin edición

- **GIVEN** un comentario de Beto
- **WHEN** Beto envía un `PATCH` a la ruta de ese comentario con otro texto
- **THEN** la respuesta SHALL ser `404`
- **AND** el texto del comentario NO SHALL cambiar

### Requirement: Resumen de comentarios en el listado del grupo

Cada link de `GET /api/groups/:id/links` SHALL incluir `comments` con `count`, el número de comentarios del link en ese
grupo, y `latest`, sus dos comentarios más recientes (o menos si no hay tantos) del más reciente al más antiguo, con la
misma forma que en el hilo. El listado SHALL resolverse con un número fijo de lecturas por página, sea cual sea el
número de links de la página y de comentarios de cada uno: nunca una lectura por link ni por comentario.

#### Scenario: Tarjeta con tres comentarios

- **GIVEN** un link con tres comentarios en el grupo, escritos por Ana, Beto y Carla en ese orden
- **WHEN** un miembro pide los links del grupo
- **THEN** ese link SHALL traer `comments.count` 3 y en `latest` los de Carla y Beto, en ese orden

#### Scenario: Link sin comentarios

- **GIVEN** un link recién compartido
- **WHEN** un miembro pide los links del grupo
- **THEN** ese link SHALL traer `comments.count` 0 y `latest` vacío

#### Scenario: Lecturas fijas

- **GIVEN** dos páginas del listado, una de 2 links y otra de 20, con distinto número de comentarios
- **WHEN** se pide cada una
- **THEN** el caso de uso SHALL hacer las mismas lecturas en ambas, una por cada puerto que consulta

### Requirement: Límite de comentarios

Publicar un comentario SHALL contar por persona en una ventana fija de 15 minutos, con un máximo de 30 comentarios en
todos sus grupos. Superado el límite, SHALL responder `429` con código `too_many_attempts` y cabecera `Retry-After` en
segundos, y NO SHALL guardarse el comentario. Un comentario rechazado por validación, por pertenencia o por el link NO
SHALL gastar intento. El contador SHALL fallar abierto: si el almacén de contadores no responde, el comentario SHALL
guardarse. Borrar NO SHALL contar.

#### Scenario: Ventana agotada

- **GIVEN** un miembro que ya publicó 30 comentarios en la ventana actual
- **WHEN** publica otro
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After` mayor que 0
- **AND** NO SHALL guardarse el comentario

#### Scenario: Lo rechazado no gasta

- **GIVEN** un miembro con 29 comentarios en la ventana actual
- **WHEN** envía un comentario vacío y después uno válido
- **THEN** la primera respuesta SHALL ser `400` y la segunda `201`

#### Scenario: Contador caído

- **GIVEN** el almacén de contadores sin responder
- **WHEN** un miembro comenta
- **THEN** la respuesta SHALL ser `201`

#### Scenario: Borrar no cuenta

- **GIVEN** un miembro que agotó sus comentarios de la ventana
- **WHEN** borra uno suyo
- **THEN** la respuesta SHALL ser `204`

### Requirement: Autores que ya no están en el grupo

Salir de un grupo o ser expulsado NO SHALL borrar ni cambiar los comentarios de esa persona en ese grupo. Mientras no
sea miembro, sus comentarios SHALL seguir mostrándose con su nombre y `authorLeft` `true`, en el hilo y en el resumen.
Esa persona no puede leerlos ni borrarlos porque no es miembro. Si vuelve a unirse, `authorLeft` SHALL volver a ser
`false` y SHALL poder borrarlos. `authorLeft` SHALL derivarse de la pertenencia actual en cada lectura, sin escribir
nada al salir, al ser expulsado ni al volver.

#### Scenario: Sale del grupo

- **GIVEN** un link con un comentario de Beto en un grupo
- **WHEN** Beto sale del grupo y Ana pide el hilo
- **THEN** el comentario SHALL seguir ahí con el nombre de Beto y `authorLeft` `true`

#### Scenario: Expulsado

- **GIVEN** un link con un comentario de Beto en un grupo
- **WHEN** la propietaria expulsa a Beto y pide los links del grupo
- **THEN** el resumen de ese link SHALL incluir el comentario de Beto con `authorLeft` `true`

#### Scenario: Fuera del grupo no borra

- **GIVEN** Beto, que salió de un grupo donde dejó un comentario
- **WHEN** intenta borrarlo
- **THEN** la respuesta SHALL ser `404` con código `group_not_found`
- **AND** el comentario SHALL seguir en el hilo

#### Scenario: Vuelve y borra

- **GIVEN** Beto, que salió de un grupo donde dejó un comentario
- **WHEN** vuelve a unirse con el código y borra el comentario
- **THEN** antes de borrarlo SHALL verlo con `authorLeft` `false`
- **AND** la respuesta al borrado SHALL ser `204`

### Requirement: Los comentarios viven con la relación

Los comentarios de un link en un grupo SHALL existir solo mientras el link esté compartido en ese grupo. Quitar el link
del grupo SHALL borrar sus comentarios de ese grupo en la misma transacción que borra la relación: o se borra todo o no
se borra nada. Volver a compartir después ese link en el grupo SHALL empezar con 0 comentarios. Quitarlo de un grupo NO
SHALL tocar los comentarios que tenga en otro. Un comentario que llega a la vez que se quita el link NO SHALL quedar
guardado sin su relación: o se guarda antes de quitarse el link (y se borra con él) o responde `404` con código
`link_not_found`.

#### Scenario: Quitar la oferta se lleva sus comentarios

- **GIVEN** un link con tres comentarios en un grupo
- **WHEN** quien lo compartió lo quita del grupo
- **THEN** NO SHALL quedar ningún comentario de ese link en ese grupo

#### Scenario: Volver a compartirla empieza de cero

- **GIVEN** un link que tuvo comentarios en un grupo y se quitó
- **WHEN** un miembro lo vuelve a guardar en ese grupo
- **THEN** el listado SHALL traer ese link con `comments.count` 0

#### Scenario: Otro grupo no se entera

- **GIVEN** un link con comentarios en los grupos A y B
- **WHEN** se quita de A
- **THEN** los comentarios de B SHALL seguir intactos

#### Scenario: Comentar mientras se quita

- **WHEN** llegan a la vez un comentario sobre un link y la petición de quitar ese link del grupo
- **THEN** al terminar las dos NO SHALL existir ningún comentario de ese link en ese grupo
- **AND** el comentario SHALL haber respondido `201` o `404` con código `link_not_found`

### Requirement: Publicar no depende del aviso

Publicar o borrar un comentario SHALL avisar después de confirmarse, por el canal que describe `platform/realtime`. Si el
aviso no se puede publicar, la respuesta NO SHALL retrasarse ni fallar por ello, y SHALL registrarse como mucho un aviso
por racha de fallos, sin el texto del comentario ni el usuario.

#### Scenario: Redis caído al comentar

- **GIVEN** Redis sin responder
- **WHEN** un miembro comenta
- **THEN** la respuesta SHALL ser `201` y el comentario SHALL aparecer en el hilo
