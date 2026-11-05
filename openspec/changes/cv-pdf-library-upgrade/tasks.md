## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. «Verificar» es lo que demuestra que está hecha. «Falsación», en los guardias, es
el cambio a propósito que tiene que ponerla en rojo, y se deshace después. Los nombres de test están en inglés para que
el implementador los copie tal cual.

**Nada de la medición con PDF de productores ni con CV reales se commitea.** En el repositorio solo entran las líneas
de agregados de design D7.

**Spike (grupos 1 y 2):** tope de **4 h por biblioteca**. Cada tarea anota su hora de inicio y de fin en «Estado del
spike y de las mediciones», y los cortes son los de design D3. El grupo 2 solo se ejecuta si el 1 termina en corte, y
el grupo 9 solo si terminan en corte los dos.

- [ ] 0.1 [infra] Q3, Q6 y Q9 respondidas por el owner y anotadas con fecha: en `design.md` (Open Questions, una línea
  «Respuesta del owner (Qn), AAAA-MM-DD:» por pregunta) y en ADR-064 §Preguntas al owner. Si Q6 = (b), la 5.1 se marca
  «no aplica». Verificar: `grep -cE "Respuesta del owner \(Q(3|6|9)\), 20[0-9]{2}-" docs/adr/ADR-064.md` devuelve `3`
  (antes de anotarlas, `0`).
- [ ] 0.2 [infra] Q10 resuelta por la sesión principal (texto de B2-03 incorporado o registrado como replanteado por
  `business`). Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. Verificar:
  `design.md` lleva la sección del debate de la última iteración, con «Convergencia: SI» y la fecha de la aprobación.
- [ ] 0.3 [infra] Precondiciones de entrada (design D1, R19):
  - `openspec/changes/archive/*-verify-reusable-workflow/` y `openspec/changes/archive/*-cv-extract-isolation/` existen;
  - ADR-058 dice «Aceptado»;
  - el MODIFIED de «Texto extraído, normalizado y acotado» se rehace sobre el texto de
    `openspec/specs/cv/extraction/spec.md` archivado, y el de «Aislamiento de la capa de dominio», sobre
    `openspec/specs/platform/workspace/spec.md` (con el arreglo del hallazgo del Context, si `cv-extract-isolation` lo
    hizo);
  - la consulta de avisos de Q9, hecha y fechada en «Estado del spike y de las mediciones».

  Verificar: `diff` de cada requirement modificado contra el archivado, revisado (solo cambian las líneas que este
  change pretende cambiar), y `pnpm exec openspec validate cv-pdf-library-upgrade --strict --no-interactive` verde.
- [ ] 0.4 [backend] Línea base con `pdf-parse`, antes de instalar nada:
  - `apps/worker/src/modules/cv/infrastructure/extractors/fixtures/expected-texts.ts` con el texto normalizado
    (`prepareCvText`) que guarda hoy el hijo para `pdfWithText()`, `pdfWithoutText()`, `pdfWithPageMarks(60)` y
    `minimalPdf(FIXTURE_CV_LINES)`. Solo texto inventado, y cada constante con un comentario que diga de qué generador
    sale;
  - test «synthetic pdfs keep the recorded text» en `extractors.spec.ts`, por el hijo aislado real;
  - copiar a «Estado del spike y de las mediciones» el `boot_p95_ms` de `arm64` de `cv-extract-isolation` (su 7.4).

  Verificar: el test pasa con `pdf-parse`. Falsación: cambiar un carácter de una constante y comprobar que falla.

## 1. Spike: `pdfjs-dist` (design D2-D8; tope 4 h)

- [ ] 1.1 [backend] Carga desde el bundle:
  - `pnpm add --save-exact pdfjs-dist@<última estable con ≥ 7 días>`;
  - `PdfJsTextSource` en `child/pdf-extract.ts` con las opciones de D4, como `defaultPdfTextSource` (`PdfParseTextSource`
    se queda, para la paridad);
  - carga de `legacy/build/pdf.mjs` y `legacy/build/pdf.worker.mjs` en el nivel superior del módulo, antes de `ready`,
    con la vía de D5 que funcione.

  Verificar:
  - `pnpm nx build worker`;
  - `node dist/apps/worker/cv-extract-probe.js` sale 0;
  - `cv-extract-child.bundle.spec.ts` verde, con `pdfjs-dist` en la lista de versiones exactas;
  - test «a missing pdf.js worker module is a boot error» en el spec del runner, con un `node_modules` de prueba sin
    el módulo del worker: el desenlace es `CvExtractionMachineryError`, no `unreadable`.

  Anotar: vía de carga (R2), cómo se resolvió el worker falso, si se intentó cargar algún módulo opcional (R15) y el
  `boot_p95_ms` local. Falsación: mover la carga del módulo del worker detrás de `ready` y comprobar que el test da
  `unreadable`.
- [ ] 1.2 [infra] Dentro de la imagen y con la lista de lecturas de producción sin cambios (D6):
  - `docker build -f docker/worker.Dockerfile` en local;
  - `docker compose run --rm --no-deps worker node cv-extract-probe.js` sale 0;
  - si se puede generar en la tarea, `pdfWithPredefinedCMap()` en `cv-fixtures.ts` (texto inventado con un CMap
    predefinido, sin fuente embebida), leído por la sonda o por un test del hijo; si no se puede, se anota.

  Verificar: salidas volcadas a fichero y `productionReadList()` sigue con dos rutas. Falsación: construir la imagen
  borrando `cmaps/` del paquete y comprobar que el fixture CID pierde texto o falla (si no hay fixture CID, quitar
  `/app/node_modules` de la lista en una construcción de prueba y comprobar `boot_error`).
- [ ] 1.3 [infra] Costo (D8):
  - `@napi-rs/canvas` excluido en `pnpm-workspace.yaml` (`ignoredOptionalDependencies`, confirmado con pnpm 12.4.2);
  - tamaño de la imagen antes y después con `docker image inspect --format '{{.Size}}'`, sin podar y, si hace falta
    para Q3, podado en la etapa `build`;
  - licencias del árbol nuevo con `pnpm licenses list --prod --json`, contra la lista blanca de D8.

  Verificar: delta (sin `pdf-parse`, restado aparte) y licencias en «Estado del spike y de las mediciones»; delta ≤
  umbral de Q3; ninguna licencia fuera de la lista blanca. Falsación: sin la exclusión, `dist/apps/worker/pnpm-lock.yaml`
  contiene `@napi-rs/canvas`; con ella, no.
- [ ] 1.4 [backend] Paridad sintética y suites heredadas:
  - «synthetic pdfs keep the recorded text» (0.4) con `pdfjs-dist`;
  - las suites `worker` y `worker-isolation` enteras (`extractors.spec.ts`, `pathological.spec.ts` y el spec del
    runner), incluidos «an encrypted PDF fails as password» (si cae, se ajusta el fixture según R14) y
    «reads a small PDF that arrives in a pooled buffer».

  Verificar: `pnpm nx run worker:test` verde, con la salida volcada a fichero. Anotar cualquier test que cambió de
  desenlace y por qué.
- [ ] 1.5 [backend] Instrumento de paridad y productores (D7):
  - `child/pdf-parity.spec.ts` (proyecto `worker-isolation`), con las definiciones de D7 y `describe.runIf`
    (`CV_PARITY_DIR`);
  - test «parity refuses a directory inside the repository»;
  - corrida sobre los ≥ 5 PDF de la persona inventada (Word, LibreOffice, Google Docs, LaTeX y dos columnas), que
    viven fuera del repositorio, con `disableNormalization` a `true` y a `false`.

  Verificar: tabla `doc-i`/productor/recall/orden por valor en «Estado del spike y de las mediciones», y
  `git status --porcelain` sin ficheros nuevos fuera de `apps/` y del change. Falsación: apuntar `CV_PARITY_DIR` a
  `apps/worker/tmp-parity/` y comprobar que el test falla con «CV_PARITY_DIR must be outside the repository».
- [ ] 1.6 [backend] Corte o adopción provisional de `pdfjs-dist` (D3): tabla (a)-(d) con medición, horas acumuladas de
  1.1-1.5 y decisión. Puede ser «cumple, pasa a la 3.1», «corte 1/2, pasa al grupo 2» o «corte 3, vuelve al debate».
  Verificar: la tabla está en «Estado del spike y de las mediciones» con fecha, y las horas acumuladas son ≤ 4 h o la
  decisión es un corte.

## 2. Spike: `unpdf` (solo si el grupo 1 termina en corte 1 o 2; tope 4 h)

- [ ] 2.1 [backend] Igual que la 1.1 con `unpdf` (versión exacta, su build de pdf.js, opciones equivalentes a D4). Se
  desinstala `pdfjs-dist` salvo que `unpdf` lo necesite como par. Verificar y falsar como en la 1.1, con el test «a
  missing pdf.js worker module is a boot error» adaptado al módulo de `unpdf` que corresponda.
- [ ] 2.2 [infra] Igual que la 1.2 con `unpdf`. Verificar y falsar como en la 1.2.
- [ ] 2.3 [infra] Igual que la 1.3 con `unpdf`. Verificar y falsar como en la 1.3.
- [ ] 2.4 [backend] Igual que la 1.4 con `unpdf`. Verificar como en la 1.4.
- [ ] 2.5 [backend] Igual que la 1.5 con `unpdf`, reutilizando el instrumento. Verificar como en la 1.5.
- [ ] 2.6 [backend] Corte o adopción provisional de `unpdf`, como en la 1.6. Si es corte, pasa al grupo 9. Verificar
  como en la 1.6.

## 3. Medición del owner y cierre del spike (design D3, D7)

- [ ] 3.1 [backend] **La hace el owner, en su máquina**, con la candidata adoptada provisionalmente:
  ```
  CV_PARITY_DIR=<carpeta fuera del repo con 5 o 6 CV reales> pnpm nx run worker:test -- pdf-parity
  ```
  una vez con cada valor de `disableNormalization` (el implementador le deja la orden exacta en el PR). Los CV no salen
  de esa carpeta ni se suben a ningún sitio. Verificar: en «Estado del spike y de las mediciones» solo constan la fecha,
  las líneas `parity …` y, si el owner quiere, el recuento de CV por tipo de herramienta. No consta ningún nombre,
  texto, número de páginas por archivo ni captura. Si no cumple el criterio de D7, la candidata se cierra (1.6 o 2.6
  pasan a corte) y, si se adopta la otra, esta tarea se repite con ella (PO-08).
- [ ] 3.2 [backend] Cierre del spike: biblioteca, versión, vía de carga, lista de lecturas (sin cambios o el motivo del
  MODIFIED), arranque local, delta, licencias, paridad (sintética, productores y owner) y decisión de
  `disableNormalization` según D7, con fecha. Si se necesita una ruta de lectura fuera de `node_modules` (D6), se para
  aquí y vuelve al debate. Verificar: «Estado del spike y de las mediciones» completo hasta este punto, y ADR-064
  §Elección con la biblioteca y la versión.

## 4. Sustitución (design D4, D10)

- [ ] 4.1 [backend] Limpieza de `pdf-parse` en el worker:
  - se borran `PdfParseTextSource` y `child/pdf-parity.spec.ts`;
  - `pnpm remove pdf-parse @types/pdf-parse`;
  - se borra `extractors/pdf-parse-lib.d.ts`;
  - `resolveNodeModulesRoot` busca la biblioteca adoptada, y su comentario y el de `developmentReadList` se actualizan;
  - `cv-extract-child.bundle.spec.ts` fija `mammoth` y la adoptada;
  - el comentario de `withOwnBuffer` dice por qué se conserva (D4);
  - `disableNormalization` queda fijada con el valor de la 3.2.

  Verificar: `pnpm nx run worker:typecheck` y `pnpm nx run worker:test` verdes, y
  `grep -rn "pdf-parse" apps/worker/src package.json` sin resultados fuera de comentarios históricos marcados como
  tales.
- [ ] 4.2 [backend] `no-pdf-parse.spec.ts` (worker), con tres tests: «the root manifest does not list pdf-parse»,
  «the lockfile does not resolve pdf-parse» y «the pdf library is pinned to an exact version». Es el escenario «La
  dependencia vieja no vuelve». Verificar: verde. Falsación: volver a poner la versión de la biblioteca con `^` y
  comprobar que el tercero falla; añadir `"pdf-parse": "1.1.4"` a `dependencies` sin instalar y comprobar que el primero
  falla.
- [ ] 4.3 [backend] Lint (D10):
  - `DOMAIN_RESTRICTED_PATTERNS` y el bloque del hijo de `eslint.config.mjs` pasan a
    `pdfjs-dist|unpdf|pdf-parse|mammoth`, con los comentarios y el mensaje actualizados;
  - en `tools/workspace-rules/src/workspace-rules.spec.ts`, el caso del dominio importa la adoptada; el de
    infraestructura pasa a `apps/worker/src/modules/cv/infrastructure/isolation/child/probe.ts` (debe pasar); y se
    añade «a worker infrastructure file outside the isolated child imports a document extractor»
    (`apps/worker/src/modules/cv/infrastructure/probe.ts`, `expectedRuleIds: ['no-restricted-imports']`).

  Verificar: `pnpm nx run workspace-rules:test` y `pnpm nx run worker:lint` verdes. Falsación: un import temporal de la
  biblioteca adoptada en `apps/worker/src/modules/cv/infrastructure/isolation/isolated-cv-text-extractor.ts` hace
  fallar `worker:lint`.
- [ ] 4.4 [backend] Tests de la biblioteca en el hijo (requirement «La biblioteca de PDF es un pdf.js mantenido…»):
  - «eval is disabled when the pdf is opened»: un doble del cargador registra las opciones de `getDocument`:
    `isEvalSupported === false`, sin `url` y `useSystemFonts === false`;
  - «text items on the same y share a line» (escenario «Las líneas de un PDF se unen por su altura»), con un PDF
    generado en el test;
  - «extracts the fixture PDF with the expected text» contra `expected-texts.ts`;
  - «an extracted cv is not re-read when the worker starts» (escenario «Un CV ya leído no se vuelve a leer»): worker
    real con Mongo en memoria y un CV `extracted` sembrado; tras el arranque no hay job en `extract-cv` y el documento
    sigue igual.

  Verificar: verdes. Falsación: pasar `isEvalSupported: true` y comprobar que el primero falla.
- [ ] 4.5 [infra] Imagen final: `docker/worker.Dockerfile` con la poda de la 1.3/2.3, solo si hizo falta, y comentario
  con el porqué (Q3). Imagen construida en local y `docker compose run --rm --no-deps worker node cv-extract-probe.js`
  sale 0. Delta final contra la imagen de `main` en «Estado del spike y de las mediciones». Verificar: salidas volcadas
  a fichero y delta ≤ umbral de Q3. Falsación: si hay poda, ampliarla al build `legacy` y comprobar que la sonda sale
  distinto de 0.

## 5. Renovate (design D11; solo si Q6 = (a))

- [ ] 5.1 [infra] `renovate.json`: `packageRule` con `matchPackageNames` igual a la adoptada, `mammoth`,
  `@xmldom/xmldom` y `jszip`, con `vulnerabilityAlerts` y `dependencyDashboardApproval: false`. Se confirma en la
  documentación de Renovate la precedencia frente al `dependencyDashboardApproval: true` global (R20). Test «renovate
  lets security alerts for the document parsers skip the dashboard» en `no-pdf-parse.spec.ts`, que lee `renovate.json`.
  Verificar: verde, y `node -e "JSON.parse(require('fs').readFileSync('renovate.json','utf8'))"` sale 0. Falsación:
  quitar `jszip` de la regla y comprobar que el test falla.

## 6. Arranque en `arm64` (design D9)

- [ ] 6.1 [infra] **La corrida la dispara el owner**: `gh workflow run cd-staging.yml --ref change/cv-pdf-library-upgrade
  -f dry_run=true`, o el disparo en modo de prueba que deje 35c. Construye y verifica en `ubuntu-24.04-arm` sin
  publicar. El implementador lee el log volcado a fichero y anota `pdf chars=`, `docx chars=`, `boot_p50_ms`,
  `boot_p95_ms` y el delta contra la línea base de la 0.4. Verificar: `boot_p95_ms` ≤ 1.500 y ningún tag publicado por
  esa corrida. Si no se cumple, el change no pasa a la 8.2 y vuelve al debate. Falsación: con un log de ejemplo que
  dice `boot_p95_ms=1600`, el `node -e` de lectura imprime «fuera de criterio».

## 7. Documentación

- [ ] 7.1 [backend] Comentarios y documentación:
  - `README.md` (§ de la extracción: la biblioteca adoptada lee dentro del hijo aislado);
  - `docs/RUNBOOK.md` («Operar los CV»: la biblioteca, su versión exacta, por qué se cargan los dos módulos antes de
    `ready`, qué significa un `machinery_error` con `boot_error` tras actualizarla y cómo se repite la paridad con
    `CV_PARITY_DIR`, sin datos en el repositorio);
  - comentarios que nombran `pdf-parse` en `cv-fixtures.ts`, `apps/web-e2e/src/support/cv-files.ts`,
    `apps/web-e2e/src/cv.spec.ts`, `apps/web-e2e/src/match.spec.ts` y `cv-text-extractors.port.ts`.

  Verificar: `grep -rn "pdf-parse" README.md docs/RUNBOOK.md apps libs tools` solo devuelve menciones históricas
  marcadas como tales, y `bash infra/ci/repo-checks.sh` verde.
- [ ] 7.2 [backend] ADR-064 §Elección y §Consecuencias con la biblioteca, la versión y las mediciones. Las anotaciones
  de una línea de ADR-058 (Decisión 7) y de ADR-028 (§Consecuencias, «Dependencias») nombran la biblioteca adoptada.
  Verificar: `grep -n "ADR-064" docs/adr/ADR-058.md docs/adr/ADR-028.md` devuelve una línea en cada uno.

## 8. Cierre

- [ ] 8.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` verde, y el lote 1 de `e2e-suite` en local
  (`e2e-stack`) con el paso del CV en «Listo · tu CV se leyó bien». Verificar: salidas volcadas a fichero y revisadas.
- [ ] 8.2 [infra] Fusión del PR del change (design D14): a mano, con CI verde, en una ventana autorizada por el owner y
  sin `--auto`. Precondición: 6.1 dentro de criterio. Verificar: hash del merge anotado en el PR.
- [ ] 8.3 [infra] Comprobación tras desplegar (Migration Plan §3) sobre el commit desplegado: un PDF de la cuenta e2e
  sube `linkvault_cv_extractions_total{format="pdf",outcome="text"}`; la sonda en el contenedor `worker` del host da
  `boot_p95_ms` ≤ 1.500; `pdf-parse` no está en `node_modules` de la imagen. Verificar: valores anotados con fecha en
  «Estado del spike y de las mediciones».
- [ ] 8.4 [infra] PR de archivo: ADR-064 pasa a **Aceptado**, con el número del PR del change y el hash de su merge;
  «Estado del spike y de las mediciones» completo; `/opsx:archive` aplica los deltas a
  `openspec/specs/cv/extraction/spec.md` y `openspec/specs/platform/workspace/spec.md`. Verificar:
  `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` verdes en el PR.

## 9. Salida sin sustitución (design D13; solo si los grupos 1 y 2 terminan en corte)

- [ ] 9.1 [backend] La rama vuelve a `pdf-parse`:
  - `defaultPdfTextSource` vuelve a `PdfParseTextSource`;
  - se desinstalan las candidatas, se quita la exclusión de canvas y se borra `child/pdf-parity.spec.ts`;
  - `expected-texts.ts` y su test se quedan como regresión.

  Verificar: `git diff origin/main -- apps libs package.json pnpm-lock.yaml pnpm-workspace.yaml eslint.config.mjs
  docker` solo muestra `expected-texts.ts` y su test, y `pnpm nx run worker:test` está verde.
- [ ] 9.2 [infra] Design, ADR y manifiesto:
  - el design anota el resultado de los dos spikes y una pregunta nueva al owner con las opciones de D13;
  - ADR-064 pasa a **Rechazado**, con las mediciones;
  - se retiran los deltas de `specs/`;
  - la fila del manifiesto lo dice en una línea.

  Verificar: `pnpm exec openspec validate cv-pdf-library-upgrade --strict --no-interactive` (o el aviso de change sin
  deltas que dé la versión instalada, anotado) y `bash infra/ci/repo-checks.sh` verde.
- [ ] 9.3 [infra] PR con la regresión de la 9.1 y los documentos, fusionado en una ventana autorizada, y
  `openspec archive cv-pdf-library-upgrade --skip-specs` en su PR de archivo. Verificar: el directorio está en
  `openspec/changes/archive/` y las specs vigentes no cambiaron (`git diff` de `openspec/specs/` vacío).
