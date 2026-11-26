## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Las que arreglan una carrera **empiezan por su test**, que tiene que fallar sobre
el código anterior a la tarea (en `main` 2f335cc6, o sobre el de la tarea previa cuando se indica); el «Estado» anota la
salida roja observada. Las que son guardias se marcan así y llevan su falsación. Títulos de test en inglés, salidos de
los escenarios de `specs/extension/save-link/spec.md`. Rutas relativas a `apps/extension/src/`. Para correr un solo
spec, el filtro de Vitest sobre `pnpm nx run extension:test --skip-nx-cache` (la memoria del proyecto documenta el de
`web`); el cierre de cada tarea corre el proyecto entero.

- [ ] 0.1 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos. Verificar: `design.md` lleva «Debate
  (ronda N)» con la tabla de hallazgos y «Convergencia: SI», con P0 0 y V0 0.
- [ ] 0.2 [infra] Q1 respondida por el owner y aprobación humana registradas con fecha y cita literal en `design.md`
  («Aprobación humana»), y Q2 anotada. Antes de fijar la fila, comprobar que nadie usa la 43:
  `for b in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes); do git show
  "$b:docs/design-v0.2.md" 2>/dev/null | grep -q '^| 43 |' && echo "$b"; done` sin más salida que esta rama. Si Q1 =
  (c), el change no pasa de aquí hasta archivar la 35c; si Q1 = (b), la fila 43 lo dice. Verificar: la línea
  «Aprobación humana» tiene fecha en vez de «Pendiente» y `grep -c "extension-refresh-guard" openspec-changes.yaml` = 0.

## 1. Arnés de carrera (design D5)

- [ ] 1.1 [frontend] Servidor falso y almacenamiento controlable, sin tocar código de producto. En
  `lib/testing/fake-extension-auth-server.ts` (no lo importa ningún fichero de producto): un `fetch` que implementa
  `POST /api/auth/extension/login|refresh|logout` con familias, rotación y dos modos, `noReissue` (token rotado hace
  menos de 10 s → `409 refresh_conflict`; reloj inyectado) y `reissue` (ADR-072: hermano si el sucesor no se usó,
  superado → `409`); cada respuesta de refresh se puede retener con una compuerta (`holdNextRefresh()` devuelve
  `release()`). En `lib/testing/fake-storage.ts`: el `chrome.storage.local` en memoria que hoy está dentro de
  `api.spec.ts`, más un gancho `pauseNextGet()` que toma la instantánea al llamar y retiene la resolución hasta
  `resume()`. Tests del arnés en `lib/testing/fake-extension-auth-server.spec.ts`: «rotates and returns 409 for a token
  rotated 2 seconds ago without reissue», «reissues a sibling when the successor was not used», «returns 409 for a
  sibling superseded by a used one», «holds a refresh response until released». `api.spec.ts` pasa a usar
  `fake-storage.ts`. Verificar: `pnpm nx run extension:test --skip-nx-cache` en verde (los specs existentes no
  cambian de resultado). Falsación: en el modo `reissue`, devolver `200` también a un hermano superado y ver caer «returns
  409 for a sibling superseded by a used one»; restaurar.

## 2. Compare-and-set y lock (design D1-D4)

- [ ] 2.1 [frontend] **Lock de sesión (D3).** Primero `lib/session-lock.spec.ts`: «uses navigator.locks with an
  exclusive named lock when available» (un `LockManager` falso registra `name` y `mode`), «falls back to an in-memory
  mutex without navigator.locks» (dos secciones con compuerta no se solapan: la segunda empieza cuando la primera
  termina) y «releases the lock when the section throws». Rojo esperado: el módulo no existe. Después,
  `lib/session-lock.ts` con `withSessionLock(fn)` y la fuente del lock inyectable. Verificar: el spec en verde.
  Falsación: cambiar el respaldo por `fn()` directo y ver caer «falls back to an in-memory mutex without
  navigator.locks»; restaurar.
- [ ] 2.2 [frontend] **La respuesta solo avanza desde el token presentado (D1, D2).** Primero, en
  `lib/api.refresh-race.spec.ts` (nuevo, con el arnés de 1.1 y `sleep` inyectado a cero):
  - «discards the refresh response when logout cleared the session during the flight» (escenario «Logout durante un
    refresh»: sin sesión guardada al final y el refresh rechaza con `401`);
  - «keeps a login that finished during a refresh flight» (escenario «Login durante un refresh»);
  - «keeps the used leaf when another context refreshed the same token» (modo `reissue`, dos instancias de
    `ExtensionApi` sobre el mismo almacenamiento; escenario «Otro contexto ya avanzó la sesión»);
  - «stores the sibling that arrived first and discards the later one» (modo `reissue`; escenario «El hermano llega
    primero»);
  - guardia: «recovers through 409 retries when another context refreshed the same token» (modo `noReissue`; escenario
    «Misma carrera con una API sin reemisión»).

  Correrlos sobre `main` y anotar cuáles caen: se esperan los cuatro primeros (hoy la respuesta se escribe sin
  condición); el guardia pasa ya. Después, en `lib/storage.ts` la operación condicional (p. ej.
  `compareAndSetSession(expectedRefreshToken, next)` → `{ applied, current }`, **todavía sin lock**: la 2.4 lo añade y
  necesita ver el rojo) y en `lib/api.ts` `refreshOnce` la usa con el token presentado; si no aplica, resuelve con
  `current` o rechaza con `ApiHttpError(401, 'unauthorized')`. Verificar: el spec en verde. Falsación: volver a
  `writeSession(next)` sin condición en `refreshOnce` y ver caer los cuatro primeros; restaurar.
- [ ] 2.3 [frontend] **Reintentos agotados (D2).** Primero, en `lib/api.refresh-race.spec.ts`: «does not clear a newer
  session when 409 retries are exhausted» (servidor que responde `409` siempre a R0; un login guarda L1 mientras el
  último reintento está retenido; al soltarlo, la sesión guardada sigue siendo la de L1) y, como guardia, «clears the
  session when 409 retries are exhausted on the stored token» (sin login intermedio, sesión borrada: el tope de hoy no
  cambia). Rojo esperado en el primero (hoy `clearSession()` borra sin mirar). Después, `refreshOnce` recuerda el último
  token presentado y `onRetriesExhausted` borra con la operación condicional esperando ese token. Verificar: spec en
  verde y `lib/refresh.spec.ts` sin cambios y en verde. Falsación: volver a `clearSession()` en `onRetriesExhausted` y
  ver caer el primero; quitar el borrado y ver caer el guardia; restaurar.
- [ ] 2.4 [frontend] **Todas las escrituras bajo el lock (D1, D3).** Primero, en `lib/api.refresh-race.spec.ts`:
  «serializes the compare-and-set with a concurrent login write» (con `pauseNextGet()` sobre la lectura del
  compare-and-set: mientras está retenida se lanza un login que guarda L1; al reanudar, la sesión final es la de L1;
  escenario «Comparar y escribir no se intercala con otra escritura») y, como guardia, «does not hold the session lock
  during the refresh request» (refresh retenido sin soltar; `logout()` resuelve y la sesión queda borrada; se comprueba
  con una carrera entre la promesa del logout y un `setImmediate`, sin esperar al timeout de Vitest). Rojo esperado en
  el primero sobre el código de 2.3 (compare-and-set sin lock: queda R1). Después, `compareAndSetSession`,
  `writeSession` y `clearSession` de `lib/storage.ts` corren dentro de `withSessionLock`; `readSession` no. Verificar:
  `lib/api.refresh-race.spec.ts`, `lib/api.spec.ts` y `lib/session-lock.spec.ts` en verde. Falsación: sacar del lock el
  compare-and-set y ver caer el primero; meter el `fetch` de `refreshOnce` dentro del lock y ver caer el guardia;
  restaurar.
- [ ] 2.5 [frontend] **Un solo contexto refresca (D4), guardia.** `background/single-refresher.spec.ts`: «only the
  service worker constructs ExtensionApi» recorre `apps/extension/src/**/*.ts` sin `*.spec.ts` ni `lib/testing/**` y
  exige exactamente una aparición de `new ExtensionApi(`, en `background/service-worker.ts`. Pasa ya en `main`
  (guardia). Actualizar los comentarios de `lib/api.ts`, `lib/messaging.ts` y `background/service-worker.ts` para que
  remitan al spec y al lock en vez de prometer la exclusión. Verificar: spec en verde. Falsación: añadir temporalmente
  `new ExtensionApi()` en `popup/popup.ts` y ver caer el test; restaurar.

## 3. Cierre

- [ ] 3.1 [frontend] Verificación completa. `pnpm nx run-many -t lint,typecheck,test -p extension`, `pnpm nx run
  extension:build --configuration=production`, `pnpm nx run extension:lint-firefox` (construye Firefox) y `pnpm nx
  affected -t lint,typecheck,test,i18n-check`, en verde. `git diff --stat main -- apps libs` solo muestra
  `apps/extension/**`. Sin `any` ni `console.log` nuevos (`grep -rn "console.log\|: any" apps/extension/src` sin
  resultados nuevos).
- [ ] 3.2 [frontend] Recorrido manual (Q2; no aplicable si Q2 = a). Con la pila local (`pnpm infra:up` y `nx serve
  api`), cargar `dist/apps/extension` en Chrome y `dist/apps/extension-firefox` en Firefox: login, guardar un link en
  privado, cerrar el popup, forzar un `401` sobrescribiendo `lv_ext_access_token` con un valor inválido desde la consola del
  service worker (`chrome.storage.local.set({ lv_ext_access_token: 'x' })`; borrarlo dejaría la extensión sin sesión), guardar otro link (refresca), logout y reabrir el popup (pide login). Verificar: en la
  consola del service worker no hay errores de `navigator.locks` y en `api.log` cada refresh es `200`. Anotar navegador
  y versión en el «Estado».
