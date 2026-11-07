## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. «Verificar» es lo que demuestra que está hecha. «Falsación», en los guardias, es
el cambio a propósito que tiene que ponerla en rojo, y se deshace después. Los nombres de test están en inglés para que
el implementador los copie tal cual.

La etiqueta `[owner]` marca las tareas que hace el owner en persona (B1-01 de la iteración 1): llevan su tiempo
estimado y no las ejecuta ningún agente.

**Nada de la medición con PDF de productores ni con CV reales se commitea.** En el repositorio solo entran la fuente
inventada en texto plano y las líneas de agregados de design D7.

**Spike (grupos 1 y 2):** tope de **4 h por biblioteca**, sin contar la espera de los builds, que se anota aparte
(design D3). Cada tarea anota su hora de inicio y de fin en «Estado del spike y de las mediciones», y los cortes son
los de design D3. El grupo 2 solo se ejecuta si el 1 termina en corte 1 o 2, y el grupo 9 solo si terminan así los dos.
**Sin la 3.1 hecha, el grupo 4 no empieza.**

- [ ] 0.1 [infra] Q3, Q6 y Q9 respondidas por el owner y anotadas con fecha: en `design.md` (Open Questions, una línea
  «Respuesta del owner (Qn), AAAA-MM-DD:» por pregunta) y en ADR-064 §Preguntas al owner. Si Q6 = (b), la 5.1 se marca
  «no aplica». Verificar: `grep -cE "Respuesta del owner \(Q(3|6|9)\), 20[0-9]{2}-" docs/adr/ADR-064.md` devuelve `3`
  (antes de anotarlas, `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. B2-03 de
  `cv-extract-isolation` (cómo recibe el owner el script, cuánto tarda y qué pasa si no lo corre a tiempo) queda
  cerrado por B1-01 (etiqueta `[owner]`), B1-02 (ruta y orden concretas de PowerShell), B1-03 (puerta dura y pausa a
  los 14 días) y B1-04 (tiempo medido en la 1.5b) de la iteración 1. Su opción «si se parte, pasa a B» no aplica: sin
  la medición del owner no se adopta ninguna candidata (design D3), así que no hay un change B al que pasarla.
  Verificar: `design.md` lleva la sección del debate de la última iteración, con «Convergencia: SI» y la fecha de la
  aprobación.
- [ ] 0.3 [infra] Precondiciones de entrada (design D1, D13, R19):
  - `openspec/changes/archive/*-verify-reusable-workflow/` y `openspec/changes/archive/*-cv-extract-isolation/` existen;
  - ADR-058 dice «Aceptado»;
  - **lista mecánica de escenarios** (C1-16): para «Texto extraído, normalizado y acotado» y para «Aislamiento de la
    capa de dominio», los títulos `#### Scenario:` de `openspec/specs/…/spec.md` archivados y los del MODIFIED de este
    change, comparados con `diff`. Los únicos añadidos admitidos son «Las líneas de un PDF se unen por su altura»; no se
    admite ninguno quitado. Después se compara el cuerpo de cada requirement: solo cambian las líneas que este change
    pretende cambiar;
  - qué hace `pnpm exec openspec validate <change> --strict --no-interactive` con un change de prueba sin deltas, en el
    scratchpad (lo acepta, avisa o falla), anotado para la 9.2;
  - la consulta de avisos de Q9, hecha y fechada en «Estado del spike y de las mediciones».

  Verificar: las dos listas de escenarios y su `diff` pegados en la tarea, y `pnpm exec openspec validate
  cv-pdf-library-upgrade --strict --no-interactive` verde.
- [ ] 0.4 [backend] Línea base con `pdf-parse`, antes de instalar nada:
  - `apps/worker/src/modules/cv/infrastructure/extractors/fixtures/expected-texts.ts` con el texto normalizado
    (`prepareCvText`) que guarda hoy el hijo para `pdfWithText()`, `pdfWithoutText()`, `pdfWithPageMarks(60)` y
    `minimalPdf(FIXTURE_CV_LINES)`. Solo texto inventado, y cada constante con un comentario que diga de qué generador
    sale;
  - test «synthetic pdfs keep the recorded text» en `extractors.spec.ts`, por el hijo aislado real;
  - copiar a «Estado del spike y de las mediciones» el `boot_p95_ms` de `arm64` de `cv-extract-isolation` (su 7.4).

  Verificar: el test pasa con `pdf-parse`. Falsación: cambiar un carácter de una constante y comprobar que falla.
- [ ] 0.5a [backend] Fuente inventada y corpus de productores por CLI (design D3, C1-01):
  - `tools/cv-fixtures/parity-source/persona-inventada.tex` y `persona-inventada.fodt` (y su variante a dos columnas),
    con nombre, empresa y trayectoria inventados, sin metadatos de autor (ni `\author` real ni `meta:initial-creator`),
    commiteados en texto plano;
  - fuera del repositorio, `pdflatex` y `soffice --headless --convert-to pdf` generan `latex.pdf`, `libreoffice.pdf` y
    `dos-columnas.pdf`.

  Si en la máquina no están `pdflatex` o `soffice`, se anota y esos PDF pasan a la 0.5b. Verificar: los tres PDF
  existen fuera del repo, y `grep -iE "author|creator" tools/cv-fixtures/parity-source/*` no devuelve ningún nombre
  real.
- [ ] 0.5b [owner] **La hace el owner, en la misma sesión que la 3.1** (unos 15 minutos): abre la fuente inventada en
  Word y en Google Docs, la exporta a PDF (`word.pdf`, `google-docs.pdf`) y deja los dos ficheros en la carpeta de
  productores, fuera del repositorio, junto con los de la 0.5a si esa tarea no pudo generarlos. Verificar: el owner
  confirma en el PR que los PDF están en la carpeta. Ningún PDF entra en el repositorio.

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
  `allowRead=<tmp>`; el desenlace es `CvExtractionMachineryError` con código `ERR_MODULE_NOT_FOUND` o
  `MODULE_NOT_FOUND`, nunca `ERR_ACCESS_DENIED` ni `unreadable`. Verificar: verde. Falsación: mover la carga del módulo
  del worker detrás de `ready` y comprobar que el test da `unreadable`.
- [ ] 1.1c [backend] Opciones y datos de pdf.js (design D4, C1-03, C1-04, C1-15):
  - `pdfDocumentOptions(bytes, paths)` pura, con test «pdf document options are exactly the audited ones» (`toEqual`
    contra el objeto de D4);
  - rutas de `cmaps/` y `standard_fonts/` por `createRequire(__filename).resolve('pdfjs-dist/package.json')`;
  - `statSync` de un fichero de cada directorio antes de `ready` (`boot_error` si falla);
  - test «pdf.js data paths resolve under the allowed node_modules root».

  Anotar si se intentó cargar algún módulo opcional (R15) y el `boot_p95_ms` local. Verificar: verdes. Falsación:
  añadir `useSystemFonts: true` y comprobar que el primero falla.
- [ ] 1.2a [infra] Dentro de la imagen y con la lista de lecturas de producción sin cambios (D6): `docker build -f
  docker/worker.Dockerfile` en local y `docker compose run --rm --no-deps worker node cv-extract-probe.js` sale 0.
  Verificar: salidas volcadas a fichero, `productionReadList()` sigue con dos rutas y la espera del build anotada
  aparte.
- [ ] 1.2b [backend] Fixture con CMap predefinido: si se puede generar en la tarea, `pdfWithPredefinedCMap()` en
  `cv-fixtures.ts` (texto inventado con un CMap predefinido, sin fuente embebida), leído por un test del hijo. Si no se
  puede, se anota y la comprobación queda en un PDF de productor que lo necesite. Verificar: el test lee el texto
  esperado, o queda la anotación.
- [ ] 1.3a [infra] Canvas fuera (design D4, D8, C1-05):
  - `@napi-rs/canvas` excluido en `pnpm-workspace.yaml` (`ignoredOptionalDependencies`, confirmado con pnpm 12.4.2);
  - si choca con `pnpm install --frozen-lockfile` de la imagen, la alternativa de D4, en su orden;
  - test «the child command never allows addons» sobre `buildChildCommand`.

  Verificar: `dist/apps/worker/pnpm-lock.yaml` sin `@napi-rs/canvas`, y `docker compose run --rm --no-deps worker sh -c
  'ls node_modules/.pnpm | grep -c napi-rs+canvas'` imprime `0`. Falsación: sin la exclusión, el candado de `dist/`
  contiene `@napi-rs/canvas`; añadir `--allow-addons` en `buildChildCommand` y comprobar que el test falla.
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
- [ ] 1.5a [backend] Instrumento de paridad (design D7, C1-06, C1-07):
  - `child/pdf-parity.spec.ts` (proyecto `worker-isolation`) con las definiciones de D7, `describe.runIf`
    (`CV_PARITY_DIR`), `console` silenciado, `verbosity: 0`, las dos normalizaciones en una corrida, `failed_reads` y
    `failed_reads_ref`, `run=<uuid>` y `CV_PARITY_PER_DOC`;
  - `assertOutsideAnyRepository(dir)` pura, llamada antes de cualquier `readdir`, con su test «parity refuses a
    directory inside any repository» **fuera** del `runIf`;
  - test «a failing parity read leaves no text in the output»;
  - el filtro exacto de Vitest para la orden de PowerShell de D7, comprobado y escrito en el design.

  Verificar: los dos tests de guardia verdes en una corrida normal (sin `CV_PARITY_DIR`). Falsación: quitar la búsqueda
  de `.git` y comprobar que el caso del árbol con `.git` deja de fallar; añadir un `expect` sobre el texto y comprobar
  que «a failing parity read leaves no text in the output» falla.
- [ ] 1.5b [backend] Corrida sobre los productores (B1-04): la orden de PowerShell de D7, con `CV_PARITY_PER_DOC=1`,
  sobre la carpeta de la 0.5a. Se anota cuánto tardó. Verificar: tabla `doc=`/recall/orden por valor de
  `disableNormalization` en «Estado del spike y de las mediciones», y `git status --porcelain` sin ficheros nuevos fuera
  de `apps/` y del change.
- [ ] 1.6 [backend] Corte o adopción provisional de `pdfjs-dist` (D3): tabla (a)-(d) con medición, horas acumuladas de
  1.1a-1.5b, esperas de build aparte, y decisión. Puede ser «cumple con 3 productores, pasa a la 3.1», «corte 1/2, pasa
  al grupo 2» o «corte 3, vuelve al debate». Verificar: la tabla está en «Estado del spike y de las mediciones» con
  fecha, y las horas acumuladas son ≤ 4 h o la decisión es un corte.

## 2. Spike: `unpdf` (solo si el grupo 1 termina en corte 1 o 2; tope 4 h)

- [ ] 2.1 [backend] Igual que la 1.1a-1.1c con `unpdf`: el `node -e` de `require(esm)` sobre sus módulos primero,
  opciones equivalentes a D4 y el test «a missing pdf.js worker module is a boot error» adaptado al módulo que
  corresponda. Se desinstala `pdfjs-dist` salvo que `unpdf` lo necesite como par. Verificar y falsar como en la 1.1a-1.1c.
- [ ] 2.2 [infra] Igual que la 1.2a-1.2b con `unpdf`. Verificar como en la 1.2a-1.2b.
- [ ] 2.3 [infra] Igual que la 1.3a-1.3b con `unpdf`. Verificar y falsar como en la 1.3a-1.3b.
- [ ] 2.4 [backend] Igual que la 1.4 con `unpdf`. Verificar como en la 1.4.
- [ ] 2.5 [backend] Igual que la 1.5b con `unpdf`, reutilizando el instrumento de la 1.5a. Verificar como en la 1.5b.
- [ ] 2.6 [backend] Corte o adopción provisional de `unpdf`, como en la 1.6. Si es corte 1 o 2, pasa al grupo 9. Si se
  adopta, R21 (las alertas no llegan) queda como riesgo aceptado en ADR-064. Verificar como en la 1.6.

## 3. Medición del owner y cierre del spike (design D3, D7)

- [ ] 3.1 [owner] **La hace el owner, en su máquina** (unos 30 minutos, más los 15 de la 0.5b en la misma sesión), con
  la candidata adoptada provisionalmente. **Los CV son del owner o de personas que se los dieron para esto. Nunca se
  descargan del almacén de staging ni del de producción. Se busca variedad de herramientas: al menos 3 distintas, si
  las hay.** Primero corre la orden de PowerShell de D7 (sin `CV_PARITY_PER_DOC`) sobre la carpeta de productores
  completa (con `word.pdf` y `google-docs.pdf` de la 0.5b) y después sobre la carpeta con 5 o 6 CV reales:
  ```powershell
  $env:CV_PARITY_DIR='C:\ruta\fuera\del\repo'; pnpm nx run worker:test --skip-nx-cache -- <filtro de la 1.5a>; Remove-Item Env:CV_PARITY_DIR
  ```
  El implementador le deja en el PR la orden exacta, con el filtro ya puesto. Los CV no salen de esa carpeta ni se
  suben a ningún sitio. Verificar: en el PR constan solo las líneas `parity …` de cada corrida (dos por corrida, con el
  mismo `run=`), la fecha y, si el owner quiere, el recuento de CV por tipo de herramienta. No consta ningún nombre,
  texto, número de páginas por archivo ni captura. **Puerta:** sin esta tarea, el grupo 4 no empieza. Si a los 14 días
  de la 1.6 (o la 2.6) no está hecha, el implementador anota «en pausa por la 3.1» con la fecha.
- [ ] 3.1b [backend] Lectura de la 3.1: copiar las líneas `parity …` a «Estado del spike y de las mediciones» y
  decidir con el criterio de D7. Si los productores completos o los CV no cumplen, **vuelve al debate** (D3: no se
  pasa a la otra candidata). Si se adopta la otra candidata más adelante, la 3.1 se repite con ella (PO-08). Verificar:
  las líneas copiadas, con su decisión y fecha.
- [ ] 3.2 [backend] Cierre del spike: biblioteca, versión, resultado de `require(esm)`, lista de lecturas (sin cambios
  o el motivo del MODIFIED), arranque local, delta (con máquina y almacén), licencias, paridad (sintética, productores y
  owner) y decisión de `disableNormalization` según D7, con fecha. Si se necesita una ruta de lectura fuera de
  `node_modules` (D6), se para aquí y vuelve al debate. Verificar: «Estado del spike y de las mediciones» completo hasta
  este punto, y ADR-064 §Elección con la biblioteca y la versión.

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
  dependencia vieja no vuelve». Si se adoptó `unpdf`, además «the bundled pdf.js is at least the audited version»
  (R21). Verificar: verde. Falsación: volver a poner la versión de la biblioteca con `^` y comprobar que el tercero
  falla; añadir `"pdf-parse": "1.1.4"` a `dependencies` sin instalar y comprobar que el primero falla.
- [ ] 4.3 [backend] Lint (D10, C1-16): `DOMAIN_RESTRICTED_PATTERNS` y el bloque del hijo de `eslint.config.mjs` pasan a
  `pdfjs-dist|unpdf|pdf-parse|mammoth`, con los comentarios y el mensaje actualizados. En
  `tools/workspace-rules/src/workspace-rules.spec.ts`, los tres casos de extractores que deja `cv-extract-isolation`
  (dominio, dentro del hijo y fuera del hijo) importan la biblioteca adoptada en lugar de `pdf-parse`. Verificar:
  `pnpm nx run workspace-rules:test` y `pnpm nx run worker:lint` verdes. Falsación: un import temporal de la biblioteca
  adoptada en `apps/worker/src/modules/cv/infrastructure/isolation/isolated-cv-text-extractor.ts` hace fallar
  `worker:lint`.
- [ ] 4.4 [backend] Tests de la biblioteca en el hijo (requirement «La biblioteca de PDF es un pdf.js mantenido…»):
  «pdf document options are exactly the audited ones» (de la 1.1c, con la versión final), «text items on the same y
  share a line» (escenario «Las líneas de un PDF se unen por su altura», con un PDF generado en el test) y «extracts the
  fixture PDF with the expected text» contra `expected-texts.ts`. Verificar: verdes. Falsación: pasar
  `isEvalSupported: true` en `pdfDocumentOptions` y comprobar que el primero falla.
- [ ] 4.5 [infra] Imagen final y falsaciones de imagen (C1-10): `docker/worker.Dockerfile` con la poda de la 1.3b o la
  2.3, solo si hizo falta, y comentario con el porqué (Q3). Imagen construida en local y `docker compose run --rm
  --no-deps worker node cv-extract-probe.js` sale 0. Delta final contra la imagen de `main` (misma máquina y almacén)
  en «Estado del spike y de las mediciones». Verificar: salidas volcadas a fichero y delta ≤ umbral de Q3. Falsaciones
  (escenario «Faltan los mapas de caracteres de pdf.js», C1-03): construir una imagen de prueba que borra `cmaps/` del
  paquete y comprobar que la sonda sale con 1; si hay poda, ampliarla al build `legacy` y comprobar que la sonda sale
  distinto de 0.

## 5. Renovate (design D11; solo si Q6 = (a); tope 1 h)

- [ ] 5.1 [infra] `renovate.json`: `packageRule` con `matchPackageNames` igual a la adoptada, `mammoth`,
  `@xmldom/xmldom` y `jszip`, con `vulnerabilityAlerts` y `dependencyDashboardApproval: false`. Se confirma en la
  documentación de Renovate la precedencia frente al `dependencyDashboardApproval: true` global (R20). **Tope de 1 h**
  (B2-02): si no queda confirmada, la regla no entra y Q6 vuelve al owner con el dato. Test «renovate lets security
  alerts for the document parsers skip the dashboard» en `no-pdf-parse.spec.ts`, que lee `renovate.json`. Verificar:
  verde, y `node -e "JSON.parse(require('fs').readFileSync('renovate.json','utf8'))"` sale 0. Falsación: quitar `jszip`
  de la regla y comprobar que el test falla.

## 6. Arranque en `arm64` (design D9)

- [ ] 6.1 [owner] **La dispara el owner** (unos 5 minutos): `gh workflow run cd-staging.yml --ref
  change/cv-pdf-library-upgrade -f dry_run=true`, o el disparo en modo de prueba que deje 35c. Construye y verifica en
  `ubuntu-24.04-arm` sin publicar. Verificar: el owner pega en el PR el identificador de la corrida.
- [ ] 6.1b [infra] Lectura de la corrida de la 6.1: el log volcado a fichero; se anotan `pdf chars=`, `docx chars=`,
  `boot_p50_ms`, `boot_p95_ms` y el delta contra la línea base de la 0.4. Verificar: `boot_p95_ms` ≤ 1.500 y ningún tag
  publicado por esa corrida. Si no se cumple, el change no pasa a la 8.2 y vuelve al debate. Falsación: con un log de
  ejemplo que dice `boot_p95_ms=1600`, el `node -e` de lectura imprime «fuera de criterio».

## 7. Documentación

- [ ] 7.1 [backend] Comentarios y documentación:
  - `README.md` (§ de la extracción: la biblioteca adoptada lee dentro del hijo aislado);
  - `docs/RUNBOOK.md`, «Operar los CV»: la biblioteca, su versión exacta, por qué se cargan los dos módulos y se
    comprueban sus datos antes de `ready`, qué significa un `machinery_error` con `boot_error` tras actualizarla, y
    **una línea sobre cómo repetir la paridad** con la fuente de `tools/cv-fixtures/parity-source/` y la orden de
    `CV_PARITY_DIR`, sin datos en el repositorio (B2-01);
  - `tools/cv-fixtures/README.md`, que nombra `pdf-parse`;
  - comentarios que nombran `pdf-parse` en `cv-fixtures.ts`, `apps/web-e2e/src/support/cv-files.ts`,
    `apps/web-e2e/src/cv.spec.ts`, `apps/web-e2e/src/match.spec.ts`, `cv-text-extractors.port.ts` e
    `infra/ci/verify-artifact.sh` (la sección de la sonda).

  Verificar: `grep -rn "pdf-parse" README.md docs/RUNBOOK.md apps libs tools infra` solo devuelve menciones históricas
  marcadas como tales, y `bash infra/ci/repo-checks.sh` verde.
- [ ] 7.2 [backend] ADR-064 §Elección y §Consecuencias con la biblioteca, la versión y las mediciones (y R21 si es
  `unpdf`). Las anotaciones de una línea de ADR-058 (Decisión 7) y de ADR-028 (§Consecuencias, «Dependencias») nombran
  la biblioteca adoptada. Verificar: `grep -n "ADR-064" docs/adr/ADR-058.md docs/adr/ADR-028.md` devuelve una línea en
  cada uno.

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

## 9. Salida sin sustitución (design D13; solo si los grupos 1 y 2 terminan en corte 1 o 2)

- [ ] 9.1 [backend] La rama queda como dice la tabla de D13: `defaultPdfTextSource` vuelve a `PdfParseTextSource`, se
  desinstalan las candidatas, se quita la exclusión de canvas y se borra `child/pdf-parity.spec.ts`; `expected-texts.ts`,
  su test y la fuente inventada se quedan. Verificar: `git diff origin/main -- apps libs package.json pnpm-lock.yaml
  pnpm-workspace.yaml eslint.config.mjs docker` solo muestra `expected-texts.ts` y su test, y `pnpm nx run worker:test`
  está verde.
- [ ] 9.2 [infra] Design, ADR y manifiesto, según la tabla de D13: resultado de los dos spikes y la pregunta nueva al
  owner en el design; ADR-064 a **Rechazado**; deltas de `specs/` retirados o reducidos al mínimo según lo que vio la
  0.3; una línea en la fila del manifiesto. Verificar: `pnpm exec openspec validate cv-pdf-library-upgrade --strict
  --no-interactive` con el resultado que anticipó la 0.3, y `bash infra/ci/repo-checks.sh` verde.
- [ ] 9.3 [infra] PR con la regresión de la 9.1 y los documentos, fusionado en una ventana autorizada, y
  `openspec archive cv-pdf-library-upgrade --skip-specs` en su PR de archivo. Verificar: el directorio está en
  `openspec/changes/archive/` y las specs vigentes no cambiaron (`git diff` de `openspec/specs/` vacío).
