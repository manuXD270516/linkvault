# platform/realtime Specification

## Purpose

Lleva al navegador los avisos de lo que termina en segundo plano, para que una pantalla abierta se actualice sola sin
preguntar cada pocos segundos ni obligar a recargar.

## Requirements

### Requirement: Canal de eventos autenticado

`GET /api/events` SHALL abrir un flujo de eventos servidor→cliente para la sesión que lo pide, autenticado con el mismo
access token que el resto de la API y sin llevar credenciales en la URL. Sin sesión válida SHALL responder `401`. El
flujo SHALL enviar latidos periódicos para que los intermediarios no lo cierren, SHALL cerrarse limpiamente cuando el
cliente se va o cuando el proceso se apaga, y una sesión caducada NO SHALL poder reabrirlo.

#### Scenario: Suscripción con sesión

- **GIVEN** un usuario con sesión
- **WHEN** abre el canal de eventos
- **THEN** la respuesta SHALL ser `200` con un flujo de eventos abierto

#### Scenario: Sin sesión

- **WHEN** se abre el canal sin token válido
- **THEN** la respuesta SHALL ser `401`

#### Scenario: Credenciales fuera de la URL

- **WHEN** un cliente abre el canal
- **THEN** el token SHALL viajar en la cabecera de autorización
- **AND** la URL del canal NO SHALL contener ningún token

#### Scenario: Sesión caducada al reconectar

- **GIVEN** un cliente cuyo canal se cortó y cuyo access token ya caducó
- **WHEN** intenta reconectar sin renovarlo
- **THEN** la respuesta SHALL ser `401`

#### Scenario: Latido

- **GIVEN** un canal abierto sin eventos que enviar
- **WHEN** pasa el intervalo de latido
- **THEN** el servidor SHALL enviar un latido y el flujo SHALL seguir abierto

### Requirement: Cada quien recibe solo lo suyo

Un evento sobre un link SHALL llegar únicamente a los usuarios que pueden verlo: los miembros de un grupo donde está
compartido y quienes lo tienen en su lista privada. El evento NO SHALL llevar nada que esa persona no pueda ver ya de ese
link. Los avisos de comentarios de un link en un grupo tienen destinatarios más estrictos, solo los miembros actuales de
ese grupo, según el requisito "Aviso de comentarios de un link en un grupo".

#### Scenario: Miembro del grupo avisado

- **GIVEN** dos miembros de un grupo con el canal abierto
- **WHEN** termina el enriquecimiento de un link de ese grupo
- **THEN** ambos SHALL recibir el aviso de ese link

#### Scenario: Extraño no avisado

- **GIVEN** un usuario que no comparte grupo ni lista con ese link
- **WHEN** termina su enriquecimiento
- **THEN** ese usuario NO SHALL recibir ningún aviso

### Requirement: Aviso de link enriquecido

Cuando cambie el preview de un link —al terminar un enriquecimiento, al corregirlo a mano o al completarlo pegando su
descripción—, SHALL publicarse un aviso en el canal compartido que la API reparte como evento `link.enriched`, de modo
que llegue a todas las instancias de la API y no solo a la que hizo el cambio. El evento SHALL llevar el link ya
actualizado —su identificador, su estado, su versión, su preview con el origen de cada campo y el motivo del último
fallo si lo hubo—, de modo que quien lo recibe pueda pintar la tarjeta sin volver a preguntar. Publicar el aviso NO
SHALL retrasar ni hacer fallar la respuesta de quien hizo el cambio. Si no hay nadie escuchando, el aviso SHALL
descartarse sin error: el estado verdadero sigue en la base de datos y el listado lo trae al recargar.

#### Scenario: La tarjeta se entera

- **GIVEN** un usuario mirando la lista de links de su grupo
- **WHEN** termina el enriquecimiento de uno de ellos
- **THEN** SHALL recibir `link.enriched` con ese link, su estado, su versión y su preview
- **AND** NO SHALL necesitar ninguna petición más para mostrarlo

#### Scenario: Nadie escuchando

- **GIVEN** ningún canal abierto
- **WHEN** termina un enriquecimiento
- **THEN** el aviso SHALL descartarse sin error
- **AND** el link SHALL quedar igualmente guardado con su preview

#### Scenario: El aviso no reemplaza a la base de datos

- **GIVEN** un usuario que abre la lista después de que terminara el enriquecimiento
- **WHEN** carga la pantalla
- **THEN** SHALL ver el preview ya enriquecido sin depender de haber recibido el aviso

#### Scenario: Lo que pega otro miembro también llega

- **GIVEN** dos miembros mirando la misma tarjeta
- **WHEN** uno de ellos la completa pegando su descripción
- **THEN** el otro SHALL recibir `link.enriched` con los campos pegados

#### Scenario: Una corrección a mano también llega

- **GIVEN** dos miembros mirando la misma tarjeta
- **WHEN** uno de ellos corrige el título a mano
- **THEN** el otro SHALL recibir `link.enriched` con el título corregido

### Requirement: Aviso de comentarios de un link en un grupo

Publicar o borrar un comentario SHALL provocar, una vez confirmada la escritura, un aviso en el canal compartido de
Redis que llegue a todas las instancias de la API.
- **El aviso interno de Redis** SHALL llevar solo identificadores (grupo, link, comentario) y el tipo de cambio
  (`created` o `deleted`), nunca el texto ni el autor.
- **Cada instancia** SHALL repartirlo como evento `group-link.comments` solo a los miembros actuales de ese grupo. NO SHALL
  llegar a quienes ven el link por otro grupo o por su lista privada.
- **El evento SSE** SHALL llevar el grupo, el link, el tipo de cambio, el identificador del comentario y el resumen ya
  actualizado de ese link en ese grupo: `count`, `revision`, `sharedAt` y los dos últimos comentarios, con su texto, su
  autor y `authorLeft`. Así la tarjeta se pinta sin otra petición.
- **Si el link ya no está compartido en el grupo** al repartir, NO SHALL enviarse nada.
- **Si nadie escucha**, el aviso SHALL descartarse sin error: la verdad sigue en la base de datos.
- **Un aviso que no cumple el contrato** SHALL descartarse sin registrar su contenido.

#### Scenario: Los miembros se enteran

- **GIVEN** Ana y Beto, miembros de un grupo, con el canal abierto
- **WHEN** Beto comenta un link de ese grupo
- **THEN** ambos SHALL recibir `group-link.comments` con `created`, el identificador del comentario y el resumen con
  `count`, `revision` y ese comentario en `latest`

#### Scenario: Quien ve el link por otro sitio no recibe nada

- **GIVEN** Carla, que tiene ese link en su lista privada y en otro grupo suyo, con el canal abierto, y no es miembro
  del grupo
- **WHEN** Beto comenta el link en su grupo
- **THEN** Carla NO SHALL recibir `group-link.comments`

#### Scenario: Quien salió deja de recibir

- **GIVEN** Beto, que salió del grupo y mantiene el canal abierto
- **WHEN** Ana comenta un link del grupo
- **THEN** Beto NO SHALL recibir el aviso

#### Scenario: Borrar también avisa

- **GIVEN** un link con tres comentarios y dos miembros con el canal abierto
- **WHEN** la propietaria borra uno
- **THEN** ambos SHALL recibir `group-link.comments` con `deleted`, el identificador del comentario y `count` 2

#### Scenario: Link quitado antes de repartir

- **GIVEN** un aviso de comentario cuyo link se quitó del grupo antes de repartirse
- **WHEN** la instancia lo reparte
- **THEN** ningún miembro SHALL recibir `group-link.comments`

#### Scenario: El texto no viaja por Redis

- **WHEN** un miembro comenta "Piden inglés C1"
- **THEN** el mensaje publicado en el canal de Redis NO SHALL contener ese texto ni el identificador del autor

#### Scenario: Nadie escuchando

- **GIVEN** ningún canal abierto
- **WHEN** un miembro comenta
- **THEN** el aviso SHALL descartarse sin error y el comentario SHALL quedar guardado
