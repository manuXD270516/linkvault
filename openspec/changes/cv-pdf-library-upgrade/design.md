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
reporte esa regla. Por la lectura del código, ese caso debería estar en rojo en `change/cv-extract-isolation`: no se
ejecutó, porque el worktree no tiene dependencias instaladas. Si `cv-extract-isolation` lo corrige antes de archivar
(MODIFIED de `platform/workspace` y caso del test movidos a `isolation/child/`), el MODIFIED de este change se rehace
sobre ese texto (tarea 0.3). Si no lo corrige, lo corrige este change (D10).

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

**Tope: 4 h por biblioteca**, repartidas en las tareas 1.1-1.5 (`pdfjs-dist`) y 2.1-2.5 (`unpdf`), cada una de menos de
una hora. Cada tarea anota cuándo empezó y cuándo terminó en «Estado del spike y de las mediciones». El **corte** de una
biblioteca es explícito y se da en el primero de estos casos:

1. una condición falla de forma que no se arregla dentro de la tarea (por ejemplo, una licencia GPL en el árbol o un
   `ERR_ACCESS_DENIED` que solo se resuelve ampliando la lista de lecturas fuera de `node_modules`);
2. la suma de las tareas de esa biblioteca llega a 4 h sin cumplir (a)-(d);
3. la paridad cae un 5 % o más en cualquier PDF de productor (recall < 0,95 u orden < 0,95). En ese caso no se pasa a
   la candidata siguiente: **se para el spike y se vuelve al debate**, porque una caída así dice más del corpus o de
   la métrica que de la biblioteca.

En los casos 1 y 2 se cierra la biblioteca (tarea 1.6 o 2.6) y se pasa a la siguiente. Si la candidata cumple (a)-(d),
el owner pasa sus CV reales (tarea 3.1). Si su medición no cumple, esa candidata también se cierra y se pasa a la
siguiente, y la medición del owner **se repite con la que se adopte** (PO-08). Si fallan las dos, se aplica D13.

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
  - Test «a missing pdf.js worker module is a boot error» (1.1).
- **Opciones de `getDocument`:**
  - `data`: los bytes copiados con `withOwnBuffer`, como `Uint8Array` propio y no como `Buffer`;
  - `isEvalSupported: false`;
  - `disableFontFace: true`;
  - `useSystemFonts: false`;
  - `enableXfa: false`;
  - `useWorkerFetch: false`;
  - `isOffscreenCanvasSupported: false`;
  - `verbosity` en errores;
  - `cMapUrl`, `cMapPacked: true` y `standardFontDataUrl`, apuntando a los directorios del propio paquete, resueltos
    desde su `package.json` y no por una ruta escrita a mano;
  - sin `url` ni ninguna fuente remota.

  `--disallow-code-generation-from-strings` sigue en la línea de órdenes, como segunda barrera.
- **Sin canvas y sin `Worker` anidado.** `@napi-rs/canvas` se excluye de la instalación en `pnpm-workspace.yaml`, con la
  opción de pnpm que excluye dependencias opcionales (`ignoredOptionalDependencies`, que se confirma con pnpm 12.4.2 en
  la 1.3). El «worker falso» corre dentro del propio hijo. El modelo de permisos ya deniega `new Worker`.
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
dependencias de `node_modules` como externas. El spike prueba, en este orden, y se queda con la primera vía que pase
(a):

1. **`require(esm)`** de Node 22.23. Funciona si el módulo no usa `await` de nivel superior. Si lo usa, falla con
   `ERR_REQUIRE_ASYNC_MODULE` en el arranque, y eso ya es `boot_error`.
2. **`import()` dinámico que el compilador no reescriba**, con una cadena literal para que el grafo de Nx y el
   generador del `package.json` vean la dependencia. La 1.1 anota cómo queda en el bundle y que
   `dist/apps/worker/package.json` lista la biblioteca con versión exacta, que es la aserción de
   `cv-extract-child.bundle.spec.ts`.

Las dos vías conservan las tres aserciones del test del bundle: un solo fichero, sin `__webpack_require__.e` y sin
`require("./…")`. El riesgo de que funcione en Vitest y no en la imagen lo cierra la sonda dentro de la imagen (1.2).

### D6. La lista de lecturas no crece; si tuviera que crecer, vuelve al debate

El `scope` decía «lista de `--allow-fs-read` ampliada (CMaps y fuentes estándar del paquete)». Esa frase venía de la
iteración 1 de `cv-extract-isolation`, cuando la lista era por paquete. La iteración 2 (N2) la fijó en dos rutas: el
script del hijo y **la raíz de `node_modules`**. Con pnpm, `node_modules/pdfjs-dist` enlaza a
`node_modules/.pnpm/…`, dentro de la misma raíz, así que los CMaps (`cmaps/`), las fuentes estándar
(`standard_fonts/`) y el módulo del worker falso ya son legibles **sin añadir nada**.

- La 1.2 lo demuestra dentro de la imagen, con la lista de producción sin cambios y un PDF que necesita un CMap
  predefinido (fixture nuevo `pdfWithPredefinedCMap()`, si se puede generar en la tarea; si no, se anota y la
  comprobación queda en el PDF de productor que lo necesite).
- **Si hiciera falta una ruta fuera de `node_modules`**, el change vuelve al debate con un MODIFIED de «La lectura corre
  aislada del proceso del worker», que remite a la lista del design de `cv-extract-isolation`. Este change no lo
  modifica mientras la lista no cambie.
- **Desviación del `scope`, registrada:** «ampliada» pasa a «comprobada sin ampliar», por la razón de arriba.

*Alternativa descartada:* estrechar la lista a los directorios de cada paquete en vez de la raíz. Con `mammoth` y su
árbol (`jszip`, `@xmldom/xmldom`, `bluebird` y otros) serían decenas de rutas que se rompen con cada actualización, y
la raíz de `node_modules` no contiene secretos.

### D7. Paridad: qué se mide, sobre qué, cómo se anota sin datos personales

**Definiciones** (fijas antes de medir; las implementa el spec de paridad de la 1.5):

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
| Sintéticos: `pdfWithText()` y `pdfWithoutText()` de `cv-fixtures.ts`, `pdfWithPageMarks(60)` de `pathological-fixtures.ts`, y `minimalPdf()` de `apps/web-e2e/src/support/cv-files.ts` | generados en el test | **igualdad exacta**, línea a línea, contra `extractors/fixtures/expected-texts.ts`, capturado con `pdf-parse` en la 0.4 (texto inventado, sin datos personales) |
| Productores: una persona inventada exportada desde Word, LibreOffice, Google Docs, LaTeX y una plantilla a dos columnas (≥ 5 PDF) | **fuera del repositorio**, en un directorio de quien mide | recall ≥ 0,98 y orden = 1,00 en cada PDF; recall < 0,95 u orden < 0,95 en cualquiera → corte 3 de D3 |
| CV reales del owner (5 o 6) | **solo en la máquina del owner** | el mismo criterio que los productores, con la candidata adoptada |

**`disableNormalization`:** se mide con `true` y con `false`. Se elige `true` si la normalización de pdf.js baja el
recall mínimo frente a `pdf-parse`, y `false` (el valor por defecto de pdf.js) si lo mejora o lo deja igual. Con la
medición del owner se confirma, o se cambia si sus CV dicen lo contrario: en ese caso decide el recall mínimo de sus
CV.

**El instrumento** es un spec de Vitest, `child/pdf-parity.spec.ts`, en el proyecto `worker-isolation`. Corre las dos
implementaciones de `PdfTextSource` en el proceso de test, que es donde vive la comparación de texto; el aislamiento ya
se prueba aparte. Se salta si no hay `CV_PARITY_DIR`, así que CI nunca lo ejecuta. Con la variable puesta:

- **se niega a leer un directorio dentro del repositorio**: si `CV_PARITY_DIR` resuelto (`realpath`) está bajo la raíz
  del workspace, falla con «CV_PARITY_DIR must be outside the repository». Es un guardia con falsación (1.5) que evita
  que un CV acabe en `git status`;
- **no escribe nada en disco** y no imprime nombres de archivo, texto, tokens, metadatos ni hashes. Etiqueta cada
  archivo como `doc-1..n` en un orden aleatorio por corrida;
- **imprime una sola línea de agregados**:

  ```
  parity source=<biblioteca>@<versión> normalization=<true|false> docs=<n> recall_min=<0.000> recall_mean=<0.000> order_ok=<k>/<n> failed_reads=<m>
  ```

  y, para los productores, una línea por archivo con `doc-i recall=<x> order=<y>`. El productor lo anota a mano quien
  mide, porque el nombre del archivo no se imprime.

**Cómo se anota la medición del owner (3.1).** El owner pega en «Estado del spike y de las mediciones» (o en un
comentario del PR, que el implementador copia) **solo** la línea `parity …` de cada corrida, con la fecha y, si quiere,
cuántos de sus CV vienen de cada tipo de herramienta («Word: 3, Google Docs: 2, desconocido: 1»). Nunca nombres,
empresas, fechas del CV, fragmentos, número de páginas por archivo ni capturas de pantalla.

El spec de paridad importa `pdf-parse`, así que **se borra en la sustitución** (4.1). Queda en el historial de la rama
y no tiene datos.

*Alternativas descartadas:*

- **Commitear los PDF de la persona inventada como fixtures de CI.** Los exportadores de Word y Google Docs ponen en
  los metadatos el nombre de la cuenta que los generó, que sería el del owner. Además, un binario no se revisa en un PR
  (ADR-028). La regresión de CI la cubren los sintéticos exactos.
- **Un script suelto en `tools/`.** La regla de límites de Nx impide que `tools/` importe el código del worker por ruta
  relativa (el mismo motivo por el que `cv-fixtures.ts` vive en el worker, ADR-028), y el bloque de lint de los parsers
  solo los permite en `isolation/child/**`.

### D8. Costo: tamaño de la imagen tras la poda y licencias

- **Medida**: `docker image inspect --format '{{.Size}}'` de la imagen del worker construida en local con
  `docker/worker.Dockerfile`, antes del cambio (con `pdf-parse`) y después (con la candidata, `pdf-parse` todavía
  instalado para la paridad, **restado aparte**). El delta que cuenta para Q3 es el de la imagen final, sin
  `pdf-parse`. Se anota en bytes y en MB.
- **Poda**, solo si hace falta para cumplir Q3. En la etapa `build`, después de `pnpm install --prod`, se borran del
  paquete adoptado los directorios que el hijo no carga: el build no `legacy`, el visor `web/`, los `*.map` y los
  `types/`. Se hace con una línea de `rm -rf` cuyas rutas se resuelven desde el `package.json` del paquete. La sonda
  dentro de la imagen podada (1.2 repetida) es la que demuestra que no se borró nada necesario.
- **Licencias**: `pnpm licenses list --prod --json` filtrado al árbol que entra por la candidata, comparado con una
  lista blanca (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD). Cualquier otra licencia se anota y se trata
  como corte 1 de D3, salvo que el owner la acepte por escrito.
- **`@napi-rs/canvas` fuera**: `dist/apps/worker/pnpm-lock.yaml`, el candado que genera Nx y que instala la imagen, no
  lo contiene.

### D9. Arranque del hijo en `arm64`

- **Criterio**: el de `cv-extract-isolation`, **p95 ≤ 1.500 ms en `arm64`**, leído de la línea `boot_p95_ms=` de la
  sonda. La sonda no falla por el valor (ADR-058 §10). El valor y el delta respecto de la línea base con `pdf-parse`
  (7.4 de `cv-extract-isolation`) se anotan con fecha.
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
- **`tools/workspace-rules/src/workspace-rules.spec.ts`**:
  - el caso del dominio importa la biblioteca adoptada;
  - el caso de infraestructura pasa a un archivo virtual bajo `apps/worker/src/modules/cv/infrastructure/isolation/child/`
    (debe pasar);
  - se añade `a worker infrastructure file outside the isolated child imports a document extractor`
    (`apps/worker/src/modules/cv/infrastructure/probe.ts`, debe fallar).

  Así queda el delta de `platform/workspace`.
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

Escenario «Un CV ya leído no se vuelve a leer».

### D13. Si fallan las dos candidatas

1. En la rama del change, `defaultPdfTextSource` vuelve a `PdfParseTextSource`, se desinstalan las candidatas, se quita
   la exclusión de canvas y se borra el spec de paridad. `git diff` contra el `main` del momento queda solo en este
   directorio de change y en los documentos.
2. El design anota el resultado del spike (las condiciones que fallaron, con medición y fecha), y una **pregunta nueva
   al owner** en Open Questions con estas opciones: (a) seguir con `pdf-parse` aislado y reintentar al publicarse una
   versión nueva; (b) aceptar un umbral de imagen mayor; (c) un contenedor de extracción aparte, que es la evolución
   anotada en ADR-058.
3. Los deltas de `specs/` se **retiran** del change, porque describen una biblioteca que no se adoptó.
4. ADR-064 pasa a **Rechazado**, con el resultado.
5. El change se archiva con `openspec archive cv-pdf-library-upgrade --skip-specs`, para que el spike quede en el
   archivo.

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
- **R2 — ESM desde un bundle `commonjs`.** `ERR_REQUIRE_ASYNC_MODULE` si hay `await` de nivel superior, y un `import()`
  que el compilador podría reescribir. Mitigación: D5, la sonda en la imagen y la aserción del manifiesto generado.
- **R6 — El pdf.js nuevo puede leer distinto que el de 2017.** Puede cambiar la unión de líneas, las ligaduras, la
  normalización Unicode o el orden en columnas. Mitigación: paridad de D7 sobre tres corpus y la decisión de
  `disableNormalization`. Los CV ya leídos no se re-extraen (D12).
- **R13 — Fallos de carga de pdf.js mal clasificados.** Si una parte de la biblioteca se cargara después de `ready`, su
  ausencia daría `unreadable_file`. Mitigación: los dos módulos se cargan antes de `ready` (D4), con un test con
  falsación. Los CMaps y las fuentes estándar se leen después, a demanda; si faltaran en la imagen, solo fallarían los
  PDF que los necesitan. Por eso la sonda los ejerce (D6).
- **R14 — El PDF cifrado generado puede comportarse distinto.** El fixture declara el diccionario de cifrado sin cifrar
  de verdad. Un pdf.js más estricto podría darlo por corrupto (`parse_error`) en vez de pedir contraseña. Mitigación:
  se ajusta el fixture para que declare un cifrado válido con contraseña de usuario no vacía, sin escribir un cifrador
  si se puede evitar (ADR-028), y el escenario no cambia.
- **R15 — Partes de pdf.js que el hijo no puede usar.** Las versiones recientes de pdf.js cargan módulos opcionales,
  como decodificadores de imagen o gestión de color, algunos en WebAssembly. La extracción de texto no decodifica
  imágenes, así que **se espera** que no se carguen. Es una hipótesis que la 1.1 confirma. Si alguno se carga y el
  modelo de permisos o los flags lo impiden, se desactiva por opción o se trata como corte 1.
- **R16 — El arranque del hijo sube.** Cargar pdf.js entero antes de `ready` cuesta más que `pdf-parse`. Mitigación:
  criterio de D9 medido en `arm64` antes de fusionar, con la poda como palanca.
- **R17 — `pdf-parse` 1.1.4 sigue en producción hasta que este change entre.** Es la R7 de `cv-extract-isolation`, que
  se mantiene. El aislamiento acota el daño, y la salvedad de D1 con Q9 es la única vía para adelantar la sustitución.
- **R18 — La medición del owner depende de su tiempo y de su máquina.** Sin ella no se adopta ninguna candidata (D3).
  Mitigación: el instrumento es un comando y una línea de salida (D7), y la tarea 3.1 dice exactamente qué pegar.
- **R19 — Los MODIFIED se escriben antes de que exista el texto sobre el que se aplican.** «Texto extraído, normalizado
  y acotado» se escribe sobre el texto del delta de `cv-extract-isolation`, y «Aislamiento de la capa de dominio» sobre
  la spec vigente, que aquel change quizá modifique (Context, hallazgo). Mitigación: la 0.3 rehace los dos sobre el
  texto archivado antes del apply y `openspec validate --strict` lo confirma.
- **R20 — La regla de Renovate (Q6) podría no tener la precedencia que se espera.** Mitigación: D11 la confirma al
  escribirla. Si no funciona como se espera, se retira y Q6 vuelve al owner con el dato.

## Migration Plan

1. **Sin migración de datos** (D12). No cambian variables, compose ni `.env`.
2. **Despliegue**: imagen nueva del worker. `api` y el SPA no cambian.
3. **Comprobación tras desplegar**:
   - subir un CV PDF con la cuenta e2e y ver `linkvault_cv_extractions_total{format="pdf",outcome="text"}` subir en
     `/metrics` desde la red interna;
   - `node cv-extract-probe.js` dentro del contenedor `worker` del host (`run --rm --no-deps`): `pdf chars=` igual al de
     antes y `boot_p95_ms` ≤ 1.500, anotado con fecha;
   - `docker compose exec worker sh -c 'ls node_modules | grep -c pdf-parse'` imprime `0`.
4. **Vuelta atrás**: revertir el PR y redesplegar la imagen anterior, con el procedimiento de 35b. Los CV leídos con el
   parser nuevo se quedan como están. Un CV en `pending` lo lee la imagen que lo tome.

## Costo estimado

34 tareas de menos de una hora (`tasks.md`), de las que se ejecutan entre 24 y 31:

- el grupo 2 (`unpdf`, 6 tareas) solo corre si `pdfjs-dist` no se adopta;
- el grupo 9 (salida sin sustitución, 3 tareas) solo corre si fallan las dos candidatas;
- la 5.1 solo corre si Q6 = sí.

El spike tiene un techo de 8 h (4 h por biblioteca). La sustitución y el cierre, unas 6-8 h. Fuera de ese cálculo
quedan dos tiempos del owner: unos 30 minutos para la 3.1 (sus CV) y el disparo de `cd-staging` en modo de prueba
(6.1).

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
  - (a) una consulta fechada de la base pública de avisos (GitHub Advisory Database y NVD, buscando «pdf.js» y
    `pdfjs-dist` con rango que incluya 1.10) en tres momentos fijos: la aprobación de este change (0.2), antes de la
    10.7 de 35b y al abrir 35c. Si aparece un aviso, el arquitecto lo evalúa contra los flags del hijo y el owner
    decide;
  - (b) un workflow programado que consulte la base y abra un issue: toca `.github/workflows` mientras la fila 35 está
    abierta;
  - (c) sin vigilancia: se acepta esperar a 35c.

  **Recomendación: (a)**, que no toca nada de la fila 35 y cuesta minutos.
- **Q10 [bloqueante para 0.2, para la sesión principal] — Texto de B2-03.** El `scope` trae «También B2-03 del debate
  de `cv-extract-isolation`». Pero el design de aquel change solo lo registra como «Trasladado a
  `cv-pdf-library-upgrade`; anotado en su `scope`. Trata de la biblioteca nueva», y su contenido no consta en el
  repositorio ni en el historial de la rama (commit `d96a4a0`). Opciones:
  - (a) la sesión principal lo recupera del registro del debate y se incorpora antes de convocar a `critic` y
    `business`;
  - (b) si no se recupera, `business` lo vuelve a plantear en la iteración 1 de este debate.

  **Recomendación: (a), y si no aparece, (b).**

## Estado del spike y de las mediciones

Se completa durante `/opsx:apply`, con fecha:

- la consulta de avisos de Q9;
- la línea base (0.4);
- por biblioteca: versión, hora de inicio y de fin de cada tarea, cómo se cargó (D5), cómo se resolvió el worker falso,
  si se cargó algún módulo opcional (R15), arranque local, delta de imagen antes y después de la poda, licencias,
  paridad sintética, tabla de productores (`doc-i`, productor, recall y orden, por cada valor de
  `disableNormalization`) y el corte o la adopción;
- la línea `parity …` del owner (3.1);
- la decisión de `disableNormalization`;
- `boot_p50_ms`/`boot_p95_ms` en `arm64` (6.1) y en el host (8.3).

Nada de esto lleva texto, nombres de archivo ni metadatos de ningún PDF.

## Casos de prueba por escenario

| Escenario (delta) | Test | Dónde | Tarea |
|---|---|---|---|
| Las líneas de un PDF se unen por su altura | «text items on the same y share a line» | `extractors/extractors.spec.ts` | 4.4 |
| PDF con texto, Un PDF de muchas páginas, Un PDF con texto sin fin (heredados) | los de `extractors.spec.ts` y `pathological.spec.ts`, sin cambios | `worker` y `worker-isolation` | 1.4 |
| La dependencia vieja no vuelve | «the root manifest does not list pdf-parse», «the lockfile does not resolve pdf-parse», «the pdf library is pinned to an exact version» | `no-pdf-parse.spec.ts` | 4.2 |
| El manifiesto del worker fija la biblioteca de PDF | «dist package.json pins the parser libraries» (con la adoptada) y «the worker lockfile has no native canvas» | `cv-extract-child.bundle.spec.ts` | 1.1, 1.3, 4.1 |
| La evaluación de código está desactivada al abrir el PDF | «eval is disabled when the pdf is opened» | `child/pdf-extract.spec.ts` (nuevo) | 4.4 |
| Falta el módulo de worker de pdf.js | «a missing pdf.js worker module is a boot error» | `isolated-extraction.runner.spec.ts` | 1.1 |
| Un PDF protegido con contraseña con la biblioteca nueva | «an encrypted PDF fails as password» | `extractors/extractors.spec.ts` | 1.4 |
| Los PDF sintéticos se leen igual que antes | «synthetic pdfs keep the recorded text» | `extractors/extractors.spec.ts` | 0.4, 1.4 |
| Un CV ya leído no se vuelve a leer | «an extracted cv is not re-read when the worker starts» (worker real con Mongo en memoria: un CV `extracted` sembrado, sin job en `extract-cv` tras el arranque y con el documento intacto) | `extract-cv.consumer` (integración) | 4.4 |
| La infraestructura importa un extractor de documentos (MODIFIED) | «an infrastructure folder of the worker imports a document extractor», movido a `isolation/child/` | `workspace-rules.spec.ts` | 4.3 |
| Otra parte del worker importa un extractor de documentos | «a worker infrastructure file outside the isolated child imports a document extractor» | `workspace-rules.spec.ts` | 4.3 |
| El dominio importa un extractor de documentos (MODIFIED) | «a domain folder of the worker imports a document extractor», con la adoptada | `workspace-rules.spec.ts` | 4.3 |
| (guardia de D7, sin escenario) | «parity refuses a directory inside the repository» | `child/pdf-parity.spec.ts`, temporal | 1.5 |
