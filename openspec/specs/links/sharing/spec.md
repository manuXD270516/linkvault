# links/sharing Specification

## Purpose

Permite guardar una vacante en un grupo o en privado, importar de golpe el chat donde circulan, saber si ese link ya
estaba en otro grupo propio, consultar lo guardado y quitar lo que no era una oferta.

## Requirements

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

### Requirement: Aviso de que ya está en otro grupo

La respuesta de `POST /api/links` SHALL incluir `alreadyInGroups`: los grupos del propio usuario, distintos del destino,
donde ese link ya estaba, con su `id` y su `name`. NO SHALL incluir grupos a los que el usuario no pertenece.

#### Scenario: El link ya estaba en otro grupo propio

- **GIVEN** un usuario con el link ya guardado en "Backend Bolivia"
- **WHEN** lo guarda en "Frontend LatAm"
- **THEN** `alreadyInGroups` SHALL incluir "Backend Bolivia"

#### Scenario: El link está en un grupo ajeno

- **GIVEN** un link compartido en un grupo del que el usuario no es miembro
- **WHEN** ese usuario lo guarda en su grupo
- **THEN** `alreadyInGroups` SHALL estar vacío

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

### Requirement: El texto importado no se guarda

El texto recibido en la importación NO SHALL persistirse en ninguna colección ni registrarse en los logs: solo se guardan
las URLs extraídas y lo que de ellas se deriva.

#### Scenario: Texto con datos personales

- **WHEN** se importa un chat que contiene nombres, teléfonos y una URL de empleo
- **THEN** SHALL guardarse el link de esa URL
- **AND** ni la base de datos ni los logs SHALL contener el texto ni los teléfonos

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

### Requirement: Límite de importaciones

`POST /api/links/import` SHALL contar las importaciones por usuario en una ventana de tiempo y SHALL responder `429` con
código `too_many_attempts` y la cabecera `Retry-After` al superarse el límite. El contador SHALL fallar abierto: si el
almacén de contadores no responde, la importación SHALL seguir adelante. Guardar un link de uno en uno NO SHALL contar
contra este límite.

#### Scenario: Ventana agotada

- **GIVEN** un usuario que ya agotó sus importaciones de la ventana
- **WHEN** importa otro texto
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`
- **AND** NO SHALL crearse ningún link

#### Scenario: El contador no responde

- **GIVEN** el almacén de contadores caído
- **WHEN** un usuario importa un texto
- **THEN** la importación SHALL completarse normalmente

#### Scenario: Guardar uno a uno no cuenta

- **GIVEN** un usuario que agotó sus importaciones de la ventana
- **WHEN** guarda un link suelto
- **THEN** la respuesta SHALL ser `201`

### Requirement: Links disponibles para otros módulos

El módulo de links SHALL exponer al resto de la API una única entrada que permita saber si una persona puede ver un link
(lo tiene en su lista privada o está compartido en un grupo del que es miembro), obtener en una sola consulta la ficha
de varios links por su identificador —identificador, `displayUrl`, plataforma, estado del preview, título y empresa—, y
saber cuáles de unos links están compartidos en un grupo, también en una sola consulta. Un identificador mal formado
SHALL tratarse como un link que no existe, sin error. Ningún archivo de dominio, aplicación o infraestructura de otro
módulo SHALL leer las colecciones de links, y el incumplimiento SHALL ser detectado por el lint.

#### Scenario: Otro módulo pregunta si alguien ve un link

- **GIVEN** un usuario con un link en su lista privada, otro compartido en un grupo suyo y otro solo en un grupo ajeno
- **WHEN** otro módulo pregunta si puede ver cada uno
- **THEN** la respuesta SHALL ser verdadera, verdadera y falsa respectivamente

#### Scenario: Fichas de varios links a la vez

- **GIVEN** tres links guardados, uno de ellos sin preview
- **WHEN** otro módulo pide sus fichas junto con un identificador `no-es-un-id`
- **THEN** SHALL recibir las tres fichas, la del link sin preview sin título ni empresa, y nada para el identificador mal
  formado

#### Scenario: Qué links están en un grupo

- **GIVEN** un grupo con los links L1 y L2
- **WHEN** otro módulo pregunta cuáles de L1, L2 y L3 están en ese grupo
- **THEN** la respuesta SHALL ser L1 y L2

#### Scenario: Acceso directo a las colecciones de links

- **GIVEN** un archivo de dominio, aplicación o infraestructura de otro módulo de `apps/api`
- **WHEN** importa el repositorio o los schemas de `links`
- **THEN** el lint SHALL fallar

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
