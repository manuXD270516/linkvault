## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. «Verificar» es lo que demuestra que está hecha. «Falsación», en los guardias, es
el cambio a propósito que tiene que ponerla en rojo, y se deshace después. Los nombres de test están en inglés para que
el implementador los copie tal cual.

**Nada de la medición con PDF de productores ni con CV reales se commitea.** En el repositorio solo entran la fuente
inventada en texto plano y las líneas de agregados de design D7.

**Spike (grupos 1 y 2):** tope de **4 h por biblioteca**, sin contar la espera de los builds, que se anota aparte y tiene
su propio tope de 2 h por biblioteca (design D3). Cada tarea anota su hora de inicio y de fin en «Estado del spike y de
las mediciones», y los cortes son los de design D3. El grupo 2 solo se ejecuta si el 1 termina en corte 1 o 2, y el grupo
9 solo si terminan así los dos (o si Q11 = no). **Sin la 3.1 hecha, el grupo 4 no empieza.**

- [ ] 0.1 [infra] **Owner:** responde Q3, Q6 y Q9 (Q11 solo si se llega a la 2.6). El agente las pide en el PR y las
  anota con fecha: en `design.md` (Open Questions, una línea «Respuesta del owner (Qn), AAAA-MM-DD:» por pregunta) y en
  ADR-064 §Preguntas al owner. Si Q6 = (b), la 5.1 se marca «no aplica». Verificar: `grep -cE "Respuesta del owner
  \(Q(3|6|9)\), 20[0-9]{2}-" docs/adr/ADR-064.md` devuelve `3` (antes de anotarlas, `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. B2-03 de
  `cv-extract-isolation` (cómo recibe el owner el script, cuánto tarda y qué pasa si no lo corre a tiempo) queda
  cerrado por B1-01 (tareas del owner explícitas), B1-02 (ruta y orden concretas de PowerShell), B1-03 (puerta dura y
  pausa a los 14 días) y B1-04 (tiempo medido en la 1.5b) de la iteración 1, con los ajustes de la iteración 2 (C2-07,
  BV1-03, BV2-01, BV2-04). Su opción «si se parte, pasa a B» no aplica: sin la medición del owner no se adopta ninguna
  candidata (design D3), así que no hay un change B al que pasarla. Verificar: `design.md` lleva la sección del debate
  de la última iteración, con «Convergencia: SI» y la fecha de la aprobación.
- [ ] 0.3 [infra] Precondiciones de entrada (design D1, D9, D13, R19):
  - `openspec/changes/archive/*-verify-reusable-workflow/` y `openspec/changes/archive/*-cv-extract-isolation/` existen;
  - ADR-058 dice «Aceptado»;
  - el `boot_p95_ms` de `arm64` de la 7.4 de `cv-extract-isolation` está en su «Estado de las mediciones» (C2-14). Si
    no está, se anota aquí y la 6.1 corre también la base sobre `main`;
  - **lista mecánica de escenarios** (C1-16): para «Texto extraído, normalizado y acotado» y para «Aislamiento de la
    capa de dominio», los títulos `#### Scenario:` de `openspec/specs/…/spec.md` archivados y los del MODIFIED de este
    change, comparados con `diff`. El único añadido admitido es «Las líneas de un PDF se unen por su altura»; no se
    admite ninguno quitado. Después se compara el cuerpo de cada requirement: solo cambian las líneas que este change
    pretende cambiar;
  - qué hace `pnpm exec openspec validate <change> --strict --no-interactive` con un change de prueba sin deltas, en el
    scratchpad (lo acepta, avisa o falla), anotado para la 9.2;
  - la consulta de avisos de Q9, hecha y fechada en «Estado del spike y de las mediciones».

  Verificar: las dos listas de escenarios y su `diff` pegados en la tarea, y `pnpm exec openspec validate
  cv-pdf-library-upgrade --strict --no-interactive` verde.
- [ ] 0.4 [backend] Línea base con `pdf-parse`, antes de instalar nada:
  - `apps/worker/src/modules/cv/infrastructure/extractors/fixtures/expected-texts.ts` con el texto normalizado
    (`prepareCvText`) que guarda hoy el hijo para `pdfWithText()`, `pdfWithoutText()` y `pdfWithPageMarks(60)`
    (`minimalPdf()` no entra: vive en `web-e2e`, C2-04). Solo texto inventado, y cada constante con un comentario que
    diga de qué generador sale;
  - test «synthetic pdfs keep the recorded text» en `extractors.spec.ts`, por el hijo aislado real.

  Verificar: el test pasa con `pdf-parse`. Falsación: cambiar un carácter de una constante y comprobar que falla.
- [ ] 0.5a [backend] Fuente inventada y corpus de productores por contenedores (design D3, C2-01, C2-02, C2-11):
  - `tools/cv-fixtures/parity-source/persona-inventada.tex`, `persona-inventada.fodt` y
    `persona-inventada-dos-columnas.fodt`, con nombre, empresa y trayectoria inventados y sin metadatos de autor (ni
    `\author` real ni `meta:initial-creator`), commiteados en texto plano;
  - con contenedores públicos (TeX Live para `pdflatex` y LibreOffice para `soffice`), la fuente montada **en solo
    lectura** y la salida a una carpeta fuera del repositorio: `pdflatex -output-directory` genera `latex.pdf` y
    `soffice --headless --convert-to pdf --outdir` genera `libreoffice.pdf` y `dos-columnas.pdf`;
  - en la misma carpeta, `soffice --headless --convert-to docx --outdir` genera `persona-inventada.docx` para la 0.5b.
    **Ningún `.docx` entra al repo**.

  Verificar: los tres PDF y el `.docx` existen fuera del repo; las imágenes usadas (tag o digest) están en «Estado del
  spike y de las mediciones»; `grep -iE "author|creator" tools/cv-fixtures/parity-source/*` no devuelve ningún nombre
  real; y `git status --porcelain` solo muestra los tres ficheros de la fuente.
- [ ] 0.5b [infra] **Owner:** antes del grupo 1, cuando quiera (unos 15 minutos), abre `persona-inventada.docx` en Word
  y lo exporta a `word.pdf`, y lo sube a Google Docs y lo exporta a `google-docs.pdf`. Los dos quedan en la misma
  carpeta local de la 0.5a, la que lee la 1.5b. El agente le deja en el PR la ruta del `.docx` y de la carpeta, y
  verifica después que estén los cinco PDF. Verificar: el owner lo confirma en el PR y la carpeta tiene los cinco
  ficheros de la lista cerrada de D7. Ningún PDF entra en el repositorio.

## 1. Spike: `pdfjs-dist` (design D2-D8; tope 4 h)

- [ ] 1.1a [backend] Carga (design D5, C1-02). **Primer paso, antes de escribir código:** `pnpm add --save-exact
  pdfjs-dist@<última estable con ≥ 7 días>` y, desde la raíz del workspace con Node 22.23, `node -e
  "require('pdfjs-dist/legacy/build/pdf.mjs'); require('pdfjs-dist/legacy/build/pdf.worker.mjs')"`. Si falla, es
  **corte 1** (pasa a la 1.6). Si sale 0, `PdfJsTextSource` en `child/pdf-extract.ts` con la carga de los dos módulos
  en el nivel superior, antes de `ready`, como `defaultPdfTextSource` (`PdfParseTextSource` se queda, para la paridad).
  Verificar: salida del `node -e`, `pnpm nx build worker`, `node dist/apps/worker/cv-extract-probe.js` sale 0 y
  `cv-extract-child.bundle.spec.ts` verde, con `pdfjs-dist` en la lista de versiones exactas.
- [ ] 1.1b [backend] Test «a missing pdf.js worker module is a boot error» en el spec del runner (design D4, C1-11): el
  hijo compilado vive **dentro** de un árbol falso de `node_modules` en `os.tmpdir()`, sin el módulo del worker, con
  `allowRead=<tmp>`. El desenlace es `CvExtractionMachineryError` con código `ERR_MODULE_NOT_FOUND` o
  `MODULE_NOT_FOUND`, nunca `ERR_ACCESS_DENIED` ni `unreadable`. Verificar: verde. Falsación: mover la carga del módulo
  del worker detrás de `ready` y comprobar que el test da `unreadable`.
- [ ] 1.1c [backend] Opciones y datos de pdf.js (design D4, C1-03, C1-04, C1-15, C2-12):
  - `pdfDocumentOptions(bytes, paths)` pura, con el test «pdf document options are exactly the audited ones»
    (`toEqual` contra el objeto de D4);
  - rutas de `cmaps/` y `standard_fonts/` por `createRequire(__filename).resolve('pdfjs-dist/package.json')`;
  - `statSync` de `cmaps/Identity-H.bcmap` y de `standard_fonts/LiberationSans-Regular.ttf` antes de `ready`
    (`boot_error` si falla), con los dos nombres confirmados contra el paquete;
  - tests «pdf.js data paths resolve under the allowed node_modules root» y «missing pdf.js cmaps is a boot error», este
    con el árbol falso en el orden de D4 y `ENOENT`.

  Anotar si se intentó cargar algún módulo opcional (R15) y el `boot_p95_ms` local. Verificar: verdes. Falsación:
  añadir `useSystemFonts: true` y comprobar que el primero falla; quitar el `statSync` y comprobar que «missing pdf.js
  cmaps is a boot error» falla.
- [ ] 1.2a [infra] Dentro de la imagen y con la lista de lecturas de producción sin cambios (D6): `docker build -f
  docker/worker.Dockerfile` en local y `docker compose run --rm --no-deps worker node cv-extract-probe.js` sale 0.
  Verificar: salidas volcadas a fichero, `productionReadList()` sigue con dos rutas y la espera del build anotada aparte.
- [ ] 1.2b [backend] Fixture con CMap predefinido: si se puede generar en la tarea, `pdfWithPredefinedCMap()` en
  `cv-fixtures.ts` (texto inventado con un CMap predefinido, sin fuente embebida), leído por un test del hijo. Si no se
  puede, se anota y la comprobación queda en un PDF de productor que lo necesite. Verificar: el test lee el texto
  esperado, o queda la anotación.
- [ ] 1.3a [infra] Canvas fuera (design D4, D8, C1-05): `@napi-rs/canvas` excluido en `pnpm-workspace.yaml`
  (`ignoredOptionalDependencies`, confirmado con pnpm 12.4.2), y test «the child command never allows addons» sobre
  `buildChildCommand`. Si la exclusión choca con `pnpm install --frozen-lockfile` de la imagen, se para aquí y sigue
  la 1.3a'. Verificar: `dist/apps/worker/pnpm-lock.yaml` sin `@napi-rs/canvas`, y `docker compose run --rm --no-deps
  worker sh -c 'ls node_modules/.pnpm | grep -c napi-rs+canvas'` imprime `0`. Falsación: sin la exclusión, el candado de
  `dist/` contiene `@napi-rs/canvas`; añadir `--allow-addons` en `buildChildCommand` y comprobar que el test falla.
- [ ] 1.3a' [infra] **Solo si la 1.3a chocó con el candado congelado** (C2-10): la alternativa de D4, en su orden
  (regenerar el candado de `dist/` con la exclusión aplicada y, si no alcanza, borrar el paquete en la etapa `build`
  después de instalar). Verificar y falsar como en la 1.3a.
- [ ] 1.3b [infra] Costo (design D8, C1-18):
  - tamaño de la imagen antes y después con `docker image inspect --format '{{.Size}}'`, en la misma máquina y el mismo
    almacén de Docker, anotados; sin podar y, si hace falta para Q3, podado en la etapa `build`;
  - licencias del árbol nuevo con `pnpm licenses list --prod --json`, contra la lista blanca de D8.

  Verificar: delta (sin `pdf-parse`, restado aparte) y licencias en «Estado del spike y de las mediciones»; delta ≤
  umbral de Q3; ninguna licencia fuera de la lista blanca.
- [ ] 1.4 [backend] Paridad sintética y suites heredadas:
  - «synthetic pdfs keep the recorded text» (0.4) con `pdfjs-dist`. Si un sintético difiere, se anota su diff línea a
    línea y es **corte 3**: vuelve al debate, sin pasar a `unpdf` (C1-14);
  - las suites `worker` y `worker-isolation` enteras (`extractors.spec.ts`, `pathological.spec.ts` y el spec del
    runner), incluidos «an encrypted PDF fails as password» (si cae, se ajusta el fixture según R14) y «reads a small
    PDF that arrives in a pooled buffer».

  Verificar: `pnpm nx run worker:test` verde, con la salida volcada a fichero. Anotar cualquier test que cambió de
  desenlace y por qué.
- [ ] 1.5a [backend] Instrumento de paridad (design D7, C1-06, C1-07, C2-03, C2-13):
  - `child/pdf-parity.spec.ts` (proyecto `worker-isolation`) con las definiciones de D7, `describe.runIf`
    (`CV_PARITY_DIR`), `console` silenciado, `verbosity: 0`, las dos normalizaciones en una corrida, `failed_reads` y
    `failed_reads_ref`, `run=<uuid>`, y `CV_PARITY_PER_DOC` con la lista cerrada de los cinco productores (`doc=#<i>`
    para cualquier otro fichero);
  - `runParity(dir, reference, candidate, out)`, con las dos `PdfTextSource` por parámetro;
  - `assertOutsideAnyRepository(dir)` pura, llamada antes de cualquier `readdir`, con su test «parity refuses a
    directory inside any repository» **fuera** del `runIf`;
  - test «a failing parity read leaves no text in the output»: dobles con textos inventados distintos (uno lanza un error
    con texto en el mensaje); captura `stdout`, `stderr` y los errores; ninguna palabra aparece;
  - test «an unknown file in the producer folder is labelled by index» (C2-13);
  - el filtro exacto de Vitest para las órdenes de PowerShell de D7, comprobado y escrito en el design.

  Verificar: los tests de guardia verdes en una corrida normal (sin `CV_PARITY_DIR`). Falsación: quitar la búsqueda de
  `.git` y comprobar que el caso del árbol con `.git` deja de fallar; imprimir el texto de la referencia en
  `runParity` y comprobar que «a failing parity read leaves no text in the output» falla.
- [ ] 1.5b [backend] Productores y ensayo del bloque del owner (BV1-03, BV2-04):
  - la orden de productores de D7 (con `CV_PARITY_PER_DOC='1'`) sobre la carpeta con los **cinco** PDF de la 0.5a y la
    0.5b;
  - el bloque de tres pasos de D7 (rama y commit, `pnpm install --frozen-lockfile`, orden), ensayado desde un worktree
    limpio, con su tiempo total.

  Verificar: tabla `doc=`/recall/orden de los cinco productores, por valor de `disableNormalization`, y tiempo total
  del bloque en «Estado del spike y de las mediciones» (sustituye la estimación de la 3.1); `git status --porcelain` sin
  ficheros nuevos fuera de `apps/` y del change.
- [ ] 1.6 [backend] Corte o adopción provisional de `pdfjs-dist` (D3): tabla (a)-(d) con medición, horas acumuladas de
  1.1a-1.5b, esperas de build aparte, y decisión: «cumple, pasa a la 3.1», «corte 1/2, pasa al grupo 2» o «corte 3,
  vuelve al debate». Si cumple, anota en el PR y en la fila del manifiesto la **fecha límite de la 3.1** (14 días,
  BV2-01) y deja en el PR el bloque de tres pasos para el owner, con el commit y el filtro ya puestos. Verificar: la tabla
  está en «Estado del spike y de las mediciones» con fecha, las horas acumuladas son ≤ 4 h (y las esperas ≤ 2 h) o la
  decisión es un corte, y la fecha límite está en el PR y en el manifiesto.

## 2. Spike: `unpdf` (solo si el grupo 1 termina en corte 1 o 2; tope 4 h)

- [ ] 2.1 [backend] Igual que la 1.1a-1.1c con `unpdf`: el `node -e` de `require(esm)` sobre sus módulos primero,
  opciones equivalentes a D4 y los tests de árbol falso adaptados. Si `unpdf` no trae `cmaps/` ni `standard_fonts/`,
  los datos salen de `pdfjs-dist` a la misma versión de pdf.js; si esa versión no está publicada, corte 1 (D4). Se
  desinstala `pdfjs-dist` salvo para eso o si `unpdf` lo necesita como par. Verificar y falsar como en la 1.1a-1.1c.
- [ ] 2.2 [infra] Igual que la 1.2a-1.2b con `unpdf`. Verificar como en la 1.2a-1.2b.
- [ ] 2.3 [infra] Igual que la 1.3a-1.3b (y la 1.3a' si hace falta) con `unpdf`. Verificar y falsar como en la 1.3a-1.3b.
- [ ] 2.4 [backend] Igual que la 1.4 con `unpdf`. Verificar como en la 1.4.
- [ ] 2.5 [backend] Igual que la 1.5b con `unpdf`, reutilizando el instrumento de la 1.5a. Verificar como en la 1.5b.
- [ ] 2.6 [backend] Corte o adopción provisional de `unpdf`, como en la 1.6. Si cumple (a)-(d), **el agente pide al
  owner la respuesta a Q11** y la anota con fecha: con (a), adopción provisional y fecha límite de la 3.1; con (b), pasa
  al grupo 9. Si es corte 1 o 2, pasa al grupo 9. Verificar como en la 1.6, más la respuesta a Q11 anotada.

## 3. Medición del owner y cierre del spike (design D3, D7)

- [ ] 3.1 [infra] **Owner:** en su máquina, con la candidata adoptada provisionalmente, y en el tiempo que midió la
  1.5b. **Solo CV cuyo origen controla el owner: los suyos o los que generó él. Nunca se descargan del almacén de
  staging ni del de producción.** Con menos de 5 CV, se mide con los que haya y la línea dice `docs=<n>`. **Correla en
  una terminal de PowerShell propia, no desde una sesión de Claude ni de otro agente.** Sigue el bloque de tres pasos que
  le dejó el PR (1.6) y corre la orden de CV de D7, sin `CV_PARITY_PER_DOC`:
  ```powershell
  $env:CV_PARITY_DIR='C:\ruta\fuera\del\repo\cv'; pnpm nx run worker:test --skip-nx-cache -- <filtro de la 1.5a>; Remove-Item Env:CV_PARITY_DIR
  ```
  Pega en el PR solo las dos líneas `parity …` (mismo `run=`) y la fecha. **Si falla, pegá solo las líneas `parity …` y
  el error, sin abrir ningún CV con un agente.** Al terminar, borra las copias temporales que haya hecho para la
  medición. El agente le pide el dato en el PR y verifica que lo pegado sean solo esas líneas. Verificar: en el PR
  constan solo las líneas `parity …`, la fecha y, si hubo, el error. No consta ningún nombre, texto, número de páginas
  por archivo ni captura. **Puerta:** sin esta tarea, el grupo 4 no empieza. Si llega la fecha límite de la 1.6 (o la
  2.6) sin ella, el agente anota «en pausa por la 3.1» con la fecha. La pausa termina con esta tarea o con la decisión
  (c) de D13.
- [ ] 3.1b [backend] Lectura de la 3.1: copiar las líneas `parity …` a «Estado del spike y de las mediciones» y
  decidir con el criterio de D7. Si los CV no cumplen, **vuelve al debate** (D3: no se pasa a la otra candidata). Si se
  adopta la otra candidata más adelante, la 3.1 se repite con ella (PO-08). Verificar: las líneas copiadas, con su
  decisión y fecha.
- [ ] 3.2 [backend] Cierre del spike: biblioteca, versión (y, con `unpdf`, la `version` de su pdf.js leída en tiempo de
  ejecución), resultado de `require(esm)`, lista de lecturas (sin cambios o el motivo del MODIFIED), arranque local,
  delta (con máquina y almacén), licencias, paridad (sintética, productores y owner) y decisión de
  `disableNormalization` según D7, con fecha. Si se necesita una ruta de lectura fuera de `node_modules` (D6), se para
  aquí y vuelve al debate. Verificar: «Estado del spike y de las mediciones» completo hasta este punto, y ADR-064
  §Elección con la biblioteca y la versión.

## 4. Sustitución (design D4, D10; solo con la 3.1b en «cumple»)

- [ ] 4.1 [backend] Limpieza de `pdf-parse` en el worker:
  - se borran `PdfParseTextSource` y `child/pdf-parity.spec.ts`;
  - `pnpm remove pdf-parse @types/pdf-parse`;
  - se borra `extractors/pdf-parse-lib.d.ts`, y se quita de `apps/worker/tsconfig.cv-child-test.json` si lo nombra;
  - `resolveNodeModulesRoot` busca la biblioteca adoptada, y su comentario y el de `developmentReadList` se actualizan;
  - `cv-extract-child.bundle.spec.ts` fija `mammoth` y la adoptada;
  - el comentario de `withOwnBuffer` dice por qué se conserva (D4);
  - `disableNormalization` queda fijada con el valor de la 3.2.

  Verificar: `pnpm nx run worker:typecheck` y `pnpm nx run worker:test` verdes, y
  `grep -rn "pdf-parse" apps/worker/src apps/worker/tsconfig*.json infra package.json` sin resultados fuera de
  comentarios históricos marcados como tales.
- [ ] 4.2 [backend] `no-pdf-parse.spec.ts` (worker), con tres tests: «the root manifest does not list pdf-parse»,
  «the lockfile does not resolve pdf-parse» y «the pdf library is pinned to an exact version». Es el escenario «La
  dependencia vieja no vuelve». Si se adoptó `unpdf` (Q11 = (a)), además «the bundled pdf.js is at least the audited
  version», que lee la `version` en tiempo de ejecución (R21). Verificar: verde. Falsación: volver a poner la versión de
  la biblioteca con `^` y comprobar que el tercero falla; añadir `"pdf-parse": "1.1.4"` a `dependencies` sin instalar y
  comprobar que el primero falla.
- [ ] 4.3 [backend] Lint (D10, C1-16, C2-15): `DOMAIN_RESTRICTED_PATTERNS` y el bloque del hijo de `eslint.config.mjs`
  pasan a `pdfjs-dist|unpdf|pdf-parse|mammoth`, con los comentarios y el mensaje actualizados. En
  `tools/workspace-rules/src/workspace-rules.spec.ts`, los tres casos de extractores que deja `cv-extract-isolation`
  (dominio, dentro del hijo y fuera del hijo) importan **`pdfjs-dist`**, sea cual sea la adoptada. Verificar:
  `pnpm nx run workspace-rules:test` y `pnpm nx run worker:lint` verdes. Falsación: un import temporal de la biblioteca
  adoptada en `apps/worker/src/modules/cv/infrastructure/isolation/isolated-cv-text-extractor.ts` hace fallar
  `worker:lint`.
- [ ] 4.4 [backend] Tests de la biblioteca en el hijo (requirement «La biblioteca de PDF es un pdf.js mantenido…»):
  «pdf document options are exactly the audited ones» (de la 1.1c, con la versión final), «text items on the same y
  share a line» (escenario «Las líneas de un PDF se unen por su altura», con un PDF generado en el test) y «extracts the
  fixture PDF with the expected text» contra `expected-texts.ts`. Verificar: verdes. Falsación: pasar
  `isEvalSupported: true` en `pdfDocumentOptions` y comprobar que el primero falla.
- [ ] 4.5a [infra] Imagen final (C2-10): `docker/worker.Dockerfile` con la poda de la 1.3b o la 2.3, solo si hizo
  falta, y comentario con el porqué (Q3). Imagen construida en local y `docker compose run --rm --no-deps worker node
  cv-extract-probe.js` sale 0. Delta final contra la imagen de `main` (misma máquina y almacén) en «Estado del spike y de
  las mediciones». Verificar: salidas volcadas a fichero y delta ≤ umbral de Q3.
- [ ] 4.5b [infra] Falsaciones de imagen (C1-10, C1-03; escenario «Faltan los mapas de caracteres de pdf.js»):
  construir una imagen de prueba que borra `cmaps/` del paquete y comprobar que la sonda sale con 1; si hay poda,
  ampliarla al build `legacy` y comprobar que la sonda sale distinto de 0. Las imágenes de prueba se borran al terminar.
  Verificar: las dos salidas volcadas a fichero.

## 5. Renovate (design D11; solo si Q6 = (a); tope 1 h)

- [ ] 5.1 [infra] `renovate.json`: `packageRule` con `matchPackageNames` igual a la adoptada, `mammoth`,
  `@xmldom/xmldom` y `jszip`, con `vulnerabilityAlerts` y `dependencyDashboardApproval: false`. Se confirma en la
  documentación de Renovate la precedencia frente al `dependencyDashboardApproval: true` global (R20). **Tope de 1 h**
  (B2-02): si no queda confirmada, la regla no entra y Q6 vuelve al owner con el dato. Test «renovate lets security
  alerts for the document parsers skip the dashboard» en `no-pdf-parse.spec.ts`, que lee `renovate.json`. Verificar:
  verde, y `node -e "JSON.parse(require('fs').readFileSync('renovate.json','utf8'))"` sale 0. Falsación: quitar `jszip`
  de la regla y comprobar que el test falla.

## 6. Arranque en `arm64` (design D9)

- [ ] 6.1 [infra] **Owner:** dispara (unos 5 minutos) `gh workflow run cd-staging.yml --ref
  change/cv-pdf-library-upgrade -f dry_run=true`, o el disparo en modo de prueba que deje 35c. Construye y verifica en
  `ubuntu-24.04-arm` sin publicar. Si la 0.3 anotó que falta la línea base, dispara también la misma corrida con
  `--ref main` (C2-14). El agente se lo pide en el PR. Verificar: el owner pega en el PR el identificador de cada
  corrida.
- [ ] 6.1b [infra] Lectura de las corridas de la 6.1: el log volcado a fichero; se anotan `pdf chars=`, `docx chars=`,
  `boot_p50_ms`, `boot_p95_ms` y el delta contra la línea base (la 7.4 de `cv-extract-isolation` o la corrida sobre
  `main`). Verificar: `boot_p95_ms` ≤ 1.500 y ningún tag publicado por esas corridas. Si no se cumple, el change no pasa
  a la 8.2 y vuelve al debate.

## 7. Documentación

- [ ] 7.1 [backend] Comentarios y documentación:
  - `README.md` (§ de la extracción: la biblioteca adoptada lee dentro del hijo aislado);
  - `docs/RUNBOOK.md`, «Operar los CV»: la biblioteca, su versión exacta, por qué se cargan los dos módulos y se
    comprueban sus datos antes de `ready`, qué significa un `machinery_error` con `boot_error` tras actualizarla, y
    **una línea sobre cómo repetir la paridad** con la fuente de `tools/cv-fixtures/parity-source/`, los contenedores
    de la 0.5a y la orden de `CV_PARITY_DIR`, sin datos en el repositorio (B2-01);
  - `tools/cv-fixtures/README.md`, que nombra `pdf-parse`;
  - comentarios que nombran `pdf-parse` en `cv-fixtures.ts`, `apps/web-e2e/src/support/cv-files.ts`,
    `apps/web-e2e/src/cv.spec.ts`, `apps/web-e2e/src/match.spec.ts`, `cv-text-extractors.port.ts` e
    `infra/ci/verify-artifact.sh` (la sección de la sonda).

  Verificar: `grep -rn "pdf-parse" README.md docs/RUNBOOK.md apps libs tools infra` solo devuelve menciones históricas
  marcadas como tales, y `bash infra/ci/repo-checks.sh` verde.
- [ ] 7.2 [backend] ADR-064 §Elección y §Consecuencias con la biblioteca, la versión y las mediciones (y R21 con la
  respuesta a Q11 si es `unpdf`). Las anotaciones de una línea de ADR-058 (Decisión 7) y de ADR-028 (§Consecuencias,
  «Dependencias») nombran la biblioteca adoptada. Verificar: `grep -n "ADR-064" docs/adr/ADR-058.md docs/adr/ADR-028.md`
  devuelve una línea en cada uno.

## 8. Cierre

- [ ] 8.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` verde, y el lote 1 de `e2e-suite` en local
  (`e2e-stack`) con el paso del CV en «Listo · tu CV se leyó bien». **Revisión del diff del change** (D12, C1-17):
  `git diff origin/main --stat` y una lectura de los ficheros de `apps/worker/src/modules/cv/` y de `infra/`, sin
  migraciones, sin re-encolados de `extract-cv` y sin cambios en el consumidor. Verificar: salidas volcadas a fichero y
  revisadas, con la conclusión de la revisión del diff escrita en el PR.
- [ ] 8.2 [infra] Fusión del PR del change (design D14): a mano, con CI verde, en una ventana autorizada por el owner y
  sin `--auto`. Precondición: 6.1b dentro de criterio. Verificar: hash del merge anotado en el PR.
- [ ] 8.3 [infra] Comprobación tras desplegar (Migration Plan §3) sobre el commit desplegado: un PDF de la cuenta e2e
  sube `linkvault_cv_extractions_total{format="pdf",outcome="text"}`, y la sonda en el contenedor `worker` del host da
  `boot_p95_ms` ≤ 1.500. Verificar: valores anotados con fecha en «Estado del spike y de las mediciones».
- [ ] 8.4 [infra] PR de archivo: ADR-064 pasa a **Aceptado**, con el número del PR del change y el hash de su merge;
  «Estado del spike y de las mediciones» completo; `/opsx:archive` aplica los deltas a
  `openspec/specs/cv/extraction/spec.md` y `openspec/specs/platform/workspace/spec.md`. Verificar:
  `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` verdes en el PR.

## 9. Salida sin sustitución (design D13; solo si los grupos 1 y 2 terminan en corte 1 o 2, o Q11 = no)

- [ ] 9.1 [backend] La rama queda como dice la tabla de D13, pieza por pieza (C2-05). Verificar: `git diff origin/main
  -- apps libs package.json pnpm-lock.yaml pnpm-workspace.yaml eslint.config.mjs renovate.json docker tools` solo
  muestra ficheros de esta **lista admitida**: `expected-texts.ts` y el test «synthetic pdfs keep the recorded text» en
  `extractors.spec.ts`; «the child command never allows addons» en `child-command.spec.ts`;
  `tools/cv-fixtures/parity-source/*`; y `pdfWithPredefinedCMap()` en `cv-fixtures.ts`, solo si la 1.2b lo creó y
  `pdf-parse` lo lee. Además, `pnpm nx run worker:test` está verde.
- [ ] 9.2 [infra] Design, ADR y manifiesto, según la tabla de D13: resultado de los dos spikes (o la respuesta a Q11) y
  la pregunta nueva al owner en el design; ADR-064 a **Rechazado**; deltas de `specs/` retirados o reducidos al mínimo
  según lo que vio la 0.3; una línea en la fila del manifiesto. Verificar: `pnpm exec openspec validate
  cv-pdf-library-upgrade --strict --no-interactive` con el resultado que anticipó la 0.3, y `bash
  infra/ci/repo-checks.sh` verde.
- [ ] 9.3 [infra] PR con la regresión de la 9.1 y los documentos, fusionado en una ventana autorizada, y
  `openspec archive cv-pdf-library-upgrade --skip-specs` en su PR de archivo. Verificar: el directorio está en
  `openspec/changes/archive/` y las specs vigentes no cambiaron (`git diff` de `openspec/specs/` vacío).
