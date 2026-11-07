## Context

Este change parte del estado que deja `cv-extract-isolation` (rama `change/cv-extract-isolation`, commit `628923d`),
leído en el código:

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| `PdfTextSource` | `apps/worker/src/modules/cv/infrastructure/isolation/child/pdf-extract.ts` | interfaz `read(bytes): Promise<PdfTextRead>` (`text`, `pagesCapped`, `rawCapped`); la implementa `PdfParseTextSource` sobre `pdf-parse/lib/pdf-parse.js`, con `max: CV_MAX_PDF_PAGES`, un `pagerender` propio que une líneas por coordenada Y y corta en `CV_MAX_RAW_TEXT_CHARS`, y `withOwnBuffer` |
| `extractPdf` | mismo fichero | traduce `PasswordException` a `password` y el resto a `parse_error`, sin propagar mensajes |
| Script del hijo | `child/cv-extract.child.ts` | carga `./pdf-extract` o `./docx-extract` con `import()` **antes** de publicar `ready`; si no carga, `boot_error` (maquinaria) |
| Línea de órdenes | `child-command.ts` | `--permission`, `--allow-fs-read` por ruta (producción: `/app/cv-extract-child.js` y `/app/node_modules`), heap 256/16, `--disallow-code-generation-from-strings`, `env: {}`; `resolveNodeModulesRoot` busca el primer `node_modules` que contiene `pdf-parse` |
| Bundle | `apps/worker/webpack.config.js` | entrada `cv-extract-child` (un solo fichero, `compiler: 'tsc'`, `commonjs`), `generatePackageJson: true`; `cv-extract-child.bundle.spec.ts` comprueba que no importa el worker, que es un solo fichero y que `dist/apps/worker/package.json` fija `mammoth` y `pdf-parse` a versión exacta |
| Sonda | `apps/worker/src/cv-extract-probe.ts` | lee `pdfWithText()` y `docxWithTextDeflated()` con el adaptador aislado real e imprime `pdf chars=… docx chars=…`; después arranca 20 hijos hasta `ready` e imprime `boot_p50_ms`/`boot_p95_ms` |
| Lint | `eslint.config.mjs` | `DOMAIN_RESTRICTED_PATTERNS` prohíbe `pdf-parse` y `mammoth` en `domain/`; un bloque posterior los prohíbe en todo `apps/worker/**` salvo `infrastructure/isolation/child/**` |
| Dependencias | `package.json` | `pdf-parse ^1.1.4`, `@types/pdf-parse ^1.1.5`, `mammoth ^1.12.3` (exactas en el manifiesto generado del worker) |
| Renovate | `renovate.json` | `dependencyDashboardApproval: true`, `minimumReleaseAge: 7 days` (PR #88) |

Mediciones heredadas (Estado de las mediciones de `cv-extract-isolation`, 2026-10-30): arranque del hijo con `pdf-parse`
y `mammoth`, `boot_p95_ms=123` dentro de la imagen `amd64` local y `334` con la pila entera levantada. **`arm64` estaba
pendiente** (7.3/7.4 de aquel change, que requieren el `workflow_dispatch` de `cd-staging`). Esa medición es la línea
base de D9.

**Hallazgo al leer el código para este change (no es de su alcance; se informa a la sesión principal).** El bloque de
lint de `628923d` prohíbe `pdf-parse` y `mammoth` en `apps/worker/src/modules/cv/infrastructure/` fuera de
`isolation/child/`. Pero la spec vigente `platform/workspace`, en «La infraestructura importa un extractor de
documentos», dice que en ese directorio el lint SHALL pasar, y el caso tabular
`an infrastructure folder of the worker imports a document extractor` de
`tools/workspace-rules/src/workspace-rules.spec.ts` (archivo virtual
`apps/worker/src/modules/cv/infrastructure/probe.ts`, `unexpectedRuleIds: ['no-restricted-imports']`) espera que no se
reporte esa regla. **Estado (iteración 1, C1-16):** `cv-extract-isolation` lo está corrigiendo en su rama, con un
MODIFIED de `platform/workspace` que admite los parsers en `isolation/child/` y los rechaza en el resto de
`infrastructure/` (escenario «La infraestructura fuera del hijo importa un extractor de documentos»), y con el caso del
test ajustado. El MODIFIED de este change **parte de ese texto**: solo añade `pdfjs-dist` y `unpdf` a la lista y a la
oración del hijo, y cambia los `WHEN` de los tres escenarios de extractores. La 0.3 lo vuelve a comparar con el texto
archivado.

Restricciones:

- **El puerto `CvTextExtractor`, `ExtractionAttempt`, el protocolo del hijo, sus flags y los topes no cambian.** Lo
  único que se cambia es la implementación detrás de `PdfTextSource`.
- **Nada del CV en el repositorio, en los registros ni en las métricas**: tampoco los PDF de productores reales, que
  llevan metadatos de autor (D7).
- **Repo público**: este design nombra los fallos de pdf.js antiguos solo por su identificador público y no describe
  cómo explotarlos.
- **Precedencia**: entra después de 35c y de archivar `cv-extract-isolation` (D1).

## Goals / Non-Goals

**Goals**

- Que el PDF lo lea un pdf.js **mantenido**, fijado a versión exacta y con las alertas de vulnerabilidad llegando al
  repositorio.
- Que el texto guardado no empeore: el mismo texto en los fixtures sintéticos y, como mínimo, el 98 % de los tokens en
  el mismo orden en PDF de productores reales y en los CV reales del owner.
- Que la imagen no crezca por encima del umbral de Q3 y que el arranque del hijo siga en p95 ≤ 1,5 s en `arm64`.
- Que el aislamiento de ADR-058 quede intacto: la misma lista de lecturas, los mismos flags y la frontera `ready`
  clasificando bien los fallos de la biblioteca nueva.
- Que el spike tenga un final escrito: una biblioteca adoptada o `pdf-parse` aislado y una pregunta nueva al owner.

**Non-Goals**

- Cambiar `mammoth`, re-extraer CV ya leídos u OCR.
- Cortar la red del hijo, que llega con Node 26 LTS (Q7 de `cv-extract-isolation`).
- Mejorar la calidad del texto más allá de la paridad. Si la biblioteca nueva lee mejor, se acepta, pero no es un
  criterio.

## Decisions

### D1. Entrada: después de 35c y de archivar `cv-extract-isolation`, con una única salvedad vigilada

- **Precondiciones de `/opsx:apply`** (tarea 0.3): `verify-reusable-workflow` archivado,
  `cv-extract-isolation` archivado con ADR-058 en Aceptado, y los MODIFIED de este change rehechos sobre el texto
  archivado.
- **Sin excepción a la precedencia de la fila 35.** Esta especificación se adelanta como spec por pedido del owner del
  2026-11-04, y eso no autoriza ni el apply ni ninguna fusión de código.
- **La salvedad de B3-03** (2026-10-28): si se publica un fallo de pdf.js ≤ 1.10 que los flags del hijo no acotan, el
  owner puede adelantar el change. Los flags que cuentan son el modelo de permisos, `env: {}`,
  `--disallow-code-generation-from-strings`, el heap acotado y el plazo con `SIGKILL`.
  - Quién lo juzga: el arquitecto evalúa el aviso contra esos flags, con `critic`, y el owner decide.
  - Cómo se dispara: con una consulta fechada, porque las alertas de dependencias no miran el pdf.js copiado dentro de
    `pdf-parse`. Cuándo y dónde se hace es Q9.
  - Qué pasa si el owner lo adelanta: el change se aplica con las reglas de fusión que el owner fije en ese momento,
    como las excepciones de ADR-053, ADR-055 y ADR-058, y ADR-048 §Consecuencias gana su línea.
- **Una consulta no se commitea si no encontró nada.** Solo se anota su fecha y el resultado («sin avisos nuevos» o el
  identificador del aviso) en «Estado del spike y de las mediciones».

*Alternativa descartada:* pedir ya la excepción para aplicar el change en paralelo a 35b, como hizo
`cv-extract-isolation`. El aislamiento ya está en `main` antes de invitar, y un cambio de dependencia en la ventana de
la 10.7 de 35b añade riesgo a esa ventana sin cerrar un riesgo que el aislamiento deje abierto. Además, el `scope`
dice «sin excepción».

### D2. Candidatas: `pdfjs-dist` primero, `unpdf` como alternativa escrita; las descartadas siguen descartadas

ADR-058 encargó reevaluar las candidatas descartadas en la iteración 1 de `cv-extract-isolation` (tabla del commit
`5f802d4`). Reevaluadas con los criterios de D3:

| Candidata | Decisión | Motivo |
|---|---|---|
| **`pdfjs-dist`** (Mozilla, Apache-2.0), build `legacy` | **Primera** | Es el pdf.js mantenido de origen, sin capa intermedia que retrase las correcciones, JS puro (`arm64` sin binarios) y con las mismas excepciones (`PasswordException`) que ya traduce `extractPdf` |
| **`unpdf`** (UnJS, MIT) | **Alternativa** si `pdfjs-dist` falla en (a), (b) o (c) | Reempaqueta un build de pdf.js sin dependencias. Puede ganar en tamaño o en ESM, a cambio de un retraso respecto de Mozilla en las correcciones |
| `pdf-parse` 2.x | Descartada otra vez | Envuelve `pdfjs-dist` con `@napi-rs/canvas` detrás (ADR-028). No aporta nada sobre `pdfjs-dist` directo y suma una capa con su propio retraso |
| poppler `pdftotext` | Descartada otra vez | Código C que parsea entradas hostiles y binario GPL dentro de una imagen pública. Además rompe ADR-058: el hijo no puede lanzar procesos, así que el binario lo tendría que lanzar el worker, fuera del modelo de permisos de Node |
| `mupdf` (WASM) | Descartada otra vez | AGPL-3.0 en un proyecto MIT con imagen pública |

La versión de `pdfjs-dist` (o `unpdf`) es **la última estable publicada con al menos 7 días el día del spike**, el mismo
`minimumReleaseAge` que Renovate. Este design no fija un número: lo fija el spike en «Estado del spike y de las
mediciones», con fecha.

### D3. Criterio de adopción y de parada del spike

Una candidata se **adopta** si cumple las cuatro condiciones, que se comprueban en este orden porque cada una es más
cara que la anterior:

- **(a) Carga y lee dentro del hijo con sus flags, desde el bundle y desde la imagen.** La sonda sale 0 desde
  `dist/apps/worker/` y desde la imagen construida en local, con la lista de lecturas de producción, sin canvas y sin
  `Worker` anidado. El test del bundle sigue en verde: un solo fichero, sin el worker y con la versión exacta.
- **(b) El crecimiento de la imagen del worker, medido después de la poda (D8), no supera el umbral de Q3.** No se
  descarta por (b) sin haber podado.
- **(c) Las licencias de todo el árbol de producción que añade son permisivas** (MIT, Apache-2.0, BSD, ISC o
  equivalentes), sin GPL, LGPL ni AGPL.
- **(d) Pasa la paridad de D7**: igualdad exacta en los sintéticos, y recall ≥ 0,98 con el mismo orden de bloques en
  los PDF de productores. También tienen que seguir en verde las suites de aislamiento y de archivos patológicos que
  dejó `cv-extract-isolation`.

**Corpus de productores (C1-01, C2-01, C2-02, C2-11).** Sale de **una sola fuente inventada**, commiteada en texto plano
y sin metadatos: `tools/cv-fixtures/parity-source/persona-inventada.tex`, `persona-inventada.fodt` y
`persona-inventada-dos-columnas.fodt`, con un nombre, una empresa y una trayectoria inventados. Los cinco PDF se
generan **antes del grupo 1** y quedan en una misma carpeta local, fuera del repositorio:

- **(i) los genera el implementador** (0.5a) con contenedores públicos, sin depender de lo que tenga instalado: TeX
  Live para `pdflatex` (`-output-directory`) y LibreOffice para `soffice --headless --convert-to pdf --outdir`. La
  fuente va montada en solo lectura y la salida a un directorio fuera del repositorio. Salen `latex.pdf`,
  `libreoffice.pdf` y `dos-columnas.pdf`, y además `persona-inventada.docx` (`soffice --convert-to docx`), también
  fuera del repositorio: **ningún `.docx` entra al repo**;
- **(ii) los genera el owner** (0.5b, cuando él quiera, antes del grupo 1): abre `persona-inventada.docx` en Word y lo
  exporta a `word.pdf`, y lo sube a Google Docs y lo exporta a `google-docs.pdf`, en la misma carpeta.

La 1.5b mide **los cinco productores** con detalle por documento, así que (d) se decide entero en el grupo 1 (o el 2).
La 3.1 queda solo para los CV reales, y la variedad de herramientas la da este corpus.

**Tope: 4 h por biblioteca**, repartidas en las tareas 1.1a-1.5b (`pdfjs-dist`) y 2.1-2.5 (`unpdf`), cada una de menos
de una hora. Cada tarea anota cuándo empezó y cuándo terminó en «Estado del spike y de las mediciones». **La espera de
un build** (`docker build`, `nx build`) **no cuenta para el tope** si el implementador no trabaja en la biblioteca
mientras espera, pero se anota aparte. Una espera de más de 30 minutos se anota como hallazgo, porque también es costo
de mantener la biblioteca, y **si las esperas acumuladas de una biblioteca pasan de 2 h, es corte 2** (C2-09). Las
falsaciones de imagen que no deciden la adopción (C1-10) se hacen en la 4.5b, después del spike.

El **corte** de una biblioteca es explícito y se da en el primero de estos casos:

1. **(a), (b) o (c) fallan** de forma que no se arregla dentro de la tarea. Por ejemplo: una licencia GPL en el árbol, un
   `ERR_ACCESS_DENIED` que solo se resuelve ampliando la lista de lecturas fuera de `node_modules`, o `require(esm)` que
   no carga (D5);
2. la suma de las tareas de esa biblioteca llega a 4 h sin cumplir (a)-(c), o sus esperas de build acumuladas pasan de
   2 h;
3. **(d) falla**: un sintético que difiere (C1-14: se anota el diff línea a línea) o un productor por debajo del
   criterio de D7.

**Solo los cortes 1 y 2 pasan a `unpdf`** (C1-09). Lo mismo vale si `pdfjs-dist` falla por tiempo. Un corte 3, o una
medición del owner (3.1) que no cumple, **para el spike y vuelve al debate**, sin pasar a la otra candidata. `unpdf`
reempaqueta el mismo pdf.js, así que un problema de texto de uno sería, casi seguro, el del otro; y una diferencia en los
sintéticos dice más de la unión de líneas que de la biblioteca.

**Puerta dura (B1-03, BV2-01): sin la 3.1 hecha, el grupo 4 no empieza.** La 1.6 (o la 2.6) anota en el PR y en la fila
del manifiesto la **fecha límite de la 3.1**, 14 días después. Si llega sin la 3.1, el design anota «en pausa por la
3.1» con la fecha, y el change espera sin otra tarea en curso. La pausa termina con la 3.1 o con la decisión (c) de
D13. Si se adopta la candidata que no midió el owner, la 3.1 se repite con ella (PO-08). Si fallan las dos por cortes 1
o 2, se aplica D13.

**`unpdf` y las alertas (C2-08, Q11).** Si `pdfjs-dist` se corta y `unpdf` cumple (a)-(d), la adopción espera a la
respuesta del owner a Q11 en la 2.6. Si la respuesta es no, el corte de `unpdf` se trata como el de las dos candidatas
(D13).

*Alternativas descartadas:*

- **Un tope total de 8 h sin reparto.** Es el mismo número, pero deja que la primera biblioteca se coma el tiempo de la
  segunda.
- **Adoptar sin la medición del owner.** Los fixtures sintéticos y los de una persona inventada no representan los
  CV que suben las personas (H7/PO-03 de `cv-extract-isolation`).

### D4. pdf.js dentro del hijo: opciones, carga antes de `ready` y unión de líneas

La implementación nueva de `PdfTextSource` (`PdfJsTextSource`) vive en `child/pdf-extract.ts`, junto a `extractPdf`, y
es la única que conoce la biblioteca.

- **Carga antes de `ready`.** El script del hijo ya hace `import('./pdf-extract')` antes de anunciarse. Ese módulo
  carga en su nivel superior **los dos** módulos de pdf.js: el principal (`legacy/build/pdf.mjs` o el equivalente de
  `unpdf`) y el del «worker falso» (`legacy/build/pdf.worker.mjs`), que se expone como `globalThis.pdfjsWorker` para
  que pdf.js no lo busque por su cuenta durante `getDocument`.
  - El motivo es la clasificación de ADR-058 §5. Si el módulo del worker se cargara perezosamente, faltar en la imagen
    convertiría **todo** PDF en `unreadable_file`, que es un desenlace de contenido sin reintento, en vez de un fallo
    de maquinaria con `internal_error` visible en el contador.
  - Test «a missing pdf.js worker module is a boot error» (1.1b). El hijo compilado del test vive **dentro** de un
    árbol falso de `node_modules` en `os.tmpdir()`, con `allowRead=<tmp>`, y el test afirma `ERR_MODULE_NOT_FOUND` o
    `MODULE_NOT_FOUND` como código del `boot_error`, **nunca** `ERR_ACCESS_DENIED`: así se prueba la ausencia del módulo
    y no el modelo de permisos (C1-11).
- **CMaps y fuentes estándar antes de `ready` (C1-03).** Sus directorios se resuelven con
  `createRequire(__filename).resolve('<paquete>/package.json')` y `dirname` (C1-04), sin ninguna ruta escrita a mano.
  Antes de `ready`, el módulo hace `statSync` de **`cmaps/Identity-H.bcmap`** y de
  **`standard_fonts/LiberationSans-Regular.ttf`**. La 1.1c confirma los dos nombres contra el paquete instalado; si uno
  no existe en esa versión, se usa el equivalente del mismo directorio y se anota. Un error ahí es `boot_error`
  (maquinaria), no un PDF ilegible. Dos tests del hijo:
  - «pdf.js data paths resolve under the allowed node_modules root»: las dos rutas, pasadas por `realpath`, quedan bajo
    la raíz de `node_modules` que recibe el hijo;
  - «missing pdf.js cmaps is a boot error» (C2-12), de regresión. Usa el mismo árbol falso que el del módulo del worker
    y en el mismo orden: primero el hijo compilado, después `pdfjs-dist/package.json`, `legacy/build/pdf.mjs`,
    `legacy/build/pdf.worker.mjs` y `standard_fonts/LiberationSans-Regular.ttf`, copiados del paquete real, **sin**
    `cmaps/`. Afirma `boot_error` con código `ENOENT`, nunca `ERR_ACCESS_DENIED` ni `unreadable`.

  **Si se adopta `unpdf` y no trae `cmaps/` ni `standard_fonts/`**, los datos se toman de `pdfjs-dist` **a la misma
  versión de pdf.js** que lleva `unpdf`, instalado solo por sus datos. Si esa versión no existe publicada, es corte 1.
- **Las opciones salen de una función pura (C1-15):** `pdfDocumentOptions(bytes, paths)` devuelve el objeto que recibe
  `getDocument`, y su test lo compara con `toEqual` contra el objeto exacto que fija esta lista, con aserciones aparte
  de las dos rutas. Así una opción añadida o quitada rompe el test.
- **Opciones de `getDocument`:**
  - `data`: los bytes copiados con `withOwnBuffer`, como `Uint8Array` propio y no como `Buffer`;
  - `isEvalSupported: false`;
  - `disableFontFace: true`;
  - `useSystemFonts: false`;
  - `enableXfa: false`;
  - `useWorkerFetch: false`;
  - `isOffscreenCanvasSupported: false`;
  - `verbosity: 0` (solo errores, que de todos modos se descartan con la salida del hijo);
  - `cMapUrl`, `cMapPacked: true` y `standardFontDataUrl`, apuntando a los directorios del propio paquete, resueltos
    como se explica arriba;
  - sin `url` ni ninguna fuente remota.

  `--disallow-code-generation-from-strings` sigue en la línea de órdenes, como segunda barrera.
- **Sin canvas y sin `Worker` anidado.** `@napi-rs/canvas` se excluye de la instalación en `pnpm-workspace.yaml`, con la
  opción de pnpm que excluye dependencias opcionales (`ignoredOptionalDependencies`, que se confirma con pnpm 12.4.2 en
  la 1.3a). La comprobación se hace **dentro de la imagen**: `/app/node_modules/.pnpm` no tiene ninguna entrada
  `@napi-rs+canvas*` (C1-05). Si la exclusión choca con `pnpm install --frozen-lockfile` de la imagen (el candado
  generado por Nx no la refleja), la alternativa, en este orden, es: regenerar el candado de `dist/` con la exclusión ya
  aplicada en el workspace, y si no alcanza, borrar el paquete en la etapa `build` después de instalar, con la
  comprobación de `.pnpm` como guardia. La segunda barrera, aunque el paquete llegara a instalarse, es que el hijo no
  tiene `--allow-addons` y no puede cargar código nativo. Test «the child command never allows addons» sobre
  `buildChildCommand`. El «worker falso» corre dentro del propio hijo. El modelo de permisos ya deniega `new Worker`.
- **Texto:**
  - recorre las páginas `1..min(numPages, CV_MAX_PDF_PAGES)`;
  - por página pide `getTextContent({ disableNormalization })`, con el valor que decide D7;
  - une los elementos con la misma regla que `pdf-parse`: salto de línea cuando cambia la coordenada Y
    (`transform[5]`), concatenación si no cambia;
  - deja de pedir páginas al llegar a `CV_MAX_RAW_TEXT_CHARS` y marca `rawCapped`;
  - `pagesCapped` vale `numPages > CV_MAX_PDF_PAGES`;
  - al terminar, `page.cleanup()` y `loadingTask.destroy()`.

  El proceso muere al terminar igual, pero la memoria de las páginas leídas no se acumula durante una lectura de 50
  páginas.
- **Contraseña:** pdf.js sigue lanzando `PasswordException` y `isPasswordError` no cambia. El fixture generado
  `encryptedPdf()` declara un diccionario de cifrado estándar sin cifrar de verdad (ADR-028). Si el pdf.js nuevo lo
  trata distinto (R14), se corrige **el fixture**, no el escenario «Un CV protegido con contraseña».
- **`withOwnBuffer` se conserva.** Ya no es por el defecto de `xref` de `pdf-parse`, sino porque pdf.js puede
  apropiarse del `ArrayBuffer` que recibe. Se actualiza su comentario.

*Alternativa descartada:* cargar pdf.js después de `ready` para acortar el arranque. Movería los fallos de carga al lado
del contenido y rompería la frontera de ADR-058.

### D5. ESM desde un bundle `commonjs` (R2)

El build `legacy` de pdf.js es ESM. El bundle del hijo es `commonjs` (webpack con `compiler: 'tsc'`) y deja las
dependencias de `node_modules` como externas.

**La única vía es `require(esm)` de Node 22.23 (C1-02).** Webpack deja el `require` de la dependencia externa con una
cadena literal, que el grafo de Nx y el generador del `package.json` ven. Funciona si los módulos no usan `await` de
nivel superior; si lo usan, falla con `ERR_REQUIRE_ASYNC_MODULE`.

- **El primer paso de la 1.1a**, antes de escribir código, es `node -e "require('pdfjs-dist/legacy/build/pdf.mjs');
  require('pdfjs-dist/legacy/build/pdf.worker.mjs')"` con Node 22.23 desde la raíz del workspace. Si falla, es **corte
  1** de esa biblioteca.
- **Un `import()` dinámico que el compilador no reescriba no se usa**: exigiría un mecanismo de compilación que el
  Impact no nombra (un comentario mágico de webpack o un `new Function` prohibido por el propio flag del hijo). Solo
  entra si el debate acepta un MODIFIED del Impact que nombre ese mecanismo.

Las tres aserciones del test del bundle siguen igual: un solo fichero, sin `__webpack_require__.e` y sin
`require("./…")`. El riesgo de que funcione en Vitest y no en la imagen lo cierra la sonda dentro de la imagen (1.2a).

### D6. La lista de lecturas no crece; si tuviera que crecer, vuelve al debate

El `scope` decía «lista de `--allow-fs-read` ampliada (CMaps y fuentes estándar del paquete)». Esa frase venía de la
iteración 1 de `cv-extract-isolation`, cuando la lista era por paquete. La iteración 2 (N2) la fijó en dos rutas: el
script del hijo y **la raíz de `node_modules`**. Con pnpm, `node_modules/pdfjs-dist` enlaza a
`node_modules/.pnpm/…`, dentro de la misma raíz, así que los CMaps (`cmaps/`), las fuentes estándar
(`standard_fonts/`) y el módulo del worker falso ya son legibles **sin añadir nada**.

- La 1.2a lo demuestra dentro de la imagen, con la lista de producción sin cambios y un PDF que necesita un CMap
  predefinido (fixture nuevo `pdfWithPredefinedCMap()`, si se puede generar en la tarea; si no, se anota y la
  comprobación queda en el PDF de productor que lo necesite). Además, el `statSync` previo a `ready` (D4) hace que un
  paquete sin `cmaps/` o sin `standard_fonts/` falle en el arranque, y la sonda lo detecta (falsación en la 4.5b).
- **Si hiciera falta una ruta fuera de `node_modules`**, el change vuelve al debate con un MODIFIED de «La lectura corre
  aislada del proceso del worker», que remite a la lista del design de `cv-extract-isolation`. Este change no lo
  modifica mientras la lista no cambie.
- **Desviación del `scope`, registrada:** «ampliada» pasa a «comprobada sin ampliar», por la razón de arriba.

*Alternativa descartada:* estrechar la lista a los directorios de cada paquete en vez de la raíz. Con `mammoth` y su
árbol (`jszip`, `@xmldom/xmldom`, `bluebird` y otros) serían decenas de rutas que se rompen con cada actualización, y
la raíz de `node_modules` no contiene secretos.

### D7. Paridad: qué se mide, sobre qué, cómo se anota sin datos personales

**Definiciones** (fijas antes de medir; las implementa el spec de paridad de la 1.5a):

- **Texto comparado**: el de cada `PdfTextSource` pasado por `prepareCvText` (la normalización que se guarda), sin el
  recorte de 200.000 caracteres.
- **Tokens**: el texto partido por `/\s+/u`, sin pasar a minúsculas ni quitar puntuación. Así una diferencia de
  ligaduras o de normalización Unicode cuenta como pérdida, que es justo lo que decide `disableNormalization`.
- **Recall de tokens**: `|multiconjunto(viejo) ∩ multiconjunto(nuevo)| / |multiconjunto(viejo)|`, con `pdf-parse` como
  referencia. Mide lo que se pierde, no lo que se gana.
- **Orden de bloques**: se toman las líneas del texto de referencia con al menos 3 tokens. Para cada una se busca su
  primera aparición en el texto nuevo, como secuencia de tokens, empezando después de la anterior encontrada.
  `orden = LIS(posiciones) / encontradas`. «El mismo orden» es `orden = 1,00`. Las líneas no encontradas cuentan contra
  el recall, no contra el orden.

**Corpus y umbrales:**

| Corpus | Dónde vive | Criterio |
|---|---|---|
| Sintéticos: `pdfWithText()` y `pdfWithoutText()` de `cv-fixtures.ts`, y `pdfWithPageMarks(60)` de `pathological-fixtures.ts` (`minimalPdf()` de `web-e2e` sale del corpus, C2-04: el worker no puede importarlo) | generados en el test | **igualdad exacta**, línea a línea, contra `extractors/fixtures/expected-texts.ts`, capturado con `pdf-parse` en la 0.4 (texto inventado, sin datos personales) |
| Productores: la fuente inventada de D3, exportada desde LaTeX, LibreOffice y LibreOffice a dos columnas (0.5a) y desde Word y Google Docs (0.5b) | la fuente, en el repositorio en texto plano; los cinco PDF, **fuera del repositorio**, en una misma carpeta local | recall ≥ 0,98 y orden = 1,00 en cada PDF, medidos todos en la 1.5b; si no, corte 3 de D3 |
| CV reales del owner (5 o 6) | **solo en la máquina del owner** | recall ≥ 0,98 y orden = 1,00 en cada CV, con la candidata adoptada |

**Origen de los CV reales (B0-01, C2-06).** La paridad corre los dos parsers **en el proceso de Vitest, fuera del
aislamiento** de ADR-058. Por eso la 3.1 se limita a **CV cuyo origen controla el owner: los suyos o los que generó él**.
No entran CV de otras personas, aunque se los hayan dado. **Nunca** se descargan del almacén de staging ni del de
producción. La variedad de herramientas la da el corpus de productores, no estos CV. Con menos de 5 CV, se mide con los
que haya y la línea dice `docs=<n>`. Las copias temporales que el owner haya hecho para la medición se borran al
terminar.

**`disableNormalization`:** se mide con `true` y con `false`. Se elige `true` si la normalización de pdf.js baja el
recall mínimo frente a `pdf-parse` en los productores, y `false` (el valor por defecto de pdf.js) si lo mejora o lo deja
igual. Con la medición del owner se confirma, o se cambia si sus CV dicen lo contrario: en ese caso decide el recall
mínimo de sus CV.

**El instrumento** es un spec de Vitest, `child/pdf-parity.spec.ts`, en el proyecto `worker-isolation`. Corre las dos
implementaciones de `PdfTextSource` en el proceso de test, que es donde vive la comparación de texto; el aislamiento ya
se prueba aparte. Las reglas que siguen son de la iteración 1 del debate (C1-06, C1-07, C1-08, B1-04):

- **Fuera de cualquier repositorio.** `assertOutsideAnyRepository(dir)` es una función pura del mismo fichero. Rechaza
  `dir` si alguno de sus ancestros, él incluido, después de `realpath`, contiene un `.git` (directorio o fichero, para
  cubrir los worktrees). También lo rechaza si `path.relative(raízDelWorkspace, dir)` no sale de la raíz. En win32
  compara en minúsculas. Se llama **antes de cualquier `readdir`**. Su test, «parity refuses a directory inside any
  repository», corre **fuera** del `describe.runIf`, en CI y siempre, sobre árboles temporales con y sin `.git`. Su
  falsación es real: quitar la búsqueda de `.git` y ver que el caso del árbol con `.git` deja de fallar.
- **Se salta si no hay `CV_PARITY_DIR`** (`describe.runIf`), así que CI nunca lee PDF de nadie.
- **Silencio.** Mientras corre, `console.log`, `console.warn` y `console.error` se sustituyen por funciones vacías, y
  `verbosity: 0`. Lo único que se escribe es la salida de abajo, por `process.stdout.write`.
- **Ningún `expect` sobre texto ni tokens**, solo sobre agregados. Una aserción que falla imprime lo que compara, y aquí
  eso sería el CV.
- **La rutina recibe las dos `PdfTextSource` por parámetro** (C2-03): `runParity(dir, reference, candidate, out)`. Así
  el test «a failing parity read leaves no text in the output» usa dobles con textos inventados distintos (uno por
  fuente, y uno de ellos que lanza un error cuyo mensaje lleva texto), captura `stdout`, `stderr` y los errores
  lanzados, y afirma que **ninguna palabra** de esos textos aparece en lo capturado. Falsación: imprimir el texto de
  la referencia en la rutina y comprobar que el test cae.
- **No escribe nada en disco.** No imprime nombres de archivo, texto, tokens, metadatos ni hashes, salvo lo que permite
  `CV_PARITY_PER_DOC`.
- **Los dos valores de `disableNormalization` en una sola corrida**, en dos líneas:

  ```
  parity run=<uuid> source=<biblioteca>@<versión> normalization=false docs=<n> recall_min=<0.000> recall_mean=<0.000> order_ok=<k>/<n> failed_reads=<m> failed_reads_ref=<r>
  parity run=<uuid> source=<biblioteca>@<versión> normalization=true  docs=<n> recall_min=<0.000> recall_mean=<0.000> order_ok=<k>/<n> failed_reads=<m> failed_reads_ref=<r>
  ```

  - `failed_reads` cuenta los PDF que la candidata no pudo leer (excepción o contraseña);
  - `failed_reads_ref` cuenta los que no pudo leer `pdf-parse`;
  - un PDF que no lee ninguna de las dos no entra en `docs` ni en los promedios;
  - uno que lee solo `pdf-parse` cuenta con recall 0;
  - uno que lee solo la candidata no entra en los promedios, porque no tiene referencia.
- **Detalle por documento, solo para productores**: con `CV_PARITY_PER_DOC=1`, se añade una línea por archivo,
  `doc=<etiqueta> recall=<x> order=<y>`. La etiqueta es el nombre del fichero **solo si está en la lista cerrada de los
  cinco productores** (`latex.pdf`, `libreoffice.pdf`, `dos-columnas.pdf`, `word.pdf`, `google-docs.pdf`); cualquier
  otro fichero sale como `doc=#<i>` (C2-13). Sin esa variable, que es como corre la 3.1, solo salen las dos líneas
  agregadas.
- **Dos órdenes de PowerShell, una por corpus.** La 1.5b usa la de productores y la 3.1 la de CV:

  ```powershell
  # Productores (1.5b), con detalle por documento
  $env:CV_PARITY_DIR='C:\ruta\fuera\del\repo\productores'; $env:CV_PARITY_PER_DOC='1'; pnpm nx run worker:test --skip-nx-cache -- <filtro comprobado en la 1.5a>; Remove-Item Env:CV_PARITY_DIR; Remove-Item Env:CV_PARITY_PER_DOC

  # CV reales (3.1), solo agregados
  $env:CV_PARITY_DIR='C:\ruta\fuera\del\repo\cv'; pnpm nx run worker:test --skip-nx-cache -- <filtro comprobado en la 1.5a>; Remove-Item Env:CV_PARITY_DIR
  ```

  La 1.5a fija el filtro exacto (el de Vitest para un solo fichero en este workspace) y lo escribe aquí. `--skip-nx-cache`
  hace falta porque, si no, Nx devuelve una corrida anterior desde su caché. El `run=<uuid>` de cada línea permite saber
  que dos líneas pegadas salen de la misma corrida.
- **Bloque de tres pasos para el owner** (BV1-03). El PR le deja: (1) `git fetch` y `git switch` a la rama del change
  en el commit exacto que se mide; (2) `pnpm install --frozen-lockfile`; (3) la orden de CV de arriba, con el filtro ya
  puesto. **La 1.5b ensaya los tres pasos desde un worktree limpio** y anota el tiempo total, que **sustituye** a la
  estimación de la 3.1 (BV2-04).

**Cómo se anota la medición del owner (3.1).** El owner pega en el PR **solo** las dos líneas `parity …` de la
corrida, con la fecha, y el implementador las copia a «Estado del spike y de las mediciones». Nunca nombres, empresas,
fechas del CV, fragmentos, número de páginas por archivo ni capturas de pantalla. La corrida se hace **en una terminal de
PowerShell propia, no desde una sesión de Claude ni de otro agente**. Si falla, se pegan solo las líneas `parity …` y el
error, sin abrir ningún CV con un agente.

El spec de paridad importa `pdf-parse`, así que **se borra en la sustitución** (4.1). Queda en el historial de la rama
y no tiene datos. La fuente inventada (`tools/cv-fixtures/parity-source/`) se queda, para repetir la paridad cuando se
actualice la biblioteca (RUNBOOK).

*Alternativas descartadas:*

- **Commitear los PDF de la persona inventada como fixtures de CI.** Los exportadores de Word y Google Docs ponen en
  los metadatos el nombre de la cuenta que los generó, que sería el del owner. Además, un binario no se revisa en un PR
  (ADR-028). La regresión de CI la cubren los sintéticos exactos.
- **Un script suelto en `tools/`.** La regla de límites de Nx impide que `tools/` importe el código del worker por ruta
  relativa (el mismo motivo por el que `cv-fixtures.ts` vive en el worker, ADR-028), y el bloque de lint de los parsers
  solo los permite en `isolation/child/**`.

### D8. Costo: tamaño de la imagen tras la poda y licencias

- **Medida**: `docker image inspect --format '{{.Size}}'` de la imagen del worker construida con
  `docker/worker.Dockerfile`, antes del cambio (con `pdf-parse`) y después (con la candidata, con `pdf-parse` todavía
  instalado para la paridad y **restado aparte**). El delta que cuenta para Q3 es el de la imagen final, sin
  `pdf-parse`. Se anota en bytes y en MB. **Las dos imágenes se construyen en la misma máquina y con el mismo almacén de
  imágenes de Docker** (C1-18, B2-05), y se anota cuáles fueron (por ejemplo, «Docker Desktop/WSL2, containerd» o
  «Docker Engine, overlay2»), porque el tamaño que informa `inspect` cambia de un almacén a otro.
- **Poda**, solo si hace falta para cumplir Q3. En la etapa `build`, después de `pnpm install --prod`, se borran del
  paquete adoptado los directorios que el hijo no carga: el build no `legacy`, el visor `web/`, los `*.map` y los
  `types/`. Se hace con una línea de `rm -rf` cuyas rutas se resuelven desde el `package.json` del paquete. La sonda
  dentro de la imagen podada (1.2a repetida) es la que demuestra que no se borró nada necesario.
- **Licencias**: `pnpm licenses list --prod --json` filtrado al árbol que entra por la candidata, comparado con una
  lista blanca (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD). Cualquier otra licencia se anota y se trata
  como corte 1 de D3, salvo que el owner la acepte por escrito.
- **`@napi-rs/canvas` fuera** de dos sitios: de `dist/apps/worker/pnpm-lock.yaml`, el candado que genera Nx y que
  instala la imagen, y de `/app/node_modules/.pnpm` dentro de la imagen (D4, C1-05).

### D9. Arranque del hijo en `arm64`

- **Criterio**: el de `cv-extract-isolation`, **p95 ≤ 1.500 ms en `arm64`**, leído de la línea `boot_p95_ms=` de la
  sonda. La sonda no falla por el valor (ADR-058 §10). El valor y el delta respecto de la línea base con `pdf-parse`
  (7.4 de `cv-extract-isolation`) se anotan con fecha. La 0.3 exige ese valor de la 7.4. **Si no está** (C2-14), la
  6.1 dispara además una corrida de la base sobre `main`, para tener con qué comparar.
- **Dónde**:
  1. **Antes de fusionar**, en el runner `ubuntu-24.04-arm` de `cd-staging` en modo de prueba, que construye y
     verifica sin publicar. **La corrida la dispara el owner** (`gh workflow run cd-staging.yml --ref
     change/cv-pdf-library-upgrade -f dry_run=true`, o el disparo equivalente que deje 35c). El implementador solo lee
     el log;
  2. **después de desplegar**, en el host de staging (`run --rm --no-deps worker node cv-extract-probe.js`).
- **Si no se cumple**, el change no se fusiona y vuelve al debate con la medición. La palanca conocida es la poda de
  D8, que reduce lo que el hijo resuelve al arrancar. Precargar en un proceso reutilizado no es una opción: ADR-058
  descartó el pool.

### D10. Sustitución, lint y «la dependencia vieja no vuelve»

- `PdfJsTextSource` pasa a ser `defaultPdfTextSource`. Mientras dura el spike, en la rama del change, la candidata ya
  es la de por defecto, para que la sonda y las suites la ejerciten, y `PdfParseTextSource` sigue disponible para la
  paridad. En la sustitución, `PdfParseTextSource` se borra.
- `pnpm remove pdf-parse @types/pdf-parse` y se borra `extractors/pdf-parse-lib.d.ts`.
- `resolveNodeModulesRoot` busca la biblioteca adoptada en vez de `pdf-parse`.
- `cv-extract-child.bundle.spec.ts` fija `mammoth` y la biblioteca adoptada.
- **Lint** (`eslint.config.mjs`):
  - en `DOMAIN_RESTRICTED_PATTERNS` la lista pasa a `…|pdfjs-dist|unpdf|pdf-parse|mammoth`;
  - en el bloque del hijo, el patrón pasa a `^(?:pdfjs-dist|unpdf|pdf-parse|mammoth)(?:/.*)?$`, con el mensaje
    actualizado.

  Las dos candidatas entran en los dos patrones, sea cual sea la adoptada, para que cambiar de una a otra no abra un
  hueco. `pdf-parse` se queda en los patrones: no cuesta nada y da un mensaje claro si alguien lo reinstala.
- **`tools/workspace-rules/src/workspace-rules.spec.ts`** (C1-16): los casos de infraestructura (dentro y fuera de
  `isolation/child/`) ya los deja `cv-extract-isolation` (`7c1d475`). Aquí solo cambia el paquete que importan los tres
  casos de extractores: **siempre `pdfjs-dist`** en lugar de `pdf-parse`, sea cual sea la biblioteca adoptada (C2-15),
  como dicen los escenarios del delta de `platform/workspace`, que parte del texto de aquel change.
- **`no-pdf-parse.spec.ts`** (worker): el `package.json` raíz no nombra `pdf-parse` ni `@types/pdf-parse`;
  `pnpm-lock.yaml` no contiene `pdf-parse@`; la biblioteca adoptada está en `dependencies` con versión exacta (sin `^`
  ni `~`). Es el escenario «La dependencia vieja no vuelve».

### D11. Alertas de vulnerabilidad de Renovate para los parsers (Q6)

Si el owner responde sí a Q6, `renovate.json` gana una `packageRule` con `matchPackageNames` igual a la biblioteca
adoptada, `mammoth`, `@xmldom/xmldom` y `jszip`, con `vulnerabilityAlerts` y `dependencyDashboardApproval: false`.

- Solo afecta a los PR que abre una alerta de seguridad. Las actualizaciones normales siguen pasando por el Dashboard
  (PR #88).
- La fusión sigue siendo manual y en una ventana autorizada: nada de `--auto`.
- `minimumReleaseAge` no se toca para las alertas.

Lo comprueba un caso en un test de configuración existente o, si no hay ninguno, en `no-pdf-parse.spec.ts`: lee
`renovate.json` y exige la regla con esos cuatro nombres. Lo que dice la documentación de Renovate sobre la precedencia
de `vulnerabilityAlerts` frente a `dependencyDashboardApproval` se confirma al escribir la regla (5.1), con un PR de
prueba si hace falta.

### D12. Los CV ya leídos no se vuelven a leer (R6)

- No hay migración ni re-extracción. Un CV en `extracted`, `failed` o con cualquier otro estado terminal conserva su
  texto y su estado.
- Un CV en `pending` en el momento del despliegue lo lee la imagen que lo tome.
- Dos CV con el mismo archivo, subidos antes y después, pueden diferir en el texto guardado. Se acepta: el análisis de
  encaje se pide sobre un CV concreto y no compara versiones.

Lo dice una oración del requirement «El cambio de biblioteca conserva el texto de los fixtures y no relee CV», **sin
escenario ni test propio** (C1-17, B1-05): probar que no ocurre algo que ningún código hace sería un test que no puede
fallar. En su lugar, la 8.1 revisa el diff del change buscando migraciones, re-encolados o cambios en el consumidor de
`extract-cv`.

### D13. Si fallan las dos candidatas

Solo se llega aquí por cortes 1 o 2 en las dos candidatas, o por la respuesta «no» a Q11 con `pdfjs-dist` ya cortado.
Un corte 3 o una 3.1 que no cumple vuelven al debate (D3).

**Qué queda (una sola lista, C1-13, completada en la iteración 2, C2-05):**

| Pieza | Queda | Sale |
|---|---|---|
| `child/pdf-extract.ts` | `PdfParseTextSource` como `defaultPdfTextSource`, `extractPdf` y `withOwnBuffer` como en `main` | `PdfJsTextSource`, la de `unpdf`, `pdfDocumentOptions` y el `statSync` de datos de pdf.js |
| `child-command.ts` | como en `main` (`resolveNodeModulesRoot` busca `pdf-parse`) | — |
| `child-command.spec.ts` | «the child command never allows addons», que vale para cualquier parser | — |
| `cv-extract-child.bundle.spec.ts` | como en `main` (`mammoth` y `pdf-parse`) | la candidata en la lista de versiones exactas |
| Dependencias | `pdf-parse`, `@types/pdf-parse`, `mammoth`; `package.json` y `pnpm-lock.yaml` como en `main` | las candidatas y la exclusión de canvas de `pnpm-workspace.yaml` |
| Tests del parser | `expected-texts.ts` y «synthetic pdfs keep the recorded text» (0.4), como regresión | `child/pdf-parity.spec.ts`, `child/pdf-extract.spec.ts` y los tests de árbol falso de pdf.js del spec del runner |
| Fixtures | `pdfWithPredefinedCMap()` en `cv-fixtures.ts`, si la 1.2b lo creó y `pdf-parse` lo lee; si no, sale. El ajuste de `encryptedPdf()` (R14) sale si `pdf-parse` ya lo leía bien | — |
| Fuente inventada | `tools/cv-fixtures/parity-source/` | — |
| `eslint.config.mjs`, `workspace-rules.spec.ts`, `renovate.json` | como en `main` | cualquier cambio del grupo 4 o 5 (no deberían existir: el grupo 4 no empezó) |
| `docker/worker.Dockerfile` | sin cambios | cualquier poda |
| Deltas de `specs/` | ninguno: describen una biblioteca que no se adoptó | los dos |
| ADR-064 | **Rechazado**, con el resultado | — |
| Design | resultado de los dos spikes, con medición y fecha, y una **pregunta nueva al owner**: (a) seguir con `pdf-parse` aislado y reintentar al publicarse una versión nueva; (b) aceptar un umbral de imagen mayor; (c) un contenedor de extracción aparte, que es la evolución anotada en ADR-058 | — |

El change se archiva con `openspec archive cv-pdf-library-upgrade --skip-specs`. Qué hace `openspec validate --strict`
con un change sin deltas (si lo acepta, avisa o falla) **se comprueba en la 0.3** con un change de prueba en el
scratchpad, y la 9.2 sigue lo que se haya visto: si falla, el PR de la 9.3 conserva un delta mínimo, el ADDED del
requirement de los sintéticos con `pdf-parse` como biblioteca.

### D14. Fusión

Después de la fila 35 no hay ventana de excepción que respetar. Rigen las reglas generales del proyecto:

- un PR del change, fusionado a mano con CI verde en una ventana autorizada por el owner, nunca con `--auto`;
- un PR de archivo, con ADR-064 a Aceptado, el número del PR y el hash del merge;
- las comprobaciones de D9 y del Migration Plan, repetidas sobre el commit desplegado.

Si el change se adelanta por la salvedad de D1, las reglas de fusión las fija el owner en ese momento.

## Risks / Trade-offs

R1, R2 y R6 conservan el número que tenían en `cv-extract-isolation` (iteración 1). Los riesgos nuevos empiezan en R13,
para no chocar con R3-R12 de aquel change.

- **R1 — Tamaño de la imagen.** `pdfjs-dist` sin podar pesa bastante más que `pdf-parse`: trae el build moderno y el
  `legacy`, el visor, mapas de fuente y tipos. Mitigación: excluir `@napi-rs/canvas`, podar antes de medir y parar en el
  umbral de Q3 (D8). `unpdf` es la alternativa si el tamaño no baja.
- **R2 — ESM desde un bundle `commonjs`.** `ERR_REQUIRE_ASYNC_MODULE` si hay `await` de nivel superior. Mitigación: D5
  (solo `require(esm)`, comprobado con un `node -e` antes de escribir código), la sonda en la imagen y la aserción del
  manifiesto generado.
- **R6 — El pdf.js nuevo puede leer distinto que el de 2017.** Puede cambiar la unión de líneas, las ligaduras, la
  normalización Unicode o el orden en columnas. Mitigación: paridad de D7 sobre tres corpus y la decisión de
  `disableNormalization`. Los CV ya leídos no se re-extraen (D12).
- **R13 — Fallos de carga de pdf.js mal clasificados.** Si una parte de la biblioteca se cargara después de `ready`, su
  ausencia daría `unreadable_file`. Mitigación: los dos módulos se cargan antes de `ready` y los directorios de CMaps y
  fuentes estándar se comprueban con `statSync` antes de `ready` (D4, C1-03), con tests y falsación. Los ficheros
  concretos de CMap se leen después, a demanda: un CMap concreto que faltara con el directorio presente solo afectaría a
  los PDF que lo necesitan.
- **R14 — El PDF cifrado generado puede comportarse distinto.** El fixture declara el diccionario de cifrado sin cifrar
  de verdad. Un pdf.js más estricto podría darlo por corrupto (`parse_error`) en vez de pedir contraseña. Mitigación:
  se ajusta el fixture para que declare un cifrado válido con contraseña de usuario no vacía, sin escribir un cifrador
  si se puede evitar (ADR-028), y el escenario no cambia.
- **R15 — Partes de pdf.js que el hijo no puede usar.** Las versiones recientes de pdf.js cargan módulos opcionales,
  como decodificadores de imagen o gestión de color, algunos en WebAssembly. La extracción de texto no decodifica
  imágenes, así que **se espera** que no se carguen. Es una hipótesis que la 1.1c confirma. Si alguno se carga y el
  modelo de permisos o los flags lo impiden, se desactiva por opción o se trata como corte 1. Segunda barrera para el
  código nativo (C1-05): el hijo no tiene `--allow-addons`, así que ni `@napi-rs/canvas` ni otro addon pueden cargarse
  aunque llegaran a instalarse. Test «the child command never allows addons».
- **R16 — El arranque del hijo sube.** Cargar pdf.js entero antes de `ready` cuesta más que `pdf-parse`. Mitigación:
  criterio de D9 medido en `arm64` antes de fusionar, con la poda como palanca.
- **R17 — `pdf-parse` 1.1.4 sigue en producción hasta que este change entre.** Es la R7 de `cv-extract-isolation`, que
  se mantiene. El aislamiento acota el daño, y la salvedad de D1 con Q9 es la única vía para adelantar la sustitución.
- **R18 — La medición del owner depende de su tiempo y de su máquina.** Sin ella no se adopta ninguna candidata y el
  grupo 4 no empieza (D3, puerta dura). Mitigación: el instrumento es una orden de PowerShell y dos líneas de salida
  (D7), la 1.5b ensaya el bloque de tres pasos desde un worktree limpio y su tiempo medido sustituye al estimado en la
  3.1; la fecha límite queda en el PR y en el manifiesto, y a los 14 días sin la 3.1 se anota «en pausa por la 3.1».
- **R19 — Los MODIFIED se escriben antes de que exista el texto sobre el que se aplican.** «Texto extraído, normalizado
  y acotado» se escribe sobre el texto del delta de `cv-extract-isolation`, y «Aislamiento de la capa de dominio» sobre
  su delta de `platform/workspace` (`7c1d475`). Mitigación: la 0.3 los compara, escenario por escenario, con el texto
  archivado antes del apply, y `openspec validate --strict` lo confirma.
- **R20 — La regla de Renovate (Q6) podría no tener la precedencia que se espera.** Mitigación: D11 la confirma al
  escribirla, con un tope de 1 h (B2-02). Si no funciona como se espera, se retira y Q6 vuelve al owner con el dato.
- **R21 — Si se adopta `unpdf`, las alertas no llegan (C1-09).** `unpdf` lleva pdf.js reempaquetado dentro, igual que
  `pdf-parse`: un aviso publicado contra `pdfjs-dist` no salta en el repositorio. **Solo se acepta si el owner dice que
  sí a Q11** (C2-08), y entonces con dos mitigaciones:
  - la consulta de avisos sigue después de fusionar, con una cadencia fija: en cada PR de Renovate que toque `unpdf` y
    una vez por trimestre;
  - un test, «the bundled pdf.js is at least the audited version», lee **en tiempo de ejecución** la `version` que
    expone el pdf.js de `unpdf` y exige que sea ≥ la registrada en la 3.2, para que una actualización no traiga un
    pdf.js más viejo.

## Migration Plan

1. **Sin migración de datos** (D12). No cambian variables, compose ni `.env`.
2. **Despliegue**: imagen nueva del worker. `api` y el SPA no cambian.
3. **Comprobación tras desplegar**:
   - subir un CV PDF con la cuenta e2e y ver `linkvault_cv_extractions_total{format="pdf",outcome="text"}` subir en
     `/metrics` desde la red interna;
   - `node cv-extract-probe.js` dentro del contenedor `worker` del host (`run --rm --no-deps`): `pdf chars=` igual al de
     antes y `boot_p95_ms` ≤ 1.500, anotado con fecha.

   Que `pdf-parse` no está en la imagen ya lo demuestran `no-pdf-parse.spec.ts` y el candado generado; no se repite en
   el host (C1-18, B2-05).
4. **Vuelta atrás**: revertir el PR y redesplegar la imagen anterior, con el procedimiento de 35b. Los CV leídos con el
   parser nuevo se quedan como están. Un CV en `pending` lo lee la imagen que lo tome.

## Costo estimado

45 tareas de menos de una hora (`tasks.md`). Eran 34 en la propuesta y 43 tras la iteración 1; la iteración 2 añade
la 1.3a' y parte la 4.5 en 4.5a y 4.5b. Se ejecutan entre 26 (fallan las dos candidatas) y 42 (`unpdf` adoptada, la
1.3a' necesaria y Q6 = sí):

- el grupo 2 (`unpdf`, 6 tareas) solo corre si `pdfjs-dist` termina en corte 1 o 2;
- el grupo 9 (salida sin sustitución, 3 tareas) solo corre si fallan las dos candidatas o Q11 = no;
- la 1.3a' solo corre si la exclusión de canvas choca con el candado congelado;
- la 5.1 solo corre si Q6 = sí.

El spike tiene un techo de 8 h (4 h por biblioteca), sin contar la espera de los builds, que tiene su propio tope de 2 h
por biblioteca (D3). La sustitución y el cierre, unas 6-8 h. Las tareas del owner llevan `[infra]` y el prefijo
«**Owner:**» (0.1 en la parte de responder, 0.5b, 3.1 y 6.1), con su tiempo dentro: unos 15 minutos para la 0.5b, el
tiempo que mida la 1.5b para la 3.1 y unos minutos para disparar `cd-staging`.

## Open Questions

Q3 y Q6 conservan el número de `cv-extract-isolation`, de donde vienen (B2-01). Las nuevas siguen desde Q9, porque aquel
change llegó a Q8.

- **Q3 [bloqueante para `/opsx:apply`] — Umbral de crecimiento de la imagen del worker** (criterio (b) de D3, D8).
  Opciones:
  - (a) ≤ 30 MB sin preguntar; si pasa de ahí, vuelve al owner;
  - (b) cualquier tamaño;
  - (c) ≤ 10 MB, que probablemente deja fuera a `pdfjs-dist` y obliga a `unpdf`.

  **Recomendación: (a).** Bloqueante porque el spike no puede juzgar (b) sin un número.
- **Q6 [no bloqueante] — ¿Alertas de vulnerabilidad de Renovate sin aprobación del Dashboard para los parsers?** Serían
  `vulnerabilityAlerts` con `dependencyDashboardApproval: false` para la biblioteca adoptada, `mammoth`,
  `@xmldom/xmldom` y `jszip` (D11). Contradice en parte la decisión del PR #88, así que la decide el owner. Opciones:
  - (a) sí, solo para alertas de seguridad de esos cuatro paquetes;
  - (b) no: todo por el Dashboard.

  **Recomendación: (a).** Con (b), la tarea 5.1 no se hace.
- **Q9 [no bloqueante] — ¿Cómo se vigila la salvedad de B3-03 hasta que el change entre?** (D1, R17). Opciones:
  - (a) una consulta fechada de la base pública de avisos (GitHub Advisory Database y NVD, buscando «pdf.js»,
    `pdfjs-dist` con rango que incluya 1.10 y `pdf-parse` (B2-03 de la iteración 1)) en tres momentos fijos: la
    aprobación de este change (0.2), antes de la 10.7 de 35b y al abrir 35c. Si aparece un aviso, el arquitecto lo
    evalúa contra los flags del hijo y el owner decide;
  - (b) un workflow programado que consulte la base y abra un issue: toca `.github/workflows` mientras la fila 35 está
    abierta;
  - (c) sin vigilancia: se acepta esperar a 35c.

  **Recomendación: (a)**, que no toca nada de la fila 35 y cuesta minutos.
- **Q11 [no bloqueante hasta la 2.6] — ¿Se acepta `unpdf` sin alertas de dependencias?** (C2-08, R21). Solo importa si
  `pdfjs-dist` se corta y `unpdf` cumple (a)-(d). Opciones:
  - (a) sí, con la consulta de avisos en cada PR de Renovate de `unpdf` y una vez por trimestre, y el test de versión
    mínima de su pdf.js leída en tiempo de ejecución;
  - (b) no: el corte de `unpdf` se trata como el de las dos candidatas (D13).

  **Recomendación: (a).** Con las dos mitigaciones, el riesgo es menor que seguir con el pdf.js de 2017, que es lo que
  deja (b).

Q10 (texto de B2-03) quedó resuelta en la iteración 1: la sesión principal recuperó el texto de la transcripción. Ver
«Debate iteración 1 (2026-11-04)».

## Estado del spike y de las mediciones

Se completa durante `/opsx:apply`, con fecha:

- la consulta de avisos de Q9;
- la línea base (0.4);
- las imágenes de contenedor (TeX Live y LibreOffice, con su tag o digest) con que se generaron los PDF de la 0.5a;
- la fecha límite de la 3.1 (1.6 o 2.6) y la respuesta a Q11, si hizo falta;
- qué hace `validate --strict` con un change sin deltas (0.3, D13);
- por biblioteca: versión, hora de inicio y de fin de cada tarea, esperas de build aparte, resultado del `node -e` de
  D5, cómo se resolvió el worker falso, si se cargó algún módulo opcional (R15), arranque local, delta de imagen antes y
  después de la poda (con máquina y almacén de Docker), licencias, paridad sintética, tabla de productores (`doc=`,
  recall y orden de los cinco productores, por cada valor de `disableNormalization`), el tiempo total del bloque de tres
  pasos ensayado desde un worktree limpio (1.5b) y el corte o la adopción provisional;
- las dos líneas `parity …` del owner (3.1), o «en pausa por la 3.1» con fecha si pasaron 14 días;
- la decisión de `disableNormalization`;
- `boot_p50_ms`/`boot_p95_ms` en `arm64` (6.1) y en el host (8.3).

Nada de esto lleva texto, nombres de archivo ni metadatos de ningún PDF.

## Casos de prueba por escenario

| Escenario (delta) | Test | Dónde | Tarea |
|---|---|---|---|
| Las líneas de un PDF se unen por su altura | «text items on the same y share a line» | `extractors/extractors.spec.ts` | 4.4 |
| PDF con texto, Un PDF de muchas páginas, Un PDF con texto sin fin (heredados) | los de `extractors.spec.ts` y `pathological.spec.ts`, sin cambios | `worker` y `worker-isolation` | 1.4 |
| La dependencia vieja no vuelve | «the root manifest does not list pdf-parse», «the lockfile does not resolve pdf-parse», «the pdf library is pinned to an exact version» | `no-pdf-parse.spec.ts` | 4.2 |
| El manifiesto del worker fija la biblioteca de PDF | «dist package.json pins the parser libraries» (con la adoptada) y «the worker lockfile has no native canvas» | `cv-extract-child.bundle.spec.ts` | 1.1a, 1.3a, 4.1 |
| La evaluación de código está desactivada al abrir el PDF | «pdf document options are exactly the audited ones» (`pdfDocumentOptions` con `toEqual`) y «pdf.js data paths resolve under the allowed node_modules root» | `child/pdf-extract.spec.ts` (nuevo) | 1.1c, 4.4 |
| Falta el módulo de worker de pdf.js | «a missing pdf.js worker module is a boot error» (árbol falso, `MODULE_NOT_FOUND`, nunca `ERR_ACCESS_DENIED`) | `isolated-extraction.runner.spec.ts` | 1.1b |
| Faltan los mapas de caracteres de pdf.js | «missing pdf.js cmaps is a boot error» (árbol falso en el orden de D4, `ENOENT`) y la falsación de la sonda sin `cmaps/` en la imagen (sale con 1) | `isolated-extraction.runner.spec.ts` y `verify-artifact.sh` local | 1.1c, 4.5b |
| Un PDF protegido con contraseña con la biblioteca nueva | «an encrypted PDF fails as password» | `extractors/extractors.spec.ts` | 1.4 |
| Los PDF sintéticos se leen igual que antes | «synthetic pdfs keep the recorded text» | `extractors/extractors.spec.ts` | 0.4, 1.4 |
| La infraestructura importa un extractor de documentos (MODIFIED) | el caso de `cv-extract-isolation` (`7c1d475`), con `pdfjs-dist` | `workspace-rules.spec.ts` | 4.3 |
| La infraestructura fuera del hijo importa un extractor de documentos (MODIFIED) | el caso de `cv-extract-isolation` (`7c1d475`), con `pdfjs-dist` | `workspace-rules.spec.ts` | 4.3 |
| El dominio importa un extractor de documentos (MODIFIED) | «a domain folder of the worker imports a document extractor», con `pdfjs-dist` | `workspace-rules.spec.ts` | 4.3 |
| (R15, sin escenario) | «the child command never allows addons» | `child-command.spec.ts` | 1.3a |
| (R21, solo si `unpdf` y Q11 = (a)) | «the bundled pdf.js is at least the audited version» (versión leída en tiempo de ejecución) | `no-pdf-parse.spec.ts` | 4.2 |
| (guardias de D7, sin escenario) | «parity refuses a directory inside any repository» (siempre, fuera del `runIf`) y «a failing parity read leaves no text in the output» | `child/pdf-parity.spec.ts`, temporal | 1.5a |

«Un CV ya leído no se vuelve a leer» salió del delta en la iteración 1 (C1-17): queda como oración del requirement y
como revisión del diff en la 8.1.

## Debate iteración 1 (2026-11-04)

`critic`: 1 P0 (C1-01) y C1-02 a C1-18 como P1/P2. `business`: 1 V0 (B0-01) y B1-01 a B1-06, B2-01 a B2-05. Decisiones
de `reflect` aplicadas en este design, los dos deltas, `tasks.md`, ADR-064 y la proposal.

| id | decisión | motivo |
|---|---|---|
| C1-01 (P0) | Aceptado: corpus de productores desde una fuente inventada en texto plano (`.tex`/`.fodt`, sin metadatos). 0.5a (implementador, por CLI con `pdflatex` y `soffice`; si faltan, pasa al owner) y 0.5b (`[owner]`, Word y Google Docs, en la sesión de la 3.1). (d) es provisional con 3 productores y se completa en la 3.1 (D3) | Sin fuente común, los productores medían documentos distintos, y nadie tenía asignado generarlos |
| B0-01 (V0) | Aceptado: los CV reales son del owner o de personas que se los dieron para esto; nunca se descargan del almacén de staging ni del de producción; al menos 3 herramientas distintas si las hay (D7, 3.1) | La medición no puede convertirse en una vía de acceso a CV de usuarios |
| Q10 / B2-03 | Resuelta: el texto apareció en la transcripción. Lo cierran B1-01 (etiqueta `[owner]`), B1-02/C1-08 (ruta y orden concretas), B1-03 (puerta dura y pausa a los 14 días) y B1-04 (tiempo medido en la 1.5b). Su opción «si se parte, pasa a B» no aplica: aquí no hay otro change al que pasarla, porque sin la medición del owner no se adopta ninguna candidata (D3) | El hueco que señalaba (cómo recibe el owner el script, cuánto tarda, qué pasa si no lo corre) queda cubierto por esas cuatro decisiones |
| C1-02 | Aceptado: la única vía es `require(esm)`; primer paso de la 1.1a con un `node -e`; si falla, corte 1, salvo un MODIFIED del Impact aceptado en debate (D5) | Un `import()` que el compilador no reescriba exige un mecanismo que el Impact no nombra |
| C1-03 | Aceptado: `statSync` de un fichero de `cmaps/` y otro de `standard_fonts/` antes de `ready` (`boot_error` si falla); test de rutas bajo la raíz por `realpath`; falsación en la imagen (4.5) y escenario nuevo «Faltan los mapas de caracteres de pdf.js» (D4, D6) | Sin esto, un paquete incompleto daba `unreadable_file` solo en los PDF que necesitan CMaps |
| C1-04 | Aceptado: `createRequire(__filename).resolve('<paquete>/package.json')` (D4) | Una sola forma de resolver, sin rutas a mano |
| C1-05 | Aceptado: inspección de `/app/node_modules/.pnpm` en la imagen; alternativa si la exclusión choca con el candado congelado; `--allow-addons` ausente como segunda barrera, con test (D4, D8, R15) | El candado de `dist/` podía no reflejar la exclusión |
| C1-06 | Aceptado: `assertOutsideAnyRepository(dir)` pura, busca `.git` en los ancestros, `path.relative`, minúsculas en win32, antes de `readdir`, testeada fuera del `runIf` con falsación real (D7) | El guardia anterior solo miraba la raíz de este workspace |
| C1-07 (+ B1-06, B2-04) | Aceptado: `CV_PARITY_PER_DOC=1` solo para productores; `console` silenciado y `verbosity: 0`; ningún `expect` sobre texto, con test de que un fallo no deja texto; las dos normalizaciones en una corrida; `failed_reads` definido y `failed_reads_ref` (D7) | Una aserción que falla imprime lo que compara |
| C1-08 (= B1-02) | Aceptado: orden de PowerShell única, con `--skip-nx-cache`, `Remove-Item` y `run=<uuid>` (D7) | El owner trabaja en Windows y la caché de Nx devolvía corridas viejas |
| C1-09 | Aceptado: `unpdf` solo ante fallos de (a), (b) o (c); (d) o la 3.1 vuelven al debate; si se adopta `unpdf`, R21 con la consulta de Q9 viva y un test de versión mínima de su pdf.js (D3, R21) | `unpdf` reempaqueta el mismo pdf.js: un problema de texto sería el mismo |
| C1-10 | Aceptado: 1.1a/b/c, 1.2a/b, 1.3a/b y 1.5a/b; las falsaciones de imagen que no deciden la adopción, a la 4.5; la espera de builds no cuenta para el tope, se anota aparte, y > 30 min es hallazgo (D3) | Tareas de más de una hora y un tope ambiguo |
| C1-11 | Aceptado: el hijo del test vive dentro del árbol falso, con `allowRead=<tmp>`, y afirma `MODULE_NOT_FOUND`, nunca `ERR_ACCESS_DENIED` (D4, 1.1b) | El test probaba el modelo de permisos en vez de la ausencia del módulo |
| C1-12 | Aceptado: `tsconfig.cv-child-test.json`, `verify-artifact.sh` y `tools/cv-fixtures/README.md` en la 4.1 y la 7.1; `grep` ampliado a `infra` | Quedaban menciones de `pdf-parse` fuera de la lista |
| C1-13 | Aceptado: tabla única de qué queda en D13; la 0.3 comprueba qué hace `validate --strict` sin deltas | La salida sin sustitución estaba repartida en tres sitios |
| C1-14 | Aceptado: un sintético que difiere se anota con su diff y vuelve al debate, sin pasar a `unpdf` (D3) | Dice más de la unión de líneas que de la biblioteca |
| C1-15 | Aceptado: `pdfDocumentOptions(bytes, paths)` pura, con `toEqual` exacto y aserciones de rutas (D4, delta) | El doble del cargador solo comprobaba dos opciones |
| C1-16 | Aceptado: el MODIFIED de `platform/workspace` parte del delta de `cv-extract-isolation` (`7c1d475`); fuera la rama «si no lo corrige» de D10; la 4.3 se reduce; la 0.3 compara escenario por escenario | El arreglo ya está en la rama de aquel change |
| C1-17 (= B1-05) | Aceptado: fuera el escenario «Un CV ya leído no se vuelve a leer» y su test; queda la oración y la revisión del diff en la 8.1 (D12) | Un test de algo que ningún código hace no puede fallar |
| C1-18 + B2-05 | Aceptado: el tamaño se mide en la misma máquina y el mismo almacén, anotados; fuera la comprobación de `pdf-parse` en el host (D8, Migration Plan) | `inspect` depende del almacén; la otra comprobación ya la cubre un test |
| B1-01 | Aceptado: 0.5b, 3.1 y 6.1 con etiqueta `[owner]`, y una 3.1b `[backend]` para leer y decidir | Las hace el owner, no el implementador |
| B1-03 | Aceptado: puerta dura, sin la 3.1 no empieza el grupo 4; a los 14 días, «en pausa por la 3.1»; tiempo estimado dentro de la tarea (D3) | Sin plazo, el change quedaba a medias sin estado |
| B1-04 | Aceptado: la 1.5b corre los productores con la misma orden que la 3.1 y anota cuánto tardó | La 3.1 tiene que decir un tiempo real |
| B2-01 | Aceptado: una línea en el RUNBOOK, «Operar los CV», sobre cómo repetir la paridad (7.1) | Se repite al actualizar la biblioteca |
| B2-02 | Aceptado: tope de 1 h para la 5.1 (R20) | Que confirmar la precedencia de Renovate no se coma la sustitución |
| B2-03 | Aceptado: `pdf-parse` entra en la consulta de Q9 (a) | Un aviso puede publicarse contra el paquete y no contra pdf.js |

Convergencia: NO (verificación en la iteración 2).

## Debate iteración 2 (2026-11-07)

`critic`: 0 P0, 7 P1 y 8 P2 (C2-01 a C2-15). `business`: 0 V0 (B0-01 cerrado), con BV1-01 a BV1-04 y BV2-01 a BV2-06.
Decisiones de `reflect` aplicadas en este design, el delta de `cv/extraction` (sin cambios de texto en esta iteración),
`tasks.md`, ADR-064 y la proposal. Algunas filas de la iteración 1 quedan sustituidas por estas: `[owner]` (B1-01), (d)
provisional (C1-01) y el origen de los CV (B0-01).

| id | decisión | motivo |
|---|---|---|
| C2-01, C2-02, C2-11, BV1-01, BV1-02 | Aceptado: la 0.5a genera LaTeX, LibreOffice y dos columnas con contenedores públicos (TeX Live y LibreOffice), con la fuente montada en solo lectura y la salida fuera del repo (`-output-directory`/`--outdir`); genera también `persona-inventada.docx` fuera del repo; la variante es `persona-inventada-dos-columnas.fodt`; la verificación suma `git status --porcelain` vacío; sale la rama «pasa al owner». La 0.5b (Word desde el `.docx` y Google Docs) va **antes del grupo 1**, cuando el owner quiera, en la carpeta que lee la 1.5b. La 1.5b mide los cinco productores con detalle; desaparece (d) provisional y la 3.1 queda solo con CV reales (D3, D7) | El corpus no puede depender de lo que haya instalado en una máquina, y (d) tiene que decidirse dentro del spike |
| C2-06 + B0-01 | Decisión de `reflect`: la paridad corre los dos parsers en el proceso de Vitest, fuera del aislamiento, así que la 3.1 se limita a **CV cuyo origen controla el owner: los suyos o los que generó él**. Fuera «de personas que se los dieron». Se conserva «nunca se descargan del almacén de staging ni de producción». La variedad la da el corpus de productores. De BV2-02 queda: con menos de 5 CV, se mide con los que haya y se anota `docs=<n>`, y se borran las copias temporales al terminar (D7, 3.1, ADR-064, proposal) | Un PDF ajeno abierto por el pdf.js de 2017 fuera del hijo es justo el riesgo que ADR-058 cierra |
| C2-07 + BV1-04 + BV2-06 | Decisión de `reflect`: sin etiqueta nueva y sin tocar los comandos `/lv:*`. Las tareas del owner (0.1 en la parte de responder, 0.5b, 3.1 y 6.1) llevan `[infra]` y el prefijo «**Owner:**»; la del agente es pedir el dato y verificarlo, como las 7.3 y 7.4 de `cv-extract-isolation`. Fuera la explicación de `[owner]` de la cabecera. La 3.1 se corre en una terminal de PowerShell propia, nunca desde una sesión de Claude ni de otro agente; si falla, solo las líneas `parity …` y el error | El manifiesto y los comandos solo conocen cuatro etiquetas; y un agente no debe ver un CV |
| C2-03 | Aceptado: `runParity` recibe las dos `PdfTextSource` por parámetro; el test usa dobles con textos inventados distintos, captura `stdout`, `stderr` y los errores, y afirma que no aparece ninguna palabra; la falsación sí cae (D7) | El test anterior no podía fallar con la salida real |
| C2-04 | Aceptado: `minimalPdf()` sale del corpus sintético (D7, 0.4) | Vive en `web-e2e` y el worker no puede importarlo |
| C2-05 | Aceptado: tabla de D13 completada (pieza por pieza) y lista admitida de la 9.1 alineada con ella | Quedaban ficheros del spike sin destino |
| C2-08 | Aceptado: Q11 nueva, no bloqueante hasta la 2.6; si es no, el corte de `unpdf` pasa a D13. Cadencia tras fusionar: cada PR de Renovate de `unpdf` y una consulta trimestral; versión leída de `version` en tiempo de ejecución (D3, R21) | Aceptar `unpdf` sin alertas es una decisión del owner, no del spike |
| C2-09 | Aceptado: si las esperas acumuladas de una biblioteca pasan de 2 h, corte 2 (D3) | Sin tope, las esperas no tenían límite |
| C2-10 | Aceptado: 4.5 en 4.5a y 4.5b; 1.3a' para la alternativa de canvas si hace falta | Tareas de más de una hora |
| C2-12 | Aceptado: test «missing pdf.js cmaps is a boot error», con el árbol falso en un orden fijo y los dos ficheros del `statSync` nombrados (`cmaps/Identity-H.bcmap`, `standard_fonts/LiberationSans-Regular.ttf`); con `unpdf` sin datos, `pdfjs-dist` a la misma versión o corte 1 (D4) | El `statSync` no tenía regresión propia |
| C2-13 | Aceptado: con `CV_PARITY_PER_DOC=1`, el nombre sale solo si está en la lista de los cinco productores; si no, `doc=#<i>` (D7) | Un CV puesto por error en la carpeta de productores no debe imprimir su nombre |
| C2-14 | Aceptado: la 0.3 exige el valor de la 7.4 de `cv-extract-isolation`; si no está, la 6.1 corre también la base sobre `main` (D9) | Sin línea base no hay delta |
| C2-15 | Aceptado: los casos de `workspace-rules.spec.ts` usan siempre `pdfjs-dist` (D10) | Coinciden con los escenarios del delta, sea cual sea la adoptada |
| BV1-03 | Aceptado: el PR deja al owner un bloque de tres pasos (rama y commit, `pnpm install`, orden); la 1.5b los ensaya desde un worktree limpio y anota el tiempo total (D7) | El owner no tiene que adivinar cómo preparar su máquina |
| BV2-01 | Aceptado: la 1.6 o la 2.6 anota en el PR y en la fila del manifiesto la fecha límite de la 3.1; la pausa termina con la 3.1 o con la decisión (c) de D13 (D3) | La pausa necesitaba fecha visible y una salida |
| BV2-03 | Aceptado: variante de la orden con `$env:CV_PARITY_PER_DOC='1'` y su `Remove-Item` (D7) | La 1.5b la necesita |
| BV2-04 | Aceptado: el tiempo medido en la 1.5b sustituye al estimado de la 3.1 (D7) | Un tiempo real |
| BV2-05 | Aceptado: fuera la falsación de la 6.1b | Leer un número no es un guardia |

Convergencia: SI (iteración 2: critic P0 0, business V0 0; Q3, Q6, Q9 y Q11 pendientes del owner).
