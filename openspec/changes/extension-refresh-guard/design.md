## Context

Origen: hallazgo H4 del crítico en el debate de `session-refresh-abort` (rama `change/session-refresh-abort`, sin
fusionar), recogido como riesgo R6 de su design, como «Fuera de alcance» de ese change y en ADR-072 §Consecuencias:
«La extensión serializa con su mutex, pero guarda cualquier token que reciba; guardar solo si el almacenado sigue siendo
el presentado queda para un change propio de la extensión».

Estado del código en `main` (2f335cc6), `apps/extension/src/`:

- `background/service-worker.ts:7` es el **único** `new ExtensionApi()`. El popup (`popup/popup.ts`) solo usa
  `lib/bridge.ts`, que manda mensajes (`GET_SESSION`, `LOGIN`, `LOGOUT`, `REFRESH`, `LIST_GROUPS`, `SAVE_LINK`) al
  service worker; importa de `lib/api.ts` solo tipos. No hay content scripts ni otras páginas.
- `lib/refresh.ts:35-48` `createSingleFlight`: una promesa en vuelo **por instancia**, en memoria. `refreshWithRetries`
  reintenta `409 refresh_conflict` 3 veces (250/500/1000 ms con jitter) y llama a `onRetriesExhausted`.
- `lib/api.ts:134-147` `refreshOnce`: lee la sesión, presenta su `refreshToken` y **escribe incondicionalmente** la
  respuesta (`writeSession`). `login` escribe sin condición; `logout` borra en `finally` sin condición;
  `onRetriesExhausted` es `clearSession()` sin condición.
- `lib/storage.ts`: cuatro claves en `chrome.storage.local`; `writeSession` es un solo `set` (las cuatro claves juntas);
  no hay operación condicional. `chrome.storage` no ofrece compare-and-set.
- Build Vite con destinos `chrome120` y `firefox121`; manifiesto MV3 con `background.service_worker` (también en
  Firefox, `scripts/lint-firefox-manifest.mjs`). Tests Vitest en entorno `node` (Node 22.23: `navigator` existe pero
  `navigator.locks` es `undefined`).

Semántica de la API que el cliente tiene que tolerar (`auth/extension-sessions` y `auth/sessions`):

- **`main`, sin reemisión:** un token rotado hace menos de 10 s responde `409 refresh_conflict` sin revocar; después, reuso
  → revocación y `401 invalid_refresh`.
- **ADR-072 (`session-refresh-abort`):** dentro de 10 s, si el sucesor no se usó, `200` con un **hermano**; el primer
  hermano usado deja a los demás superados (`409` durante 10 s, reuso después).

**La premisa de H4 corregida.** Hoy no hay dos contextos que refresquen: el single-flight del service worker ya impide
dos refresh concurrentes con el mismo token. Lo que sí está roto es que tres escrituras sin condición (refresh, logout,
reintentos agotados) compiten con otras escrituras de la sesión dentro del mismo service worker, y que la protección
contra un segundo contexto depende de un comentario («solo se instancia en el service worker»).

## Goals / Non-Goals

**Goals:**

- Ninguna respuesta de refresh pisa una sesión que cambió mientras estaba en vuelo (logout, login u otro refresh).
- Los reintentos `409` agotados no borran una sesión más nueva que la que fallaba.
- El invariante «la extensión nunca guarda un token superado» se cumple con la API de `main` y con la de ADR-072, y
  aunque un segundo contexto llegue a refrescar.
- Un único contexto refresca, comprobado por un test y no por un comentario.
- Cada arreglo empieza por un test que reproduce la carrera en `main` (rojo) y tiene su falsación.

**Non-Goals:** ver «Fuera de alcance» de `proposal.md` (respuesta perdida por suspensión del service worker, refresh
sobrante tras un `401`, revocar lo descartado, timeouts de `fetch`, cambios en la política de reintentos).

## Decisions

### D1. Compare-and-set **y** Web Locks, cada uno con su papel

Las dos opciones que dejó el debate no compiten: resuelven partes distintas.

- **El compare-and-set es la regla de corrección.** Una respuesta de refresh se guarda solo si el `refreshToken`
  almacenado sigue siendo el presentado. Esto, y no la exclusión mutua, es lo que arregla logout y login durante el
  vuelo: aunque los refresh estuvieran perfectamente serializados, el logout que borra y la respuesta que llega
  después siguen siendo dos escrituras en orden, y la segunda gana si no compara.
- **El lock hace atómico el compare-and-set.** `chrome.storage.local` no tiene operación condicional: leer, comparar y
  escribir son tres pasos asíncronos y otra escritura puede colarse entre la lectura y la escritura (un `login` cuyo
  `set` llega en ese hueco queda pisado). Hace falta exclusión mutua entre **todas** las escrituras de la sesión.
  `navigator.locks` la da dentro de un contexto y entre contextos del mismo origen (popup, service worker, cualquier
  página futura), está en los service workers de Chrome ≥ 69 y Firefox ≥ 96 (destinos del build: 120 y 121) y no pide
  permisos de manifiesto. Un mutex en memoria serviría hoy (un solo contexto), pero cuesta lo mismo y no cubre el
  segundo contexto que temía H4.

**El invariante que resulta.** Un token solo se presenta después de haberse guardado (`refreshOnce` lee la sesión
guardada) y solo se guarda reemplazando a su padre. Para que un hermano S quede superado, alguien tiene que haber
presentado otro hermano S′ del mismo padre P, y por lo anterior S′ ya estaba guardado en lugar de P. La respuesta que
trae S encuentra entonces S′ ≠ P y se descarta. La extensión nunca guarda un hermano superado, con o sin un segundo
contexto, siempre que todos escriban bajo el mismo lock.

### D2. Qué hace cada escritura

| Escritura | Regla | Bajo el lock |
| --- | --- | --- |
| Respuesta `200` de refresh | guardar solo si el almacenado == presentado; si no, descartar | sí |
| Reintentos `409` agotados | borrar solo si el almacenado == último presentado | sí |
| Login (`200`) | guardar sin condición (intención del usuario) | sí |
| Logout | borrar sin condición, después del `POST` como hoy | sí |

`storage.ts` expone una operación condicional del tipo `compareAndSetSession(expectedRefreshToken, next | null)` que
devuelve `{ applied, current }` (si aplicó y qué sesión queda guardada), y `writeSession` / `clearSession` toman el mismo
lock. El nombre exacto lo fija el implementador; el contrato está en el spec.

**Qué devuelve un refresh descartado.** La sesión guardada en ese momento (otro flujo la avanzó y es la buena: el
`authorizedJson` que esperaba reintenta con ella). Si no queda sesión (logout), rechaza con `ApiHttpError(401,
'unauthorized')`, el mismo error que «sin sesión» de `authorizedJson`, y el popup pide login. No se reintenta la red.

### D3. El lock no envuelve la petición de red

La sección crítica es leer + comparar + escribir, nunca el `fetch`. Alternativa descartada (B): lock durante el refresh
entero. Los `fetch` de la extensión no tienen timeout, así que un refresh colgado bloquearía el login y el logout bajo
el mismo lock; y tampoco bastaría, porque el logout seguiría necesitando el compare-and-set (D1). Nombre del lock fijo,
por ejemplo `linkvault-extension-session`, modo `exclusive`.

`session-lock.ts` exporta una función `withSessionLock(fn)` que usa `navigator.locks.request(name, { mode:
'exclusive' }, fn)` si existe y, si no, un mutex en memoria a nivel de módulo (cola de promesas). La fuente del lock es
inyectable para los tests. El respaldo en memoria es correcto en el caso real (un solo contexto) y es lo que corre en
Node 22.

### D4. Un solo contexto refresca: guardia por test

El requirement vigente ya dice «NO SHALL disparar refresh concurrente desde popup y background». Hoy lo sostiene un
comentario. Se añade un test que recorre `apps/extension/src/**/*.ts` (sin specs) y falla si `new ExtensionApi(` aparece
fuera de `src/background/`. Con D1 y D3, un segundo contexto ya no rompería la sesión, pero perdería la deduplicación
del single-flight (rotaciones de más, `409` y reintentos), así que el guardia sigue valiendo. Alternativa descartada:
regla `no-restricted-imports` en ESLint para `src/popup/**`; el popup importa tipos legítimos de `lib/api.ts` y la regla
tendría que distinguir `import type`, con más superficie que un test de diez líneas.

### D5. Correcto con las dos API: un servidor falso con dos modos

Los tests de carrera usan un servidor falso (`fetch` inyectado) que implementa la rotación con dos modos: `noReissue`
(`main`: token rotado < 10 s → `409`) y `reissue` (ADR-072: hermano si el sucesor no se usó; superado → `409`). Cada
respuesta se retiene con una compuerta (promesa) para fijar el intercalado sin `sleep`. Comportamiento esperado:

- **Sin reemisión.** El segundo contexto que presenta el mismo token recibe `409`, reintenta leyendo el guardado y
  termina con sesión válida. El compare-and-set no cambia nada aquí (un `409` no escribe) salvo en logout, login y
  reintentos agotados.
- **Con reemisión.** El segundo recibe un hermano: si llega primero, se guarda y el otro se descarta; si llega después,
  se descarta. En los dos órdenes, el siguiente refresh recibe `200`.

Ninguno depende de que `session-refresh-abort` esté fusionado.

### D6. Sin ADR nuevo

Es una regla local del cliente de la extensión que ADR-072 ya anticipa; no cambia contrato, almacenamiento ni
seguridad del servidor. Si `session-refresh-abort` se fusiona antes, su ADR-072 puede llevar una línea que apunte aquí
al archivar este change (no se toca desde esta rama: ADR-072 no está en `main`).

## Alternativas descartadas

- **A. Solo `navigator.locks` alrededor del refresh entero.** No arregla logout ni login durante el vuelo (D1) y
  bloquea ambos con un `fetch` colgado (D3).
- **B. Solo compare-and-set sin lock.** No es atómico sobre `chrome.storage` (D1): un `login` que escribe entre la
  lectura y la escritura queda pisado. El test de atomicidad de la tarea 2.4 lo demuestra.
- **C. Mutex en memoria en vez de Web Locks.** Correcto hoy, mismo coste, pero no cubre un segundo contexto (H4). Queda
  solo como respaldo cuando `navigator.locks` no existe.
- **D. Versión monotónica en storage (`sessionVersion`) en lugar de comparar el token.** Un dato más que mantener y
  migrar; el `refreshToken` ya identifica unívocamente el estado de la sesión.
- **E. Escuchar `storage.onChanged` para abortar el refresh en vuelo.** Más estado, y el `fetch` ya enviado rota igual
  en el servidor; no evita la escritura tardía mejor que comparar.

## Risks / Trade-offs

- **R1. Respaldo en memoria si `navigator.locks` faltara en producción.** Solo serializa dentro del contexto. Con un
  único contexto (D4) es correcto. Mitigación: los destinos del build (Chrome 120, Firefox 121) lo tienen; el test de
  la 2.1 comprueba que, si existe, se usa.
- **R2. Token descartado vivo en el servidor.** Con reemisión, un hermano descartado queda vivo hasta que el guardado se
  use (entonces queda superado) o caduque. Sin reemisión, solo se descarta tras logout (familia revocada por el logout)
  o login (el login ya deja hoy la familia anterior sin revocar). No se revoca a propósito («Fuera de alcance»).
- **R3. El refresh descartado devuelve la sesión de otra cuenta** si el login intermedio fue de otra persona. Es la
  sesión vigente y el popup ya la muestra; la petición que esperaba el refresh se reintenta con ella. Es el
  comportamiento correcto (la otra opción sería operar con un token que ya no está).
- **R4. Tests dependientes de tiempos.** Compuertas explícitas y `sleep` inyectado de la política de reintentos (`delaysMs`
  ya es inyectable); nada de temporizadores reales.

## Migration Plan

Sin migración: mismas claves de `chrome.storage.local`, mismo formato. Una sesión guardada por la versión anterior sigue
sirviendo. Rollback = revertir el commit y reconstruir la extensión.

## Debate

Pendiente (`/lv:debate`, critic/business/reflect).

## Aprobación humana

Pendiente.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`]** Precedencia: ¿se aplica y fusiona antes de cerrar la fila 35, como excepción de
  la misma clase que ADR-055 §1 (sin despliegue, workflows ni `platform/*`; solo `apps/extension`)? Opciones: (a) sí,
  en su rama y con fusión en una ventana autorizada; (b) se aplica en su rama y se fusiona después de 35c; (c) se
  aparca hasta 35c. **Recomendación: (a)**, sobre todo si `session-refresh-abort` se fusiona antes de la primera
  invitación de 35b (su Q5 = a): con reemisión, el riesgo que este change cierra pasa de teórico a posible en cuanto
  exista un segundo contexto, y el logout que resucita la sesión ya ocurre hoy.
- **Q2 [no bloqueante]** ¿Hace falta una prueba manual en Chrome y Firefox con la extensión cargada antes de fusionar?
  Opciones: (a) no: la carrera no se reproduce a mano de forma fiable; bastan los tests de carrera, `build`,
  `build-firefox` y `lint-firefox`; (b) sí, un recorrido corto login → guardar → logout en los dos navegadores para
  descartar que `navigator.locks` falle en el service worker real. **Recomendación: (b)**, recorrido de cinco minutos
  (tarea 3.2); si el owner elige (a), la 3.2 se marca como no aplicable.
