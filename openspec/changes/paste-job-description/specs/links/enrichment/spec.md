## MODIFIED Requirements

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

## ADDED Requirements

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
