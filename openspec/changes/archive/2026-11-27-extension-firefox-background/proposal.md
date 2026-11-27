## Why

Hallazgo H10 del debate de `extension-refresh-guard`, verificado contra MDN el 2026-11-26
(<https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background>): Firefox **no**
admite `background.service_worker` en MV3 ([bug 1573659](https://bugzil.la/1573659)). Solo usa `background.scripts`, que
arranca un *event page*. Para que la misma extensión funcione en los dos navegadores, MDN recomienda declarar
`scripts` y `service_worker` a la vez. La nota «Firefox 121 and later starts the background page as expected,
regardless of the presence of service_worker» habla de manifiestos que **tienen las dos claves**, no de un manifiesto
que solo tiene `service_worker`.

El código lo confirma (`main` 2f335cc6):

- `apps/extension/manifest.template.json` declara solo `"background": { "service_worker": "background.js", "type":
  "module" }`. El plugin `linkvault-extension-manifest` de `apps/extension/vite.config.mts`, en el modo `firefox`
  (`build-firefox` = `vite build --mode firefox`), solo agrega `browser_specific_settings.gecko` (`id`
  `linkvault@linkvault.app`, `strict_min_version` `121.0`) y `host_permissions`. No toca `background`.
- `apps/extension/scripts/lint-firefox-manifest.mjs` exige exactamente `{ service_worker: "background.js", type:
  "module" }`. Su comentario («Firefox 121+ loads it») es el error de origen; lo mismo dicen ADR-047 §2 y el
  requirement «Build Firefox MV3» de `extension/firefox-packaging`.
- El popup no habla con la API: todo pasa por `runtime.sendMessage` (`src/lib/bridge.ts`) hacia el fondo
  (`src/background/service-worker.ts`), que es el único que construye `ExtensionApi`. **Sin fondo, en Firefox no
  funcionan el login, el refresh ni el guardado**: el build de Firefox (fila 33) nunca funcionó.
- El `lint-firefox` no corre en CI (ningún workflow lo invoca) y el recorrido manual de la fila 33 en Firefox no dejó
  rastro que lo contradiga. Nadie lo notó porque la extensión no tiene usuarios.

El bundle admite el cambio: Vite genera `background.js` como **módulo ES** (formato `es`, entradas `popup` y
`background`) y, en el build actual, `background.js` abre con un `import` estático de `./assets/save-link.js` (chunk
compartido con el popup). Un event page con `type: "module"` carga `background.js` como módulo (Firefox ≥ 112; el
mínimo del manifiesto es 121), y la ruta relativa resuelve desde la raíz de la extensión. `type: "module"` es
**obligatorio**: sin él, el `import` falla. El código de fondo no usa nada exclusivo de service workers (`self`,
`clients`, `importScripts`, `skipWaiting`): usa `globalThis`, `fetch`, `runtime.onMessage` y `storage`, que existen
igual en un event page. Un event page de MV3 también se suspende al quedar inactivo y `runtime.sendMessage` lo
despierta, así que el ciclo de vida que suponen el popup y el mutex en memoria de `ExtensionApi` no cambia.

## What Changes

- **Manifiesto de Firefox:** el build de Firefox declara `"background": { "scripts": ["background.js"],
  "service_worker": "background.js", "type": "module" }`. **Solo el de Firefox**; el de Chromium queda igual.
  Motivos:
  - el build de Chromium apunta a `chrome120` y el manifiesto no declara `minimum_chrome_version`. Agregar `scripts`
    ahí arriesga que un Chromium anterior a 121 rechace o avise sobre el manifiesto, y no gana nada: Chromium no usa
    `scripts` en MV3;
  - Firefox mantiene `service_worker` por la recomendación de MDN para manifiestos multinavegador. Con
    `strict_min_version` 121, Firefox arranca el event page aunque esté la clave, y cuando Firefox implemente service
    workers el manifiesto ya los declara. El template sigue siendo común y Firefox **agrega** una clave, no la
    sustituye.
- **Construcción del manifiesto testeable:** la composición que hoy vive dentro del plugin de `vite.config.mts` pasa a
  una función pura `buildExtensionManifest(template, { apiBaseUrl, target })` en `apps/extension/build/manifest.ts`.
  Su test, en `extension:test` (corre en CI con `affected`), fija el contrato de los dos manifiestos. Hoy el único
  guardia es `lint-firefox`, que es local.
- **Lint de Firefox:** `lint-firefox-manifest.mjs` exige `background.scripts` igual a `["background.js"]`, además de
  `type: "module"` y `service_worker: "background.js"`. El comentario pasa a citar MDN y el bug 1573659.
- **Docs:** RUNBOOK §«Build Firefox (temporary add-on)»: el fondo de Firefox es un event page; se inspecciona con
  «Inspeccionar» en `about:debugging`.
- **ADR-047 §2:** lleva una anotación de una línea con la corrección. No hace falta un ADR nuevo: se corrige un
  hecho mal verificado y la decisión de ADR-047 no cambia (mismo codebase, outDir separado, FF ≥ 121, `gecko.id`).
- **Prueba en Firefox real**, a cargo del owner (no hay Firefox en la máquina del agente): cargar el build como
  complemento temporal, iniciar sesión y guardar un link.

**Fuera de alcance:** publicar en AMO; correr `lint-firefox` en CI (el test de contrato cubre el manifiesto en CI);
cambiar el comportamiento de la extensión (refresh, sesión: eso es `extension-refresh-guard`, aparcada); Chromium;
`webextension-polyfill`.

## Precedencia (fila 35)

Este change toca solo la extensión: sin despliegue, sin `platform/*`, sin API ni datos. La fila 35b (`staging-host`)
deja la extensión **fuera** del alcance de los invitados (Non-Goals de su proposal y design), así que la medición de
35b no depende de él. **No hace falta adelantarlo antes de cerrar 35b**, salvo que el owner quiera publicar en AMO
(o repartir el build de Firefox a alguien) antes de esa fecha. Por eso queda como candidata fuera de
`openspec-changes.yaml`, igual que las filas 37-43, y aplicarlo antes de cerrar la fila 35 necesita la excepción del
owner (Q1).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `extension/firefox-packaging`: el requirement «Build Firefox MV3» pasa de exigir `background.service_worker` a
  exigir `background.scripts` + `service_worker` + `type: "module"` en Firefox, y fija que el manifiesto de Chromium
  no lleva `scripts`.

## Impact

- **Código:** `apps/extension/vite.config.mts`, `apps/extension/build/manifest.ts` (nuevo) y su spec,
  `apps/extension/vitest.config.mts` y `tsconfig.spec.json` (incluir `build/**`),
  `apps/extension/scripts/lint-firefox-manifest.mjs`. No cambia `manifest.template.json`, ni el código de `src/`, ni
  la API.
- **Docs:** `docs/RUNBOOK.md` (§ extensión), `docs/adr/ADR-047.md` (anotación), `docs/design-v0.2.md` §6 fila **44**.
- **Datos, dependencias, despliegue y CI:** ninguno. Los workflows no cambian; el test nuevo entra por
  `extension:test`.
- **Relación con `extension-refresh-guard` (fila 43, aparcada):** su design dice que Web Locks está «en los service
  workers de […] Firefox ≥ 96». Con este change, en Firefox el fondo es un event page (contexto de ventana), donde
  Web Locks también existe desde Firefox 96. El supuesto vale igual, pero esa línea debe corregirse si se reabre. No
  bloquea a ninguno de los dos.
- **Agentes:** `frontend-dev` (etiqueta `[frontend]`), `devops` (RUNBOOK). La prueba manual es del owner.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] ¿Se aplica antes de cerrar la fila 35?** Según ADR-048 y ADR-051, ningún
  change de otra fila entra antes de cerrar la fila 35 sin una excepción del owner (precedente: ADR-055 §1, filas
  35b∥ y 40).
  - (a) Excepción con la misma clase que ADR-055 §1 (sin despliegue ni `platform/*`): aplicar y fusionar ya.
  - (b) Esperar a cerrar 35c.
  - (c) Aplicar y fusionar solo si antes se decide publicar en AMO o repartir el build de Firefox.

  **Recomendación: (b).** Nadie usa la extensión de Firefox y 35b la deja fuera; adelantarlo no mejora ninguna
  medición. Si el owner prefiere no dejar un build roto en `main` por más tiempo, (a) es barato y de bajo riesgo:
  unas 4 tareas, solo la extensión.

  Respuesta del owner (2026-11-27): **(a)**, «Aplicar ahora». Excepción de la misma clase que ADR-055 §1: solo la
  extensión, sin despliegue ni `platform/*`.
- **Q2 [no bloqueante] ¿La prueba en Firefox real condiciona la fusión?**
  - (a) Sí: el PR no se fusiona sin la tarea 2.2 hecha.
  - (b) No: se fusiona con los guardias automáticos y la prueba queda para antes de publicar en AMO.

  **Recomendación: (a).** Es la única prueba de que el fondo arranca. El test de contrato y el lint fijan el
  manifiesto que MDN documenta, pero no lo ejecutan en Firefox, y ese hueco es justamente el que dejó pasar el
  defecto en la fila 33.

  Respuesta del owner a la Q2 (2026-11-27): «Realiza pruebas simuladas del browser aquí en el navegador interno». La
  tarea 2.2 se cubre con una **simulación** en el navegador interno de la app (Chromium): el `background.js` del build
  de Firefox se carga como módulo en una página, que es como Firefox ejecuta un event page, con un `browser`/`chrome`
  falso, y se recorre el flujo del popup contra la API local. No es Firefox real: la carga del manifiesto por
  `about:debugging` y el CORS `moz-extension://` quedan sin probar hasta antes de publicar en AMO.
