## MODIFIED Requirements

### Requirement: Estado del preview

Un `JobLink` nuevo SHALL nacer con `previewStatus` `pending`, `previewVersion` 1 y sin datos de la vacante más allá de su
URL y su plataforma. El estado SHALL ser `pending` mientras no se haya intentado enriquecer, `enriched` cuando la
extracción completó los campos obligatorios, `partial` cuando obtuvo algo pero no todos, `failed` cuando no obtuvo nada,
y `manual` cuando una persona editó el preview. `previewVersion` SHALL subir en uno con cada enriquecimiento que cambie
el preview y SHALL identificar la versión del trabajo encolado y del snapshot guardado.

#### Scenario: Link recién guardado

- **WHEN** se guarda una URL que no existía
- **THEN** el link SHALL tener `previewStatus` `pending`
- **AND** su respuesta SHALL incluir la URL normalizada, `displayUrl` y la plataforma reconocida

#### Scenario: Estado tras enriquecer

- **GIVEN** un link en `pending` con `previewVersion` 1
- **WHEN** su enriquecimiento completa título y empresa
- **THEN** su `previewStatus` SHALL ser `enriched` y su `previewVersion` 2

#### Scenario: Estado tras editar a mano

- **GIVEN** un link `partial`
- **WHEN** una persona corrige uno de sus campos
- **THEN** su `previewStatus` SHALL ser `manual`
