## MODIFIED Requirements

### Requirement: Guardar un link

`POST /api/links` SHALL aceptar `url` y opcionalmente `groupId` y `note`, y responder `201` con:
- el link (id, URL normalizada, `displayUrl`, plataforma, `previewStatus`);
- `created`: si la vacante no existía en LinkVault;
- `shared`: `created` o `already_there`, según si la relación con el destino es nueva;
- `alreadyInGroups`.

Con `groupId`, el usuario SHALL ser miembro de ese grupo y el link SHALL quedar compartido en él; sin `groupId`, el link
SHALL quedar solo en la lista privada del usuario.

Con `groupId` y relación nueva, el link SHALL nacer publicado o sin publicar según la visibilidad por defecto del grupo
(spec `links/public-share`), y la respuesta SHALL traer su `publicShare` cuando nazca publicado. Sin `groupId` NO SHALL
crearse ningún enlace público.

`note` SHALL normalizarse primero, con las mismas reglas que el texto de un comentario:
- una `note` que tras normalizarse queda vacía SHALL tratarse como si no se hubiera enviado, también sin `groupId`;
- una `note` con texto SHALL admitirse solo con `groupId` y medir como mucho 280 caracteres;
- con texto y sin `groupId`, o de más de 280 caracteres, SHALL responder `400` con código `validation_error` nombrando
  `note`, sin guardar nada.

Una URL no reconocida SHALL responder `400` con código `invalid_url`. Un grupo del que no se es miembro, o un
identificador mal formado, SHALL responder `404` con código `group_not_found`.

#### Scenario: Guardar en un grupo

- **GIVEN** un miembro de un grupo
- **WHEN** guarda una URL de LinkedIn en ese grupo
- **THEN** la respuesta SHALL ser `201` con `previewStatus` `pending`
- **AND** el link SHALL aparecer en la lista del grupo

#### Scenario: Vacante conocida, nueva en mi grupo

- **GIVEN** una vacante ya guardada por otra persona en un grupo ajeno
- **WHEN** un usuario la guarda en su grupo por primera vez
- **THEN** la respuesta SHALL tener `created` `false` y `shared` `created`

#### Scenario: Guardar en privado

- **WHEN** un usuario guarda una URL sin `groupId`
- **THEN** la respuesta SHALL ser `201`
- **AND** el link SHALL aparecer en su lista privada y NO SHALL aparecer en ningún grupo
- **AND** NO SHALL traer `publicShare`

#### Scenario: URL no reconocida

- **WHEN** se guarda `no-es-una-url`
- **THEN** la respuesta SHALL ser `400` con código `invalid_url`

#### Scenario: Grupo ajeno

- **WHEN** un usuario guarda un link en un grupo del que no es miembro y en otro con identificador mal formado
- **THEN** ambas respuestas SHALL ser `404` con código `group_not_found` y cuerpos idénticos

#### Scenario: Guardar con una nota

- **GIVEN** Ana, miembro de un grupo
- **WHEN** guarda una URL en ese grupo con la nota "  Esta es la que te dije "
- **THEN** la respuesta SHALL ser `201` y el link SHALL traer la nota "Esta es la que te dije"
- **AND** el listado del grupo SHALL mostrar esa nota en ese link

#### Scenario: Nota sin grupo

- **WHEN** un usuario guarda una URL sin `groupId` y con la nota "Para mí"
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `note`
- **AND** NO SHALL guardarse ningún link

#### Scenario: Nota vacía sin grupo

- **WHEN** un usuario guarda una URL sin `groupId` y con la nota "   "
- **THEN** la respuesta SHALL ser `201` y el link SHALL quedar en su lista privada

#### Scenario: Nota demasiado larga

- **WHEN** un miembro guarda una URL en su grupo con una nota de 281 caracteres
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `note`

#### Scenario: Guardar en un grupo que comparte en público

- **GIVEN** un grupo con la visibilidad por defecto en `public`
- **WHEN** un miembro guarda una URL en él
- **THEN** la respuesta SHALL ser `201` y el link SHALL traer su `publicShare` con `slug` y URL

#### Scenario: Guardar en un grupo que no comparte en público

- **GIVEN** un grupo con la visibilidad por defecto en `private`
- **WHEN** un miembro guarda una URL en él
- **THEN** la respuesta SHALL ser `201` y el link NO SHALL traer `publicShare`

### Requirement: Compartir sin duplicar

Guardar en un grupo un link que ese grupo ya tiene NO SHALL crear una segunda relación, ni cambiar quién lo compartió
primero, ni cambiar su nota, ni cambiar su enlace público: ni lo publica si estaba sin publicar, ni lo despublica, ni le
cambia el `slug`. SHALL responder `201` con `shared` `already_there` y quién lo compartió. Una `note` enviada
en ese caso SHALL descartarse sin error. El mismo link SHALL poder estar en varios grupos y en la lista privada de varios
usuarios a la vez.

#### Scenario: Dos miembros comparten la misma vacante

- **GIVEN** un link ya compartido en un grupo por Ana
- **WHEN** Beto guarda la misma vacante en ese grupo
- **THEN** la respuesta SHALL ser `201` con `shared` `already_there` y que lo compartió Ana
- **AND** el grupo SHALL seguir mostrando un solo link, compartido por Ana

#### Scenario: El mismo link en dos grupos

- **GIVEN** un usuario miembro de dos grupos
- **WHEN** guarda la misma vacante en ambos
- **THEN** ambos grupos SHALL mostrar ese link
- **AND** SHALL existir un solo `JobLink`

#### Scenario: La nota del primero se queda

- **GIVEN** un link compartido en un grupo por Ana con la nota "Esta es la que te dije"
- **WHEN** Beto guarda la misma vacante en ese grupo con la nota "Yo también la vi"
- **THEN** la respuesta SHALL ser `201` con `shared` `already_there`
- **AND** el link SHALL seguir con la nota de Ana

#### Scenario: El enlace público del primero se queda

- **GIVEN** un link compartido en un grupo y despublicado a mano, con el grupo en visibilidad por defecto `public`
- **WHEN** otro miembro guarda la misma vacante en ese grupo
- **THEN** la respuesta SHALL ser `201` con `shared` `already_there`
- **AND** el link SHALL seguir sin enlace público

### Requirement: Importar links desde un texto

`POST /api/links/import` SHALL aceptar `text` (hasta 20 000 caracteres) y opcionalmente `groupId`, aplicar las mismas
reglas que guardar uno a uno —incluida la visibilidad por defecto del grupo, que SHALL aplicarse a cada relación nueva—
y responder `201` con `created`, `existing`, `unrecognized` (las URLs que no se
pudieron leer ni guardar: no superan la normalización o su guardado falló), `skipped` y los links resultantes. Las URLs SHALL procesarse en el orden del texto. El tope de 50 SHALL contar solo las que hay que guardar, no las que ya
estaban en el destino, de modo que volver a importar el mismo texto avance con las siguientes; el resto SHALL contarse en
`skipped`, sin error. Un fallo al procesar una URL NO SHALL impedir el resto. Un `text` más largo
del máximo SHALL responder `400` con código `text_too_long`.

#### Scenario: Importar un chat

- **GIVEN** un texto con cuatro URLs, dos de ellas la misma vacante y una ya guardada en el grupo
- **WHEN** se importa en ese grupo
- **THEN** la respuesta SHALL ser `201` con `created` 2 y `existing` 1

#### Scenario: Importar sin URLs

- **WHEN** se importa un texto sin enlaces
- **THEN** la respuesta SHALL ser `201` con `created` 0 y `existing` 0

#### Scenario: Chat con más de 50 enlaces

- **WHEN** se importa un texto con 60 URLs distintas
- **THEN** la respuesta SHALL ser `201` con 50 links procesados y `skipped` 10

#### Scenario: Segunda pasada del mismo chat

- **GIVEN** un texto de 60 URLs ya importado una vez, con 50 guardadas
- **WHEN** se importa el mismo texto de nuevo
- **THEN** la respuesta SHALL crear las 10 restantes y `skipped` SHALL ser 0

#### Scenario: Texto demasiado largo

- **WHEN** se importa un texto de más de 20 000 caracteres
- **THEN** la respuesta SHALL ser `400` con código `text_too_long`
- **AND** NO SHALL crearse ningún link

#### Scenario: Importar en un grupo que comparte en público

- **GIVEN** un grupo con la visibilidad por defecto en `public`
- **WHEN** un miembro importa un texto con tres URLs nuevas
- **THEN** los tres links SHALL traer `publicShare`, cada uno con un `slug` distinto

### Requirement: Listado de links de un grupo

`GET /api/groups/:id/links` SHALL devolver, para los miembros del grupo, sus links con:
- `id`, URL normalizada, `displayUrl`, plataforma y `previewStatus`;
- quién los compartió (`sharedBy` con `userId` y `displayName`) y `sharedAt`;
- la nota de quien lo compartió (`note` con `text` y `createdAt`), solo si la tiene;
- el resumen de sus comentarios en ese grupo (`comments`, spec `links/group-comments`);
- su enlace público (`publicShare` con `slug`, `url` y `publishedAt`), solo si lo tiene.

Los links SHALL ordenarse por `sharedAt` y, a igualdad, por identificador, ambos descendentes, y paginarse con `limit`
(20 por defecto, 50 como máximo) y un `cursor` opaco. La respuesta SHALL incluir `total`, el número de links del grupo.
Quien no es miembro SHALL recibir `404` con código `group_not_found`.

Añadir `publicShare` NO SHALL costar ninguna lectura más: viaja en la misma consulta de la relación.

#### Scenario: Miembro ve los links del grupo

- **GIVEN** un grupo con dos links
- **WHEN** un miembro consulta sus links
- **THEN** la respuesta SHALL ser `200` con los dos, el más reciente primero, cada uno con quién lo compartió

#### Scenario: Paginación sin saltos ni repetidos

- **GIVEN** un grupo con 50 links guardados en el mismo instante
- **WHEN** se recorren sus páginas de 20 en 20 con el cursor devuelto
- **THEN** SHALL verse los 50 exactamente una vez

#### Scenario: Extraño no ve los links

- **GIVEN** un usuario que no es miembro
- **WHEN** consulta los links de ese grupo
- **THEN** la respuesta SHALL ser `404` con código `group_not_found`

#### Scenario: Nota y comentarios en el listado

- **GIVEN** un grupo con un link compartido con nota y dos comentarios, y otro sin nota ni comentarios
- **WHEN** un miembro consulta sus links
- **THEN** el primero SHALL traer su `note` y `comments.count` 2
- **AND** el segundo NO SHALL traer `note` y SHALL traer `comments.count` 0

#### Scenario: Enlace público en el listado

- **GIVEN** un grupo con un link publicado y otro sin publicar
- **WHEN** un miembro consulta sus links
- **THEN** el primero SHALL traer `publicShare` con su `slug` y su URL
- **AND** el segundo NO SHALL traer `publicShare`

#### Scenario: El listado no cuesta más lecturas

- **GIVEN** un grupo con 20 links publicados
- **WHEN** un miembro consulta una página
- **THEN** el número de lecturas SHALL ser el mismo que con 2 links sin publicar

### Requirement: Listado de links privados

`GET /api/links/mine` SHALL devolver los links que el usuario guardó sin grupo, con los mismos campos que el listado de
un grupo salvo `note`, `comments` y `publicShare`, que NO SHALL incluirse, con `total` y la misma paginación. SHALL
ordenarlos por fecha de guardado y, a igualdad, por identificador, ambos descendentes. NO SHALL incluir los links que
solo guardó dentro de un grupo.

#### Scenario: Lista privada

- **GIVEN** un usuario con un link privado y otro guardado en un grupo
- **WHEN** consulta su lista privada
- **THEN** la respuesta SHALL ser `200` con solo el link privado

#### Scenario: La lista privada no trae comentarios

- **GIVEN** un usuario con un link en su lista privada que también tiene nota y comentarios en un grupo suyo
- **WHEN** consulta su lista privada
- **THEN** ese link NO SHALL traer `note` ni `comments`

#### Scenario: La lista privada no trae enlace público

- **GIVEN** un usuario con un link en su lista privada que además está publicado en un grupo suyo
- **WHEN** consulta su lista privada
- **THEN** ese link NO SHALL traer `publicShare`

### Requirement: Quitar un link de un grupo o de la lista privada

`DELETE /api/groups/:id/links/:linkId` SHALL borrar en una sola transacción la relación del link con el grupo, su nota,
su enlace público y todos sus comentarios en ese grupo. SHALL responder `204` si quien pide lo compartió o es `owner`
del grupo.
- Otro miembro SHALL recibir `403` con código `forbidden`.
- Quien no es miembro SHALL recibir `404` con código `group_not_found`.

`DELETE /api/links/mine/:linkId` SHALL borrar la entrada privada del usuario y responder `204`. En ningún caso SHALL
borrarse el `JobLink`: sigue disponible en los demás grupos y listas. Un link que no está en ese grupo o en esa lista
SHALL responder `404` con código `link_not_found`.

#### Scenario: Quitar lo que no era una oferta

- **GIVEN** un miembro que importó por error un enlace de un vídeo en su grupo
- **WHEN** lo quita del grupo
- **THEN** la respuesta SHALL ser `204`
- **AND** el link NO SHALL aparecer en la lista del grupo

#### Scenario: El owner limpia el grupo

- **GIVEN** un link compartido por otro miembro
- **WHEN** el `owner` lo quita
- **THEN** la respuesta SHALL ser `204`

#### Scenario: Un miembro no quita lo de otro

- **GIVEN** un link compartido por Ana
- **WHEN** Beto, miembro sin ser owner, intenta quitarlo
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** el link SHALL seguir en la lista

#### Scenario: Quitar no destruye la vacante

- **GIVEN** un link compartido en dos grupos
- **WHEN** se quita de uno
- **THEN** SHALL seguir apareciendo en el otro

#### Scenario: Quitar se lleva los comentarios de ese grupo

- **GIVEN** un link con nota y dos comentarios en un grupo
- **WHEN** quien lo compartió lo quita del grupo
- **THEN** la respuesta SHALL ser `204`
- **AND** NO SHALL quedar ningún comentario de ese link en ese grupo

#### Scenario: Todo o nada

- **GIVEN** un link con comentarios en un grupo y el borrado de sus comentarios forzado a fallar
- **WHEN** quien lo compartió lo quita del grupo
- **THEN** la respuesta SHALL ser un error
- **AND** el link SHALL seguir en el grupo con todos sus comentarios

#### Scenario: Quitar quema el enlace público

- **GIVEN** un link publicado en un grupo
- **WHEN** quien lo compartió lo quita del grupo
- **THEN** la respuesta SHALL ser `204`
- **AND** su página pública SHALL responder `404`
