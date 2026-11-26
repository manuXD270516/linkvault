## Why

El debate de `session-refresh-abort` (hallazgo H4, riesgo R6 de su design y §Consecuencias de ADR-072) dejó escrito que
la extensión «guarda cualquier token que reciba»: `apps/extension/src/lib/api.ts` (`refreshOnce`, líneas 134-147) escribe
en `chrome.storage.local` la respuesta de `POST /api/auth/extension/refresh` sin comprobar que el `refreshToken`
almacenado siga siendo el que presentó. Con la reemisión de ADR-072, quien guarda al final un hermano ya superado termina
en `409`, reintentos agotados y logout.

Leído el código de `main` (2f335cc6), la premisa literal de H4 («el popup y el service worker refrescan a la vez») **no se
da hoy**: solo `src/background/service-worker.ts` construye `ExtensionApi`, el popup habla con él por mensajes
(`lib/bridge.ts`) y el single-flight de `lib/refresh.ts` deduplica dentro de esa única instancia. Pero la escritura sin
condición sí produce carreras reales dentro del service worker, con la API de `main` y con la de ADR-072:

- **Logout durante un refresh.** `logout()` borra la sesión; la respuesta del refresh que llega después la vuelve a
  escribir. El popup muestra la sesión abierta después de cerrarla, y el access token resucitado sirve hasta 15 min
  (ADR-020 §2).
- **Login durante un refresh.** La respuesta tardía del refresh pisa la sesión recién iniciada (otra cuenta, o la misma
  tras un logout).
- **Reintentos `409` agotados.** `clearSession()` borra sin mirar qué hay guardado: puede tirar una sesión que un login
  guardó mientras tanto.
- **Un segundo contexto que refresque** (hoy ninguno; cualquier página nueva de la extensión que construya `ExtensionApi`)
  reabre la carrera de H4 tal cual: con reemisión, el último en escribir puede dejar un hermano superado.

## What Changes

- **Compare-and-set al guardar (design D1, D2).** La respuesta `200` de un refresh solo se guarda si el `refreshToken`
  almacenado sigue siendo el presentado. Si cambió, se descarta y el refresh devuelve la sesión almacenada; si ya no hay
  sesión, falla como «sin sesión» (`401`). Al agotar los reintentos `409`, la sesión se borra solo si el token guardado
  sigue siendo el último presentado.
- **Sección crítica con Web Locks (design D3).** Leer, comparar y escribir es atómico respecto de todas las escrituras de
  la sesión (login, logout, refresh), con un lock exclusivo con nombre fijo de `navigator.locks`, compartido por todos
  los contextos de la extensión. La petición de red queda **fuera** del lock: un refresh colgado no bloquea el logout.
  Sin `navigator.locks` (tests en Node 22), un mutex en memoria del módulo.
- **Un solo contexto refresca (design D4).** Guardia que falla si algo fuera de `src/background/` construye
  `ExtensionApi`, para que el requirement «NO SHALL disparar refresh concurrente desde popup y background» deje de
  depender de un comentario.
- **Correcto con las dos API (design D5).** Los tests corren contra un servidor falso con dos modos: sin reemisión
  (`main`: `409` dentro de 10 s) y con reemisión (ADR-072). El change puede fusionarse antes o después de
  `session-refresh-abort`.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `extension/save-link`: **MODIFIED** «Refresh single-flight en el cliente» (escenario nuevo: solo el service worker
  refresca) y **ADDED** «La sesión guardada solo avanza desde el token presentado».

## Impact

- **Código:** solo `apps/extension`: `src/lib/storage.ts` (compare-and-set bajo lock), `src/lib/session-lock.ts`
  (nuevo), `src/lib/api.ts` (`login`, `logout`, `refreshOnce`, `onRetriesExhausted`), specs nuevos en `src/lib/` y un
  guardia en `src/background/`. Sin permisos nuevos en el manifiesto (Web Locks no los pide).
- **Contrato de la API:** ninguno. `auth/extension-sessions` no cambia; tampoco `apps/api`, `apps/web`, `apps/worker` ni
  `libs/**`.
- **Datos, dependencias, despliegue y CI:** ninguno. El paquete de la extensión se reconstruye (Chrome y Firefox).
- **Documentación:** fila candidata 43 en `docs/design-v0.2.md` §6, fuera de `openspec-changes.yaml` como las 37-42.
- **Relación con la fila 35:** no toca despliegue, workflows ni `platform/*` (misma clase que ADR-055 §1); aplicar y
  fusionar antes de cerrar la fila lo decide el owner (Q1).
- **Relación con `session-refresh-abort` (fila 42):** independientes; ningún orden de fusión rompe nada (D5). Cierra en
  la extensión el riesgo R6 que ADR-072 dejó «para un change propio de la extensión».

## Fuera de alcance

- **Respuesta perdida porque el service worker se suspende a mitad del refresh.** El servidor rotó y el cliente se quedó
  con el token viejo; no hay escritura tardía que vigilar. Lo cubre la reemisión de ADR-072 dentro de 10 s; pasados 10 s,
  la Q2 de `session-refresh-abort` (medida en 35b).
- **Evitar el refresh sobrante** cuando una petición con un access token viejo recibe `401` después de que otro refresh
  ya terminara: rota una vez de más, pero es correcto (presenta el token guardado). Optimización sin bug.
- **Revocar en el servidor el token de una respuesta descartada.** Con reemisión, el descartado es hermano del guardado:
  un logout con él revocaría la familia entera y con ella la sesión buena. Lo descartado caduca con su TTL o queda
  superado.
- Timeouts de `fetch` en la extensión, `storage.session`, cifrado del token en reposo y cambios de la política de
  reintentos `409`.
