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
- **Ver o descargar el texto extraído.** Se devuelve cuántos caracteres se leyeron, no el texto (D3).
- **OCR.** Un PDF escaneado no tiene capa de texto; se dice y ya (D8).
- **Compartir un CV.** No hay ninguna ruta pública, ni por grupo, ni por enlace. El CV es de una persona y de nadie más.
- **Caducidad automática y borrado de cuenta.** El bucket `cv` **no** lleva regla de expiración: borrar el CV de alguien
  porque lleve un año sin entrar sería destruir datos por un temporizador. El borrado de cuenta no existe todavía y lo
  hereda `deploy-prod` (Open Questions).
- **Aviso en vivo del final de la extracción.** El canal SSE existe y sería barato, pero la extracción tarda segundos y
  el sondeo cuesta una consulta indexada; SSE entra cuando `cv-match-suggestions` tenga algo largo que anunciar (D8).
- **Antivirus sobre lo subido.** El archivo solo lo descarga su dueño, nunca se ejecuta ni se sirve como HTML
  (`Content-Disposition: attachment`). Si algún día un CV se comparte, ClamAV entra con ese change (Open Questions).
- **`worker_threads` para el parseo.** Se acota con concurrencia 1 y un plazo; medir antes de complicar (D9, Risks).
- **Editar los metadatos** (renombrar el archivo, poner una etiqueta "CV para backend"). Es útil y no cuesta casi nada,
  pero no está en el alcance del manifiesto y añade un campo editable más que validar.
- **`CvFacade`.** Todavía no hay ningún módulo que lea CVs. La crea quien la necesite, que será `cv-match-suggestions`.

## Decisions

### D1 — Qué se guarda, dónde, y qué ve cada endpoint

El reparto es el de design.md §5, con una condición añadida: **el texto extraído no sale por ninguna puerta HTTP**.

| Dato | Dónde | Quién lo ve |
|------|-------|-------------|
| Bytes del archivo | MinIO, bucket `cv`, clave `<userId>/<cvId>` | solo su dueño, y solo por `GET /api/cv/:id/file` (D6) |
| `fileName`, `fileType`, `sizeBytes`, `version`, `isDefault`, `uploadedAt` | `cv_documents` | su dueño, en el listado |
| `extraction` (`status`, `failureReason?`, `textChars`, `truncated`, `extractedAt?`) | `cv_documents` | su dueño, en el listado |
| `extractedText` | `cv_documents` | **nadie por HTTP**; lo escribe el worker y lo leerá `cv-match-suggestions` |
| `fileKey` | `cv_documents` | nadie: es un detalle del adaptador, no viaja en ninguna respuesta |

**El contrato lo garantiza, no la buena voluntad.** `cvDocumentSchema` es un `strictObject` con exactamente los campos
de la tabla; el mapeo parte de una lista explícita de campos y nunca de un `...document`; y el repositorio **proyecta
fuera `extractedText` en todas sus lecturas salvo la que lo escribe**, con un test que lo comprueba contando lo que
vuelve del driver. Son las tres barreras que ya usó `public-preview-share` para `summary`, y por la misma razón: el
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

Saneado de `fileName`: se queda con el último segmento tras `/` y `\`, se quitan caracteres de control y los de cambio
de dirección del texto (U+202A–U+202E, U+2066–U+2069), se recorta a 120 code points conservando la extensión, y si tras
todo eso queda vacío se usa `cv.pdf` o `cv.docx` según el tipo detectado. El nombre **no** se usa para nada más: ni para
la clave del objeto, ni para decidir el tipo (D2), ni para el `Content-Disposition`, que lo escribe ya saneado.

### D2 — La subida: qué se acepta y cómo se comprueba de verdad

**El transporte.** `@fastify/multipart` registrado en `configureApp` con `limits: { fileSize: CV_MAX_FILE_BYTES, files: 1, fields: 0, parts: 2 }`, y el controlador consumiendo `request.file()`. Alternativas descartadas: un
`addContentTypeParser` propio que acumule el cuerpo (reescribir un parser de multipart es la peor idea de este change);
subir desde el navegador a MinIO con una URL prefirmada (D6 explica por qué no).

Registrar el plugin es **global**, así que hay que decir qué pasa con el resto de rutas: el plugin solo actúa cuando el
`Content-Type` es `multipart/form-data`, y cualquier otra ruta que reciba uno sigue fallando en su pipe de zod con
`400 validation_error`, porque su cuerpo no será el objeto que espera. **Solo `POST /api/cv` lee partes**; un escenario
de la spec lo fija mandando un multipart a `POST /api/links` y exigiendo que no se guarde nada.

**La comprobación del tipo, en tres capas que tienen que coincidir:**

| Capa | Qué se mira | Por qué no basta sola |
|------|-------------|-----------------------|
| `Content-Type` de la parte | `application/pdf` o `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | Lo escribe el cliente; un `curl` pone lo que quiera. |
| Extensión del `filename` | `.pdf` o `.docx` | Lo escribe el cliente; renombrar un `.exe` a `.pdf` es un clic. |
| **Primeros bytes** | `%PDF-` (PDF) o `PK\x03\x04` (DOCX, que es un ZIP) | Es lo único que el archivo no puede mentir sin dejar de ser ese formato. |

Las tres tienen que apuntar al **mismo** tipo; si no, `415 unsupported_file_type` y **nada se sube ni se escribe**. La
función que huele los bytes (`sniffCvFileType`) vive en `libs/shared`, es pura y la comparten la API y sus tests.

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
**por persona** (1, 2, 3…), calculado dentro de la transacción como `max(version) + 1` y protegido por el índice único
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
| `cv:download:<userId>` | `GET /api/cv/:id/file` | `CV_DOWNLOADS_PER_USER = 30` por 15 min | **abierto** |

Los dos **fallan abiertos**: con Redis caído, quien quiere subir su CV lo sube. Es defendible aquí y no lo sería en un
endpoint que descarga de un sitio ajeno, porque **el tope duro de almacenamiento no lo pone el contador sino el máximo
de 5 documentos de D3**: sin contador, una persona puede subir y borrar en bucle, que gasta tráfico pero no acumula
nada. La ventana es la misma de `auth` y `links` (15 min), para no inventar una tercera unidad de tiempo.

El intento se consume **antes** de leer la parte del multipart y **se devuelve** (`giveBack`) si la petición termina en
`413`, `415` o `409 too_many_cvs`: un archivo que rebotó en la puerta no gasta uno de los diez intentos de alguien que
todavía no ha subido nada. Sí lo gasta un `500`: ahí no sabemos qué quedó hecho.

### D6 — Descargar el CV sin abrir una puerta en MinIO

**Se puede descargar, y lo sirve la API.**

| Opción | A favor | En contra |
|--------|---------|-----------|
| a) No se puede descargar | Cero superficie. | El archivo es de la persona y queda en una caja negra: no puede comprobar cuál subió ni recuperarlo si perdió el original. |
| b) URL prefirmada de MinIO con caducidad corta | La API no mueve bytes. | Es **una URL que funciona sin sesión**: queda en el historial del navegador, en el `Referer`, en los logs del proxy y en cualquier chat donde se pegue; el endpoint de MinIO puede no ser alcanzable desde el navegador en producción; y caducidad corta más reloj desfasado es un enlace roto. |
| **c) La API lee el objeto y lo devuelve** | Una sola puerta, con la sesión que ya existe y el mismo `404` que el resto; MinIO **nunca** se expone al navegador. | La API mueve hasta 5 MiB por descarga. |

**Gana c**, 2 a 1 (coste de tráfico → b; privacidad y simplicidad → c; operación → c). Desempate: este change existe en
buena parte para que el CV no sea alcanzable sin sesión, y b regala exactamente eso a cambio de ahorrar unos megabytes.

Forma de la respuesta: `Content-Type` según `fileType`, `Content-Length`, `Content-Disposition: attachment;
filename="<saneado>"` con su `filename*` en UTF-8, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`
y `Referrer-Policy: no-referrer`. **`attachment`, nunca `inline`**: un PDF abierto en el visor del navegador puede
ejecutar JavaScript en algunos motores, y no hay ninguna razón para pintarlo dentro de nuestra página.

**El bucket `cv` es privado y no lleva política ni regla de expiración.** El `docker-compose` lo crea así, el RUNBOOK
dice cómo comprobarlo (`mc anonymous get`) y una tarea lo verifica.

Un `:id` de otra persona, inexistente o mal formado recibe **el mismo `404 cv_not_found`**: distinguir "no existe" de
"no es tuyo" diría a un extraño que ese identificador existe.

### D7 — El alta, paso a paso, y por qué el objeto va antes que la transacción

1. contador (`consume`, D5);
2. leer la parte: `Content-Type`, extensión y primeros bytes (D2), acumulando hasta el tope;
3. contar los CVs de la persona (camino rápido de D3);
4. pedir el identificador al repositorio (`nextId()`), componer `cvFileKey(userId, cvId)` y **subir el objeto**;
5. **transacción**: recontar, calcular `version`, apagar el `isDefault` anterior, insertar el documento y `append` del
   evento `CvUploaded.v1` en `outbox_events`;
6. `201` con el documento.

**Por qué el objeto va antes:**

| Orden | Si se rompe a mitad |
|-------|---------------------|
| **Objeto → transacción** | Queda un objeto que **ningún documento nombra**: invisible para la persona y para la API, recogible por el barrido del RUNBOOK. |
| Transacción → objeto | Queda un documento que dice "tienes un CV" y cuyo archivo no existe: la descarga da `500`, la extracción falla y la persona ve un CV roto que ella no puede explicar. |

Se elige el primero: **el fallo debe caer del lado invisible**, no del lado de la persona. Como el `cvId` se genera
antes (paso 4), un reintento de la transacción no obliga a volver a subir nada.

El identificador lo crea el **repositorio** (`nextId()`), no el caso de uso: quién sabe qué forma tiene un identificador
es quien lo persiste, y su doble en memoria devuelve identificadores deterministas para los tests.

### D8 — La extracción: idempotencia, resultados y fallos

**El evento.** `CvUploaded.v1` con payload `{ cvId, userId }` —solo identificadores, como `LinkCreated.v1`: ni el nombre
del archivo, ni el tipo, ni el tamaño—, cola `extract-cv`, `jobId` determinista `extract-cv:<cvId>`. La clave del objeto
la compone el worker con la misma función pura `cvFileKey` de `libs/shared`, para que no haya dos formas de nombrar el
mismo archivo.

**La idempotencia es propia, no prestada del `jobId`** (la lección escrita en `EnrichLinkUseCase`):

1. leer el documento; si no está (lo borraron entre medias), el job termina bien: `cv_not_found`;
2. si su `extraction.status` ya no es `pending`, el job termina bien: `already_extracted`;
3. descargar, extraer, y escribir **condicionado** a `{ _id, 'extraction.status': 'pending' }`; si no modifica nada,
   ganó otra ejecución y el job termina bien: `lost_race`.

Ninguno de los tres es un error y ninguno se reintenta. Un job que revienta de verdad —Mongo o MinIO caídos— sí: tres
intentos con espera exponencial desde 5 s, como `enrich-link`. Agotados, el consumidor deja el CV en `failed` con
`internal_error` y un aviso con el `cvId`, **nunca** en `pending` para siempre: un estado "leyendo" eterno es una mentira
que la persona no puede resolver.

**Los resultados posibles, todos visibles:**

| Estado | Cuándo | Qué ve la persona |
|--------|--------|-------------------|
| `pending` | desde el `201` hasta que el worker escribe | "Estamos leyendo tu CV…" |
| `extracted` | texto útil (≥ `CV_MIN_TEXT_CHARS = 100` caracteres tras normalizar) | "Listo · 8.412 caracteres leídos" |
| `failed` / `unreadable_file` | el parser no pudo abrirlo: corrupto, cifrado, o un ZIP que no es un DOCX | "No pudimos abrir este archivo. Puede estar dañado o protegido con contraseña." |
| `failed` / `no_text` | se abrió, pero no hay texto: un PDF escaneado, imágenes | "Este archivo no tiene texto: parece un escaneo o una imagen. Sube el PDF original o expórtalo desde tu editor." |
| `failed` / `internal_error` | se agotaron los reintentos por un fallo nuestro | "No pudimos leerlo ahora. Vuelve a subirlo en un rato." |

Un `failed` **no borra nada**: el documento y el archivo siguen ahí y se pueden descargar y eliminar. El remedio es
volver a subirlo, que crea otra versión; no hay botón de "reintentar la lectura" en este change (Non-Goal: exigiría su
propio límite y su propia ruta, y el remedio real casi siempre es otro archivo).

**El texto que se guarda** se normaliza antes de escribirse: `\r\n`/`\r` → `\n`, se quitan los caracteres de control
salvo `\n` y `\t`, se colapsan las líneas en blanco repetidas y se recortan los extremos. Se guarda como mucho
`CV_TEXT_MAX_CHARS = 200_000` caracteres, marcando `truncated: true`: es entre diez y veinte veces cualquier CV real, y
existe para que un PDF generado con basura no meta megabytes de texto en un documento de Mongo (el límite de 16 MB es
real y se alcanza antes de lo que parece).

**El plazo.** `CV_EXTRACTION_TIMEOUT_MS` (30 s por defecto, 1 s–120 s) acota la extracción entera, porque un PDF
malformado puede tener a un parser dando vueltas. Vencido, el resultado es `failed` con `unreadable_file`: para la
persona es indistinguible de un archivo roto, y lo es.

**Mientras tanto, el SPA sondea.** `GET /api/cv` cada 2 s mientras alguna versión esté `pending`, hasta 60 s, y después
deja un "Sigue en proceso · Actualizar". Alternativa descartada por ahora: un evento SSE `cv.extracted` por el canal
autenticado que ya existe. Es barato y encaja, pero exige que el worker publique en Redis y la API reparta (el camino de
`RedisEnrichmentNotifier`), y lo que se gana es adelantar un par de segundos un aviso en una pantalla que la persona
está mirando. Entra cuando haya algo largo que anunciar, que es el análisis.

**El borrado del binario, por la misma cañería.** `DELETE /api/cv/:id` borra el documento, promueve el nuevo por defecto
si hacía falta y escribe `CvDeleted.v1` (`{ cvId, userId }`, cola `delete-cv-file`, `jobId` `delete-cv-file:<cvId>`), todo
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

### D12 — Datos, índices y objetos huérfanos

`cv_documents`:

```
{ _id, userId, fileKey, fileName, fileType: 'pdf'|'docx', sizeBytes, version, isDefault, uploadedAt,
  extraction: { status: 'pending'|'extracted'|'failed', failureReason?, textChars, truncated, extractedAt? },
  extractedText? }
```

| Índice | Para qué |
|--------|----------|
| único `{ userId: 1, version: 1 }` | La correlatividad de D3 y el cierre de la carrera de dos subidas. |
| único **parcial** `{ userId: 1, isDefault: 1 }` sobre `isDefault: true` | La invariante de D4: como mucho un CV por defecto. |
| `{ userId: 1, uploadedAt: -1 }` | El listado y la promoción "el más reciente de los que quedan". |

`duplicateKeyIs` (ya compartido en `infrastructure/mongo/`) distingue `CV_VERSION_KEY` de `CV_DEFAULT_KEY`: el primero
reintenta la transacción, el segundo es un fallo de programación —significa que alguien apagó mal el anterior— y sale
como `500`.

**Objetos huérfanos.** Pueden aparecer por una transacción abortada tras subir (D7) o por un `CvDeleted.v1` que se
agotara a las 24 h. No hay proceso automático que los recoja: un barrido que borra objetos comparándolos con la base es
justo el tipo de script que, mal escrito, borra los CVs de todo el mundo. El RUNBOOK documenta el procedimiento en dos
pasos —listar las claves del bucket, restar las que `cv_documents` referencia, **revisar la lista** y borrarla— y
`deploy-prod` hereda automatizarlo si alguna vez pesa.

### D13 — El SPA

Ruta `/mi-cv`, con `authGuard`, perezosa, en la barra de navegación junto a "Mis links" y "Postulaciones".

- **Subir**: un `input[type=file]` con `accept=".pdf,.docx"` y una zona para soltar el archivo. El SPA comprueba
  extensión y tamaño **antes** de enviar para dar respuesta inmediata, y trata la API como la autoridad: un `415` o un
  `413` se muestran igual aunque la comprobación local haya pasado. El progreso sale de `HttpClient` con
  `reportProgress: true` y `observe: 'events'`; mientras sube, el botón queda deshabilitado con `aria-busy`.
- **Listar**: una tarjeta por versión, ordenadas de más nueva a más vieja, con `v3 · CV_backend.pdf · 312 KB · 12 sep
  2026`, el chip de estado (D8) y las acciones "Usar este" (ausente en el que ya lo es), "Descargar" y "Eliminar".
- **Marcar por defecto**: sin confirmación —no destruye nada— y con vuelta atrás si la API falla, como el interruptor de
  `defaultVisibility` (ADR-027 §7).
- **Eliminar**: con confirmación que dice el nombre y avisa de que "el archivo se borra y no se puede recuperar", y que
  **además** avisa cuando es el de por defecto: "Pasará a usarse tu CV más reciente".
- **Estado vacío**: "Sube tu CV y LinkVault podrá comparar tus habilidades con cada vacante." Es la promesa que explica
  por qué existe esta pantalla antes de que `cv-match-suggestions` la cumpla.
- **Errores**: `413` → "Ese archivo pesa más de 5 MB"; `415` → "Solo aceptamos PDF o DOCX"; `409 too_many_cvs` →
  "Guardamos hasta 5 CV. Elimina uno para subir otro."; `429` → el mensaje de límite que ya existe, con su espera.

Textos en ES y EN, marcados y traducidos en `messages.en.xlf` en el mismo commit.

## Risks / Trade-offs

- **Guardamos el CV entero, el texto entero y el nombre del archivo.** Es el mayor volumen de dato personal del
  producto. Lo acotan: bucket privado, cero rutas públicas, texto que no sale por HTTP, borrado que se lleva el binario
  y logs sin nada de eso. Lo que **no** cubre este change es el cifrado por objeto ni el borrado de cuenta.
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
- **Sin antivirus** (Non-Goals): un archivo malicioso guardado solo puede dañar a quien lo subió, que ya lo tenía.

## Migration Plan

1. Desplegar con las `S3_*` presentes también en `api` (sin ellas el proceso **no arranca**) y con el bucket `cv`
   creado y privado. En local lo crea el `docker-compose`; en producción lo crea `deploy-prod`.
2. `autoIndex` crea los tres índices de `cv_documents` al arrancar: la colección está vacía, así que tarda milisegundos.
3. **Sin backfill ni migración de datos**: no existe ningún CV previo.
4. Las dos colas nuevas se crean solas al publicarse el primer evento. Con el relay apagado, los eventos esperan.
5. Volver atrás: desplegar la versión anterior. Los documentos y los objetos se quedan como están; el RUNBOOK trae el
   `drop` de la colección y el `mc rm --recursive` del bucket para dejarlo limpio de verdad.

## Open Questions

- **Borrado de cuenta y retención.** Hoy no existe el borrado de cuenta, así que el CV de alguien que se va no se borra.
  - **Recomendación:** que lo herede `deploy-prod`, en el mismo apartado donde ya hereda los comentarios y los enlaces
    públicos: borrar `cv_documents` de esa persona y sus objetos (`mc rm --recursive <bucket>/<userId>/`), y publicar un
    aviso de privacidad que diga qué se guarda de un CV y por cuánto tiempo. Se anota en el `scope` del manifiesto.
- **¿Puede la persona ver el texto extraído?** D3 dice que no sale por HTTP; solo se dice cuántos caracteres se leyeron.
  - **Recomendación:** dejarlo así aquí. Cuando `cv-match-suggestions` enseñe el análisis, enseñar también el fragmento
    concreto que lo justifica (`evidence.cvFragment`, ya obligatorio en el contrato) resuelve la transparencia sin abrir
    un endpoint que devuelva el CV en texto plano.
- **¿Cinco CVs bloqueando o rotación automática?** D3 eligió bloquear con `409`.
  - **Recomendación:** mantenerlo y mirar el dato: si mucha gente choca con el tope, subir el número es cambiar una
    constante; borrar sin permiso no se deshace.
- **¿Aviso en vivo (SSE) del final de la extracción?** D8 eligió sondeo.
  - **Recomendación:** dejarlo para `cv-match-suggestions`, que ya necesita `analysis.step` por SSE (design-v0.2 §5.6);
    añadir entonces `cv.extracted` por el mismo canal no cambia ningún contrato REST de este change.
- **¿Antivirus sobre lo subido?** Fuera de alcance mientras el archivo solo lo descargue su dueño.
  - **Recomendación:** volver a plantearlo el día que un CV se comparta con alguien (con un grupo, con una empresa); ahí
    sí cambia el modelo de amenaza y ClamAV entraría con ese change.
- **¿El parseo debe salir del hilo principal del worker?** D9 lo acota con concurrencia 1 y un plazo.
  - **Recomendación:** medir primero con los fixtures de PDF grandes (p95 del parseo y latidos del worker durante él) y
    decidir con el número; si se pasa de ~500 ms, `worker_threads` o un proceso aparte, en su propio change.
- **¿Tope de 5 MiB suficiente?** Un CV con fotos y portafolio puede pasarse.
  - **Recomendación:** mantener 5 MiB (es el número de design.md §4.8) y decirlo claro en la pantalla; subirlo es una
    constante, pero cada MB extra es memoria por subida en curso (D2) y texto que parsear.

## Debate

Pendiente: este change queda **solo planificado**. Antes de `/opsx:apply` hay que convocar a `critic` y `business`,
actuar como `reflect` e iterar hasta que no quede ningún P0/V0 abierto, registrando aquí la tabla de cada iteración y en
**ADR-028** lo no trivial, como en `public-preview-share` y `group-comments`.
