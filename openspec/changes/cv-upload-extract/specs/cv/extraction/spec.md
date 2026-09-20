## ADDED Requirements

### Requirement: La extracción se pide dentro de la transacción del alta

El alta de un CV SHALL escribir el documento y el evento `CvUploaded.v1` en `outbox_events` dentro de la misma
transacción, y NO SHALL publicar en la cola dentro de ella. El payload del evento SHALL llevar **solo identificadores**
(el CV y su dueño): nunca el nombre del archivo, su tipo, su tamaño ni su contenido. Su `jobId` SHALL ser determinista y
derivado del identificador del CV.

Si la transacción falla, NO SHALL quedar ni el documento ni el evento, y el CV NO SHALL aparecer en el listado.

#### Scenario: Alta con petición de lectura

- **WHEN** Ana sube un CV
- **THEN** SHALL existir el documento del CV y un evento `CvUploaded.v1` pendiente en `outbox_events`
- **AND** el payload SHALL contener solo el identificador del CV y el de su dueño

#### Scenario: Cola caída al subir

- **GIVEN** Redis no disponible
- **WHEN** Ana sube un CV
- **THEN** la respuesta SHALL ser `201` y el evento SHALL quedar pendiente
- **AND** la extracción SHALL ocurrir cuando la cola vuelva, sin que Ana vuelva a subir nada

### Requirement: Consumo idempotente de la lectura del CV

El consumidor de `extract-cv` SHALL poder ejecutarse más de una vez sobre el mismo evento sin efectos adicionales, por
sí mismo y no por el `jobId` de la cola:

- un CV que ya no existe SHALL completar el job sin error y sin escribir nada;
- un CV cuyo estado ya no es `pending` SHALL completar el job sin error y sin volver a leer el archivo;
- la escritura del resultado SHALL ir condicionada a que el CV siga en `pending`, y si no modifica nada el job SHALL
  completarse sin reintento.

Un fallo de infraestructura (la base o el almacén de objetos sin responder) SHALL reintentarse según la política de la
cola: tres intentos con espera creciente. Agotados, el CV SHALL quedar en `failed` con motivo `internal_error` y un
aviso con su identificador; NO SHALL quedar en `pending` indefinidamente.

#### Scenario: El mismo evento dos veces

- **GIVEN** un CV ya leído
- **WHEN** su evento vuelve a publicarse tras la retención de la cola
- **THEN** el texto y el estado SHALL quedar como estaban y el job SHALL completarse sin error

#### Scenario: CV borrado antes de leerse

- **GIVEN** un evento pendiente cuyo CV ya se borró
- **WHEN** el worker lo consume
- **THEN** el job SHALL completarse sin error y sin escribir nada

#### Scenario: Dos ejecuciones a la vez

- **GIVEN** dos ejecuciones del mismo evento en paralelo
- **WHEN** ambas terminan de extraer
- **THEN** SHALL escribirse un solo resultado y la perdedora SHALL completarse sin error

#### Scenario: La base no responde

- **GIVEN** MongoDB caído durante los tres intentos del job
- **WHEN** se agotan
- **THEN** el CV SHALL quedar en `failed` con motivo `internal_error`
- **AND** el aviso registrado SHALL nombrar el CV por su identificador y ningún dato del archivo

### Requirement: Texto extraído, normalizado y acotado

El worker SHALL extraer el texto del PDF con `pdf-parse` y el del DOCX con `mammoth`, y SHALL guardarlo normalizado:
`\r\n` y `\r` pasan a `\n`, se quitan los caracteres de control salvo `\n` y `\t`, se colapsan las líneas en blanco
repetidas y se recortan los extremos.

El texto guardado SHALL tener como mucho 200.000 caracteres; si sobra, SHALL recortarse y marcarse `truncated` `true`.
`textChars` SHALL contar los caracteres guardados. El texto SHALL guardarse en el documento del CV y NO SHALL devolverse
por ninguna ruta.

#### Scenario: PDF con texto

- **GIVEN** un CV en PDF con una página de texto
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted` con su texto guardado y `textChars` mayor que cero

#### Scenario: DOCX con texto

- **GIVEN** un CV en DOCX
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `extracted` con su texto guardado

#### Scenario: Texto larguísimo

- **GIVEN** un archivo cuyo texto supera los 200.000 caracteres
- **WHEN** el worker lo lee
- **THEN** SHALL guardarse exactamente 200.000 caracteres y `truncated` SHALL ser `true`

#### Scenario: Saltos y caracteres de control

- **GIVEN** un archivo cuyo texto trae `\r\n`, caracteres de control y líneas en blanco repetidas
- **WHEN** el worker lo lee
- **THEN** el texto guardado SHALL tener solo `\n`, sin caracteres de control y sin líneas en blanco repetidas

### Requirement: Estados y motivos que la persona puede entender

El estado de la extracción SHALL ser `pending`, `extracted` o `failed`, y un `failed` SHALL llevar siempre un motivo:

- `unreadable_file`: el extractor no pudo abrir el archivo (corrupto, protegido con contraseña, o un contenedor que no
  es el documento que decía ser);
- `no_text`: el archivo se abrió pero el texto útil no llega a 100 caracteres, como en un PDF escaneado;
- `internal_error`: un fallo nuestro que agotó los reintentos.

Ninguno de los tres SHALL ser un error del job: `unreadable_file` y `no_text` SHALL completar el job **sin reintentos**,
porque volver a intentarlo daría lo mismo. El estado y su motivo SHALL verse en el listado de la persona.

#### Scenario: PDF protegido con contraseña

- **GIVEN** un PDF cifrado
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file`
- **AND** el job SHALL completarse sin reintentos

#### Scenario: PDF escaneado

- **GIVEN** un PDF de una sola imagen, sin capa de texto
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `failed` con motivo `no_text`

#### Scenario: Archivo corrupto

- **GIVEN** un archivo que empieza por `%PDF-` y sigue con bytes al azar
- **WHEN** el worker lo lee
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file`

#### Scenario: El fallo se ve

- **GIVEN** un CV en `failed`
- **WHEN** su dueña pide su lista
- **THEN** SHALL ver el estado y el motivo de ese CV

### Requirement: La lectura tiene plazo y no monopoliza el worker

La extracción de un CV SHALL tener un plazo configurable (`CV_EXTRACTION_TIMEOUT_MS`, por defecto 30 s); al vencer, el
CV SHALL quedar en `failed` con motivo `unreadable_file` y el job SHALL completarse sin reintentos.

`extract-cv` SHALL ser una cola propia, distinta de la del enriquecimiento de links, con su concurrencia configurable
(`CV_EXTRACT_CONCURRENCY`, por defecto 1) y un `lockDuration` mayor que el plazo, para que un CV legítimamente lento no
se dé por `stalled` ni se reentregue.

#### Scenario: Extracción que no termina

- **GIVEN** un archivo que hace que el extractor no termine
- **WHEN** vence el plazo
- **THEN** el CV SHALL quedar en `failed` con motivo `unreadable_file` y el job SHALL completarse

#### Scenario: Un CV lento no para los links

- **GIVEN** un CV en extracción y links pendientes de enriquecer
- **WHEN** ambos trabajos están en curso
- **THEN** los links SHALL seguir procesándose por su propia cola

#### Scenario: Un CV lento no se duplica

- **GIVEN** una extracción que tarda casi todo el plazo
- **WHEN** termina
- **THEN** SHALL haberse ejecutado una sola vez y el job NO SHALL haberse reentregado por `stalled`

### Requirement: Un fallo de lectura no destruye el CV

Un CV en `failed` SHALL conservar su documento y su archivo, y SHALL poder descargarse, marcarse por defecto y
eliminarse como cualquier otro. NO SHALL borrarse ni reemplazarse solo. El remedio SHALL ser volver a subir el archivo,
que crea otra versión.

#### Scenario: Después de un fallo

- **GIVEN** un CV en `failed` con motivo `no_text`
- **WHEN** su dueña lo descarga
- **THEN** SHALL recibir los mismos bytes que subió

#### Scenario: Volver a subirlo

- **GIVEN** un CV en `failed`
- **WHEN** su dueña sube otro archivo
- **THEN** SHALL crearse una versión nueva y la anterior SHALL seguir donde estaba

### Requirement: El borrado del archivo también se consume de la cola

El consumidor de `delete-cv-file` SHALL borrar del almacén de objetos el archivo del CV nombrado por el evento
`CvDeleted.v1`, componiendo su clave con la misma función que la usó al guardarlo. Borrar un objeto que ya no está SHALL
considerarse un acierto, de modo que consumir el evento dos veces SHALL ser inofensivo. Un fallo del almacén SHALL
reintentarse según la política de la cola y NO SHALL dar el borrado por hecho.

#### Scenario: El archivo desaparece

- **GIVEN** un CV borrado y su evento publicado
- **WHEN** el worker lo consume
- **THEN** el objeto NO SHALL existir en el bucket

#### Scenario: El mismo borrado dos veces

- **WHEN** el evento se consume dos veces
- **THEN** la segunda vez SHALL completarse sin error

#### Scenario: El almacén no responde

- **GIVEN** el almacén de objetos caído
- **WHEN** el worker consume el evento
- **THEN** el job SHALL fallar y reintentarse, y el objeto SHALL borrarse cuando el almacén vuelva

### Requirement: La extracción no usa inteligencia artificial

El módulo de CV del worker NO SHALL llamar a `runTask` ni importar `@linkvault/ai`, y la extracción NO SHALL enviar el
CV, ni entero ni en fragmentos, fuera de nuestra infraestructura. El texto extraído SHALL quedarse en MongoDB a la
espera del change que sí lo use, con su consentimiento y su redacción de datos personales.

#### Scenario: Sin IA en el módulo

- **GIVEN** los archivos del módulo de CV de `api` y de `worker`
- **WHEN** se revisan sus imports
- **THEN** ninguno SHALL importar `@linkvault/ai`

#### Scenario: Ningún envío externo

- **GIVEN** un CV recién subido
- **WHEN** termina su extracción
- **THEN** NO SHALL haberse hecho ninguna petición a un proveedor de IA
