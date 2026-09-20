## ADDED Requirements

### Requirement: Aviso del paso de un análisis de CV

Mientras un análisis de encaje avanza, SHALL publicarse un aviso en el canal compartido que la API reparte por el canal
autenticado como evento `analysis.step`, de modo que llegue a todas las instancias de la API y no solo a la que corre el
análisis. Una espera de decenas de segundos SHALL poder mostrar en qué va sin sondear.

- **El aviso interno** y **el evento SSE** SHALL llevar únicamente el identificador del análisis, el link al que se
  refiere, el paso alcanzado —uno del conjunto cerrado que declara la capacidad `cv/match`— y su momento.
- **NO SHALL llevar nada del CV ni del informe**: ningún fragmento del texto del CV, ningún dato personal, ninguna
  sugerencia, ninguna lista de skills, ningún `score`, ningún prompt renderizado y ninguna credencial de proveedor.
- **El último paso** SHALL decir que el análisis terminó —con informe completo, degradado o con fallo— **sin llevar el
  informe**: quien lo recibe SHALL pedir el resultado a la API.
- **Solo su dueño** SHALL recibirlo, en todos los canales que tenga abiertos. Quien comparte grupo o lista con ese link
  NO SHALL recibirlo, porque el análisis es de quien lo pidió, no del link.
- **Si nadie escucha**, el aviso SHALL descartarse sin error: el análisis SHALL seguir su curso y su resultado SHALL
  quedar guardado igual. Publicarlo NO SHALL retrasar ni hacer fallar el análisis.
- **Un aviso que no cumple el contrato** SHALL descartarse sin registrar su contenido.

#### Scenario: La espera deja de ser un vacío

- **GIVEN** Ana con el canal abierto y un análisis suyo en marcha
- **WHEN** el análisis alcanza un paso nuevo
- **THEN** Ana SHALL recibir `analysis.step` con el identificador de ese análisis, su link y el paso alcanzado

#### Scenario: Un compañero de grupo no se entera

- **GIVEN** Ana y Beto, miembros del mismo grupo, con el canal abierto, y un link compartido allí
- **WHEN** Ana analiza ese link con su CV
- **THEN** Beto NO SHALL recibir ningún `analysis.step` de ese análisis

#### Scenario: El paso no lleva nada del CV

- **GIVEN** un análisis sobre un CV que contiene el nombre, el teléfono y la experiencia de Ana
- **WHEN** se publica cualquiera de sus pasos
- **THEN** ni el mensaje publicado en el canal compartido ni el evento SSE SHALL contener ninguna palabra de ese CV
- **AND** NO SHALL contener el `score` ni ninguna sugerencia

#### Scenario: El final avisa, pero el informe se pide

- **GIVEN** Ana con el canal abierto
- **WHEN** su análisis termina con un informe completo
- **THEN** SHALL recibir un `analysis.step` que dice que terminó
- **AND** ese evento NO SHALL contener el informe

#### Scenario: Todas sus pestañas

- **GIVEN** Ana con el canal abierto en dos pestañas
- **WHEN** su análisis alcanza un paso nuevo
- **THEN** las dos SHALL recibir el mismo `analysis.step`

#### Scenario: Nadie escuchando

- **GIVEN** ningún canal abierto
- **WHEN** un análisis avanza y termina
- **THEN** los avisos SHALL descartarse sin error
- **AND** el resultado del análisis SHALL quedar igualmente guardado

#### Scenario: El aviso no reemplaza a la base de datos

- **GIVEN** Ana, que tenía el canal cerrado mientras su análisis terminaba
- **WHEN** abre la pantalla del análisis
- **THEN** SHALL ver el informe terminado sin depender de haber recibido ningún `analysis.step`

## MODIFIED Requirements

### Requirement: Cada quien recibe solo lo suyo

Un evento sobre un link SHALL llegar únicamente a los usuarios que pueden verlo: los miembros de un grupo donde está
compartido y quienes lo tienen en su lista privada. El evento NO SHALL llevar nada que esa persona no pueda ver ya de ese
link. Los avisos de comentarios de un link en un grupo tienen destinatarios más estrictos, solo los miembros actuales de
ese grupo, según el requisito "Aviso de comentarios de un link en un grupo". Los avisos del paso de un análisis de CV
tienen los destinatarios más estrictos de todos, solo la persona que pidió el análisis, según el requisito "Aviso del
paso de un análisis de CV": poder ver el link NO SHALL bastar para recibirlos.

#### Scenario: Miembro del grupo avisado

- **GIVEN** dos miembros de un grupo con el canal abierto
- **WHEN** termina el enriquecimiento de un link de ese grupo
- **THEN** ambos SHALL recibir el aviso de ese link

#### Scenario: Extraño no avisado

- **GIVEN** un usuario que no comparte grupo ni lista con ese link
- **WHEN** termina su enriquecimiento
- **THEN** ese usuario NO SHALL recibir ningún aviso

#### Scenario: Ver el link no da derecho al análisis ajeno

- **GIVEN** Ana y Beto, que ven el mismo link por su grupo, ambos con el canal abierto
- **WHEN** avanza un análisis que pidió Ana sobre ese link
- **THEN** solo Ana SHALL recibir los avisos de ese análisis
