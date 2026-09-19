## MODIFIED Requirements

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
