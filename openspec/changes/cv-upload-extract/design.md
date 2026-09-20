## Context

> **Ventana autónoma autorizada (2026-09-19).** El autor pidió dejar este change **solo planificado**: artefactos de
> `openspec/changes/cv-upload-extract/` y nada más. No se toca `apps/**` ni `libs/**`, no hay commits y el debate
> `critic`/`business`/`reflect` y la aprobación humana siguen pendientes. Ante una decisión menor no documentada se
> elige la opción más conservadora y se anota aquí; lo que cambia el alcance o es irreversible queda en Open Questions
> con su recomendación.

design-v0.2 §5.6 dibuja el flujo en una línea: `POST /cv (multipart) → MinIO → tx cv_documents + outbox(CvUploaded)` y
`K->>K: extract-cv (pdf-parse / mammoth) → extractedText, version`. design.md §4.8 añade el tope (PDF/DOCX ≤ 5 MB) y
§5 la forma de `cv_documents`: `userId, fileKey, mimeType, extractedText, version, isDefault, uploadedAt`. ADR-006 pone
el binario en MinIO y ADR-009 obliga a que lo que se encola salga de una transacción.

Lo que ya existe y este change aprovecha en vez de inventar:

- **Almacenamiento compatible con S3.** `apps/worker/.../storage/s3-snapshot.store.ts` ya habla con MinIO a través de
  `@aws-sdk/client-s3` con `forcePathStyle: true`, y separa el adaptador real de un `SnapshotUploader` inyectable para
  que ningún test abra MinIO. Las `S3_*` ya están en `.env.example` y en `workerConfigSchema`; `S3_BUCKET` (el de los
  CVs) está declarada y **todavía no la lee nadie**, con un comentario que dice "llegará con el módulo `cv`".
- **Outbox y relay.** `MongoOutbox.append(event, session)`, `OutboxRelay` con espera creciente y 24 h de vida, y
  `BullmqOutboxPublisher`, que hoy **solo conoce `LinkCreated.v1`** y lanza ante cualquier otro tipo.
- **Idempotencia de un consumidor.** `EnrichLinkUseCase` la resuelve por **escritura condicionada**, no por el `jobId`,
  y lo deja escrito: "el `jobId` determinista solo evita duplicados mientras la cola recuerda el trabajo".
- **Contador de ventana fija de plataforma** (`FIXED_WINDOW_COUNTER`) con `consume`, `giveBack` y la elección explícita
  de fallar abierto o cerrado por tipo de clave, más el patrón `LINK_LIMITER` de puerto propio por módulo.
- **Errores por código.** `ApiExceptionFilter` traduce errores de dominio con su `code`; `API_ERROR_STATUS` y
  `apiErrorCodeSchema` son la lista cerrada.
- **Clean architecture por módulo** con puertos por token, `duplicateKeyIs` para distinguir índices y el `lint` de capas
  de `platform/workspace`.
- **SPA**: rutas en español y perezosas, `authGuard`, `@ngrx/signals`, `ConfirmDialog`, `RequestError` e i18n ES/EN.

Motivación y alcance: proposal.md; comportamiento: las specs; decisiones no triviales: **ADR-028**.

### Decisiones humanas (2026-09-20, tras la iteración 1 del debate)

1. **La descarga del archivo original sale del change.** No hay `GET /api/cv/:id/file` ni botón "Descargar". Es la mayor
   superficie de salida de datos de todo lo que se entrega aquí, y lo que se protege es un archivo que la persona
   **acaba de subir desde su dispositivo**: quien lo quiera, lo tiene. Queda como candidato para cuando alguien lo pida
   (D6). Con esto decae el P0 de `critic` —el nombre del archivo viajando en `Content-Disposition` y de ahí a los
   registros de acceso—, pero **el saneado del nombre conserva** lo que ese hallazgo enseñó (D1) y D10 deja escrito qué
   habría que hacer el día que la descarga vuelva.
2. **Entra una vista previa del texto**: `GET /api/cv/:id/text-preview` devuelve los primeros ~2.000 caracteres de lo
   que se extrajo, solo a su dueña. Sin ella, un PDF a dos columnas leído entrelazado —que es basura para cualquier
   análisis— se anuncia como un éxito, porque `textChars` sale alto. Es la única señal honesta de que lo guardado sirve
   (D6).

## Goals / Non-Goals

**Goals:**

- Que subir el CV sea un gesto de diez segundos y que la persona **vea** si se pudo leer o no, sin adivinarlo.
- Que el archivo más personal del producto no se pueda alcanzar sin sesión, ni por una URL de MinIO, ni por un listado,
  ni por un log.
- Que "eliminar" signifique que el binario deja de existir, no que desaparezca de una lista.
- Que el texto extraído quede listo para `cv-match-suggestions` sin que este change decida nada de IA.
- Que un PDF roto, cifrado o escaneado termine en un mensaje honesto y no en un reintento infinito ni en un `500`.

**Non-Goals:**

- **Cualquier uso de IA sobre el CV.** Ni `match-cv`, ni clasificación de habilidades, ni resumen. `libs/ai` no entra en
  el módulo `cv` de ninguna de las dos apps, y un test de imports lo comprueba. La redacción de PII de dirección y
  documento de identidad sigue diferida a `cv-match-suggestions` (ADR-018 §13), que es el primer change en que un CV
  sale de nuestra infraestructura.
- **Descargar el archivo original.** Decisión humana 1: no hay ruta que devuelva los bytes, ni prefirmada ni servida por
  la API, y el SPA no ofrece "Descargar". Vuelve el día que alguien lo pida, y entonces con lo que D10 deja escrito.
- **Ver el texto extraído entero, editarlo o copiarlo.** Lo que sale son los primeros ~2.000 caracteres, para comprobar
  que la lectura sirve (D6); ni el texto completo, ni una descarga, ni un botón de copiar.
- **OCR.** Un PDF escaneado no tiene capa de texto; se dice y ya (D8).
- **Compartir un CV.** No hay ninguna ruta pública, ni por grupo, ni por enlace. El CV es de una persona y de nadie más.
- **Caducidad automática y borrado de cuenta.** El bucket de CV (`cvs`) **no** lleva regla de expiración: borrar el CV de alguien
  porque lleve un año sin entrar sería destruir datos por un temporizador. El borrado de cuenta no existe todavía y lo
  hereda `deploy-prod` (Open Questions).
- **Aviso en vivo del final de la extracción.** El canal SSE existe y sería barato, pero la extracción tarda segundos y
  el sondeo cuesta una consulta indexada; SSE entra cuando `cv-match-suggestions` tenga algo largo que anunciar (D8).
- **Antivirus sobre lo subido.** El archivo no lo descarga nadie —no hay ruta que lo devuelva— y el único que lo abre
  es nuestro parser, con plazo y concurrencia acotados. Si algún día un CV sale de aquí, ClamAV entra con ese change
  (Open Questions).
- **`worker_threads` para el parseo.** Se acota con concurrencia 1 y un plazo; medir antes de complicar (D9, Risks).
- **Editar los metadatos** (renombrar el archivo, poner una etiqueta "CV para backend"). Es útil y no cuesta casi nada,
  pero no está en el alcance del manifiesto y añade un campo editable más que validar.
- **`CvFacade`.** Todavía no hay ningún módulo que lea CVs. La crea quien la necesite, que será `cv-match-suggestions`.

## Decisions

### D1 — Qué se guarda, dónde, y qué ve cada endpoint

El reparto es el de design.md §5, con una condición añadida: **el texto extraído no sale por ninguna puerta HTTP**.

| Dato | Dónde | Quién lo ve |
|------|-------|-------------|
| Bytes del archivo | MinIO, bucket de CV (`S3_BUCKET`, por defecto `cvs`), clave `<userId>/<cvId>` | **nadie por HTTP** (decisión humana 1); los lee el worker para extraer el texto |
| `fileName`, `fileType`, `sizeBytes`, `version`, `isDefault`, `uploadedAt` | `cv_documents` | su dueño, en el listado |
| `extraction` (`status`, `failureReason?`, `textChars`, `extractedAt?`) | `cv_documents` | su dueño, en el listado |
| `truncated` | `cv_documents` | **nadie**: es un detalle de cómo guardamos, no una noticia para quien subió el CV; vive en Mongo para quien consuma el texto |
| `extractedText` | `cv_documents` | su dueño, **solo los primeros ~2.000 caracteres** y solo por `GET /api/cv/:id/text-preview` (D6); entero, lo leerá `cv-match-suggestions` dentro del servidor |
| `fileKey` | `cv_documents` | nadie: es un detalle del adaptador, no viaja en ninguna respuesta |

**El contrato lo garantiza, no la buena voluntad.** `cvDocumentSchema` es un `strictObject` con exactamente los campos
de la tabla —sin `extractedText`, sin `truncated` y sin `fileKey`—; el mapeo parte de una lista explícita de campos y
nunca de un `...document`; y el repositorio **proyecta fuera `extractedText` en todas sus lecturas salvo la que lo
escribe y la de la vista previa**, con un test que lo comprueba contando lo que vuelve del driver. Son las tres barreras que ya usó `public-preview-share` para `summary`, y por la misma razón: el
campo largo y libre es el que filtra.

**La clave del objeto no dice nada.** `<userId>/<cvId>`, sin el nombre del archivo y **sin extensión**: una clave como
`ana/CV Ana Pérez - Backend.pdf` publicaría el nombre de una persona en el listado de un bucket, en un mensaje de error
del SDK y en cualquier traza. El tipo se guarda en Mongo (`fileType`), que es donde se consulta. El prefijo por usuario
existe para que un operador pueda encontrar y borrar todo lo de una persona con un `mc rm --recursive` (RUNBOOK), que es
justo lo que `deploy-prod` necesitará para el borrado de cuenta.

**¿Se guarda el nombre original del archivo?** Sí, saneado, y se muestra.

| Opción | A favor | En contra |
|--------|---------|-----------|
| a) No guardarlo; mostrar "CV v3 · 12 sep 2026" | Un dato personal menos. | Con tres versiones del mismo día, la persona no sabe cuál es cuál; el nombre es la única pista que ella misma escribió. |
| **b) Guardarlo saneado y mostrarlo** | Es su archivo y su forma de reconocerlo; el listado solo lo ve su dueño. | `CV_Ana_Perez.pdf` es un nombre propio guardado en Mongo. Se compensa: **nunca** se registra en un log (D10) y no aparece en ninguna respuesta que no sea la suya. |
| c) Guardarlo y dejar que se edite | Lo mejor de los dos. | Un campo editable más, con su validación y su endpoint, fuera del alcance. |

Votación: privacidad → a; utilidad → b; alcance → b. **Gana b**, 2 a 1. El desempate de arquitectura confirma b: el
riesgo real de un nombre no es guardarlo junto al archivo que describe, sino **repetirlo donde no se espera** (logs,
claves de objeto, URLs), y las tres puertas quedan cerradas por decisión explícita.

Saneado de `fileName`: se queda con el último segmento tras `/` y `\`, se quitan caracteres de control, los de cambio
de dirección del texto (U+202A–U+202E, U+2066–U+2069) y **las comillas dobles, las barras invertidas y los `;`**, se
recorta a 120 code points conservando la extensión, y si tras todo eso queda vacío se usa `cv.pdf` o `cv.docx` según el
tipo detectado. Esos tres caracteres no estorban a nadie y son justo los que permiten partir una cabecera con el nombre
dentro: el saneado se queda aunque la descarga salga del change (decisión humana 1), porque lo que protege no es una
cabecera concreta sino cualquier sitio donde ese nombre se pegue después. El nombre **no** se usa para nada más: ni para
la clave del objeto, ni para decidir el tipo (D2).

### D2 — La subida: qué se acepta y cómo se comprueba de verdad

**El transporte.** `@fastify/multipart` registrado en `configureApp` con `limits: { fileSize: CV_MAX_FILE_BYTES, files: 1, fields: 0, parts: 2 }`, y el controlador consumiendo `request.file()`. Alternativas descartadas: un
`addContentTypeParser` propio que acumule el cuerpo (reescribir un parser de multipart es la peor idea de este change);
subir desde el navegador a MinIO con una URL prefirmada (D6 explica por qué no).

Registrar el plugin es **global**, así que hay que decir qué pasa con el resto de rutas: el plugin solo actúa cuando el
`Content-Type` es `multipart/form-data`, y cualquier otra ruta que reciba uno sigue fallando en su pipe de zod con
`400 validation_error`, porque su cuerpo no será el objeto que espera. **Solo `POST /api/cv` lee partes**; un escenario
de la spec lo fija mandando un multipart a `POST /api/links` y exigiendo que no se guarde nada.

**La comprobación del tipo, con una autoridad clara y un tercero que solo puede vetar:**

| Capa | Qué se mira | Papel |
|------|-------------|-------|
| **Primeros bytes** | `%PDF-` **dentro del primer kilobyte** (hay PDFs con basura o un BOM por delante) o `PK\x03\x04` al principio | **Autoridad.** Es lo único que el archivo no puede mentir sin dejar de ser ese formato. |
| **Extensión del `filename`** | `.pdf` o `.docx` | **Autoridad.** Tiene que coincidir con los bytes. |
| `Content-Type` de la parte | `application/pdf`, el mime de DOCX, `application/octet-stream`, vacío o ausente | **Solo veta.** Si nombra un tipo conocido que **contradice** a los dos anteriores, se rechaza; si no dice nada útil, no estorba. |

Las dos autoridades tienen que apuntar al **mismo** tipo; si no, o si el `Content-Type` las contradice,
`415 unsupported_file_type` y **nada se sube ni se escribe**. El `Content-Type` no puede ser una tercera condición dura
porque lo pone el cliente: navegadores antiguos, aplicaciones móviles y cualquier `curl` mandan `application/octet-stream`
para un PDF perfectamente válido, y rechazarlo sería rechazar el CV de alguien por culpa de su navegador. La función que
huele los bytes (`sniffCvFileType`) vive en `libs/shared`, es pura y la comparten la API y sus tests.

**Se decide con el primer trozo, no con el archivo entero.** El tope de bytes que hay que mirar ya está escrito en la
propia regla: `%PDF-` tiene que aparecer **en el primer kilobyte**. Así que el controlador husmea **el primer chunk del
stream** y, si el tipo no cuadra, deja de acumular: lo que llegue después se **descarta sobre la marcha**. Solo cuando
el primer chunk dice "esto es un PDF" o "esto es un DOCX" se acumula el resto hasta el tope (D2, opción A).

**Drenar y descartar, no destruir**, y es una elección:

| Qué hacer con el resto del cuerpo | A favor | En contra |
|-----------------------------------|---------|-----------|
| **Drenar y tirar cada chunk** | La memoria queda **plana** —un chunk cada vez, no 5 MiB—, que es el objetivo de todo esto; y el cliente termina de subir, así que **recibe el `415`** y puede explicárselo a la persona. | Se sigue gastando ancho de banda de entrada hasta que el cliente acaba. |
| Destruir el stream | Ahorra ese ancho de banda. | Cortar la conexión mientras el cliente escribe puede hacer que **la respuesta no le llegue**: el navegador ve un error de red y la persona, "algo falló", en vez de "solo aceptamos PDF o DOCX". |

**Gana drenar.** Lo que este cambio persigue es no tener megabytes en memoria, no ahorrar tráfico; y un `415` que no
llega no sirve de nada. El ancho de banda lo acota, por arriba, el `fileSize` del plugin.

**Los errores del parser también son nuestros.** `@fastify/multipart` lanza errores con `code` propio, y si llegan al
filtro global salen como `500 internal_error`: un archivo demasiado grande le diría a la persona que la avería es
nuestra. Se traducen **antes**, en el controlador, y la traducción es **por defecto**: cualquier `code` que empiece por
`FST_` acaba en `400 validation_error` nombrando `file`. Encima de esa red van las filas conocidas:

| Error del plugin | Error de dominio | Respuesta |
|------------------|------------------|-----------|
| `FST_REQ_FILE_TOO_LARGE` | `CvFileTooLarge` | `413 file_too_large` |
| `FST_FILES_LIMIT` | `InvalidCvUpload('file')` | `400 validation_error` nombrando `file` |
| `FST_PARTS_LIMIT` | `InvalidCvUpload('file')` | `400 validation_error` nombrando `file` |
| `FST_FIELDS_LIMIT` | `InvalidCvUpload('file')` | `400 validation_error` nombrando `file` |
| `FST_PROTO_VIOLATION` | `InvalidCvUpload('file')` | `400 validation_error` nombrando `file` |
| cualquier otro `FST_*` | `InvalidCvUpload('file')` | `400 validation_error` nombrando `file` |
| `FST_INVALID_MULTIPART_CONTENT_TYPE` | — | `415 unsupported_media_type`, el código que ya existe para "el cuerpo no es lo que esta ruta acepta" |
| **no hay parte `file`** (no lanza nada: `request.file()` devuelve `undefined`) | `InvalidCvUpload('file')` | `400 validation_error` nombrando `file` |

El defecto existe porque la lista de códigos del plugin es suya y puede crecer con una versión menor: una rama nueva no
puede convertirse en un `500` por no haberla previsto. La última fila no la cubre ninguna traducción porque **no hay
error**, y es justo el caso que más se da con un formulario mal montado.

**Dónde se envuelve la traducción importa.** Como el cuerpo se lee a mano, chunk a chunk (arriba), el error de tamaño
—`FST_REQ_FILE_TOO_LARGE`— **no sale de `request.file()`**: lo lanza el bucle que consume el stream, cuando el plugin
corta al superar `fileSize`. Envolver solo la llamada que obtiene la parte dejaría esa rama fuera y la convertiría en un
`500`, que es exactamente lo que esta decisión existe para evitar. Se envuelven **la obtención de la parte y el bucle de
lectura**, con la misma traducción.

El `415` de `FST_INVALID_MULTIPART_CONTENT_TYPE` **no** es `unsupported_file_type`: una cosa es "el cuerpo de la
petición no es multipart" y otra "el archivo no es PDF ni DOCX", y el SPA las explica distinto. Eso sí, el mensaje fijo
de `unsupported_media_type` (`"Request body must be application/json"`) **deja de ser verdad** en cuanto existe una ruta
que acepta multipart: pasa a ser genérico —"el cuerpo no tiene el formato que esta ruta acepta"— porque el código lo
comparten ya dos rutas con formatos distintos y el SPA traduce el código, no el mensaje.

**La holgura de `parts`.** `files: 1`, `fields: 0` y `parts: 2`. Con `fields: 0`, cualquier campo de texto dispara
`FST_FIELDS_LIMIT`, que es el error más fácil de provocar desde un formulario que añade un campo oculto; por eso está
en la tabla y por eso el SPA envía **solo** la parte del archivo. `parts: 2` deja una parte de margen sobre la única
esperada: no sirve para colar nada (los otros dos límites cortan antes y con mejor mensaje) y evita que un cliente que
manda un epílogo raro acabe en un error que no dice nada.

**El residuo aceptado, dicho en voz alta:** `PK\x03\x04` identifica un ZIP, no un DOCX. Un `.xlsx` renombrado pasa la
puerta. Mirar dentro del ZIP para exigir `word/document.xml` obligaría a descomprimir en la API —es decir, a abrir un
archivo hostil en el proceso que atiende el tráfico—, y eso es exactamente lo que no queremos hacer ahí. La segunda
puerta es el worker: `mammoth` falla con cualquier cosa que no sea un documento de Word y el CV termina en `failed` con
`unreadable_file`, que es el mismo desenlace que un DOCX corrupto. Se elige **no descomprimir en la API**.

**El tamaño.** 5 MiB (`5 * 1024 * 1024`), constante de `libs/shared`, no configuración: un tope que cada entorno puede
mover es un tope que el SPA no puede anunciar y que los tests no pueden fijar. Superarlo da `413 file_too_large`.

**Se acumula en memoria, no se transmite mientras llega.**

| Opción | A favor | En contra |
|--------|---------|-----------|
| **A. Acumular hasta 5 MiB + 1 byte y subir de una vez** | Se sabe que el archivo está **entero** antes de escribir nada; un archivo truncado nunca llega a MinIO; un solo `PutObject`. | Hasta 5 MiB por subida en curso en memoria. |
| B. Transmitir a MinIO mientras llega | Memoria constante. | Pasado el tope hay que **abortar una subida ya empezada** y limpiar el objeto parcial; si la limpieza falla, queda un CV a medias que parece entero. |

**Gana A** por unanimidad. El coste está acotado: una parte por petición, y las subidas por persona las acota el
contador de D5. El límite del plugin corta el flujo en cuanto se pasa, así que ni siquiera se llega a acumular 5 MiB de
un archivo de 500 MB.

**Un archivo corrupto o cifrado** no se distingue en la puerta: un PDF cifrado empieza igual por `%PDF-`. Se acepta, se
guarda y **lo resuelve la extracción** (D8), que es quien tiene el parser. Lo contrario —intentar abrirlo en la API para
decidir si se guarda— metería `pdf-parse` en el proceso que atiende el tráfico y convertiría una subida en una operación
de CPU indeterminada.

### D3 — Versiones: qué es una, cuántas se guardan y qué pasa con la sexta

**Una versión es una subida.** El binario es inmutable: nada edita un CV ya subido. `version` es un entero correlativo
**por persona** (1, 2, 3…), pedido dentro de la transacción al contador de esa persona (`cv_version_counters`, un
documento con un solo entero que se sube con `$inc`; ver Decisiones de implementación 3, que corrige el `max(version) + 1`
de este párrafo porque reutilizaba el número de un CV borrado) y protegido por el índice único
`(userId, version)`; si dos subidas simultáneas piden el mismo número, una choca, y **la transacción entera se reintenta**
hasta 3 veces, exactamente como `withResolvedLink` en `links`. El número no se reutiliza al borrar: borrar la v3 deja
1, 2, 4, y así "la v4" siempre quiere decir lo mismo para siempre.

**Cuántas se guardan: 5, y la sexta se rechaza.**

| Opción | A favor | En contra |
|--------|---------|-----------|
| a) Todas | Nadie pierde nada. | Almacenamiento sin tope por persona, y una lista que nadie lee entera. |
| b) Las 5 últimas, borrando la más antigua sola | Nunca estorba. | **Borra datos de una persona sin pedírselo**, y lo hace justo cuando está ocupada subiendo otra cosa. Irreversible. |
| **c) Hasta 5; la sexta recibe `409 too_many_cvs`** | No destruye nada; el tope es explícito y lo decide la persona; es el idioma que el producto ya habla (`too_many_groups`, `group_full`). | Un paso más para quien llegue al tope: borrar una antes de subir. |

Votación: no destruir → c; comodidad → b; coherencia con el producto → c. **Gana c**, 2 a 1. Desempate: el criterio de
este change es que ningún dato del CV desaparece sin que la persona lo pida, y b lo rompe en el primer caso de uso.

**Los topes se declaran una sola vez.** `MAX_CV_DOCUMENTS`, `CV_MAX_FILE_BYTES`, `CV_TEXT_MAX_CHARS`,
`CV_MIN_TEXT_CHARS` y `CV_TEXT_PREVIEW_CHARS` viven en `libs/shared` y **el dominio los importa de ahí**, como
`links/domain/public-slug.ts` hace con el alfabeto del slug. Un número repetido en dos capas es un número que acaba
diciendo dos cosas: el SPA anunciaría 5 CV mientras la API acepta 6.

El conteo se comprueba **dos veces**: antes de subir el objeto (camino rápido, evita gastar MinIO para nada) y **dentro
de la transacción** (la verdad). Si la carrera hace que la segunda falle, el objeto ya subido queda huérfano; es
invisible, no lo referencia ningún documento y lo recoge el barrido del RUNBOOK (D12).

### D4 — `isDefault`: uno y solo uno, y qué pasa al borrarlo

**Invariante: como mucho un `isDefault: true` por persona, garantizado por un índice único parcial**
(`{ userId: 1, isDefault: 1 }` con `partialFilterExpression: { isDefault: true }`), no por una consulta previa. Es el
mismo razonamiento que el código de invitación de `groups` y el slug público de `links`: lo único que cierra una carrera
es el índice.

**Quién pasa a ser el de por defecto:**

| Momento | Qué ocurre | Por qué |
|---------|-----------|---------|
| Primera subida | Nace `isDefault: true` | No hay nada que elegir. |
| Subida siguiente | **La nueva pasa a ser la de por defecto**, y la anterior deja de serlo, en la misma transacción | Quien sube un CV nuevo lo sube porque es el bueno. Lo contrario —que la nueva nazca apagada— haría que "subir el CV actualizado" no cambiara nada en el análisis, que es el fallo silencioso más caro de esta pantalla. |
| `PUT /api/cv/:id/default` | Ese pasa a serlo; idempotente (`200` aunque ya lo fuera) | Es la vuelta atrás explícita de la fila anterior, a un clic. |
| Borrado del marcado | **El más reciente de los que quedan** pasa a serlo, en la misma transacción | Dejar a la persona sin CV por defecto teniendo tres es un estado que solo sirve para que el análisis falle más tarde y en otro sitio. |
| Borrado del último | No queda ninguno, y no pasa nada | No hay nada que promover. |

**Alternativa descartada:** que el de por defecto solo cambie cuando la extracción termine bien. Suena prudente y es
peor: el estado del CV pasaría a decidirlo un proceso asíncrono, así que la persona vería la marca moverse sola
segundos después de soltar el archivo, o no moverse nunca sin saber por qué. El estado se ve en la lista; la elección la
hace ella.

**Riesgo aceptado:** el CV por defecto puede estar `failed`. La marca dice "este es el que quiero usar", no "este se
pudo leer". Quien lo consuma —`cv-match-suggestions`— exigirá `extracted` y lo dirá; la lista ya lo dice antes.

### D5 — Límites por persona y política de fallo

Puerto propio del módulo, `CV_LIMITER`, sobre el `FIXED_WINDOW_COUNTER` de plataforma (mismo patrón que `LINK_LIMITER`;
el dominio de `cv` no importa el de `links` ni el de `auth`).

| Clave | Ruta | Umbral | Fallo |
|-------|------|--------|-------|
| `cv:upload:<userId>` | `POST /api/cv` | `CV_UPLOADS_PER_USER = 10` por 15 min | **abierto** |
| `cv:text-preview:<userId>` | `GET /api/cv/:id/text-preview` | `CV_TEXT_PREVIEWS_PER_USER = 60` por 15 min | **abierto** |
| `cv:reject:<userId>` | `POST /api/cv`, **solo al rechazar en la puerta** | `CV_REJECTS_PER_USER = 30` por 15 min | **abierto** |

**Por qué el de la vista previa también falla abierto**, y no por inercia: esa ruta **solo lee lo suyo**, como mucho
cinco documentos de una persona y un prefijo de 2.000 caracteres, sin IA, sin red hacia fuera y sin escrituras. Lo que
se permite de más cuando Redis no responde es que alguien mire su propio CV muchas veces; negárselo sería impedirle
comprobar si su CV sirve por una avería nuestra.

Los dos **fallan abiertos**: con Redis caído, quien quiere subir su CV lo sube. Es defendible aquí y no lo sería en un
endpoint que descarga de un sitio ajeno, porque **el tope duro de almacenamiento no lo pone el contador sino el máximo
de 5 documentos de D3**: sin contador, una persona puede subir y borrar en bucle, que gasta tráfico pero no acumula
nada. La ventana es la misma de `auth` y `links` (15 min), para no inventar una tercera unidad de tiempo.

**Cuándo se consume y cuándo se devuelve.** El primer borrador consumía antes de leer la parte y devolvía el intento en
tres ramas distintas; tres caminos de `giveBack` son tres sitios donde olvidarse de uno. Queda así:

- **No se consume el de subidas hasta pasar la puerta**: un `413` o un `415` no llegan a tocar `cv:upload`, así que no
  hay nada que devolver. Lo que se gasta leyendo esos bytes lo acotan el husmeo del primer chunk (D2) y el `fileSize`
  del plugin.
- **Un rechazo sí cuenta, pero en su propio contador**: la rama de error consume `cv:reject` y **nunca devuelve nada**,
  así que no reintroduce ninguna `giveBack`. Es lo que pone techo a una ráfaga de archivos inválidos —el agujero que
  dejaba abierto "no cobrar la basura"— sin cobrarle una subida a quien se equivoca de archivo una vez: treinta
  rechazos en quince minutos no los hace nadie sin querer. Agotado, la respuesta es `429` con su espera, igual que los
  otros dos.
- **Se consume justo después**, antes de contar los CV guardados y de subir nada.
- **Se devuelve** (`giveBack`) si la petición falla **después de consumir y antes de confirmar la transacción**:
  `409 too_many_cvs`, el almacén de objetos que no responde o una transacción que no confirma. En esos casos no queda
  ni documento, ni evento, ni CV nuevo: cobrar un intento por algo que no ocurrió sería cobrar dos veces a quien vuelva
  a intentarlo.
- **Sí lo gasta** un fallo posterior a la confirmación: ahí el CV existe.

Se acepta el residuo: quien mande basura sin parar no gasta contador, solo ancho de banda acotado por el tope del
plugin. Es el mismo compromiso que `auth` ya asumió al consumir antes de verificar y fallar abierto.

### D6 — Los bytes no salen; el texto sí, y solo un trozo

**La descarga se cae del change** (decisión humana 1). Las opciones que se barajaron, por si vuelve:

| Opción | A favor | En contra |
|--------|---------|-----------|
| a) URL prefirmada de MinIO | La API no mueve bytes. | Es **una URL que funciona sin sesión**: queda en el historial, en un proxy y en cualquier chat donde se pegue. Descartada siempre, vuelva o no la descarga. |
| b) La API lee el objeto y lo devuelve | MinIO nunca se expone; misma sesión y mismo `404` que el resto. | Es la mayor superficie de salida de datos del change: una ruta que devuelve el CV entero, con su nombre en una cabecera que acaba en los registros de acceso de cualquier intermediario. |
| **c) No hay descarga** | Cero superficie. El archivo lo subió la persona desde su dispositivo hace un momento: quien lo quiere, lo tiene. | Quien borró el original se queda sin copia; y no puede comprobar "cuál de estos tres subí". |

**Gana c.** El segundo contra de c es real y lo resuelve, a un coste mucho menor, lo que sí entra: la tarjeta identifica
el CV por **su nombre y su fecha** (D13) y la vista previa enseña **qué se leyó de él**. Si algún día alguien pide la
descarga, se implementa como b y **no** como a, con lo que D10 deja escrito sobre los registros.

**La vista previa del texto** (decisión humana 2): `GET /api/cv/:id/text-preview` devuelve
`{ status, text, chars, complete }`, donde `text` son los primeros `CV_TEXT_PREVIEW_CHARS = 2000` caracteres del texto
guardado, cortados en el último salto de línea o espacio anterior al límite.

- **`status` va en el cuerpo** y repite el estado de la extracción (`pending`, `extracted`, `failed`). Sin él, un CV que
  todavía se está leyendo y uno que no se pudo leer devuelven **exactamente la misma respuesta vacía**, y quien llama no
  puede decir cuál de los dos es sin pedir además el listado. Y como el schema es **estricto**, añadirlo después sería
  romper el contrato: entra ahora o no entra.
- **`complete` no se puede calcular con el prefijo.** Un texto de exactamente 2.000 caracteres y uno de 50.000 dan el
  mismo trozo. Se resuelve **midiendo el texto en la misma consulta**: junto al prefijo (`$substrCP`) se proyecta
  `$strLenCP` del campo, y `complete` es `chars === longitud`. Cuesta lo mismo, **no trae el campo** y —lo que decide
  entre las dos opciones— **no puede desfasarse**: leer `extraction.textChars` sería fiarse de un número escrito en
  otro momento por otro proceso, y el día que alguien recorte el texto por otro camino, `complete` mentiría sin que
  nada fallara. `textChars` se sigue proyectando porque es lo que el listado enseña, y una integración de la tarea 7.8
  afirma la invariante `textChars === $strLenCP(extractedText)` tras cada extracción.
- Solo para su dueña, con **el mismo `404 cv_not_found`** que el resto: un `:id` ajeno, inexistente o mal formado
  responden lo mismo. Distinguir "no existe" de "no es tuyo" le diría a un extraño que ese identificador existe. El
  caso realista no es un ataque: es **borrarlo en otra pestaña** y pulsar "Ver lo que leímos" en esta, y por eso el SPA
  lo traduce a "Este CV ya no está" y recarga la lista (D13).
- Un CV que todavía no está `extracted` responde **`200` con `text` vacío, `chars` 0 y su `status`**, no un código de
  error: "todavía no hay texto" no es un fallo que el SPA deba traducir. La pantalla no ofrece el botón mientras no
  esté `extracted`.
- Superado el contador, `429 too_many_attempts` con `Retry-After`, que el SPA muestra con su espera (D13).
- Es la **única** ruta que lee `extractedText`, y lee **solo ese prefijo** (`$substrCP` en la proyección, no el campo
  entero): así ni siquiera se trae a memoria el CV completo para devolver dos mil caracteres.
- No se cachea (`Cache-Control: private, no-store`) y tiene su propia clave de contador (D5).

**Por qué hace falta:** un PDF a dos columnas se extrae entrelazando las dos, línea a línea. El resultado tiene miles de
caracteres —`textChars` alto, estado `extracted`, todo verde— y es ilegible para cualquier análisis. Sin esta vista, la
primera persona que lo descubriría sería la que recibiera un análisis absurdo en `cv-match-suggestions`, y ni siquiera
sabría por qué. Con ella, lo ve en dos segundos y sube otro archivo.

**El bucket de CV es privado y no lleva política ni regla de expiración.** El `docker-compose` lo crea así y el RUNBOOK
dice cómo comprobarlo (`mc anonymous get`). Con la descarga fuera, **nadie** llega a los bytes por HTTP: el único
lector es el worker.

### D7 — El alta, paso a paso, y por qué el objeto va antes que la transacción

1. leer la parte y pasar la puerta: **primer chunk**, extensión y veto del `Content-Type` (D2). Si no cuadra, se deja de
   acumular —el resto se drena y se tira—, se consume `cv:reject` y se responde `415`; si cuadra, se acumula el resto
   hasta el tope. **Un `413` también consume `cv:reject`**: es la única rama que llega a leer megabytes antes de
   rechazar, así que es la que más falta hace contar; sin eso, una ráfaga de archivos de 6 MiB no tendría techo
   ninguno;
2. contador de subidas (`consume`, D5), ya con un archivo admisible en la mano;
3. contar los CV de la persona (camino rápido de D3);
4. pedir el identificador al repositorio (`nextId()`), componer `cvFileKey(userId, cvId)` y **subir el objeto**;
5. **transacción**: recontar, calcular `version`, apagar el `isDefault` anterior, insertar el documento y `append` del
   evento `CvUploaded.v1` en `outbox_events`;
6. `201` con el documento.

Cualquier fallo entre el paso 2 y el final del 5 **devuelve el intento** al contador de subidas (D5). Si el almacén de
objetos no responde en el paso 4, la respuesta es `500` y no queda ni documento, ni evento, ni intento gastado. El
contador de rechazos del paso 1 **nunca se devuelve**: un rechazo ocurrió.

El puerto del almacén en `api` es `CV_FILE_STORE` con **un solo método, `put`**. No tiene `get`: aquí nadie lee bytes
—la descarga no existe (D6) y quien lee el archivo para extraer su texto es el worker, con su propio puerto—. Dejar un
`get` "por si acaso" sería dejar la puerta montada y esperando a que alguien la use.

**Por qué el objeto va antes:**

| Orden | Si se rompe a mitad |
|-------|---------------------|
| **Objeto → transacción** | Queda un objeto que **ningún documento nombra**: invisible para la persona y para la API, recogible por el barrido del RUNBOOK. |
| Transacción → objeto | Queda un documento que dice "tienes un CV" y cuyo archivo no existe: la extracción termina en `failed` (D8, cuarto corte) y la persona ve un CV roto que ella no puede explicar. |

Se elige el primero: **el fallo debe caer del lado invisible**, no del lado de la persona. Como el `cvId` se genera
antes (paso 4), un reintento de la transacción no obliga a volver a subir nada.

El identificador lo crea el **repositorio** (`nextId()`), no el caso de uso: quién sabe qué forma tiene un identificador
es quien lo persiste, y su doble en memoria devuelve identificadores deterministas para los tests.

### D8 — La extracción: idempotencia, resultados y fallos

**El evento.** `CvUploaded.v1` con payload `{ cvId, userId }` —solo identificadores, como `LinkCreated.v1`: ni el nombre
del archivo, ni el tipo, ni el tamaño—, cola `extract-cv`, `jobId` determinista `cv:<cvId>:extract` (Decisiones de implementación 13: BullMQ rechaza un `jobId` con `:` que no se parta en tres segmentos). La clave del objeto
la compone el worker con la misma función pura `cvFileKey` de `libs/shared`, para que no haya dos formas de nombrar el
mismo archivo.

**La idempotencia es propia, no prestada del `jobId`** (la lección escrita en `EnrichLinkUseCase`):

1. leer el documento; si no está (lo borraron entre medias), el job termina bien: `cv_not_found`;
2. si su `extraction.status` ya no es `pending`, el job termina bien: `already_extracted`;
3. pedir el objeto al almacén; si **el objeto no está** —lo borró el otro consumidor de una carrera entre subir y
   borrar, o se quedó huérfano un documento—, el job termina bien: `file_not_found`, y el CV queda en `failed` con
   `internal_error`. Reintentarlo daría lo mismo: un objeto que no existe no aparece a los cinco segundos;
4. extraer y escribir **condicionado** a `{ _id, 'extraction.status': 'pending' }`; si no modifica nada, ganó otra
   ejecución y el job termina bien: `lost_race`.

Ninguno de los cuatro es un error y ninguno se reintenta. El tercero se distingue a propósito de "el almacén no
responde", que sí es transitorio y sí se reintenta: uno es un `NoSuchKey` y el otro un fallo de red o de servicio. Un job que revienta de verdad —Mongo o MinIO caídos— sí: tres
intentos con espera exponencial desde 5 s, como `enrich-link`. Agotados, el consumidor deja el CV en `failed` con
`internal_error` y un aviso con el `cvId`, **nunca** en `pending` para siempre: un estado "leyendo" eterno es una mentira
que la persona no puede resolver.

**Los resultados posibles, todos visibles:**

| Estado | Cuándo | Qué ve la persona |
|--------|--------|-------------------|
| `pending` | desde el `201` hasta que el worker escribe | "Estamos leyendo tu CV…" |
| `extracted` | texto útil (≥ `CV_MIN_TEXT_CHARS = 100` caracteres tras normalizar) | "Listo · 8.412 caracteres leídos" |
| `failed` / `unreadable_file` | el parser no pudo abrirlo: corrupto, cifrado, o un ZIP que no es un DOCX | "No pudimos abrir este archivo. Puede estar dañado o protegido con contraseña." |
| `failed` / `no_text` | se abrió, pero no hay texto: un PDF escaneado, imágenes | "Este archivo no tiene texto: parece un escaneo o una imagen.", más el consejo según el formato (D13): con un PDF, "Sube el PDF original (no una foto ni un escaneo) o vuelve a exportarlo desde tu editor"; con un DOCX, "Vuelve a exportarlo desde tu editor y súbelo otra vez" |
| `failed` / `internal_error` | se agotaron los reintentos por un fallo nuestro | "No pudimos leerlo ahora. Vuelve a subirlo en un rato." |

Un `failed` **no borra nada**: el documento y el archivo siguen ahí, y el CV se puede marcar por defecto y eliminar
como cualquier otro (lo que no tiene es vista previa, porque no hay texto que enseñar). El remedio es
volver a subirlo, que crea otra versión; no hay botón de "reintentar la lectura" en este change (Non-Goal: exigiría su
propio límite y su propia ruta, y el remedio real casi siempre es otro archivo).

**El texto que se guarda** se normaliza antes de escribirse: `\r\n`/`\r` → `\n`, se quitan los caracteres de control
salvo `\n` y `\t`, se colapsan las líneas en blanco repetidas y se recortan los extremos. Se guarda como mucho
`CV_TEXT_MAX_CHARS = 200_000` caracteres, marcando `truncated: true` **en Mongo y solo ahí** (no sale en ninguna
respuesta: es un detalle de cómo guardamos, no una noticia para quien subió el CV): es entre diez y veinte veces cualquier CV real, y
existe para que un PDF generado con basura no meta megabytes de texto en un documento de Mongo (el límite de 16 MB es
real y se alcanza antes de lo que parece).

**El plazo.** `CV_EXTRACTION_TIMEOUT_MS` (30 s por defecto, 1 s–120 s) acota la extracción entera, porque un PDF
malformado puede tener a un parser dando vueltas. Vencido, el resultado es `failed` con `unreadable_file`: para la
persona es indistinguible de un archivo roto, y lo es.

**Mientras tanto, el SPA sondea.** `GET /api/cv` cada 2 s mientras alguna versión esté `pending`, hasta 60 s, y después
deja **"Sigue en proceso. Si sigue así en unos minutos, elimínalo y vuelve a subirlo."** con un botón "Actualizar" que
**reanuda otra ventana de 60 s**. El texto dice esa segunda frase porque el caso real en que un `pending` no se resuelve
—worker parado, relay apagado, cola atascada— **no se arregla solo**, y sin salida la persona se queda mirando un
"Sigue en proceso" eterno; borrar y volver a subir crea un evento nuevo, que es exactamente el remedio. Alternativa descartada por ahora: un evento SSE `cv.extracted` por el canal
autenticado que ya existe. Es barato y encaja, pero exige que el worker publique en Redis y la API reparta (el camino de
`RedisEnrichmentNotifier`), y lo que se gana es adelantar un par de segundos un aviso en una pantalla que la persona
está mirando. Entra cuando haya algo largo que anunciar, que es el análisis.

**El borrado del binario, por la misma cañería.** `DELETE /api/cv/:id` borra el documento, promueve el nuevo por defecto
si hacía falta y escribe `CvDeleted.v1` (`{ cvId, userId }`, cola `delete-cv-file`, `jobId` `cv:<cvId>:delete`, ver Decisiones de implementación 13), todo
en la misma transacción. El worker borra el objeto; borrar un objeto que ya no está es un acierto en S3, así que el
consumidor es idempotente por naturaleza.

| Opción | A favor | En contra |
|--------|---------|-----------|
| a) Borrar el objeto dentro de la petición HTTP | Inmediato y sin cola. | Es el **dual-write** que ADR-009 prohíbe: si MinIO no responde, o el proceso muere entre el `commit` y el `DeleteObject`, el binario del dato más personal del producto **sobrevive para siempre** sin nada que lo recuerde. |
| **b) Outbox → cola `delete-cv-file` → worker** | El borrado se garantiza igual que cualquier otro trabajo: reintentos, espera creciente y aviso si se agota. Reintentarlo es inofensivo. | Una cola y un consumidor más (pequeños). |
| c) Marcar `deletedAt` y barrer cada noche | Sin cola. | Un CV "borrado" que sigue entero durante horas, y un barrido que hay que escribir, programar y vigilar igual. |

**Gana b** por unanimidad: es literalmente el caso que ADR-009 existe para resolver, y el más caro de fallar.

### D9 — Dónde corre la extracción y cuánto puede bloquear

El parseo de un PDF es **trabajo de CPU en el hilo principal**. El propio repositorio ya tropezó con esto: el snapshot
del enriquecimiento comprime en asíncrono a propósito porque "`gzipSync` sobre 300 KB bloquea el hilo… y BullMQ da el
job por `stalled`".

Medidas de este change:

- **Cola propia** (`extract-cv`), no la de enriquecimiento: así un CV lento no ocupa un hueco de los links.
- **`CV_EXTRACT_CONCURRENCY = 1`** por defecto (1–4). Con concurrencia 1, un PDF pesado retrasa al siguiente CV, no a
  todo el worker.
- **`lockDuration = CV_EXTRACTION_TIMEOUT_MS + 15 s`**, el mismo margen que `enrich-link`, para que un job legítimamente
  lento no se dé por `stalled` y se reentregue.
- Riesgo aceptado y anotado: mientras `pdf-parse` trabaja, los latidos del worker se retrasan. Si se midiera un
  problema, la palanca siguiente es un `worker_threads` o un proceso aparte, y es lo primero que habría que medir
  (Open Questions).

La estructura del módulo en el worker es la de `enrichment`: `domain/` puro (normalización del texto, decisión del
estado), `application/` con el caso de uso y sus puertos (`CV_REPOSITORY`, `CV_FILE_READER`, `CV_TEXT_EXTRACTORS`,
`CLOCK`), e `infrastructure/` con los adaptadores. **`pdf-parse` y `mammoth` solo pueden importarse desde
`infrastructure/`**, y para que eso no dependa de la buena memoria se añaden a la lista cerrada del lint de capas
(`platform/workspace`).

**De dónde salen los fixtures**, decidido aquí para que nadie improvise con un CV real:

| Fixture | Cómo se genera | Dónde vive |
|---------|----------------|------------|
| PDF con texto, PDF sin capa de texto, PDF corrupto | Escritos **a mano** por un script del repo: un PDF mínimo es texto plano con su tabla de referencias cruzadas, y así no entra ninguna dependencia nueva | `tools/cv-fixtures/make-fixtures.ts`, que los escribe en la carpeta de fixtures del worker |
| DOCX con texto | El mismo script, componiendo un ZIP **sin comprimir** (`node:zlib` da el `crc32`) con `[Content_Types].xml`, `_rels/.rels` y `word/document.xml` | igual |
| ZIP que no es DOCX | El mismo script, con una sola entrada `hola.txt` | igual |
| **PDF cifrado** | **No se genera en el repo**: se produce una vez con `qpdf --encrypt` y se **commitea como binario**, con el comando exacto anotado en `tools/cv-fixtures/README.md` | commiteado |

El PDF cifrado es la excepción a propósito: implementar RC4/AES de PDF a mano sería escribir un cifrador para un test, y
añadir una librería de PDF solo para eso sería meter una dependencia grande en el árbol por un archivo de 2 kB. Los
cinco primeros se generan en cada ejecución, así que no hay binarios que revisar en los PR. **Ningún fixture lleva datos
personales**: el texto es una vacante y un CV inventados, con nombres que no existen.

**Trampa conocida, anotada aquí para que no cueste una tarde:** el paquete `pdf-parse` ejecuta en su `index.js` un modo
de depuración que intenta leer un PDF de ejemplo del propio paquete cuando cree que se le está llamando como programa;
en un bundle eso revienta con un `ENOENT` desconcertante. Se importa el módulo interno (`pdf-parse/lib/pdf-parse.js`) y
se envuelve en nuestro adaptador, con un test que lo abre de verdad sobre el fixture.

### D10 — Nada del CV en los logs

Regla: **ni el texto extraído, ni el nombre del archivo, ni sus bytes, ni el cuerpo de un error de un parser** entran en
un log, en ningún nivel. Lo que sí se registra: `cvId`, `userId` cuando ya lo lleva la petición, `status`,
`failureReason`, `sizeBytes`, `textChars` y la duración.

Se apoya en tres cosas que ya existen: la redacción de pino de las dos apps (`logger-redaction.spec.ts`), el hábito de
`S3SnapshotStore` de registrar solo `error.name` y nunca el cuerpo, y un test propio que sube un CV con un nombre
reconocible y un texto reconocible y comprueba que **ninguna** línea escrita durante la petición y el job los contiene.

`ApiExceptionFilter` ya registra solo el nombre y los marcos de la pila de un error inesperado, nunca su mensaje: ese
detalle, que se tomó para no filtrar la clave duplicada de Mongo, es justo lo que evita que un error del SDK de S3 con
la clave del objeto acabe en el log.

**Escrito para el día que vuelva la descarga** (decisión humana 1): `pino` redacta **por rutas declaradas**, no por
heurística, así que un campo nuevo que lleve el nombre del archivo no se tapa solo. Si algún día existe
`GET /api/cv/:id/file`, hay que añadir a la lista de redacción `res.headers["content-disposition"]` y cualquier campo
`fileName` que se registre, y ampliar el test de esta decisión con esa ruta **en el mismo commit**. Mientras tanto, el
nombre del archivo solo viaja en el cuerpo de las respuestas de `/api/cv`, que no se registran.

### D11 — El relay aprende a enrutar

Hoy `BullmqOutboxPublisher` conoce **un** tipo (`LinkCreated.v1`) y una cola. Con dos tipos más hace falta un mapa.

| Opción | A favor | En contra |
|--------|---------|-----------|
| **A. Un registro `type → { queue, jobId }` que el publicador consulta** | El relay no cambia; añadir un evento es una entrada en la tabla; la validación por schema se queda donde está. | Hay que registrar las tres colas en el módulo del relay. |
| B. Un publicador por cola y un enrutador delante | Más aislado. | Tres providers casi iguales para tres tablas de una fila. |
| C. La cola en el documento del outbox | El relay no sabe de tipos. | Cambia el contrato de `outbox_events` y obliga a migrar los documentos pendientes; el conocimiento se reparte entre quien escribe y quien publica. |

**Gana A** por unanimidad. Cada entrada de la tabla nombra su schema de validación, su cola y su función de `jobId`, las
tres del contrato de `libs/shared`. Un tipo **desconocido** conserva el comportamiento de hoy —el publicador lanza, el
evento se aplaza y a las 24 h se marca `failed` con su aviso—, que es lo correcto: un evento que no sabemos publicar no
debe desaparecer en silencio ni envenenar una cola.

`OUTBOX_RELAY_ENABLED=false` sigue significando lo que significa: no se crea ninguna `Queue` ni conexión de BullMQ, y
los tres tipos esperan en `outbox_events`.

**El puerto del outbox sube a plataforma.** Hoy `OUTBOX` y `TransactionSession` viven en
`modules/links/application/ports/`, y el adaptador de infraestructura (`MongoOutbox`) los importa **desde dentro de otro
módulo**. Con un segundo módulo que encola, la salida fácil sería declarar un `CV_OUTBOX` propio con la misma interfaz;
se descarta: dos tokens para un único adaptador significa que cualquier cambio del contrato hay que hacerlo dos veces y
que un test puede sustituir uno y no el otro. Se mueven `outbox.port.ts` y `transaction-session.ts` a
`apps/api/src/infrastructure/outbox/` y **los dos módulos usan el mismo token `OUTBOX`**, exactamente como ya se hizo
con `FIXED_WINDOW_COUNTER` cuando `links` necesitó el contador de `auth` (ADR-020 §6) y con `duplicateKeyIs` en
ADR-027 §10. Cambian de import unos **21 archivos de `links` y 3 de plataforma**, sin tocar su comportamiento; la lista
exacta no se escribe aquí porque la da el `typecheck` de `api` en cuanto se mueven los dos archivos, y una lista a mano
envejece en el primer rebase.

**La convención que esto fija**, y que se escribe en ADR-028 para no volver a discutirla en el change siguiente: los
**contratos de plataforma** —contador de ventana, outbox, sesión de transacción— viven en `apps/api/src/infrastructure/`
y los consumen `application/` e `infrastructure/` de los módulos; **nunca `domain/`**, que no conoce ni framework ni
transporte. Un módulo declara puerto propio solo cuando el contrato es **suyo** (`CV_REPOSITORY`, `CV_LIMITER` sobre el
contador genérico), no cuando es de la plataforma. Una comprobación de la tarea 3.1 verifica que ningún archivo bajo un
`domain/` importa los dos archivos movidos.

### D12 — Datos, índices y objetos huérfanos

`cv_documents`:

```
{ _id, userId, fileKey, fileName, fileType: 'pdf'|'docx', sizeBytes, version, isDefault, uploadedAt,
  extraction: { status: 'pending'|'extracted'|'failed', failureReason?, textChars, extractedAt? },
  extractedText?, truncated? }
```

`truncated` se guarda **junto a `extractedText` y fuera de `extraction`**: es un detalle de cómo guardamos ese campo, no
un estado que la persona vea, y dentro del subdocumento habría quedado en la parte del documento que sí viaja en las
respuestas. Los dos son opcionales: un CV recién subido no tiene ninguno.

Y una colección auxiliar, `cv_version_counters` (Decisiones de implementación 3): un documento por persona
(`_id` = `userId`, `next`), sin más índices que su `_id`, que se sube con `$inc` dentro de la transacción del alta y se
borra con el último CV de esa persona.

| Índice | Para qué |
|--------|----------|
| único `{ userId: 1, version: 1 }` | La correlatividad de D3 y el cierre de la carrera de dos subidas. |
| único **parcial** `{ userId: 1, isDefault: 1 }` sobre `isDefault: true` | La invariante de D4: como mucho un CV por defecto. |
| `{ userId: 1, uploadedAt: -1 }` | El listado y la promoción "el más reciente de los que quedan". |

`duplicateKeyIs` (ya compartido en `infrastructure/mongo/`) distingue `CV_VERSION_KEY` de `CV_DEFAULT_KEY`, y **los dos
se reintentan dentro del mismo bucle** de hasta 3 intentos:

| Clave que choca | Qué pasó | Qué hace el reintento |
|-----------------|----------|-----------------------|
| `CV_VERSION_KEY` | Otra subida de la misma persona se llevó ese número | Vuelve a leer el máximo y pide el siguiente. |
| `CV_DEFAULT_KEY` | Otra subida marcó su CV como el de por defecto entre nuestro apagado y nuestra inserción | Vuelve a ejecutar **el apagado y la inserción** sobre el estado actual. |

El segundo **no es un fallo de programación**, como decía el primer borrador: dos subidas simultáneas de la misma
persona son el caso normal de dos pestañas o de un doble clic, y las dos quieren la marca. Tratarlo como `500` sería
devolver una avería por una carrera que el índice acaba de resolver bien. El `500` (`internal_error`) se reserva para
cuando se agotan los tres intentos, que con dos escrituras por vuelta ya es una señal de que pasa algo más.

**Objetos huérfanos.** Pueden aparecer por una transacción abortada tras subir (D7) o por un `CvDeleted.v1` que se
agotara a las 24 h. No hay proceso automático que los recoja: un barrido que borra objetos comparándolos con la base es
justo el tipo de script que, mal escrito, borra los CVs de todo el mundo. El RUNBOOK documenta el procedimiento en dos
pasos —listar las claves del bucket, restar las que `cv_documents` referencia, **revisar la lista** y borrarla— y
`deploy-prod` hereda automatizarlo si alguna vez pesa.

### D13 — El SPA

Ruta `/mi-cv`, con `authGuard`, perezosa, en la barra de navegación junto a "Mis links" y "Postulaciones".

- **Vocabulario**: en la pantalla se dice **"CV guardado"**; "versión" se queda en el contrato y en la base. Nadie
  piensa en "la versión 3 de mi CV", piensa en "el que mandé a la empresa esa".
- **Subir**: el **botón "Subir CV" es la vía principal** —un `input[type=file]` con `accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"`—
  y la zona para soltar el archivo es la secundaria, alrededor de él: soltar un archivo es un gesto que mucha gente no
  descubre, y el `accept` con los MIME además de las extensiones es lo que hace que el selector del móvil no enseñe
  todo el disco en gris. El SPA comprueba extensión y tamaño **antes** de enviar para dar respuesta inmediata, y trata
  la API como la autoridad: un `415` o un `413` se muestran igual aunque la comprobación local haya pasado. El progreso
  sale de `HttpClient` con `reportProgress: true` y `observe: 'events'`; mientras sube, el botón queda deshabilitado
  con `aria-busy`.
- **Listar**: una tarjeta por CV guardado, de más nuevo a más viejo, identificada por **su nombre y su fecha**
  (`CV_backend.pdf · 312 KB · 12 sep 2026`) y **no por su número**, que no significa nada para quien la mira. El chip de
  estado (D8) y las acciones "Usar este" (ausente en el que ya lo es), "Ver lo que leímos" (solo con estado
  `extracted`) y "Eliminar".
- **La marca dice su consecuencia**, y lo dice **bajo el nombre del CV, como una línea de texto, no como un chip**:
  **"Este es el CV que compararemos con las vacantes"**. Un chip obliga a caber en dos palabras ("Por defecto"), que es
  justo lo que no explica nada; una línea cabe, se lee de corrido y no compite con el nombre del archivo. El botón que
  la mueve sigue siendo "Usar este".
- **Un CV marcado que no se pudo leer avisa de la consecuencia, no del diagnóstico**: el chip de estado ya dice que no
  se pudo leer, así que repetirlo en el aviso gasta la línea. Bajo el marcado en `failed` se lee **"No servirá para
  analizar vacantes"** y, si hay otro en `extracted`, la acción **"Usar el que sí se leyó"**, que lo marca de un clic.
  Sin eso, la persona se va con la sensación de que todo está bien y se entera semanas después.
- **Cada estado termina en una acción** (D8): "Listo · tu CV se leyó bien" con "Ver lo que leímos"; el protegido con
  contraseña dice **"Quítale la contraseña y vuelve a subirlo"**; el fallo nuestro, "Vuelve a subirlo en un rato". El
  del archivo sin texto **depende del formato**, porque "sube el PDF original" no le sirve a quien subió un DOCX: con
  `fileType` `pdf`, "Sube el PDF original (no una foto ni un escaneo) o vuelve a exportarlo desde tu editor"; con
  `docx`, "Vuelve a exportarlo desde tu editor y súbelo otra vez". **`textChars` no se enseña**: un número de caracteres
  no le dice nada a nadie y compite con la única señal que sí importa, que es ver el texto.
- **Marcar por defecto**: sin confirmación —no destruye nada— y con vuelta atrás si la API falla, como el interruptor de
  `defaultVisibility` (ADR-027 §7).
- **"Ver lo que leímos"**: abre un diálogo con el texto de la vista previa (D6) en un bloque desplazable, con el aviso
  **"Así leímos tu CV. Si ves el texto desordenado, vuelve a exportarlo desde tu editor y súbelo otra vez."** —que vale
  para los dos formatos, a diferencia de "sube el PDF original"—. **Sin copiar ni descargar**: ni botón de copiar, ni
  selección exportada, ni enlace. Es para mirar, no para sacar.
- **Cuando la vista previa falla**, el diálogo lo dice y no se queda en blanco: un `404` es **"Este CV ya no está"**
  —el caso normal es haberlo borrado en otra pestaña—, y entonces el diálogo se cierra y la lista se recarga; un `429`
  muestra el mensaje de límite con su espera y deja "Reintentar"; un `5xx` o un fallo de red, "No pudimos mostrarlo
  ahora" con "Reintentar".
- **Eliminar**: con confirmación que dice el nombre y avisa de que "el archivo se borra y no se puede recuperar", y que
  **además** avisa cuando es el marcado: "Pasará a usarse tu CV más reciente".
- **Estado vacío**: "Sube tu CV y LinkVault podrá comparar tus habilidades con cada vacante." Es la promesa que explica
  por qué existe esta pantalla antes de que `cv-match-suggestions` la cumpla.
- **Una línea de privacidad, siempre visible**: **"Tu CV solo lo ves tú y hoy no lo lee ninguna IA. No saldrá de
  LinkVault sin tu autorización."** Llegar a esas dos frases costó dos correcciones, y las dos enseñan lo mismo:
  - la primera versión decía "te pediremos permiso antes", y eso el producto **no lo hace**. El consentimiento es una
    bandera del perfil (`aiConsent.externalProviders`, `false` por defecto, ADR-018 §11) que la pasarela **lee sin
    preguntar nada**, y con un proveedor local no hay permiso que pedir porque el CV no sale de nuestra
    infraestructura;
  - la segunda mandaba a **"Ajustes"**, y esa pantalla **no existe**: la ruta del SPA es `/perfil`, se llama "Perfil",
    y el control de consentimiento está **deliberadamente ausente** hasta `cv-match-suggestions` —ADR-020 lo difirió
    hasta poder explicar qué se envía y qué se redacta, y hay un test que falla si aparece—. Una frase que manda a un
    sitio inexistente es peor que no decir nada: convierte una promesa en un callejón.

  Lo que queda dice **solo lo que hoy es verdad y se puede comprobar**: ninguna IA lo lee (no hay `runTask` en este
  change) y no saldrá sin autorización, sin prometer dónde ni cómo se da esa autorización. Quien pone el control en
  Perfil y completa la frase es `cv-match-suggestions`, y así queda anotado en su `scope` del manifiesto.
- **Errores**: `413` → "Ese archivo pesa más de 5 MB"; `415 unsupported_file_type` → "Solo aceptamos PDF o DOCX";
  `409 too_many_cvs` → **"Guardamos hasta 5 CV. Elimina uno para subir otro; si alguno no se pudo leer, empieza por
  ese."**; `429` → el mensaje de límite que ya existe, con su espera.

Textos en ES y EN, marcados y traducidos en `messages.en.xlf` en el mismo commit.

## Risks / Trade-offs

- **Guardamos el CV entero, el texto entero y el nombre del archivo.** Es el mayor volumen de dato personal del
  producto. Lo acotan: bucket privado, cero rutas públicas, bytes que no salen por HTTP, del texto solo un prefijo,
  borrado que se lleva el binario y logs sin nada de eso. Lo que **no** cubre este change es el **cifrado en reposo** de
  MinIO ni la **política de retención**, que `docs/design.md` §8 listaba como mitigación de "datos sensibles en CV":
  es una **desviación explícita**, se anota en ADR-028 y la hereda `deploy-prod`, que es quien decide las claves y el
  ciclo de vida del bucket. Tampoco cubre el borrado de cuenta, que no existe.
- **Esta entrega no tiene recompensa propia.** Subir un CV no mejora nada hasta `cv-match-suggestions`: la pantalla pide
  el dato más personal del producto y solo devuelve "se leyó bien". Por eso la línea de privacidad y la vista previa
  (D13, D6) son lo único que la persona se lleva hoy, y por eso **no se abren entradas desde links ni desde
  postulaciones** ("analizar esta vacante con mi CV") hasta que exista el análisis: una entrada que lleva a una pantalla
  que no cumple lo que promete gasta la confianza que este change necesita.
- **Hasta 5 MiB en memoria por subida en curso** (D2). Con el contador y un archivo por petición el riesgo es bajo; con
  muchas instancias pequeñas, es lo primero que habría que mirar si la memoria aprieta.
- **El parseo bloquea el hilo del worker** (D9), acotado con concurrencia 1 y un plazo, no eliminado.
- **`PK\x03\x04` no es DOCX** (D2): un ZIP cualquiera entra y muere en la extracción. La alternativa era descomprimir un
  archivo hostil dentro de la API.
- **Objetos huérfanos** (D12): posibles, invisibles y sin recogida automática.
- **Dos colas nuevas** que `deploy-prod` tendrá que vigilar, con su retención y su panel.
- **La subida nueva se lleva la marca de por defecto** (D4): es lo que casi todo el mundo quiere y sorprende a quien no.
  Se deshace con un clic y la lista lo enseña.
- **Sondeo en vez de SSE** (D8): hasta 30 peticiones por minuto y persona mientras se lee un CV, cada una una consulta
  indexada sobre como mucho 5 documentos.
- **Sin antivirus** (Non-Goals): un archivo malicioso guardado no lo descarga nadie —no hay descarga— y solo lo abre
  nuestro parser, dentro del plazo y con la concurrencia acotada de D9.
- **El tráfico de subida que una persona puede provocar, con los tres contadores puestos**, sale de sumar sus tres
  caminos en una ventana de 15 minutos: 10 subidas válidas de hasta 5 MiB (50 MiB) más 30 rechazos, de los cuales los
  caros son los `413`, que leen hasta el tope antes de cortar (~150 MiB); los `415` se cortan en el primer chunk y no
  llegan ni a un mega. **Lo caro no es el multicuenta** —crear cuentas cuesta su propio límite de registro y cada una
  aporta unos 19 MiB por ventana si solo manda basura barata—, sino **el camino aceptado**: las subidas válidas y los
  `413`. Es tráfico de entrada acotado y sin coste de almacenamiento, y se acepta a sabiendas.
- **El techo real por cliente sigue esperando al proxy.** Los tres contadores son **por persona autenticada**: acotan a
  quien tiene sesión, no a quien tiene mil. Poner un **límite por IP y un tope de cuerpo en el proxy** —delante, sin
  activar `trustProxy` a ciegas (ADR-020 §5, ADR-027 §6)— es de `deploy-prod`, y así queda anotado en su `scope`.
- **Sin descarga, quien pierda su archivo original no lo recupera** (D6). Lo compensa, a medias, la vista previa del
  texto; si alguien lo pide, vuelve como una ruta servida por la API y nunca como una URL prefirmada.

## Migration Plan

1. Desplegar con las `S3_*` presentes también en `api` (sin ellas el proceso **no arranca**) y con el bucket de CV
   (`S3_BUCKET`, por defecto `cvs`: S3 exige de 3 a 63 caracteres, ver Decisiones de implementación 1) creado y privado. En local lo crea el `docker-compose`; en producción lo crea `deploy-prod`.
2. `autoIndex` crea los tres índices de `cv_documents` al arrancar: la colección está vacía, así que tarda milisegundos.
3. **Sin backfill ni migración de datos**: no existe ningún CV previo.
4. Las dos colas nuevas se crean solas al publicarse el primer evento. Con el relay apagado, los eventos esperan.
5. Volver atrás: desplegar la versión anterior. Los documentos y los objetos se quedan como están; el RUNBOOK trae el
   `drop` de la colección y el `mc rm --recursive` del bucket para dejarlo limpio de verdad.

## Open Questions

- **Borrado de cuenta, cifrado en reposo y retención.** Hoy no existe el borrado de cuenta, así que el CV de alguien
  que se va no se borra; y el bucket no está cifrado por objeto ni tiene política de retención, que `docs/design.md` §8
  daba por mitigación.
  - **Recomendación:** que lo herede `deploy-prod`, en el mismo apartado donde ya hereda los comentarios y los enlaces
    públicos: borrar `cv_documents` de esa persona y sus objetos (`mc rm --recursive <bucket>/<userId>/`), cifrar el
    bucket en reposo con la gestión de claves del proveedor, decidir la retención y publicar un aviso de privacidad que
    diga qué se guarda de un CV y por cuánto tiempo. Se anota en el `scope` del manifiesto y como desviación en ADR-028.
- ~~**¿Puede la persona ver el texto extraído?**~~ **Cerrada** por la decisión humana 2 (2026-09-20): sí, los primeros
  ~2.000 caracteres, por `GET /api/cv/:id/text-preview` y sin copiar ni descargar (D6). El texto entero sigue sin salir.
- **¿Cinco CVs bloqueando o rotación automática?** D3 eligió bloquear con `409`.
  - **Recomendación:** mantenerlo y mirar el dato: si mucha gente choca con el tope, subir el número es cambiar una
    constante; borrar sin permiso no se deshace.
- **¿Aviso en vivo (SSE) del final de la extracción?** D8 eligió sondeo.
  - **Recomendación:** dejarlo para `cv-match-suggestions`, que ya necesita `analysis.step` por SSE (design-v0.2 §5.6);
    añadir entonces `cv.extracted` por el mismo canal no cambia ningún contrato REST de este change.
- **¿Antivirus sobre lo subido?** Fuera de alcance mientras nadie descargue el archivo y el único que lo abre sea
  nuestro parser.
  - **Recomendación:** volver a plantearlo el día que un CV salga de aquí —porque se comparta o porque vuelva la
    descarga—; ahí sí cambia el modelo de amenaza y ClamAV entraría con ese change.
- **¿El parseo debe salir del hilo principal del worker?** D9 lo acota con concurrencia 1 y un plazo.
  - **Recomendación:** medir primero con los fixtures de PDF grandes (p95 del parseo y latidos del worker durante él) y
    decidir con el número; si se pasa de ~500 ms, `worker_threads` o un proceso aparte, en su propio change.
- **¿Tope de 5 MiB suficiente?** Un CV con fotos y portafolio puede pasarse.
  - **Recomendación:** mantener 5 MiB (es el número de design.md §4.8) y decirlo claro en la pantalla; subirlo es una
    constante, pero cada MB extra es memoria por subida en curso (D2) y texto que parsear.

## Debate (iteración 1)

Critic: 1 P0. Business: 6 V0. Tras aplicar esta tabla no queda ningún P0/V0 abierto.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| critic 1 (P0) + business 7 (V1) | El nombre del archivo viajaba en `Content-Disposition` de la descarga y de ahí a los registros de acceso de cualquier intermediario | **Decae**: la **descarga sale del change** (decisión humana 1). Se conserva el saneado de comillas, barras invertidas y `;` en `safeCvFileName` (critic 8) y D10 deja escrito qué redactar el día que vuelva | El archivo lo acaba de subir la persona desde su dispositivo; la ruta que lo devuelve es la mayor superficie de salida de datos del change |
| business 3 (V0) + critic 12 | `textChars` alto parecía un éxito aunque el PDF a dos columnas se leyera entrelazado, y nadie podía detectarlo | **Aceptado**: `GET /api/cv/:id/text-preview` con los primeros ~2.000 caracteres, sin copiar ni descargar, con su contador y su `404` (decisión humana 2, D6) | Es la única señal honesta de que lo guardado sirve, y la alternativa era enterarse con un análisis absurdo |
| critic 2 | Los errores de `@fastify/multipart` llegaban al filtro y salían como `500` | Aceptado: se traducen a errores de dominio en el controlador, con su tabla (D2) y sus filas en el test del filtro (tarea 6.1) | Un archivo grande no puede sonar a avería nuestra |
| critic 3 | Un choque de `CV_DEFAULT_KEY` se trataba como fallo de programación (`500`) | Aceptado: se reintenta **dentro del mismo bucle**, recalculando el apagado; el `500` queda para cuando se agotan los 3 intentos (D12, tareas 4.5 y 4.6) | Dos subidas a la vez son dos pestañas o un doble clic, no un error |
| critic 4 | `pdf-parse` y `mammoth` entraban en la lista del lint de capas sin nadie que lo comprobara | Aceptado: tarea propia con sus dos filas en `workspace-rules.spec.ts` (tarea 2.6) | Una regla de lint sin test es una intención |
| critic 5 | `CV_OUTBOX` duplicaba el puerto que ya tiene `links` | Aceptado: `outbox.port.ts` y `transaction-session.ts` suben a `infrastructure/outbox/` y los dos módulos comparten el token `OUTBOX`; 17 archivos de `links` cambian de import (D11, tarea 3.1) | Un adaptador, un contrato; es lo que ya se hizo con `FIXED_WINDOW_COUNTER` y `duplicateKeyIs` |
| critic 6 | Exigir los tres coincidentes rechazaba un PDF válido enviado con `application/octet-stream` | Aceptado: autoridad = bytes + extensión; el `Content-Type` **solo veta** si contradice; `%PDF-` se busca en el primer kilobyte (D2), con escenario del DOCX sin `Content-Type` útil | Rechazar un CV por culpa del navegador de quien lo sube |
| critic 7 + business 14 | El almacén caído dejaba el intento gastado, y había tres caminos de `refund` que olvidar | Aceptado: **no se consume hasta pasar la puerta**, y se devuelve solo si falla algo entre el consumo y la confirmación; escenario del almacén caído (D5, D7) | Menos ramas y nadie paga por lo que no ocurrió |
| critic 8 | `safeCvFileName` no quitaba comillas, `\` ni `;` | Aceptado, aunque la descarga se vaya (D1) | Lo que protege no es una cabecera concreta, sino cualquier sitio donde ese nombre se pegue después |
| critic 9 | Con un volumen preexistente, el bucket de CV no llegaba a crearse: colgaba del `ilm rule ls` del de snapshots | Aceptado: conjunción independiente en el healthcheck y verificación **también sobre un volumen previo** (tarea 2.1) | Quien ya tenía el proyecto levantado no vería el bucket nuevo |
| critic 10 | Hacer obligatorias las `S3_*` en `api` rompía `apiTestConfig` y sus suites | Aceptado: la tarea 2.3 incluye actualizarlo y arreglar lo que caiga | Un contrato de configuración que deja el `test` en rojo no está terminado |
| critic 11 | Escenarios de la API que afirmaban el estado del bucket | Aceptado: se reescriben contra el doble de `CV_FILE_STORE` ("no se llama al almacén"), la prueba real contra MinIO queda como paso local del RUNBOOK, y el de memoria pasa a "el flujo se corta al superar el límite" | Un test de la API no debe necesitar MinIO ni medir la memoria del proceso |
| critic 13 | Un objeto ausente en la extracción se reintentaba tres veces para nada | Aceptado: cuarto corte de idempotencia (`file_not_found`), job completado sin reintentos, distinguido de "el almacén no responde" (D8) | Un objeto que no existe no aparece a los cinco segundos |
| critic 14 | Los topes vivían en dos capas | Aceptado: una sola definición en `libs/shared` y el dominio la importa (D3) | Un número repetido acaba diciendo dos cosas |
| critic 15 | Tareas de más de 1 h (4.5, 6.3, 7.3) y fixtures sin decidir | Aceptado: partidas (4.5/4.6, 6.5/6.6, 7.3/7.4); los fixtures se generan por script salvo el PDF cifrado, que se commitea con su comando anotado (D9); y entra el `cv-test-app` como tarea propia (6.4) | Tareas verificables en menos de una hora y ningún CV real en el repo |
| business 1 (V0) | "Por defecto" no decía para qué servía la marca | Aceptado: "Este usaremos para comparar con las vacantes" (D13) | Es lo único que conecta la pantalla con la razón de subir un CV |
| business 2 (V0) | Un CV marcado en `failed` se veía como si todo estuviera bien | Aceptado: aviso en línea y "Usar el que sí se leyó" cuando hay otro `extracted` (D13) | Enterarse semanas después, con un análisis vacío, es el peor desenlace |
| business 4 (V0) | Nadie decía qué se hace con el CV justo donde se pide | Aceptado: una línea de privacidad siempre visible (D13). **Su texto se corrigió en la iteración 2**, porque el primero prometía un permiso que el producto no pide | Es lo que hace falta leer antes de soltar tu vida laboral |
| business 5 (V0) | Los estados describían el problema y no la salida | Aceptado: cada estado termina en una acción, el protegido dice que le quiten la contraseña, y `textChars` deja de enseñarse (D13) | Un diagnóstico sin remedio deja a la persona parada |
| business 6 (V0) | El cifrado en reposo y la retención de `docs/design.md` §8 desaparecían sin decirlo | Aceptado: desviación explícita en Risks y en ADR-028, y herencia de `deploy-prod` (tareas 9.3 y 9.4) | Una mitigación que se cae en silencio es una mitigación que nadie echa de menos |
| business 8 | La tarjeta se identificaba por número de versión | Aceptado: nombre y fecha; "versión" se queda en el contrato (D13) | Nadie piensa en "la versión 3 de mi CV" |
| business 9 | Vocabulario mezclado ("versión", "documento", "CV") | Aceptado: "CV guardado" en la pantalla (D13) | Una pantalla que usa tres palabras para una cosa se lee tres veces |
| business 10 | `accept` solo con extensiones y la zona de soltar como vía principal | Aceptado: `accept` con extensiones **y** MIME, y el botón como vía principal (D13) | Soltar un archivo es un gesto que mucha gente no descubre, y el selector del móvil necesita los MIME |
| business 11 | El `409` no decía por dónde empezar a borrar | Aceptado: "…si alguno no se pudo leer, empieza por ese." (D13) | Elegir cuál borrar es justo la decisión que bloquea |
| business 12 | La entrega no tiene recompensa propia hasta el análisis | Anotado en Risks, con la consecuencia: **no** se abren entradas desde links ni postulaciones hasta que exista el análisis | Una entrada que promete lo que no hay gasta la confianza que este change necesita |
| business 13 | ¿5 MiB, PDF y DOCX? | Sin cambios | Son los números de `docs/design.md` §4.8 |
| business 14 | `truncated` expuesto y `refund` con tres ramas | Aceptado: `truncated` se queda en Mongo, el consumo se mueve detrás de la puerta (D1, D5) y el e2e del archivo rechazado desaparece: lo cubre el test de componente (tarea 8.11) | Menos superficie y menos ramas que olvidar |

## Debate (iteración 2)

Critic: 0 P0 (1 P1). Business: 1 V0. Tras aplicar esta tabla no queda ningún P0/V0 abierto.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| business 1 (V0) | La línea de privacidad prometía "te pediremos permiso antes", y el producto **no pregunta**: el consentimiento es una bandera del perfil (`aiConsent.externalProviders`, `false` por defecto) que la pasarela lee sin preguntar, y con un proveedor local no hay permiso que pedir | Aceptado: se reescribe la línea (D13) y se revisa que nadie repita la frase vieja. **Su segunda mitad se corrigió otra vez en la iteración 3**, porque mandaba a una pantalla que no existe | Una promesa que el change siguiente tendría que romper es peor que no ponerla |
| critic 1 (P1) | Se acumulaban hasta 5 MiB de un archivo que ya se sabía inválido, y un rechazo no gastaba contador, así que una ráfaga de basura no tenía techo | Aceptado, en dos partes: **husmeo del primer chunk** con destrucción del stream y `415` inmediato (D2, D7; **la iteración 3 lo corrige a drenar y descartar**, ver critic 6 de esa tabla), y contador propio de rechazos `cv:reject:<userId>` (30 por ventana, fallo abierto, `consume` en la rama de error y **sin devoluciones**) (D5). En Risks, que antes no había techo | El tope de bytes que hay que mirar ya lo fija la propia regla del `%PDF-`; y un techo que no cobra al que se equivoca una vez sí puede existir |
| critic 2 | La traducción de los errores del parser era una lista cerrada: un `code` nuevo del plugin acabaría en `500` | Aceptado: traducción **por defecto** (`FST_*` → `400 validation_error` nombrando `file`) con las filas conocidas encima, más `FST_FIELDS_LIMIT`, `FST_PROTO_VIOLATION` y el caso de "sin parte `file`", que no lanza nada; y se justifica la holgura de `parts` (D2) | La lista de códigos es del plugin y crece con una versión menor |
| critic 3 + business 9 (parte) | `complete` no se puede calcular teniendo solo el prefijo: 2.000 y 50.000 caracteres dan el mismo trozo | Aceptado: la consulta proyecta también `extraction.textChars` y `complete` es `chars === textChars` (alternativa equivalente: pedir `CV_TEXT_PREVIEW_CHARS + 1`) (D6, tarea 4.9) | Un campo que miente es peor que no tenerlo |
| business 9 + critic 10 | Un `pending` y un `failed` devolvían la **misma** respuesta vacía, y el schema es estricto, así que añadir el estado después rompería contrato | Aceptado: el cuerpo pasa a `{ status, text, chars, complete }`, y con ello `textChars` gana consumidor dentro del servidor, con su escenario (D6, specs, tareas 1.10 y 4.9) | Entra ahora o no entra |
| business 10 | Nadie decía qué pasa si la vista previa falla | Aceptado: `404` → "Este CV ya no está" (caso normal: borrado en otra pestaña), cierra el diálogo y recarga la lista; `429` con su espera y "Reintentar"; `5xx` o red, "No pudimos mostrarlo ahora" (D6, D13, specs) | Un diálogo en blanco no se puede interpretar |
| business 11 | "Este usaremos para comparar con las vacantes" iba como chip | Aceptado: línea bajo el nombre, no chip (D13) | Un chip obliga a caber en dos palabras, que es justo lo que no explica nada |
| business 12 | "Sube el PDF original" no le sirve a quien subió un DOCX, ni en el estado ni en el encabezado del diálogo | Aceptado: el texto del archivo sin texto depende de `fileType`, y el del diálogo pasa a "vuelve a exportarlo desde tu editor y súbelo otra vez", que vale para los dos (D13) | Un consejo que no aplica se lee como ruido |
| business 13 | El aviso del marcado en `failed` repetía el diagnóstico del chip | Aceptado: "No servirá para analizar vacantes" y la acción, sin repetir "no pudimos leerlo" (D13) | La línea se gasta en lo que el chip ya dijo |
| business 14 | Aviso formal de privacidad | Sin cambios: lo hereda `deploy-prod` (tareas 9.3 y 9.4) | No es de este change y ya está anotado |
| critic 4 | `CV_FILE_STORE` tenía `get` sin que nadie lo usara | Aceptado: se queda solo con `put`; leer bytes es del puerto del worker (D7, tarea 4.4) | Con la descarga fuera, un `get` es dejar la puerta montada |
| critic 5 | El escenario "Once subidas" era inejecutable: con el máximo de 5 y la devolución en `409` nunca se llega al `429` | Aceptado: el escenario intercala borrados, y el consumo del contador se prueba además en el caso de uso con el doble (specs, tarea 6.6) | Un escenario que no se puede ejecutar no prueba nada |
| critic 6 | El movimiento del puerto no dejaba escrita la convención | Aceptado: se mantiene y se escribe en ADR-028 —los contratos de plataforma viven en `infrastructure/` y los consumen `application/` e `infrastructure/`, nunca `domain/`—, con la comprobación en la tarea 3.1 (D11) | Sin regla escrita, el change siguiente vuelve a discutirlo |
| critic 7 | "17 archivos" era un número inventado y envejece | Aceptado: "unos 21 de `links` y 3 de plataforma", y la lista la da el `typecheck` (D11, proposal, tarea 3.1) | Una lista a mano caduca en el primer rebase |
| critic 8 | Dos frases del proposal quedaron falsas tras la iteración 1 | Aceptado: "ninguna lectura proyecta el texto" pasa a nombrar las **dos** que sí lo hacen, y lo de pino pasa a decir que redacta **por rutas declaradas** y que lo que garantiza el silencio es no escribirlo (proposal) | Un proposal que se contradice con el diseño se implementa dos veces |
| critic 9 | El fallo abierto del contador de la vista previa se justificaba por inercia | Aceptado: justificación propia —solo lee lo suyo, como mucho 5 documentos y un prefijo, sin IA ni red ni escrituras— (D5) | Cada política de fallo se decide por su caso, no por copia |
| critic 11 | El mensaje de `unsupported_media_type` decía que el cuerpo debe ser JSON, y ya no es verdad | Aceptado: mensaje genérico, porque el código lo comparten dos rutas con formatos distintos (D2, tarea 6.1) | El SPA traduce el código, pero el mensaje no puede mentir |

## Debate (iteración 3)

Critic: 0 P0 (2 P1). Business: 1 V0, que es el mismo punto que el P1 número 2 de critic. Convergido: no queda ningún
P0/V0 abierto y las decisiones no triviales quedan recogidas en **ADR-028**.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| business 1 (V0) + critic 2 (P1) | La línea de privacidad mandaba a **"Ajustes"**, una pantalla que no existe: la ruta es `/perfil`, se llama "Perfil", y el control de consentimiento está **deliberadamente ausente** hasta `cv-match-suggestions` (ADR-020), con un test que falla si aparece | Aceptado: la línea queda en "Tu CV solo lo ves tú y hoy no lo lee ninguna IA. No saldrá de LinkVault sin tu autorización.", sin puntero, en los cuatro archivos donde estaba replicada; la tarea 8.3 verifica que el texto **no nombra ninguna pantalla que no exista**, y el `scope` de `cv-match-suggestions` recoge que ese change pone el control en Perfil y completa la frase (D13, tareas 8.3 y 9.3) | Una frase que manda a un sitio inexistente convierte una promesa en un callejón |
| critic 1 (P1) | El `413` es la única rama que llega a leer megabytes y **no consumía el contador de rechazos**: una ráfaga de archivos de 6 MiB no tenía techo | Aceptado: el `413` consume `cv:reject`, con el escenario "Ráfaga de archivos enormes" (31 de 6 MiB → 30 `413` y un `429`). Y, como el cuerpo se lee a mano, se anota que el error de tamaño **sale del bucle**, así que la traducción envuelve el bucle y no solo `request.file()` (D2, D7, specs, tareas 6.2 y 6.6) | El contador tiene que contar justo la rama cara, y una traducción que no cubre el bucle devuelve el `500` que queríamos evitar |
| critic 3 | La tarea 1.8 se quedó en la versión vieja: pedía que `cvTextPreview` devolviera `complete`, que ya no puede calcular | Aceptado: `cvTextPreview(text)` → `{ text, chars }`, `complete` se calcula **solo** en el repositorio, y la fila de verificación del límite dice su valor esperado (tarea 1.8) | Una tarea que contradice al diseño se implementa dos veces |
| critic 4 | `complete` se apoyaba en `extraction.textChars`, un número escrito antes por otro proceso | Aceptado: la longitud se mide **en la misma consulta** con `$strLenCP`; `textChars` se sigue proyectando porque es lo que enseña el listado, y la tarea 7.8 afirma la invariante `textChars === $strLenCP(extractedText)` (D6, tareas 4.9 y 7.8) | Mismo coste, no trae el campo y no puede desfasarse |
| critic 5 | El punto de Risks sobre el multicuenta daba a entender que ese era el coste, y el número no salía | Aceptado: se reescribe con los tres caminos sumados —50 MiB de subidas válidas y ~150 MiB de `413`, frente a ~19 MiB por cuenta de basura barata— y se separa el techo por cliente, que va al `scope` de `deploy-prod` junto al **límite por IP y el tope de cuerpo en el proxy** (Risks, tarea 9.3) | Un riesgo con el número equivocado lleva a proteger lo que no toca |
| critic 6 | No estaba decidido si el resto del cuerpo se drena o se destruye | Aceptado: **drenar y descartar**, con su tabla. Destruir ahorraría ancho de banda pero puede costar que el `415` no llegue al cliente. Y la verificación de 6.5 mide **"no se acumula más de un chunk"**, que es lo que se promete, y no "no se lee más" (D2, tarea 6.5) | El objetivo es la memoria plana, no el ahorro de tráfico; y un `415` que no llega no sirve |
| critic 7 | Tres referencias rotas por la renumeración de la iteración 2 | Aceptado: la tarea del test de componente pasa a ser la 8.11, el RUNBOOK habla de **tres** contadores y el requisito de límites cambia de título para nombrar los rechazos (tareas 8.11 y 9.5, spec `cv/documents`) | Una referencia rota se lee como una tarea que falta |
| business 6 | Un `pending` que nadie resuelve —worker parado, relay apagado— no tenía salida | Aceptado: "Sigue en proceso. Si sigue así en unos minutos, elimínalo y vuelve a subirlo." (D8, D13, spec `web/cv`) | Borrar y volver a subir crea un evento nuevo, que es el único remedio que la persona tiene en la mano |
| business 8 | No estaba escrito qué hace "Actualizar" con el sondeo | Aceptado: **reanuda otra ventana de 60 s**, y queda en la tarea del store (8.2) con su escenario | Un botón que solo pide una vez deja a la persona pulsando |

## Decisiones de implementación (frontend)

Lo que el grupo 8 tuvo que decidir y no estaba escrito. En cada caso se eligió la opción más conservadora: ninguna
añade superficie ni promete nada que la API no cumpla hoy.

1. **`CvStore` no es `providedIn: 'root'`; lo provee `MyCvPage`.** La spec pide que salir de la pantalla detenga el
   sondeo, y un store de raíz sobrevive a la navegación. Proveerlo en la página hace que el `onDestroy` del store sea
   exactamente "salir de `/mi-cv`". El test lo comprueba mirando que no quede ningún temporizador vivo tras destruir el
   inyector, no solo que no salgan peticiones: sin esa comprobación el test pasaba igual con el sondeo suelto.
2. **La ventana de sondeo se cuenta en vueltas (30 de 2 s), no con el reloj.** Así la ventana significa lo mismo aunque
   una respuesta tarde, y el test no depende de que el reloj falso finja también `Date.now()`.
3. **Un fallo de una vuelta del sondeo no se enseña ni corta la ventana**: la lista sigue con lo que ya tenía y la
   vuelta siguiente lo reintenta. Un error transitorio de fondo no puede borrar de la pantalla lo que la persona está
   mirando; si el CV no se resuelve, el aviso de "Sigue en proceso" aparece igual al agotarse la ventana.
4. **La fecha se pinta con `dd/MM/yyyy`**, como el resto del SPA (`link-card`, `group-detail`), y el tamaño como
   `312 KB` / `4.5 MB`. Las unidades no se traducen porque se escriben igual en los dos idiomas.
5. **Una vista previa que llega vacía se trata como fallo genérico** ("No pudimos mostrarlo ahora" con "Reintentar").
   Solo ocurre en una carrera —el CV dejó de estar `extracted` entre que se pintó la lista y se pulsó—, y un diálogo en
   blanco es justo lo que la iteración 2 prohibió.
6. **El "Este CV ya no está" del `404` lo pinta la página**, no el diálogo: el diálogo se cierra devolviendo `gone`, y
   quien lo abrió muestra el aviso y recarga la lista. Un mensaje dentro de algo que se está cerrando no se lee.
7. **El texto de la vista previa se puede seleccionar.** No hay botón de copiar, descargar ni compartir, pero no se
   bloquea la selección del navegador: hacerlo no impide sacar el texto —basta con mirar la pantalla— y sí rompe a
   quien usa un lector.
8. **`complete` no se enseña.** D13 no lo pide y decir "esto es solo el principio" no cambia ninguna decisión de quien
   mira: lo que se comprueba ahí es si el texto se leyó ordenado.
9. **El SPA no se adelanta al tope de 5 CV**: no deshabilita el botón de subir al llegar a cinco, deja que la API
   responda `409` y muestra su mensaje. La lista que se ve puede estar vieja (otra pestaña), y la autoridad es la API.
10. **La subida nueva apaga la marca de las demás en local**, sin volver a pedir la lista: es lo que la API acaba de
    hacer (D4), y pedirla otra vez para enterarse sería una petición de más en el momento de más espera.
11. **Un `404` al eliminar es el resultado pedido** —lo borraron en otra pestaña—: no se muestra error, se recarga la
    lista.
12. **Marcar y eliminar comparten un `busy` de la página**, que incluye el tiempo en que la confirmación está abierta:
    dos gestos a la vez sobre la misma lista no pueden salir los dos.
13. **Los textos que nombran números —"5 MB", "hasta 5 CV"— se escriben literales** en su unidad de traducción, en vez
    de interpolar la constante: un ICU por un número fijo complica la traducción sin ganar nada. Lo que sí hay es un
    test que falla si `CV_MAX_FILE_BYTES` deja de ser 5 MiB, que es la forma de que el texto no mienta.

## Decisiones de implementación

Lo que el diseño no dejaba escrito y hubo que elegir al construirlo. Todas se tomaron por la opción más conservadora
—la que menos superficie añade y menos cosas da por supuestas— y ninguna cambia el alcance del change.

| # | Qué no estaba escrito | Qué se hizo | Por qué |
|---|---|---|---|
| 1 | El bucket se llamaba `cv`, y S3 (y MinIO con él) **exige entre 3 y 63 caracteres** en un nombre de bucket: `mc mb` falla y el healthcheck nunca da "healthy" | El nombre por defecto pasa a ser **`cvs`**, en `.env.example` y en el `docker-compose` | Es la corrección mínima que deja el nombre legal sin tocar la variable (`S3_BUCKET`) ni nada del diseño. Un `.env` que ya tuviera `cv` arranca igual: la API solo valida la forma, y el bucket lo crea el compose |
| 2 | Los contratos del grupo 1 dejaban `api-error.ts` sin estado ni mensaje para los cuatro códigos nuevos, y el `typecheck` de `api` es parte de la verificación de la tarea 1.11 | El commit del contrato añade también **las dos filas de `api-error.ts`** por código; el mensaje genérico de `unsupported_media_type` y las ramas del filtro llegan en el grupo 6, como dice la tarea 6.1 | Un commit que deja `main` sin compilar no es un commit terminado, y el agente de frontend esperaba el contrato |
| 3 | D3 calculaba `version` como `max(version) + 1`, pero la spec exige que **los números no se reutilicen** y el borrado es un borrado de verdad: con 1, 2 y 3, borrar la 3 devolvería otra vez la 3 | Colección auxiliar **`cv_version_counters`**, un documento por persona con un solo entero, leído y subido con `$inc` **dentro de la transacción del alta**. El índice único `(userId, version)` sigue siendo la garantía dura; el contador solo dice qué número pedir. Al borrar el último CV de una persona, su contador se borra con él | Sin estado durable no hay forma de recordar lo ya entregado, y "la v3" no puede querer decir dos cosas en la misma cuenta. La alternativa —un campo de marca de agua repetido en cada documento— tocaba la forma de `cv_documents`, que sí está escrita |
| 4 | La vista previa de un CV que todavía no está `extracted`: la spec pide `complete` `false`, pero medir el texto vacío daría `true` | `complete` es `false` salvo que el estado sea `extracted` | Decir `true` sobre una respuesta vacía sonaría a "esto es todo lo que tu CV decía" |
| 5 | El parser de multipart **no lanza** `FST_REQ_FILE_TOO_LARGE` cuando el cuerpo se lee a mano: busboy corta el stream por `fileSize` y lo **termina sin error**, dejando solo `file.truncated` (ese error solo sale de `toBuffer()`, que este controlador no usa) | El tope se comprueba **después del bucle**, mirando `truncated`, y responde `413` | Sin eso, un archivo de 6 MiB se guardaría recortado a 5 y parecería entero, que es justo lo que D2 eligió evitar al acumular en memoria |
| 6 | Al tocar `files`, `parts` o `fields`, el plugin **destruye la parte en curso**, así que lo que llega al controlador no es su `code` sino el `ERR_STREAM_PREMATURE_CLOSE` de Node | La traducción añade esa fila: `ERR_STREAM_PREMATURE_CLOSE` → `InvalidCvUpload('file')` | Es la misma red de seguridad que el defecto de `FST_*`. Sin ella, "dos archivos" y "un campo de más" eran el `500` que la traducción existe para evitar |
| 7 | El `Content-Type` de una parte **sin cabecera** no llega vacío: el parser inventa `text/plain` (RFC 7578), indistinguible de uno escrito a mano | `text/plain` entra en la lista de tipos neutros, junto a `application/octet-stream` y el vacío | Vetarlo rechazaría el escenario "DOCX sin Content-Type útil", que es el CV de quien sube desde un cliente que omite la cabecera. Lo que decide sigue siendo bytes + extensión |
| 8 | `pdf-parse` **lee mal un búfer que viene del *pool* de Node**: con `byteOffset` distinto de cero —lo normal por debajo de ~4 kB, y lo que devuelve leer un objeto de MinIO— interpreta la tabla `xref` desplazada y falla con `bad XRef entry` | El adaptador copia los bytes a una vista de **desplazamiento cero** antes de llamarlo, con su propio test sobre un búfer del *pool* | Sin la copia, un CV pequeño y perfectamente legible acabaría en `failed` y nadie sabría por qué |
| 9 | `qpdf` **no está disponible** en el entorno, y D9 pedía producir con él el PDF cifrado y commitearlo | Se **genera** como los demás, con su diccionario de cifrado estándar (`/Filter /Standard`, `/V 1 /R 2`): el parser toma el camino del descifrado y se planta pidiendo contraseña, que es el desenlace que el test necesita. El comando `qpdf --encrypt` exacto queda en `tools/cv-fixtures/README.md` | La razón de aquella decisión era **no escribir un cifrador para un test**, y aquí tampoco se escribe ninguno. Generarlo evita además meter un binario que nadie puede revisar en un PR, que es el motivo por el que los otros cinco se generan |
| 10 | Las funciones que generan los fixtures no podían vivir en `tools/cv-fixtures/`: la regla de límites de módulos de Nx prohíbe que un proyecto importe por ruta relativa algo de fuera de él, y quien las necesita son los tests del worker | Las funciones viven en `apps/worker/src/modules/cv/infrastructure/extractors/fixtures/cv-fixtures.ts`; `tools/cv-fixtures/make-fixtures.ts` se queda como el **script que las escribe en disco**, con el README al lado | La alternativa era una librería Nx nueva para cinco funciones puras de test |
| 11 | `pdf-parse` tiene una versión 2 que es otra librería (ESM, con sus propios tipos, y `pdfjs-dist` + `@napi-rs/canvas` detrás, unos 25 MB) | Se fija **`pdf-parse@^1.1.1`** con `@types/pdf-parse`, que es la que tiene el `lib/pdf-parse.js` del que habla D9 | Es lo que el diseño describe, y evita meter una dependencia nativa grande en el árbol del worker sin haberlo decidido |
| 12 | El consumidor de `delete-cv-file` no tenía escrito qué hacer al agotar los reintentos | Solo se registra el aviso: **no se escribe nada en la base** | Aquí no hay ningún agregado que se quede sin explicación. Lo que queda es un objeto huérfano —invisible para la persona y para la API— y de eso se encarga el barrido en dos pasos del RUNBOOK |
| 13 | El `jobId` de los dos eventos de CV era `<cola>:<cvId>`, y **BullMQ lo rechaza**: si un `jobId` contiene `:`, exige **exactamente tres segmentos** (`Custom Id cannot contain :`, `Job.addJob` de bullmq 6.3.6). `enrich:<linkId>:<version>` tiene tres y por eso `links` nunca lo vio | Los dos pasan a **`cv:<cvId>:extract`** y **`cv:<cvId>:delete`**, siguiendo la convención que ya usaba `links`, y siguen siendo deterministas | Lo destapó el e2e: ningún evento de CV llegaba a su cola, el relay reintentaba y el CV se quedaba en `pending` para siempre. Decisión del coordinador |
| 14 | Ningún test ejecutaba la validación de BullMQ, porque **todos publican contra una cola doble** | Dos redes: un **test de contrato** en `outbox-routes.spec.ts` que replica las dos reglas de `Job.addJob` (con `:`, tres segmentos; nunca un entero) recorriendo **todas** las rutas de la tabla, de modo que un evento nuevo con un `jobId` mal formado falla en CI; y un **paso local** (`bullmq-job-id.local.spec.ts`, con `OUTBOX_REDIS_LOCAL=1`) que lo comprueba contra el Redis del compose sobre una cola de sonda, para que la regla replicada no se desfase de la de verdad | Un doble que no valida nada convierte un contrato en una suposición. El de contrato se probó reintroduciendo el `jobId` viejo: falla |
| 15 | El relay registraba **todo** fallo de publicación en `debug`, así que un error nuestro —un `jobId` que la cola rechaza, un tipo desconocido, un payload que no valida— no se veía hasta el aviso de las 24 h | **La primera vez que un evento falla se avisa con `warn`** (identificador, tipo y motivo); los reintentos siguientes siguen en `debug`, y el aviso de darlo por agotado no cambia | Es una línea **por evento y no por vuelta**: un corte de Redis avisa una vez de cada pendiente y se calla, mientras que un fallo permanente se ve en el primer arranque. El payload del outbox solo lleva identificadores (ADR-009), así que el mensaje no expone nada |
