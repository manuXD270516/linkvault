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
- Fila 35: no se tocan compose, workflows, `.env.example` ni requirements de `platform/*` (Q1). **Sí** se tocan dos
  líneas de la etapa `runner` de `docker/worker.Dockerfile` (`ENV NODE_OPTIONS=--disable-sigusr1` y el `CMD`, D7 · N1,
  C3-01) y dos opciones de `serve` en `apps/worker/project.json` (`runtimeArgs` e `inspect: false`, C3-06); no choca
  con esa condición: la fila 35 no edita ese Dockerfile (35b y 35c no lo nombran en sus tareas ni en su `scope`; los
  workflows solo lo citan por su ruta en `file:`), el compose de producción no sobrescribe el `command` del `worker`
  (así que manda el `CMD` de la imagen), su `environment` es un mapa explícito sin `NODE_OPTIONS` y sin `env_file` (así
  que manda el `ENV` de la imagen) y ningún requirement de `platform/*` fija ese `CMD` ni ese `ENV` (comprobado con
  `grep` el 2026-10-28). La condición de Q1 no necesita ajuste; se hace explícita aquí y en la propuesta.
- El worker se empaqueta con webpack (`apps/worker/webpack.config.js`, `compiler: 'tsc'`, `module: commonjs`) y corre en
  `node:22.23.2-alpine` como PID 1 (`CMD ["node", "main.js"]` hoy), `linux/arm64` en el destino (ADR-051 §3, ADR-052).
- **Partición (B2-01, 2026-10-28):** este change aísla la lectura con las bibliotecas de hoy (`pdf-parse` 1.1.4 y
  `mammoth`). El spike, la sustitución de pdf.js y la paridad con CV reales pasan a **`cv-pdf-library-upgrade`**,
  después de 35c y sin excepción (`openspec-changes.yaml`).

## Goals / Non-Goals

**Goals**

- Que ningún archivo subido pueda bloquear el event loop del worker ni hacer que se reentregue por `stalled`.
- Que el plazo **detenga** el trabajo, y que un archivo que agota plazo, heap o topes termine en `unreadable_file` sin
  reintentos.
- Que el código que abre el archivo **no tenga a su alcance** los secretos del worker ni su sistema de ficheros.
- Que la memoria que puede consumir una lectura esté acotada también fuera del heap, y medida en el proceso que lee.
- Que una señal del hijo no pueda abrir un depurador en el worker (D7 · N1).
- Que la lectura aislada funcione en la imagen publicada y en `arm64`, con un arranque medido (D11, N8).
- Medir lo que pasa (un contador y una línea de registro por lectura terminada mal) sin una palabra del CV.

**Non-Goals**

- **Sustituir `pdf-parse` por un pdf.js mantenido**: va a `cv-pdf-library-upgrade` (B2-01), con su spike, su medición
  de tamaño y su paridad con CV reales.
- Un motivo nuevo en `/mi-cv` (Q2 quedó en reescribir el texto existente, D13).
- Aislar a nivel de contenedor (`mem_limit`, servicio aparte) (Q5, alternativas de D1).
- Cortar la red del proceso que lee (no hay mecanismo en Node 22; riesgo aceptado R8, Q7).
- Impedir que el hijo mande señales al worker: comparten usuario (D7, R8).
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
  '--allow-fs-read=/app/cv-extract-child.js',   // una ruta por flag, cada una pasada por fs.realpathSync.native
  '--allow-fs-read=/app/node_modules',
  '--allow-fs-read=/app/package.json',          // solo si la 3.5 demuestra que hace falta
  '--max-old-space-size=256', '--max-semi-space-size=16',
  '--disallow-code-generation-from-strings',
  '/app/cv-extract-child.js',
], { env: {}, stdio: ['pipe', 'ignore', 'ignore', 'pipe'], detached: false })
```

- **La lista de `--allow-fs-read` está fijada (N2)** para las bibliotecas de hoy (`pdf-parse` 1.1.4 y `mammoth`), con
  la imagen tal como la deja `docker/worker.Dockerfile` (`WORKDIR /app`, el `dist/apps/worker` copiado ahí):
  1. `/app/cv-extract-child.js`, el script del hijo;
  2. `/app/node_modules`, la raíz desde la que el hijo resuelve sus bibliotecas (con pnpm, los enlaces de
     `node_modules/<paquete>` apuntan a `node_modules/.pnpm/…`, dentro de la misma raíz);
  3. `/app/package.json`, **solo si hace falta**: Node consulta el `package.json` **del ámbito del script** (el más
     cercano subiendo desde su directorio) para saber su tipo de módulo; en la imagen es `/app/package.json`. La tarea
     3.5 lo decide con una prueba: si la sonda pasa sin esa entrada, no entra.

  Nada más. En producción el script es **un solo fichero**: el bundle de webpack del hijo no carga otros chunks por
  ruta relativa (aserción de la 3.6, C3-04). Fuera de la imagen la lista se calcula con **la misma regla**, salvo en el
  primer punto para el hijo de los tests:
  - en desarrollo (`nx serve`, `dist/apps/worker/`): el script, la raíz de `node_modules` donde se resuelven
    `pdf-parse` y `mammoth`, y el `package.json` del ámbito del script si la 3.5 lo exige;
  - en los tests (hijo compilado con `tsc` a `tmp/cv-child-test/`, D10): **el directorio de salida**
    `tmp/cv-child-test/` en lugar del script (C3-04), porque `tsc` emite un fichero por módulo y el script del hijo
    hace `require("./…")` de `child-protocol`, `extraction-limits` y los extractores. El directorio pasa por `realpath`
    como las demás rutas, el `globalSetup` lo vacía antes de compilar (solo contiene la salida de `tsc`) y ningún
    fichero de prueba «fuera de lo permitido» de la 1.7 vive dentro de él. *Descartado:* empaquetar el hijo de los
    tests en un único fichero con «el esbuild de Vite»: el Vite del proyecto es la 8, que empaqueta con rolldown, y
    `esbuild` solo está como dependencia transitiva, no declarada en el `package.json` raíz; usarlo sería una
    dependencia nueva o una implícita.

  El spec dice «las rutas de la lista fijada en el design»: es esta.
- **Rutas reales (N3).** `child-command.ts` pasa cada ruta por `fs.realpathSync.native` antes de construir el flag. El
  modelo de permisos compara contra la ruta resuelta; una ruta con un enlace simbólico (pnpm, un `dist/` enlazado en
  Windows, `os.tmpdir()` en macOS) daría `ERR_ACCESS_DENIED` donde no se espera, o permitiría lo que no se quiere. Test
  «allow-fs-read paths are real paths» (1.2).
- **API de escritura del canal (N11).** El hijo escribe en el descriptor 3 con `new net.Socket({ fd: 3, readable:
  false })` y `socket.write(línea + '\n', cb)`, y **espera al callback**; no usa `fs.writeSync(3, …)`, que en un pipe no
  bloqueante falla con `EAGAIN` en escrituras grandes y cuyo comportamiento en Windows no está probado. El padre lee el
  descriptor 3 como `stdio[3]` (un `Readable`). La 1.3 empieza por una prueba de ida y vuelta de este canal con un hijo
  mínimo, en Windows y en Linux, con una línea de 6 MB; si falla en alguna de las dos, vuelve al debate antes de seguir.
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
  - `--disallow-code-generation-from-strings`: `eval` y `new Function` lanzan `EvalError`. Con el pdf.js 1.10 de
    `pdf-parse`, que compila fuentes con `new Function` cuando puede, es **la** llave contra la clase de fallo de
    CVE-2024-4367 (D3).
- **Límites de memoria del hijo**: `--max-old-space-size=256` y `--max-semi-space-size=16` (equivalen al
  `maxOldGenerationSizeMb: 256` / `maxYoungGenerationSizeMb: 32` de la versión con hilo). Superarlos aborta **el hijo**:
  en Linux sale por `SIGABRT` (comprobado), en Windows con código 134. Sin `--stack-size`: es un flag de V8 que, por
  encima de la pila real del sistema, provoca un fallo de segmentación en vez de un `RangeError`; la recursión profunda
  ya acaba en `RangeError` con la pila por defecto.
- **Salida estándar y de errores a `ignore`**: lo que el hijo escriba no llega a ningún sitio. pdf.js escribe avisos por
  consola, y un aviso puede llevar trozos del documento.
- **Proceso nuevo por CV, sin pool.** pdf.js guarda cachés globales (fuentes, CMaps, objetos) y un proceso reutilizado
  arrastraría estado de una persona a otra. El arranque (Node + bibliotecas) tiene criterio propio: **p95 ≤ 1,5 s en
  `arm64`** (N8, R11), medido por la sonda (D11) en el runner `arm64` (7.4) y en el host de staging tras desplegar
  (Migration Plan).
- **Sin huérfanos en producción.** El hijo no puede lanzar procesos (sin `--allow-child-process`), así que matar al hijo
  mata todo. Si el worker muere, el contenedor muere con él (PID 1: el kernel mata el resto del espacio de PID). En el
  cierre ordenado, el adaptador mata a los hijos vivos (`onApplicationShutdown`). En desarrollo, un `nx serve` matado con
  `SIGKILL` podría dejar un hijo en bucle hasta que alguien lo mate (R10).
- **El worker arranca con `--disable-sigusr1` (N1), y todo Node del contenedor lo hereda por `NODE_OPTIONS`
  (C3-01).** Ver D7.

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

### D3. PDF: `pdf-parse` 1.1.4 se queda, dentro del hijo; la sustitución va a `cv-pdf-library-upgrade` (B2-01)

**Decisión de este change (B2-01, 2026-10-28).** El PDF lo sigue leyendo `pdf-parse` 1.1.4 (pdf.js 1.10.100 embebido),
pero **dentro del proceso hijo** de D1 y detrás de una interfaz interna `PdfTextSource` (un fichero), que es la costura
por la que el change posterior enchufará la biblioteca nueva sin tocar el runner. Lo que cierra este change es la
**disponibilidad** (el event loop, el plazo, el `pending` eterno) y los **secretos** (el hijo no ve el entorno ni el
disco del worker); la **superficie** del parser de 2017 la cierra `cv-pdf-library-upgrade`.

- La carga de `pdf-parse` en el hijo es un `require` de literal de `pdf-parse/lib/pdf-parse.js` (como hoy, para saltar
  el código de depuración de su `index.js`), de modo que webpack y el generador de `package.json` de Nx la vean.
- La evaluación de código queda cortada por `--disallow-code-generation-from-strings` (D1): si pdf.js 1.10 intenta
  compilar una fuente con `new Function`, lanza `EvalError`; según cómo lo trate pdf.js, sigue por su camino
  interpretado o la lectura acaba en `parse_error`. Las dos salidas son aceptables; la 3.4 comprueba que el fixture de
  texto se lee **con** el flag puesto.
- Topes (D5): el de páginas con la opción `max` de `pdf-parse`; el de texto crudo, con un `pagerender` propio que deja
  de pedir `getTextContent` al llegar a 1.000.000 de caracteres. La unión de líneas por coordenada Y es la de
  `pdf-parse`, así que el texto guardado no cambia frente a hoy.
- `withOwnBuffer` se conserva dentro del hijo: los bytes que llegan por `stdin` se juntan con `Buffer.concat`, que
  puede devolver un búfer del *pool* con desplazamiento distinto de cero, y `pdf-parse` lo lee mal (ADR-028).

**Trasladado a `cv-pdf-library-upgrade`** (no se ejecuta aquí): el spike de `pdfjs-dist` (build `legacy`, versión
exacta, `isEvalSupported: false`, sin canvas ni `Worker` anidado, sin fuentes del sistema ni URL remota) con `unpdf`
como alternativa escrita y criterio de parada de 4 h por biblioteca; la medición de tamaño de la imagen tras la poda
(antigua Q3); las licencias; la paridad sintética y con PDF de productores reales y CV reales del owner (antiguas
8.4-8.5, PO-03, PO-08); `disableNormalization`; la vía rápida de Renovate para los parsers (antigua Q6); y los riesgos
de tamaño, ESM desde un bundle `commonjs` y diferencias de texto (antiguas R1, R2, R6). La tabla comparativa de la
iteración 1 (`pdfjs-dist`, `unpdf`, `pdf-parse` 2.x, poppler, `mupdf`) queda como antecedente de ese change en el
historial de este design (commit `5f802d4`).

*Alternativa descartada en la iteración 2:* hacer el spike y la sustitución aquí, al final del change (PO-04). Ata la
fusión del aislamiento, que cierra el riesgo de disponibilidad y de secretos antes de invitar en 35b, a una medición
con CV reales que hace el owner en su máquina y a un tope de 8 h de spike; y mete en la ventana de Q1 un cambio de
dependencia que nadie necesita para esa ventana (B2-01).

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
- **El marco (N4)**: el padre acumula el descriptor 3 como `Buffer` y cuenta **bytes**, no caracteres, con tope de
  8 MiB por línea y en total; solo decodifica en UTF-8 una línea ya completa (hasta el `\n`), así que un carácter de
  varios bytes partido entre dos trozos no cuenta mal ni se corrompe. Cada línea se parsea con `JSON.parse` dentro de
  `try` y se valida con `safeParse` de zod. **El `ZodError` y el texto de la línea nunca se registran ni se
  adjuntan**: de una línea inválida solo queda la causa `protocol`.
- **El tope cabe en el peor caso**: el hijo corta el texto con `slice(0, 1_000_000)` **antes** de serializar. En JSON,
  la peor unidad UTF-16 ocupa 6 bytes (un carácter de control o un sustituto suelto se escriben `\uXXXX`), así que el
  peor texto ocupa 6.000.000 de bytes más el sobre, por debajo de 8 MiB (8.388.608). Test «a 1M-char worst-case
  escaped result arrives intact», en Linux y en Windows (1.4c).
- **El hijo no sale por su cuenta**: tras escribir su resultado espera; el padre, cuando tiene la línea completa, lo
  mata con `SIGKILL` y resuelve tras el `exit`. Así una salida del hijo nunca trunca un resultado a medio escribir, y
  un `exit` después de un resultado completo se ignora (la promesa ya se resolvió).
- **Un `ready` o un `boot_error` después de `ready` es `protocol`** de contenido (N5): el protocolo solo admite, tras
  `ready`, un `text` o un `failed`. Test «boot_error or ready after ready is unreadable protocol» (1.4b).
- **`CvExtractionMachineryError`**: mensaje **fijo** `cv extraction machinery failure: <causa>` (causa de la lista
  cerrada), **sin `cause`** ni propiedades con datos del hijo, salvo `code` validado con `^[A-Z0-9_]{1,64}$` en
  `boot_error`. Es lo que BullMQ guarda en `job.failedReason`, así que ese campo tampoco puede llevar nada del CV; un
  test con canario lo fija.
- Así un despliegue roto (el script del hijo ausente) **no** deja todos los CV en «No pudimos abrir este archivo»: los
  deja en `pending` reintentando y, agotados, en «No pudimos leerlo ahora», que es la verdad. Y la sonda de D11 lo para
  antes de publicar.
- El puerto no cambia: `unreadable_file` sigue sin causa. La causa vive en el contador y en el registro (D9).

### D7. El hijo no ve secretos, no lee el disco, no habla por su cuenta y no abre el depurador del worker

Lo que el mecanismo **da**, y nada más (los SHALL del spec prometen exactamente esto):

- **Sin variables de entorno del worker** (`env: {}`), y sin forma de leer las del worker por `/proc`: el modelo de
  permisos deniega leer cualquier fichero fuera de las rutas de la lista fijada en D1.
- **Sin escribir en disco, sin lanzar procesos ni hilos, sin código nativo, sin `eval`.**
- **Sin salida visible**: `stdout` y `stderr` a `ignore`.
- **Ningún mensaje de error del hijo se registra**: solo su causa de una lista cerrada (D9) y, en `boot_error`, el
  `code` validado (`ERR_MODULE_NOT_FOUND`, …), nunca su `message`.
- **Una señal del hijo no abre el depurador del worker (N1).** El modelo de permisos **no** impide `process.kill`: el
  hijo corre con el mismo usuario que el worker y puede mandarle señales. Sin más, un `SIGUSR1` al padre arranca el
  inspector del worker en `127.0.0.1:9229`, y el hijo —que tiene red (R8)— podría conectarse y ejecutar código **en
  el worker**, con su entorno y sus credenciales: todo D1 deshecho por una señal. Comprobado el 2026-10-28 en
  `node:22.23.2-alpine` (la versión fijada en la imagen) y `node:22.23.3-alpine`: un hijo con `--permission` y `env: {}`
  manda `SIGUSR1` a su padre y el padre abre el 9229; con el padre lanzado con `--disable-sigusr1`, el padre sigue vivo
  y el 9229 queda cerrado (`ECONNREFUSED`). El flag existe desde Node 22.14.0 y es estable desde 22.20.0 (documentación
  de la CLI de Node), así que está en la 22.23.2 del `.nvmrc` y de la imagen.

  **No solo el PID 1 (C3-01, C3-03).** En el contenedor del worker corren otros procesos Node con el mismo usuario y
  **el entorno completo del contenedor** (credenciales incluidas): el `HEALTHCHECK` de la imagen y el healthcheck del
  compose (`node -e "fetch(…)"`, cada 30 s y cada 10 s), la sonda `node cv-extract-probe.js` y cualquier `docker compose
  exec worker node …`. El hijo puede mandarles `SIGUSR1` igual que al PID 1, y un inspector abierto en uno de ellos es
  el mismo hueco. Medido el 2026-10-28 en `node:22.23.2-alpine`, con contenedores desechables:

  | Orden | Salida | Lectura |
  |---|---|---|
  | `docker run --rm node:22.23.2-alpine sh -c 'node --disable-sigusr1 -e "setTimeout(()=>{},3000)" & p=$!; sleep 0.5; kill -USR1 $p; wait $p; echo exit=$?'` | `exit=0` | **C3-03**: fuera de PID 1, con el flag, el proceso **sobrevive** a `SIGUSR1` (sale 0 a los 3 s, no por la señal). No hace falta `process.on('SIGUSR1', …)` en `main.ts` |
  | `docker run --rm -e NODE_OPTIONS=--disable-sigusr1 node:22.23.2-alpine node -p 1` | `1` (código 0) | **C3-01**: Node acepta el flag en `NODE_OPTIONS` |
  | control: `node -e "setTimeout(()=>console.log('url='+require('inspector').url()),2000)"` en segundo plano, `kill -USR1` a los 0,5 s, sin flag | `Debugger listening on ws://127.0.0.1:9229/…` y `url=ws://127.0.0.1:9229/…`, `exit=0` | sin el flag, un proceso cualquiera del contenedor abre el inspector |
  | lo mismo, con `-e NODE_OPTIONS=--disable-sigusr1` y **sin** flag en la línea de órdenes | `url=undefined`, `exit=0` | el flag por `NODE_OPTIONS` basta: sobrevive y el inspector no se abre |

  Por eso, y **sin manejador en `main.ts`** (la medición de C3-03 lo hace innecesario; tampoco se pone vía `--require`,
  porque `NODE_OPTIONS` ya protege al healthcheck, que es el proceso que no pasa por `main.ts`):
  - `docker/worker.Dockerfile`, etapa `runner`: `ENV NODE_OPTIONS=--disable-sigusr1` (lo heredan el PID 1, los dos
    healthchecks, la sonda y cualquier `exec`; no lo hereda el hijo, que arranca con `env: {}`, ni le hace falta);
  - `docker/worker.Dockerfile`: `CMD ["node", "--disable-sigusr1", "main.js"]` **se queda**: es la segunda barrera del
    PID 1 si alguien llegara a poner un `NODE_OPTIONS` propio en el `environment` del compose, que lo sustituiría (no
    se suma); la guardia 1.10 comprueba que hoy el compose no lo hace;
  - `apps/worker/project.json`, `serve.options`: `"runtimeArgs": ["--disable-sigusr1"]` (la opción del ejecutor
    `@nx/js:node` que llega al `execArgv` del worker) y `"inspect": false` (C3-06, B3-04);
  - tarea 1.9 (test en Linux con un padre real y con un hermano lanzado solo con `NODE_OPTIONS`) y 1.10 (guardia
    estática del `ENV`, el `CMD`, `serve` y la ausencia de `NODE_OPTIONS` en el `environment` del `worker` del compose).

  **`nx serve` (Q8, resuelta en la iteración 3 por `reflect`, C3-06/B3-04; el owner la puede revertir):** el ejecutor
  `@nx/js:node` arranca por defecto con `inspect: "inspect"`, es decir, con el inspector **ya abierto** en el 9229, y
  ahí `--disable-sigusr1` no cambia nada: el hijo puede conectarse sin mandar señal. Pasa a `"inspect": false` en
  `serve.options`, **sin** configuración `debug`: quien quiera depurar corre `pnpm nx serve worker --inspect=inspect`
  (una línea en el RUNBOOK, 10.1). El proceso de `nx` en sí queda fuera (R10).

Lo que **no** da:

- **La red**. En Node 22 el modelo de permisos no restringe sockets. Ver R8 y Q7.
- **Aislamiento de señales**: **no** se promete impedir señales entre procesos del mismo usuario. Un `SIGTERM` (o
  `SIGINT`) del hijo al worker dispara su cierre ordenado (`enableShutdownHooks`) y el contenedor se reinicia por
  `restart: unless-stopped`; un `SIGKILL` al PID 1 desde dentro de su espacio de PID lo ignora el kernel. Es una
  **denegación de servicio aceptada**, acotada por D8: el job en curso se reentrega como mucho una vez y después el CV
  queda en `failed`/`internal_error`, así que un archivo que «mata» al worker lo hace como mucho dos veces. Ver R8.

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
  temporal**: bucle síncrono acotado más largo que el plazo, heap creciente, `Buffer.alloc` sin fin, `process.exit(3)`, uno que nunca dice `ready`,
  uno que dice `boot_error`, uno que escribe basura en el descriptor 3 antes y después de `ready`, uno que sale con 0 sin
  resultado, uno que escribe en `stdout`, uno que lee `process.env`, `/proc/<ppid>/environ` y un fichero fuera de lo
  permitido. El adaptador recibe la ruta del script y la lista de lecturas permitidas como parámetros de construcción.
- **Los parsers reales** se prueban dentro del hijo real con archivos generados (lista y nombres en `tasks.md`, grupos 3
  y 5). **El hijo real de los tests se compila aparte (N7)**: solo `cv-extract.child.ts` y lo que importa, con un
  `tsconfig` propio (`module: commonjs`) a `tmp/cv-child-test/`, en el `globalSetup` del proyecto de Vitest de
  aislamiento; **sin** `pnpm nx build worker`, que tarda y arrastra el bundle entero. La lista de lecturas de ese hijo
  sale de la regla de D1 para los tests: el **directorio** `tmp/cv-child-test/` pasado por `realpath` (C3-04), la raíz
  de `node_modules` del workspace y, si la 3.5 lo exige, el `package.json` del ámbito del script. Lo fija la tarea 3.5.
- **Los specs de aislamiento no corren en paralelo ni dejan hijos (N6)**: un proyecto de Vitest propio,
  `worker-isolation` (en `test.projects` del `vitest.config.mts` del worker), con `fileParallelism: false`, que incluye
  `infrastructure/isolation/**/*.spec.ts` y `extractors/pathological.spec.ts` (el proyecto `worker` los excluye).
  **Forma en Vitest 4 (C3-05)**, con el Vitest 4.1 del proyecto:
  - los dos proyectos llevan `extends: true`, así heredan de la raíz el plugin `unplugin-swc` (sin él se pierden los
    metadatos de decoradores y la inyección de Nest), el `testingPreset` y el `env`;
  - `coverage` queda **en la raíz** (en Vitest 4 no es opción de proyecto);
  - `worker-isolation` declara `pool: 'forks'` y `execArgv: ['--expose-gc']` (en Vitest 4 `poolOptions` ya no existe;
    `execArgv` es opción de `test`), y su `globalSetup` propio compila el hijo (3.5);
  - **Mongo:** `worker-isolation` **no lo necesita** (la 4.4 usa el repositorio en memoria y la 5.7 solo
    `/health/live`), pero con `extends: true` hereda el `globalSetup` de Mongo del preset, porque Vitest concatena las
    listas. Se acepta (un replset más por corrida) y la 1.0 anota en «Estado de las mediciones» cuánto añade; si pasara
    de 10 s, el preset se aplica solo al proyecto `worker` en vez de a la raíz;
  - test «worker project keeps decorator metadata» (un proveedor de Nest resuelto por constructor en el proyecto
    `worker`) y «isolation project runs files serially».

  Además, un
  `afterEach` común que mata con `SIGKILL` cualquier hijo que el runner tenga aún en su conjunto de vivos; ningún bucle
  sin fin en los hijos de prueba: todos son **acotados** (p. ej. `while (Date.now() < fin)` con `fin` a 10 s), de modo
  que un fallo del runner nunca deja un proceso girando en CI; y el test de heap usa un hijo con heap **inyectado** más
  chico (`--max-old-space-size=32`) y un plazo de 30 s.
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
leer lo que el hijo necesita y que `pdf-parse` y `mammoth` cargan dentro del hijo (ADR-048: una imagen que construye no
es una imagen que funciona).

**Medición del arranque (N8).** Tras las dos lecturas comprobadas, la sonda arranca 20 hijos más hasta `ready` (y los
mata) e imprime `boot_p50_ms=<n> boot_p95_ms=<n>`. **No** falla por el valor —un umbral de rendimiento en CI es
ruidoso—; el criterio, **p95 ≤ 1.500 ms en `arm64`**, se comprueba leyendo esa línea en la corrida del runner `arm64`
(7.3, 7.4) y en el host de staging tras desplegar (Migration Plan). Si no se cumple, el change vuelve al debate.

### D12. Configuración y contratos que no cambian

- `CV_EXTRACTION_TIMEOUT_MS` (1.000-120.000, por defecto 30.000) y `CV_EXTRACT_CONCURRENCY` (1-4, por defecto 1)
  conservan nombre, rango y valor. Cambia la semántica del plazo: ahora corta, y corre desde `ready`.
- `CvTextExtractor`, `ExtractionAttempt`, `CvRepository`, `CvExtractionFailureReason` y los schemas de `libs/shared` no
  cambian.
- La regla de lint de la capa de dominio conserva `pdf-parse` y `mammoth` en su lista y gana
  `node:child_process`/`child_process`: lanzar un proceso es infraestructura.
- **El bundle del hijo no importa nada del worker** (H6): ni `@nestjs/*`, ni `pino`, ni el módulo de configuración. Un
  test sobre el fichero construido lo fija. Sus bibliotecas se cargan con `require` de **literal de cadena** (para que
  webpack y el generador de `package.json` de Nx las vean), y `dist/apps/worker/package.json` las lista con versión
  exacta.

### D13. El texto de `unreadable_file` deja de hablar solo de la contraseña (PO-02)

Hoy `@@cv.status.unreadable` dice «No pudimos abrir este archivo. Si tiene contraseña, quítasela y vuelve a subirlo.»,
y con este change ese desenlace cubre también plazos, heap y topes, que no tienen que ver con la contraseña. Se
reescribe **solo el texto**, sin motivo nuevo ni cambios en `libs/shared` (Q2, opción (c) del debate):

- ES: «No pudimos abrir este archivo. Si tiene contraseña, quítasela; si no, vuelve a exportarlo desde tu editor (en PDF
  o DOCX) y súbelo otra vez.» (B2-04, 2026-10-28; sustituye al texto de la iteración 1.)
- EN: «We could not open this file. If it has a password, remove it; otherwise, export it again from your editor (as a
  PDF or DOCX) and upload it again.»

Se edita la plantilla de `cv-card.component.html`, `messages.en.xlf` (`source` y `target`) y se regenera
`messages.xlf` con `pnpm nx run web:extract-i18n` (ADR-050). Delta en `web/cv`, «Lista de CV guardados con su estado».

## Risks / Trade-offs

R1, R2 y R6 (tamaño de la imagen con pdf.js nuevo, ESM desde un bundle `commonjs`, diferencias de texto con el pdf.js
nuevo) pasaron a `cv-pdf-library-upgrade` con la partición (B2-01). Los demás conservan su número.

- **R3 — Memoria entre muestras del vigía.** En 100 ms un inflado rápido puede reservar memoria antes de que el vigía
  actúe (medido: ~36 MiB de exceso con búferes de 256 MiB). El techo real es «+512 MiB y lo que quepa en 100 ms», solo
  para el hijo. El `mem_limit` del contenedor sería la segunda barrera (Q5).
- **R4 — Memoria total con concurrencia > 1.** Ya no hay daño colateral (cada hijo tiene su vigía), pero N lecturas a la
  vez suman N techos. Aceptado con el valor por defecto en 1, el `warn` de D5 y el RUNBOOK (Q4).
- **R5 — Correlación de registros por tiempo** (D9). Aceptada con concurrencia 1.
- **R7 — El parser de PDF sigue sin correcciones.** `pdf-parse` 1.1.4 trae pdf.js de 2017 y nadie lo va a parchear. Este
  change acota lo que un fallo suyo puede hacer (sin secretos, sin disco, sin `eval`, sin procesos, con plazo y topes),
  no lo elimina. La sustitución, y la latencia con que Renovate traería las correcciones de la biblioteca nueva (antigua
  Q6), son de `cv-pdf-library-upgrade`, que entra después de 35c.
- **R8 — El hijo tiene red y puede mandar señales al worker.**
  - **Red.** En Node 22 el modelo de permisos no restringe sockets, y el hijo comparte la red del contenedor del worker,
    donde MongoDB y Redis responden **sin autenticación** (`docker-compose.prod.yml`, red interna) y hay salida a
    Internet (el enriquecimiento la necesita). Un parser comprometido con ejecución de código podría conectarse a ellos.
    **Estado del flag de red (B2-05, comprobado el 2026-10-28 contra la documentación de la CLI y el índice de
    versiones de nodejs.org):** `--allow-net` llegó en **Node 25.0.0** (2025-10-15), una línea impar que nunca es LTS; en
    la documentación de la 26 sigue en *Stability 1.1 — Active development*. Con el modelo de permisos activo, desde la
    25 la red queda **denegada por defecto** salvo `--allow-net`: en esa línea, el hijo de D1 se quedaría sin red sin
    añadir ningún flag. La primera línea **LTS** que lo trae es **Node 26 («Lithium»)**, que pasó a LTS **hoy,
    2026-10-28, con la 26.13.0**. La línea 24 («Krypton», LTS) no lo trae. El proyecto está en la 22 («Jod», LTS).
  - **Señales.** El modelo de permisos no impide `process.kill`: el hijo puede mandar señales al worker, que corre con
    el mismo usuario. Lo peligroso, `SIGUSR1` (abre el inspector), queda cerrado con `--disable-sigusr1` (D7, N1) en
    el PID 1 y, por `ENV NODE_OPTIONS=--disable-sigusr1` en la imagen, en todo otro Node del contenedor con el entorno
    del worker (healthchecks, sonda, `exec`), medido el 2026-10-28 (C3-01, C3-03). Queda una condición: si alguien
    pusiera un `NODE_OPTIONS` propio en el `environment` del `worker` del compose, sustituiría al de la imagen y los
    healthchecks quedarían sin el flag (el PID 1 conserva el del `CMD`); la guardia 1.10 lo comprueba.
    **No** se promete impedir el resto: un `SIGTERM` o `SIGINT` del hijo provoca el cierre ordenado del worker y su
    reinicio por `restart: unless-stopped`. Es una **denegación de servicio aceptada, acotada por D8**: como mucho dos
    aperturas del mismo archivo y después el CV queda en `failed`/`internal_error`.
  - **Riesgo aceptado**, porque:
    - exige ejecución de código en pdf.js o `mammoth` con `eval` desactivado, sin código nativo, sin `process.binding`,
      sin lanzar procesos y sin leer el disco: una cadena de fallos, no uno;
    - el hijo no tiene **ninguna credencial** (ni S3, ni IA, ni la URI con usuario, que hoy no existe) y no puede abrir
      el depurador del worker;
    - hoy es estrictamente peor: el parser corre en el worker con todo lo anterior y además con las credenciales;
    - la mitigación de fondo es de otro change (Q7).
- **R9 — Solape con la fila 35 en `verify-artifact.sh` e `infra/README.md`.** Una sección nueva en el script, y la
  misma orden en el `up` documentado de `infra/README.md`, porque `check-docs-stack-up` exige que los dos tengan las
  mismas órdenes `run` en el mismo orden (hoy 3: `provision`, `verify`, `s3-probe.js`). 35c edita otro tramo del script
  (`--wait-timeout`); `infra/README.md` lo tocan 35b y 35c, así que el conflicto, si aparece, es de una línea. Si el
  owner quiere cero solape, D11 queda en su entrada de build y las dos líneas se mueven a 35c (Q1 (c)). La línea del
  `CMD` de `docker/worker.Dockerfile` (N1) no solapa: la fila 35 no edita ese fichero.
- **R10 — Hijos huérfanos en desarrollo.** Un `nx serve` del worker matado con `SIGKILL` deja vivo un hijo que estuviera
  en un bucle, hasta que se mate a mano. En la imagen no pasa (D1, PID 1). Aceptado; el RUNBOOK lo menciona.
  **Y el proceso de `nx` queda fuera de D7 (C3-06):** `inspect: false` y `runtimeArgs` protegen al worker que `nx serve`
  lanza, no al proceso de `nx` que lo vigila, que corre sin `--disable-sigusr1` con el entorno del `.env` de desarrollo;
  un hijo podría mandarle `SIGUSR1` y abrir su inspector. Riesgo de desarrollo aceptado: los archivos los sube el
  autor, y cerrarlo exigiría cambiar cómo se lanza `nx` en todo el workspace.
- **R11 — Coste de arranque por lectura.** Un proceso Node por CV: ~40 MB de RSS y el arranque de Node, `pdf-parse` y
  `mammoth` hasta `ready`. El criterio es **p95 ≤ 1,5 s en `arm64`** (N8): la sonda imprime `boot_p95_ms` (D11) y se lee
  en el runner `arm64` antes de fusionar (7.3, 7.4) y en el host de staging tras desplegar (Migration Plan). Un p95 por
  encima vuelve al debate antes de fusionar o, si aparece en staging, se anota como hallazgo de la medición de 35b. Con
  concurrencia 1 y un CV que se lee una vez, el coste en sí se acepta; lo que se mide es que no se acerque al plazo de
  arranque de 5 s.
- **R12 — Volcados de memoria con el CV en claro (N10).** Cuando el hijo agota su heap, V8 aborta con `SIGABRT`; si el
  contenedor tiene `ulimit -c` distinto de 0 y el `core_pattern` del host escribe volcados, el volcado del hijo lleva
  en claro los bytes y el texto del CV que estaba leyendo, fuera de la base y del almacén cifrado. **Comprobación:** en
  la 2.3, `ulimit -c` dentro del contenedor del worker con la imagen construida en local; en el paso de despliegue
  (Migration Plan), `cat /proc/sys/kernel/core_pattern` en el host de staging y el mismo `ulimit -c` en el contenedor.
  Los valores se anotan en el RUNBOOK («Operar los CV») y en «Estado de las mediciones». **Si hay volcados posibles**,
  la corrección (`ulimits: { core: 0 }` en el servicio `worker` del compose) toca el compose de producción: le
  corresponde a 35b o al change de Q5, no a este. **Pendiente** que se anota aquí con el valor medido, sin editar
  `staging-host`.

## Migration Plan

1. **Sin migración de datos.** Ningún documento cambia de forma. Los CV en `pending` al desplegar los lee el código
   nuevo; los ya leídos o fallidos se quedan como están.
2. **Despliegue**: imágenes nuevas del worker (con `--disable-sigusr1` en su `CMD` y `NODE_OPTIONS=--disable-sigusr1`
   en su `ENV`) y del SPA (el texto de D13); `api` no cambia. No hay variables nuevas que poner en el host: el
   `NODE_OPTIONS` viene en la imagen.
3. **Comprobación tras desplegar**:
   - subir un CV PDF y uno DOCX con la cuenta `+e2e` (o la e2e del lote 1) y ver
     `linkvault_cv_extractions_total{outcome="text"}` subir en `/metrics` desde la red interna;
   - la línea de órdenes del PID 1 del contenedor `worker` (`/proc/1/cmdline`) contiene `--disable-sigusr1`;
   - `docker compose exec worker sh -c 'echo $NODE_OPTIONS'` imprime `--disable-sigusr1` (lo heredan los
     healthchecks y cualquier `exec`, C3-01);
   - `node cv-extract-probe.js` dentro del contenedor `worker` del host (`run --rm --no-deps`): `boot_p95_ms` ≤ 1.500
     (N8, R11), anotado en «Estado de las mediciones»;
   - `core_pattern` del host y `ulimit -c` del contenedor, anotados en el RUNBOOK (R12).
4. **Vuelta atrás**: revertir el PR y redesplegar la imagen anterior (procedimiento de 35b). **Antes de la 10.7 de
   35b**, el revert (o un arreglo) es de la clase 1 de Q1: solo en la ventana 11.6-10.7 y repitiendo este §3, la 7.3,
   la 7.4 y las comprobaciones previas a invitar de 35b sobre el commit desplegado (C3-02). **Después de la 10.7**, la
   fusión del revert (y la de su vuelta) sigue las reglas de la clase 3; dentro de un periodo prohibido, se vuelve desde
   el host sin tocar `main` y el revert espera. Los CV leídos con el código nuevo se quedan; un CV en `pending` en el
   momento del cambio lo lee la imagen anterior.

## Costo estimado

53 tareas de menos de una hora (`tasks.md`, 0.1-11.5). La iteración 3 suma la 11.2c (guardia de las señales para la
10.7, C3-02) y amplía 1.0, 1.9, 1.10, 3.5, 3.6, 10.1, 11.2a, 11.3 y 11.5 sin partirlas. Respecto de la iteración 1 (51): salen las 7 del grupo 8
(spike y sustitución de pdf.js, con la 8.5 del owner) hacia `cv-pdf-library-upgrade`; entran el proyecto de Vitest de
aislamiento (1.0, N6), la prueba y la guardia de `--disable-sigusr1` (1.9 y 1.10, N1) y la lectura del arranque en
`arm64` (7.4, N8); y se parten la 1.4 en tres, la 3.1 en dos y la 11.2 en dos (T1), que la iteración 3 lleva a tres. El paso de hilo a proceso hijo sigue
costando **3-4 h** sobre la versión con hilo (estimación de `critic`, iteración 1).

## Open Questions

Q3 (umbral de crecimiento de la imagen) y Q6 (alertas de Renovate para los parsers) pasaron a
`cv-pdf-library-upgrade` con la partición (B2-01). Las demás conservan su número.

- **Q1 [bloqueante para `/opsx:apply`] — ¿Excepción a la precedencia de la fila 35, y para qué fusiones?**
  Reglas vigentes que acotan cualquier fusión a `main` mientras 35b esté abierta:
  - el PR-1 de 35b ya está en `main` (#86), y `openspec/changes/staging-host/tasks.md` dice «Entre PR-1 y PR-2 no se
    fusiona nada a `main`» (y en particular nada durante su ensayo 9.1-9.4);
  - D15 de `e2e-suite` prohíbe fusionar entre el PR-2 de 35b y su 11.6 (la 11.6 relanza dos despliegues seguidos);
  - los días 7 y 14 de la medición de 35b no se despliega nada a staging, y una fusión a `main` despliega;
  - una corrida `e2e-remote` prueba el commit desplegado: una fusión ese día lo cambia bajo sus pies.

  **La excepción que firma el owner cubre todas las fusiones que este change necesita**, en tres clases:

  1. **Toda fusión de este change a `main` antes de la 10.7 de 35b** (C3-02): la del change, la de un arreglo o la de
     una vuelta atrás. Solo en la ventana **después de la 11.6 de 35b y antes de su 10.7**, la única válida antes de
     invitar. No hace falta la cláusula de los días 7 y 14: la ventana termina antes de la 10.7, y la medición empieza
     con ella. **Por cada fusión de la clase 1** se repiten sobre el commit desplegado:
     - (i) las comprobaciones previas a invitar de 35b (entre ellas, `e2e-remote` en verde sobre el commit desplegado);
     - (ii) la 7.3 y la 7.4 (la sonda en `arm64` y su `boot_p95_ms` ≤ 1.500);
     - (iii) el Migration Plan §3.

     Las tres señales se exigen sobre el commit de la **última** fusión de la clase 1; las de las fusiones intermedias
     solo se anotan (en el PR de cada una). La guardia (11.2a) imprime la orden de repetirlas, y la 11.2c dice si las
     señales cubren el último commit. **Después de la 10.7**, un arreglo o una vuelta atrás siguen las reglas de la
     clase 3.
  2. **El PR de archivo** (anotaciones posteriores a la fusión: número del PR, hash del merge, ADR-058 a Aceptado,
     «Estado de las mediciones», deltas aplicados). Se fusiona **después de la 10.7 de 35b**, y con las reglas de la clase 3.
  3. **Las fusiones de arreglo y de vuelta atrás después de la 10.7 de 35b**, si hacen falta, y la vuelta de esas
     vueltas atrás. Reglas de las clases 2 y 3:
     **nunca** entre el PR-2 de 35b y su 11.6, **nunca** durante su 9.1-9.4, **nunca** los días 7 y 14 de la medición,
     **nunca** el día de una corrida `e2e-remote`. Si staging necesita volver atrás dentro de un periodo prohibido, se
     vuelve **desde el host** con el procedimiento «vuelta atrás sin GitHub» de 35b (su 11.2), que no toca `main`, y la
     fusión del revert espera al primer día permitido.

  **Condición, sea cual sea la respuesta (PO-04):** este change **no bloquea la 10.7 de 35b**. Si 35b llega a la 10.7
  antes de que este change esté listo, decide el owner entre esperar o invitar con el código de hoy (y entonces la
  clase 1 ya no tiene ventana antes de invitar: vuelve al owner).

  - (a) Sí: se aplica en paralelo; toda fusión antes de la 10.7 (el change, un arreglo o una vuelta atrás) va en la
    ventana de la clase 1, con (i)-(iii) repetidos; el PR de archivo y lo posterior a la 10.7, con las reglas de las
    clases 2 y 3. Como ADR-055 §1 hizo con `usage-guide-fixes`.
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
    `infra/README.md`. La respuesta se anota aquí y en ADR-058 en una línea con el formato que pide la tarea 0.1, que
    nombra las tres clases; con (a), (c) o (d), además una línea en ADR-048 §Consecuencias como las de ADR-053 y
    ADR-055.
  - Respuesta del owner (Q1), 2026-10-29: (a), «Toma las recomendaciones». Se aplica en paralelo; las tres clases de
    fusión quedan como están escritas arriba: (1) toda fusión antes de la 10.7 de 35b, después de su 11.6, con
    (i)-(iii) repetidos sobre el último commit; (2) el PR de archivo, después de la 10.7; (3) arreglos y vueltas atrás
    posteriores a la 10.7 y su vuelta. Anotada en ADR-058 y en ADR-048 §Consecuencias.

  **Cómo se comprueba cada fusión (tareas 11.2-11.5).** La casilla de la 10.7 de 35b se marca recién en el PR de
  archivo de 35b, después de invitar, así que no sirve para saber si la 10.7 está hecha. El estado de la 9.1-9.4, la
  11.6 y la 10.7 se toma de una **confirmación escrita y fechada del owner en el PR** que se va a fusionar («11.6 hecha
  el AAAA-MM-DD; 10.7 no hecha»), junto con si hoy es día 7 o 14 o día de una corrida `e2e-remote`; el PR-2 de 35b se
  identifica **por su número** en `git log` de `main`; las casillas de `staging-host/tasks.md` (en `main` o en la rama
  de archivo de 35b) son solo apoyo. Para la clase 1 (sea el change, un arreglo o una vuelta atrás), si el owner
  declara la 10.7 hecha, el resultado es «fuera de ventana». Para dar por cubierta la 10.7, la confirmación del owner
  dice que (i)-(iii) se repitieron **sobre el commit de la última fusión de la clase 1** (su hash); sin ella, este
  change no da sus señales por buenas y la 10.7 no queda habilitada por él (lo que se haga entonces lo decide el owner,
  PO-04). Nada de la clase 2 se escribe en `main` justo después de fusionar el PR del change.
- **Q2 [cerrada en el debate, iteración 1] — Texto de «el archivo era demasiado complejo».** Opciones: (a) no tocar
  nada; (b) motivo nuevo en `libs/shared` + textos + SPA; (c) reescribir solo el texto existente de `unreadable_file`.
  **Decisión del debate (PO-02): (c)**, en D13, sujeta a la aprobación humana del change; el texto lo fijó la
  iteración 2 (B2-04). (b) queda para cuando 35b muestre cuántas lecturas acaban con `cause="timeout"`. **Se reabre**
  si en la medición de 35b aparece algún `unreadable` con `cause` ∈ {`timeout`, `heap_limit`, `memory_ceiling`}
  (B3-02).
- **Q4 [no bloqueante] — ¿Fijar `CV_EXTRACT_CONCURRENCY` a 1?** Con el vigía por hijo ya no hay daño colateral; queda
  la suma de memoria (R4). Opciones: (a) dejar el rango 1-4 con el `warn` de D5 y el RUNBOOK; (b) bajar el máximo a 1.
  **Recomendación: (a)**: el rango es un contrato de configuración vigilado y el valor real es 1.
  Respuesta del owner (Q4), 2026-10-29: (a), la recomendada; el rango 1-4 se mantiene.
- **Q5 [no bloqueante] — `mem_limit` del contenedor del worker.** Segunda barrera para R3. Toca el compose de
  producción. **Recomendación:** después de la fila 35, en un change propio con medición de memoria en staging; ese
  change es también candidato a llevar `ulimits: { core: 0 }` si la comprobación de R12 encuentra volcados posibles.
  Respuesta del owner (Q5), 2026-10-29: la recomendada; `mem_limit` en un change propio después de la fila 35, con
  medición de memoria en staging.
- **Q7 [no bloqueante] — ¿Cómo se corta la red del hijo, y cuándo?** (R8). Opciones: (a) aceptar el riesgo hasta subir
  de línea de Node, y en el change de la subida comprobar que el modelo de permisos deja al hijo sin red (sin
  `--allow-net`); (b) un change propio, después de la fila 35, que ponga autenticación a MongoDB y Redis (toca compose
  y secretos); (c) el contenedor de extracción sin red (alternativa de D1); (d) aceptar el riesgo sin plazo.
  **Dato para (a) (B2-05, 2026-10-28):** el flag de red es de Node 25.0.0 y la primera línea LTS que lo trae es la 26,
  LTS desde hoy (26.13.0) y todavía en *Stability 1.1* (R8); subir de la 22 a la 26 es un change propio, no una
  actualización menor.
  **Voto de la iteración 2 (B2-05): (a) sí y (b) sí —(b) como fila propia del manifiesto, después de la 35—; (c) no y
  (d) no.** La decisión sigue siendo del owner; la fila de (b) no se crea hasta que la apruebe.
  Respuesta del owner (Q7), 2026-10-29: (a) y (b), la recomendada. El flag de red se agrega al subir a Node 26 LTS (en
  ese change se comprueba que el hijo queda sin red, sin `--allow-net`), y la autenticación de MongoDB y Redis va en
  un change propio después de la fila 35. Ninguno de los dos entra en este change; la fila del manifiesto para (b)
  queda por crear.
- **Q8 [resuelta en la iteración 3 por `reflect`, 2026-10-28; el owner la puede revertir] — El inspector de `nx serve`
  del worker.** **Decisión (C3-06, en la versión recortada de B3-04):** solo `"inspect": false` en `serve.options`, sin
  configuración `debug`; para depurar, `pnpm nx serve worker --inspect=inspect` (RUNBOOK, 10.1). El proceso de `nx`
  queda fuera (R10). Planteamiento original: el ejecutor `@nx/js:node`
  arranca por defecto con `inspect: "inspect"`: en desarrollo el worker escucha en `127.0.0.1:9229` desde el arranque,
  y un hijo con red puede conectarse sin mandar ninguna señal (D7). Solo afecta a desarrollo, donde los archivos los
  sube el autor. Opciones: (a) `inspect: false` en las opciones de `serve` y una configuración `debug` que lo active a
  propósito; (b) dejarlo como está y anotarlo en el RUNBOOK; (c) `inspect` con `port: 0`, que elige un puerto
  aleatorio (no lo cierra, solo lo esconde). **Recomendación: (a)**: cuesta dos líneas de `apps/worker/project.json`,
  que este change ya toca por N1, y deja el depurador a un `--configuration=debug` de distancia. Si el owner elige (a),
  entra como parte de la 1.10.
  Ya resuelta en la iteración 3 (C3-06); el owner no la revierte (2026-10-29).

## Estado de las mediciones

Se completa aquí durante `/opsx:apply`, con fecha: cuánto añade a `worker-isolation` el `globalSetup` de Mongo heredado
(1.0); cómo arranca Vitest el hijo real y si `/app/package.json` entra en la lista de lecturas (3.5); lo que hizo el test de asignación enorme (1.6); `boot_p50_ms` y `boot_p95_ms` en el runner
`arm64` (7.4) y en el host de staging (Migration Plan); y `ulimit -c` del contenedor y `core_pattern` del host (R12).
Hasta la iteración 1 esta sección se llamaba «D3 · Estado» y recogía el spike, que pasó a `cv-pdf-library-upgrade`.

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

## Debate — iteración 2

Fecha: 2026-10-28. `critic`: 1 P0 (N1), N2-N11 y T1 como P1. `business`: 0 V0, B2-01 a B2-06. Decisiones de `reflect`
aplicadas en `proposal.md`, este design, los deltas de `cv/extraction` y `web/cv`, `tasks.md`, ADR-058, la anotación
de ADR-028 §Consecuencias y `openspec-changes.yaml` (fila nueva `cv-pdf-library-upgrade`).

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| B2-01 | business | Aceptado, partición: este change queda con el aislamiento, el `pending` eterno, los topes, la métrica, la sonda y el texto (grupos 0-7, 9, 10 y 11), con `pdf-parse` 1.1.4 y `mammoth` dentro del hijo y `--disallow-code-generation-from-strings`. El spike, la sustitución de pdf.js y la paridad con CV reales (grupo 8 y las partes de pdf.js de 4.5 y 10.1) pasan a `cv-pdf-library-upgrade`, después de 35c y sin excepción, con su fila en `openspec-changes.yaml` (sin directorio). Fuera de aquí: el requirement de la biblioteca, el escenario «La dependencia vieja no vuelve» (y el de paridad con el parser nuevo), Q3, Q6, R1, R2 y R6 (D3, Context) | El aislamiento cierra el riesgo antes de invitar en 35b; la biblioteca no hace falta para esa ventana y ataba la fusión a una medición del owner y a un spike de hasta 8 h |
| B2-02 | business | Resuelto por la partición (B2-01) | Su objeto pasó a `cv-pdf-library-upgrade` |
| B2-03 | business | Trasladado a `cv-pdf-library-upgrade`; anotado en su `scope` | Trata de la biblioteca nueva |
| B2-04 | business | Aceptado: texto de `unreadable_file` «No pudimos abrir este archivo. Si tiene contraseña, quítasela; si no, vuelve a exportarlo desde tu editor (en PDF o DOCX) y súbelo otra vez.», con su EN (D13, 9.1, delta de `web/cv`) | Una sola acción concreta, la que funciona con cualquier editor |
| B2-05 | business | Aceptado: R8 y Q7 llevan la versión del flag de red (`--allow-net`, Node 25.0.0, no LTS; primera LTS que lo trae: Node 26, LTS desde el 2026-10-28 con la 26.13.0, aún *Stability 1.1*), comprobada contra la documentación de la CLI y el índice de versiones de nodejs.org. Voto registrado en Q7: (a) y (b) —(b) como fila propia después de la 35—; (c) y (d), no | El owner decide Q7 con el dato de cuándo llega el corte de red sin coste |
| B2-06 | business | Resuelto por la partición (B2-01) | Su objeto pasó a `cv-pdf-library-upgrade` |
| PO-03 / PO-08 | business (iteración 1) | Resueltos por la partición: la paridad con CV reales y su repetición con la candidata adoptada son de `cv-pdf-library-upgrade` | Este change no cambia el parser |
| N1 (P0) | critic | Aceptado: el worker arranca con `node --disable-sigusr1 main.js` (`CMD` de `docker/worker.Dockerfile` y `runtimeArgs` de `nx serve worker`); 1.9 (test en Linux con un padre real: el hijo le manda `SIGUSR1` y el 9229 sigue cerrado; falsación sin el flag) y 1.10 (guardia de las dos líneas). Comprobado el 2026-10-28 en `node:22.23.2-alpine`: sin el flag el padre abre el 9229; con él, sigue vivo y cerrado. El flag existe desde 22.14.0 y es estable desde 22.20.0. D7, R8 y el requirement dicen que **no** se promete impedir señales entre procesos del mismo usuario; el `SIGTERM` al padre es una denegación de servicio aceptada, acotada por D8. **El Dockerfile no choca con la condición de Q1**: la fila 35 no lo edita, el compose no sobrescribe el `command` del `worker` y ningún requirement de `platform/*` fija el `CMD`; la condición no se ajusta, se hace explícita (Context, propuesta) | Sin el flag, una señal deshacía todo el aislamiento de D1: el hijo, con red, ejecutaba código en el worker con sus credenciales |
| N2 | critic | Aceptado: lista de `--allow-fs-read` fijada en D1 (`/app/cv-extract-child.js`, `/app/node_modules` y `/app/package.json` solo si la 3.5 lo exige) y misma regla fuera de la imagen; el SHALL dice «las rutas de la lista fijada en el design» (1.2, 3.5) | Una lista que la fijaba el spike ya no tiene quién la fije |
| N3 | critic | Aceptado: `child-command.ts` pasa las rutas por `fs.realpathSync.native`; test «allow-fs-read paths are real paths» (1.2) | pnpm y Windows ponen enlaces en medio |
| N4 | critic | Aceptado: el hijo no sale por su cuenta (lo mata el padre), corta con `slice(0, 1_000_000)` antes de serializar y el padre cuenta bytes sobre `Buffer`; el peor caso (6 bytes por unidad) cabe en 8 MiB. Test «a 1M-char worst-case escaped result arrives intact», en Linux y en Windows (D6, 1.4c, escenario nuevo) | El tope de 8 MiB se contaba en caracteres y el hijo podía truncar su propio resultado |
| N5 | critic | Aceptado: un `ready` o un `boot_error` después de `ready` es `protocol` de contenido. Test «boot_error or ready after ready is unreadable protocol» (D6, 1.4b, escenario nuevo) | El protocolo no decía qué pasa con un segundo anuncio |
| N6 | critic | Aceptado: bucles acotados en todos los hijos de prueba, `afterEach` que mata los vivos, proyecto de Vitest `worker-isolation` con `fileParallelism: false`, test de heap con 32 MB inyectados y plazo de 30 s (D10, 1.0, 1.4b) | Tests que pueden dejar procesos girando en CI o pisarse entre ficheros |
| N7 | critic | Aceptado: la 3.5 compila solo el script del hijo a `tmp/cv-child-test/` con un `tsconfig` propio en el `globalSetup`, sin `nx build worker` (D10, 3.5) | El build entero en cada corrida de tests es lento y acopla los tests al bundle |
| N8 | critic | Aceptado: criterio p95 de arranque ≤ 1,5 s en `arm64` para `pdf-parse` y `mammoth`; la sonda lo imprime (D11, 7.1), se lee en el runner `arm64` (7.3, 7.4, precondición de 11.3) y en el host de staging (Migration Plan). Si no se cumple, vuelve al debate. R11 corregido para hablar de la medición | «Irrelevante» no era un criterio |
| N9 | critic | Resuelto por la partición (B2-01) | Su objeto pasó a `cv-pdf-library-upgrade` |
| N10 | critic | Aceptado: R12 (volcados de memoria con el CV en claro). `ulimit -c` en el contenedor en la 2.3, `core_pattern` del host en el despliegue, ambos al RUNBOOK; si hay volcados, `ulimits: { core: 0 }` es de 35b o del change de Q5, anotado como pendiente sin editar 35b (R12, Migration Plan, Q5, manifiesto) | El aborto por heap es justo el caso en que el hijo tiene el CV en memoria |
| N11 | critic | Aceptado: la 1.3 empieza por una prueba de ida y vuelta por el descriptor 3 en Windows y en Linux con un hijo mínimo; API de escritura anotada en D1 (`net.Socket({ fd: 3 })` y esperar al callback, no `fs.writeSync`) | El canal no estaba probado en Windows y `writeSync` falla con `EAGAIN` en pipes no bloqueantes |
| T1 | critic | Aceptado: la 1.4 en 1.4a/1.4b/1.4c, la 3.1 en 3.1a/3.1b y la 11.2 en 11.2a/11.2b; la 8.4 se fue con el change posterior. «Costo estimado» con 52 tareas | Tareas de más de una hora |
| Q8 | arquitecto (al aplicar N1) | Pregunta nueva, no bloqueante: `nx serve` del worker arranca con el inspector abierto por defecto (`inspect: "inspect"` de `@nx/js:node`), lo que en desarrollo deja el mismo hueco que N1 sin necesidad de señal. Recomendación: (a) `inspect: false` y una configuración `debug` | Encontrado al leer el ejecutor para poner `runtimeArgs`; afecta solo a desarrollo y es decisión de ergonomía del owner |
| Q1 | owner | Sigue pendiente, con las tres clases de fusión y la confirmación fechada del owner en cada PR | Decisión del owner |

Convergencia: NO (pendiente de que `critic` verifique N1 y los P1 aplicados, y de que `business` vea la partición y la
fila nueva; Q1 sigue siendo del owner).

## Debate — iteración 3

Fecha: 2026-10-28. `critic`: 3 P0 (C3-01, C3-02, C3-03) y C3-04 a C3-06 como P1. `business`: 0 V0, B3-01 a B3-05.
Decisiones de `reflect` aplicadas en `proposal.md`, este design, los deltas de `cv/extraction` y `web/cv`, `tasks.md`,
ADR-058 y `openspec-changes.yaml` (fila de este change y `scope` de `cv-pdf-library-upgrade`). Mediciones del
arquitecto en `node:22.23.2-alpine`, con contenedores desechables, anotadas con orden y salida en D7.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| C3-03 (P0) | critic | Medido primero: fuera de PID 1, `node --disable-sigusr1` **sobrevive** a `SIGUSR1` (`exit=0`, sale al terminar su `setTimeout`, no por la señal). No se añade manejador en `main.ts`; la medición queda en D7 | La duda era si el flag, fuera de PID 1, cambiaba el abrir el inspector por morir; no lo hace |
| C3-01 (P0) | critic | Aceptado: Node acepta el flag en `NODE_OPTIONS` (`node -p 1` imprime `1`) y, con él, un proceso sin el flag en la línea de órdenes sobrevive a `SIGUSR1` con `inspector.url()` `undefined`. `ENV NODE_OPTIONS=--disable-sigusr1` en la etapa `runner` (lo heredan los dos healthchecks `node -e`, la sonda y cualquier `exec`; el hijo no, por `env: {}`); el `CMD` conserva el flag como segunda barrera del PID 1; sin manejador ni `--require`: el healthcheck queda protegido por `NODE_OPTIONS`, medido. 1.9 gana el caso del hermano lanzado solo con `NODE_OPTIONS`; 1.10 lee el `ENV` y comprueba que el compose no pisa `NODE_OPTIONS` del `worker`; Migration Plan §3 gana `docker compose exec worker sh -c 'echo $NODE_OPTIONS'`; corregida la frase «una línea de `docker/worker.Dockerfile`» (Context, propuesta, ADR-058, manifiesto). Requirement y escenarios del delta de `cv/extraction` ampliados | Los healthchecks corren con el entorno completo del contenedor y el mismo usuario: un inspector abierto en ellos era el mismo hueco que N1 |
| C3-02 (P0) | critic | Aceptado: la clase 1 de Q1, ADR-058 §11 y la 11.2a pasa a ser **toda fusión de este change a `main` antes de la 10.7 de 35b** (el change, un arreglo o una vuelta atrás), solo en la ventana 11.6-10.7, repitiendo por cada una sobre el commit desplegado (i) las comprobaciones previas a invitar de 35b, (ii) la 7.3 y la 7.4 y (iii) el Migration Plan §3; las tres señales se exigen sobre la **última** y las intermedias solo se anotan. La guardia imprime la orden de repetir; la 11.2c nueva dice si las señales cubren la última fusión; después de la 10.7 los arreglos siguen la clase 3; la 11.5 lista también los arreglos. Falsaciones: un arreglo con «10.7 hecha» da «fuera de ventana» (11.2a) y uno sin la confirmación de comprobaciones repetidas da «señales no cubiertas» (11.2c). Migration Plan §4 y propuesta alineados | Un arreglo fusionado antes de invitar cambia el commit desplegado sobre el que se dieron por buenas las señales; sin regla, la 10.7 se apoyaba en un commit que ya no estaba |
| C3-04 | critic | Aceptado, opción del **directorio**: el hijo de los tests recibe `tmp/cv-child-test/` (vaciado por el `globalSetup`, pasado por `realpath`) en lugar del script; se descarta el empaquetado con «el esbuild de Vite» porque el Vite del proyecto es la 8 (rolldown) y `esbuild` solo es transitiva. «`package.json` junto al script» pasa a «el `package.json` del ámbito del script» (D1, D10, spec, ADR-058). La 3.6 añade «the child bundle is a single file» (sin `require("./…")` ni carga de chunks) con su falsación por `splitChunks`; la 3.5, «the test child reads only its output directory» | `tsc` emite un fichero por módulo y el hijo hace `require` relativos: con solo el script en la lista, el hijo de los tests no arrancaba |
| C3-05 | critic | Aceptado: 1.0 reescrita para Vitest 4.1: `extends: true` en los dos proyectos, `worker-isolation` con su `globalSetup` y `pool: 'forks'` + `execArgv: ['--expose-gc']`, `coverage` en la raíz; declara que no necesita Mongo pero lo hereda (se acepta y se mide; si pasa de 10 s, el preset va solo a `worker`). Verificación nueva «worker project keeps decorator metadata» con falsación (quitar `extends: true`) (D10) | La 1.0 estaba escrita con opciones de Vitest 3 (`poolOptions`) y, sin `extends`, el proyecto `worker` perdía `unplugin-swc` |
| C3-06 / Q8 | critic / business (B3-04) | Aceptado en la versión recortada de B3-04: solo `"inspect": false` en `serve.options`, sin configuración `debug`; RUNBOOK con `pnpm nx serve worker --inspect=inspect` (10.1). Q8 resuelta como decisión de `reflect`, que el owner puede revertir. R10: el proceso de `nx` queda fuera, riesgo de desarrollo aceptado. La 1.9 comprueba `inspector.url()` y el puerto que declara el padre (`process.debugPort`), no un 9229 fijo | Cierra el inspector abierto por defecto con una línea; una configuración `debug` es ergonomía que nadie pidió |
| B3-01 | business | Aceptado, con un ajuste de forma: OpenSpec no deja renombrar dentro de un MODIFIED un escenario que la spec vigente tiene (`validate --strict` rechaza omitir «Un CV protegido con contraseña»), así que el escenario se parte: «Un CV protegido con contraseña» queda solo con la frase de la contraseña y se añade «Un archivo que no pudimos abrir» (CV sin contraseña en `unreadable_file`: pide volver a exportarlo y no se limita a la contraseña) | El desenlace ya no es solo la contraseña; el nombre nuevo cubre el caso que el texto de D13 añade |
| B3-02 | business | Aceptado: Q2 se reabre si en la medición de 35b aparece algún `unreadable` con `cause` ∈ {`timeout`, `heap_limit`, `memory_ceiling`} | Disparador concreto en vez de «cuando 35b muestre» |
| B3-03 | business | Aceptado: el `scope` de `cv-pdf-library-upgrade` admite una excepción a «sin excepción»: un fallo publicado de pdf.js ≤ 1.10 que no acoten los flags del hijo; decide el owner | Un fallo explotable a pesar del aislamiento no puede esperar a 35c por regla |
| B3-04 | business | Aceptado; aplicado como C3-06 | Ídem |
| B3-05 | business | Aceptado: la viñeta de `--disable-sigusr1` de ADR-058 dice «y `serve` arranca con `inspect: false`» y nombra `NODE_OPTIONS` | El ADR tiene que decir todo lo que se arranca con el flag |
| Q1 | owner | Sigue pendiente, con la clase 1 redefinida (C3-02) | Decisión del owner |

Convergencia: ver «Verificación puntual de C3-01, C3-02 y C3-03» a continuación.

## Verificación puntual de C3-01, C3-02 y C3-03 (2026-10-28)

Critic verificó solo los tres P0 de la iteración 3, sin abrir una iteración nueva: los tres cerrados con las mediciones de D7, sin P0 nuevos.

| id | origen | decisión | motivo |
|---|---|---|---|
| C3-01, C3-02, C3-03 | critic | resueltos | `NODE_OPTIONS` medido y heredado por los dos healthchecks; toda fusión previa a la 10.7 es de clase 1 con la 11.2c; fuera de PID 1 el proceso sobrevive a `SIGUSR1` con el flag. |
| N-01 | critic (P1) | aceptado | La clase 3 de la guardia pasa a llamarse `post-10.7` y exige la 10.7 hecha, con falsación: una vuelta atrás o un arreglo antes de la 10.7 no puede pasar por ella. |

Convergencia: SI (iteración 3 más verificación puntual: critic P0 0, business V0 0; Q1 pendiente del owner).

## Respuestas del owner y aprobación

Fecha: 2026-10-29. Aprobación humana del change tras la convergencia de la iteración 3 y la verificación puntual de
C3-01, C3-02 y C3-03 («Toma las recomendaciones»: se acepta la opción recomendada de cada pregunta abierta).

- **Q1 = (a):** excepción a la precedencia de la fila 35 para las tres clases de fusión, como están escritas en la
  Q1. Anotada aquí, en ADR-058 (Decisión 11) y en ADR-048 §Consecuencias (tarea 0.1). La entrada del manifiesto pasa
  delante de `staging-host`.
- **Q2:** cerrada en el debate (c), sin cambios.
- **Q4 = (a):** el rango 1-4 de `CV_EXTRACT_CONCURRENCY` se mantiene.
- **Q5:** `mem_limit` en un change propio después de la fila 35.
- **Q7 = (a) y (b):** el flag de red al subir a Node 26 LTS; la autenticación de MongoDB y Redis en un change propio
  después de la fila 35 (fila del manifiesto por crear).
- **Q8:** resuelta en la iteración 3 (C3-06); se mantiene.
