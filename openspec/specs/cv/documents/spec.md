# cv/documents Specification

## Purpose

Guarda el archivo más personal que el producto maneja. Define qué se acepta como CV y qué se
rechaza en la puerta, dónde vive el binario y dónde el texto, cómo se suceden las versiones y cuál es el que vale, qué
proyecta cada respuesta —y, sobre todo, qué no sale nunca por ninguna de ellas: los bytes del archivo no se devuelven.

## Requirements

### Requirement: Subir un CV

`POST /api/cv` SHALL aceptar un cuerpo `multipart/form-data` con **una sola parte de archivo** llamada `file` y, si el
archivo es admisible, guardar sus bytes en el almacén de objetos y crear un CV de quien pide. SHALL responder `201` con
`id`, `fileName`, `fileType`, `sizeBytes`, `version`, `isDefault`, `uploadedAt` y `extraction` (`status` `pending`,
`textChars` 0).

- La respuesta NO SHALL incluir el texto extraído, la marca de texto recortado, la clave del objeto ni ningún dato de
  otra persona.
- El nombre del archivo SHALL guardarse saneado: sin rutas, sin caracteres de control, sin los de cambio de dirección
  del texto, **sin comillas dobles, barras invertidas ni `;`**, recortado a 120 code points conservando su extensión y,
  si queda vacío, sustituido por `cv.pdf` o `cv.docx` según el tipo detectado.
- Los errores del parser de multipart SHALL traducirse antes de llegar al filtro global, **por defecto**: cualquier
  error del parser SHALL responder `400 validation_error` nombrando `file`, salvo los casos declarados: un archivo que
  supera el límite SHALL responder `413 file_too_large` y un cuerpo que no es multipart, `415
  unsupported_media_type`. Una petición multipart **sin parte `file`**, que no produce ningún error del parser, SHALL
  responder también `400 validation_error` nombrando `file`. **Ninguno SHALL responder `500`.**
- El mensaje del código `unsupported_media_type` SHALL ser genérico, sin afirmar que el cuerpo deba ser JSON: lo
  comparten rutas que aceptan formatos distintos.
- Mientras la subida no termine bien, NO SHALL quedar ningún CV guardado ni ningún objeto referenciado por uno.

#### Scenario: Primera subida

- **GIVEN** Ana con sesión y sin ningún CV
- **WHEN** sube `CV_backend.pdf` de 312 KB
- **THEN** la respuesta SHALL ser `201` con `version` 1, `isDefault` `true` y `extraction.status` `pending`
- **AND** el almacén de objetos SHALL recibir los bytes con la clave derivada del identificador del CV

#### Scenario: Petición sin archivo

- **WHEN** Ana llama a `POST /api/cv` con un cuerpo multipart sin parte `file`
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `file`
- **AND** NO SHALL guardarse ningún CV y NO SHALL llamarse al almacén de objetos

#### Scenario: Dos archivos en la misma petición

- **WHEN** Ana envía dos partes de archivo en la misma petición
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `file`
- **AND** NO SHALL guardarse ningún CV

#### Scenario: Cuerpo que no es multipart

- **WHEN** Ana llama a `POST /api/cv` con un cuerpo JSON
- **THEN** la respuesta SHALL ser `415` con código `unsupported_media_type`
- **AND** NO SHALL ser `500`
- **AND** el mensaje NO SHALL decir que el cuerpo deba ser JSON

#### Scenario: Un campo de más en el formulario

- **WHEN** Ana envía la parte `file` junto a un campo de texto
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `file`
- **AND** NO SHALL ser `500`

#### Scenario: Un error del parser que no conocemos

- **GIVEN** el parser de multipart fallando con un código que la API no tiene declarado
- **WHEN** Ana sube un archivo
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `file`
- **AND** NO SHALL ser `500`

#### Scenario: Nombre de archivo con ruta y caracteres raros

- **WHEN** Ana sube un archivo llamado `../../etc/CV"a;b\\c‮fdp.pdf`
- **THEN** el `fileName` guardado NO SHALL contener rutas, comillas, `;`, barras invertidas ni el carácter de cambio de
  dirección
- **AND** la clave del objeto NO SHALL contener ninguna parte de ese nombre

#### Scenario: El almacén no responde al subir

- **GIVEN** el almacén de objetos devolviendo error
- **WHEN** Ana sube un CV válido
- **THEN** la respuesta SHALL ser `500` con código `internal_error`
- **AND** NO SHALL quedar ningún CV guardado ni ningún evento pendiente
- **AND** el intento SHALL devolverse al contador, de modo que la siguiente subida válida SHALL aceptarse

### Requirement: El tipo del archivo lo deciden sus bytes

La API SHALL aceptar únicamente PDF y DOCX. La **autoridad** sobre el tipo SHALL ser la combinación de los **primeros
bytes del contenido** (`%PDF-` dentro del primer kilobyte para PDF, `PK\x03\x04` al principio para DOCX) y la
**extensión del nombre**, que tienen que coincidir. El `Content-Type` de la parte **solo SHALL descalificar**: si nombra
un tipo conocido que contradice a los otros dos, la respuesta SHALL ser `415 unsupported_file_type`; si es
`application/octet-stream`, está vacío o falta, NO SHALL impedir la subida.

Cuando el tipo no se puede determinar o las autoridades no coinciden, la respuesta SHALL ser `415` con código
`unsupported_file_type` y NO SHALL guardarse ni el objeto ni el CV.

La decisión SHALL tomarse con el **primer trozo del archivo que llega**, no con el archivo completo: en cuanto se sabe
que no es admisible, el flujo SHALL cortarse y la respuesta SHALL emitirse sin leer el resto.

La API NO SHALL descomprimir ni interpretar el contenido más allá de esa comprobación; un archivo que pasa la puerta
pero que ningún extractor puede leer SHALL resolverse en la extracción, con su estado de fallo.

#### Scenario: Ejecutable renombrado

- **WHEN** Ana sube un archivo llamado `CV.pdf` con `Content-Type: application/pdf` cuyo contenido empieza por `MZ`
- **THEN** la respuesta SHALL ser `415` con código `unsupported_file_type`
- **AND** NO SHALL llamarse al almacén de objetos

#### Scenario: El archivo inválido no se acumula

- **GIVEN** un archivo de 5 MiB que no es PDF ni DOCX
- **WHEN** Ana lo sube
- **THEN** la respuesta SHALL ser `415` con código `unsupported_file_type`
- **AND** la API NO SHALL haber acumulado más de un trozo del archivo en memoria
- **AND** la respuesta SHALL llegar al cliente aunque este haya terminado de enviarlo

#### Scenario: Extensión que no corresponde al contenido

- **WHEN** Ana sube un PDF válido con el nombre `CV.docx` y `Content-Type` de DOCX
- **THEN** la respuesta SHALL ser `415` con código `unsupported_file_type`

#### Scenario: PDF enviado como octet-stream

- **WHEN** Ana sube un PDF válido llamado `CV.pdf` con `Content-Type: application/octet-stream`
- **THEN** la respuesta SHALL ser `201` con `fileType` `pdf`

#### Scenario: DOCX sin Content-Type útil

- **WHEN** Ana sube un DOCX válido llamado `CV.docx` sin cabecera `Content-Type` en su parte
- **THEN** la respuesta SHALL ser `201` con `fileType` `docx`

#### Scenario: Content-Type que contradice

- **WHEN** Ana sube un PDF válido llamado `CV.pdf` con `Content-Type: image/png`
- **THEN** la respuesta SHALL ser `415` con código `unsupported_file_type`

#### Scenario: PDF con basura por delante

- **GIVEN** un PDF cuya firma `%PDF-` aparece tras unos bytes iniciales, dentro del primer kilobyte
- **WHEN** Ana lo sube
- **THEN** la respuesta SHALL ser `201` con `fileType` `pdf`

#### Scenario: Tipo declarado que no admitimos

- **WHEN** Ana sube un `CV.odt` con `Content-Type: application/vnd.oasis.opendocument.text`
- **THEN** la respuesta SHALL ser `415` con código `unsupported_file_type`

#### Scenario: Un ZIP que no es un DOCX

- **WHEN** Ana sube un `.zip` renombrado a `.docx`
- **THEN** la respuesta SHALL ser `201`
- **AND** la extracción SHALL terminar en `failed` con motivo `unreadable_file`

### Requirement: Tamaño máximo del archivo

Un archivo de más de 5 MiB SHALL recibir `413` con código `file_too_large`, el flujo SHALL cortarse en cuanto se supere
el límite y NO SHALL llamarse al almacén de objetos ni guardarse ningún CV. El tope SHALL ser una constante del contrato
compartido, no una variable de entorno, y el SPA SHALL poder anunciarlo sin preguntar a la API.

#### Scenario: Archivo de 6 MB

- **WHEN** Ana sube un PDF de 6 MiB
- **THEN** la respuesta SHALL ser `413` con código `file_too_large`
- **AND** NO SHALL llamarse al almacén de objetos

#### Scenario: Archivo justo en el límite

- **WHEN** Ana sube un PDF de exactamente 5 MiB
- **THEN** la respuesta SHALL ser `201`

#### Scenario: Archivo enorme

- **GIVEN** un archivo de 500 MB
- **WHEN** Ana lo sube
- **THEN** la respuesta SHALL ser `413` con código `file_too_large`
- **AND** el flujo SHALL cortarse al superar el límite, sin leer el archivo entero y sin llamar al almacén
- **AND** SHALL consumirse un rechazo

### Requirement: Cada subida es una versión nueva

Cada subida SHALL crear un CV nuevo con un `version` entero, correlativo **por persona** y creciente, calculado dentro
de la transacción del alta y protegido por un índice único `(userId, version)`. Un CV ya guardado NO SHALL modificarse
nunca: ni sus bytes, ni su nombre, ni su versión. Los números NO SHALL reutilizarse al borrar.

Una persona SHALL poder guardar como mucho 5 CV a la vez. La subida que superaría ese máximo SHALL recibir `409` con
código `too_many_cvs`, NO SHALL borrar ninguno de los guardados y SHALL devolver el intento al contador.

#### Scenario: Segunda subida

- **GIVEN** Ana con un CV en la versión 1
- **WHEN** sube otro archivo
- **THEN** la respuesta SHALL ser `201` con `version` 2
- **AND** el CV de la versión 1 SHALL seguir existiendo tal cual

#### Scenario: Los números no se reutilizan

- **GIVEN** Ana con las versiones 1, 2 y 3, y la 3 borrada
- **WHEN** sube otro archivo
- **THEN** la nueva SHALL ser la versión 4

#### Scenario: Sexto CV

- **GIVEN** Ana con 5 CV guardados
- **WHEN** sube otro
- **THEN** la respuesta SHALL ser `409` con código `too_many_cvs`
- **AND** los 5 CV guardados SHALL seguir intactos

#### Scenario: Dos subidas a la vez

- **GIVEN** Ana con un CV en la versión 1
- **WHEN** dos subidas llegan a la vez
- **THEN** SHALL quedar una versión 2 y una versión 3, sin repetir número y sin error

### Requirement: Un solo CV por defecto

Mientras una persona tenga al menos un CV, SHALL haber exactamente uno con `isDefault` `true`, garantizado por un índice
único parcial y no por una consulta previa.

- La subida más reciente SHALL pasar a ser la de por defecto, apagando la anterior **en la misma transacción**.
- `PUT /api/cv/:id/default` SHALL marcar ese CV como el de por defecto y apagar el anterior en una sola transacción, y
  SHALL responder `200` con la lista actualizada, también si ese CV ya lo era.
- Borrar el CV marcado SHALL promover, en la misma transacción, al **más reciente de los que quedan**; si no queda
  ninguno, no SHALL quedar ninguno marcado.
- Dos subidas simultáneas de la misma persona SHALL resolverse reintentando la transacción, NO SHALL dejar dos marcados
  y NO SHALL responder `500`.
- El estado de la extracción NO SHALL decidir la marca: un CV `pending` o `failed` puede ser el de por defecto.

#### Scenario: La subida nueva manda

- **GIVEN** Ana con la versión 1 marcada por defecto
- **WHEN** sube la versión 2
- **THEN** la versión 2 SHALL ser la de por defecto y la 1 SHALL dejar de serlo

#### Scenario: Volver a la anterior

- **GIVEN** Ana con la versión 2 por defecto
- **WHEN** llama a `PUT /api/cv/<id de la versión 1>/default`
- **THEN** la respuesta SHALL ser `200` y la versión 1 SHALL ser la de por defecto

#### Scenario: Marcar el que ya lo es

- **WHEN** Ana marca por defecto el CV que ya lo era
- **THEN** la respuesta SHALL ser `200` con la misma lista y sin cambios en la base

#### Scenario: Borrar el marcado

- **GIVEN** Ana con las versiones 1, 2 y 3, y la 3 marcada por defecto
- **WHEN** borra la versión 3
- **THEN** la versión 2 SHALL pasar a ser la de por defecto

#### Scenario: Borrar el último

- **GIVEN** Ana con un solo CV, marcado por defecto
- **WHEN** lo borra
- **THEN** NO SHALL quedar ningún CV ni ninguna marca, y la lista SHALL quedar vacía

#### Scenario: Nunca dos marcados

- **GIVEN** Ana con varios CV
- **WHEN** dos peticiones marcan por defecto dos CV distintos a la vez
- **THEN** SHALL quedar exactamente uno marcado

#### Scenario: Dos subidas a la vez se disputan la marca

- **GIVEN** Ana con un CV guardado
- **WHEN** dos subidas llegan a la vez y las dos quieren la marca
- **THEN** ninguna SHALL responder `500`
- **AND** SHALL quedar exactamente un CV marcado

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

### Requirement: Ver lo que leímos de un CV

`GET /api/cv/:id/text-preview` SHALL devolver `200` con `{ status, text, chars, complete }` a la dueña del CV, donde
`status` es el estado de la extracción de ese CV, `text` los **primeros 2.000 caracteres** del texto extraído, cortados
en el último salto de línea o espacio anterior al límite, `chars` los caracteres devueltos y `complete` si con eso ya
está todo el texto guardado.

- `complete` SHALL calcularse comparando lo devuelto con la **longitud del texto guardado**, NO SHALL deducirse del
  prefijo: un texto de exactamente 2.000 caracteres y uno de 50.000 devuelven el mismo trozo.
- Un CV que todavía no está `extracted` SHALL responder `200` con su `status`, `text` vacío, `chars` 0 y `complete`
  `false`; NO SHALL responder un código de error.
- Un CV inexistente, de otra persona o con un `:id` mal formado SHALL responder `404` con código `cv_not_found`.
- Superado el límite de vistas previas, la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`.
- La respuesta SHALL llevar `Cache-Control: private, no-store`.
- La consulta SHALL traer **solo ese prefijo** del texto, nunca el campo entero.
- Esta SHALL ser la única ruta que devuelva texto de un CV, y NO SHALL existir ninguna que devuelva sus bytes.

#### Scenario: Ver lo leído

- **GIVEN** un CV de Ana con 8.412 caracteres extraídos
- **WHEN** pide su vista previa
- **THEN** SHALL recibir `200` con 2.000 caracteres como mucho, cortados en un límite de palabra, y `complete` `false`

#### Scenario: Un CV corto se ve entero

- **GIVEN** un CV con 900 caracteres extraídos
- **WHEN** su dueña pide la vista previa
- **THEN** SHALL recibir los 900 caracteres y `complete` `true`

#### Scenario: Justo 2.000 caracteres

- **GIVEN** un CV cuyo texto guardado tiene exactamente 2.000 caracteres
- **WHEN** su dueña pide la vista previa
- **THEN** `complete` SHALL ser `true`
- **AND** con un texto de 50.000 caracteres, que devuelve el mismo tamaño de trozo, SHALL ser `false`

#### Scenario: Todavía no hay texto

- **GIVEN** un CV recién subido, en `pending`
- **WHEN** su dueña pide la vista previa
- **THEN** la respuesta SHALL ser `200` con `status` `pending`, `text` vacío y `chars` 0

#### Scenario: Un CV que no se pudo leer

- **GIVEN** un CV en `failed`
- **WHEN** su dueña pide la vista previa
- **THEN** la respuesta SHALL ser `200` con `status` `failed` y `text` vacío
- **AND** SHALL distinguirse de la respuesta de un CV en `pending`

#### Scenario: CV borrado en otra pestaña

- **GIVEN** un CV que se borró después de pintar la lista
- **WHEN** su dueña pide su vista previa
- **THEN** la respuesta SHALL ser `404` con código `cv_not_found`

#### Scenario: Demasiadas vistas previas

- **GIVEN** Ana con su ventana de vistas previas agotada
- **WHEN** pide otra
- **THEN** la respuesta SHALL ser `429` con código `too_many_attempts` y `Retry-After`

#### Scenario: La vista previa de otra persona

- **GIVEN** un CV de Ana
- **WHEN** Beto pide su vista previa
- **THEN** la respuesta SHALL ser `404` con código `cv_not_found`

#### Scenario: La consulta no se trae el CV entero

- **GIVEN** un CV con el texto recortado a 200.000 caracteres
- **WHEN** se pide su vista previa
- **THEN** la consulta a la base SHALL pedir solo el prefijo, no el campo completo

### Requirement: Eliminar un CV se lleva su archivo

`DELETE /api/cv/:id` SHALL borrar el CV de quien pide, **eliminar en la misma operación todos los análisis de encaje
hechos con él**, promover el nuevo por defecto si hacía falta y escribir el evento de borrado en `outbox_events`, todo en
la misma transacción, y SHALL responder `200` con la lista actualizada.

El borrado del objeto SHALL hacerse a partir de ese evento y NO SHALL depender de que la petición HTTP llegue viva hasta
el almacén. Borrar un CV ya borrado o de otra persona SHALL responder `404` con código `cv_not_found`.

La eliminación de los análisis SHALL llevarse también **sus fragmentos de texto del CV**, SHALL ocurrir **dentro de la
misma transacción** que borra el CV y **NO SHALL delegarse a ningún paso posterior** —ni a un evento in-process, ni a
una limpieza diferida—: es la única vía que el producto ofrece para que ese texto desaparezca, y un resto que sobreviva
no tendría quién lo recogiera. Al terminar, o han desaparecido el CV y todos sus análisis, o no ha desaparecido ninguno
de los dos; **NO SHALL existir ningún instante observable** en que el CV ya no esté y sus análisis sigan guardados.

#### Scenario: Eliminar

- **GIVEN** Ana con dos CV
- **WHEN** borra el más antiguo
- **THEN** la respuesta SHALL ser `200` con un solo elemento
- **AND** SHALL quedar un evento de borrado pendiente en `outbox_events`

#### Scenario: El almacén no responde al borrar

- **GIVEN** el almacén de objetos caído
- **WHEN** Ana borra un CV
- **THEN** la respuesta SHALL ser `200`
- **AND** el evento SHALL quedar pendiente para que el archivo se borre cuando el almacén vuelva

#### Scenario: Borrar dos veces

- **WHEN** Ana borra el mismo CV dos veces
- **THEN** la segunda respuesta SHALL ser `404` con código `cv_not_found`

#### Scenario: El borrado se lleva los análisis del CV

- **GIVEN** Ana con un CV y tres análisis de encaje hechos con él
- **WHEN** borra ese CV
- **THEN** los tres análisis SHALL haber desaparecido al responder, en la misma operación
- **AND** ningún fragmento de texto de ese CV SHALL seguir guardado

#### Scenario: El borrado falla a mitad

- **GIVEN** Ana borrando un CV con análisis hechos con él y un fallo antes de confirmar
- **WHEN** se mira lo guardado
- **THEN** SHALL seguir estando el CV con todos sus análisis
- **AND** NO SHALL verse nunca el CV eliminado con sus análisis todavía guardados

### Requirement: Cada CV es solo de su dueño

Toda ruta de `/api/cv` SHALL exigir sesión y SHALL operar únicamente sobre los CV de quien pide. Un `:id` de otra
persona, inexistente o con formato inválido SHALL recibir `404` con código `cv_not_found` y **el mismo cuerpo en los tres
casos**. Ningún CV SHALL compartirse con un grupo, con otra persona ni por ninguna ruta pública.

#### Scenario: El CV de otra persona

- **GIVEN** Ana con un CV y Beto con sesión
- **WHEN** Beto pide su vista previa, lo marca por defecto y lo borra
- **THEN** las tres respuestas SHALL ser `404` con código `cv_not_found`
- **AND** el CV de Ana SHALL seguir intacto

#### Scenario: Identificador mal formado

- **WHEN** Ana pide `GET /api/cv/no-es-un-id/text-preview`
- **THEN** la respuesta SHALL ser `404` con código `cv_not_found`, con el mismo cuerpo que un CV inexistente

#### Scenario: Sin sesión no hay nada

- **WHEN** se piden el listado y una vista previa sin `Authorization`
- **THEN** las dos respuestas SHALL ser `401` con código `unauthorized`

#### Scenario: Nada de CV en lo público

- **GIVEN** las rutas registradas por la API
- **WHEN** se listan las que no exigen access token
- **THEN** ninguna SHALL ser de `/api/cv`

### Requirement: Los bytes del CV no salen de la API

Ninguna ruta SHALL devolver el archivo original de un CV, ni entero ni por partes, ni SHALL emitirse ninguna URL firmada
que permita alcanzarlo sin sesión. El almacén de objetos NO SHALL exponerse públicamente: el único lector de los bytes
SHALL ser el proceso que extrae su texto.

Del texto extraído SHALL salir únicamente la vista previa; el contrato del CV SHALL ser un objeto estricto con
exactamente los campos del listado, y toda lectura del repositorio SHALL proyectar fuera el texto salvo la que lo
escribe y la de la vista previa.

#### Scenario: No hay ruta de descarga

- **GIVEN** las rutas registradas por la API
- **WHEN** se buscan las que devuelven el archivo de un CV
- **THEN** NO SHALL existir ninguna

#### Scenario: El texto completo no viaja

- **GIVEN** un CV con texto ya extraído
- **WHEN** se piden el listado, la subida y el marcado por defecto
- **THEN** ninguna respuesta SHALL contener texto del CV
- **AND** el contrato SHALL rechazar un objeto que incluya `extractedText`, `truncated` o `fileKey`

#### Scenario: El listado no arrastra el texto

- **WHEN** se pide el listado
- **THEN** la consulta a la base NO SHALL traer el campo del texto extraído

### Requirement: Límites de subidas, rechazos y vistas previas por persona

La API SHALL contar por persona, en una ventana fija de 15 minutos y con el contador de plataforma, **tres cosas
distintas**: las subidas aceptadas (10), las vistas previas (60) y los **archivos rechazados en la puerta** (30).
Superado cualquiera de los topes, la respuesta SHALL ser `429` con código `too_many_attempts` y cabecera `Retry-After`.

Los tres contadores SHALL **fallar abiertos**: si el contador no responde, la petición sigue.

En la subida, el intento de subida SHALL consumirse **solo cuando el archivo ya ha pasado la comprobación de tipo y
tamaño** —un `413` o un `415` NO SHALL consumirlo— y SHALL devolverse si la petición falla después de consumirlo y antes
de quedar guardada. Un archivo rechazado en la puerta SHALL consumir, en su lugar, el contador de rechazos, que NO SHALL
devolverse nunca. **Tanto el rechazo por tipo (`415`) como el rechazo por tamaño (`413`) SHALL consumirlo**: el segundo
es el único que llega a leer el archivo hasta el tope antes de rechazarlo.

#### Scenario: Once subidas

- **GIVEN** Ana subiendo y borrando alternadamente para no chocar con el máximo de 5 CV
- **WHEN** completa once subidas aceptadas en la misma ventana
- **THEN** la undécima SHALL recibir `429` con código `too_many_attempts` y `Retry-After`

#### Scenario: Ráfaga de archivos inválidos

- **WHEN** Ana envía treinta y un archivos que no son PDF ni DOCX en la misma ventana
- **THEN** los treinta primeros SHALL recibir `415` con código `unsupported_file_type`
- **AND** el siguiente SHALL recibir `429` con código `too_many_attempts` y `Retry-After`

#### Scenario: Ráfaga de archivos enormes

- **WHEN** Ana envía treinta y un archivos de 6 MiB en la misma ventana
- **THEN** los treinta primeros SHALL recibir `413` con código `file_too_large`
- **AND** el siguiente SHALL recibir `429` con código `too_many_attempts` y `Retry-After`

#### Scenario: Los rechazos no gastan subidas

- **GIVEN** Ana con treinta rechazos ya contados en la ventana
- **WHEN** sube un PDF válido
- **THEN** la respuesta SHALL ser `201`

#### Scenario: Un rechazo no se devuelve

- **GIVEN** Ana con un archivo rechazado en la ventana
- **WHEN** vuelve a intentarlo con otro archivo inválido
- **THEN** SHALL contarse un segundo rechazo

#### Scenario: Un archivo rechazado no gasta intento

- **GIVEN** Ana con nueve subidas hechas en la ventana
- **WHEN** la décima es un `.odt` que recibe `415` y la siguiente un PDF válido
- **THEN** el PDF SHALL aceptarse

#### Scenario: Un tope de versiones alcanzado no gasta intento

- **GIVEN** Ana con 5 CV guardados
- **WHEN** intenta subir otro y recibe `409 too_many_cvs`
- **THEN** el intento SHALL devolverse al contador

#### Scenario: Contador caído

- **GIVEN** el contador de intentos sin responder
- **WHEN** Ana sube su CV
- **THEN** la respuesta SHALL ser `201`

#### Scenario: Los contadores son independientes

- **GIVEN** Ana con su ventana de vistas previas agotada
- **WHEN** sube un CV
- **THEN** la subida SHALL aceptarse

#### Scenario: El contador de vistas previas caído

- **GIVEN** el contador de intentos sin responder
- **WHEN** Ana pide la vista previa de su CV
- **THEN** SHALL recibir `200` con su texto

### Requirement: Multipart solo en la subida de CV

`POST /api/cv` SHALL ser la única ruta que lea un cuerpo `multipart/form-data`. Cualquier otra ruta de la API que reciba
uno SHALL rechazarlo con su error habitual y NO SHALL guardar nada.

#### Scenario: Multipart en otra ruta

- **WHEN** se llama a `POST /api/links` con un cuerpo `multipart/form-data`
- **THEN** la respuesta SHALL ser `400` con código `validation_error`
- **AND** NO SHALL guardarse ningún link

### Requirement: Nada del CV en los registros

Ni el texto extraído, ni el nombre del archivo, ni sus bytes, ni el mensaje de error de un extractor o del almacén de
objetos SHALL escribirse en ningún registro, en ningún nivel, ni en `api` ni en `worker`. Lo que SHALL poder registrarse
es el identificador del CV, el estado, el motivo del fallo, el tamaño en bytes, el número de caracteres y la duración.

Si en el futuro alguna respuesta llevara el nombre del archivo en una cabecera, esa cabecera SHALL añadirse a la lista
de redacción declarada en el mismo cambio que la introduzca.

#### Scenario: Una subida no deja rastro del archivo

- **GIVEN** el registro capturado a nivel `debug`
- **WHEN** Ana sube un CV llamado `CV_Ana_Perez.pdf` y su texto se extrae
- **THEN** ninguna línea SHALL contener ese nombre ni ninguna palabra del texto del CV
- **AND** las líneas SHALL nombrar el CV por su identificador

#### Scenario: Un fallo del almacén no filtra la clave

- **GIVEN** el almacén de objetos devolviendo un error con la clave dentro del mensaje
- **WHEN** falla una subida
- **THEN** el registro SHALL nombrar el tipo del error y NO SHALL incluir su mensaje ni la clave
