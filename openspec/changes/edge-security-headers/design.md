## Context

Relevamiento del 2026-10-28 sobre `main` (`5b92d28`):

| Superficie | Quién la sirve | Cabeceras de seguridad hoy |
|---|---|---|
| SPA (`/`, `/unirse`, `/grupos/…`) | Traefik → nginx de la imagen `web` | `Referrer-Policy: no-referrer` (Traefik y nginx). `nosniff` solo en las respuestas que no caen en ningún `location` con `add_header` propio: **`index.html` y los estáticos salen sin él** (nginx no hereda los `add_header` del `server` en un `location` que declara los suyos) |
| API (`/api/**`) | Traefik → Fastify | ninguna |
| Página pública (`/p/:slug`) | Traefik → Fastify | `Referrer-Policy`, `nosniff` y CSP `default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'` (ADR-027 §4) |
| Flujo SSE (`/api/events`) | Fastify, respuesta secuestrada (`reply.hijack()`) | ninguna; no pasa por los hooks `onSend` |
| Todo | Traefik | redirección `:80` → `:443` (`docker-compose.prod.yml:50-51`), sin HSTS |

Lo que el SPA necesita de verdad, inventariado sobre el código y sobre el último build de producción disponible
(`dist/apps/web/browser`, 2026-09-19; la tarea 2.3 lo repite sobre un build nuevo):

- **Scripts**: solo `<script type="module" src=…>` del mismo origen; ningún `<script>` en línea. **Pero** el build de
  producción mete, por el CSS crítico en línea (Beasties, `optimization.styles.inlineCritical`, activo por defecto),
  `<link rel="stylesheet" href="styles-….css" media="print" onload="this.media='all'">`: un manejador en línea.
- **`eval`**: el chunk de `zod` 4 sondea `new Function('')` dentro de un `try` para decidir si compila validadores.
  Bajo una CSP sin `'unsafe-eval'` no rompe nada (cae al camino sin JIT), pero el navegador **informa una violación**
  en cada carga.
- **Estilos**: un `<style>` del CSS crítico, los `<style>` que Angular inserta por componente y cuatro enlaces
  `style`/`[style.x]` en plantillas; Material escribe estilos por CSSOM (`element.style`), que la CSP no limita.
- **Orígenes externos**: ninguno. Sin fuentes externas (`styles.scss`: «sin tipografía propia ni fuentes externas»),
  sin imágenes remotas, sin `url(data:…)` en CSS ni JS del build medido, sin `iframe`. La API, el SSE y la página
  pública van al mismo origen. Los enlaces a las bolsas son navegaciones (`target="_blank"` con `noopener`), que la CSP
  no gobierna.
- **Service worker** `sw.js`: solo `push` y `notificationclick`; sin `fetch`, sin `importScripts`. La suscripción push
  habla con el servicio de push del navegador, fuera de `connect-src`.
- **Portapapeles**: «Copiar invitación», copiar el enlace público y copiar una sugerencia del encaje usan
  `navigator.clipboard.writeText` (`clipboard-write`, permitido por defecto al propio origen).
- **Descarga del plan** (`roadmap.store.ts`): `blob:` por `<a download>`, una navegación; no la limita ninguna
  directiva que usemos.
- **i18n**: `$localize` en tiempo de ejecución (`@angular/localize/init`); no evalúa código.

Restricciones heredadas:

- **ADR-053 §2**: la suite e2e local y la de CI sirven `web` con `nx serve web -c production`, **no** con la imagen y su
  nginx. Las cabeceras de nginx no existen ahí; el barrido de la tarea 7.1 las inyecta.
- **35b** (`staging-host`): PR-1 está en `main` desde el 2026-10-27 (#86); la 6.1 (secretos del destino) no se hizo
  porque el host de Oracle no existe todavía. Hasta la 6.1, un push a `main` termina en «verificado sin destino» y no
  despliega; **después de la 6.1, cada fusión a `main` despliega a staging**. El primer despliegue (6.3) relanza la
  corrida del push de PR-1, así que despliega **el commit de PR-1**; el primer despliegue por fusión es el de PR-2.
  Su `tasks.md` dice «Entre PR-1 y PR-2 no se fusiona nada a `main`» (en la práctica entraron #88, #89 y #91, tareas
  `chore` sin efecto en lo desplegado, antes de la 6.1), y la 11.6 relanza dos despliegues concretos (el de 6.3 y el
  de PR-2). PR-2 no modifica `infra/traefik/dynamic.yml`; la 6.11 de 35b comprueba `Referrer-Policy` en `/unirse` con
  `curl`. `install-config.sh` escribe `dynamic.yml` sobre el mismo inodo.
- **`e2e-suite` D15**: nada se fusiona entre el PR-2 de 35b y su 11.6.

## Goals / Non-Goals

**Goals**

- Que un XSS no pueda ejecutar script inyectado ni exfiltrar a otro origen, con una CSP **aplicada** compatible con
  Angular 22 zoneless, Material, Tailwind 4 e i18n.
- Que ninguna página de LinkVault se pueda encuadrar desde otro origen.
- HSTS en todo lo que sirve el borde, sin bloquear staging por culpa de `sslip.io`.
- Cabeceras de seguridad por defecto en la API, sin tocar las de `/p/:slug`.
- Que perder una cabecera falle en el repositorio (guardia estático), y que la política se pruebe **una vez** sobre
  todas las rutas del SPA (barrido 7.1) y **una vez en staging**, servida por nginx de verdad, antes de invitar
  (pasada de la 9.3a, que ejecuta un agente con el mismo script).
- Llegar a staging **antes de invitar** sin cambiar ninguna tarea de 35b salvo **una línea de bloqueo** en su 10.7,
  que agrega su dueño (D10).

**Non-Goals**

- Trusted Types, estilos sin `'unsafe-inline'`, informes de CSP, `preload` de HSTS, COEP/CORP (ver proposal, «Fuera de
  alcance»).
- **Un guardia dinámico de CSP en la suite e2e** (inyección en el lote 1, readmisión, falsaciones): pasa al change
  posterior de la Q3 (`nonce` y Trusted Types, después de 35c), que lo necesita igual (debate, B1).
- Cambiar políticas de caché.
- Cambiar la página pública `/p/:slug`.

## Decisions

### D1. Dónde vive cada cabecera: el borde lo que depende de TLS, la imagen lo que depende del contenido

| Cabecera | SPA | API y `/p/:slug` | Dónde |
|---|---|---|---|
| `Strict-Transport-Security` | sí | sí | **Traefik** (`edge-hsts`) |
| `Content-Security-Policy` | política del SPA (D2) | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` (D6); `/p/:slug`, la suya | **nginx** / **app** |
| `X-Frame-Options: DENY` | sí | sí | nginx / app |
| `X-Content-Type-Options: nosniff` | sí | sí | nginx / app |
| `Referrer-Policy: no-referrer` | sí (además de Traefik, que no cambia) | sí | nginx (+ Traefik) / app |
| `Permissions-Policy` | sí (D5) | no | nginx |
| `Cross-Origin-Opener-Policy: same-origin` | sí | no | nginx |

- **HSTS en Traefik** porque es quien termina TLS y el único que sabe que la respuesta va por HTTPS; ni nginx ni la API
  lo saben (detrás del proxy, por HTTP). Un solo middleware cubre SPA, API y `/p/:slug`.
- **Las cabeceras del SPA en nginx**, no en Traefik: viajan **dentro de la imagen `web`**, que es lo que se verifica y se
  publica (ADR-048); describen el contenido de esa imagen (la CSP depende del build), y un cambio de CSP no exige tocar
  `dynamic.yml`, que es configuración de 35b.
- **Las de la API en la app**: se prueban con `app.inject` en Vitest (ADR-048 §7, comprobaciones que pueden fallar),
  valen igual en local, en CI y en staging, y pueden respetar las de cada ruta (D6). En Traefik se aplicarían a ciegas
  sobre `/p/:slug`.

*Descartado:* **todo en Traefik** (un middleware `headers` por router): un solo sitio, pero la CSP del SPA quedaría
fuera de la imagen que se verifica, cada ajuste de CSP tocaría el fichero de 35b, y `/p/:slug` necesitaría un router
propio para no recibir la CSP de la API. **`@fastify/helmet`**: dependencia nueva cuyos valores por defecto incluyen
`Cross-Origin-Resource-Policy: same-origin` y una CSP pensada para HTML, más de lo que pide una API JSON; doce líneas
propias se leen y se prueban mejor.

### D2. CSP del SPA: `'self'` en todo, estilos en línea permitidos, nada más

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self';
connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self';
form-action 'self'; frame-src 'none'; frame-ancestors 'none'
```

- `script-src 'self'` **sin** `'unsafe-inline'` ni `'unsafe-eval'`: es lo que protege el token en memoria (ADR-012).
  Angular con AOT no evalúa código.
- `style-src 'unsafe-inline'`: Angular inserta un `<style>` por componente y hay enlaces `[style.x]`. Quitarlo exige
  `nonce` por respuesta (D3, alternativa) y revisar Material; la inyección de estilos sin script tiene un impacto mucho
  menor (exfiltración por selectores CSS, mitigada por `img-src`/`connect-src 'self'`). Riesgo aceptado (ADR-057 §3).
- `base-uri 'self'` y no `'none'`: `index.html` declara `<base href="/">`, y `'none'` lo bloquearía.
- `form-action 'self'`: los formularios de Angular no navegan (`ngSubmit` previene el envío), pero `'self'` evita que un
  `<form>` inyectado mande datos fuera.
- `connect-src 'self'` cubre `fetch`, `EventSource` y, en Chromium, el `ws:` del mismo origen.
- `worker-src 'self'` para `sw.js`; `manifest-src` por si llega un manifiesto; `frame-src 'none'` porque el SPA no
  encuadra nada.
- **Sin `upgrade-insecure-requests`**: HSTS ya fuerza HTTPS en producción, y en local rompería `http://localhost`.
- **Sin `report-uri`/`report-to`** (Q2).

La política vive **una sola vez**, en `docker/web/nginx.conf`. El barrido de la 7.1 la lee de ahí.

### D3. El build de `web` se ajusta a la CSP, no al revés

1. **`inlineCritical: false`** en `build.configurations.production` de `apps/web/project.json`
   (`"optimization": { "scripts": true, "styles": { "minify": true, "inlineCritical": false }, "fonts": true }`). Quita
   el `<style>` crítico y el `onload` en línea: la hoja de estilos se carga bloqueante, como cualquier SPA sin SSR.
   Coste: algo más de tiempo hasta el primer pintado, medido en la tarea 3.3 con un **umbral**: si la regresión del
   primer pintado supera **300 ms** en el perfil «Fast 4G» de Chromium, la tarea se detiene y vuelve al design (B6).
   **Cómo se mide** (V1-2, G5): Playwright con Chromium, cinco cargas por lado, cada una en un contexto nuevo con una
   sesión CDP que, **antes del `goto`**, ejecuta `Network.enable`, `Network.setCacheDisabled` y
   `Network.emulateNetworkConditions` con los valores del perfil «Fast 4G» de las DevTools (copiados de su código
   fuente, no de memoria: latencia, bajada y subida); se anotan la media y la mediana, y el umbral se aplica a la
   media. La base es el `dist` de `pnpm nx run web:build --configuration=production --skip-nx-cache` sobre el commit de
   `main` anotado en la 2.1. El dato es la entrada `first-contentful-paint` de un `PerformanceObserver` (`type: 'paint'`,
   `buffered: true`), y el servidor es el contenedor nginx de la 3.2 (no `nx serve`), una vez con el build y el
   `nginx.conf` de `main` (base) y otra con los de este change.
   Con `onload` bloqueado la página quedaría **sin estilos** (la hoja seguiría en `media="print"`), así que no es
   opcional; por eso «página sin estilos» es el primer síntoma del RUNBOOK (B4).
2. **`zod` sin JIT en el navegador**: un módulo `apps/web/src/zod-csp.ts` que ejecuta `z.config({ jitless: true })`,
   importado **en la primera línea** de `main.ts`, antes de cualquier esquema. Sin él, la sonda `new Function('')`
   dispara una violación por carga: no rompe nada, pero ensucia la señal del barrido y de la pasada de staging (D8), y una
   señal que siempre tiene ruido acaba ignorada. La API y el worker no se tocan (no tienen CSP).

*Descartado:* **`'unsafe-hashes'` con el hash de `this.media='all'`**: abre una excepción de script para mantener una
optimización. **`security.autoCsp` de Angular**: añade una CSP en `<meta>` con hashes de scripts en línea; un `<meta>`
no admite `frame-ancestors`, se combinaría con la de la cabecera por intersección y es otra fuente de verdad.
**`ngCspNonce` con `sub_filter` y `$request_id` en nginx**: permitiría quitar `'unsafe-inline'` de estilos, pero exige
reescribir `index.html` por petición y revisar todo Material; queda para el change de la Q3.

### D4. Aplicada desde el primer día, no `report-only`

`Content-Security-Policy-Report-Only` sin un destino de informes solo escribe en la consola de cada navegador: con
cinco personas invitadas, nadie lo vería. Las únicas señales que tiene este change —el barrido de la 7.1 y la pasada
de staging de la 9.3a— ven **igual** una violación con la política aplicada. Así que `report-only` costaría toda la
protección sin dar ninguna señal que la política aplicada no dé. Lo que se hace en su lugar:

- inventario del build antes de escribir la política (tarea 2.3);
- un barrido, **una vez**, de **todas** las rutas del SPA (las del lote 1 y las demás), en escritorio y en móvil
  emulado, sobre el build de producción con la política inyectada, con un control positivo que demuestra que el
  barrido ve violaciones (tareas 7.1a y 7.1b);
- una pasada del camino crítico en staging, servida por nginx y Traefik de verdad, con el mismo script **sin inyectar
  cabeceras**, en `chromium` y `firefox` de Playwright, antes de invitar (tarea 9.3a, la ejecuta un agente), que en
  `chromium` mide también el registro de `sw.js` con `notifications` concedido (B9-1); **ningún paso humano bloquea**
  la verificación de la CSP (la 9.3b se retiró);
- y una vuelta atrás escrita en el RUNBOOK (D9).

**No hay guardia dinámico permanente** en la suite: una dependencia nueva que rompa la CSP se vería en uso o en un
barrido nuevo, no en CI. Es un riesgo aceptado hasta el change de la Q3 (B1), que trae el guardia en el
lote 1 con su readmisión.

*Descartado:* **`report-only` primero con un endpoint propio de informes**: ruta anónima de escritura más, con su
límite y su almacenamiento, para un tráfico de cinco personas (Q2). **Las dos cabeceras a la vez** (aplicada + otra
`report-only` más estricta): útil cuando haya algo más estricto que probar (Trusted Types, Q3); hoy no lo hay, aunque
el guardia estático la admite (D8). **El guardia dinámico en este change**: obliga a readmitir el lote 1 (ADR-053 §6) y
choca con el PR-2 de `e2e-suite` en `critical-path.spec.ts`; el change de la Q3 lo necesita igual y lo trae (B1).

### D5. Encuadre, permisos y aislamiento de ventana

- **`frame-ancestors 'none'`** en la CSP del SPA y en la de la API, **y** `X-Frame-Options: DENY` en los dos para
  navegadores que no apliquen `frame-ancestors`. Nada de LinkVault se encuadra: ni el SPA, ni la extensión (MV3, sin
  `iframe`), ni la página pública.
- **`Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(),
  payment=(), usb=(), browsing-topics=()`**. Solo funciones que Chromium reconoce (una desconocida escribe un error en
  consola). El barrido (7.1b) recoge los mensajes de consola que nombran `Permissions-Policy`: si `browsing-topics` no
  se reconoce, se quita de `nginx.conf`, de este punto y del requirement (E10). **No** se apaga `clipboard-write` (lo
  usan cuatro botones) ni se toca nada de notificaciones (no son una función de `Permissions-Policy`).
- **`Cross-Origin-Opener-Policy: same-origin`**: una pestaña abierta por un tercero no conserva `window.opener` sobre
  LinkVault. Los enlaces salientes ya llevan `noopener`, y el SPA no usa ventanas emergentes ni `postMessage`.

### D6. API: valores por defecto en `onSend`, sin pisar los de la ruta

`apps/api/src/presentation/http/security-headers.ts` exporta `API_SECURITY_HEADERS` y
`async function securityHeadersOnSend(request, reply, payload)`, registrado en `configureApp` con
`addHook('onSend', securityHeadersOnSend)`. **Es `async`** (E4): Fastify trata un hook `onSend` no asíncrono como de
estilo *callback* y espera `done`; uno asíncrono devuelve el `payload` resuelto. Por cada cabecera: si la respuesta
**ya la tiene** (`reply.hasHeader`), no la toca. Así:

- `/p/:slug` conserva su CSP y su `Referrer-Policy` de ADR-027 y gana `X-Frame-Options: DENY` (coherente con su
  `frame-ancestors 'none'`).
- Las respuestas de error del filtro global, los `404` de Fastify, el `403`/`415` del hook CSRF de auth (que responde en
  `onRequest`, y `onSend` corre igual), los `429` y la respuesta al preflight CORS de la extensión las llevan.
- **El flujo SSE** se secuestra con `reply.hijack()` y escribe su cabecera a mano (`SSE_HEADERS`), sin pasar por
  `onSend`: `SSE_HEADERS` gana `X-Content-Type-Options: nosniff`, que es la única que le aplica a un
  `text/event-stream`. Su test afirma el literal `'nosniff'`, no la constante (E4). HSTS le llega por Traefik.
- La API **no** pone HSTS (D1).

### D7. HSTS: siete días en staging, con subdominios, sin `preload`

Middleware `edge-hsts` en `dynamic.yml` (`headers.stsSeconds: 604800`, `stsIncludeSubdomains: true`,
`stsPreload: false`), en la lista `middlewares` de `web`, `api` y `api-cv-upload`. Por qué así, con staging en
`<ip>.sslip.io`:

- **Siete días fijos** (`604800`, B3), no un año: staging es un nombre prestado y desechable; si el certificado se
  rompe, quien ya guardó la política queda bloqueada como mucho una semana. El año completo queda para el dominio
  propio (Q4). Valor **fijo**, no una rampa: cada escalón sería otra fusión que despliega durante la medición de 35b.
- **HSTS se ancla al nombre y a sus subdominios, nunca a los padres**: `includeSubDomains` sobre `<ip>.sslip.io` no
  afecta a `sslip.io` ni a otras IP. Con un dominio propio en el que `PUBLIC_HOST` sea un subdominio (`app.ejemplo.com`)
  sigue sin afectar a nada más; si alguna vez fuera el apex, se revisa (Q4).
- **El ACME de pruebas no ancla nada**: los navegadores ignoran `Strict-Transport-Security` en conexiones con errores de
  certificado, así que la fase de la 6.8 de 35b (certificado `(STAGING)`) no deja a nadie bloqueado.
- **El riesgo real es un certificado roto después**, con personas que ya guardaron la política: no podrían saltar el
  aviso durante hasta siete días. Traefik renueva 30 días antes de caducar, la 6.8 de 35b comprueba la Public Suffix
  List antes de emitir, y el ensayo de reconstrucción (9.4 de 35b) se hace antes de invitar. Ese bloqueo es además lo
  que queremos: saltar el aviso de un certificado roto es exactamente lo que HSTS existe para impedir.
- **HSTS no tiene vuelta atrás** (F2): publicar `max-age=0` solo la borra en quien vuelva a entrar por HTTPS **válido**,
  que es justo lo que falta cuando el certificado está roto. La salida es **arreglar el certificado** o **esperar**,
  como mucho los siete días del tope (B3). Por eso no hay excepción de vuelta atrás en el guardia (D8, regla 1).
- **Sin `preload`**: no se puede pedir para un nombre bajo `sslip.io`, y pedirlo para un dominio futuro es casi
  irreversible (Q4).

### D8. Verificación: estática en el repositorio; barrido único y pasada de staging para la CSP

**Estática — `tools/repo-checks`, target `check-edge-security-headers`** (inputs explícitos: `infra/traefik/dynamic.yml`,
`docker/web/nginx.conf`, `apps/web/project.json` y su propio código; ADR-048 §5). Falla, nombrando el fichero y la
línea o el router, si:

1. algún router con `websecure` no lleva `edge-hsts`; o `edge-hsts` no tiene `stsSeconds ≥ 604800` con
   `stsIncludeSubdomains: true` y sin `stsPreload: true`. **Sin excepción**: HSTS no tiene vuelta atrás (D7, F2), así
   que `stsSeconds: 0` falla como cualquier valor menor de `604800`;
2. el router `web` pierde `spa-referrer-policy` (la 6.11 de 35b depende de él);
3. el bloque `server` de `nginx.conf` no declara, con `always`, las seis cabeceras del SPA de D1; o algún `location`
   declara un `add_header` (la trampa de herencia de nginx); o `Cache-Control` lleva `always` (E3: `Cache-Control` es la
   **única** cabecera del `server` sin `always`, para que un `404` no reciba `immutable`). **Excepción de vuelta atrás
   de la CSP** (E1, F7): en lugar de `Content-Security-Policy` se admite `Content-Security-Policy-Report-Only` solo si
   `nginx.conf` contiene una línea `# csp-report-only: AAAA-MM-DD <motivo>` (fecha válida, motivo no vacío). Esa línea
   **solo vale si no hay ninguna `Content-Security-Policy` aplicada**: con la aplicada presente falla, haya o no además
   una `-Report-Only` (una excepción olvidada). Una `-Report-Only` **adicional** junto a la aplicada, **sin** la línea,
   se admite (es la pauta de la Q3);
4. la CSP de `nginx.conf` —la aplicada o, bajo la excepción, la `-Report-Only`— no tiene `frame-ancestors 'none'`, tiene
   `'unsafe-eval'`, o su `script-src` (o `default-src`, si falta `script-src`) admite `'unsafe-inline'`, `data:`,
   `blob:`, `*` o un esquema/host externo;
5. la configuración de producción de `web` no tiene `inlineCritical: false`.

**CSP — barrido único y pasada de staging** (sin guardia dinámico permanente, D4):

- **7.1a**: un script de Playwright de un solo uso (scratchpad, no queda en el repositorio) sobre la pila de la suite:
  lee los `add_header` del bloque `server` de `nginx.conf` (salvo `Cache-Control`); con `context.route` solo sobre las
  navegaciones principales (`isNavigationRequest()` y `resourceType() === 'document'`), `route.fetch()` +
  `route.fulfill()` añadiendo esas cabeceras; un `addInitScript` que acumula `securitypolicyviolation` (directiva,
  recurso bloqueado, documento, fichero y línea), que es **el criterio** de violación de CSP en los dos navegadores
  (G6); y un escuchador de consola, **de apoyo** para la CSP, que recoge «Refused to», «Content Security Policy» y
  «Content-Security-Policy» (las dos grafías, según el navegador), y «Permissions-Policy» (E10), cuyo control vale
  **solo en Chromium** (Firefox no escribe esos errores). **Control positivo** (E8): antes del barrido, en una página cualquiera, crear
  desde el DOM un `<script>` en línea (`document.createElement('script')` con `textContent`) y añadirlo; el script del
  barrido tiene que registrar **esa** violación, comparada campo por campo (F6): `effectiveDirective ===
  'script-src-elem'` (o `'script-src'`, en un navegador que no distinga las subdirectivas), `blockedURI === 'inline'` y
  `documentURI` con la ruta `/login`; si no la registra, el barrido no vale.
- **7.1b**: el barrido de **todas** las rutas de `app.routes.ts`, incluidas las del lote 1, en escritorio y en
  `Pixel 7`. La medida del push pasó a la 9.3a (B9-1).
- **9.3a** (F4, V1-1, G2): la ejecuta un **agente**. El script de la 7.1a contra staging, **sin inyectar cabeceras**
  (las sirven nginx y Traefik), con los navegadores `chromium` y `firefox` de Playwright y la cuenta `+e2e`:
  - recorre **solo los pasos que `critical-path.spec.ts` declara para el perfil `remote`** (ninguna alta) **sin el
    análisis**; la lista se toma de ese fichero en `origin/main` o, si no está, de la cabeza de la rama del PR-1 de
    `e2e-suite` (B9-3);
  - limpia la cuenta `+e2e` **al empezar y al terminar**, con los guardias de D10 de `e2e-suite` antes de borrar nada;
  - usa links en dominio reservado (`.invalid`);
  - **nunca corre a la vez que una `e2e-remote`** (comparten la cuenta), aunque puede ir el mismo día: no consume
    cupo;
  - lee la contraseña de una **variable de entorno**, nunca de un argumento, y no la escribe en la salida.

  El control positivo se repite contra staging. En `chromium`, mide además el **push** (B9-1, E8): el contexto concede
  `notifications`, se activan en `/notificaciones` y se mide que `sw.js` quede registrado
  (`navigator.serviceWorker.getRegistration()`); un fallo de `pushManager.subscribe` (sin servicio de push en el
  navegador automatizado) **no cuenta**. Así no queda ningún paso humano bloqueante en la verificación de la CSP (la
  9.3b y la 7.2 se retiraron). El resultado (commit desplegado, navegadores con versión, pasos, `sw.js`, violaciones)
  se publica como **comentario en el PR fusionado** de este change, con la hora de GitHub, y se avisa al owner **antes
  de que invite**. Se repite sobre el commit nuevo tras cada fusión de clase 1 o 3 anterior a la 10.7 (D10, G1).

**Servidor de desarrollo en el barrido**: `nx serve web -c production` puede inyectar el cliente de Vite (recarga en
vivo), un script del mismo origen con un WebSocket al mismo origen, que la política admite. La 7.1a **mide** si aparece
`@vite/client` en el documento; si una violación del barrido es atribuible al servidor de desarrollo, se anota y la
tarea vuelve al design. No se filtran violaciones por origen: un filtro así escondería las reales.

**Lo que el barrido no ve**, y se cubre una vez: nginx sirviendo de verdad (tarea 3.2, contenedor
`nginx:1.27-alpine` de un solo uso; y staging, 9.1 y 9.3a).

### D9. Vuelta atrás

Escrita en `docs/RUNBOOK.md`; el primer síntoma que se describe es **«página sin estilos»** (B4), asociado a
`inlineCritical` y al `onload` bloqueado.

- **CSP rompe algo en staging**, dos caminos:
  - **(i) Por fusión** (clase 3 de D10): en `docker/web/nginx.conf`, cambiar el nombre de la cabecera a
    `Content-Security-Policy-Report-Only` y añadir la línea `# csp-report-only: AAAA-MM-DD <motivo>` que el guardia
    estático exige (D8, regla 3). La fusión despliega, así que respeta las reglas de la clase 3. **Implica**: el SPA
    queda **sin CSP aplicada** hasta revertirlo, ningún guardia obliga a volver (la línea fechada solo lo deja visible
    en el repositorio), y el regreso a la aplicada es otra fusión de clase 3.
  - **(ii) Sin fusión, solo como puente** (F3): volver al despliegue anterior con el procedimiento de 35b (relanzar el
    job de despliegue de una corrida anterior de `main`). **Implica**: se retira el change entero de staging, HSTS
    incluido para visitas nuevas (quien ya la guardó la conserva hasta que caduque), porque `dynamic.yml` viaja con el
    commit desplegado. **Es un puente, no un estado**: la siguiente fusión a `main` volvería a desplegar la CSP
    aplicada, así que **antes de cualquier otra fusión a `main`** se aplica el camino (i). GitHub solo relanza jobs
    hasta 30 días después de la corrida inicial: pasado ese plazo, el puente es la vuelta atrás sin GitHub de 35b (en
    el host, `install-config.sh` desde el `.incoming-*` anterior y el `IMAGE_TAG` anterior, RUNBOOK «Operar staging»).
- **HSTS no tiene vuelta atrás** (D7, F2): si el certificado se rompe, se arregla el certificado; quien ya guardó la
  política espera, como mucho, los siete días del tope. No se publica `max-age=0` y el guardia no lo admite.

### D10. Coordinación con 35b: un solo fichero compartido y una línea de bloqueo en su 10.7

- **Único fichero de 35b que se toca:** `infra/traefik/dynamic.yml`, y solo para **añadir** el middleware `edge-hsts`
  y su nombre en las tres listas `middlewares`. No cambian reglas, prioridades, servicios, `spa-referrer-policy` ni los
  middlewares del CV. PR-2 de 35b no edita ese fichero (sus cambios son documentación, `infra/staging/`, ADR y fila del
  plan), así que no hay conflicto de texto; `infra/README.md`, que PR-2 sí edita, solo cambia aquí en la descripción de
  la fila de `dynamic.yml` de su tabla de ficheros.
- **Cuándo se fusiona** es la Q1 (bloqueante). Las reglas escritas que la acotan: la de 35b («entre PR-1 y PR-2 no se
  fusiona nada a `main`», y nada durante su 9.1-9.4), la D15 de `e2e-suite` (nada entre el PR-2 de 35b y su 11.6) y
  los días 7 y 14 de la medición. Con PR-1 de 35b ya en `main` (#86), **la única ventana válida sin otra excepción es
  después de la 11.6 de 35b y antes de su 10.7** (Q1 (a)).
- **Tres clases de fusión** (F1, G1). La excepción que firma el owner cubre las tres, cada una con su regla:
  1. **La fusión del change y sus correcciones antes de la 10.7 de 35b**, en la ventana (a): después de la 11.6 de 35b
     y antes de su 10.7. La medición empieza al invitar (10.7), así que los días 7 y 14 **no** pueden caer en esa
     ventana y no se nombran en ella (V2-c). **La 0.3 se repite antes de cada una** de esas fusiones, con su propio
     comentario. Cada una despliega a staging. **Después de invitar**, una corrección ya no es de clase 1: sigue las
     reglas de la clase 3.
  2. **El PR de archivo** de este change (casillas y anotaciones del grupo 9 y la 10.3). Solo toca `openspec/**` y
     `docs/**`, que `cd-staging.yml` ignora (`paths-ignore`), así que **no despliega**; sus reglas se mantienen por
     prudencia (un fichero fuera de esas rutas lo haría desplegar, y la 10.2 lo comprueba).
  3. **Las fusiones de D9**: la vuelta atrás de la CSP a `-Report-Only` (camino (i)) y el regreso a la aplicada; y las
     correcciones posteriores a invitar.

  **Toda fusión de clase 1 o 3 anterior a la 10.7 de 35b obliga a repetir la 9.1, la 9.3a y la corrida `e2e-remote`
  sobre el commit nuevo** (G1): las tres señales previas a invitar tienen que ser del commit que se va a usar. Las
  clases 2 y 3 llevan sus propias reglas: **nunca** entre el PR-2 de 35b y su 11.6, **nunca** durante su 9.1-9.4,
  **nunca** los días 7 y 14 de la medición, **nunca** el día de una corrida `e2e-remote` contra staging. La 0.3
  comprueba la ventana de cada fusión de clase 1 antes de fusionar (incluida la línea de bloqueo de la 10.7 de 35b,
  condición 5, G3); la 10.3 verifica **cada** fusión de este change en `main` contra la regla de su clase. La alternativa (d) es que el owner autorice
  expresamente una excepción a la regla «entre PR-1 y PR-2» de 35b (ver Q1).
- **Cómo se comprueba la ventana** (regla común a los changes que se fusionan junto a 35b): el PR-2 de 35b se
  identifica **por su número de PR**; el estado de la 11.6 y la 10.7 de 35b se toma de una **confirmación escrita y
  fechada del owner en el PR** de este change («11.6 hecha el AAAA-MM-DD; 10.7 no hecha»); la casilla de
  `openspec/changes/staging-host/tasks.md` (en `origin/main` o en la rama del PR de archivo de 35b) es solo apoyo y, si
  contradice la confirmación, vuelve al owner. Sin confirmación, con la 11.6 sin hacer o con la 10.7 declarada hecha:
  fuera de ventana.
- **Efecto sobre la precondición de invitar de 35b** (B2, F4, V0-1): este change **no** añade nada a la corrida
  `e2e-remote` de ADR-053 §1.3 (no hay guardia dinámico). Añade, **desde sus propias tareas**, la pasada de la 9.3a en
  staging (agente, `chromium` y `firefox` de Playwright, sin análisis, sin consumir cupo, con la medida del push en
  `chromium`), publicada en el PR fusionado y avisada al owner **antes de que invite**; ningún paso humano la bloquea. Una violación de CSP o un error de
  `Permissions-Policy` bloquea invitar hasta corregirlo o aplicar D9. Para que lo lea **quien invita**, la condición
  «9.3 de `edge-security-headers` anotada» tiene que figurar en la 10.7 de 35b. **Este change no edita 35b**: la 0.1
  pide a la sesión dueña de 35b (o al owner) que agregue esa línea de bloqueo a su 10.7, y que al cerrarla anote la
  **fecha y la hora** de invitar (G4). Es la **única** tarea de 35b que cambia, y la cambia su dueño. La 0.3 no fusiona
  sin esa línea en `origin/main` (condición 5, G3).
- **El mismo commit en las tres señales** (F4, G4): el commit de la última 9.3a, el de la corrida `e2e-remote` de la
  10.7 y el desplegado el día de invitar tienen que ser el mismo; la 10.3 lo comprueba. El desplegado ese día sale del
  estado `cd-staging/artifact` o, si la 10.7 se cierra con su alternativa manual, del **host ese día** (`docker compose
  images`). La hora del comentario de la última 9.3a (la de GitHub) tiene que ser anterior a la **hora** de invitar
  anotada en la 10.7 de 35b. Y el commit desplegado que anota la 9.1 tiene que contener la última fusión de clase 1 o
  3 anterior a la 10.7 (F5, G1).
- **35c**: añade guardias a `tools/repo-checks` y a `infra/ci/repo-checks.sh`. Este change solo añade un target y su
  entrada en el agregador de `tools/repo-checks` (conflicto de texto trivial en `project.json`, si lo hay); no toca
  `infra/ci/`.
- **`e2e-suite`** (abierto, PR-2 pendiente de staging): este change **no** toca `apps/web-e2e/**`. El barrido y la
  pasada de staging son un script de un solo uso fuera del repositorio. No hay choque con el PR-2 de `e2e-suite`.

## Casos de prueba

Derivados de los escenarios de `specs/platform/edge-security-headers/spec.md`, con el nombre que tendrán en el test.

**API** — `apps/api/src/presentation/http/security-headers.spec.ts` (unitario sobre el hook):
- «adds every default header to a response that has none»
- «does not overwrite a header the route already set»
- «resolves to the payload untouched» (el hook es `async`)

**API** — `apps/api/src/app/security-headers.int.spec.ts` (`createApp` + `app.inject`):
- «a JSON 200 carries the API security headers»
- «an unknown /api route (404) carries the API security headers»
- «the auth CSRF rejection (403) carries the API security headers»
- «a validation error (400) carries the API security headers»
- «the public page keeps its own CSP and Referrer-Policy and gains X-Frame-Options»
- «the extension CORS preflight carries the API security headers»
- «the API never sends Strict-Transport-Security»

**SSE** — `apps/api/src/infrastructure/realtime/sse-stream.spec.ts`:
- «writes nosniff in the SSE head» (afirma el literal `'nosniff'`)

**Web** — `apps/web/src/zod-csp.spec.ts`:
- «configures zod as jitless»

**Repo** — `tools/repo-checks/src/edge-security-headers.check.mjs` (falsaciones en la tarea 5.1):
- «every websecure router has edge-hsts»
- «edge-hsts is at least seven days with subdomains and without preload»
- «edge-hsts max-age 0 fails with no rollback exception»
- «the web router keeps spa-referrer-policy»
- «nginx declares the six SPA headers at server level with always»
- «Cache-Control is the only server header without always»
- «no nginx location declares add_header»
- «a Report-Only CSP requires a dated csp-report-only line»
- «a csp-report-only line with an enforced CSP fails, even with an extra Report-Only»
- «the SPA CSP forbids inline and external scripts and framing»
- «web production build disables inlineCritical»

**Barrido de un solo uso** (7.1a/7.1b, no queda en el repositorio; se anota en la tarea):
- control positivo: «a DOM-created inline script is reported as script-src-elem, blockedURI inline, on /login»
- por ruta y proyecto: «no CSP violations and no Permissions-Policy console errors»
- push: «sw.js is registered with notifications granted»

**Pasada de staging** (9.3a, mismo script sin inyección, `chromium` y `firefox`; se publica en el PR fusionado):
- «the positive control is reported against staging»
- «the batch-1 steps without analysis produce no CSP violations and no Permissions-Policy console errors» (pasos del
  perfil `remote`; `securitypolicyviolation` en los dos navegadores, `Permissions-Policy` solo en `chromium`)
- push en `chromium`: «sw.js is registered against staging with notifications granted» (B9-1)
- «the +e2e account is clean before and after the pass» (G2)

**Primer pintado** (3.3, un solo uso):
- «first-contentful-paint regression under Fast 4G is at most 300 ms»

## Risks / Trade-offs

- [Sin guardia dinámico, una dependencia nueva que rompa la CSP no falla en CI] → inventario del build (2.3), barrido
  único de todas las rutas (7.1b), pasada de staging antes de invitar (9.3a), vuelta atrás (D9) y el guardia en el
  change de la Q3 (B1). Riesgo residual aceptado: cinco personas, observadas.
- [`'unsafe-inline'` en estilos] → permite inyectar CSS si hay una inyección de HTML; sin script, sin orígenes externos
  para `img-src`/`connect-src`/`font-src`, la exfiltración por CSS queda muy limitada. Q3 para quitarlo.
- [Sin CSS crítico en línea, el primer pintado tarda más] → se mide en 3.3 (tamaño de la hoja en 2.1;
  `first-contentful-paint` con CDP en «Fast 4G» contra el nginx de la 3.2); con más de 300 ms de regresión vuelve
  como decisión (no como `'unsafe-hashes'` sin debate).
- [HSTS bloquea a quien ya la guardó si el certificado se rompe] → siete días como máximo, renovación con 30 días de
  margen, comprobación de la Public Suffix List en 35b, ensayo antes de invitar. **Sin vuelta atrás** (F2): la salida
  es arreglar el certificado o esperar (D7, D9).
- [El barrido inyecta la cabecera; no prueba nginx] → el guardia estático prueba la configuración, la tarea 3.2 la
  prueba en un nginx real una vez, y la 9.1 y la 9.3a la prueban servida en staging.
- [Una vuelta atrás a `-Report-Only` se queda olvidada] → la línea fechada la deja visible; ningún guardia obliga a
  volver (D9). Se acepta: la vuelta a la aplicada es una tarea del RUNBOOK y una fusión de clase 3 (D10).
- [El puente sin fusión (D9 (ii)) se queda como estado] → la siguiente fusión a `main` volvería a desplegar la CSP;
  por eso el camino (i) va antes de cualquier otra fusión (F3).
- [La pasada de staging bloquea invitar si hay una violación] → es la intención (D10); la salida es corregir o D9.
- [Quien invita no lee las tareas de este change] → la condición «9.3 de `edge-security-headers` anotada» la agrega a
  la 10.7 de 35b su dueño (0.1, V0-1), y el resultado de la 9.3a se avisa al owner antes de invitar.
- [La ventana (a) cae entre la 11.6 y la 10.7 de 35b, con la invitación esperando] → el PR se prepara antes, y solo su
  fusión espera la ventana; la (d) existe si el owner prefiere otra.
- [La fusión de la ventana (a) invalida una `e2e-remote` ya hecha para la 10.7] → la 0.3 lo anota y la corrida se
  repite sobre el commit desplegado; la 10.3 comprueba que los tres commits coinciden.
- [Una corrección antes de invitar deja viejas las señales de staging] → toda fusión de clase 1 o 3 anterior a la 10.7
  repite la 0.3 (si es de clase 1), la 9.1, la 9.3a y la `e2e-remote` sobre el commit nuevo (G1); la 10.3 lo comprueba.
- [La 9.3a y la `e2e-remote` se pisan la cuenta `+e2e`] → nunca corren a la vez, y la 9.3a limpia la cuenta al
  empezar y al terminar (G2).

## Migration Plan

1. Aprobación del owner de la Q1 y del design tras el debate; ADR-057 pasa a Aceptado y ADR-048 §Consecuencias gana su
   línea de excepción (tarea 0.1, 8.2).
2. Un PR con todo el código, la configuración y la documentación (grupos 1-5, 7 y 8). Se prepara en cualquier momento;
   se fusiona **solo** en la ventana que diga la Q1 (clase 1 de D10), comprobada por la 0.3: después de la 11.6 de 35b
   y antes de su 10.7 (a), o la que autorice el owner en (d).
3. Llega a staging con esa misma fusión (en (a), la 6.1 ya está hecha y cada fusión despliega).
4. Grupo 9 contra staging con ese commit desplegado, **antes de la 10.7 de 35b**: la 9.3a se publica como comentario
   en el PR fusionado y se avisa al owner antes de que invite. Sus casillas y anotaciones se marcan **en el PR de
   archivo** (clase 2 de D10: nunca entre el PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4, nunca los días 7 y 14 de
   la medición, nunca el día de una `e2e-remote`; no despliega). Cada corrección antes de la 10.7 es de clase 1: repite
   la 0.3 y obliga a repetir la 9.1, la 9.3a y la `e2e-remote` (G1). La 10.3 verifica cada fusión de este change.
5. Vuelta atrás: D9 (sus fusiones son de clase 3, como las correcciones posteriores a invitar).

## Open Questions

- **Q1 [bloqueante] — Cuándo entra respecto de 35b.** La opción anterior «fusionar antes de la 6.1» **no es válida**:
  el PR-1 de 35b está en `main` (#86) y su `tasks.md` prohíbe fusionar nada entre PR-1 y PR-2; y la D15 de
  `e2e-suite` prohíbe fusionar entre el PR-2 de 35b y su 11.6.
  - (a) **Excepción coordinada, fusión después de la 11.6 de 35b y antes de su 10.7.** Es la única ventana que no
    rompe ninguna regla escrita (la medición empieza al invitar, así que sus días 7 y 14 no caen en ella). La fusión
    despliega a staging; la corrida `e2e-remote` de la 10.7 se hace (o se repite) sobre el commit desplegado, y el
    grupo 9 de este change se cierra antes de la 10.7. La excepción que firma el owner cubre las **tres clases de
    fusión** de D10 (la del change, el PR de archivo y las de D9), cada una con su regla, y la **línea de bloqueo**
    que el dueño de 35b agrega a su 10.7 («9.3 de `edge-security-headers` anotada»).
  - (b) **Después de 35c**, sin excepción: las cinco personas usan staging durante toda la medición sin CSP, sin HSTS y
    sin protección contra encuadre, con el token en memoria.
  - (c) **Partido**: como excepción solo lo que no toca `dynamic.yml` (nginx, API, build), en la ventana de (a); HSTS
    después de 35c. Evita el único fichero compartido, a cambio de una primera visita degradable a HTTP durante la
    medición y de un segundo change.
  - (d) **El owner autoriza expresamente una excepción a la regla «entre PR-1 y PR-2» de 35b** y este change se fusiona
    **antes de la 6.1** (la fusión termina en «verificado sin destino» y no despliega). Las cabeceras llegarían a
    staging con el despliegue de PR-2. **Riesgo para la 6.3 de 35b**: si la 6.1 se hace antes de esta fusión, la
    fusión despliega **antes** de la 6.3, que deja de ser el primer despliegue (relanzaría el commit de PR-1 por
    encima de uno más nuevo, quitando las cabeceras) y su verificación pierde la premisa; además la verificación de la
    6.1 (modo de prueba sobre `main`) correría sobre un `main` que ya no es el de PR-1. La excepción se anota también
    en el `tasks.md` de 35b, junto a la regla.
  - **Recomendación: (a).** No rompe ninguna regla, el único fichero compartido se toca solo para añadir, de 35b solo
    cambia una línea de bloqueo en su 10.7 (la agrega su dueño), y nadie invitado ve staging sin cabeceras porque la ventana cierra antes de la 10.7. La respuesta se
    anota en ADR-057 §1 en una línea que empieza por «Respuesta del owner (Q1), AAAA-MM-DD:».
- **Q2 [no bloqueante] — Destino de informes de CSP.** (a) ninguno hasta tener dominio propio y observabilidad
  externa; (b) un endpoint `POST /api/csp-reports` con límite por IP y solo recuento en `/metrics`. **Recomendación:
  (a)**; el barrido y la pasada de staging cubren lo que cinco personas pueden ver.
- **Q3 [no bloqueante] — Trusted Types, estilos con `nonce` y guardia dinámico.** (a) change posterior a 35c que añada
  `nonce` por respuesta en nginx, `ngCspNonce`, quite `'unsafe-inline'` de `style-src`, pruebe `require-trusted-types-for
  'script'` primero como `report-only` adicional, y traiga el **guardia dinámico de CSP en el lote 1** de la suite e2e
  con su readmisión y sus falsaciones (lo que salió de este change por B1); (b) no hacerlo. **Recomendación: (a)**:
  la 8.2 lo agrega como candidato en el manifiesto, con la nota «trae el guardia dinámico de CSP (B1 de
  `edge-security-headers`)» (V2-d); abrirlo sigue siendo decisión del owner.
- **Q4 [no bloqueante] — HSTS con dominio propio.** Cuando haya dominio: (a) subir `stsSeconds` a un año
  (`31536000`), mantener `includeSubDomains` si `PUBLIC_HOST` es un subdominio y revisar si es el apex; pedir `preload`
  solo con el dominio entero en HTTPS; (b) quedarse en siete días y quitar `includeSubDomains`. **Recomendación:
  (a)**, como punto de la decisión del dominio (ADR-051 §Riesgos).

## Debate — iteración 1

Cierre de la iteración: critic con 1 P0 (E1-E10), business con 0 V0 (B1-B6), más un P0 de critic en otro change que
afecta a la ventana de fusión de todos. Decisiones de reflect aplicadas en proposal, design, spec, tasks y ADR-057.
La convergencia la declara la iteración 2.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| B1 | business | Aceptado (recorte): el grupo 6 entero (guardia dinámico, readmisión, falsaciones) sale del change y pasa al de la Q3; la 7.1 se extiende a las rutas del lote 1 | El change de la Q3 lo necesita igual; quita la readmisión del lote 1 y el choque con el PR-2 de `e2e-suite` en `critical-path.spec.ts` |
| B2 | business | Aceptado: la precondición de invitar no comprueba la CSP; se añade una pasada manual del camino crítico en staging (Chromium y Firefox, consola abierta), tarea 9.3, antes de la 10.7 de 35b | Sin guardia dinámico, la `e2e-remote` no ve la CSP; la pasada manual es la señal antes de invitar |
| B3 | business | Aceptado: HSTS `stsSeconds: 604800` fijo, sin `preload`; el año con el dominio propio (Q4); regla 1 del guardia, `≥ 604800` | Nombre prestado y desechable: un certificado roto bloquea como mucho una semana |
| B4 | business | Aceptado: «página sin estilos» como primer síntoma del RUNBOOK, asociado a `inlineCritical`/`onload` (8.1) | Es el fallo más probable y el más visible de la CSP |
| B5 | business | Aceptado: push activado a mano una vez en un Chromium real contra la pila (7.2) o en la 9.3 contra staging, y anotado | El navegador automatizado no tiene servicio de push |
| B6 | business | Aceptado: umbral de 300 ms de regresión del primer pintado en «Fast 4G» en la 2.1; si se supera, vuelve al design | Que la medición tenga una consecuencia |
| E1 | critic (P0) | Mitad HSTS, aceptada: excepción fechada `# hsts-rollback:` que admite `stsSeconds: 0`, falsada en la 5.1. Mitad CSP del guardia dinámico, sin objeto por B1. Vuelta atrás de la CSP escrita en ADR-057 §1.4 y D9 (cómo y qué implica), con excepción fechada simétrica `# csp-report-only:` en el guardia estático | La vuelta atrás no puede chocar con un guardia del propio change |
| E2 | critic | Sin objeto por B1 | Se refería al guardia dinámico del grupo 6 |
| E3 | critic | Aceptado: `Cache-Control` sin `always`, en el `server`; la 5.1 exime solo esa cabecera (y falla si la lleva); `expires` se quita sin condición; la 3.2 comprueba el `404` sin `immutable` y sin `Cache-Control` duplicado | Con `always`, un `404` de un `.png` heredaría `immutable` |
| E4 | critic | Aceptado: `async function securityHeadersOnSend`; el test de SSE afirma el literal `'nosniff'` | Un `onSend` no asíncrono espera `done`; comparar con la constante no prueba el valor |
| E5 | critic | Sin objeto por B1 | Se refería al guardia dinámico del grupo 6 |
| E6 | critic | Sin objeto por B1 | Se refería al guardia dinámico del grupo 6 |
| E7 | critic | Aceptado: la 4.1 arranca Traefik con los flags de `docker-compose.prod.yml` (entrypoints y resolver con el `caServer` de pruebas); la 9.1 hace un `curl -N` autenticado a `/api/events` que recibe el latido | Probar el fichero con la configuración real del borde y el flujo SSE detrás de Traefik |
| E8 | critic | Aceptado: 7.1 partida en 7.1a (script y control positivo con un `<script>` en línea creado desde el DOM) y 7.1b (barrido); push con `notifications` concedido, midiendo el registro de `sw.js`; un fallo de `subscribe` no cuenta | Un barrido sin control positivo no demuestra que vea violaciones |
| E9 | critic | Sin objeto por B1 | Se refería al guardia dinámico del grupo 6 |
| E10 | critic | Aceptado: el barrido recoge los mensajes de consola de `Permissions-Policy`; si `browsing-topics` no se reconoce, se quita | Una función desconocida escribe un error en cada carga |
| Ventana | critic (P0 de otro change) | Aceptado: Q1 reescrita; la única ventana válida es después de la 11.6 de 35b y antes de su 10.7, nunca los días 7 y 14; opción (d) con excepción expresa del owner a «entre PR-1 y PR-2»; tareas 0.3 y 10.3 verifican la ventana | PR-1 de 35b ya está en `main` (#86): «antes de la 6.1» cae entre PR-1 y PR-2, que 35b prohíbe |

## Debate — iteración 2

Cierre de la iteración: critic con 1 P0 (F1) más F2-F8 y un ajuste a E7; business con 1 V0 (V0-1) más V1-1, V1-2 y
V2-a a V2-d. Decisiones de reflect aplicadas en proposal, design, spec, tasks y ADR-057. La Q1 sigue pendiente del
owner. La convergencia la declara la iteración siguiente.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| F1 | critic (P0) | Aceptado: la excepción que firma el owner cubre tres clases de fusión (D10): 1) la del change, en la ventana (a); 2) el PR de archivo; 3) las de D9 (vuelta atrás de la CSP y regreso). Las clases 2 y 3: nunca entre el PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4, nunca los días 7 y 14, nunca el día de una `e2e-remote`. La clase 1 pierde la cláusula de los días 7 y 14. Redactado en ADR-057 §1 cond. 5, D10, Q1 (a) y la cabecera de tasks; la 10.3 verifica cada fusión de este change en `main` | La excepción solo nombraba la fusión del change; el archivo y las vueltas atrás también fusionan, y las últimas despliegan después de invitar |
| F2 | critic | Aceptado (opción preferida): sin vuelta atrás de HSTS ni excepción `# hsts-rollback:`; la salida es arreglar el certificado o esperar como mucho 7 días (B3). Simplificados el guardia (regla 1), la spec, D7, D9, ADR-057 §6 y la 5.1 | `max-age=0` solo llega a quien entra por HTTPS válido, justo lo que falta con un certificado roto |
| F3 | critic | Aceptado: en D9 y en el RUNBOOK (8.1), el camino (ii) (relanzar una corrida anterior) es solo un puente; antes de cualquier otra fusión a `main` se aplica el (i). Pasados 30 días, el puente es el `.incoming-*` del host con `install-config.sh` | La siguiente fusión volvería a desplegar la CSP aplicada; GitHub solo relanza hasta 30 días |
| F4 | critic | Aceptado junto con V0-1 y V1-1: la 9.3a la ejecuta un agente con el script de la 7.1a contra staging, sin inyectar cabeceras, en `chromium` y `firefox` de Playwright, los pasos del lote 1 sin el análisis (sin cupo; puede ir el mismo día que la `e2e-remote`); el escenario de spec deja de decir «a mano». Solo el push queda humano (9.3b, «[bloqueada: usuario]», en la misma sesión que la alternativa manual de la 10.7). El resultado se publica como comentario en el PR fusionado, con hora de GitHub, y se avisa al owner antes de invitar. La 0.3 anota si ya hubo una `e2e-remote` para la 10.7 y que se repite; la 10.3 comprueba que el commit de la 9.3a, el de esa `e2e-remote` y el desplegado al invitar son el mismo | Una pasada manual en dos navegadores competía por el cupo y por el día; el script ya existe y no depende de una persona |
| V0-1 | business (V0) | Aceptado: la condición «9.3 de `edge-security-headers` anotada» tiene que figurar en la 10.7 de 35b, que es lo que lee quien invita. Este change no edita 35b: si Q1 = (a) (y con (c) o (d), que también llegan antes de la 10.7), la 0.1 pide a la sesión dueña de 35b (o al owner) que agregue esa línea. ADR-057 §1 cond. 4 reescrita: ninguna tarea de 35b cambia salvo esa línea, que agrega su dueño | Un bloqueo escrito solo en este change no lo ve quien invita |
| V1-1 | business | Aceptado dentro de F4 | La misma corrección: la verificación previa a invitar sin cupo ni persona |
| F5 | critic | Aceptado: la 0.3 comprueba que el 9.1-9.4 de 35b esté cerrado; la 10.3 comprueba que el commit desplegado que anota la 9.1 de este change contiene la fusión | Fusionar durante el ensayo de reconstrucción lo invalida; una 9.1 sobre un commit viejo no prueba nada |
| F6 | critic | Aceptado: el control positivo compara `effectiveDirective === 'script-src-elem'` (con `script-src` como alternativa), `blockedURI === 'inline'` y el documento `/login` (D8, 7.1a, 9.3a) | «Registra una violación» admitía cualquier violación |
| F7 | critic | Aceptado: `# csp-report-only:` vale solo si no hay ninguna `Content-Security-Policy` aplicada; falsación nueva «línea + aplicada + `Report-Only` adicional → falla» (5.1) | Con una `-Report-Only` adicional, la línea olvidada pasaba |
| F8 | critic | Aceptado: la proposal («Fuera de alcance») habla del barrido único, la pasada de la 9.3a y la Q3, no de «la suite» | El texto contradecía B1 |
| E7 (ajuste) | critic | Aceptado: el `POST /api/auth/login` de la 9.1 lleva `X-Requested-With: linkvault` y `Content-Type: application/json`, con la contraseña por stdin (`--data @-`) | Sin la cabecera CSRF el login da `403`; por argumento, la contraseña queda en el historial y en la lista de procesos |
| V1-2 | business | Aceptado: el umbral de 300 ms se mide con Playwright y CDP (`Network.emulateNetworkConditions` con los valores de «Fast 4G»), `first-contentful-paint` de `PerformanceObserver`, sirviendo desde el contenedor nginx de la 3.2; la medición pasa a la 3.3, después de la 3.2 | «Medir en Chromium» no era reproducible, y `nx serve` no es lo que se sirve |
| V2-a | business | Aceptado: 7.2 retirada; el push se hace solo en la 9.3b contra staging | Una extensión de cabeceras contra la pila no aporta sobre staging |
| V2-b | business | Aceptado: 9.2 retirada; la 9.1 comprueba `frame-ancestors` y `X-Frame-Options` servidos | El navegador aplica lo que la 9.1 ya ve en las cabeceras |
| V2-c | business | Cubierto por F1 (la clase 1 no nombra los días 7 y 14) | La ventana (a) es anterior a la medición |
| V2-d | business | Aceptado: la 8.2 agrega a `openspec-changes.yaml` el candidato de la Q3 con la nota «trae el guardia dinámico de CSP (B1 de `edge-security-headers`)» | Que el riesgo aceptado por B1 tenga dueño visible en el manifiesto |
| Ventana (todos los changes) | reflect | Comprobado y aplicado: la verificación toma el estado de la 11.6 y la 10.7 de una confirmación escrita y fechada del owner en el PR (la casilla, solo apoyo); el PR-2 de 35b se identifica por su número; falsación «owner declara 10.7 hecha → fuera de ventana» (0.3) | La casilla se marca en el PR de archivo de 35b, después de los hechos; la confirmación del owner es la fuente |

## Debate — iteración 3

Cierre de la iteración (la última): critic con 1 P0 (G1) más G2-G8; business con 0 V0 y B9-1 a B9-4. Decisiones de
reflect aplicadas en proposal, design, spec, tasks y ADR-057. La Q1 sigue pendiente del owner.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| G1 | critic (P0) | Aceptado: la clase 1 pasa a ser «la del change **y sus correcciones** antes de la 10.7 de 35b», con la misma ventana y la 0.3 repetida antes de cada fusión. Toda fusión de clase 1 o 3 anterior a la 10.7 obliga a repetir la 9.1, la 9.3a y la `e2e-remote` sobre el commit nuevo. Después de invitar, una corrección sigue las reglas de la clase 3. Además: el PR de archivo (clase 2) solo toca `openspec/**` y `docs/**`, que `cd-staging.yml` ignora, así que no despliega; sus reglas se mantienen por prudencia y la 10.2 comprueba que el PR no toque nada más. Redactado en ADR-057 §1 cond. 5, D10, la cabecera de tasks, la 0.3, la 9.1, la 9.3a, la 10.2 y la 10.3 | Una corrección antes de invitar no tenía clase ni ventana, y dejaba las señales de staging sobre un commit viejo |
| G2 | critic | Aceptado: la 9.3a corre solo los pasos que `critical-path.spec.ts` declara para el perfil `remote` (sin altas), limpia la cuenta `+e2e` al empezar y al terminar (con los guardias de D10 de `e2e-suite` antes de borrar), usa links en dominio reservado, nunca corre a la vez que una `e2e-remote` y lee la contraseña de una variable de entorno, nunca de un argumento ni en la salida (D8, 9.3a) | La pasada usa la misma cuenta que la `e2e-remote` y escribe en staging durante la medición |
| B9-3 | business | Aceptado dentro de G2: los pasos se toman de `critical-path.spec.ts` en `main` o, si no está, de la cabeza de la rama del PR-1 de `e2e-suite`, anotando fichero y commit | El lote 1 puede no estar en `main` cuando corra la 9.3a |
| G3 | critic | Aceptado junto con B9-2: condición 5 de la 0.3, un `node -e` sobre el `tasks.md` de 35b de `origin/main` que encuentre `edge-security-headers` en la línea de la 10.7; sin ella, fuera de ventana; con su falsación (Falsación 4) | La línea de bloqueo la pide la 0.1, pero nada impedía fusionar sin ella |
| B9-2 | business | Aceptado dentro de G3 | La misma corrección |
| G4 | critic | Aceptado: con la alternativa manual de la 10.7, el commit desplegado el día de invitar se lee del host ese día (`docker compose images`); la 10.3 compara la hora del comentario de la última 9.3a con la **hora** de invitar, que la 0.1 pide anotar en la 10.7 de 35b (D10, 0.1, 10.3, con falsación) | Sin `cd-staging/artifact` ni hora de invitar, la comparación de commits y de orden no se podía hacer |
| G5 | critic | Aceptado: en la 2.1 la base es `pnpm nx run web:build --configuration=production --skip-nx-cache` sobre el commit de `main` anotado; en la 3.3, por cada contexto, `newCDPSession`, `Network.enable`, `setCacheDisabled` y `emulateNetworkConditions` antes del `goto`; se anota la mediana además de la media (D3, 2.1, 3.3) | Una base construida distinto o una emulación aplicada después de navegar no mide la regresión |
| G6 | critic | Aceptado: el criterio en los dos navegadores es el evento `securitypolicyviolation`; la consola es apoyo y acepta «Content Security Policy» y «Content-Security-Policy»; el control de `Permissions-Policy` vale solo en Chromium (D8, 7.1a, 7.1b, 9.3a, spec) | Firefox escribe otra grafía y no emite errores de `Permissions-Policy`: el control por consola daba un verde falso |
| G7 | critic | Aceptado: el requirement de encuadre añade «salvo bajo la vuelta atrás declarada, en la que `X-Frame-Options: DENY` lo cubre», con un escenario nuevo | En `-Report-Only`, `frame-ancestors` no se aplica, y el requirement lo exigía sin excepción |
| G8 | critic | Aceptado: la 8.1 prohíbe solo `hsts-rollback` y exige `sin vuelta atrás` y `se arregla el certificado` | Prohibir `max-age=0` impedía explicar en el RUNBOOK por qué no sirve |
| B9-1 | business | Aceptado (recorte): la medida del push de la 7.1b (`notifications` concedido, `getRegistration()` que devuelve `sw.js`) pasa a la 9.3a, contra staging en `chromium`; la 9.3b se retira conservando el número. Ajustados D4, D8, D10, ADR-057 §1 cond. 4 y §6 y la proposal: ya no queda ningún paso humano bloqueante en la verificación de la CSP | La medida automatizada contra staging cubre lo que medía el paso a mano, sin depender de una persona el día de invitar |
| B9-4 | business | Aceptado: en `proposal.md` §Impact, «2.1» pasa a «3.3» | El primer pintado se mide en la 3.3 desde la iteración 2 (V1-2) |

Convergencia: pendiente de la verificación puntual de G1 (P0 de la iteración 3)
