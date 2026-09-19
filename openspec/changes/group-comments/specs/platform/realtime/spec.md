## ADDED Requirements

### Requirement: Aviso de comentarios de un link en un grupo

Publicar o borrar un comentario SHALL provocar, una vez confirmado, un aviso en el canal compartido de Redis que llegue a
todas las instancias de la API. El aviso interno SHALL llevar solo identificadores (grupo, link, comentario) y el tipo de
cambio (`created` o `deleted`): nunca el texto ni el autor. Cada instancia SHALL repartirlo como evento
`group-link.comments` **solo a los miembros actuales de ese grupo**, no a quienes ven el link por otro grupo o por su
lista privada. El evento SHALL llevar el grupo, el link, el tipo de cambio, el identificador del comentario y el resumen
ya actualizado de ese link en ese grupo (`count` y los dos últimos comentarios, con su texto, su autor y `authorLeft`),
de modo que la tarjeta se pinte sin otra petición. Si nadie escucha, el aviso SHALL descartarse sin error, y la verdad
sigue en la base de datos. Un aviso que no cumple el contrato SHALL descartarse sin registrar su contenido.

#### Scenario: Los miembros se enteran

- **GIVEN** Ana y Beto, miembros de un grupo, con el canal abierto
- **WHEN** Beto comenta un link de ese grupo
- **THEN** ambos SHALL recibir `group-link.comments` con `created`, el identificador del comentario y el resumen con
  `count` y ese comentario en `latest`

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
- **WHEN** el autor de uno lo borra
- **THEN** ambos SHALL recibir `group-link.comments` con `deleted`, el identificador del comentario y `count` 2

#### Scenario: El texto no viaja por Redis

- **WHEN** un miembro comenta "Piden inglés C1"
- **THEN** el mensaje publicado en el canal de Redis NO SHALL contener ese texto ni el identificador del autor

#### Scenario: Nadie escuchando

- **GIVEN** ningún canal abierto
- **WHEN** un miembro comenta
- **THEN** el aviso SHALL descartarse sin error y el comentario SHALL quedar guardado
