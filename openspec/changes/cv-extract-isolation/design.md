## Context

La lectura del CV la hace el worker en la cola `extract-cv` (ADR-028 §7, `cv/extraction`). Hoy:

| Pieza | Dónde | Qué hace |
|---|---|---|
| `ExtractCvUseCase.execute` | `apps/worker/src/modules/cv/application/extract-cv.usecase.ts` | cuatro cortes de idempotencia, lectura del objeto, extracción con plazo, desenlace por `outcomeOfExtractedText` |
| `withDeadline` | mismo fichero, líneas 142-158 | `Promise.race` contra un `setTimeout`: deja de esperar; **no detiene** |
| `PdfTextExtractor` | `infrastructure/extractors/pdf-text.extractor.ts` | `pdf-parse/lib/pdf-parse.js` → pdf.js **1.10.100** (2017), `disableWorker = true`, en el hilo principal |
| `DocxTextExtractor` | `infrastructure/extractors/docx-text.extractor.ts` | `mammoth.extractRawText` → `jszip` (inflado sin tope) + `@xmldom/xmldom` (síncrono), en el hilo principal |
| `ExtractCvConsumer` | `infrastructure/queue/extract-cv.consumer.ts` | `concurrency` = `CV_EXTRACT_CONCURRENCY` (1), `lockDuration` = plazo + 15 s; oyente de `failed` que solo actúa si `attemptsMade >= attempts` |

Consecuencias observables de un archivo patológico (auditoría de `critic`, 2026-10-28):

1. **Bloqueo total del proceso** mientras pdf.js o xmldom ejecutan trabajo síncrono: no corre el enriquecimiento, ni
   las notificaciones, ni el encaje, ni `/health`, ni la renovación del bloqueo de BullMQ.
2. **Reentrega del mismo archivo**: sin renovación, el bloqueo (45 s) vence y BullMQ da el job por `stalled`; con
   `maxStalledCount` por defecto (1) lo reentrega una vez y lo vuelve a abrir. A la segunda, lo falla con «job stalled
   more than allowable limit», y el oyente de `failed` **no** marca el CV porque `attemptsMade` no llegó a `attempts`:
   el CV puede quedar en `pending` para siempre (hueco que este change cierra, D8).
3. **Trabajo zombi**: si el plazo vence sin bloqueo total (parser lento pero asíncrono a trozos), el job termina, el
   parser sigue consumiendo CPU y memoria, y la concurrencia deja entrar al siguiente.
4. **Memoria fuera de V8**: un ZIP o un stream `Flate` que infla a gigabytes crece en `ArrayBuffer`, que el heap de
   V8 no cuenta.
5. **Nadie reinicia**: `restart: unless-stopped` no actúa sobre un proceso vivo y colgado, y Docker no reinicia por
   `unhealthy`.

Restricciones que este diseño respeta:

- El puerto `CvTextExtractor.extract(bytes): Promise<ExtractionAttempt>` y sus dos desenlaces (`text`,
  `unreadable_file`) **no cambian** (encargo del change). Tampoco `CvRepository`.
- Lo que ve la persona son los estados existentes de `cv/extraction`.
- Nada del CV en registros ni métricas (`cv/documents` «Nada del CV en los registros», `platform/observability`).
- Fila 35: no se tocan compose, workflows, `.env.example` ni requirements de `platform/*` (Q1).
- El worker se empaqueta con webpack (`apps/worker/webpack.config.js`, `compiler: 'tsc'`, `module: commonjs`) y corre en
  `node:22.23.2-alpine`, `linux/arm64` en el destino (ADR-051 §3, ADR-052).

## Goals / Non-Goals

**Goals**

- Que ningún archivo subido pueda bloquear el event loop del worker ni hacer que se reentregue por `stalled`.
- Que el plazo **detenga** el trabajo, y que un archivo que agota plazo, heap o topes termine en `unreadable_file` sin
  reintentos.
- Que el parser de PDF sea una versión mantenida, verificada en `arm64` y en la imagen publicada.
- Que la memoria que puede consumir una lectura esté acotada también fuera del heap.
- Medir lo que pasa (métricas y una línea de registro por hilo terminado) sin una palabra del CV.

**Non-Goals**

- Cambiar estados, motivos o textos de `/mi-cv` (Q2).
- Aislar a nivel de contenedor (`mem_limit`, servicio aparte) (Q5, alternativas de D1).
- OCR, antivirus o re-extracción de CV ya leídos.

## Decisions

### D1. La lectura corre en un `worker_thread` nuevo por CV

El adaptador de infraestructura arranca un `Worker` de `node:worker_threads` por cada lectura, le **transfiere** los
bytes (copiados antes a un `ArrayBuffer` propio, lo que además conserva la lección de `withOwnBuffer`), espera un
mensaje con el texto y lo termina siempre al acabar.

- **Hilo nuevo por CV, sin pool.** pdf.js guarda cachés globales (fuentes, CMaps, objetos) y un hilo reutilizado
  arrastraría estado de una persona a otra; el coste de arrancar un hilo y cargar las bibliotecas (cientos de
  milisegundos, medido en el spike 1.1) es irrelevante para un CV que se lee una vez.
- **`resourceLimits`**: `maxOldGenerationSizeMb: 256`, `maxYoungGenerationSizeMb: 32`, `stackSizeMb: 4`. Superarlos
  termina el hilo con `ERR_WORKER_OUT_OF_MEMORY`; el proceso sigue vivo.
- **El hilo no hereda nada que no necesite** (D7).

**Alternativas descartadas**

- *Proceso hijo (`child_process.fork`) por CV.* Aislamiento más fuerte (otro espacio de memoria; el OOM killer elige al
  hijo) a cambio de ~40 MB de RSS y más arranque por lectura, y **sigue sin tope de memoria externa** salvo con
  `prlimit`/cgroups, que con V8 es frágil. Con el vigía de D5 el hilo cubre el mismo riesgo. Pasa a ser la palanca
  siguiente si algún día entra un parser con código nativo.
- *Pool de hilos (`piscina` o propio).* Estado compartido entre CV de personas distintas y una dependencia más para
  ahorrar milisegundos.
- *Servicio o contenedor de extracción aparte.* Lo más robusto (límite de memoria del contenedor, reinicio propio),
  pero añade un servicio al compose de 35b y 35c y una cola o RPC nueva: no cabe sin romper Q1 (3). Queda anotado en
  ADR-058 como la evolución si el volumen lo pide.
- *Seguir en el hilo principal con mejor plazo.* No existe un plazo que interrumpa código síncrono en el mismo hilo.

### D2. El plazo corta: `terminate()` dentro del adaptador, y una red exterior en el caso de uso

- El adaptador arma **un solo plazo**, `CV_EXTRACTION_TIMEOUT_MS`, desde que crea el hilo hasta que recibe el texto.
  Vencido, llama a `worker.terminate()` —que interrumpe la ejecución de JavaScript del hilo, también un bucle
  síncrono— y devuelve `unreadable_file`.
- `ExtractCvUseCase.withDeadline` **se queda** como red exterior con `timeoutMs + 2_000`
  (`CV_ISOLATION_GRACE_MS`): si un defecto del adaptador no devolviera nunca, el job sigue terminando. En el camino
  normal gana siempre el plazo del adaptador. `lockDuration` (plazo + 15 s) sigue cubriendo plazo + gracia.
- **Un plazo vencido es terminal y no se reintenta** (`cv/extraction` ya lo decía; ahora además es verdad que el trabajo
  se detiene). Es la regla de ADR-030 §6 llevada a la lectura: el número de veces que un archivo patológico se abre
  **no crece con las entregas del job** más allá de lo que acota D8.

*Alternativa descartada:* quitar el `Promise.race` del caso de uso. Ahorra un temporizador y deja el job colgado ante
cualquier defecto futuro del adaptador; el coste de mantenerlo es una línea.

### D3. PDF: pdf.js mantenido (`pdfjs-dist`, build `legacy`), versión exacta, confirmado por spike

**Recomendación:** `pdfjs-dist` de Mozilla (Apache-2.0), build `legacy/build/pdf.mjs` (la indicada para Node), fijado
a **versión exacta** (sin `^`), cargado solo dentro del hilo, con:

- `isEvalSupported: false` (cierra la clase de fallo de CVE-2024-4367, ejecución de código vía `FontMatrix` con `eval`
  activo; no consta que la extracción de texto de pdf.js 1.10 la alcance, pero esa versión está entre las afectadas y
  sin corrección posible);
- `disableFontFace: true`, `useSystemFonts: false`, `enableXfa: false`, `verbosity` en errores y **sin red** (los datos
  van en memoria; no se configura ninguna URL remota);
- `cMapUrl` apuntando a los CMaps del propio paquete, para no perder texto en fuentes CID (CV con caracteres no
  latinos);
- la unión de líneas que hacía `pdf-parse` (salto de línea cuando cambia la coordenada Y del elemento), para que el
  texto guardado conserve su forma (paridad, tarea 1.3);
- **tope de páginas** y de texto crudo (D5).

| Criterio | `pdfjs-dist` (recomendado) | `unpdf` (alternativa escrita) | `pdf-parse` 2.x | poppler `pdftotext` | `mupdf` (WASM) | `pdf-parse` 1.1.4 aislado |
|---|---|---|---|---|---|---|
| Mantenimiento | Mozilla, publicaciones frecuentes | UnJS; reempaqueta pdf.js con retraso | mantenido | distro | Artifex | **sin correcciones desde 2017** |
| `arm64` | JS puro | JS puro | arrastra `@napi-rs/canvas` (nativo) | binario de Alpine | WASM | JS puro |
| Tamaño | decenas de MB sin podar; su `@napi-rs/canvas` opcional hay que excluirlo (spike 1.2) | pequeño, sin dependencias | ~25 MB nativos (ADR-028 lo descartó) | ~10-20 MB con dependencias | ~10 MB | ya está |
| Licencia | Apache-2.0 | MIT | Apache-2.0 | GPL-2 (binario distribuido en una imagen pública de GHCR) | **AGPL-3.0** | MIT/Apache |
| Calidad | la de pdf.js actual | la misma que su pdf.js | la de pdf.js | buena, con `-layout` | buena | la de 2017 |
| Integración | ESM; desde un bundle `commonjs` puede exigir `import()` dinámico (riesgo R2) | ESM y CJS | ESM | proceso hijo; sin API | WASM | ya integrada |

- `mupdf`: descartado por AGPL en un proyecto MIT con imagen pública.
- `pdftotext`: descartado por traer código C que parsea entradas hostiles (memoria no segura), un binario GPL dentro de
  la imagen publicada y correcciones que dependen de reconstruir la imagen sobre Alpine.
- `pdf-parse` 2.x: descartado por la dependencia nativa, igual que en ADR-028.
- `pdf-parse` 1.1.4 dentro del hilo: **resuelve la disponibilidad, no la superficie**. Es la salida si el spike falla en
  las dos bibliotecas candidatas; en ese caso el change sigue (D1, D2, D4-D9 valen igual) y la sustitución vuelve al
  owner como pregunta nueva.

**Spike (tareas 1.1-1.4), con criterio de parada escrito:** `pdfjs-dist` se adopta si (a) carga y extrae dentro del
hilo **desde el bundle de webpack** y desde la imagen (`node dist/apps/worker/cv-extract-probe.js`); (b) el
incremento de la imagen del worker es ≤ 30 MB (Q3) con `@napi-rs/canvas` excluido; (c) las licencias de su árbol son
permisivas; (d) el texto normalizado de los fixtures generados coincide con el de `pdf-parse`. Si falla (a) o (b) se
prueba `unpdf` con el mismo criterio. El resultado se escribe en este design (D3 · Estado) antes del grupo 3.

### D4. DOCX: `mammoth` se queda, detrás de un inflado con tope propio

`mammoth` 1.12 está mantenido; lo peligroso es lo que hace antes de leer el XML. Dentro del hilo, y antes de llamarlo:

1. Se lee el **directorio central** del ZIP (no las cabeceras locales) con un lector propio de ~100 líneas.
2. Se rechaza como `unreadable_file`: más de **2.000 entradas**, ZIP64, entradas cifradas, métodos distintos de
   `stored` (0) y `deflate` (8), nombres con `..` o absolutos, y desplazamientos fuera del archivo.
3. Cada entrada se infla con `zlib.inflateRawSync(datos, { maxOutputLength: presupuestoRestante })`. El presupuesto
   total es **64 MiB inflados**: se cuenta lo que **sale**, no lo que la cabecera declara, así que una cabecera que
   miente no sirve de nada. Agotarlo es `unreadable_file`.
4. Con las entradas ya infladas se compone un ZIP **sin compresión** (`stored`, como el de los fixtures de ADR-028) y
   se le da a `mammoth.extractRawText({ buffer })`. `jszip` ya no infla nada.
5. El XML se parsea dentro del hilo: una expansión de entidades o un documento enorme chocan con el heap acotado (D1)
   o con el plazo (D2), no con el proceso.

*Alternativas descartadas:* confiar en los tamaños declarados (mienten); escribir un extractor de DOCX propio sobre el
XML (más código propio parseando entradas hostiles, y peor texto que `mammoth`); sustituir `mammoth` (no hay motivo:
está mantenido).

### D5. Topes de contenido y vigía de memoria, como constantes del código

| Tope | Valor | Dónde | Al superarlo |
|---|---|---|---|
| Páginas de PDF leídas | 50 | hilo | se leen las 50 primeras y se sigue (un CV no tiene 50 páginas; no se falla por eso) |
| Texto crudo acumulado | 1.000.000 caracteres | hilo, PDF y DOCX | se deja de leer y se entrega lo acumulado; el dominio recorta a 200.000 y marca `truncated` como hoy |
| DOCX inflado | 64 MiB en total | hilo | `unreadable_file` |
| Entradas del DOCX | 2.000 | hilo | `unreadable_file` |
| Heap del hilo | 256 MB (+32 MB joven) | `resourceLimits` | el hilo muere → `unreadable_file` |
| Memoria residente del proceso | +512 MiB sobre la del arranque de la lectura | vigía en el hilo principal, cada 100 ms | `terminate()` → `unreadable_file` |
| Arranque del hilo hasta `ready` | 5 s | adaptador | fallo de infraestructura (D6) |

- El **vigía** existe porque `resourceLimits` solo acota el heap de V8: los `ArrayBuffer` y búferes que crea un stream
  `Flate` inflado o un ZIP no cuentan. Muestrea `process.memoryUsage.rss()` (barato) desde el hilo principal, que ahora
  está libre para hacerlo.
- **Con `CV_EXTRACT_CONCURRENCY` > 1 el vigía no puede atribuir la memoria a un hilo**: termina todas las lecturas en
  curso, y un CV inocente puede acabar en `unreadable_file` (riesgo R4, Q4). Con 1 —el valor por defecto y el del
  compose de producción— la atribución es exacta.
- **Constantes, no variables de entorno**: el contrato de configuración que vigila `compose-env-contract` no cambia, el
  compose de 35b/35c no se toca, y un tope de seguridad no es algo que se quiera poder aflojar por un `.env`. Viven en
  `apps/worker/src/modules/cv/infrastructure/isolation/extraction-limits.ts`, con un test que fija sus valores.
- El tope de páginas no marca `truncated`: el puerto no tiene por dónde decirlo y no se cambia. Se registra y se cuenta
  (D9).

### D6. Contenido o maquinaria: quién tiene la culpa decide si se reintenta

| Causa | Ejemplos | Desenlace del adaptador | Job |
|---|---|---|---|
| **Contenido** | plazo vencido, `ERR_WORKER_OUT_OF_MEMORY`, vigía, excepción del parser (corrupto, contraseña), topes de D4, el hilo sale con código ≠ 0 o muere tras `ready` | `{ kind: 'unreadable_file' }` | termina bien, **sin reintento**; CV en `failed`/`unreadable_file` |
| **Maquinaria** | el script del hilo no existe en la imagen (`ENOENT`), el hilo no llega a `ready` en 5 s, una biblioteca no carga (`boot_error`), mensaje que no cumple el protocolo | **lanza** `CvExtractionMachineryError` | se reintenta (3 intentos con espera creciente); agotados, `failed`/`internal_error` |

- Para separarlas, el hilo hace un **apretón de manos**: al arrancar carga sus bibliotecas y publica `ready` (o
  `boot_error` con solo el código del error). Solo tras `ready` recibe los bytes. Lo que pase antes de `ready` es
  nuestro; lo que pase después, del archivo.
- Así un despliegue roto (el bundle del hilo ausente) **no** deja todos los CV en «No pudimos abrir este archivo»: los
  deja en `pending` reintentando y, agotados, en «No pudimos leerlo ahora», que es la verdad. Y la sonda de D11 lo para
  antes de publicar.
- El puerto no cambia: `unreadable_file` sigue sin causa. La causa vive en las métricas y en el registro (D9).

### D7. El hilo no ve secretos ni habla por su cuenta

- `new Worker(script, { env: {}, argv: [], execArgv: [], stdout: true, stderr: true, resourceLimits, workerData: { format } })`.
  Sin `env: {}` el hilo recibiría una copia de `process.env` del worker: credenciales S3, `AI_VAULT_KEY`, claves de
  proveedores. Un parser comprometido no tiene por qué tenerlas.
- `stdout`/`stderr: true` hace que lo que el hilo escriba **no** llegue a la salida del proceso; el adaptador lo drena y
  lo descarta. pdf.js escribe avisos por consola, y un aviso puede llevar trozos del documento.
- Ningún mensaje de error del hilo se registra: solo su **causa** de una lista cerrada (D9) y, en `boot_error`, el
  `code` del error (`ERR_MODULE_NOT_FOUND`, …), nunca su `message`.

### D8. Reentregas acotadas, y un `stalled` agotado tampoco deja el CV en `pending`

- Con el event loop libre, el bloqueo de BullMQ se renueva durante toda la lectura: el parseo deja de provocar
  `stalled`. Una reentrega solo puede venir de que el proceso muera (despliegue, OOM del contenedor).
- `maxStalledCount: 1` pasa a declararse **explícito** en las opciones del `Worker` (hoy es el valor por defecto
  implícito), con un test que lo fija: como mucho **dos** aperturas de un archivo por muerte del proceso.
- El oyente de `failed` trata como **agotado** un job que BullMQ falla por `stalled` por encima del límite, aunque
  `attemptsMade` no haya llegado a `attempts`: deja el CV en `failed` con `internal_error`. El implementador lo detecta
  por el estado final del job (sin reintento pendiente) y no por el texto del error; un test local contra el Redis del
  compose lo reproduce (precedente: ADR-028 §9, paso local contra Redis).

*Alternativa descartada:* un contador de arranques persistido en `cv_documents` que cortara a la segunda apertura.
Con `maxStalledCount: 1` BullMQ ya no permite una tercera, y el contador habría cambiado `CvRepository` y marcado como
ilegible un CV inocente tras un reinicio por despliegue.

### D9. Métricas y registros sin texto del CV

En el registro `workerMetricsRegistry` que ya sirve `GET /metrics`:

- `linkvault_cv_extractions_total{format, outcome, cause}` — `format` ∈ {`pdf`, `docx`}; `outcome` ∈ {`text`,
  `unreadable`, `machinery_error`}; `cause` ∈ {`none`, `parse_error`, `password`, `timeout`, `heap_limit`,
  `memory_ceiling`, `thread_exit`, `input_budget`, `boot_error`, `boot_timeout`, `protocol`}.
- `linkvault_cv_extraction_duration_seconds{format, outcome}` — histograma con cubetas hasta el plazo máximo (120 s).
- `linkvault_cv_extraction_capped_total{format, cap}` — `cap` ∈ {`pages`, `raw_text`}.
- La latencia del event loop ya la publican las métricas por defecto de `prom-client`
  (`nodejs_eventloop_lag_seconds`): es la que demuestra en producción que el aislamiento funciona.

Registros: el adaptador escribe **una línea `warn` por hilo terminado** (plazo, heap, vigía, salida ≠ 0) y una `error`
por fallo de maquinaria, con formato, causa, duración y tamaño en bytes; el caso de uso conserva su línea con el
identificador del CV, el desenlace y el motivo. El adaptador no conoce el `cvId` (el puerto no lo pasa); con
concurrencia 1 la correlación por tiempo es exacta, y se acepta (R5). Ninguna etiqueta ni línea lleva nombre de
archivo, texto, mensaje de error del parser ni clave del objeto.

### D10. Pruebas: archivos patológicos generados en el test, y el mecanismo probado con hilos de prueba

- **Ninguna muestra maliciosa real entra en el repositorio.** Todo se genera en el test con las funciones de
  `cv-fixtures.ts` (que ya ensamblan PDF y ZIP a mano) y `node:zlib`.
- **El mecanismo** (D1, D2, D5, D6, D7) se prueba con scripts de hilo **escritos por el test en un directorio
  temporal**: bucle infinito, heap creciente, `Buffer.alloc` sin fin, `process.exit(3)`, un hilo que nunca dice `ready`,
  uno que dice `boot_error`, uno que escribe en `stdout`, uno que lee `process.env`. El adaptador recibe la ruta del
  script como parámetro de construcción para esto.
- **Los parsers reales** se prueban dentro del hilo real con archivos generados (lista y nombres en `tasks.md`, grupo
  5). Cómo arranca el hilo real desde Vitest (bundle previo en un `globalSetup`, o el *type stripping* de Node 22.18+
  con un script autocontenido) lo decide el spike 1.1.
- **Regla para los generadores patológicos**: tamaños elegidos para que cada test dure < 5 s en CI y para que el
  archivo generado no supere el tope de 5 MiB de subida (lo que no podría llegar por la API no prueba nada).

### D11. La imagen publicada lee un CV antes de publicarse

Entrada nueva del build del worker, `cv-extract-probe.js` (mismo patrón que `s3-probe.js`, tarea 7.5 de `object-store`):
genera en memoria un PDF y un DOCX con las funciones de fixtures, los lee con el **adaptador real aislado** y sale 0
solo si los dos devuelven texto con los caracteres esperados; imprime recuentos, nunca texto. `infra/ci/verify-artifact.sh`
gana una sección `run --rm --no-deps worker node cv-extract-probe.js`. Es lo que demuestra, en la arquitectura del
destino, que el bundle del hilo está en la imagen y que pdf.js carga (ADR-048: una imagen que construye no es una
imagen que funciona).

### D12. Configuración y contratos que no cambian

- `CV_EXTRACTION_TIMEOUT_MS` (1.000-120.000, por defecto 30.000) y `CV_EXTRACT_CONCURRENCY` (1-4, por defecto 1)
  conservan nombre, rango y valor. Cambia la semántica del plazo: ahora corta.
- `CvTextExtractor`, `ExtractionAttempt`, `CvRepository`, `CvExtractionFailureReason` y los schemas de `libs/shared` no
  cambian. El SPA no cambia.
- La regla de lint de la capa de dominio cambia `pdf-parse` por `pdfjs-dist` (y `unpdf`) en su lista, y gana
  `node:worker_threads`: abrir un hilo es infraestructura.

## Risks / Trade-offs

- **R1 — Tamaño de la imagen.** `pdfjs-dist` sin podar pesa bastante más que `pdf-parse`. Mitigación: excluir
  `@napi-rs/canvas` (dependencia opcional), medirlo en el spike y parar en 30 MB (Q3).
- **R2 — ESM desde un bundle `commonjs`.** El build `legacy` de pdf.js es ESM; si usa `await` de nivel superior,
  `require(esm)` de Node 22 falla con `ERR_REQUIRE_ASYNC_MODULE` y hace falta un `import()` dinámico que el compilador
  no reescriba. Riesgo de que «funcione en Vitest y no en la imagen»: lo cierra la sonda de D11, y el spike 1.1 lo
  prueba primero desde el bundle.
- **R3 — Memoria entre muestras del vigía.** En 100 ms un inflado rápido puede reservar varios cientos de MB antes de
  que el vigía actúe. El techo real es «+512 MiB y lo que quepa en 100 ms». Se acepta; el `mem_limit` del contenedor
  sería la segunda barrera (Q5).
- **R4 — Daño colateral con concurrencia > 1** (D5). Aceptado con el valor por defecto en 1 (Q4).
- **R5 — Correlación de registros por tiempo** (D9). Aceptada con concurrencia 1.
- **R6 — Diferencias de texto con el pdf.js nuevo.** Puede leer distinto que el de 2017 (mejor, casi siempre). La
  paridad solo se mide sobre fixtures sintéticos; los CV ya leídos no se re-extraen, así que dos CV iguales subidos
  antes y después pueden diferir. Los golden de CV reales llegan con la fila 36.
- **R7 — Latencia de parches.** Renovate solo abre PR aprobados desde el Dependency Dashboard (PR #88), con
  `minimumReleaseAge` de 7 días: una corrección de seguridad de pdf.js puede tardar. Q6.
- **R8 — El hilo comparte proceso.** Un fallo de código nativo dentro del hilo mataría el worker entero. pdf.js y
  `mammoth` son JavaScript puro (por eso se excluye `@napi-rs/canvas`); si entra código nativo, la palanca es el
  proceso hijo (D1).
- **R9 — Solape con la fila 35 en `verify-artifact.sh` e `infra/README.md`.** Una sección nueva en el script, y la
  misma orden en el `up` documentado de `infra/README.md`, porque `check-docs-stack-up` exige que los dos tengan las
  mismas órdenes `run` en el mismo orden (hoy 3: `provision`, `verify`, `s3-probe.js`). 35c edita otro tramo del script
  (`--wait-timeout`); `infra/README.md` lo tocan 35b y 35c, así que el conflicto, si aparece, es de una línea. Si el
  owner quiere cero solape, D11 queda en su entrada de build y las dos líneas se mueven a 35c (Q1 (c)).

## Migration Plan

1. **Sin migración de datos.** Ningún documento cambia de forma. Los CV en `pending` al desplegar los lee el código
   nuevo; los ya leídos o fallidos se quedan como están.
2. **Despliegue**: una sola imagen nueva del worker; `api` y `web` no cambian. No hay variables nuevas que poner en el
   host.
3. **Comprobación tras desplegar**: subir un CV PDF y uno DOCX con la cuenta `+e2e` (o la e2e del lote 1) y ver
   `linkvault_cv_extractions_total{outcome="text"}` subir en `/metrics` desde la red interna.
4. **Vuelta atrás**: revertir el PR y redesplegar la imagen anterior (procedimiento de 35b). Los CV leídos con el código
   nuevo se quedan; un CV en `pending` en el momento del cambio lo lee la imagen anterior.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] — ¿Excepción a la precedencia de la fila 35?**
  - (a) Sí: se aplica y se fusiona **antes de invitar en 35b** (antes de su 10.7; si se fusiona después de su 6.3, se
    redespliega y se repite la 10.7 sobre el commit nuevo), como ADR-055 §1 hizo con `usage-guide-fixes`.
  - (b) No: entra justo después de 35c (posición actual en `openspec-changes.yaml`).
  - (c) Sí, pero sin tocar `verify-artifact.sh`: la sección de la sonda (D11) se traslada a 35c.
  - **Recomendación: (a).** Los argumentos están en `proposal.md` §«Encaje con la fila 35»: el riesgo nace con las
    invitaciones de 35b, y el change no toca nada de lo que la fila modifica salvo una sección de un script de CI.
    Respuesta del owner: pendiente. Se anota aquí y en ADR-058 en una línea que empiece por «Respuesta del owner (Q1),
    AAAA-MM-DD:»; si es (a) o (c), además una línea en ADR-048 §Consecuencias como las de ADR-053 y ADR-055.
- **Q2 [no bloqueante] — ¿Un motivo y un texto propios para «el archivo era demasiado complejo»?** Hoy un plazo vencido
  dice «No pudimos abrir este archivo. Si tiene contraseña, quítasela…», y la contraseña no tiene nada que ver.
  Opciones: (a) no, se mantiene `unreadable_file`; (b) motivo nuevo en `libs/shared` + textos ES/EN + SPA en otro
  change. **Recomendación: (a)** hasta ver en 35b cuántas lecturas terminan con `cause="timeout"`: con cero usuarios,
  sería un texto para un caso que no se ha visto.
- **Q3 [no bloqueante] — Umbral de crecimiento de la imagen del worker.** Opciones: (a) ≤ 30 MB sin preguntar, más
  vuelve al owner; (b) cualquier tamaño; (c) ≤ 10 MB, que probablemente obliga a `unpdf`. **Recomendación: (a).**
- **Q4 [no bloqueante] — ¿Fijar `CV_EXTRACT_CONCURRENCY` a 1?** El vigía no atribuye memoria con más de un hilo
  (R4). Opciones: (a) dejar el rango 1-4 y documentar el riesgo; (b) bajar el máximo a 1. **Recomendación: (a)**: el
  rango es un contrato de configuración vigilado y el valor real es 1.
- **Q5 [no bloqueante] — `mem_limit` del contenedor del worker.** Segunda barrera para R3. Toca el compose de
  producción. **Recomendación:** después de la fila 35, en un change propio con medición de memoria en staging.
- **Q6 [no bloqueante] — ¿Alertas de vulnerabilidad de Renovate sin aprobación del Dashboard para los parsers?**
  `vulnerabilityAlerts` con `dependencyDashboardApproval: false` para `pdfjs-dist`, `mammoth`, `@xmldom/xmldom` y
  `jszip`. Contradice en parte la decisión del PR #88, así que es del owner. **Recomendación:** sí, solo para alertas de
  seguridad de esos cuatro paquetes.

## D3 · Estado

Pendiente del spike (tareas 1.1-1.4). Se completa aquí con la biblioteca elegida, la versión exacta, el incremento de
la imagen medido y el resultado de la paridad.
