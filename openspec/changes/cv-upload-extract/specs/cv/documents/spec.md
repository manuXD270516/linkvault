## ADDED Requirements

### Requirement: Subir un CV

`POST /api/cv` SHALL aceptar un cuerpo `multipart/form-data` con **una sola parte de archivo** llamada `file` y, si el
archivo es admisible, guardar sus bytes en el almacén de objetos y crear un documento de CV de quien pide. SHALL
responder `201` con `id`, `fileName`, `fileType`, `sizeBytes`, `version`, `isDefault`, `uploadedAt` y `extraction`
(`status` `pending`, `textChars` 0 y `truncated` `false`).

- La respuesta NO SHALL incluir el texto extraído, la clave del objeto ni ningún dato de otra persona.
- El nombre del archivo SHALL guardarse saneado: sin rutas, sin caracteres de control ni de cambio de dirección del
  texto, recortado a 120 code points conservando su extensión y, si queda vacío, sustituido por `cv.pdf` o `cv.docx`
  según el tipo detectado.
- Una petición sin parte `file`, con más de una parte de archivo o con un cuerpo que no es `multipart/form-data` SHALL
  recibir `400` con código `validation_error` nombrando `file`, y NO SHALL guardar nada.
- Mientras la subida no termine bien, NO SHALL quedar ningún documento de CV ni ningún objeto referenciado por uno.

#### Scenario: Primera subida

- **GIVEN** Ana con sesión y sin ningún CV
- **WHEN** sube `CV_backend.pdf` de 312 KB
- **THEN** la respuesta SHALL ser `201` con `version` 1, `isDefault` `true` y `extraction.status` `pending`
- **AND** el objeto SHALL existir en el bucket de CVs con la clave derivada de su identificador

#### Scenario: Petición sin archivo

- **WHEN** Ana llama a `POST /api/cv` con un cuerpo multipart sin parte `file`
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `file`
- **AND** NO SHALL guardarse ningún documento ni ningún objeto

#### Scenario: Dos archivos en la misma petición

- **WHEN** Ana envía dos partes de archivo en la misma petición
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `file`
- **AND** NO SHALL guardarse ningún documento ni ningún objeto

#### Scenario: Nombre de archivo con ruta y caracteres raros

- **WHEN** Ana sube un archivo llamado `../../etc/CV‮fdp.pdf`
- **THEN** el `fileName` guardado SHALL ser `CVfdp.pdf` (sin ruta y sin el carácter de cambio de dirección)
- **AND** la clave del objeto NO SHALL contener ninguna parte de ese nombre

### Requirement: El tipo del archivo se comprueba con sus bytes

La API SHALL aceptar únicamente PDF y DOCX, y SHALL decidir el tipo comprobando **tres cosas que tienen que coincidir**:
el `Content-Type` de la parte, la extensión del nombre y los **primeros bytes del contenido** (`%PDF-` para PDF,
`PK\x03\x04` para DOCX). Si alguna falta o contradice a las otras, la respuesta SHALL ser `415` con código
`unsupported_file_type` y NO SHALL guardarse ni el objeto ni el documento.

La API NO SHALL descomprimir ni interpretar el contenido más allá de esos primeros bytes; un archivo que pasa la puerta
pero que ningún extractor puede leer SHALL resolverse en la extracción, con su estado de fallo.

#### Scenario: Ejecutable renombrado

- **WHEN** Ana sube un archivo llamado `CV.pdf` con `Content-Type: application/pdf` cuyo contenido empieza por `MZ`
- **THEN** la respuesta SHALL ser `415` con código `unsupported_file_type`
- **AND** NO SHALL guardarse ningún objeto ni ningún documento

#### Scenario: Extensión que no corresponde al contenido

- **WHEN** Ana sube un PDF válido con el nombre `CV.docx` y `Content-Type` de DOCX
- **THEN** la respuesta SHALL ser `415` con código `unsupported_file_type`

#### Scenario: Tipo declarado que no admitimos

- **WHEN** Ana sube un `CV.odt` con `Content-Type: application/vnd.oasis.opendocument.text`
- **THEN** la respuesta SHALL ser `415` con código `unsupported_file_type`

#### Scenario: DOCX válido

- **WHEN** Ana sube un DOCX real, con su `Content-Type` y su extensión
- **THEN** la respuesta SHALL ser `201` con `fileType` `docx`

#### Scenario: Un ZIP que no es un DOCX

- **WHEN** Ana sube un `.zip` renombrado a `.docx` con el `Content-Type` de DOCX
- **THEN** la respuesta SHALL ser `201`
- **AND** la extracción SHALL terminar en `failed` con motivo `unreadable_file`

### Requirement: Tamaño máximo del archivo

Un archivo de más de 5 MiB SHALL recibir `413` con código `file_too_large`, y NO SHALL quedar ningún objeto, ni entero
ni a medias, ni ningún documento. El tope SHALL ser una constante del contrato compartido, no una variable de entorno, y
el SPA SHALL poder anunciarlo sin preguntar a la API.

#### Scenario: Archivo de 6 MB

- **WHEN** Ana sube un PDF de 6 MiB
- **THEN** la respuesta SHALL ser `413` con código `file_too_large`
- **AND** NO SHALL existir ningún objeto en el bucket para esa petición

#### Scenario: Archivo justo en el límite

- **WHEN** Ana sube un PDF de exactamente 5 MiB
- **THEN** la respuesta SHALL ser `201`

#### Scenario: Archivo enorme

- **GIVEN** un archivo de 500 MB
- **WHEN** Ana lo sube
- **THEN** la respuesta SHALL ser `413` con código `file_too_large`
- **AND** la API NO SHALL haber acumulado en memoria más de lo que cabe en el límite

### Requirement: Cada subida es una versión nueva

Cada subida SHALL crear un documento nuevo con un `version` entero, correlativo **por persona** y creciente, calculado
dentro de la transacción del alta y protegido por un índice único `(userId, version)`. Un CV ya guardado NO SHALL
modificarse nunca: ni sus bytes, ni su nombre, ni su versión. Los números NO SHALL reutilizarse al borrar.

Una persona SHALL poder guardar como mucho 5 CV a la vez. La subida que superaría ese máximo SHALL recibir `409` con
código `too_many_cvs` y NO SHALL borrar ninguno de los guardados.

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

### Requirement: Listado de mis CV

`GET /api/cv` SHALL devolver `200` con `items`: los CV de quien pide, del más reciente al más antiguo, cada uno con
`id`, `fileName`, `fileType`, `sizeBytes`, `version`, `isDefault`, `uploadedAt` y `extraction` (`status`,
`failureReason?`, `textChars`, `truncated`, `extractedAt?`). Sin CV, `items` SHALL ser una lista vacía.

El listado NO SHALL incluir el texto extraído, la clave del objeto ni ningún CV de otra persona, y NO SHALL exigir
paginación: el máximo es 5.

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

### Requirement: Descargar mi CV

`GET /api/cv/:id/file` SHALL devolver el archivo original a su dueño con sesión, con `Content-Type` según su tipo,
`Content-Disposition: attachment` y el nombre saneado, `Cache-Control: private, no-store`,
`X-Content-Type-Options: nosniff` y `Referrer-Policy: no-referrer`.

NO SHALL existir ninguna otra forma de llegar a los bytes: el almacén de objetos NO SHALL ser público ni SHALL emitirse
ninguna URL firmada que funcione sin sesión. La respuesta NO SHALL usar `inline`.

#### Scenario: Ana descarga su CV

- **GIVEN** Ana con un CV guardado
- **WHEN** descarga ese CV
- **THEN** la respuesta SHALL ser `200` con los mismos bytes que subió
- **AND** SHALL llevar `Content-Disposition: attachment` y `Cache-Control: private, no-store`

#### Scenario: Sin sesión no se descarga

- **WHEN** se pide ese mismo archivo sin `Authorization`
- **THEN** la respuesta SHALL ser `401` con código `unauthorized`

#### Scenario: El bucket no es público

- **GIVEN** la clave del objeto de un CV
- **WHEN** se pide directamente al almacén de objetos sin credenciales
- **THEN** SHALL denegarse el acceso

### Requirement: Eliminar un CV se lleva su archivo

`DELETE /api/cv/:id` SHALL borrar el documento de quien pide, promover el nuevo por defecto si hacía falta y escribir el
evento de borrado en `outbox_events`, todo en la misma transacción, y SHALL responder `200` con la lista actualizada.

El borrado del objeto SHALL hacerse a partir de ese evento y NO SHALL depender de que la petición HTTP llegue viva hasta
el almacén. Borrar un CV ya borrado o de otra persona SHALL responder `404` con código `cv_not_found`.

#### Scenario: Eliminar

- **GIVEN** Ana con dos CV
- **WHEN** borra el más antiguo
- **THEN** la respuesta SHALL ser `200` con un solo elemento
- **AND** SHALL quedar un evento de borrado pendiente en `outbox_events`
- **AND** el objeto SHALL desaparecer del bucket en cuanto el worker consuma el evento

#### Scenario: El almacén no responde al borrar

- **GIVEN** el almacén de objetos caído
- **WHEN** Ana borra un CV
- **THEN** la respuesta SHALL ser `200`
- **AND** el evento SHALL quedar pendiente y el objeto SHALL borrarse cuando el almacén vuelva

#### Scenario: Borrar dos veces

- **WHEN** Ana borra el mismo CV dos veces
- **THEN** la segunda respuesta SHALL ser `404` con código `cv_not_found`

### Requirement: Cada CV es solo de su dueño

Toda ruta de `/api/cv` SHALL exigir sesión y SHALL operar únicamente sobre los CV de quien pide. Un `:id` de otra
persona, inexistente o con formato inválido SHALL recibir `404` con código `cv_not_found` y **el mismo cuerpo en los tres
casos**. Ningún CV SHALL compartirse con un grupo, con otra persona ni por ninguna ruta pública.

#### Scenario: El CV de otra persona

- **GIVEN** Ana con un CV y Beto con sesión
- **WHEN** Beto pide, marca por defecto, descarga y borra el CV de Ana
- **THEN** las cuatro respuestas SHALL ser `404` con código `cv_not_found`
- **AND** el CV de Ana SHALL seguir intacto

#### Scenario: Identificador mal formado

- **WHEN** Ana pide `GET /api/cv/no-es-un-id/file`
- **THEN** la respuesta SHALL ser `404` con código `cv_not_found`, con el mismo cuerpo que un CV inexistente

#### Scenario: Nada de CV en lo público

- **GIVEN** las rutas registradas por la API
- **WHEN** se listan las que no exigen access token
- **THEN** ninguna SHALL ser de `/api/cv`

### Requirement: El texto del CV no sale por ninguna respuesta

Ninguna respuesta de la API SHALL incluir el texto extraído de un CV ni un fragmento suyo. El contrato del documento de
CV SHALL ser un objeto estricto con exactamente los campos del listado, y toda lectura del repositorio SHALL proyectar
fuera el texto salvo la única que lo escribe y, en el futuro, la que lo consuma dentro del servidor.

La persona SHALL poder saber si se leyó y cuánto: `extraction.status`, `textChars` y `truncated`.

#### Scenario: El texto no viaja

- **GIVEN** un CV con texto ya extraído
- **WHEN** se piden el listado, la subida y el marcado por defecto
- **THEN** ninguna respuesta SHALL contener texto del CV
- **AND** el contrato SHALL rechazar un objeto que incluya `extractedText` o `fileKey`

#### Scenario: Cuánto se leyó

- **GIVEN** un CV cuyo texto tiene 8.412 caracteres
- **WHEN** Ana pide su lista
- **THEN** SHALL ver `extraction.status` `extracted` y `textChars` 8412

#### Scenario: El listado no arrastra el texto

- **WHEN** se pide el listado
- **THEN** la consulta a la base NO SHALL traer el campo del texto extraído

### Requirement: Límite de subidas y descargas por persona

`POST /api/cv` y `GET /api/cv/:id/file` SHALL contar sus intentos por persona en una ventana fija de 15 minutos, con el
contador de plataforma: 10 subidas y 30 descargas. Superado el tope, la respuesta SHALL ser `429` con código
`too_many_attempts` y cabecera `Retry-After`.

Los dos contadores SHALL **fallar abiertos**: si el contador no responde, la petición sigue. El intento SHALL consumirse
antes de leer el archivo y SHALL devolverse cuando la petición termina en `413`, `415` o `409 too_many_cvs`.

#### Scenario: Once subidas

- **WHEN** Ana hace once subidas válidas en la misma ventana
- **THEN** la undécima SHALL recibir `429` con código `too_many_attempts` y `Retry-After`

#### Scenario: Un archivo rechazado no gasta intento

- **GIVEN** Ana con nueve subidas hechas en la ventana
- **WHEN** la décima es un `.odt` que recibe `415`
- **THEN** la siguiente subida válida SHALL aceptarse

#### Scenario: Contador caído

- **GIVEN** el contador de intentos sin responder
- **WHEN** Ana sube su CV
- **THEN** la respuesta SHALL ser `201`

#### Scenario: Los contadores son independientes

- **GIVEN** Ana con su ventana de descargas agotada
- **WHEN** sube un CV
- **THEN** la subida SHALL aceptarse

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

#### Scenario: Una subida no deja rastro del archivo

- **GIVEN** el registro capturado a nivel `debug`
- **WHEN** Ana sube un CV llamado `CV_Ana_Perez.pdf` y su texto se extrae
- **THEN** ninguna línea SHALL contener ese nombre ni ninguna palabra del texto del CV
- **AND** las líneas SHALL nombrar el CV por su identificador

#### Scenario: Un fallo del almacén no filtra la clave

- **GIVEN** el almacén de objetos devolviendo un error con la clave dentro del mensaje
- **WHEN** falla una descarga
- **THEN** el registro SHALL nombrar el tipo del error y NO SHALL incluir su mensaje ni la clave
