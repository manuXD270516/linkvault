## Why

LinkVault ya sabe todo de la vacante y nada de la persona. El orden 11 de design-v0.2 §6 abre la fase 2 con la otra
mitad del par: **el CV**. Sin un CV guardado y leído no hay `cv-match-suggestions` (orden 12) ni `study-roadmap`
(orden 13), porque las dos tareas de IA reciben `cv.text` como entrada (design-v0.2 §4.6). Este change entrega la
cañería —subir, guardar, extraer texto, versionar, elegir el que vale— y **nada de IA**: la primera vez que el texto de
un CV viaje a un proveedor será en `cv-match-suggestions`, con el consentimiento y el `PiiRedactor` que ADR-018 §11 y
§13 dejaron preparados.

El CV es el dato más personal que este producto va a guardar: lleva nombre, teléfono, dirección, historia laboral y, a
veces, la edad o el estado civil. Por eso el change no es "un endpoint de subida": es decidir **qué se guarda, dónde,
quién puede leerlo y qué pasa cuando alguien quiere borrarlo**, y dejarlo escrito antes de que exista el primer byte.

## What Changes

- **Subida** (`POST /api/cv`, multipart): un archivo por petición, PDF o DOCX, **5 MiB** como máximo. La autoridad sobre
  el tipo son **los primeros bytes del archivo** (`%PDF-` dentro del primer kilobyte, `PK\x03\x04`) y la **extensión**;
  el `Content-Type` solo descalifica si **contradice** a los dos, así que un `application/octet-stream` o su ausencia no
  estorban. Lo que no cuadra recibe `415 unsupported_file_type` y **no se guarda en ningún sitio**; lo que pasa de
  5 MiB, `413 file_too_large`, sin dejar un archivo a medias en MinIO. El tipo se decide **con el primer trozo que
  llega**: en cuanto se sabe que no es PDF ni DOCX se corta el flujo y se responde, sin acumular 5 MiB de algo que ya
  sabemos que no vale. Los errores del parser de multipart se traducen a errores de dominio antes del filtro **por
  defecto** —cualquier `code` que empiece por `FST_` acaba en `400 validation_error` nombrando `file`—, con sus filas
  conocidas encima: ninguno sale como `500`.
- **Dónde vive cada cosa**: el **binario** en MinIO (bucket `cv`, privado, clave `<userId>/<cvId>` sin nombre ni
  extensión); los **metadatos y el texto extraído** en `cv_documents`. Las únicas dos lecturas que proyectan el texto
  son **la que lo escribe** y **la de la vista previa**, que trae solo su prefijo; el listado trae estado, número de
  caracteres y poco más.
- **Versiones**: cada subida es una **versión nueva** (`version` correlativo por persona, nunca reutilizado), nunca una
  edición de la anterior. Se guardan **hasta 5**; la sexta recibe `409 too_many_cvs` y pide borrar una. Nada se borra
  solo.
- **`isDefault`**: exactamente uno por persona mientras quede alguno, garantizado por un **índice único parcial**. La
  subida más reciente pasa a ser el de por defecto; `PUT /api/cv/:id/default` lo cambia a mano; **borrar el marcado
  promueve al más reciente de los que quedan**, en la misma transacción.
- **Extracción en el worker** (`extract-cv`, `pdf-parse` y `mammoth`): el alta escribe `CvUploaded.v1` en
  `outbox_events` **dentro de la transacción** (ADR-009) y el relay lo publica. El job es idempotente por escritura
  condicionada al estado `pending`, no por el `jobId`. Un archivo ilegible o cifrado, o un PDF escaneado sin capa de
  texto, **no son un error**: son un resultado (`failed` con `unreadable_file` o `no_text`), el job termina bien y la
  persona lo lee en su pantalla. Solo se reintenta lo que revienta (Mongo, MinIO): 3 intentos con espera creciente.
- **Borrado que se lleva el archivo**: `DELETE /api/cv/:id` borra el documento y escribe `CvDeleted.v1` en la misma
  transacción; el worker borra el objeto de MinIO (`delete-cv-file`), y borrar un objeto que ya no está es un acierto.
  Así el binario no sobrevive al documento ni depende de que la petición HTTP llegue viva hasta MinIO.
- **Ver lo que leímos** (`GET /api/cv/:id/text-preview`): `{ status, text, chars, complete }`, con los primeros ~2.000
  caracteres del texto extraído, solo a su dueña, con el mismo `404` que el resto y su `429` con espera. Es la única
  forma de descubrir que un PDF a dos columnas se leyó entrelazado, que hoy nadie detecta porque `textChars` parece un
  éxito. **Los bytes del archivo no salen**: este change **no** incluye descarga (ver Fuera de alcance).
- **Límites por persona** con el contador de plataforma (`FIXED_WINDOW_COUNTER`), en ventana de 15 min y con
  `429 too_many_attempts` y `Retry-After`: 10 subidas, 60 vistas previas y **30 rechazos** (`cv:reject:<userId>`, que se
  cuenta solo cuando un archivo se rechaza en la puerta, de modo que una ráfaga de basura tenga techo sin cobrarle nada
  a quien se equivoca una vez). Los tres fallan **abiertos**.
- **Nada del CV en los logs**: ni el texto, ni el nombre del archivo, ni sus bytes. Las líneas llevan `cvId`, estado,
  motivo y tamaño. La redacción de pino tapa **rutas declaradas**, no adivina: por eso lo que garantiza que no se
  escapen es que nada de eso se escriba, con un test que captura los registros de una subida y lo comprueba.
- **SPA**: `/mi-cv`, con sesión y carga diferida, en la barra de navegación. Subir con barra de progreso, listar los CV
  guardados **identificados por su nombre y su fecha**, "Usar este" —bajo el nombre del marcado se lee "Este es el CV
  que compararemos con las vacantes"—, "Ver lo que leímos", "Eliminar" con confirmación, sondeo mientras alguno esté
  `pending` y una línea honesta con lo que el producto hace hoy: **"Tu CV solo lo ves tú y hoy no lo lee ninguna IA. No
  saldrá de LinkVault sin tu autorización."** —sin nombrar ninguna pantalla que todavía no existe—. Cada estado termina
  en una acción, y un CV marcado que no se pudo leer avisa de la consecuencia y ofrece la salida. Textos en ES y EN.

## Capabilities

### New Capabilities

- `cv/documents`: la subida y su validación real, los límites de tamaño y de tipo, las versiones, `isDefault`, el
  listado, la vista previa del texto, el borrado con su evento, los límites por persona y qué ve y qué no ve cada
  endpoint.
- `cv/extraction`: el consumidor de `extract-cv`, su idempotencia, los estados y motivos de fallo, el tope y la
  normalización del texto, el plazo de la extracción, el consumidor de `delete-cv-file` y la prohibición de IA.
- `web/cv`: la pantalla `/mi-cv`, la subida con progreso, el listado con estados y sus acciones, marcar por defecto con
  su consecuencia, ver lo que leímos, eliminar, la promesa de privacidad y los textos ES/EN.

### Modified Capabilities

- `platform/outbox`: cambia "Publicación por el relay" —el relay **enruta cada tipo de evento a su cola** (`enrich-link`,
  `extract-cv`, `delete-cv-file`) con el `jobId` determinista de su contrato, y un tipo desconocido no envenena la
  cola— y "El trabajo encolado no se pierde", que deja de hablar solo de links.
- `platform/local-environment`: cambian "Infraestructura con un comando" (MinIO arranca con **sus dos buckets**,
  `snapshots` y `cv`, creados de forma idempotente; el de CVs **sin** regla de expiración y sin política pública) y
  "Configuración por entorno documentada" (las `S3_*`, incluida `S3_BUCKET`, pasan a validarse en `api` y `worker`).
- `platform/workspace`: cambia "Aislamiento de la capa de dominio", que añade `pdf-parse` y `mammoth` a la lista cerrada
  de paquetes que ninguna carpeta `domain/` puede importar.

## Impact

- **Código**:
  - `apps/api/src/modules/cv/` completo (dominio, casos de uso, repositorio Mongo, almacén S3, controlador) y
    `create-app.ts` (registro de `@fastify/multipart` con sus límites);
  - `apps/api/src/infrastructure/outbox/` (enrutado por tipo de evento, registro de las dos colas nuevas y **subida del
    puerto `OUTBOX` y de `TransactionSession`** desde `links/application/ports/` a plataforma: unos **21 archivos de
    `links` y 3 de plataforma**, cuya lista exacta la da el `typecheck`);
  - `apps/api/src/presentation/http/api-error.ts` y el filtro global (cuatro códigos nuevos);
  - `apps/worker/src/modules/cv/` completo (extractores, repositorio, consumidores) y su configuración;
  - `libs/shared/src/cv/`, `libs/shared/src/schemas/cv.schema.ts` y `libs/shared/src/events/cv-*.event.ts`;
  - SPA: `core/cv/`, `features/cv/`, `app.routes.ts`, la barra de navegación y `messages.*.xlf`.
- **API**: nuevos `POST /api/cv`, `GET /api/cv`, `GET /api/cv/:id/text-preview`, `PUT /api/cv/:id/default` y
  `DELETE /api/cv/:id`. Ninguna ruta existente cambia, y **ninguna devuelve los bytes del archivo**.
- **Datos**: colección nueva `cv_documents` con tres índices —único `(userId, version)`, único **parcial**
  `(userId, isDefault)` sobre `isDefault: true` y el del listado `(userId, uploadedAt)`—. Sin backfill: no hay ningún
  documento previo.
- **Infraestructura**: bucket `cv` en el `docker-compose` (privado, sin expiración) y las `S3_*` validadas por las dos
  apps. Dependencias nuevas: `@fastify/multipart` (api), `pdf-parse` y `mammoth` (worker).
- **Configuración**: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` y `S3_BUCKET` obligatorias en `api`
  (hoy solo las lee el worker, y `S3_BUCKET` no la lee nadie), más `CV_EXTRACTION_TIMEOUT_MS` y
  `CV_EXTRACT_CONCURRENCY` en `worker`.
- **ADRs**: implementa ADR-006 (MinIO para los CVs) y ADR-009 (outbox); respeta ADR-018 §13 (la redacción de dirección y
  documento de identidad sigue diferida a `cv-match-suggestions`, que es el primer change que manda un CV fuera) y
  ADR-020 §5 (el contador de plataforma y su política de fallo). Las decisiones no triviales se registran en **ADR-028**.
- **Manifiesto** (`openspec-changes.yaml`): `cv-upload-extract` pasa a `adrs: [006, 009, 028]`; `deploy-prod` hereda
  borrar el CV y su objeto al borrar la cuenta, el aviso de privacidad que diga cuánto se guarda un CV, la recogida de
  objetos huérfanos y, **desviación explícita de `docs/design.md` §8**, el **cifrado en reposo** del bucket de CV y su
  **política de retención**.
- **Fuera de alcance**:
  - cualquier llamada a IA sobre el CV (es `cv-match-suggestions`, orden 12) y el `fitScore`;
  - **descargar el archivo original** (`GET /api/cv/:id/file`) y cualquier botón de "Descargar": es la mayor superficie
    de salida de datos del change y la persona acaba de subir ese archivo desde su dispositivo. Candidato para cuando
    alguien lo pida;
  - editar el texto extraído o verlo entero (la vista previa son los primeros ~2.000 caracteres); OCR de PDFs escaneados;
  - compartir un CV con un grupo o con cualquier tercero;
  - caducidad automática de los CVs y borrado de cuenta (`deploy-prod`);
  - aviso en vivo por SSE del final de la extracción (el SPA sondea);
  - antivirus sobre lo subido, `worker_threads` para el parseo y almacenamiento cifrado por objeto;
  - `CvFacade` para otros módulos: todavía no hay ningún consumidor, y lo creará quien lo necesite.
