## MODIFIED Requirements

### Requirement: Estado del preview

Un `JobLink` nuevo SHALL nacer con `previewStatus` `pending`, `previewVersion` 1 y sin datos de la vacante más allá de su
URL y su plataforma. El estado SHALL ser `pending` mientras no se haya intentado enriquecer, `enriched` cuando la
extracción completó los campos obligatorios, `partial` cuando obtuvo algo pero no todos, `failed` cuando no obtuvo nada,
y `manual` cuando una persona editó el preview.

`previewVersion` SHALL ser el contador de versión del preview y SHALL subir con cada cambio, venga de un
enriquecimiento, de una edición manual o de una nueva petición de lectura; SHALL identificar el trabajo pedido, de modo
que una petición nueva nunca comparta identidad con una anterior. La copia guardada de la página SHALL localizarse por
la clave que el link guarda, NO SHALL deducirse de `previewVersion`.

#### Scenario: Link recién guardado

- **WHEN** se guarda una URL que no existía
- **THEN** el link SHALL tener `previewStatus` `pending`
- **AND** su respuesta SHALL incluir la URL normalizada, `displayUrl` y la plataforma reconocida

#### Scenario: Estado tras enriquecer

- **GIVEN** un link en `pending` con `previewVersion` 1
- **WHEN** su enriquecimiento completa título y empresa
- **THEN** su `previewStatus` SHALL ser `enriched` y su `previewVersion` 2

#### Scenario: Estado tras editar a mano

- **GIVEN** un link `partial` con `previewVersion` 2
- **WHEN** una persona corrige uno de sus campos
- **THEN** su `previewStatus` SHALL ser `manual` y su `previewVersion` 3

#### Scenario: La copia guardada no se deduce de la versión

- **GIVEN** un link enriquecido en su versión 2 y editado después a mano
- **WHEN** se busca la copia de su página
- **THEN** SHALL encontrarse por la clave que el link guarda
