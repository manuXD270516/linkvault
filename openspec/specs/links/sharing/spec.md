# links/sharing Specification

## Purpose

Permite guardar una vacante en un grupo o en privado, importar de golpe el chat donde circulan, saber si ese link ya
estaba en otro grupo propio, consultar lo guardado y quitar lo que no era una oferta.

## Requirements

### Requirement: Guardar un link

`POST /api/links` SHALL aceptar `url` y opcionalmente `groupId`, y responder `201` con el link (id, URL normalizada,
`displayUrl`, plataforma, `previewStatus`), `created` (si la vacante no existía en LinkVault), `shared`
(`created` o `already_there`, según si la relación con el destino es nueva) y `alreadyInGroups`. Con `groupId`, el usuario
SHALL ser miembro de ese grupo y el link SHALL quedar compartido en él; sin `groupId`, el link SHALL quedar solo en la
lista privada del usuario. Una URL no reconocida SHALL responder `400` con código `invalid_url`. Un grupo del que no se
es miembro, o un identificador mal formado, SHALL responder `404` con código `group_not_found`.

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

### Requirement: Compartir sin duplicar

Guardar en un grupo un link que ese grupo ya tiene NO SHALL crear una segunda relación ni cambiar quién lo compartió
primero, y SHALL responder `201` con `shared` `already_there` y quién lo compartió. El mismo link SHALL poder estar
en varios grupos y en la lista privada de varios usuarios a la vez.

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
reglas que guardar uno a uno y responder `201` con `created`, `existing`, `unrecognized` (las URLs que no se
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

### Requirement: El texto importado no se guarda

El texto recibido en la importación NO SHALL persistirse en ninguna colección ni registrarse en los logs: solo se guardan
las URLs extraídas y lo que de ellas se deriva.

#### Scenario: Texto con datos personales

- **WHEN** se importa un chat que contiene nombres, teléfonos y una URL de empleo
- **THEN** SHALL guardarse el link de esa URL
- **AND** ni la base de datos ni los logs SHALL contener el texto ni los teléfonos

### Requirement: Listado de links de un grupo

`GET /api/groups/:id/links` SHALL devolver, para los miembros del grupo, sus links con `id`, URL normalizada,
`displayUrl`, plataforma, `previewStatus`, quién los compartió (`sharedBy` con `userId` y `displayName`) y `sharedAt`,
ordenados por `sharedAt` y, a igualdad, por identificador, ambos descendentes, y paginados con `limit` (20 por defecto,
50 como máximo) y un `cursor` opaco. La respuesta SHALL incluir `total`, el número de links del grupo. Quien no es miembro SHALL recibir `404` con código `group_not_found`.

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

### Requirement: Listado de links privados

`GET /api/links/mine` SHALL devolver los links que el usuario guardó sin grupo, con los mismos campos, `total` y la
misma paginación, ordenados por fecha de guardado y, a igualdad, por identificador, ambos descendentes. NO SHALL incluir los links que solo guardó dentro de un grupo.

#### Scenario: Lista privada

- **GIVEN** un usuario con un link privado y otro guardado en un grupo
- **WHEN** consulta su lista privada
- **THEN** la respuesta SHALL ser `200` con solo el link privado

### Requirement: Quitar un link de un grupo o de la lista privada

`DELETE /api/groups/:id/links/:linkId` SHALL borrar la relación del link con el grupo y responder `204` si quien pide lo
compartió o es `owner` del grupo; otro miembro SHALL recibir `403` con código `forbidden`, y quien no es miembro `404`
con código `group_not_found`. `DELETE /api/links/mine/:linkId` SHALL borrar la entrada privada del usuario y responder
`204`. En ningún caso SHALL borrarse el `JobLink`: sigue disponible en los demás grupos y listas. Un link que no está en
ese grupo o en esa lista SHALL responder `404` con código `link_not_found`.

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
