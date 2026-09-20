## MODIFIED Requirements

### Requirement: Listado de mis CV

`GET /api/cv` SHALL devolver `200` con `items`: los CV de quien pide, del más reciente al más antiguo, cada uno con
`id`, `fileName`, `fileType`, `sizeBytes`, `version`, `isDefault`, `uploadedAt`, `extraction` (`status`,
`failureReason?`, `textChars`, `extractedAt?`) y `matchAnalysesCount`. Sin CV, `items` SHALL ser una lista vacía.

`matchAnalysesCount` SHALL ser el número de análisis de encaje **de quien consulta** hechos con ese CV, es decir los que
desaparecerían al eliminarlo, para que la confirmación de borrado pueda decir cuántos son sin pedir nada más.

- SHALL contarse **solo** lo de quien pide: ningún análisis de otra persona SHALL sumar en el recuento de ningún CV.
- SHALL ser siempre un número entero presente en la respuesta y SHALL valer `0` cuando ese CV no tiene ningún análisis.
  `0` es aquí un valor legítimo y NO SHALL omitirse, ni enviarse como nulo, ni tratarse como «dato desconocido».
- SHALL contar los análisis guardados con ese CV **cualquiera que sea su estado** —terminados, degradados, fallidos o
  todavía en curso—, porque eliminar el CV se los lleva a todos.
- NO SHALL acompañarse de **nada del contenido** de esos análisis: ni `score`, ni sugerencias, ni habilidades, ni
  fragmentos del CV, ni el texto de la oferta. Del análisis solo SHALL viajar cuántos son.
- SHALL viajar en toda respuesta que devuelva la lista de CV —el listado, el marcado por defecto y el borrado— y en la de
  la subida, donde un CV recién creado SHALL traer `0`.
- La consulta a la base SHALL traer únicamente el recuento, nunca los documentos de los análisis.

El listado NO SHALL incluir el texto extraído, la marca de texto recortado, la clave del objeto ni ningún CV de otra
persona, y NO SHALL exigir paginación: el máximo es 5.

#### Scenario: Lista con tres versiones

- **GIVEN** Ana con las versiones 1, 2 y 3
- **WHEN** pide su lista
- **THEN** SHALL recibir las tres, de la 3 a la 1, con su estado de extracción

#### Scenario: Lista vacía

- **GIVEN** Beto sin ningún CV
- **WHEN** pide su lista
- **THEN** SHALL recibir `200` con `items` vacío

#### Scenario: La lista es solo mía

- **GIVEN** Ana con dos CV y Beto con uno
- **WHEN** Beto pide su lista
- **THEN** SHALL recibir solo el suyo

#### Scenario: Cada CV dice cuántos análisis se irían con él

- **GIVEN** Ana con dos CV, tres análisis de encaje hechos con el primero y uno con el segundo
- **WHEN** pide su lista
- **THEN** el primero SHALL traer `matchAnalysesCount` 3 y el segundo `matchAnalysesCount` 1

#### Scenario: Un CV sin análisis trae cero

- **GIVEN** Ana con un CV que nunca usó para analizar ninguna oferta
- **WHEN** pide su lista
- **THEN** ese CV SHALL traer `matchAnalysesCount` `0`
- **AND** el campo SHALL estar presente en la respuesta y NO SHALL ser nulo ni faltar

#### Scenario: El recuento cuenta también los que no terminaron

- **GIVEN** Ana con un CV y tres análisis hechos con él: uno `done`, uno `failed` y uno todavía en curso
- **WHEN** pide su lista
- **THEN** ese CV SHALL traer `matchAnalysesCount` 3
- **AND** el número SHALL coincidir con los análisis que se borrarían al eliminar ese CV

#### Scenario: El recuento es solo el de quien pide

- **GIVEN** una oferta compartida en un grupo, analizada por Ana con su CV y por Beto con el suyo
- **WHEN** cada uno pide su lista
- **THEN** el `matchAnalysesCount` de cada CV SHALL contar solo los análisis de su dueño
- **AND** ningún análisis de la otra persona SHALL sumar en él

#### Scenario: El recuento no arrastra el análisis

- **GIVEN** Ana con un CV y análisis hechos con él
- **WHEN** pide su lista
- **THEN** la respuesta NO SHALL contener `score`, sugerencias, habilidades ni ningún fragmento del CV
- **AND** la consulta a la base NO SHALL traer los documentos de los análisis

#### Scenario: El recuento viaja en toda lista de CV

- **GIVEN** Ana con dos CV y análisis hechos con uno de ellos
- **WHEN** marca el otro por defecto y después borra uno
- **THEN** cada CV de las listas devueltas SHALL traer su `matchAnalysesCount`
- **AND** un CV recién subido SHALL traerlo con valor `0`
