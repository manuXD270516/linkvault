## Purpose

Convierte un link guardado en una vacante legible: descarga la página con cortesía, extrae sus campos por la cadena
lícita, los mezcla respetando lo que una persona escribió a mano y deja constancia de qué salió de dónde.

## ADDED Requirements

### Requirement: Consumo del trabajo encolado

`apps/worker` SHALL registrar un consumidor de la cola `enrich-link` que, por cada job, lea el link por su `linkId` y
ejecute la cadena de extracción. El consumidor SHALL ser idempotente **por sí mismo**: procesar dos veces el mismo
evento SHALL dejar el mismo resultado, sin depender de que el `jobId` determinista siga en la cola. Un job cuyo
`previewVersion` es anterior al del link SHALL descartarse sin trabajo. Un link que ya no existe SHALL completar el job
sin error.

#### Scenario: Job procesado

- **GIVEN** un link en `pending` y su job en la cola
- **WHEN** el worker lo consume
- **THEN** el link SHALL quedar con su preview y un `previewStatus` distinto de `pending`

#### Scenario: El mismo evento dos veces

- **GIVEN** un link ya enriquecido por un job
- **WHEN** el mismo evento vuelve a entrar en la cola tras expirar su retención
- **THEN** el resultado SHALL ser el mismo que tras la primera pasada
- **AND** NO SHALL crearse una versión nueva del preview

#### Scenario: Job de una versión vieja

- **GIVEN** un link cuyo `previewVersion` ya avanzó
- **WHEN** llega un job con el `previewVersion` anterior
- **THEN** el job SHALL completarse sin tocar el link

#### Scenario: Link borrado

- **WHEN** el job nombra un link que ya no existe
- **THEN** el job SHALL completarse sin error y sin reintentos

### Requirement: Cadena de extracción lícita

La extracción SHALL recorrer, en orden, JSON-LD `JobPosting`, los metadatos de la página (Open Graph y equivalentes), el
adaptador de la plataforma si lo hay, y `runTask('extract-job')` sobre el texto de la página. La cadena SHALL detenerse
en cuanto los campos obligatorios (`title` y `company`) estén completos. La etapa headless SHALL existir como último
eslabón y SHALL estar apagada mientras `FEATURE_HEADLESS_EXTRACTION` sea `false`. La descarga SHALL usar siempre
`displayUrl`, nunca la URL normalizada.

#### Scenario: La página trae JSON-LD

- **GIVEN** una página con `JobPosting` en JSON-LD con título y empresa
- **WHEN** se enriquece el link
- **THEN** el preview SHALL salir de esa etapa
- **AND** NO SHALL llamarse a la IA

#### Scenario: La página solo trae Open Graph

- **GIVEN** una página sin JSON-LD y con `og:title` y `og:description`
- **WHEN** se enriquece el link
- **THEN** los campos que aporta Open Graph SHALL estar en el preview
- **AND** la cadena SHALL continuar para completar los que falten

#### Scenario: Hace falta la IA

- **GIVEN** una página sin datos estructurados útiles
- **WHEN** se enriquece el link
- **THEN** SHALL ejecutarse `extract-job` sobre el texto de la página
- **AND** el preview SHALL llevar los campos que devolvió

#### Scenario: Headless apagado

- **GIVEN** `FEATURE_HEADLESS_EXTRACTION` en `false`
- **WHEN** ninguna etapa anterior completa los campos obligatorios
- **THEN** NO SHALL ejecutarse ninguna etapa headless
- **AND** el link SHALL quedar en `partial` o en `failed` según lo que se haya obtenido

#### Scenario: Se descarga lo que escribió la persona

- **GIVEN** un link cuya `displayUrl` y cuya URL normalizada difieren
- **WHEN** se enriquece
- **THEN** la petición SHALL ir a `displayUrl`

### Requirement: Cortesía con los sitios

Antes de descargar, el worker SHALL consultar el `robots.txt` del host y SHALL respetar sus reglas para su
`User-Agent`, que SHALL identificar al producto y ofrecer una forma de contacto. El `robots.txt` SHALL cachearse por
host. Las descargas SHALL hacerse de una en una por dominio, con una espera mínima entre peticiones al mismo dominio.
Una descarga SHALL abandonarse si supera su tiempo máximo o su tamaño máximo, y SHALL aceptarse solo contenido HTML.

#### Scenario: robots.txt prohíbe la ruta

- **GIVEN** un host cuyo `robots.txt` prohíbe esa ruta para nuestro agente
- **WHEN** se enriquece un link de esa ruta
- **THEN** NO SHALL descargarse la página
- **AND** el link SHALL quedar en `failed` con el motivo registrado

#### Scenario: robots.txt cacheado

- **GIVEN** dos links del mismo host enriquecidos seguidos
- **WHEN** se procesan
- **THEN** el `robots.txt` SHALL pedirse una sola vez

#### Scenario: Una descarga a la vez por dominio

- **GIVEN** diez links del mismo dominio encolados a la vez
- **WHEN** el worker los procesa
- **THEN** NO SHALL haber dos descargas simultáneas a ese dominio
- **AND** entre dos peticiones al mismo dominio SHALL mediar la espera configurada

#### Scenario: Respuesta que no es HTML

- **WHEN** la URL responde un PDF o una imagen
- **THEN** NO SHALL intentarse extraer nada de ella
- **AND** el link SHALL quedar en `failed`

#### Scenario: Página demasiado grande o demasiado lenta

- **WHEN** la descarga supera el tamaño o el tiempo máximos
- **THEN** SHALL abandonarse
- **AND** el link SHALL quedar en `failed` con el motivo registrado

### Requirement: Preview con procedencia por campo

Cada campo del preview SHALL guardarse con su valor, su origen (`auto` con el identificador del extractor que lo
produjo, o `manual` con quién lo escribió y cuándo) y su confianza. Un merge automático NO SHALL sobrescribir nunca un
campo cuyo origen es `manual`. Entre dos valores automáticos SHALL ganar el de la etapa anterior de la cadena, que es la
más fiable.

#### Scenario: Lo manual no se pisa

- **GIVEN** un link cuyo `title` fue editado a mano
- **WHEN** se vuelve a enriquecer y la extracción propone otro título
- **THEN** el `title` SHALL seguir siendo el escrito a mano, con origen `manual`
- **AND** los demás campos SHALL actualizarse

#### Scenario: Gana la etapa más fiable

- **GIVEN** JSON-LD y la IA proponiendo empresas distintas
- **WHEN** se mezclan
- **THEN** SHALL conservarse la de JSON-LD
- **AND** el campo SHALL decir de qué extractor salió

### Requirement: Estados del enriquecimiento

Al terminar, el link SHALL quedar en `enriched` si tiene los campos obligatorios, en `partial` si obtuvo algo pero no
todos, y en `failed` si no obtuvo nada o no pudo descargarse. `previewVersion` SHALL subir en uno con cada
enriquecimiento que cambie el preview, y la escritura SHALL condicionarse a la versión leída, de modo que dos
enriquecimientos simultáneos no se pisen. Un fallo SHALL registrar su motivo en el link, sin la respuesta del sitio ni
datos personales.

#### Scenario: Enriquecido

- **WHEN** la cadena obtiene título y empresa
- **THEN** el link SHALL quedar `enriched` con `previewVersion` una unidad mayor

#### Scenario: Parcial

- **WHEN** la cadena obtiene solo el título
- **THEN** el link SHALL quedar `partial`
- **AND** el preview SHALL llevar lo obtenido

#### Scenario: Fallido

- **WHEN** la página responde `404`
- **THEN** el link SHALL quedar `failed` con el motivo registrado
- **AND** el motivo NO SHALL incluir el cuerpo de la respuesta

#### Scenario: Dos enriquecimientos a la vez

- **GIVEN** dos ejecuciones sobre el mismo link partiendo de la misma versión
- **WHEN** ambas terminan
- **THEN** solo una SHALL escribir
- **AND** el link SHALL tener `previewVersion` una sola unidad mayor

### Requirement: Extracción estructurada con IA

La tarea `extract-job` SHALL declararse `public` y devolver un `JobPreview` validado por su schema. Su ejecución SHALL
recibir un plazo total por link, de modo que una importación grande no espere los tiempos máximos de toda la cadena de
proveedores. Una degradación de la IA NO SHALL fallar el job: el link SHALL quedar con lo que las etapas anteriores
hayan obtenido.

#### Scenario: Salida validada

- **WHEN** `extract-job` responde con un `JobPreview` válido
- **THEN** sus campos SHALL entrar en el merge con origen `auto`

#### Scenario: IA degradada

- **GIVEN** una cadena de proveedores que degrada
- **WHEN** se enriquece un link del que Open Graph dio el título
- **THEN** el link SHALL quedar `partial` con ese título
- **AND** el job SHALL completarse sin error

#### Scenario: Plazo agotado

- **GIVEN** un plazo por link ya consumido por las etapas anteriores
- **WHEN** llega el turno de la IA
- **THEN** NO SHALL ejecutarse
- **AND** el link SHALL quedar con lo obtenido hasta ahí

### Requirement: Snapshot de la página

Cuando se descargue HTML, SHALL guardarse una copia comprimida en el almacenamiento de objetos, identificada por el link
y su `previewVersion`, y su clave SHALL quedar en el link. Un fallo al guardar el snapshot NO SHALL impedir que el
preview se guarde.

#### Scenario: Snapshot guardado

- **WHEN** se enriquece un link descargando su página
- **THEN** SHALL existir el objeto de esa versión
- **AND** el link SHALL llevar su clave

#### Scenario: Almacenamiento caído

- **GIVEN** el almacenamiento de objetos sin responder
- **WHEN** se enriquece un link
- **THEN** el preview SHALL guardarse igualmente
- **AND** el link NO SHALL llevar clave de snapshot

### Requirement: Edición manual del preview

`PATCH /api/links/:id/preview` SHALL permitir a quien puede ver el link corregir los campos del preview. Los campos
enviados SHALL guardarse con origen `manual`, quién los escribió y cuándo, y el link SHALL pasar a `previewStatus`
`manual`. Quien no puede ver el link SHALL recibir `404` con código `link_not_found`. Un campo que no existe en el
schema SHALL responder `400`.

#### Scenario: Corregir el título

- **GIVEN** un link con un título mal extraído
- **WHEN** un usuario que lo ve envía otro título
- **THEN** la respuesta SHALL ser `200` con el preview actualizado
- **AND** ese campo SHALL tener origen `manual` y el link estado `manual`

#### Scenario: Link que no se puede ver

- **WHEN** alguien que no comparte grupo ni lista con ese link intenta editarlo
- **THEN** la respuesta SHALL ser `404` con código `link_not_found`

#### Scenario: Campo desconocido

- **WHEN** se envía un campo que no está en el schema del preview
- **THEN** la respuesta SHALL ser `400` nombrando el campo

### Requirement: Reencolado de links sin preview

SHALL existir un comando que reencole los links en `previewStatus` `pending` que no tengan trabajo vivo, reutilizando el
mismo `jobId` determinista, con un límite por ejecución y sin ejecutarse solo al arrancar la aplicación.

#### Scenario: Pendientes reencolados

- **GIVEN** links en `pending` sin evento ni job
- **WHEN** se ejecuta el comando
- **THEN** SHALL encolarse un job por cada uno con su `jobId` determinista
- **AND** SHALL informarse de cuántos se reencolaron

#### Scenario: No se duplica lo que ya está en la cola

- **GIVEN** un link en `pending` cuyo job sigue en la cola
- **WHEN** se ejecuta el comando
- **THEN** NO SHALL añadirse un job duplicado
