## MODIFIED Requirements

### Requirement: Guardar un link

`POST /api/links` SHALL aceptar `url` y opcionalmente `groupId` y `note`, y responder `201` con:
- el link (id, URL normalizada, `displayUrl`, plataforma, `previewStatus`);
- `created`: si la vacante no existía en LinkVault;
- `shared`: `created` o `already_there`, según si la relación con el destino es nueva;
- `alreadyInGroups`.

Con `groupId`, el usuario SHALL ser miembro de ese grupo y el link SHALL quedar compartido en él; sin `groupId`, el link
SHALL quedar solo en la lista privada del usuario.

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

### Requirement: Compartir sin duplicar

Guardar en un grupo un link que ese grupo ya tiene NO SHALL crear una segunda relación, ni cambiar quién lo compartió
primero, ni cambiar su nota. SHALL responder `201` con `shared` `already_there` y quién lo compartió. Una `note` enviada
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

### Requirement: Listado de links de un grupo

`GET /api/groups/:id/links` SHALL devolver, para los miembros del grupo, sus links con:
- `id`, URL normalizada, `displayUrl`, plataforma y `previewStatus`;
- quién los compartió (`sharedBy` con `userId` y `displayName`) y `sharedAt`;
- la nota de quien lo compartió (`note` con `text` y `createdAt`), solo si la tiene;
- el resumen de sus comentarios en ese grupo (`comments`, spec `links/group-comments`).

Los links SHALL ordenarse por `sharedAt` y, a igualdad, por identificador, ambos descendentes, y paginarse con `limit`
(20 por defecto, 50 como máximo) y un `cursor` opaco. La respuesta SHALL incluir `total`, el número de links del grupo.
Quien no es miembro SHALL recibir `404` con código `group_not_found`.

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

### Requirement: Listado de links privados

`GET /api/links/mine` SHALL devolver los links que el usuario guardó sin grupo, con los mismos campos que el listado de
un grupo salvo `note` y `comments`, que NO SHALL incluirse, con `total` y la misma paginación. SHALL ordenarlos por fecha
de guardado y, a igualdad, por identificador, ambos descendentes. NO SHALL incluir los links que solo guardó dentro de
un grupo.

#### Scenario: Lista privada

- **GIVEN** un usuario con un link privado y otro guardado en un grupo
- **WHEN** consulta su lista privada
- **THEN** la respuesta SHALL ser `200` con solo el link privado

#### Scenario: La lista privada no trae comentarios

- **GIVEN** un usuario con un link en su lista privada que también tiene nota y comentarios en un grupo suyo
- **WHEN** consulta su lista privada
- **THEN** ese link NO SHALL traer `note` ni `comments`

### Requirement: Quitar un link de un grupo o de la lista privada

`DELETE /api/groups/:id/links/:linkId` SHALL borrar en una sola transacción la relación del link con el grupo, su nota y
todos sus comentarios en ese grupo. SHALL responder `204` si quien pide lo compartió o es `owner` del grupo.
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

## ADDED Requirements

### Requirement: Nota de quien comparte

Cada link compartido en un grupo SHALL poder llevar como mucho una nota. La escribe solo quien crea la relación, al
guardarlo con `POST /api/links`. Después NO SHALL poder editarse: solo borrarse.
`DELETE /api/groups/:id/links/:linkId/note` SHALL comprobar, en este orden:
1. la pertenencia: quien no es miembro SHALL recibir `404` con código `group_not_found`;
2. la relación: un link que no está en el grupo SHALL recibir `404` con código `link_not_found`;
3. el permiso: quien no compartió el link y no es `owner` SHALL recibir `403` con código `forbidden`, tenga o no nota
   el link;
4. el borrado: SHALL quitar la nota y responder `204`, la hubiera o no. Si al borrar la relación ya no existe, SHALL
   responder `404` con código `link_not_found`.

`POST /api/links/import` NO SHALL aceptar nota.

#### Scenario: Quien compartió quita su nota

- **GIVEN** un link que Ana compartió en un grupo con la nota "Esta es la que te dije"
- **WHEN** Ana borra la nota
- **THEN** la respuesta SHALL ser `204`
- **AND** el link NO SHALL traer `note` en el listado del grupo

#### Scenario: El propietario quita una nota ajena

- **GIVEN** un link con nota compartido por Beto en un grupo cuya propietaria es Ana
- **WHEN** Ana borra la nota
- **THEN** la respuesta SHALL ser `204` y el link SHALL seguir en el grupo sin nota

#### Scenario: Otro miembro no la quita

- **GIVEN** un link con nota compartido por Beto
- **WHEN** Carla, miembro sin ser owner, intenta borrar la nota
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** la nota NO SHALL cambiar

#### Scenario: Quitar una nota que ya no está

- **GIVEN** un link compartido por Ana cuya nota ya se quitó desde otra pestaña
- **WHEN** Ana vuelve a pedir que se quite
- **THEN** la respuesta SHALL ser `204`

#### Scenario: Sin permiso aunque no haya nota

- **GIVEN** un link sin nota compartido por Beto
- **WHEN** Carla, miembro sin ser owner, pide quitar la nota
- **THEN** la respuesta SHALL ser `403` con código `forbidden`

#### Scenario: La nota no se edita

- **GIVEN** un link con nota compartido por Ana
- **WHEN** Ana envía un `PATCH` a la ruta de la nota con otro texto
- **THEN** la respuesta SHALL ser `404` y la nota NO SHALL cambiar

#### Scenario: Importar no escribe notas

- **WHEN** un miembro importa un chat en su grupo enviando también `note`
- **THEN** los links importados NO SHALL traer nota
