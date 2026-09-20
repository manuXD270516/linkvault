> **Condición previa:** rama `change/cv-upload-extract` rebasada sobre `main` antes de tocar `auth.schema.ts`,
> `api-config.schema.ts`, `worker-config.schema.ts`, `.env.example`, `docker-compose.yml`, `package.json` o
> `messages.*.xlf` (tarea 1.1). **Contrato primero** (grupo 1). Después, la configuración y las colas (grupos 2 y 3) van
> **antes** que el resto: sin el bucket, sin las variables y sin el enrutado del relay, las pruebas de los grupos 4 a 7
> estarían probando otra cosa. El backend de `api` (4 a 6) y el del worker (7) pueden ir en paralelo con el frontend (8)
> en cuanto exista el contrato.
>
> **Regla de este change, en todas las tareas:** ninguna línea de registro, ningún nombre de objeto y ninguna respuesta
> puede llevar el texto del CV ni el nombre del archivo.

## 1. Contratos en `libs/shared`

- [ ] 1.1 [infra] Rebasar `change/cv-upload-extract` sobre `main` y comprobarlo con `git merge-base --is-ancestor main HEAD` antes de tocar `auth.schema.ts`, `api-config.schema.ts`, `worker-config.schema.ts`, `.env.example`, `docker-compose.yml`, `package.json` o `messages.*.xlf`.
- [ ] 1.2 [backend] `libs/shared/src/cv/cv-file.ts`: `CV_MAX_FILE_BYTES = 5 * 1024 * 1024`, `CV_FILE_TYPES` (`pdf` y `docx` con su mime, su extensión y su firma), `sniffCvFileType(bytes)` y `resolveCvFileType({ contentType, fileName, bytes })` que exige que las tres coincidan; verificar con una tabla (PDF bueno, DOCX bueno, `MZ` con nombre `.pdf`, PDF con nombre `.docx`, `.odt`, sin `Content-Type`, sin extensión, archivo de 3 bytes y archivo vacío).
- [ ] 1.3 [backend] `libs/shared/src/cv/cv-file-name.ts`: `safeCvFileName(name, type)` (último segmento tras `/` y `\`, sin caracteres de control ni U+202A–U+202E ni U+2066–U+2069, 120 code points conservando extensión, respaldo `cv.pdf`/`cv.docx`); verificar con una tabla (`../../etc/passwd`, nombre con `‮`, nombre de 300 caracteres, `   .pdf`, nombre vacío y nombre normal).
- [ ] 1.4 [backend] `libs/shared/src/cv/cv-file-key.ts`: `cvFileKey(userId, cvId)` → `<userId>/<cvId>`; verificar con tests de que la clave no contiene el nombre del archivo ni su extensión y de que es estable para los mismos identificadores.
- [ ] 1.5 [backend] `libs/shared/src/cv/cv-text.ts`: `CV_TEXT_MAX_CHARS = 200_000`, `CV_MIN_TEXT_CHARS = 100` y `prepareCvText(raw)` → `{ text, chars, truncated }` con la normalización de D8; verificar con una tabla (`\r\n`, caracteres de control, líneas en blanco repetidas, texto de 200.001 caracteres, texto de 99 caracteres y cadena vacía).
- [ ] 1.6 [backend] `libs/shared/src/schemas/cv.schema.ts`: `cvExtractionStatusSchema`, `cvExtractionFailureReasonSchema`, `cvExtractionSchema`, `cvDocumentSchema` (`strictObject` con `id`, `fileName`, `fileType`, `sizeBytes`, `version`, `isDefault`, `uploadedAt`, `extraction`), `cvListResponseSchema` (`{ items }`) y `MAX_CV_DOCUMENTS = 5`; verificar con tests de que rechaza `extractedText`, `fileKey` y `userId`, y de que un `failed` sin motivo no valida.
- [ ] 1.7 [backend] `auth.schema.ts`: añadir a `apiErrorCodeSchema` los códigos `cv_not_found`, `unsupported_file_type`, `file_too_large` y `too_many_cvs`, cada uno con su comentario; verificar con los tests existentes del schema y `pnpm nx run-many -t typecheck -p shared api web`.
- [ ] 1.8 [backend] `libs/shared/src/events/cv-uploaded.event.ts`: `EXTRACT_CV_QUEUE`, `CV_UPLOADED_EVENT_TYPE = 'CvUploaded.v1'`, `cvUploadedPayloadSchema` (`{ cvId, userId }`, estricto), `cvUploadedEvent()` y `cvUploadedJobId()`; verificar con tests de que el payload rechaza cualquier campo de más (nombre, tipo, tamaño) y de que el `jobId` es determinista.
- [ ] 1.9 [backend] `libs/shared/src/events/cv-deleted.event.ts`: `DELETE_CV_FILE_QUEUE`, `CV_DELETED_EVENT_TYPE = 'CvDeleted.v1'`, su payload estricto, su constructor y su `jobId`; verificar con los mismos tests que 1.8.
- [ ] 1.10 [backend] Exportar todo lo anterior desde `libs/shared/src/index.ts`; verificar con `pnpm nx run-many -t lint,typecheck,test -p shared` y `pnpm nx run-many -t typecheck -p api worker web`.

## 2. Configuración e infraestructura local

- [ ] 2.1 [infra] `docker-compose.yml`: el healthcheck de MinIO crea también el bucket de CV (`mc mb --ignore-existing`), **sin** regla de expiración y sin política anónima, y sigue siendo idempotente; verificar levantando dos veces con `--wait` y comprobando `mc ls` y `mc anonymous get`.
- [ ] 2.2 [infra] Tras 1.1, `.env.example`: `S3_BUCKET` deja de decir "no la lee nadie", y se añaden `CV_EXTRACTION_TIMEOUT_MS=30000` y `CV_EXTRACT_CONCURRENCY=1` con sus comentarios; verificar con "Valores por defecto seguros" y "La lectura del CV se configura en el worker".
- [ ] 2.3 [infra] `api-config.schema.ts`: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` y `S3_BUCKET` obligatorias, con el comentario de qué las usa; verificar con "Variable obligatoria ausente" (sin `S3_BUCKET`) y "El ejemplo de configuración es suficiente".
- [ ] 2.4 [infra] `worker-config.schema.ts`: `S3_BUCKET` obligatoria, `CV_EXTRACTION_TIMEOUT_MS` (1.000–120.000) y `CV_EXTRACT_CONCURRENCY` (1–4); verificar con los tests de configuración del worker, incluido uno de valor fuera de rango que nombra la variable.
- [ ] 2.5 [infra] Dependencias: `@fastify/multipart` (api), `pdf-parse` y `mammoth` con sus tipos (worker); verificar con `pnpm install`, `pnpm nx run-many -t build -p api worker` y un import de humo de cada una desde su app.

## 3. El relay aprende a enrutar (outbox)

- [ ] 3.1 [backend] `apps/api/src/infrastructure/outbox/outbox-routes.ts`: tabla `type → { schema, queue, jobId }` con los tres tipos (`LinkCreated.v1`, `CvUploaded.v1`, `CvDeleted.v1`), todos tomados del contrato de `libs/shared`; verificar con un test de que cada entrada nombra una cola distinta y de que la tabla y los tipos del contrato no se separan.
- [ ] 3.2 [backend] `BullmqOutboxPublisher` publica según la tabla de 3.1, validando el payload con el schema de su tipo; verificar con unitarios de "cada evento a su cola", "tipo desconocido" (lanza, no encola), "payload que no valida" (lanza, no encola) y con los tests existentes de `LinkCreated.v1` en verde.
- [ ] 3.3 [backend] `OutboxRelayModule` registra las colas `extract-cv` y `delete-cv-file` con sus `DefaultJobOptions` (3 intentos, espera exponencial desde 5 s, retención de D6 de job-links) y su listener de `error`; verificar con `outbox-relay.module.spec.ts` ampliado y con el caso `OUTBOX_RELAY_ENABLED=false` (ninguna cola creada).

## 4. Dominio y persistencia de `cv` en `api`

- [ ] 4.1 [backend] `modules/cv/domain/cv-document.ts`: la entidad, `nextVersion(versions)`, `promotedAfterRemoval(remaining)` (el más reciente) y las invariantes de `isDefault`; verificar con unitarios de las tres funciones y con el lint de capas.
- [ ] 4.2 [backend] `modules/cv/domain/errors.ts` (`CvError` con `code`: `CvNotFound`, `UnsupportedCvFile`, `CvFileTooLarge`, `TooManyCvDocuments`, `TooManyCvAttempts` con `retryAfterSeconds`) y `domain/limits.ts` (`MAX_CV_DOCUMENTS`, `CV_UPLOADS_PER_USER = 10`, `CV_DOWNLOADS_PER_USER = 30`, `CV_LIMIT_WINDOW_MS = 15 min`); verificar con unitarios de los códigos y el lint de dominio.
- [ ] 4.3 [backend] `modules/cv/infrastructure/cv.schemas.ts`: `CvDocument` de Mongoose con los tres índices de D12 y las constantes `CV_VERSION_KEY` y `CV_DEFAULT_KEY`; verificar con el test tabular de schemas (nombres, tipos, índices y que `extractedText` no es obligatorio).
- [ ] 4.4 [backend] Puertos de `application/ports/`: `CV_REPOSITORY`, `CV_FILE_STORE` (`put`, `get`), `CV_CLOCK`, `CV_LIMITER` y `CV_OUTBOX` (token propio del módulo, como `LINK_LIMITER`), con sus dobles en `application/testing/`; verificar con el test de los dobles y con el lint de módulos.
- [ ] 4.5 [backend] `MongoCvRepository`: `nextId()` e `insertAsDefault(...)` dentro de una transacción —recuento, `version = max + 1`, apagado del anterior e inserción—, con reintento de la transacción hasta 3 veces ante `CV_VERSION_KEY` y `500` ante `CV_DEFAULT_KEY`; verificar con integración de primera subida, segunda subida, carrera de dos subidas (versiones 2 y 3, sin error) y hueco tras borrado (la siguiente es la 4).
- [ ] 4.6 [backend] `MongoCvRepository`: `listByUser`, `findOwned`, `setDefault` y `remove` (con promoción del más reciente y `append` del evento en la misma transacción), **proyectando fuera `extractedText`** en todas las lecturas salvo la del futuro consumidor; verificar con integración de cada operación, de la carrera de dos marcados (queda uno) y de que la lectura no trae el campo del texto.
- [ ] 4.7 [backend] `S3CvFileStore` sobre `@aws-sdk/client-s3` con `forcePathStyle`, con su `CvFileUploader` inyectable como en `S3SnapshotStore`, y registro de solo `error.name`; verificar con unitarios sobre el doble (clave usada, `ContentType`, error que no filtra la clave) y un test contra el MinIO del compose marcado para el entorno local.
- [ ] 4.8 [backend] `CounterCvLimiter` sobre `FIXED_WINDOW_COUNTER` con las dos claves de D5, fallo **abierto** y `refund`; verificar con unitarios de ventana agotada, contador caído (permite), independencia de las dos claves y devolución del intento.

## 5. Casos de uso de `cv` en `api`

- [ ] 5.1 [backend] `UploadCv` en el orden de D7 (contador → validación → recuento → identificador y subida → transacción con el evento), devolviendo el documento; verificar con unitarios de "Primera subida", "Segunda subida se lleva la marca", "El evento se escribe con el documento" y "La transacción falla: no queda documento".
- [ ] 5.2 [backend] `UploadCv`: tope de 5 (`TooManyCvDocuments`), archivo no admitido (`UnsupportedCvFile`), archivo demasiado grande (`CvFileTooLarge`) y devolución del intento al contador en los tres casos; verificar con unitarios de cada rama y del `refund`.
- [ ] 5.3 [backend] `ListMyCvs`: orden de más reciente a más antiguo y mapeo por **lista explícita de campos** (nunca `...document`); verificar con unitarios de tres versiones, lista vacía y "el texto no viaja".
- [ ] 5.4 [backend] `SetDefaultCv`: idempotente, `CvNotFound` para lo ajeno o inexistente, devuelve la lista actualizada; verificar con unitarios de "Volver a la anterior", "Marcar el que ya lo es" y "El CV de otra persona".
- [ ] 5.5 [backend] `DeleteCv`: borra, promueve el más reciente si hacía falta, escribe `CvDeleted.v1` en la misma transacción y devuelve la lista; verificar con unitarios de "Borrar el marcado", "Borrar el último", "Borrar dos veces" y "El evento queda pendiente".
- [ ] 5.6 [backend] `DownloadCv`: comprueba propiedad, pide el objeto al almacén y devuelve bytes, tipo y nombre saneado; verificar con unitarios de "Descarga correcta", "CV de otra persona" y "El objeto no está" (`500` con registro sin clave).

## 6. HTTP en `api`

- [ ] 6.1 [backend] `api-error.ts`: estados y mensajes de los cuatro códigos nuevos (`cv_not_found` 404, `unsupported_file_type` 415, `file_too_large` 413, `too_many_cvs` 409) y rama del filtro para `CvError` y `TooManyCvAttempts` (con `Retry-After`); verificar con filas nuevas en `api-exception.filter.spec.ts` y con el test de que todo código del enum tiene estado y mensaje.
- [ ] 6.2 [backend] `create-app.ts`: registrar `@fastify/multipart` con `limits` (`fileSize`, `files: 1`, `fields: 0`, `parts: 2`); verificar con integración de que la app arranca, de que `POST /api/links` con multipart responde `400 validation_error` sin guardar nada y de que las rutas JSON existentes siguen igual.
- [ ] 6.3 [backend] `CvController`: `POST /api/cv` leyendo la parte `file`, resolviendo el tipo con `resolveCvFileType` y acumulando hasta el tope; verificar por HTTP con "Primera subida", "Petición sin archivo", "Dos archivos", "Ejecutable renombrado", "Extensión que no corresponde", "Archivo de 6 MB" (sin objeto en el bucket) y "Archivo justo en el límite".
- [ ] 6.4 [backend] `GET /api/cv` y `PUT /api/cv/:id/default`; verificar por HTTP con "Lista con tres versiones", "Lista vacía", "La lista es solo mía", "Volver a la anterior", "Marcar el que ya lo es" e "Identificador mal formado".
- [ ] 6.5 [backend] `DELETE /api/cv/:id`; verificar por HTTP con "Eliminar" (lista devuelta y evento pendiente en `outbox_events`), "Borrar dos veces" y "Borrar el marcado" (promoción).
- [ ] 6.6 [backend] `GET /api/cv/:id/file` con `Content-Disposition: attachment` (con `filename*`), `Cache-Control: private, no-store`, `nosniff` y `Referrer-Policy`; verificar por HTTP con "Ana descarga su CV" (mismos bytes), "Sin sesión no se descarga" y un test de que la cabecera nunca dice `inline`.
- [ ] 6.7 [backend] `CvModule` con su cableado por tokens y su alta en `AppModule`; verificar con `dependency-injection.spec.ts` ampliado y con "Nada de CV en lo público" (inventario de rutas sin access token).
- [ ] 6.8 [backend] Integración de privacidad: un CV con texto extraído y un nombre reconocible; comprobar que ni el listado, ni la subida, ni el marcado devuelven el texto, `fileKey` o `userId`, y que las cuatro rutas responden `404 cv_not_found` con el mismo cuerpo al CV de otra persona.
- [ ] 6.9 [backend] Integración de registros: subir un CV llamado `CV_Ana_Perez.pdf` con el registro capturado a nivel `debug` y comprobar que ninguna línea contiene ese nombre, ni texto del CV, ni la clave del objeto (capturador de `logger-redaction.spec.ts`).

## 7. Worker: extracción y borrado

- [ ] 7.1 [backend] `apps/worker/src/modules/cv/domain/`: `extraction-outcome.ts` (de texto a `extracted` / `no_text`) y la normalización apoyada en `prepareCvText`; verificar con unitarios de texto normal, texto corto, texto vacío y texto larguísimo, más el lint de capas.
- [ ] 7.2 [backend] Puertos del módulo (`CV_REPOSITORY`, `CV_FILE_READER`, `CV_TEXT_EXTRACTORS`, `CLOCK`) con sus dobles; verificar con el test de los dobles y el lint de módulos.
- [ ] 7.3 [backend] Fixtures de extracción generados por un script, **sin ningún dato personal real**: PDF con texto, PDF sin capa de texto, PDF corrupto, PDF cifrado, DOCX con texto y un ZIP que no es DOCX; verificar con un test que abre los seis y comprueba su firma.
- [ ] 7.4 [backend] `PdfTextExtractor` sobre `pdf-parse` importando **el módulo interno** (`pdf-parse/lib/pdf-parse.js`, ver D9) y traduciendo cualquier excepción a `unreadable_file`; verificar con los fixtures de PDF (con texto, sin texto, corrupto y cifrado).
- [ ] 7.5 [backend] `DocxTextExtractor` sobre `mammoth` con la misma traducción de errores; verificar con los fixtures de DOCX y con el ZIP que no es DOCX (`unreadable_file`).
- [ ] 7.6 [backend] `S3CvFileReader` y `MongoCvRepository` del worker (lectura por id y **escritura condicionada a `extraction.status: 'pending'`**); verificar con integración de escritura ganadora, escritura perdedora (no modifica nada) y CV inexistente.
- [ ] 7.7 [backend] `ExtractCvUseCase` con los tres cortes de idempotencia, el plazo de `CV_EXTRACTION_TIMEOUT_MS` y los cuatro desenlaces; verificar con unitarios de "PDF con texto", "PDF escaneado", "Archivo corrupto", "Plazo vencido", "CV borrado antes de leerse", "Ya extraído" y "Carrera perdida".
- [ ] 7.8 [backend] `ExtractCvConsumer`: cola propia, `concurrency` y `lockDuration = plazo + 15 s` desde la configuración, y `onJobFailed` que deja el CV en `failed` con `internal_error` al agotar los intentos; verificar con unitarios con un `Worker` doble (datos ilegibles, fallo transitorio, reintentos agotados).
- [ ] 7.9 [backend] `DeleteCvFileUseCase` y `DeleteCvFileConsumer` (borrar el objeto, idempotente, fallo del almacén → reintento); verificar con unitarios de las tres ramas y una integración contra el MinIO del compose que borra y repite.
- [ ] 7.10 [backend] `CvModule` del worker y su alta en `AppModule`; verificar con `dependency-injection.spec.ts` del worker y con un test de imports de que ni `apps/api/src/modules/cv/**` ni `apps/worker/src/modules/cv/**` importan `@linkvault/ai`.

## 8. Frontend

- [ ] 8.1 [frontend] `core/cv/cv.api.ts`: `list()`, `upload(file)` con `reportProgress` y `observe: 'events'`, `setDefault(id)`, `remove(id)` y `download(id)`, solo con tipos de `@linkvault/shared`; verificar con `HttpTestingController` (multipart enviado, eventos de progreso, `200`, `413`, `415`, `409` y `429`).
- [ ] 8.2 [frontend] `core/cv/cv.store.ts` con `@ngrx/signals`: lista, estado de carga, subida en curso con su porcentaje, y sondeo cada 2 s mientras alguna versión esté `pending`, con tope de 60 s y parada al destruirse; verificar con TestBed y reloj falso ("La lectura termina", "El sondeo se detiene", "Se acabó la paciencia", "Salir de la pantalla").
- [ ] 8.3 [frontend] Ruta `/mi-cv` perezosa con `authGuard` en `app.routes.ts`, entrada "Mi CV" en la barra de navegación y estado vacío con su texto; verificar con "Entrar sin CV", "Ruta con sesión" y el test de rutas existente.
- [ ] 8.4 [frontend] Componente de subida: elegir o soltar el archivo, `accept=".pdf,.docx"`, comprobación local de extensión y tamaño, barra de progreso y bloqueo con `aria-busy`; verificar con "Subida con progreso", "Archivo que no admitimos", "Archivo demasiado grande" y "Doble pulsación".
- [ ] 8.5 [frontend] Tarjeta de versión con número, nombre, tamaño, fecha, marca de por defecto y los cinco textos de estado de D8; verificar con "Tres versiones" y "Un CV que no se pudo leer".
- [ ] 8.6 [frontend] Acción "Usar este" sin confirmación, con vuelta atrás si la API falla y ausente en el que ya lo es; verificar con "Cambiar de versión", "La API falla al marcar" y "No se ofrece en el que ya lo es".
- [ ] 8.7 [frontend] Acción "Descargar" con el nombre del archivo; verificar con "Descargar" (la petición lleva el token y el nombre sale de la respuesta).
- [ ] 8.8 [frontend] Acción "Eliminar" con confirmación que nombra el archivo, avisa de que no se puede recuperar y añade el aviso de la promoción cuando es el de por defecto; verificar con "Eliminar una versión", "Eliminar la marcada" y "Cancelar el borrado".
- [ ] 8.9 [frontend] Mensajes de error de la subida (`413`, `415`, `409 too_many_cvs`, `429` con espera y `500`) y de la carga de la lista con "Reintentar"; verificar con "La API rechaza lo que el SPA dejó pasar", "Tope de versiones", "Límite alcanzado" y "La lista no carga".
- [ ] 8.10 [frontend] Tras 1.1, marcar todos los textos de esta pantalla y traducirlos en `messages.en.xlf`; verificar con "Traducciones completas".

## 9. Cierre

- [ ] 9.1 [frontend] `apps/web-e2e/src/cv.spec.ts` con `resetRegisterLimit()`: Ana sube un PDF de prueba generado por el propio spec, ve "Estamos leyendo tu CV…" y después "Listo", con el worker en marcha; verificar con `pnpm nx e2e web-e2e`. **No hace falta franja nueva en `support/job-ids.ts`**: este spec no guarda ninguna oferta; dejarlo anotado en el archivo del spec.
- [ ] 9.2 [frontend] Ampliar `cv.spec.ts`: Ana sube una segunda versión, comprueba que la marca de por defecto se movió, vuelve a la primera con "Usar este" y elimina la segunda con su confirmación; verificar con `pnpm nx e2e web-e2e`.
- [ ] 9.3 [frontend] Ampliar `cv.spec.ts`: Ana sube un archivo que no es PDF ni DOCX y ve el mensaje sin que la lista cambie; verificar con `pnpm nx e2e web-e2e`.
- [ ] 9.4 [infra] `openspec-changes.yaml`: `cv-upload-extract` con `adrs: [006, 009, 028]` y el resumen de lo decidido; en el `scope` de `deploy-prod`, borrar CV y objetos al borrar la cuenta, el aviso de privacidad sobre el CV y la recogida de objetos huérfanos.
- [ ] 9.5 [infra] `docs/adr/ADR-028.md` con lo no trivial: qué se guarda y dónde, el tipo comprobado por bytes y su residuo, el tope de 5 con `409`, la marca por defecto y su promoción al borrar, el objeto antes de la transacción, el borrado del binario por outbox, la descarga por la API en vez de URL prefirmada, el enrutado del relay por tipo de evento y los límites que fallan abiertos; verificar que el proposal lo referencia.
- [ ] 9.6 [infra] `README.md`: qué se guarda de un CV, dónde y quién lo ve. `docs/RUNBOOK.md`, apartado nuevo "Operar los CV": los dos buckets y cómo comprobar que el de CV no es público, las colas `extract-cv` y `delete-cv-file` y cómo vaciarlas, los dos contadores y cómo liberarlos, el procedimiento **en dos pasos con revisión humana** para recoger objetos huérfanos, y cómo borrar a mano todo lo de una persona (`mc rm --recursive <bucket>/<userId>/` más el `deleteMany` de `cv_documents`). Verificar leyendo que las rutas y comandos citados existen.
- [ ] 9.7 [infra] Repasar que las specs y el diseño coinciden con lo implementado (estados, motivos, límites, códigos de error y textos) y corregir lo que se haya movido; verificar con `openspec validate --all`.
- [ ] 9.8 [infra] `pnpm nx affected -t lint,typecheck,test --base=main` y `openspec validate --all` en verde, más una pasada manual de la pantalla `/mi-cv` con la infraestructura local; verificar con la salida guardada en un archivo.
