# links/job-link Specification

## Purpose

Da a cada vacante una identidad única dentro de LinkVault, para que la misma oferta compartida con URLs distintas sea un
solo link con un solo preview, y deja registrado el estado de ese preview mientras llega su enriquecimiento.

## Requirements

### Requirement: Normalización de URL para identidad

Toda URL SHALL normalizarse **solo para calcular su identidad**: esquema y host en minúsculas, esquema `https` cuando el
original es `http`, sin `www.`, sin fragmento, sin barra final salvo en la raíz, sin parámetros de campaña (`utm_*`,
`gclid`, `fbclid`, `mc_cid`, `mc_eid`, `igshid`, `ref`, `trk`, `trkCampaign`) y con el resto de parámetros ordenados. La
URL normalizada NO SHALL usarse para abrir ni para descargar: para eso se usa la primera URL original guardada
(`displayUrl`), que es la que escribió una persona. Una URL que no es `http(s)` o que no tiene host SHALL rechazarse como
no reconocida.

#### Scenario: URL normalizada

- **WHEN** se guarda `HTTP://WWW.Example.com/Jobs/123/?utm_source=wa&ref=x#top`
- **THEN** la URL normalizada SHALL ser `https://example.com/Jobs/123`
- **AND** `displayUrl` SHALL ser la URL tal como se escribió

#### Scenario: Esquema no soportado

- **WHEN** se guarda `ftp://example.com/job` o `javascript:alert(1)`
- **THEN** la URL SHALL contarse como no reconocida y NO SHALL crearse ningún link

### Requirement: Canonicalización por plataforma

Un canonicalizador SHALL reconocer la plataforma y extraer su identificador de vacante para LinkedIn, Computrabajo,
Indeed, Trabajopolis y Get on Board, produciendo `{ platform, externalJobId }`. Cuando ninguno reconoce la URL, la
plataforma SHALL ser `generic` y NO SHALL haber `externalJobId`.

#### Scenario: LinkedIn en sus tres formas

- **WHEN** se canonicalizan `https://www.linkedin.com/jobs/view/3811111111/`, `https://linkedin.com/comm/jobs/view/3811111111` y `https://www.linkedin.com/jobs/search/?currentJobId=3811111111`
- **THEN** las tres SHALL producir `platform` `linkedin` y `externalJobId` `3811111111`

#### Scenario: Computrabajo con slug variable

- **WHEN** se canonicalizan dos URLs de Computrabajo con el mismo identificador de oferta y distinto slug
- **THEN** ambas SHALL producir el mismo `platform` y `externalJobId`

#### Scenario: Plataforma desconocida

- **WHEN** se canonicaliza `https://empresa.example/careers/backend`
- **THEN** `platform` SHALL ser `generic` y NO SHALL haber `externalJobId`

### Requirement: Identidad y dedupe del link

La clave de dedupe SHALL ser `platform:externalJobId` cuando la canonicalización lo reconoce, y el hash de la URL
normalizada cuando no. Guardar una URL cuya clave ya existe NO SHALL crear un `JobLink` nuevo: SHALL reutilizarse el
existente y SHALL añadirse la URL original a su historial si no estaba, conservando como máximo las 20 últimas. La
unicidad SHALL estar garantizada por un índice.

#### Scenario: Misma vacante con dos URLs

- **GIVEN** un link creado desde `https://www.linkedin.com/jobs/view/3811111111/`
- **WHEN** otro usuario guarda `https://www.linkedin.com/jobs/search/?currentJobId=3811111111`
- **THEN** SHALL reutilizarse el mismo `JobLink`
- **AND** sus URLs originales SHALL incluir las dos

#### Scenario: Vacantes distintas de la misma plataforma

- **WHEN** se guardan dos URLs de LinkedIn con identificadores distintos
- **THEN** SHALL crearse dos `JobLink`

#### Scenario: Historial acotado

- **WHEN** se guardan 25 URLs distintas que comparten la misma clave de dedupe
- **THEN** el link SHALL conservar como máximo 20 URLs originales
- **AND** todas las peticiones SHALL responder correctamente

#### Scenario: Altas simultáneas de la misma URL

- **WHEN** dos peticiones guardan a la vez la misma URL
- **THEN** SHALL existir exactamente un `JobLink` con esa clave
- **AND** ninguna de las dos peticiones SHALL fallar

### Requirement: Estado del preview

Un `JobLink` nuevo SHALL nacer con `previewStatus` `pending` y sin datos de la vacante más allá de su URL y su
plataforma. El estado SHALL poder ser `pending`, `enriched`, `partial`, `failed` o `manual`; en este change solo se
produce `pending`.

#### Scenario: Link recién guardado

- **WHEN** se guarda una URL que no existía
- **THEN** el link SHALL tener `previewStatus` `pending`
- **AND** su respuesta SHALL incluir la URL normalizada, `displayUrl` y la plataforma reconocida

### Requirement: Extracción de URLs de un texto

Al importar texto plano, SHALL extraerse todas las URLs `http(s)` que contenga, en el orden en que aparecen, sin
duplicados tras normalizar, tolerando la puntuación y los adornos del chat (paréntesis, comas, comillas y marcas de hora
o de autor). El resto del texto SHALL ignorarse. Una URL extraída que no supera la normalización SHALL contarse como
`unrecognized`.

#### Scenario: Chat de WhatsApp pegado

- **WHEN** se importa un texto con tres mensajes, dos con la misma URL de LinkedIn y uno con una URL de Computrabajo entre paréntesis
- **THEN** SHALL extraerse dos URLs, una por vacante

#### Scenario: Texto sin URLs

- **WHEN** se importa un texto sin ninguna URL
- **THEN** el resultado SHALL indicar cero creados, cero repetidos y cero `unrecognized`

#### Scenario: Enlace que no se puede leer

- **WHEN** se importa un texto que contiene `http://` suelto y `ftp://example.com/job`
- **THEN** `unrecognized` SHALL contar esas dos entradas
- **AND** NO SHALL crearse ningún link por ellas
