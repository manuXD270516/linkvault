## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos de los casos de prueba (`it(...)`) que
el implementador crea tal cual; cada uno sale de un escenario de `specs/`.

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada con fecha en ADR-059 §1, en una línea que empieza por
  «Respuesta del owner (Q1), AAAA-MM-DD:», y en `design.md`. Si Q1 = (b), el change no pasa de aquí hasta archivar
  35c; si Q1 = (c), se aplican 1, 2, 3.1, 3.2a, 3.2b, 4, 5.1, 6.2-6.6 y 7, sin la barra compacta (3.3a-3.6), sin la
  5.2 ni el ayudante 6.1; si Q1 = (d), la anotación incluye la excepción a «entre PR-1 y PR-2» y dónde quedó escrita
  en 35b. Verificar: `grep -cE "Respuesta del owner \(Q1\), 20[0-9]{2}-" docs/adr/ADR-059.md` devuelve `1`
  (antes de anotarla devuelve `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada.
  Verificar: `design.md` lleva la sección del debate de la última iteración con la fecha de la aprobación.

## 1. Contrato y API (design D1-D4)

- [ ] 1.1 [backend] `libs/shared/src/schemas/capabilities.schema.ts`: `capabilitiesResponseSchema`
  (`z.object({ search: z.boolean(), discovery: z.boolean() })`, **no** estricto),
  `strictCapabilitiesResponseSchema` (`.strict()`, para la API) y el tipo `CapabilitiesResponse`; export en
  `libs/shared/src/index.ts`. Verificar en `capabilities.schema.spec.ts`: «accepts the two booleans», «rejects a
  non-boolean value», «client schema accepts and strips an unknown key» y «strict schema rejects an unknown key».
  Falsación: poner `.strict()` en el schema del cliente y ver caer «client schema accepts and strips an unknown key»;
  restaurar.
- [ ] 1.2 [backend] `apps/api/src/infrastructure/config/capabilities.ts`: función pura
  `deriveCapabilities(config: ApiConfig): CapabilitiesResponse` según D2. Verificar en `capabilities.spec.ts` (con
  `test-support/test-config.ts`): «all off with the default test config», «search needs both the flag and a Meili
  host», «search is off with the flag and an empty host», «discovery follows its flag». Falsación: derivar `search`
  solo de `FEATURE_SEARCH` y ver caer «search is off with the flag and an empty host»; restaurar.
- [ ] 1.3 [backend] Depende de 1.1 y 1.2. `apps/api/src/presentation/http/capabilities.controller.ts` (sin
  `@Public()`; calcula el objeto una vez en el constructor con `strictCapabilitiesResponseSchema.parse`;
  `@Header('Cache-Control', 'private, no-store')`) y `capabilities.module.ts`, registrado en el módulo raíz como
  `health`/`metrics`. Verificar: `grep -n "Public" apps/api/src/presentation/http/capabilities.controller.ts` no
  devuelve nada, `grep -c "private, no-store"` sobre el controlador devuelve `1`, y `pnpm nx run api:typecheck` en
  verde.
- [ ] 1.4 [backend] Depende de 1.3. `capabilities.controller.spec.ts` con la app Nest de prueba y el guard global real
  (patrón de `test-support/auth-test-app.ts`): «responds 401 without an access token», «responds 200 with the derived
  capabilities for a signed-in user», «body has exactly search and discovery, both booleans» y «sends Cache-Control
  private, no-store». Falsación (guardia D3): añadir `meiliHost: config.MEILI_HOST` al objeto del controlador y ver
  caer «body has exactly search and discovery, both booleans» (y el `parse` estricto); restaurar. Falsación (C5):
  cambiar la cabecera a `private, max-age=300` y ver caer «sends Cache-Control private, no-store»; restaurar.

## 2. Capacidades en el SPA (design D4, D5)

- [ ] 2.1 [frontend] `apps/web/src/app/core/capabilities/capabilities.api.ts`: `get()` sobre
  `GET /api/capabilities`, validado con `capabilitiesResponseSchema` (no estricto). Verificar en
  `capabilities.api.spec.ts`: «requests GET /api/capabilities», «parses a response with an unknown extra key» y
  «rejects a body that does not validate».
- [ ] 2.2 [frontend] Depende de 2.1. `capabilities.store.ts` (`providedIn: 'root'`): signal `state` con
  `loading | ready | failed`, `ensureLoaded()` que devuelve la misma promesa a llamadas concurrentes y no repite tras
  `ready` ni tras `failed`, y los `computed` `showSearch`, `showDiscovery`, `searchOff` y `discoveryOff` según la tabla
  de D5 (`*Off` solo es `true` en `ready` con el booleano en `false`); plazo `CAPABILITIES_TIMEOUT_MS = 5000` tras el
  cual pasa a `failed` y descarta una respuesta tardía (D5, B7). Verificar en `capabilities.store.spec.ts` con
  `HttpTestingController` y temporizadores falsos de Vitest: «issues a single request for concurrent callers», «does
  not request again after ready», «hides conditional entries while loading», «shows them after a 500 (fails open)»,
  «shows them after an invalid body», «off flags are false while loading and after a failure», «state goes from
  loading to ready or failed», «fails open after the timeout» (5 s sin respuesta → `failed` y entradas visibles) e
  «ignores a response that arrives after the timeout». Falsación: hacer que `failed` oculte las entradas y ver caer
  «shows them after a 500 (fails open)»; restaurar. Falsación (B7): quitar el plazo y ver caer «fails open after the
  timeout»; restaurar.

## 3. La barra (design D5, D6, D8, D9)

- [ ] 3.1 [frontend] `layout/shell/nav-entries.ts`: `NAV_ENTRIES` en el orden de D9, cada una con ruta, texto i18n
  (`$localize` con id `@@shell.groups`, `@@shell.myLinks`, …; se conservan los ids existentes) y capacidad opcional
  (`search` | `discovery`). Verificar en `nav-entries.spec.ts`: «lists the entries in the agreed order» y «only Buscar
  and Descubrir require a capability».
- [ ] 3.2a [frontend] Depende de 2.2 y 3.1. Modo ancho del `Shell`: renderiza `NAV_ENTRIES` filtradas por el store,
  llama a `ensureLoaded()` al crearse y pone en el `<mat-toolbar>` `[attr.data-capabilities]="store.state()"` (D5).
  Verificar en `shell.spec.ts`, con un doble de `BreakpointObserver` fijado en ancho: «hides Buscar and Descubrir when
  both capabilities are off», «shows Descubrir and hides Buscar when only discovery is on», «hides both while
  capabilities are loading», «shows both when the capabilities request fails», «toolbar reflects the capabilities
  state in data-capabilities». Falsación: fijar el atributo a `ready` sin mirar el store y ver caer «toolbar reflects
  the capabilities state in data-capabilities»; restaurar.
- [ ] 3.2b [frontend] Depende de 3.2a. Ajustar los casos existentes de `shell.spec.ts` (siguen en verde, con la
  petición de capacidades atendida) y añadir: «renders the entries in the agreed order», «Grupos links to /grupos»,
  «Cerrar sesión comes after every entry». Verificar: `pnpm nx run web:test` del spec en verde
  (`--include="**/shell.spec.ts" --skip-nx-cache`).
- [ ] 3.3a [frontend] Depende de 3.2b. Modo compacto (D8): constante
  `SHELL_COMPACT_QUERY = '(max-width: 1023.98px)'` en `layout/shell/shell-breakpoint.ts` (con comentario cruzado hacia
  `SHELL_WIDE_MIN_WIDTH_PX` de `apps/web-e2e/src/support/shell-nav.ts`); signal con valor inicial
  `breakpointObserver.isMatched(SHELL_COMPACT_QUERY)`, actualizado con `observe(...)`; fila con la marca y el
  botón «Menú». Verificar en `shell.spec.ts` con el doble (que implementa `isMatched` y `observe`): «compact bar shows
  only the brand and the menu button», «wide mode has no menu button», «renders compact on the first change detection
  when the query already matches». Falsación (C7): inicializar la signal en `false` en vez de con `isMatched` y ver
  caer «renders compact on the first change detection when the query already matches»; restaurar.
- [ ] 3.3b [frontend] Depende de 3.3a. Barra y panel envueltos en un `<header>` del Shell (hoy no existe).
  Panel: `<nav id="lv-shell-nav" aria-label="Navegación principal">` siempre en
  el DOM en modo compacto, con `[hidden]` cerrado; botón con `aria-expanded` y `aria-controls="lv-shell-nav"`; enlaces
  de las mismas entradas filtradas y «Cerrar sesión» al final; empuja el contenido (no superpuesto); `<main
  tabindex="-1">` en el Shell. Verificar en `shell.spec.ts`: «menu button starts with aria-expanded false and points to
  the nav», «the nav exists and is hidden while closed», «opening the menu lists the visible entries as links»,
  «compact panel hides Buscar and Descubrir when both are off».
- [ ] 3.4 [frontend] Depende de 3.3b. Cierre del panel (D8, C6, B6, B8, N5): al `NavigationEnd` **solo si el panel
  estaba abierto** (foco a `<main>` con `focus({ preventScroll: true })`; con el panel cerrado o en modo ancho no se
  toca el foco), al pulsar cualquier enlace del panel con `(click)` (cierra y foco a `<main>`, también en la ruta
  actual), al volver a pulsar el botón (foco en el botón), con Escape escuchado solo con el panel abierto y en el
  `<header>` del Shell (foco al botón), y al pasar a modo ancho. Verificar en `shell.spec.ts` (router real de prueba):
  «closes the panel after navigating to Mi CV», «toggles the panel with the menu button», «Escape closes the panel and
  focuses the menu button», «focuses main after navigating from the panel», «focuses main without scrolling» (espía
  sobre `focus` de `<main>` llamado con `{ preventScroll: true }`), «does not move focus on NavigationEnd when the
  panel was closed» (foco en un `<input>` de la página, `router.navigate([], { replaceUrl: true })`, el foco sigue en
  el `<input>`), «tapping the current route's entry closes the panel», «closes the panel when the viewport becomes
  wide», «ignores Escape when the panel is closed or the key comes from outside the header». Falsación: quitar la
  suscripción a `NavigationEnd` y ver caer «closes the panel after navigating to Mi CV»; restaurar. Falsación: mover el
  listener de Escape a `document` y ver caer «ignores Escape when the panel is closed or the key comes from outside the
  header»; restaurar. Falsación (B6): enfocar `<main>` en todo `NavigationEnd`, sin mirar si el panel estaba abierto, y
  ver caer «does not move focus on NavigationEnd when the panel was closed»; restaurar. Falsación (N5): quitar el
  `(click)` de los enlaces del panel y ver caer «tapping the current route's entry closes the panel»; restaurar.
- [ ] 3.5 [frontend] Depende de 3.3b. `shell.scss`: estilos del modo compacto (una fila, panel en columna bajo la
  barra) colgados de la clase que pone la signal, sin media query con el umbral (D8, N7), conservando el `flex-wrap` de
  5.4b en modo ancho, con el comentario actualizado; y `main:focus { outline: none }` (B8). Verificar:
  `grep -c "main:focus" apps/web/src/app/layout/shell/shell.scss` devuelve `1`, y `pnpm nx run web:lint` y
  `pnpm nx run web:build` en verde.
- [ ] 3.6 [frontend] Depende de 3.5. Evidencia del umbral (D8, C8, B5): con `nx serve web` y la pila local, capturas de
  `/grupos` guardadas fuera del repositorio con estos nombres: `wsc-412-es-off.png` (búsqueda y Descubrir apagados,
  como staging), `wsc-1024-es-on.png`, `wsc-1024-en-on.png`, `wsc-1280-es-on.png` y `wsc-1280-en-on.png` (las dos
  capacidades en `true`, por configuración de la API local o con `page.route` sobre `GET /api/capabilities` en una
  sesión de Playwright de usar y tirar). En cada una se mide `scrollWidth` y `clientWidth` del `<mat-toolbar>`.
  Verificar anotando en esta tarea, por captura, el ancho, el idioma, las dos medidas y el número de filas: a 412 px
  una fila con el botón; a 1024 y 1280 px una fila sin el botón y `scrollWidth <= clientWidth`. Si a 1024 px no entra
  en ES o en EN, se sube el umbral, se repiten las capturas y se anota el valor aquí y en D8. Umbral único (D8, N7):
  `grep -rnE "1023\.98|1024" apps/web/src/app/layout/shell apps/web-e2e/src/support
  openspec/changes/web-shell-capabilities/specs/web/shell/spec.md` solo devuelve `SHELL_COMPACT_QUERY` en
  `shell-breakpoint.ts`, `SHELL_WIDE_MIN_WIDTH_PX` en `shell-nav.ts` y el requirement del spec, todos con el mismo
  valor (1024 / 1023.98), y ninguna línea de `shell.ts` ni de `shell.scss`; D8, D13 y las tareas 3.3a y 6.1 dicen el
  mismo número. Falsación: escribir `@media (max-width: 1023.98px)` en `shell.scss` y ver que el `grep` lo lista;
  restaurar.

## 4. Páginas con la capacidad apagada (design D5, D7)

- [ ] 4.1 [frontend] Depende de 2.2. `features/search/search.page`: en `loading`, estado neutro (título y contenedor
  `aria-busy="true"`, sin formulario, enlace ni botón); con `searchOff()`, estado de D7 (`role="status"`, «La búsqueda
  no está incluida en esta versión de LinkVault.», enlace a `/mis-links`) en lugar del formulario, sin llamar a
  `GET /api/search`; en `failed`, la página de hoy. Verificar en `search.page.spec.ts`: «shows the not-included state
  when search is off», «does not request /api/search when search is off», «links to /mis-links from the not-included
  state», «shows a neutral state without the form while capabilities are loading», «keeps the 503 message when
  capabilities failed». Falsación (C4): mostrar el formulario en `loading` y ver caer «shows a neutral state without
  the form while capabilities are loading»; restaurar.
- [ ] 4.2 [frontend] Depende de 2.2. `features/discovery/discovery.page`: lo mismo con `discoveryOff()` (texto de D7,
  enlaces a `/mis-links` y a `/grupos`), sin búsqueda, selector de bolsa ni de destino, y sin
  `GET /api/discovery/search`; estado neutro en `loading`. Verificar en `discovery.page.spec.ts`: «shows the
  not-included state when discovery is off», «does not request /api/discovery/search when discovery is off», «links to
  /mis-links and /grupos from the not-included state», «shows a neutral state without the form while capabilities are
  loading», «shows the board and destination selectors when discovery is on», «keeps the discovery_disabled empty
  state when capabilities failed».
- 4.3 (retirada en la iteración 1 del debate, B2: el push sale de este change; se conserva el número.)
- [ ] 4.4 [frontend] Depende de 4.1 y 4.2. Comprobación cruzada a mano con la pila local (capacidades apagadas como
  `e2e.env`): `/buscar` y `/descubrir` por URL directa en modo compacto (412 px) y ancho (1280 px). Capturas guardadas
  fuera del repositorio con estos nombres: `wsc-buscar-off-412.png`, `wsc-buscar-off-1280.png`,
  `wsc-descubrir-off-412.png` y `wsc-descubrir-off-1280.png`. Verificar anotando en esta tarea, por captura, la URL, el
  modo y lo visto (texto del aviso y enlaces).

## 5. Textos, i18n y guía (design D12)

- [ ] 5.1 [frontend] Depende de 3.x y 4.x. `pnpm nx run web:extract-i18n` y traducciones en `messages.en.xlf` de
  `shell.groups`, `shell.menu`, `shell.navLabel`, `search.notEnabled`, `search.notEnabled.myLinks`,
  `discovery.notEnabled`, `discovery.notEnabled.myLinks` y `discovery.notEnabled.groups` con los textos de D12.
  Verificar: `pnpm nx run web:i18n-check` en verde y `grep -c` de los ocho ids en `messages.en.xlf` devuelve `8`.
  Falsación: borrar la unidad `shell.menu` de `messages.en.xlf` y ver caer `web:i18n-check` nombrándola; restaurar.
- [ ] 5.2 [frontend] Depende de 3.6. `docs/guia-de-uso/README.md` §27 «En el móvil (Pixel 7)»: el «Visto» describe la
  barra de una fila con «Menú» en vez de «ocupa tres filas»; las capturas `088-movil-grupos.png`,
  `089-movil-detalle-grupo.png` y `090-movil-postulaciones.png` se rehacen con la barra nueva o, si no se rehacen en
  este PR, quedan marcadas en §27 como «captura con la barra anterior a `web-shell-capabilities`». Verificar:
  `grep -n "tres filas" docs/guia-de-uso/README.md` no devuelve la línea de §27, y las tres capturas rehechas (fecha de
  modificación del PR) o marcadas (`grep -c "barra anterior a" docs/guia-de-uso/README.md` devuelve al menos `1`).

## 6. Camino crítico (`@lot1`) y re-admisión (design D13)

- [ ] 6.1 [frontend] `apps/web-e2e/src/support/shell-nav.ts`: constante `SHELL_WIDE_MIN_WIDTH_PX = 1024` (con
  comentario cruzado hacia `SHELL_COMPACT_QUERY`) y `navigateByShell(page, name)`, que decide el modo por
  `page.viewportSize().width < SHELL_WIDE_MIN_WIDTH_PX`; en compacto lee `aria-expanded` del botón «Menú» y lo pulsa
  **solo si es `false`** (N4), y luego `getByRole('link', { name, exact: true })` dentro del `<nav>` «Navegación
  principal»; en ancho, el enlace dentro de la barra. Sustituir en `critical-path.spec.ts` los clics de
  «Postulaciones» y «Mi CV», y en `backToGroup` la marca «LinkVault» por `navigateByShell(page, 'Grupos')`. Verificar:
  `pnpm nx run web-e2e:lint` en verde (sin esperas fijas); `grep -n "aria-expanded" apps/web-e2e/src/support/shell-nav.ts`
  devuelve la lectura antes del clic; y una corrida `pnpm nx run web-e2e:e2e-stack -- --project=mobile` en verde.
  Falsación (N4): pulsar «Menú» sin mirar `aria-expanded` y abrir el panel antes de llamar al ayudante en un paso del
  recorrido; ver caer la corrida `mobile` al no encontrar el enlace (panel cerrado por el segundo clic); restaurar.
- [ ] 6.2 [frontend] Depende de 6.1. Capacidades en el recorrido (C2, C3): armar
  `page.waitForResponse(GET /api/capabilities)` en `register()`, `enterWithTestAccount()` y `joinByInvitation()`
  antes del clic de «Crear cuenta» o «Entrar»; guardar la promesa en `Entry` (A) y pasar la de B a sus pasos 3-7; en
  el paso 5, antes de pulsar «Postulaciones» y sin recargar, esperar la promesa, esperar
  `data-capabilities="ready"` en el `<mat-toolbar>` y afirmar «Buscar»/«Descubrir» visibles si y solo si su capacidad
  es `true` (en la barra o en el panel abierto). Verificar: `pnpm nx run web-e2e:e2e-stack -- --project=chromium` en
  verde. Falsación: invertir la condición de la afirmación y ver caer el recorrido en `chromium`; restaurar.
  Falsación (C3): dejar el store atascado en `loading` (que `ensureLoaded()` no resuelva nunca) y ver caer el
  recorrido en la espera de `ready`, no pasar; restaurar.
- [ ] 6.3 [frontend] Depende de 6.2 y 6.6. Re-admisión con carga en `chromium`, perfil `local` y ensayo (dos
  invocaciones de `apps/web-e2e/README.md` «Cómo admitir una prueba», pila nueva cada una): cinco de cinco y ningún
  `429` de registro. Verificar anotando las dos filas con fecha y commit en un **bloque propio** de «Admisiones»
  titulado «`web-shell-capabilities`, AAAA-MM-DD», separado de las filas de `e2e-suite`.
- [ ] 6.4 [frontend] Depende de 6.2. Lo mismo en `mobile` (dos invocaciones). Verificar anotando las dos filas en el
  mismo bloque.
- [ ] 6.5 [frontend] [condicional: la 9.9 de `e2e-suite` está hecha y `apps/web-e2e/playwright.config.mts` tiene el
  proyecto `webkit` al aplicar] Depende de 6.2. Lo mismo en `webkit` (dos invocaciones), anotado en el mismo bloque. Si
  la 9.9 no está hecha, cerrar la tarea anotando su estado y la salida de
  `grep -n "webkit" apps/web-e2e/playwright.config.mts` (vacía). Verificar con la anotación.
- [ ] 6.6 [frontend] `apps/web-e2e/src/search.spec.ts`: navegar con `page.goto('/buscar')` en lugar de pulsar
  «Buscar» (C10) y leer `GET /api/capabilities` del destino (N6, D13): con `search: false`, afirmar el aviso «La
  búsqueda no está incluida en esta versión de LinkVault.», el enlace a `/mis-links` y que no hubo ninguna petición a
  `GET /api/search` (contador sobre `page.on('request')`); con `search: true`, el recorrido actual. Verificar:
  `grep -n "name: /Buscar/i" apps/web-e2e/src/search.spec.ts` no devuelve nada, `pnpm nx run web-e2e:lint` en verde y
  una corrida informativa de `search.spec.ts` en `chromium` con la pila local (capacidades apagadas, como `e2e.env`),
  anotando en esta tarea la rama tomada y el resultado. No lleva `@lot1`: su resultado es evidencia informativa, no
  bloquea.

## 7. Cierre

- [ ] 7.1 [frontend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar con la salida volcada a
  fichero y leída.
- [ ] 7.2 [infra] `pnpm exec openspec validate web-shell-capabilities --strict --no-interactive`,
  `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en verde.
- [ ] 7.3 [infra] ADR-059 a «Aceptado» con el **número de PR** de este change (no la fecha de fusión, que aún no
  existe; N2); si Q1 = (a), (c) o (d), anotar en `docs/design-v0.2.md` §6 una fila «∥ 35b» como la de
  `usage-guide-fixes`. Verificar con `grep` del estado, del número de PR y de la fila.
- [ ] 7.4 [infra] Depende de 0.1. **Guardia de la ventana de fusión** (D14, C1, N1, N2), justo antes de fusionar:
  (1) con `git fetch` y `git log --first-parent --oneline origin/main`, el merge del PR-2 de 35b, **identificado por
  su número de PR**, está en `main` (si Q1 = (d), la excepción anotada en 35b sustituye esta condición); (2) el estado
  de la 11.6 y la 10.7 de 35b se toma de una **confirmación escrita y fechada del owner en el PR de este change**
  («11.6 hecha el AAAA-MM-DD; 10.7 no hecha»); la casilla de `openspec/changes/staging-host/tasks.md` (en
  `origin/main` o en la rama del PR de archivo de 35b) queda solo como apoyo y, si contradice la confirmación, vuelve al
  owner; (3) sin confirmación o con la 11.6 no hecha: fuera de ventana; si la 10.7 ya se hizo: fuera de ventana,
  vuelve al owner. Verificar con un comentario en el PR, antes de fusionar, con el número y el hash del merge del PR-2
  de 35b, la confirmación del owner citada con su fecha, la fecha de hoy y el resultado («en ventana» / «fuera de
  ventana»). **Después de fusionar** no se commitea en este PR: el hash del merge de este change, la copia de ese
  comentario y la marca de repetir la 9.4 de `e2e-suite` sobre el commit desplegado se anotan en esta tarea en el **PR
  de archivo de este change**, que se fusiona después de la 10.7 de 35b, nunca los días 7 y 14 de la medición, con la
  misma guardia (confirmación escrita y fechada del owner en ese PR de que la 10.7 está hecha y cuándo, y comprobación
  del día). Falsación 1: ejecutar la comprobación sobre el `origin/main` del 2026-10-28 (`5b92d28`, sin el PR-2 de
  35b) y ver que dice «fuera de ventana». Falsación 2: con la 11.6 hecha y una confirmación del owner que declara la
  10.7 hecha, ver que dice «fuera de ventana».
