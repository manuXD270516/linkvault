## MODIFIED Requirements

### Requirement: Preview con procedencia por campo

Cada campo del preview SHALL guardarse con su valor y su origen: `auto` con el identificador del extractor que lo
produjo, `pasted` con quién pegó el texto del que salió y cuándo, o `manual` con quién lo escribió y cuándo. Al leerse,
los orígenes `pasted` y `manual` SHALL decir el nombre visible de la persona, no su identificador. La precedencia SHALL
ser **escrito a mano > pegado > leído de la página**: un merge automático NO SHALL sobrescribir nunca un campo cuyo
origen es `manual` o `pasted`, y un campo pegado NO SHALL sobrescribir uno escrito a mano. Cuando una edición desplace
un valor, el campo SHALL guardar el valor desplazado y su origen, para poder volver a él. Dentro de una misma pasada,
entre dos valores automáticos SHALL ganar el de la etapa anterior de la cadena, que es la más fiable. Frente a lo ya
guardado, un valor automático nuevo SHALL sustituir al automático anterior aunque venga de una etapa menos fiable: la
página pudo cambiar.

#### Scenario: Lo manual no se pisa

- **GIVEN** un link cuyo `title` fue editado a mano
- **WHEN** se vuelve a enriquecer y la extracción propone otro título
- **THEN** el `title` SHALL seguir siendo el escrito a mano, con origen `manual`
- **AND** los demás campos SHALL actualizarse

#### Scenario: Gana la etapa más fiable

- **GIVEN** JSON-LD y la IA proponiendo empresas distintas en la misma pasada
- **WHEN** se mezclan
- **THEN** SHALL conservarse la de JSON-LD
- **AND** el campo SHALL decir de qué extractor salió

#### Scenario: Reenriquecimiento con datos nuevos

- **GIVEN** un link cuyo `title` automático salió de JSON-LD hace semanas
- **WHEN** se vuelve a enriquecer y solo la IA propone un título distinto
- **THEN** SHALL guardarse el título nuevo
- **AND** el campo SHALL decir que salió de la IA

#### Scenario: Se guarda lo que la edición desplazó

- **GIVEN** un link con el `title` extraído de la página
- **WHEN** una persona lo corrige a mano
- **THEN** el campo SHALL conservar el valor automático anterior y su extractor

#### Scenario: Una relectura no pisa lo pegado

- **GIVEN** un link cuyo `company` salió de un texto pegado
- **WHEN** se vuelve a leer la página y la extracción propone otra empresa
- **THEN** `company` SHALL seguir siendo la pegada, con origen `pasted`

#### Scenario: Pegar no pisa lo escrito a mano

- **GIVEN** un link cuyo `title` escribió una persona a mano
- **WHEN** otra persona pega el texto de la oferta y de él sale otro título
- **THEN** `title` SHALL seguir siendo el escrito a mano
- **AND** los campos que nadie escribió a mano SHALL tomar lo pegado

#### Scenario: Volver a lo pegado

- **GIVEN** un campo que salió de un texto pegado y después se corrigió a mano
- **WHEN** se pide volver al valor anterior
- **THEN** el campo SHALL recuperar el valor pegado, con su origen `pasted` y su autor

## ADDED Requirements

### Requirement: Otras URLs de la misma vacante

Cuando `robots.txt` prohíba la `displayUrl` de un link, el worker SHALL probar en orden las demás URLs de su historial,
pidiendo permiso a `robots.txt` para cada una, y SHALL leer la primera permitida. Solo si ninguna lo está SHALL rendirse
con `robots_disallowed`. La `displayUrl` NO SHALL cambiar por ello: sigue siendo la que se abre.

#### Scenario: El historial tiene la misma vacante sin el parámetro prohibido

- **GIVEN** un link cuya `displayUrl` lleva un parámetro que el `robots.txt` del sitio prohíbe
- **AND** cuyo historial tiene la misma vacante sin ese parámetro
- **WHEN** se enriquece
- **THEN** SHALL leerse la URL permitida del historial
- **AND** la `displayUrl` NO SHALL cambiar

#### Scenario: Todo el historial está prohibido

- **GIVEN** un link cuyas URLs están todas prohibidas por `robots.txt`
- **WHEN** se enriquece
- **THEN** NO SHALL descargarse ninguna
- **AND** el link SHALL quedar `failed` con `robots_disallowed`
