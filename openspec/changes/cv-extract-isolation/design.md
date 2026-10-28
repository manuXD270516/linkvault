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
2. **Reentrega del mismo archivo, y un CV que puede quedar en `pending` para siempre.** Sin renovación, el bloqueo
   (45 s) vence. El mecanismo real de BullMQ **6.3.6** (`moveStalledJobsToWait-9.lua` y `Worker.processJob`):
   - el chequeo de `stalled` devuelve el job a `wait` y suma 1 a su contador; con `maxStalledCount` por defecto (1),
     la **primera** vez lo reentrega y el archivo se vuelve a abrir;
   - la **segunda**, el script **no** lo falla en ese momento: le escribe `deferredFailure` («job stalled more than
     allowable limit») y lo devuelve también a `wait`;
   - el siguiente worker que lo toma ve `deferredFailure` **antes de llamar al procesador** y lo falla con
     `UnrecoverableError`, que no se reintenta: el job queda `failed` con `finishedOn` puesto y `attemptsMade` por debajo
     de `attempts`. No hay tercera apertura;
   - el oyente de `failed` de hoy solo actúa si `attemptsMade >= attempts`, así que **no** marca el CV: queda en
     `pending` para siempre (hueco que este change cierra, D8).
3. **Trabajo zombi**: si el plazo vence sin bloqueo total (parser lento pero asíncrono a trozos), el job termina, el
   parser sigue consumiendo CPU y memoria, y la concurrencia deja entrar al siguiente.
4. **Memoria fuera de V8**: un ZIP o un stream `Flate` que infla a gigabytes crece en `ArrayBuffer`, que el heap de
   V8 no cuenta.
5. **Nadie reinicia**: `restart: unless-stopped` no actúa sobre un proceso vivo y colgado, y Docker no reinicia por
   `unhealthy`.
6. **El parser ve los secretos del worker**: corre en el proceso que tiene en `process.env` las credenciales S3,
   `AI_VAULT_KEY` y las claves de proveedores (iteración 1 del debate, H1).

Restricciones que este diseño respeta:

- El puerto `CvTextExtractor.extract(bytes): Promise<ExtractionAttempt>` y sus dos desenlaces (`text`,
  `unreadable_file`) **no cambian** (encargo del change). Tampoco `CvRepository`.
- Lo que ve la persona son los estados existentes de `cv/extraction`; solo cambia **el texto** de `unreadable_file`
  (D13, decisión del debate).
- Nada del CV en registros ni métricas (`cv/documents` «Nada del CV en los registros», `platform/observability`).
- Fila 35: no se tocan compose, workflows, `.env.example` ni requirements de `platform/*` (Q1).
- El worker se empaqueta con webpack (`apps/worker/webpack.config.js`, `compiler: 'tsc'`, `module: commonjs`) y corre en
  `node:22.23.2-alpine` como PID 1 (`CMD ["node", "main.js"]`), `linux/arm64` en el destino (ADR-051 §3, ADR-052).

## Goals / Non-Goals

**Goals**

- Que ningún archivo subido pueda bloquear el event loop del worker ni hacer que se reentregue por `stalled`.
- Que el plazo **detenga** el trabajo, y que un archivo que agota plazo, heap o topes termine en `unreadable_file` sin
  reintentos.
- Que el código que abre el archivo **no tenga a su alcance** los secretos del worker ni su sistema de ficheros.
- Que la memoria que puede consumir una lectura esté acotada también fuera del heap, y medida en el proceso que lee.
- Que el parser de PDF sea una versión mantenida, verificada en `arm64` y en la imagen publicada.
- Medir lo que pasa (un contador y una línea de registro por lectura terminada mal) sin una palabra del CV.

**Non-Goals**

- Un motivo nuevo en `/mi-cv` (Q2 quedó en reescribir el texto existente, D13).
- Aislar a nivel de contenedor (`mem_limit`, servicio aparte) (Q5, alternativas de D1).
- Cortar la red del proceso que lee (no hay mecanismo en Node 22; riesgo aceptado R8, Q7).
- OCR, antivirus o re-extracción de CV ya leídos.

## Decisions

### D1. La lectura corre en un proceso hijo nuevo por CV, con el modelo de permisos de Node

El adaptador de infraestructura arranca **un proceso Node hijo por lectura** (`child_process.spawn(process.execPath,
…)`), le pasa los bytes por su entrada estándar después de que se anuncie listo, recibe el resultado por un canal propio
y lo mata siempre al acabar. El script del hijo y el protocolo son los mismos que tenía el hilo en la versión anterior
de este design; solo cambia el transporte.

```
spawn(process.execPath, [
  '--permission',
  '--allow-fs-read=<ruta absoluta de cv-extract-child.js>',
  '--allow-fs-read=<raíz de node_modules del worker>',      // lo exacto lo fija el spike (8.2); una ruta por flag
  '--max-old-space-size=256', '--max-semi-space-size=16',
  '--disallow-code-generation-from-strings',
  '<ruta absoluta de cv-extract-child.js>',
], { env: {}, stdio: ['pipe', 'ignore', 'ignore', 'pipe'], detached: false })
```

- **`env: {}`**: el hijo arranca sin ninguna variable. Comprobado el 2026-10-28 en `node:22.23.3-alpine`:
  `Object.keys(process.env)` vale `[]` y, por ser `spawn` y no `fork`, ni siquiera llevan `NODE_CHANNEL_FD`, así que su
  `/proc/self/environ` queda vacío. En Windows, libuv añade una decena de variables de sistema (`SYSTEMROOT`, `PATH`,
  …), ninguna del worker: los tests comprueban la **ausencia de las variables del worker**, no la longitud.
- **Modelo de permisos** (`--permission`). Estado en la versión del proyecto: **estable** (Stability 2) desde Node
  22.13.0, que lo renombró desde `--experimental-permission`; el `.nvmrc` y la imagen fijan 22.23.x. Comprobado el
  2026-10-28 en Node 22.23.1 (Windows) y 22.23.3 (Alpine), sin `ExperimentalWarning`:
  - `--allow-fs-read` admite **una ruta por flag, repetido**; una lista con comas **no** se separa (se trata como una
    sola ruta inexistente y deniega todo lo de fuera);
  - fuera de lo permitido, `readFileSync` da `ERR_ACCESS_DENIED`; en particular `/proc/self/environ`,
    `/proc/<ppid>/environ`, `/proc/self/status` y `/etc/passwd`. Sin el modelo, el hijo **sí** podría leer
    `/proc/<ppid>/environ` (mismo UID), y en el contenedor el worker es PID 1 con las credenciales en su entorno de
    arranque;
  - sin `--allow-fs-write`, `--allow-child-process`, `--allow-worker`, `--allow-addons` ni `--allow-wasi`: escribir,
    lanzar procesos, crear un `Worker` anidado y cargar código nativo dan `ERR_ACCESS_DENIED`; `process.binding()`
    también;
  - `--disallow-code-generation-from-strings`: `eval` y `new Function` lanzan `EvalError`. Es la segunda llave de
    `isEvalSupported: false` (D3).
- **Límites de memoria del hijo**: `--max-old-space-size=256` y `--max-semi-space-size=16` (equivalen al
  `maxOldGenerationSizeMb: 256` / `maxYoungGenerationSizeMb: 32` de la versión con hilo). Superarlos aborta **el hijo**:
  en Linux sale por `SIGABRT` (comprobado), en Windows con código 134. Sin `--stack-size`: es un flag de V8 que, por
  encima de la pila real del sistema, provoca un fallo de segmentación en vez de un `RangeError`; la recursión profunda
  ya acaba en `RangeError` con la pila por defecto.
- **Salida estándar y de errores a `ignore`**: lo que el hijo escriba no llega a ningún sitio. pdf.js escribe avisos por
  consola, y un aviso puede llevar trozos del documento.
- **Proceso nuevo por CV, sin pool.** pdf.js guarda cachés globales (fuentes, CMaps, objetos) y un proceso reutilizado
  arrastraría estado de una persona a otra. El arranque (Node + bibliotecas) se mide en el spike (8.1); es irrelevante
  para un CV que se lee una vez.
- **Sin huérfanos en producción.** El hijo no puede lanzar procesos (sin `--allow-child-process`), así que matar al hijo
  mata todo. Si el worker muere, el contenedor muere con él (PID 1: el kernel mata el resto del espacio de PID). En el
  cierre ordenado, el adaptador mata a los hijos vivos (`onApplicationShutdown`). En desarrollo, un `nx serve` matado con
  `SIGKILL` podría dejar un hijo en bucle hasta que alguien lo mate (R10).

**Por qué no el canal IPC de `fork`.** Comprobado el 2026-10-28 en Alpine: si el hijo escribe una línea que no es JSON
directamente en el descriptor del canal (`fs.writeSync(3, …)`), el padre lanza un `SyntaxError` **no capturado** desde
el código interno de Node que deserializa el canal; el worker no tiene oyente de `uncaughtException`, así que moriría. Y
el modelo de permisos **no cubre** los descriptores ya abiertos (lo dice su documentación): el hijo puede escribir en
ese descriptor aunque no tenga `--allow-fs-write`. Por eso el transporte es **un pipe propio** (descriptor 3, `'pipe'`)
con un marco que el padre parsea a la defensiva (D6): una línea JSON por mensaje, con tope de tamaño, y una línea
inválida es un desenlace, nunca una excepción.

**Alternativas descartadas** (cuatro ejes: memoria, secretos, coste y lo que exige fuera del change)

| Opción | Memoria | Secretos | Coste por lectura | Exige |
|---|---|---|---|---|
| **Proceso hijo + permisos (elegida)** | heap acotado por flags; RSS **del hijo** medible y atribuible (D5); una asignación enorme mata solo al hijo | `env: {}` + sin lectura de `/proc` ni del disco fuera de lo permitido | ~40 MB de RSS y el arranque de Node, una vez por CV | nada fuera del worker |
| `worker_thread` nuevo por CV (versión anterior) | heap acotado por `resourceLimits`; la memoria externa solo se ve en el RSS **del proceso entero**, sin atribución con concurrencia > 1 | `env: {}` no basta: el hilo comparte proceso y puede leer `/proc/self/environ` (el entorno de arranque del worker, con las credenciales); el modelo de permisos es por proceso | el menor | nada |
| Pool de hilos o de procesos | igual que su base | igual que su base | ahorra milisegundos | estado compartido entre CV de personas distintas y una dependencia más |
| Servicio o contenedor de extracción aparte | `mem_limit` del contenedor | el contenedor no tiene credenciales; red cortable | un servicio más | añadirlo al compose de 35b y 35c y una cola o RPC nueva: no cabe sin romper Q1 (3). Evolución anotada en ADR-058 |
| Seguir en el hilo principal con mejor plazo | ninguna | ninguna | — | no existe un plazo que interrumpa código síncrono en el mismo hilo |

### D2. Los plazos cortan: dos plazos en el adaptador y una red exterior en el caso de uso

- **Plazo de arranque**, `CV_CHILD_BOOT_TIMEOUT_MS` (5 s), desde el `spawn` hasta el mensaje `ready`. Vencido, es un
  fallo de maquinaria (D6).
- **Plazo de contenido**, `CV_EXTRACTION_TIMEOUT_MS`, **desde `ready`** hasta el resultado (H9: el arranque no le come
  tiempo al archivo). Vencido, el adaptador mata al hijo con `SIGKILL` —que detiene cualquier cosa, también un bucle
  síncrono—, **espera su `exit`** y devuelve `unreadable_file`.
- `ExtractCvUseCase.withDeadline` **se queda** como red exterior con `timeoutMs + CV_CHILD_BOOT_TIMEOUT_MS +
  CV_ISOLATION_GRACE_MS` (plazo + 5 s + 2 s): si un defecto del adaptador no devolviera nunca, el job sigue terminando.
  En el camino normal gana siempre uno de los plazos del adaptador. `lockDuration` (plazo + 15 s) queda **por encima**
  de la red exterior (plazo + 7 s).
- **Un plazo de contenido vencido es terminal y no se reintenta** (`cv/extraction` ya lo decía; ahora además es verdad
  que el trabajo se detiene). Es la regla de ADR-030 §6 llevada a la lectura: el número de veces que un archivo
  patológico se abre **no crece con las entregas del job** más allá de lo que acota D8.

*Alternativa descartada:* quitar el `Promise.race` del caso de uso. Ahorra un temporizador y deja el job colgado ante
cualquier defecto futuro del adaptador; el coste de mantenerlo es una línea.

### D3. PDF: pdf.js mantenido (`pdfjs-dist`, build `legacy`), versión exacta, confirmado por spike **al final**

**Recomendación:** `pdfjs-dist` de Mozilla (Apache-2.0), build `legacy/build/pdf.mjs` (la indicada para Node), fijado
a **versión exacta** (sin `^`), cargado solo dentro del hijo, con:

- `isEvalSupported: false` (cierra la clase de fallo de CVE-2024-4367, ejecución de código vía `FontMatrix` con `eval`
  activo; no consta que la extracción de texto de pdf.js 1.10 la alcance, pero esa versión está entre las afectadas y
  sin corrección posible), reforzado por `--disallow-code-generation-from-strings` (D1);
- `disableFontFace: true`, `useSystemFonts: false`, `enableXfa: false`, `verbosity` en errores y **sin URL remota** (los
  datos van en memoria);
- **sin canvas y sin `Worker` anidado**: `@napi-rs/canvas` excluido de la instalación y el «worker falso» de pdf.js
  corriendo dentro del propio hijo (el modelo de permisos deniega crear un `Worker`; el spike lo confirma);
- `cMapUrl`/`standardFontDataUrl` apuntando a los directorios del propio paquete, que entran en `--allow-fs-read`;
- la unión de líneas que hacía `pdf-parse` (salto de línea cuando cambia la coordenada Y del elemento), para que el
  texto guardado conserve su forma;
- `disableNormalization`: **decisión explícita** del spike (8.4), con el resultado de la medición de paridad: `true` si
  la normalización Unicode de pdf.js empeora el recall frente a `pdf-parse`, `false` si lo mejora o lo deja igual;
- **tope de páginas** y de texto crudo (D5).

| Criterio | `pdfjs-dist` (recomendado) | `unpdf` (alternativa escrita) | `pdf-parse` 2.x | poppler `pdftotext` | `mupdf` (WASM) | `pdf-parse` 1.1.4 aislado |
|---|---|---|---|---|---|---|
| Mantenimiento | Mozilla, publicaciones frecuentes | UnJS; reempaqueta pdf.js con retraso | mantenido | distro | Artifex | **sin correcciones desde 2017** |
| `arm64` | JS puro | JS puro | arrastra `@napi-rs/canvas` (nativo) | binario de Alpine | WASM | JS puro |
| Tamaño | decenas de MB sin podar; su `@napi-rs/canvas` opcional hay que excluirlo | pequeño, sin dependencias | ~25 MB nativos (ADR-028 lo descartó) | ~10-20 MB con dependencias | ~10 MB | ya está |
| Licencia | Apache-2.0 | MIT | Apache-2.0 | GPL-2 (binario distribuido en una imagen pública de GHCR) | **AGPL-3.0** | MIT/Apache |
| Calidad | la de pdf.js actual | la misma que su pdf.js | la de pdf.js | buena, con `-layout` | buena | la de 2017 |
| Integración | ESM; desde un bundle `commonjs` exige `import()` dinámico (R2) | ESM y CJS | ESM | proceso hijo; sin API | WASM | ya integrada |

- `mupdf`: descartado por AGPL en un proyecto MIT con imagen pública.
- `pdftotext`: descartado por traer código C que parsea entradas hostiles (memoria no segura), un binario GPL dentro de
  la imagen publicada y correcciones que dependen de reconstruir la imagen sobre Alpine.
- `pdf-parse` 2.x: descartado por la dependencia nativa, igual que en ADR-028.
- `pdf-parse` 1.1.4 dentro del hijo: **resuelve la disponibilidad y los secretos, no la superficie**. Es el estado
  intermedio del change (PO-04: el aislamiento va primero y la biblioteca al final) y la salida si el spike falla en las
  dos candidatas; en ese caso el change sigue y la sustitución vuelve al owner como pregunta nueva.

**Orden (PO-04).** El aislamiento (grupos 1-7 de `tasks.md`) se construye y se prueba **con las bibliotecas de hoy
dentro del hijo**, detrás de una interfaz interna `PdfTextSource` (un fichero); el spike y la sustitución son el grupo
8. Así lo que cierra el riesgo de disponibilidad y de secretos no espera a la biblioteca (ver la condición de Q1).

**Spike (tareas 8.1-8.6), con criterio de parada escrito.** `pdfjs-dist` se adopta si:

- (a) carga y extrae **dentro del hijo con los flags de D1**, desde el bundle de webpack y desde la imagen
  (`node dist/apps/worker/cv-extract-probe.js`), sin canvas y sin `Worker` anidado;
- (b) el incremento de la imagen del worker es ≤ 30 MB (Q3), **medido después de la poda** (canvas excluido y, si hace
  falta, los builds que no se usan quitados en `docker/worker.Dockerfile`): no se descarta por (b) sin haber podado;
- (c) las licencias de su árbol son permisivas;
- (d) la paridad pasa: igualdad exacta sobre los fixtures sintéticos, y sobre PDF de productores reales (H7) recall de
  tokens ≥ 0,98 frente a `pdf-parse` y el mismo orden de bloques; una caída de 5 % o más en cualquiera de los dos
  **vuelve al debate**.

Un fallo de (c) o de (d) se trata como uno de (a) o (b): se prueba `unpdf` con el mismo criterio. **Tope: 4 h por
biblioteca** (H5). Si fallan las dos, el change se cierra con `pdf-parse` 1.1.4 dentro del hijo y una pregunta nueva
al owner. La medición de paridad se **repite con la candidata adoptada** si no es la que se midió primero (PO-08). El
resultado se escribe en «D3 · Estado» antes de la tarea 8.7.

### D4. DOCX: `mammoth` se queda, detrás de un inflado con tope propio

`mammoth` 1.12 está mantenido; lo peligroso es lo que hace antes de leer el XML. Dentro del hijo, y antes de llamarlo:

1. Se lee el **directorio central** del ZIP con un lector propio de ~150 líneas. El directorio central es la fuente de
   verdad del **método** y del **tamaño comprimido** de cada entrada (de dónde leer y cuánto).
2. Para **ubicar los datos**, se valida la **cabecera local** de cada entrada: firma `PK\x03\x04`, que su desplazamiento
   (del directorio central) y su longitud de nombre y de campo extra caen dentro del archivo, y que su nombre y su
   método coinciden con los del directorio central. Los datos empiezan tras la cabecera local, y lo que no cuadra es
   `unreadable_file`.
3. Se rechaza como `unreadable_file`: más de **2.000 entradas**; un **ZIP64 de verdad** (registro de fin ZIP64 necesario,
   o algún valor del directorio central a `0xFFFF`/`0xFFFFFFFF`); entradas cifradas; métodos distintos de `stored` (0) y
   `deflate` (8); nombres con `..` o absolutos; y desplazamientos fuera del archivo. **Un campo extra ZIP64 en una
   entrada cuyos valores caben en 32 bits se acepta y se ignora** (PO-01): lo escriben algunas bibliotecas por
   defecto, y rechazarlo dejaría fuera DOCX legítimos.
4. Cada entrada `deflate` se infla con `zlib.inflateRawSync(datos, { maxOutputLength: presupuestoRestante })`; cada
   entrada `stored` **cuenta su tamaño** contra el mismo presupuesto. El presupuesto total es **64 MiB**: se cuenta lo
   que **sale**, no lo que la cabecera declara, así que una cabecera que miente no sirve de nada. Agotarlo es
   `unreadable_file` (`input_budget`). *Opcional, a criterio del implementador:* no inflar `word/media/*` (imágenes que
   `extractRawText` no necesita); si se hace, un test fija que el texto no cambia.
5. Con las entradas ya infladas se compone un ZIP **sin compresión** (`stored`, como el de los fixtures de ADR-028) y
   se le da a `mammoth.extractRawText({ buffer })`. `jszip` ya no infla nada.
6. El XML se parsea dentro del hijo: una expansión de entidades o un documento enorme chocan con el heap acotado (D1),
   con el vigía (D5) o con el plazo (D2), no con el worker.

*Alternativas descartadas:* confiar en los tamaños declarados (mienten); leer solo las cabeceras locales (un ZIP puede
tener cabeceras locales que contradicen al directorio central, y `mammoth`/`jszip` usan el directorio central); escribir
un extractor de DOCX propio sobre el XML (más código propio parseando entradas hostiles, y peor texto que `mammoth`);
sustituir `mammoth` (no hay motivo: está mantenido).

### D5. Topes de contenido y vigía de memoria del hijo, como constantes del código

| Tope | Valor | Dónde | Al superarlo |
|---|---|---|---|
| Páginas de PDF leídas | 50 | hijo | se leen las 50 primeras y se sigue (un CV no tiene 50 páginas; no se falla por eso) |
| Texto crudo acumulado | 1.000.000 caracteres | hijo, PDF y DOCX | se deja de leer y se entrega lo acumulado; el dominio recorta a 200.000 y marca `truncated` como hoy |
| DOCX inflado | 64 MiB en total | hijo | `unreadable_file` (`input_budget`) |
| Entradas del DOCX | 2.000 | hijo | `unreadable_file` (`input_budget`) |
| Heap del hijo | 256 MB viejo + 16 MB por semiespacio | flags del hijo | el hijo aborta → `unreadable_file` (`heap_limit`) |
| Memoria residente **del hijo** | +512 MiB sobre la que tenía al anunciar `ready` | vigía en el worker, cada 100 ms | `SIGKILL` a ese hijo → `unreadable_file` (`memory_ceiling`) |
| Arranque hasta `ready` | 5 s | adaptador | fallo de maquinaria (`boot_timeout`) |
| Marco del canal | 8 MiB por línea y en total | adaptador | `protocol` (D6) |

- **El vigía mide el RSS del hijo**, no el del worker: lee `/proc/<pid>/statm` (segundo campo × tamaño de página), que
  el worker puede leer (el modelo de permisos solo se aplica al hijo). Comprobado el 2026-10-28 en Alpine: un hijo que
  reserva búferes de 256 MiB en bucle se mata al cruzar el umbral con un exceso de ~36 MiB en una muestra de 100 ms,
  y el worker sigue en ~48 MiB de RSS. Ventajas sobre la versión con hilo (H12, Q4):
  - **la atribución es exacta con cualquier concurrencia**: cada hijo tiene su base (su RSS en `ready`) y su techo, y
    el vigía mata **solo** al hijo que lo cruza; un CV inocente que se lee a la vez no se toca;
  - la base no la ensucia la recolección de basura del worker (H11): es la memoria del hijo con sus bibliotecas
    cargadas.
- **Sin `/proc`** (Windows y macOS de desarrollo), el vigía se desactiva con **un** `warn` al arrancar el adaptador; el
  heap acotado y los plazos siguen. Sus tests corren solo en Linux (`describe.runIf(process.platform === 'linux')`); CI
  y la imagen son Linux.
- **Con `CV_EXTRACT_CONCURRENCY` > 1** la memoria de lectura del worker puede llegar a N × (heap + techo + ~40 MB de
  arranque). El worker escribe un `warn` al arrancar si el valor es mayor que 1 (H12), con esa cuenta y sin más datos; el
  RUNBOOK lo explica junto a `memory_ceiling`.
- **Constantes, no variables de entorno**: el contrato de configuración que vigila `compose-env-contract` no cambia, el
  compose de 35b/35c no se toca, y un tope de seguridad no es algo que se quiera poder aflojar por un `.env`. Viven en
  `apps/worker/src/modules/cv/infrastructure/isolation/extraction-limits.ts`, con un test que fija sus valores.
- Los topes de páginas y de texto crudo no marcan `truncated` por el puerto (no tiene por dónde decirlo y no se cambia);
  se cuentan en la causa del contador (D9).

### D6. Contenido o maquinaria: `ready` decide quién tiene la culpa

El hijo hace un **apretón de manos**: al arrancar carga sus bibliotecas y publica `ready` (o `boot_error` con solo el
código del error). Solo tras `ready` recibe los bytes. **Lo que pasa antes de `ready` es nuestro; lo que pasa después,
del archivo** (H2: también un mensaje inválido o una salida sin resultado).

| Momento | Señal | Causa | Desenlace del adaptador | Job |
|---|---|---|---|---|
| antes de `ready` | el script no existe (Node sale con código ≠ 0), una biblioteca no carga (`boot_error`), `exit` sin `ready` por cualquier motivo, `error` del proceso | `boot_error` | **lanza** `CvExtractionMachineryError` | se reintenta (3 intentos con espera creciente); agotados, `failed`/`internal_error` |
| antes de `ready` | 5 s sin `ready` | `boot_timeout` | lanza | ídem |
| antes de `ready` | línea inválida o mensaje fuera del protocolo, o `code` que no cumple `^[A-Z0-9_]{1,64}$` | `protocol` | lanza | ídem |
| después de `ready` | plazo de contenido vencido | `timeout` | `{ kind: 'unreadable_file' }` | termina bien, **sin reintento**; CV en `failed`/`unreadable_file` |
| después de `ready` | el hijo aborta por heap (`SIGABRT` o código 134) | `heap_limit` | `unreadable_file` | ídem |
| después de `ready` | el vigía lo mata | `memory_ceiling` | `unreadable_file` | ídem |
| después de `ready` | `failed{cause}` del hijo: excepción del parser, contraseña, topes de D4 | `parse_error`, `password`, `input_budget` | `unreadable_file` | ídem |
| después de `ready` | `exit` con o sin código ≠ 0 **sin** haber mandado resultado, `error` del proceso o del pipe | `child_exit` | `unreadable_file` | ídem |
| después de `ready` | línea inválida, mensaje fuera del protocolo o marco de más de 8 MiB | `protocol` | `unreadable_file` | ídem |

- **Oyentes explícitos** (H3): `error` del proceso, `error` de `stdin` (un `EPIPE` al escribir los bytes si el hijo ya
  murió) y del descriptor 3, `close` del descriptor 3 y `exit` del proceso. Cada uno resuelve **una sola vez** la
  promesa de la lectura; los que llegan después se ignoran. Ninguno lanza fuera del adaptador.
- **El marco**: el padre acumula el descriptor 3 por líneas, con tope de 8 MiB (1.000.000 de caracteres en JSON caben
  con margen); cada línea se parsea con `JSON.parse` dentro de `try` y se valida con `safeParse` de zod. **El
  `ZodError` y el texto de la línea nunca se registran ni se adjuntan**: de una línea inválida solo queda la causa
  `protocol`.
- **`CvExtractionMachineryError`**: mensaje **fijo** `cv extraction machinery failure: <causa>` (causa de la lista
  cerrada), **sin `cause`** ni propiedades con datos del hijo, salvo `code` validado con `^[A-Z0-9_]{1,64}$` en
  `boot_error`. Es lo que BullMQ guarda en `job.failedReason`, así que ese campo tampoco puede llevar nada del CV; un
  test con canario lo fija.
- Así un despliegue roto (el script del hijo ausente) **no** deja todos los CV en «No pudimos abrir este archivo»: los
  deja en `pending` reintentando y, agotados, en «No pudimos leerlo ahora», que es la verdad. Y la sonda de D11 lo para
  antes de publicar.
- El puerto no cambia: `unreadable_file` sigue sin causa. La causa vive en el contador y en el registro (D9).

### D7. El hijo no ve secretos, no lee el disco y no habla por su cuenta

Lo que el mecanismo **da**, y nada más (los SHALL del spec prometen exactamente esto):

- **Sin variables de entorno del worker** (`env: {}`), y sin forma de leer las del worker por `/proc`: el modelo de
  permisos deniega leer cualquier fichero fuera del script del hijo y de `node_modules` (D1).
- **Sin escribir en disco, sin lanzar procesos ni hilos, sin código nativo, sin `eval`.**
- **Sin salida visible**: `stdout` y `stderr` a `ignore`.
- **Ningún mensaje de error del hijo se registra**: solo su causa de una lista cerrada (D9) y, en `boot_error`, el
  `code` validado (`ERR_MODULE_NOT_FOUND`, …), nunca su `message`.

Lo que **no** da: **la red**. En Node 22 el modelo de permisos no restringe sockets (el flag de red llega en una línea
posterior de Node). Ver R8 y Q7.

### D8. Reentregas acotadas, y un `stalled` agotado tampoco deja el CV en `pending`

- Con el event loop libre, el bloqueo de BullMQ se renueva durante toda la lectura: el parseo deja de provocar
  `stalled`. Una reentrega solo puede venir de que el proceso muera (despliegue, OOM del contenedor).
- `maxStalledCount: 1` pasa a declararse **explícito** en las opciones del `Worker` (hoy es el valor por defecto
  implícito), con un test que lo fija: como mucho **dos** aperturas de un archivo por muerte del proceso (la segunda
  detección de `stalled` no lo reabre: lo falla con `deferredFailure`, Context §2).
- El oyente de `failed` trata como **agotado** un job que **ya no tiene reintento pendiente**: `error instanceof
  UnrecoverableError` (de `bullmq`) **o** `job.finishedOn` puesto (el job está en el conjunto `failed`, no en `delayed`).
  Deja el CV en `failed` con `internal_error`, aunque `attemptsMade < attempts`. No se mira el texto del error.
- El doble de la tarea 2.2 **imita esa forma** de BullMQ 6.3.6: un job con `attemptsMade` 0 o 1 de 3, `finishedOn`
  puesto y un `UnrecoverableError('job stalled more than allowable limit')`; y, como contraejemplo, un job con un
  `Error` normal, `attemptsMade < attempts` y sin `finishedOn` (reintento pendiente), que **no** se marca. Un paso local
  contra el Redis del compose lo reproduce de verdad (tarea 2.3; precedente: ADR-028 §9).

*Alternativa descartada:* un contador de arranques persistido en `cv_documents` que cortara a la segunda apertura.
Con `maxStalledCount: 1` BullMQ ya no permite una tercera, y el contador habría cambiado `CvRepository` y marcado como
ilegible un CV inocente tras un reinicio por despliegue.

### D9. Un contador y registros, sin texto del CV

En el registro `workerMetricsRegistry` que ya sirve `GET /metrics`, **un solo instrumento** (PO-05):

- `linkvault_cv_extractions_total{format, outcome, cause}` — `format` ∈ {`pdf`, `docx`}; `outcome` ∈ {`text`,
  `unreadable`, `machinery_error`}; `cause` ∈:
  - con `text`: `none`, `pages_capped`, `raw_text_capped` (si se dan las dos, `raw_text_capped`);
  - con `unreadable`: `parse_error`, `password`, `timeout`, `heap_limit`, `memory_ceiling`, `child_exit`,
    `input_budget`, `protocol`;
  - con `machinery_error`: `boot_error`, `boot_timeout`, `protocol`.
- La latencia del event loop ya la publican las métricas por defecto de `prom-client`
  (`nodejs_eventloop_lag_seconds`): es la que demuestra en producción que el aislamiento funciona.
- Duración y topes **no** tienen instrumento propio: la duración va en la línea de registro, y los topes en `cause`.

Registros: el adaptador escribe **una línea `warn` por lectura que no termina en `text`** y una `error` por fallo de
maquinaria, con formato, causa, duración y tamaño en bytes; el caso de uso conserva su línea con el identificador del
CV, el desenlace y el motivo. El adaptador no conoce el `cvId` (el puerto no lo pasa); con concurrencia 1 la
correlación por tiempo es exacta, y se acepta (R5). Ninguna etiqueta ni línea lleva nombre de archivo, texto, mensaje
de error del parser o del hijo, `ZodError` ni clave del objeto.

### D10. Pruebas: archivos patológicos generados en el test, y el mecanismo probado con hijos de prueba

- **Ninguna muestra maliciosa real entra en el repositorio.** Todo se genera en el test con las funciones de
  `cv-fixtures.ts` (que ya ensamblan PDF y ZIP a mano) y `node:zlib`. Los generadores grandes trabajan **por streaming**
  (H11): la bomba de ZIP se deflacta desde un generador de trozos, sin materializar los 100 MiB en el proceso de test.
- **El mecanismo** (D1, D2, D5, D6, D7) se prueba con scripts de hijo **escritos por el test en un directorio
  temporal**: bucle infinito, heap creciente, `Buffer.alloc` sin fin, `process.exit(3)`, uno que nunca dice `ready`,
  uno que dice `boot_error`, uno que escribe basura en el descriptor 3 antes y después de `ready`, uno que sale con 0 sin
  resultado, uno que escribe en `stdout`, uno que lee `process.env`, `/proc/<ppid>/environ` y un fichero fuera de lo
  permitido. El adaptador recibe la ruta del script y la lista de lecturas permitidas como parámetros de construcción.
- **Los parsers reales** se prueban dentro del hijo real con archivos generados (lista y nombres en `tasks.md`, grupos 3
  y 5). El hijo real se arranca desde el bundle (`pnpm nx build worker` en un `globalSetup` de Vitest) o con el *type
  stripping* de Node 22.18+ sobre un script autocontenido: lo decide la tarea 3.5.
- **Mediciones de memoria del proceso de test** (H11): la base se toma después de `global.gc()` (Vitest con
  `--expose-gc` en `execArgv` del pool de ese spec) o con el vigía inyectado; nunca una base tomada en frío.
- **Regla para los generadores patológicos**: tamaños elegidos para que cada test dure < 5 s en CI y para que el
  archivo generado no supere el tope de 5 MiB de subida (lo que no podría llegar por la API no prueba nada).

### D11. La imagen publicada lee un CV antes de publicarse

Entrada nueva del build del worker, `cv-extract-probe.js` (mismo patrón que `s3-probe.js`, tarea 7.5 de `object-store`):
genera en memoria un PDF y un DOCX con las funciones de fixtures, los lee con el **adaptador real aislado** (proceso
hijo con los flags de D1) y sale 0 solo si los dos devuelven texto con los caracteres esperados; imprime recuentos,
nunca texto. `infra/ci/verify-artifact.sh` gana una sección `run --rm --no-deps worker node cv-extract-probe.js`. Es lo
que demuestra, en la arquitectura del destino, que el bundle del hijo está en la imagen, que el modelo de permisos deja
leer lo que el hijo necesita y que pdf.js carga (ADR-048: una imagen que construye no es una imagen que funciona).

### D12. Configuración y contratos que no cambian

- `CV_EXTRACTION_TIMEOUT_MS` (1.000-120.000, por defecto 30.000) y `CV_EXTRACT_CONCURRENCY` (1-4, por defecto 1)
  conservan nombre, rango y valor. Cambia la semántica del plazo: ahora corta, y corre desde `ready`.
- `CvTextExtractor`, `ExtractionAttempt`, `CvRepository`, `CvExtractionFailureReason` y los schemas de `libs/shared` no
  cambian.
- La regla de lint de la capa de dominio cambia `pdf-parse` por `pdfjs-dist` (y `unpdf`) en su lista, y gana
  `node:child_process`/`child_process`: lanzar un proceso es infraestructura.
- **El bundle del hijo no importa nada del worker** (H6): ni `@nestjs/*`, ni `pino`, ni el módulo de configuración. Un
  test sobre el fichero construido lo fija. Su biblioteca de PDF se carga con un `import()` de **literal de cadena**
  (para que webpack y el generador de `package.json` de Nx la vean), y `dist/apps/worker/package.json` la lista con
  versión exacta.

### D13. El texto de `unreadable_file` deja de hablar solo de la contraseña (PO-02)

Hoy `@@cv.status.unreadable` dice «No pudimos abrir este archivo. Si tiene contraseña, quítasela y vuelve a subirlo.»,
y con este change ese desenlace cubre también plazos, heap y topes, que no tienen que ver con la contraseña. Se
reescribe **solo el texto**, sin motivo nuevo ni cambios en `libs/shared` (Q2, opción (c) del debate):

- ES: «No pudimos abrir este archivo. Si tiene contraseña, quítasela; si no, prueba a exportarlo de nuevo como PDF o
  súbelo en DOCX.»
- EN: «We could not open this file. If it has a password, remove it; otherwise, try exporting it again as a PDF or
  upload it as a DOCX.»

Se edita la plantilla de `cv-card.component.html`, `messages.en.xlf` (`source` y `target`) y se regenera
`messages.xlf` con `pnpm nx run web:extract-i18n` (ADR-050). Delta en `web/cv`, «Lista de CV guardados con su estado».

## Risks / Trade-offs

- **R1 — Tamaño de la imagen.** `pdfjs-dist` sin podar pesa bastante más que `pdf-parse`. Mitigación: excluir
  `@napi-rs/canvas`, podar antes de medir y parar en 30 MB (Q3).
- **R2 — ESM desde un bundle `commonjs`.** El build `legacy` de pdf.js es ESM; si usa `await` de nivel superior,
  `require(esm)` de Node 22 falla con `ERR_REQUIRE_ASYNC_MODULE` y hace falta un `import()` dinámico que el compilador
  no reescriba. Riesgo de que «funcione en Vitest y no en la imagen»: lo cierra la sonda de D11, y el spike lo prueba
  primero desde el bundle.
- **R3 — Memoria entre muestras del vigía.** En 100 ms un inflado rápido puede reservar memoria antes de que el vigía
  actúe (medido: ~36 MiB de exceso con búferes de 256 MiB). El techo real es «+512 MiB y lo que quepa en 100 ms», solo
  para el hijo. El `mem_limit` del contenedor sería la segunda barrera (Q5).
- **R4 — Memoria total con concurrencia > 1.** Ya no hay daño colateral (cada hijo tiene su vigía), pero N lecturas a la
  vez suman N techos. Aceptado con el valor por defecto en 1, el `warn` de D5 y el RUNBOOK (Q4).
- **R5 — Correlación de registros por tiempo** (D9). Aceptada con concurrencia 1.
- **R6 — Diferencias de texto con el pdf.js nuevo.** Puede leer distinto que el de 2017. La paridad se mide sobre
  fixtures sintéticos (igualdad exacta) y sobre PDF de productores reales (recall ≥ 0,98, orden de bloques; los CV
  reales los pasa el owner en su máquina, sin subirlos). Los CV ya leídos no se re-extraen, así que dos CV iguales
  subidos antes y después pueden diferir.
- **R7 — Latencia de parches.** Renovate solo abre PR aprobados desde el Dependency Dashboard (PR #88), con
  `minimumReleaseAge` de 7 días: una corrección de seguridad de pdf.js puede tardar. Q6.
- **R8 — El hijo tiene red.** En Node 22 el modelo de permisos no restringe sockets, y el hijo comparte la red del
  contenedor del worker, donde MongoDB y Redis responden **sin autenticación** (`docker-compose.prod.yml`, red interna)
  y hay salida a Internet (el enriquecimiento la necesita). Un parser comprometido con ejecución de código podría
  conectarse a ellos. **Riesgo aceptado**, porque:
  - exige ejecución de código en pdf.js o `mammoth` con `eval` desactivado por partida doble, sin código nativo, sin
    `process.binding`, sin lanzar procesos y sin leer el disco: una cadena de fallos, no uno;
  - el hijo no tiene **ninguna credencial** (ni S3, ni IA, ni la URI con usuario, que hoy no existe);
  - hoy es estrictamente peor: el parser corre en el worker con todo lo anterior y además con las credenciales;
  - la mitigación de fondo es de otro change (Q7): el flag de red del modelo de permisos al subir de línea de Node, o
    autenticación en Mongo y Redis, o el contenedor de extracción sin red (alternativa de D1).
- **R9 — Solape con la fila 35 en `verify-artifact.sh` e `infra/README.md`.** Una sección nueva en el script, y la
  misma orden en el `up` documentado de `infra/README.md`, porque `check-docs-stack-up` exige que los dos tengan las
  mismas órdenes `run` en el mismo orden (hoy 3: `provision`, `verify`, `s3-probe.js`). 35c edita otro tramo del script
  (`--wait-timeout`); `infra/README.md` lo tocan 35b y 35c, así que el conflicto, si aparece, es de una línea. Si el
  owner quiere cero solape, D11 queda en su entrada de build y las dos líneas se mueven a 35c (Q1 (c)). La poda de
  D3 (b), si hace falta, toca `docker/worker.Dockerfile`, que la fila 35 no edita.
- **R10 — Hijos huérfanos en desarrollo.** Un `nx serve` del worker matado con `SIGKILL` deja vivo un hijo que estuviera
  en un bucle, hasta que se mate a mano. En la imagen no pasa (D1, PID 1). Aceptado; el RUNBOOK lo menciona.
- **R11 — Coste por lectura.** Un proceso Node por CV (~40 MB de RSS, el arranque de Node y de las bibliotecas). Con un
  CV que se lee una vez y concurrencia 1, aceptado.

## Migration Plan

1. **Sin migración de datos.** Ningún documento cambia de forma. Los CV en `pending` al desplegar los lee el código
   nuevo; los ya leídos o fallidos se quedan como están.
2. **Despliegue**: imágenes nuevas del worker y del SPA (el texto de D13); `api` no cambia. No hay variables nuevas que
   poner en el host.
3. **Comprobación tras desplegar**: subir un CV PDF y uno DOCX con la cuenta `+e2e` (o la e2e del lote 1) y ver
   `linkvault_cv_extractions_total{outcome="text"}` subir en `/metrics` desde la red interna.
4. **Vuelta atrás**: revertir el PR y redesplegar la imagen anterior (procedimiento de 35b). La fusión del revert (y la de
   su vuelta) sigue las reglas de la clase 3 de Q1; dentro de un periodo prohibido, se vuelve desde el host sin tocar
   `main` y el revert espera. Los CV leídos con el código
   nuevo se quedan; un CV en `pending` en el momento del cambio lo lee la imagen anterior.

## Costo estimado

51 tareas de menos de una hora (`tasks.md`, 0.1-11.5), más la parte de la medición de paridad que hace el owner con sus CV
(8.5). El paso de hilo a proceso hijo añade unas **3-4 h** sobre la versión anterior (estimación de `critic`,
iteración 1): construcción de la línea de órdenes con permisos y su test (1.2), el marco del canal propio (1.1, 1.4), el
vigía sobre `/proc/<pid>/statm` (1.6) y las pruebas de permisos (1.7).

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] — ¿Excepción a la precedencia de la fila 35, y para qué fusiones?**
  Reglas vigentes que acotan cualquier fusión a `main` mientras 35b esté abierta:
  - el PR-1 de 35b ya está en `main` (#86), y `openspec/changes/staging-host/tasks.md` dice «Entre PR-1 y PR-2 no se
    fusiona nada a `main`» (y en particular nada durante su ensayo 9.1-9.4);
  - D15 de `e2e-suite` prohíbe fusionar entre el PR-2 de 35b y su 11.6 (la 11.6 relanza dos despliegues seguidos);
  - los días 7 y 14 de la medición de 35b no se despliega nada a staging, y una fusión a `main` despliega;
  - una corrida `e2e-remote` prueba el commit desplegado: una fusión ese día lo cambia bajo sus pies.

  **La excepción que firma el owner cubre todas las fusiones que este change necesita**, en tres clases:

  1. **La fusión del change**: solo en la ventana **después de la 11.6 de 35b y antes de su 10.7**. Es la única ventana
     válida antes de invitar. No hace falta la cláusula de los días 7 y 14: la ventana termina antes de la 10.7, y la
     medición empieza con ella. La precondición de la 10.7 (`e2e-remote` en verde sobre el commit desplegado) se corre
     sobre el commit que deja esta fusión.
  2. **El PR de archivo** (anotaciones posteriores a la fusión: número del PR, hash del merge, ADR-058 a Aceptado,
     D3 · Estado, deltas aplicados). Se fusiona **después de la 10.7 de 35b**, y con las reglas de la clase 3.
  3. **Las fusiones de vuelta atrás**, si hacen falta, y la vuelta de esas vueltas atrás. Reglas de las clases 2 y 3:
     **nunca** entre el PR-2 de 35b y su 11.6, **nunca** durante su 9.1-9.4, **nunca** los días 7 y 14 de la medición,
     **nunca** el día de una corrida `e2e-remote`. Si staging necesita volver atrás dentro de un periodo prohibido, se
     vuelve **desde el host** con el procedimiento «vuelta atrás sin GitHub» de 35b (su 11.2), que no toca `main`, y la
     fusión del revert espera al primer día permitido.

  **Condición, sea cual sea la respuesta (PO-04):** este change **no bloquea la 10.7 de 35b**. Si 35b llega a la 10.7
  antes de que este change esté listo, decide el owner entre esperar o invitar con el código de hoy (y entonces la
  clase 1 ya no tiene ventana antes de invitar: vuelve al owner).

  - (a) Sí: se aplica en paralelo; la fusión del change va en la ventana de la clase 1, el PR de archivo y las vueltas
    atrás con las reglas de las clases 2 y 3. Como ADR-055 §1 hizo con `usage-guide-fixes`.
  - (b) No: entra justo después de 35c (posición actual en `openspec-changes.yaml`).
  - (c) Como (a), pero sin tocar `verify-artifact.sh` ni `infra/README.md`: la sección de la sonda (D11) se traslada a
    35c.
  - (d) Como (a), pero el owner **autoriza expresamente una excepción a la regla «entre PR-1 y PR-2 no se fusiona nada»**
    de 35b, para la fusión del change antes de su PR-2 (fuera de 9.1-9.4). Riesgo: la 6.3 de 35b despliega el commit
    del PR-1 relanzando su corrida; un commit más en `main` no cambia lo que la 6.3 despliega, pero sí lo que despliega
    el siguiente push, y deja `main` por delante de staging. Si se elige, la excepción se anota en
    `staging-host/tasks.md` junto a la regla. Las clases 2 y 3 no cambian.
  - **Recomendación: (a).** El riesgo nace con las invitaciones de 35b, la ventana existe sin tocar ninguna regla de 35b,
    y el change no toca nada de lo que la fila modifica salvo una sección de un script de CI y su gemela en
    `infra/README.md`. Respuesta del owner: pendiente. Se anota aquí y en ADR-058 en una línea que empiece por
    «Respuesta del owner (Q1), AAAA-MM-DD:», que nombra las tres clases; si es (a), (c) o (d), además una línea en
    ADR-048 §Consecuencias como las de ADR-053 y ADR-055.

  **Cómo se comprueba cada fusión (tareas 11.2-11.5).** La casilla de la 10.7 de 35b se marca recién en el PR de
  archivo de 35b, después de invitar, así que no sirve para saber si la 10.7 está hecha. El estado de la 9.1-9.4, la
  11.6 y la 10.7 se toma de una **confirmación escrita y fechada del owner en el PR** que se va a fusionar («11.6 hecha
  el AAAA-MM-DD; 10.7 no hecha»), junto con si hoy es día 7 o 14 o día de una corrida `e2e-remote`; el PR-2 de 35b se
  identifica **por su número** en `git log` de `main`; las casillas de `staging-host/tasks.md` (en `main` o en la rama
  de archivo de 35b) son solo apoyo. Para la clase 1, si el owner declara la 10.7 hecha, el resultado es «fuera de
  ventana». Nada de la clase 2 se escribe en `main` justo después de fusionar el PR del change.
- **Q2 [cerrada en el debate, iteración 1] — Texto de «el archivo era demasiado complejo».** Opciones: (a) no tocar
  nada; (b) motivo nuevo en `libs/shared` + textos + SPA; (c) reescribir solo el texto existente de `unreadable_file`.
  **Decisión del debate (PO-02): (c)**, en D13, sujeta a la aprobación humana del change. (b) queda para cuando 35b
  muestre cuántas lecturas acaban con `cause="timeout"`.
- **Q3 [no bloqueante] — Umbral de crecimiento de la imagen del worker.** Opciones: (a) ≤ 30 MB sin preguntar, más
  vuelve al owner; (b) cualquier tamaño; (c) ≤ 10 MB, que probablemente obliga a `unpdf`. **Recomendación: (a).**
- **Q4 [no bloqueante] — ¿Fijar `CV_EXTRACT_CONCURRENCY` a 1?** Con el vigía por hijo ya no hay daño colateral; queda
  la suma de memoria (R4). Opciones: (a) dejar el rango 1-4 con el `warn` de D5 y el RUNBOOK; (b) bajar el máximo a 1.
  **Recomendación: (a)**: el rango es un contrato de configuración vigilado y el valor real es 1.
- **Q5 [no bloqueante] — `mem_limit` del contenedor del worker.** Segunda barrera para R3. Toca el compose de
  producción. **Recomendación:** después de la fila 35, en un change propio con medición de memoria en staging.
- **Q6 [no bloqueante] — ¿Alertas de vulnerabilidad de Renovate sin aprobación del Dashboard para los parsers?**
  `vulnerabilityAlerts` con `dependencyDashboardApproval: false` para `pdfjs-dist`, `mammoth`, `@xmldom/xmldom` y
  `jszip`. Contradice en parte la decisión del PR #88, así que es del owner. **Recomendación:** sí, solo para alertas de
  seguridad de esos cuatro paquetes.
- **Q7 [no bloqueante] — ¿Cómo se corta la red del hijo, y cuándo?** (R8). Opciones: (a) aceptar el riesgo hasta subir
  de línea de Node, y entonces añadir el flag de red del modelo de permisos en el change de la subida; (b) un change
  propio, después de la fila 35, que ponga autenticación a MongoDB y Redis (toca compose y secretos); (c) el contenedor
  de extracción sin red (alternativa de D1); (d) aceptar el riesgo sin plazo. **Recomendación: (a) y (b)**: (a) es
  gratis cuando llegue, y (b) cierra además el mismo hueco para cualquier otro fallo del worker.

## D3 · Estado

Pendiente del spike (tareas 8.1-8.6). Se completa aquí con la biblioteca elegida, la versión exacta, la lista exacta de
`--allow-fs-read`, el tiempo de arranque del hijo, el incremento de la imagen medido tras la poda, las licencias, la
decisión sobre `disableNormalization` y el resultado de la paridad (sintética y de productores reales).

## Debate — iteración 1

Fecha: 2026-10-28. `critic`: 1 P0 (H1), H2-H13. `business`: 0 V0, PO-01 a PO-08. Decisiones de `reflect` aplicadas en
`proposal.md`, este design, los deltas de `cv/extraction` y `web/cv`, `tasks.md`, ADR-058 y las anotaciones de ADR-028.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| H1 (P0) | critic | Aceptado, opción fuerte: proceso hijo por CV con `env: {}`, modelo de permisos de Node (`--permission`, `--allow-fs-read` por ruta), límites de heap por flags y vigía sobre el RSS del hijo (D1, D5, D7). Canal propio por pipe en vez del IPC de `fork` | Un `worker_thread` comparte proceso: puede leer `/proc/self/environ` con las credenciales. Comprobado: el modelo de permisos es estable en Node 22.23 y deniega `/proc/<ppid>/environ`; el IPC de `fork` tumba al padre con una línea inválida, y los descriptores abiertos escapan al modelo |
| H2 | critic | Aceptado: un mensaje inválido o una salida sin resultado **después** de `ready` es contenido; antes, maquinaria (D6). Dos tests (1.4) | `ready` es la frontera entre nuestro código y el archivo |
| H3 | critic | Aceptado: oyentes explícitos, `CvExtractionMachineryError` con mensaje fijo y sin `cause`, `code` con `^[A-Z0-9_]{1,64}$`, `ZodError` nunca registrado, canario en log y en `job.failedReason` (D6, 1.5, 4.4) | El mensaje del error acaba en `failedReason` y en el registro |
| H4 | critic | Aceptado: Context §2 y D8 describen `deferredFailure` + `UnrecoverableError` de BullMQ 6.3.6; el oyente marca si `UnrecoverableError` o `finishedOn`; el doble imita esa forma (2.2) | El mecanismo descrito antes no era el real |
| H5 | critic | Aceptado: 4 h por biblioteca; si fallan las dos, `pdf-parse` 1.1.4 aislado + pregunta al owner; (c)/(d) como (a)/(b); spike sin canvas ni `Worker` anidado; (b) medido tras la poda (D3) | Criterio de parada sin agujeros |
| H6 | critic | Aceptado: versión exacta en `dist/apps/worker/package.json`, `import()` literal y test de que el bundle del hijo no importa `@nestjs/*`, `pino` ni la configuración (D12, 3.6) | Que funcione en la imagen y que el hijo no cargue el worker |
| H7 / PO-03 | critic / business | Aceptado: medición única en 8.4-8.5 sobre ≥ 5 PDF de productores reales (persona inventada desde Word, LibreOffice, Google Docs, LaTeX y plantilla a dos columnas) y 5-6 CV reales **del owner en su máquina**, sin commitear; recall ≥ 0,98 y orden de bloques; caída ≥ 5 % vuelve al debate; decisión sobre `disableNormalization`; igualdad exacta solo en sintéticos (D3, R6) | Los fixtures sintéticos no representan los PDF que suben las personas |
| H8 | critic | Aceptado: el spec dice «por las causas de la tabla»; test de asignación enorme (1.6). Comprobado: con el hijo, la asignación mata solo al hijo y el worker sigue (~48 MiB) | Un hilo no protegía de un fallo de asignación del proceso |
| H9 | critic | Aceptado: el plazo de contenido corre desde `ready`; red exterior = plazo + 5 s + 2 s, por debajo de `lockDuration` (D2) | El arranque no debe comerse el plazo del archivo |
| H10 | critic | Aceptado: D4 corregido (directorio central para tamaño y método, cabecera local validada para ubicar los datos, `stored` cuenta para el presupuesto; `word/media/*` opcional) | La versión anterior describía mal el lector |
| H11 | critic | Aceptado: bomba generada por streaming; base de memoria tras `global.gc()` o vigía inyectado (D10, 5.4) | Bases tomadas en frío dan falsos rojos y verdes |
| H12 | critic | Aceptado y mejorado por H1: el vigía mide cada hijo, así que «termina las lecturas en curso» pasa a «termina la lectura de ese hijo»; `warn` si `CV_EXTRACT_CONCURRENCY > 1`; RUNBOOK explica `memory_ceiling` (D5, 4.3, 10.1) | Con el RSS del hijo la atribución es exacta |
| H13 | critic | Aceptado (a)-(e): 1.1/3.2/4.3 de la versión anterior partidas; falsaciones nuevas en 5.8 (con precondición del canario), 3.4, 5.1, 5.2 y 6.2; 5.7 con bucle acotado; test «un proceso por CV» (1.3); 7.3 con `workflow_dispatch` en modo de prueba | Tareas < 1 h y guardias que se pueden poner en rojo |
| PO-01 | business | Aceptado: el campo extra ZIP64 con valores de 32 bits se acepta; solo se rechaza el ZIP64 de verdad. Fixture «small docx with zip64 extra field is extracted» (D4, 3.1) | Rechazaba DOCX legítimos |
| PO-02 | business | Aceptado, Q2 (c): se reescribe solo el texto de `@@cv.status.unreadable` en ES y EN (D13, 9.1, delta de `web/cv`) | El texto hablaba solo de contraseñas |
| PO-04 | business | Aceptado: Q1 lleva la condición de no bloquear la 10.7 de 35b; orden de tareas: aislamiento y `pending` eterno primero, biblioteca al final (D3, `tasks.md`) | Lo que cierra el riesgo no espera a la biblioteca |
| PO-05 | business | Aceptado: un solo contador `linkvault_cv_extractions_total{format,outcome,cause}`; topes en `cause`, duración en el registro (D9) | Tres instrumentos para un volumen de cero |
| PO-06 | business | Aceptado: la 5.5 es un solo caso de punta a punta | Las demás piezas ya están en 3.1-3.2 |
| PO-07 | business | Aceptado con H1 | Mismo hallazgo desde el lado del producto |
| PO-08 | business | Aceptado: la paridad se repite con la candidata adoptada (D3, 8.6) | La medición vale para la biblioteca medida |
| Ventana | critic (P0 en otro change) | Q1 reescrita: única ventana antes de invitar, entre la 11.6 y la 10.7 de 35b, nunca días 7 y 14; opción (d) de excepción expresa; tarea 11.2 que verifica la ventana | La ventana de la versión anterior chocaba con reglas de 35b y de `e2e-suite` |
| Ventana (2) | coordinador (debate de otro change) | La 11.2 toma el estado de la 11.6 y de la 10.7 de una confirmación escrita y fechada del owner en el PR, con el PR-2 de 35b por su número y las casillas solo como apoyo; falsación «10.7 hecha → fuera de ventana». Las anotaciones posteriores a la fusión viajan en el PR de archivo, que se fusiona después de la 10.7 de 35b y fuera de los días 7 y 14 con la misma guardia (11.4) | La casilla de la 10.7 se marca después de invitar; el PR de archivo también despliega a staging |
| Ventana (3) | coordinador (P0 de critic en otro change) | La excepción de Q1 cubre las tres clases de fusión: la del change (ventana 11.6-10.7, sin cláusula de días 7 y 14), el PR de archivo y las vueltas atrás (nunca entre PR-2 y 11.6 de 35b, nunca en su 9.1-9.4, nunca días 7 y 14, nunca un día de `e2e-remote`); 11.2-11.5 verifican cada fusión del change en `main` | Una excepción que solo cubre la primera fusión deja sin regla las que vienen después |

Convergencia: NO (pendiente de la iteración 2).
