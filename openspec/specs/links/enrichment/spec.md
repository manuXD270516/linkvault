# links/enrichment Specification

## Purpose

Convierte un link guardado en una vacante legible: descarga la página con cortesía, extrae sus campos por la cadena
lícita, los mezcla respetando lo que una persona escribió a mano y deja constancia de qué salió de dónde.

## Requirements

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

La extracción SHALL recorrer, en orden, JSON-LD `JobPosting`, los metadatos de la página (Open Graph y equivalentes) y
`runTask('extract-job')` sobre el texto de la página. La cadena SHALL detenerse
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
host. Cuando el `robots.txt` no declare un grupo para nuestro agente, SHALL aplicarse el grupo `*`. Las descargas SHALL
hacerse de una en una por dominio, con una espera entre peticiones al mismo dominio que SHALL ser la mayor entre la
configurada y el `Crawl-delay` que pida el sitio. Una descarga SHALL abandonarse si supera su tiempo máximo o su tamaño
máximo, y SHALL aceptarse solo contenido HTML.

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
- **AND** entre dos peticiones al mismo dominio SHALL mediar la espera efectiva

#### Scenario: Respuesta que no es HTML

- **WHEN** la URL responde un PDF o una imagen
- **THEN** NO SHALL intentarse extraer nada de ella
- **AND** el link SHALL quedar en `failed`

#### Scenario: Página demasiado grande o demasiado lenta

- **WHEN** la descarga supera el tamaño o el tiempo máximos
- **THEN** SHALL abandonarse
- **AND** el link SHALL quedar en `failed` con el motivo registrado

#### Scenario: El sitio pide más espera de la configurada

- **GIVEN** un host cuyo `robots.txt` declara un `Crawl-delay` mayor que el configurado
- **WHEN** se enriquecen dos links de ese host
- **THEN** entre las dos peticiones SHALL mediar al menos el `Crawl-delay` del sitio

#### Scenario: Host que nunca se libera

- **GIVEN** un host ocupado que no termina de liberarse
- **WHEN** un link suyo se aplaza más veces de las permitidas
- **THEN** SHALL darse por fallido con un motivo propio, transitorio y reintentable
- **AND** ese motivo NO SHALL ser el de que el sitio nos bloquea, porque el sitio no ha dicho nada

#### Scenario: robots.txt que no es texto

- **GIVEN** un host que responde una página de bloqueo al pedir su `robots.txt`
- **WHEN** se enriquece un link suyo
- **THEN** NO SHALL interpretarse como reglas
- **AND** SHALL asumirse permitido

### Requirement: Preview con procedencia por campo

Cada campo del preview SHALL guardarse con su valor y su origen: `auto` con el identificador del extractor que lo
produjo, `pasted` con quién pegó el texto del que salió y cuándo, o `manual` con quién lo escribió y cuándo. Al leerse,
los orígenes `pasted` y `manual` SHALL decir el nombre visible de la persona, no su identificador. La precedencia SHALL
ser **escrito a mano > pegado > leído de la página**, y SHALL ser una sola regla para todo lo que escribe el preview: un
merge automático NO SHALL sobrescribir un campo `manual` ni `pasted`, y un pegado NO SHALL sobrescribir un campo
`manual`. Cuando una persona sustituya un campo —pegando una descripción o escribiendo a mano—, SHALL guardarse la
entrada sustituida —valor, origen, extractor, autor y fecha— para poder volver a ella; una relectura automática que
sustituye un valor automático por otro no guarda nada, y la tarjeta no ofrece volver en ese campo. En un merge
automático o en un pegado, un valor vacío NO SHALL sustituir a uno que ya hubiera; una persona que escribe a mano sí
puede vaciar un campo. Dentro de una misma pasada,
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
- **THEN** `title` SHALL seguir siendo el escrito a mano, con lo que guardaba para deshacerse intacto
- **AND** los campos que nadie escribió a mano SHALL tomar lo pegado

#### Scenario: Volver a lo pegado

- **GIVEN** un campo que salió de un texto pegado y después se corrigió a mano
- **WHEN** se pide volver al valor anterior
- **THEN** el campo SHALL recuperar el valor pegado, con su origen `pasted` y su autor

### Requirement: Estados del enriquecimiento

Al terminar, el link SHALL quedar en `enriched` si tiene los campos obligatorios, en `partial` si obtuvo algo pero no
todos, y en `failed` si no obtuvo nada o no pudo descargarse. Si el preview ya tiene campos pegados o escritos a mano,
una lectura fallida NO SHALL devolverlo a `failed`: su estado SHALL seguir derivándose de los campos que tiene, con el
motivo del fallo registrado. `previewVersion` SHALL subir en uno con cada enriquecimiento que cambie el preview, y la
escritura SHALL condicionarse a la versión leída, de modo que dos enriquecimientos simultáneos no se pisen. Un fallo
SHALL registrar su motivo en el link, sin la respuesta del sitio ni datos personales, tomándolo de una lista cerrada que
SHALL distinguir lo que no es culpa nuestra —el sitio prohíbe la lectura, el sitio nos bloquea, o lo que hay no es una
oferta— del resto de fallos. Un job que agote sus reintentos SHALL dejar el link en `failed` con su propio motivo, nunca
en `pending` para siempre.

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

#### Scenario: La bolsa prohíbe la lectura

- **GIVEN** una plataforma cuyo `robots.txt` prohíbe la ruta de sus ofertas
- **WHEN** se enriquece un link suyo
- **THEN** el motivo SHALL ser el de lectura prohibida, distinto del de un error de la página

#### Scenario: La bolsa nos bloquea

- **WHEN** el sitio responde `403` a la descarga
- **THEN** el motivo SHALL ser el de bloqueo, distinto del de lectura prohibida y del de error
- **AND** NO SHALL poder reintentarse

#### Scenario: La bolsa pide esperar

- **WHEN** el sitio responde `429` a la descarga
- **THEN** el motivo SHALL ser transitorio y reintentable, distinto del de bloqueo

#### Scenario: Lo compartido no era una oferta

- **GIVEN** un enlace a un vídeo, cuya página se descarga y se parsea sin `JobPosting`
- **WHEN** la extracción con IA responde que eso no es una vacante
- **THEN** el motivo SHALL decir que no parece una oferta
- **AND** NO SHALL guardarse un título sacado de esa página

#### Scenario: Se leyó la página pero no había datos

- **GIVEN** una página que se leyó bien y de la que ninguna etapa obtuvo título ni empresa, sin que la IA llegara a
  pronunciarse
- **WHEN** termina la cadena
- **THEN** el motivo SHALL ser el de falta de datos, distinto del de "no es una oferta"

#### Scenario: Job que agota sus reintentos

- **GIVEN** un job cuyo procesamiento falla siempre
- **WHEN** se agotan sus reintentos
- **THEN** el link SHALL quedar `failed` con el motivo de reintentos agotados
- **AND** NO SHALL quedarse en `pending`

#### Scenario: Una lectura fallida no borra lo pegado

- **GIVEN** un link completado pegando su texto, con título y empresa
- **WHEN** una lectura posterior de su página falla
- **THEN** el link SHALL seguir `enriched` con lo pegado
- **AND** SHALL registrar el motivo del fallo

### Requirement: Extracción estructurada con IA

La tarea `extract-job` SHALL declararse `public` y devolver una salida validada que diga **si lo leído es una vacante**
y, cuando lo sea, sus campos. La ejecución SHALL atribuirse a quien guardó el link, para que cuente contra sus cuotas y
quede en el registro de uso. Su ejecución SHALL
recibir un plazo total por link, de modo que una importación grande no espere los tiempos máximos de toda la cadena de
proveedores. Una degradación de la IA NO SHALL fallar el job: el link SHALL quedar con lo que las etapas anteriores
hayan obtenido.

#### Scenario: Salida validada

- **WHEN** `extract-job` responde que es una vacante, con sus campos válidos
- **THEN** sus campos SHALL entrar en el merge con origen `auto`

#### Scenario: La IA dice que no es una vacante

- **WHEN** `extract-job` responde que lo leído no es una vacante
- **THEN** NO SHALL entrar ningún campo suyo en el preview

#### Scenario: La ejecución se atribuye a quien guardó el link

- **WHEN** se ejecuta `extract-job` para un link
- **THEN** el registro de uso SHALL atribuirla a quien guardó ese link

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
`manual`. La edición SHALL subir `previewVersion`, de modo que un enriquecimiento en vuelo que partió de la versión
anterior NO SHALL poder pisarla. SHALL poder devolverse un campo a su valor automático anterior. Quien no puede ver el
link SHALL recibir `404` con código `link_not_found`. Un campo que no existe en el schema SHALL responder `400`.

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

#### Scenario: Edición durante un enriquecimiento

- **GIVEN** un enriquecimiento en curso que leyó el link antes de la edición
- **WHEN** una persona corrige un campo y el enriquecimiento intenta escribir después
- **THEN** SHALL conservarse lo que escribió la persona
- **AND** el enriquecimiento SHALL terminar sin escribir

#### Scenario: Volver a lo extraído

- **GIVEN** un campo editado a mano que desplazó un valor automático
- **WHEN** quien puede verlo pide devolverlo a lo extraído
- **THEN** el campo SHALL recuperar el valor automático y su origen

### Requirement: Reintentar la lectura de una oferta

`POST /api/links/:id/enrich` SHALL volver a pedir la lectura de un link que quedó `failed` por un motivo transitorio,
para quien puede verlo, respondiendo `202`. El link SHALL volver a `pending`, sin el motivo del fallo anterior, y su
petición SHALL viajar por el mismo camino transaccional que el alta de un link, de modo que funcione aunque la cola
conserve trabajo terminal de la versión anterior. Un link que la bolsa prohíbe leer, que la bolsa bloquea o que no es una
oferta NO SHALL reintentarse: la respuesta SHALL ser `409`. Los reintentos por link SHALL estar acotados por ventana de
tiempo, respondiendo `429` al superarse.

#### Scenario: Reintento aceptado

- **GIVEN** un link `failed` por un tiempo de espera agotado
- **WHEN** quien lo ve pide reintentar
- **THEN** la respuesta SHALL ser `202`
- **AND** el link SHALL quedar `pending` sin el motivo anterior
- **AND** SHALL quedar pedida su lectura

#### Scenario: Reintento con trabajo terminal retenido

- **GIVEN** un link cuyo intento anterior quedó registrado como fallido y sigue retenido
- **WHEN** quien lo ve pide reintentar
- **THEN** la lectura SHALL volver a ejecutarse

#### Scenario: Reintento inútil

- **GIVEN** un link `failed` porque la bolsa prohíbe la lectura
- **WHEN** alguien pide reintentar
- **THEN** la respuesta SHALL ser `409` diciendo que no se puede leer automáticamente
- **AND** NO SHALL pedirse ninguna lectura

#### Scenario: Demasiados reintentos

- **WHEN** se piden más reintentos de los permitidos para ese link en la ventana
- **THEN** la respuesta SHALL ser `429`

### Requirement: Reencolado de links sin preview

SHALL existir un comando que vuelva a pedir la lectura de links por su `previewStatus`, con un límite por ejecución y
sin ejecutarse solo al arrancar la aplicación. SHALL cubrir los que quedaron en `pending` sin trabajo vivo y, cuando se
le pida, los `failed` por un motivo transitorio, nunca los que la bolsa prohíbe leer, los que bloquea ni los que no son
ofertas. SHALL funcionar aunque la cola conserve trabajo terminal y aunque el publicador esté apagado, en cuyo caso las
peticiones SHALL esperar a que vuelva.

#### Scenario: Pendientes reencolados

- **GIVEN** links en `pending` sin evento ni job
- **WHEN** se ejecuta el comando
- **THEN** SHALL encolarse un job por cada uno con su `jobId` determinista
- **AND** SHALL informarse de cuántos se reencolaron

#### Scenario: No se duplica el trabajo que ya está en la cola

- **GIVEN** un link en `pending` cuyo trabajo sigue en la cola
- **WHEN** se ejecuta el comando
- **THEN** el link SHALL leerse una sola vez: el trabajo anterior SHALL descartarse por versión al llegarle el turno

#### Scenario: Publicador apagado

- **GIVEN** el publicador de la cola apagado
- **WHEN** se ejecuta el comando
- **THEN** las peticiones SHALL quedar registradas
- **AND** SHALL publicarse cuando el publicador vuelva

#### Scenario: Rescate de los transitorios

- **GIVEN** links `failed` por tiempo agotado y otros porque la bolsa prohíbe la lectura
- **WHEN** se ejecuta el comando pidiendo los fallidos
- **THEN** SHALL reencolarse solo los del primer grupo

### Requirement: Otras URLs de la misma vacante

Cuando `robots.txt` prohíba la `displayUrl` de un link, el worker SHALL probar las demás URLs de su historial **del
mismo host**, sin repetidas y las más recientes primero, pidiendo permiso a `robots.txt` para cada una dentro del mismo
turno del host, y SHALL leer la primera permitida. Una URL de otro host NO SHALL probarse. Solo si ninguna está
permitida SHALL rendirse con `robots_disallowed`. La `displayUrl` NO SHALL cambiar: sigue siendo la que se abre. Cuando
alguien vuelva a guardar la vacante con una URL que no estaba en su historial, **del mismo host** que la `displayUrl`, y
el link esté en `failed` por `robots_disallowed`, SHALL pedirse una lectura nueva en la misma operación, sin volver a
pedir la URL prohibida. Una URL nueva de otro host NO SHALL pedir nada, porque la lectura no la probaría.

#### Scenario: El historial tiene la misma vacante sin el parámetro prohibido

- **GIVEN** un link cuya `displayUrl` lleva un parámetro que el `robots.txt` del sitio prohíbe
- **AND** cuyo historial tiene la misma vacante sin ese parámetro, en el mismo host
- **WHEN** se enriquece
- **THEN** SHALL leerse la URL permitida del historial
- **AND** la `displayUrl` NO SHALL cambiar

#### Scenario: Se vuelve a guardar la vacante con otra URL

- **GIVEN** un link en `failed` porque `robots.txt` prohíbe su `displayUrl`
- **WHEN** alguien guarda la misma vacante con una URL que el sitio sí permite
- **THEN** SHALL pedirse una lectura nueva del link
- **AND** esa lectura SHALL usar la URL permitida

#### Scenario: Todo el historial está prohibido

- **GIVEN** un link cuyas URLs están todas prohibidas por `robots.txt`
- **WHEN** se enriquece
- **THEN** NO SHALL descargarse ninguna
- **AND** el link SHALL quedar `failed` con `robots_disallowed`

#### Scenario: URL del historial en otro host

- **GIVEN** un link cuya `displayUrl` está prohibida y cuyo historial solo tiene otra URL en un host distinto
- **WHEN** se enriquece
- **THEN** NO SHALL pedirse nada a ese otro host
- **AND** el link SHALL quedar `failed` con `robots_disallowed`
