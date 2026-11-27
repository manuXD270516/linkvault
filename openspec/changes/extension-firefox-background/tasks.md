## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. En las de código, el test se escribe **primero** y se ve caer sobre el código sin
arreglar; la salida de ese fallo se anota en el «Estado» de la tarea. Los guardias llevan su falsación: se rompe a
propósito lo que vigilan, se ve el rojo y se restaura. Sin `design.md`: no hay decisiones no triviales; los motivos
(solo Firefox, mantener `service_worker`) están en `proposal.md`.

- [x] 0.1 [infra] Q1 del proposal respondida por el owner y anotada con fecha en `proposal.md` (debajo de la Q1, en
  una línea que empieza por «Respuesta del owner (AAAA-MM-DD):»). Si Q1 = (b), el change no pasa de aquí hasta archivar
  la 35c; si Q1 = (c), hasta que se decida publicar en AMO. Verificar: `grep -c "Respuesta del owner (20"
  openspec/changes/extension-firefox-background/proposal.md` devuelve `1` (antes, `0`).
  Estado (2026-11-27): Q1 = (a) «Aplicar ahora»; Q2 sustituida por la simulación en el navegador interno (ver proposal).

## 1. Manifiesto de Firefox con `background.scripts`

- [x] 1.1 [frontend] **Extraer la composición del manifiesto sin cambiar el comportamiento.** Primero crear
  `apps/extension/build/manifest.spec.ts` con:
  - «buildExtensionManifest sets host_permissions to the API origin» (`http://localhost:3000/` → `["http://localhost:3000/*"]`);
  - «buildExtensionManifest adds gecko id and strict_min_version 121.0 only for firefox» (Chromium sin
    `browser_specific_settings`);
  - «buildExtensionManifest keeps chrome background as module service worker without scripts» (`background` igual a
    `{ service_worker: "background.js", type: "module" }` y `"scripts" in background` es `false`);
  - «buildExtensionManifest does not mutate the template» (`structuredClone` del template antes y `toEqual` después,
    para los dos destinos).

  El template de los tests es el `manifest.template.json` real, leído con `readFileSync`. Así el test también vigila
  el template. Agregar `build/**/*.spec.ts` al `include` de `apps/extension/vitest.config.mts` y `build/**/*.ts` al de
  `tsconfig.spec.json`. El spec cae al importar porque el módulo no existe. Después, crear
  `apps/extension/build/manifest.ts` con `export function buildExtensionManifest(template: Readonly<Record<string,
  unknown>>, options: { apiBaseUrl: string; target: 'chrome' | 'firefox' }): Record<string, unknown>`. Recibe el
  template ya parseado, devuelve una copia y no lee ni escribe archivos. Mover ahí `hostPermissionFor`, las constantes
  de gecko y la rama `target === 'firefox'`. El plugin de `vite.config.mts` sigue leyendo el template y escribiendo el
  archivo, pero compone con la función. Verificar: `pnpm nx run extension:test --skip-nx-cache` con los 4 casos en
  verde, `pnpm nx run extension:typecheck` y `pnpm nx run extension:lint` verdes, y un `git diff --no-index` entre el
  `dist/apps/extension-firefox/manifest.json` (y el de Chromium) de antes y de después de extraer sin diferencias.
  Falsación (guardia): cambiar en la función `'/*'` por `'/**'` hace caer el primer caso; agregar `"scripts":
  ["background.js"]` al `background` de `manifest.template.json` hace caer el tercero. Restaurar los dos.
  Estado (2026-11-27): rojo previo: `extension:test` cae con «Cannot find module './manifest' imported from
  apps/extension/build/manifest.spec.ts» (1 suite fallida, 3 pasan). Verde: 4 casos nuevos, 17/17 tests; `typecheck`
  y `lint` verdes; `git diff --no-index` de los manifiestos de Chromium y Firefox de antes/después de extraer, sin
  diferencias. Falsación: `/*` → `/**` hizo caer «sets host_permissions to the API origin» (1 failed | 16 passed);
  `scripts` en el `background` del template hizo caer «keeps chrome background as module service worker without
  scripts». Ambos restaurados (17/17).

- [x] 1.2 [frontend] **Firefox declara `background.scripts`.** Primero, en `apps/extension/build/manifest.spec.ts`,
  agregar «buildExtensionManifest declares background scripts next to the module service worker for firefox»:
  `background` igual a `{ scripts: ["background.js"], service_worker: "background.js", type: "module" }`. Cae sobre
  1.1 porque falta `scripts`; anotar el fallo. Después, en la rama de Firefox de `buildExtensionManifest`, componer
  `background` como copia del del template más `scripts: ['background.js']`, sin tocar el objeto del template. Con un
  comentario de una línea que remita a MDN (`manifest.json/background`, bug 1573659). Verificar: `pnpm nx run
  extension:test --skip-nx-cache` verde (los 5 casos, incluidos «keeps chrome background…» y «does not mutate the
  template», que confirman que Chromium no cambió); `pnpm nx run extension:build-firefox` produce un manifiesto con
  las tres claves de `background`; `pnpm nx run extension:build` produce uno sin `scripts`. Falsación: quitar
  `scripts` de la rama de Firefox hace caer el caso nuevo; mutar `template.background` en lugar de copiarlo hace caer
  «does not mutate the template» (o el de Chromium si comparten objeto). Restaurar.
  Estado (2026-11-27): rojo previo: «declares background scripts next to the module service worker for firefox»
  falla con «AssertionError: expected { …(2) } to deeply equal { scripts: [ 'background.js' ], …(2) }» (1 failed |
  17 passed). Verde: 18/18; `typecheck`, `lint`, `build` y `build-firefox` verdes. El manifiesto de Firefox generado
  trae `background` = `{ service_worker, type: "module", scripts: ["background.js"] }`; el de Chromium no contiene
  `scripts`. Falsación: quitar `scripts` hace caer el caso nuevo; mutar el template en lugar de copiarlo (con
  `scripts` agregado in situ) hizo caer «keeps chrome background…» (comparten objeto), no el de no mutación. Los
  dos restaurados (18/18).

- [x] 1.3 [frontend] **El lint de Firefox exige `scripts` y cita MDN.** En
  `apps/extension/scripts/lint-firefox-manifest.mjs`:
  - la condición de `background` exige además que `background.scripts` sea un array igual a `["background.js"]`;
  - el mensaje de fallo pasa a `background must be { scripts: ["background.js"], service_worker: "background.js",
    type: "module" }`;
  - el comentario de cabecera deja de decir «Firefox 121+ loads it» y dice: «Firefox does not support
    background.service_worker in MV3 (MDN manifest.json/background; bug 1573659): it starts the background as an event
    page from background.scripts. MDN recommends declaring both keys for a cross-browser extension; Firefox 121+
    starts the background page when both are present. web-ext 8.x still flags service_worker as unsupported, so this
    contract lint replaces `web-ext lint`; AMO's online validator stays the authority at submit time.»

  Primero, falsación sobre el lint sin cambiar: con el build de 1.2, quitar a mano `scripts` del
  `dist/apps/extension-firefox/manifest.json` y correr `node apps/extension/scripts/lint-firefox-manifest.mjs`. Hoy
  pasa (`OK`): esa es la salida «roja» que se anota, porque el lint aceptaba un fondo que Firefox no arranca. Después
  del cambio, el mismo manifiesto editado hace que el lint termine con código 1 y el mensaje nuevo. Verificar: `pnpm
  nx run extension:lint-firefox` (reconstruye) termina en `OK`; `grep -c "Firefox 121+ loads it"
  apps/extension/scripts/lint-firefox-manifest.mjs` devuelve `0` y `grep -c "1573659"` devuelve `1`. No pegar en el
  «Estado» la línea `OK` entera si el `.env` local apunta `EXTENSION_API_BASE_URL` a un host que no sea `localhost`
  (imprime `host_permissions`).
  Estado (2026-11-27): rojo previo: con el manifiesto de Firefox sin `scripts` (editado a mano en `dist/`), el lint
  sin cambiar terminó con código 0 e imprimió `[extension:lint-firefox] OK {"geckoId":"linkvault@linkvault.app",
  "strictMinVersion":"121.0", …}`: aceptaba un fondo que Firefox no arranca. Verde: el mismo manifiesto editado ahora
  da código 1 y «[extension:lint-firefox] background must be { scripts: ["background.js"], service_worker:
  "background.js", type: "module" }»; `pnpm nx run extension:lint-firefox` (reconstruye) termina en `OK`;
  `extension:lint` verde; `grep -c "Firefox 121+ loads it"` = 0 y `grep -c "1573659"` = 1.

## 2. Documentación y prueba en Firefox

- [x] 2.1 [infra] **RUNBOOK.** En `docs/RUNBOOK.md` §«Build Firefox (temporary add-on)», después del paso 1, agregar
  una nota: en Firefox el fondo es un *event page* (`background.scripts`), no un service worker; su consola se abre con
  «Inspeccionar» junto al complemento en `about:debugging`, y se suspende cuando queda inactivo como en Chromium. En
  §«Firefox AMO», nota: el validador online puede avisar que `service_worker` no está soportado; es esperado, porque
  el manifiesto lo declara a propósito para Chromium/futuro (MDN recomienda las dos claves). Verificar: `grep -n
  "event page" docs/RUNBOOK.md` muestra las líneas nuevas; `bash infra/ci/repo-checks.sh` verde.
  Estado (2026-11-27): antes, `grep -c "event page" docs/RUNBOOK.md` = 0 (tarea de documentación: ese es el rojo).
  Después, `grep -n "event page"` muestra la línea 1411 (nota del paso 1 de «Build Firefox (temporary add-on)»); la
  nota de «Firefox AMO» sobre el aviso de `service_worker` quedó en el paso 3. `bash infra/ci/repo-checks.sh` verde
  («5 comprobaciones de repositorio ejecutadas»).

- [ ] 2.2 [infra] **Prueba manual en Firefox, a cargo del owner** (no hay Firefox en la máquina del agente). Con la
  pila local arriba (`pnpm infra:up`, `pnpm nx serve api`):
  1. `pnpm nx run extension:lint-firefox` en `OK`.
  2. Firefox ≥ 121 → `about:debugging#/runtime/this-firefox` → «Cargar complemento temporario…» → elegir
     `dist/apps/extension-firefox/manifest.json`. El complemento carga sin errores y aparece «Inspeccionar».
  3. Abrir el popup una vez, copiar el `Origin` `moz-extension://<uuid>` (Red de «Inspeccionar») a
     `EXTENSION_CORS_ORIGINS` y reiniciar la API (RUNBOOK, pasos 2-4).
  4. En el popup: iniciar sesión con una cuenta local; en una pestaña con una URL de oferta, «Guardar» en privado; el
     link aparece en el SPA (`http://localhost:4200`).
  5. En la consola de «Inspeccionar» (el event page), sin errores de carga de `background.js` ni de
     `./assets/*.js`.

  Contraprueba (opcional, confirma el diagnóstico): con el build de `main` anterior al change, el paso 4 falla (el
  popup no recibe respuesta del fondo). Anotar en el «Estado» la versión de Firefox, la fecha y el resultado de cada
  paso, sin tokens ni contraseñas. Según la Q2, condiciona la fusión.

## 3. Cierre

- [ ] 3.1 [frontend] `pnpm nx affected -t lint,typecheck,test,i18n-check` verde;
  `node node_modules/@fission-ai/openspec/bin/openspec.js validate extension-firefox-background --strict
  --no-interactive` y `validate --all --strict --no-interactive` verdes; `bash infra/ci/repo-checks.sh` verde.
  Verificar: las cuatro salidas en el «Estado».
