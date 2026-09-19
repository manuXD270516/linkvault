## MODIFIED Requirements

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

## ADDED Requirements

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
