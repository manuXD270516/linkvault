## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos de los casos de prueba (`it(...)`) que
el implementador crea tal cual; cada uno sale de un escenario de `specs/`.

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada con fecha en ADR-059 §1, en una línea que empieza por
  «Respuesta del owner (Q1), AAAA-MM-DD:», y en `design.md`. Si Q1 = (b), el change no pasa de aquí hasta archivar
  35c; si Q1 = (c), se aplican 1, 2, 3.1, 3.2, 4, 5, 6.2-6.4 y 7, sin la barra compacta (3.3-3.6) ni el
  ayudante 6.1. Verificar: `grep -cE "Respuesta del owner \(Q1\), 20[0-9]{2}-" docs/adr/ADR-059.md` devuelve `1`
  (antes de anotarla devuelve `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada.
  Verificar: `design.md` lleva la sección del debate de la última iteración con la fecha de la aprobación.

## 1. Contrato y API (design D1-D4)

- [ ] 1.1 [backend] `libs/shared/src/schemas/capabilities.schema.ts`: `capabilitiesResponseSchema`
  (`z.object({ search: z.boolean(), discovery: z.boolean(), push: z.boolean() })`, **no** estricto),
  `strictCapabilitiesResponseSchema` (`.strict()`, para la API) y el tipo `CapabilitiesResponse`; export en
  `libs/shared/src/index.ts`. Verificar en `capabilities.schema.spec.ts`: «accepts the three booleans», «rejects a
  non-boolean value», «client schema accepts and strips an unknown key» y «strict schema rejects an unknown key».
  Falsación: poner `.strict()` en el schema del cliente y ver caer «client schema accepts and strips an unknown key»;
  restaurar.
- [ ] 1.2 [backend] `apps/api/src/infrastructure/config/capabilities.ts`: función pura
  `deriveCapabilities(config: ApiConfig): CapabilitiesResponse` según D2. Verificar en `capabilities.spec.ts` (con
  `test-support/test-config.ts`): «all off with the default test config», «search needs both the flag and a Meili
  host», «search is off with the flag and an empty host», «discovery follows its flag», «push needs public key,
  private key and subject», «push is off with a blank private key» (`'  '`). Falsación: derivar `search` solo de
  `FEATURE_SEARCH` y ver caer «search is off with the flag and an empty host»; restaurar.
- [ ] 1.3 [backend] Depende de 1.1 y 1.2. `apps/api/src/presentation/http/capabilities.controller.ts` (sin
  `@Public()`; calcula el objeto una vez en el constructor con `strictCapabilitiesResponseSchema.parse`;
  `@Header('Cache-Control', 'private, max-age=300')`) y `capabilities.module.ts`, registrado en el módulo raíz como
  `health`/`metrics`. Verificar: `grep -n "Public" apps/api/src/presentation/http/capabilities.controller.ts` no
  devuelve nada, y `pnpm nx run api:typecheck` en verde.
- [ ] 1.4 [backend] Depende de 1.3. `capabilities.controller.spec.ts` con la app Nest de prueba y el guard global real
  (patrón de `test-support/auth-test-app.ts`): «responds 401 without an access token», «responds 200 with the derived
  capabilities for a signed-in user», «body has exactly search, discovery and push, all booleans» y «sends
  Cache-Control private, max-age=300». Falsación (guardia D3): añadir `meiliHost: config.MEILI_HOST` al objeto del
  controlador y ver caer «body has exactly search, discovery and push, all booleans» (y el `parse` estricto);
  restaurar.

## 2. Capacidades en el SPA (design D4, D5)

- [ ] 2.1 [frontend] `apps/web/src/app/core/capabilities/capabilities.api.ts`: `get()` sobre
  `GET /api/capabilities`, validado con `capabilitiesResponseSchema` (no estricto). Verificar en
  `capabilities.api.spec.ts`: «requests GET /api/capabilities», «parses a response with an unknown extra key» y
  «rejects a body that does not validate».
- [ ] 2.2 [frontend] Depende de 2.1. `capabilities.store.ts` (`providedIn: 'root'`): signal de estado
  `loading | ready | failed`, `ensureLoaded()` que devuelve la misma promesa a llamadas concurrentes y no repite tras
  `ready` ni tras `failed`, y los `computed` `showSearch`, `showDiscovery`, `searchOff`, `discoveryOff` y `pushOff`
  según la tabla de D5 (`*Off` solo es `true` en `ready` con el booleano en `false`). Verificar en
  `capabilities.store.spec.ts` con `HttpTestingController`: «issues a single request for concurrent callers», «does not
  request again after ready», «hides conditional entries while loading», «shows them after a 500 (fails open)»,
  «shows them after an invalid body», «off flags are false while loading and after a failure». Falsación: hacer que
  `failed` oculte las entradas y ver caer «shows them after a 500 (fails open)»; restaurar.

## 3. La barra (design D6, D8, D9)

- [ ] 3.1 [frontend] `layout/shell/nav-entries.ts`: `NAV_ENTRIES` en el orden de D9, cada una con ruta, texto i18n
  (`$localize` con id `@@shell.groups`, `@@shell.myLinks`, …; se conservan los ids existentes) y capacidad opcional
  (`search` | `discovery`). Verificar en `nav-entries.spec.ts`: «lists the entries in the agreed order» y «only Buscar
  and Descubrir require a capability».
- [ ] 3.2 [frontend] Depende de 2.2 y 3.1. Modo ancho del `Shell`: renderiza `NAV_ENTRIES` filtradas por el store y
  llama a `ensureLoaded()` al crearse. Ajustar `shell.spec.ts` (los casos existentes siguen en verde, con la petición
  de capacidades atendida) y añadir: «hides Buscar and Descubrir when both capabilities are off», «shows Descubrir and
  hides Buscar when only discovery is on», «hides both while capabilities are loading», «shows both when the
  capabilities request fails», «renders the entries in the agreed order», «Grupos links to /grupos». Todos con un
  doble de `BreakpointObserver` fijado en ancho.
- [ ] 3.3 [frontend] Depende de 3.2. Modo compacto (D8): signal desde `BreakpointObserver.observe('(max-width:
  1023.98px)')`; fila con marca y botón «Menú» (`aria-expanded`, `aria-controls`); `<nav>` con
  `aria-label` «Navegación principal», enlaces de las mismas entradas filtradas y «Cerrar sesión» al final; empuja el
  contenido (no superpuesto). Verificar en `shell.spec.ts` con el doble en compacto: «compact bar shows only the brand
  and the menu button», «menu button starts with aria-expanded false and points to the nav», «opening the menu lists
  the visible entries as links», «compact panel hides Buscar and Descubrir when both are off», «wide mode has no menu
  button».
- [ ] 3.4 [frontend] Depende de 3.3. Cierre del panel: al `NavigationEnd`, al volver a pulsar el botón y con Escape
  (foco al botón). Verificar en `shell.spec.ts` (router real de prueba): «closes the panel after navigating to Mi CV»,
  «toggles the panel with the menu button», «Escape closes the panel and focuses the menu button». Falsación: quitar
  la suscripción a `NavigationEnd` y ver caer «closes the panel after navigating to Mi CV»; restaurar.
- [ ] 3.5 [frontend] Depende de 3.3. `shell.scss`: estilos del modo compacto (una fila, panel en columna bajo la
  barra) conservando el `flex-wrap` de 5.4b en modo ancho, con el comentario actualizado. Verificar:
  `pnpm nx run web:lint` y `pnpm nx run web:build` en verde.
- [ ] 3.6 [frontend] Depende de 3.5. Evidencia del umbral (D8): con `nx serve web` y la pila local, capturas de
  `/grupos` a 412, 1024 y 1280 px (búsqueda y Descubrir apagados, como staging) guardadas fuera del repositorio y
  descritas en esta tarea: a 412 px una fila; a 1024 y 1280 px entradas en una fila sin el botón. Si a 1024 px las
  entradas no caben en una fila, se sube el umbral y se anota el valor aquí y en D8.

## 4. Páginas con la capacidad apagada (design D7, D11)

- [ ] 4.1 [frontend] Depende de 2.2. `features/search/search.page`: con `searchOff()`, estado de D7 (`role="status"`,
  enlace a `/mis-links`) en lugar del formulario, sin llamar a `GET /api/search`. Verificar en `search.page.spec.ts`:
  «shows the not-enabled state when search is off», «does not request /api/search when search is off», «links to
  /mis-links from the not-enabled state», «keeps the form while capabilities are loading», «keeps the 503 message
  when capabilities failed».
- [ ] 4.2 [frontend] Depende de 2.2. `features/discovery/discovery.page`: lo mismo con `discoveryOff()`, sin búsqueda,
  selector de bolsa ni de destino, y sin `GET /api/discovery/search`. Verificar en `discovery.page.spec.ts`: «shows the
  not-enabled state when discovery is off», «does not request /api/discovery/search when discovery is off», «shows
  the board and destination selectors when discovery is on», «keeps the discovery_disabled empty state when
  capabilities failed».
- [ ] 4.3 [frontend] Depende de 2.2. `features/notifications/notifications.page`: con `pushOff()` y sin suscripción,
  «Activar push» deshabilitado y el aviso de D11 en `role="status"`, sin pedir la clave VAPID ni permiso; con
  suscripción, «Desactivar push» intacto. Verificar en `notifications.page.spec.ts`: «disables Activar push and
  explains when push is off», «does not request the VAPID key when push is off», «keeps email preferences editable
  when push is off», «still allows Desactivar push with an existing subscription».
- [ ] 4.4 [frontend] Comprobación cruzada de las tres páginas en modo compacto y ancho a mano con la pila local
  (capacidades apagadas como `e2e.env`): `/buscar` y `/descubrir` por URL directa muestran su estado, Notificaciones
  muestra el push deshabilitado. Verificar anotando en esta tarea la URL, el modo y lo visto.

## 5. Textos e i18n (design D12)

- [ ] 5.1 [frontend] Depende de 3.x y 4.x. `pnpm nx run web:extract-i18n` y traducciones en `messages.en.xlf` de
  `shell.groups`, `shell.menu`, `shell.navLabel`, `search.notEnabled`, `search.notEnabled.myLinks`,
  `discovery.notEnabled`, `discovery.notEnabled.myLinks` y `notifications.push.notEnabled` con los textos de D12.
  Verificar: `pnpm nx run web:i18n-check` en verde y `grep -c` de los ocho ids en `messages.en.xlf` devuelve `8`.
  Falsación: borrar la unidad `shell.menu` de `messages.en.xlf` y ver caer `web:i18n-check` nombrándola; restaurar.

## 6. Camino crítico (`@lot1`) y re-admisión (design D13)

- [ ] 6.1 [frontend] `apps/web-e2e/src/support/shell-nav.ts`: `navigateByShell(page, name)`, que pulsa «Menú» si está
  visible y después `getByRole('link', { name, exact: true })` dentro de la barra o del panel. Sustituir en
  `critical-path.spec.ts` los clics de «Postulaciones», «Mi CV» y «LinkVault». Verificar:
  `pnpm nx run web-e2e:lint` en verde (sin esperas fijas) y una corrida
  `pnpm nx run web-e2e:e2e-stack -- --project=mobile` en verde.
- [ ] 6.2 [frontend] Depende de 6.1. En el paso de abrir Postulaciones, `page.waitForResponse` de
  `GET /api/capabilities` armado antes de la carga y afirmación «Buscar»/«Descubrir» visibles si y solo si su
  capacidad es `true` (en la barra o en el panel). Verificar: `pnpm nx run web-e2e:e2e-stack -- --project=chromium`
  en verde. Falsación: invertir la condición de la afirmación y ver caer el recorrido en `chromium`; restaurar.
- [ ] 6.3 [frontend] Depende de 6.2. Re-admisión con carga en `chromium`, perfil `local` y ensayo (dos invocaciones
  de `apps/web-e2e/README.md` «Cómo admitir una prueba», pila nueva cada una): cinco de cinco y ningún `429` de
  registro. Verificar anotando las dos filas con fecha y commit en «Admisiones».
- [ ] 6.4 [frontend] Depende de 6.2. Lo mismo en `mobile` (dos invocaciones). Verificar anotando las dos filas en
  «Admisiones».

## 7. Cierre

- [ ] 7.1 [frontend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar con la salida volcada a
  fichero y leída.
- [ ] 7.2 [infra] `pnpm exec openspec validate web-shell-capabilities --strict --no-interactive`,
  `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en verde.
- [ ] 7.3 [infra] ADR-059 a «Aceptado» con la fecha de fusión y el PR; si Q1 = (a), anotar en
  `docs/design-v0.2.md` §6 una fila «∥ 35b» como la de `usage-guide-fixes`. Verificar con `grep` del estado y de la
  fila.
