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
  nginx. Las cabeceras de nginx no existen ahí.
- **35b** (`staging-host`): PR-1 está en `main` desde el 2026-10-27 (#86); la 6.1 (secretos del destino) no se hizo
  porque el host de Oracle no existe todavía. Hasta la 6.1, un push a `main` termina en «verificado sin destino» y no
  despliega; **después de la 6.1, cada fusión a `main` despliega a staging**. El primer despliegue (6.3) relanza la
  corrida del push de PR-1, así que despliega **el commit de PR-1**; el primer despliegue por fusión es el de PR-2.
  Entre PR-1 y PR-2 no se fusiona nada a `main` según su `tasks.md` (en la práctica entraron #88, #89 y #91, tareas
  `chore` sin efecto en lo desplegado, antes de la 6.1). PR-2 no modifica `infra/traefik/dynamic.yml`; la 6.11 de 35b
  comprueba `Referrer-Policy` en `/unirse` con `curl`. `install-config.sh` escribe `dynamic.yml` sobre el mismo inodo.

## Goals / Non-Goals

**Goals**

- Que un XSS no pueda ejecutar script inyectado ni exfiltrar a otro origen, con una CSP **aplicada** compatible con
  Angular 22 zoneless, Material, Tailwind 4 e i18n.
- Que ninguna página de LinkVault se pueda encuadrar desde otro origen.
- HSTS en todo lo que sirve el borde, sin bloquear staging por culpa de `sslip.io`.
- Cabeceras de seguridad por defecto en la API, sin tocar las de `/p/:slug`.
- Que perder una cabecera falle en el repositorio (estático) y que una violación de CSP falle en el camino crítico
  (dinámico), en local y contra staging.
- Llegar a staging **antes de invitar** sin cambiar ninguna tarea de 35b.

**Non-Goals**

- Trusted Types, estilos sin `'unsafe-inline'`, informes de CSP, `preload` de HSTS, COEP/CORP (ver proposal, «Fuera de
  alcance»).
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

La política vive **una sola vez**, en `docker/web/nginx.conf`. La suite la lee de ahí (D8).

### D3. El build de `web` se ajusta a la CSP, no al revés

1. **`inlineCritical: false`** en `build.configurations.production` de `apps/web/project.json`
   (`"optimization": { "scripts": true, "styles": { "minify": true, "inlineCritical": false }, "fonts": true }`). Quita
   el `<style>` crítico y el `onload` en línea: la hoja de estilos se carga bloqueante, como cualquier SPA sin SSR.
   Coste: algo más de tiempo hasta el primer pintado, medido en la tarea 2.1. Con `onload` bloqueado la página
   quedaría **sin estilos** (la hoja seguiría en `media="print"`), así que no es opcional.
2. **`zod` sin JIT en el navegador**: un módulo `apps/web/src/zod-csp.ts` que ejecuta `z.config({ jitless: true })`,
   importado **en la primera línea** de `main.ts`, antes de cualquier esquema. Sin él, la sonda `new Function('')`
   dispara una violación por carga: no rompe nada, pero ensucia la señal del guardia (D8), y una señal que siempre
   tiene ruido acaba ignorada. La API y el worker no se tocan (no tienen CSP).

*Descartado:* **`'unsafe-hashes'` con el hash de `this.media='all'`**: abre una excepción de script para mantener una
optimización. **`security.autoCsp` de Angular**: añade una CSP en `<meta>` con hashes de scripts en línea; un `<meta>`
no admite `frame-ancestors`, se combinaría con la de la cabecera por intersección y es otra fuente de verdad.
**`ngCspNonce` con `sub_filter` y `$request_id` en nginx**: permitiría quitar `'unsafe-inline'` de estilos, pero exige
reescribir `index.html` por petición y revisar todo Material; queda para el change de la Q3.

### D4. Aplicada desde el primer día, no `report-only`

`Content-Security-Policy-Report-Only` sin un destino de informes solo escribe en la consola de cada navegador: con
cinco personas invitadas, nadie lo vería. Lo único que haría visible una violación es la suite (D8), y la suite la ve
**igual** con la política aplicada. Así que `report-only` costaría toda la protección sin dar ninguna señal que la
política aplicada no dé. Lo que se hace en su lugar:

- inventario del build antes de escribir la política (tarea 2.3);
- el guardia de violaciones en el camino crítico, en escritorio y en móvil emulado (D8);
- un barrido a mano, **una vez**, de cada ruta del SPA que el lote 1 no recorre, sobre el build de producción con la
  política inyectada (tarea 7.1);
- y una vuelta atrás de una línea escrita en el RUNBOOK (D9).

*Descartado:* **`report-only` primero con un endpoint propio de informes**: ruta anónima de escritura más, con su
límite y su almacenamiento, para un tráfico de cinco personas (Q2). **Las dos cabeceras a la vez** (aplicada + otra
`report-only` más estricta): útil cuando haya algo más estricto que probar (Trusted Types, Q3); hoy no lo hay.

### D5. Encuadre, permisos y aislamiento de ventana

- **`frame-ancestors 'none'`** en la CSP del SPA y en la de la API, **y** `X-Frame-Options: DENY` en los dos para
  navegadores que no apliquen `frame-ancestors`. Nada de LinkVault se encuadra: ni el SPA, ni la extensión (MV3, sin
  `iframe`), ni la página pública.
- **`Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(),
  payment=(), usb=(), browsing-topics=()`**. Solo funciones que Chromium reconoce (una desconocida escribe un error en
  consola). **No** se apaga `clipboard-write` (lo usan cuatro botones) ni se toca nada de notificaciones (no son una
  función de `Permissions-Policy`).
- **`Cross-Origin-Opener-Policy: same-origin`**: una pestaña abierta por un tercero no conserva `window.opener` sobre
  LinkVault. Los enlaces salientes ya llevan `noopener`, y el SPA no usa ventanas emergentes ni `postMessage`.

### D6. API: valores por defecto en `onSend`, sin pisar los de la ruta

`apps/api/src/presentation/http/security-headers.ts` exporta `API_SECURITY_HEADERS` y
`securityHeadersOnSend(request, reply, payload)`, registrado en `configureApp` con
`addHook('onSend', securityHeadersOnSend)`. Por cada cabecera: si la respuesta **ya la tiene** (`reply.hasHeader`), no
la toca. Así:

- `/p/:slug` conserva su CSP y su `Referrer-Policy` de ADR-027 y gana `X-Frame-Options: DENY` (coherente con su
  `frame-ancestors 'none'`).
- Las respuestas de error del filtro global, los `404` de Fastify, el `403`/`415` del hook CSRF de auth (que responde en
  `onRequest`, y `onSend` corre igual), los `429` y la respuesta al preflight CORS de la extensión las llevan.
- **El flujo SSE** se secuestra con `reply.hijack()` y escribe su cabecera a mano (`SSE_HEADERS`), sin pasar por
  `onSend`: `SSE_HEADERS` gana `X-Content-Type-Options: nosniff`, que es la única que le aplica a un
  `text/event-stream`. HSTS le llega por Traefik.
- La API **no** pone HSTS (D1).

### D7. HSTS: un año, con subdominios, sin `preload`

Middleware `edge-hsts` en `dynamic.yml` (`headers.stsSeconds: 31536000`, `stsIncludeSubdomains: true`,
`stsPreload: false`), en la lista `middlewares` de `web`, `api` y `api-cv-upload`. Por qué así, con staging en
`<ip>.sslip.io`:

- **HSTS se ancla al nombre y a sus subdominios, nunca a los padres**: `includeSubDomains` sobre `<ip>.sslip.io` no
  afecta a `sslip.io` ni a otras IP. Con un dominio propio en el que `PUBLIC_HOST` sea un subdominio (`app.ejemplo.com`)
  sigue sin afectar a nada más; si alguna vez fuera el apex, se revisa (Q4).
- **El ACME de pruebas no ancla nada**: los navegadores ignoran `Strict-Transport-Security` en conexiones con errores de
  certificado, así que la fase de la 6.8 de 35b (certificado `(STAGING)`) no deja a nadie bloqueado.
- **El riesgo real es un certificado roto después**, con personas que ya guardaron la política: no podrían saltar el
  aviso. Traefik renueva 30 días antes de caducar, la 6.8 de 35b comprueba la Public Suffix List antes de emitir, y el
  ensayo de reconstrucción (9.4) se hace antes de invitar. Ese bloqueo es además lo que queremos: saltar el aviso de un
  certificado roto es exactamente lo que HSTS existe para impedir.
- **Un año** y no una rampa (300 s → una semana → un mes): la rampa obliga a volver a tocar `dynamic.yml` dos o tres
  veces en semanas, cada una una fusión que despliega durante la medición de 35b. La vuelta atrás existe igual
  (`max-age=0`, D9).
- **Sin `preload`**: no se puede pedir para un nombre bajo `sslip.io`, y pedirlo para un dominio futuro es casi
  irreversible (Q4).

### D8. Verificación: estática en el repositorio, dinámica en el camino crítico

**Estática — `tools/repo-checks`, target `check-edge-security-headers`** (inputs explícitos: `infra/traefik/dynamic.yml`,
`docker/web/nginx.conf`, `apps/web/project.json` y su propio código; ADR-048 §5). Falla, nombrando el fichero y la
línea o el router, si:

1. algún router con `websecure` no lleva `edge-hsts`, o `edge-hsts` no tiene `stsSeconds ≥ 31536000` con
   `stsIncludeSubdomains: true` y sin `stsPreload: true`;
2. el router `web` pierde `spa-referrer-policy` (la 6.11 de 35b depende de él);
3. el bloque `server` de `nginx.conf` no declara, con `always`, las seis cabeceras del SPA de D1, o algún `location` declara un
   `add_header` (la trampa de herencia de nginx);
4. la CSP de `nginx.conf` no tiene `frame-ancestors 'none'`, tiene `'unsafe-eval'`, o su `script-src` (o
   `default-src`, si falta `script-src`) admite `'unsafe-inline'`, `data:`, `blob:`, `*` o un esquema/host externo;
5. la configuración de producción de `web` no tiene `inlineCritical: false`.

**Dinámica — guardia de CSP en el lote 1** (`apps/web-e2e/src/support/csp-guard.ts`):

- `readSpaSecurityHeaders()` lee los `add_header` del bloque `server` de `docker/web/nginx.conf` (un Vitest del
  proyecto `web-e2e` prueba el parser).
- Perfil `local`: `context.route` sobre el origen de la suite **solo para respuestas de documento** (navegación
  principal), con `route.fetch()` + `route.fulfill()` añadiendo esas cabeceras. El resto de peticiones sigue intacto.
- Perfil `remote`: **no** inyecta; exige que la cabecera CSP del documento de staging sea idéntica a la leída de
  `nginx.conf` (detecta que staging sirve otra imagen o que Traefik la pisa).
- En los dos: un script de inicio (`addInitScript`) registra `securitypolicyviolation` en una lista; los mensajes de
  consola que empiezan por «Refused to» o contienen «Content Security Policy» se recogen como red secundaria. Al final
  de cada `test.step` la lista tiene que estar vacía; si no, el fallo nombra directiva, recurso bloqueado y URL.
- Como cambia el lote 1, la admisión se repite (ADR-053 §6): `--repeat-each=5` bajo carga en los dos proyectos.

**Servidor de desarrollo en la suite**: `nx serve web -c production` puede inyectar el cliente de Vite (recarga en vivo).
Es un script del mismo origen y abre un WebSocket al mismo origen, que la política admite; la tarea 6.4 lo **mide**
(¿aparece `@vite/client` en el documento? ¿hay alguna violación atribuible?) y, solo si molesta, el runner pasa
`--live-reload=false --hmr=false` a `web:serve:production`. No se filtran violaciones por origen: un filtro así
escondería las reales.

**Lo que ninguna de las dos ve**, y se cubre a mano una vez: las rutas fuera del lote 1 (tarea 7.1) y nginx sirviendo de
verdad (tarea 3.2, contenedor `nginx:1.27-alpine` de un solo uso; y staging, grupo 9).

### D9. Vuelta atrás

Escrita en `docs/RUNBOOK.md`:

- **CSP rompe algo en staging**: en `docker/web/nginx.conf`, cambiar el nombre de la cabecera a
  `Content-Security-Policy-Report-Only` (una línea), fusionar y desplegar; o, sin esperar a una fusión, volver al
  despliegue anterior con el procedimiento de 35b (relanzar el job de despliegue de una corrida anterior). El guardia
  estático acepta `-Report-Only` solo con una línea de excepción fechada en el propio fichero (`# csp-report-only:
  AAAA-MM-DD <motivo>`), para que no quede así sin que se note.
- **HSTS**: no se puede retirar de los navegadores que ya la guardaron; se publica `max-age=0` en `edge-hsts`, que la
  borra en la siguiente visita por HTTPS válido.

### D10. Coordinación con 35b: un solo fichero compartido, ninguna tarea suya cambia

- **Único fichero de 35b que se toca:** `infra/traefik/dynamic.yml`, y solo para **añadir** el middleware `edge-hsts`
  y su nombre en las tres listas `middlewares`. No cambian reglas, prioridades, servicios, `spa-referrer-policy` ni los
  middlewares del CV. PR-2 de 35b no edita ese fichero (sus cambios son documentación, `infra/staging/`, ADR y fila del
  plan), así que no hay conflicto de texto; `infra/README.md`, que PR-2 sí edita, solo cambia aquí en la descripción de
  la fila de `dynamic.yml` de su tabla de ficheros.
- **Cuándo se fusiona** es la Q1 (bloqueante). La recomendación (a) es fusionar **antes de la 6.1 de 35b**: mientras no
  haya secretos, la fusión termina en «verificado sin destino» y no despliega; el primer despliegue (6.3) sigue
  desplegando el commit de PR-1, como manda 35b; y el primer despliegue por fusión, el de PR-2, ya lleva este change,
  así que las personas invitadas (10.7, después de PR-2) nunca ven staging sin cabeceras.
- **Respaldo de (a)** si la 6.1 llega antes que la aprobación: fusionar **después de la 11.6 de 35b y antes de la 10.7**
  (nunca entre PR-2 y su 11.6, que relanza dos despliegues concretos; nunca los días 7 y 14 de la medición), y repetir
  la corrida `e2e-remote` que es precondición de invitar, porque el commit desplegado cambia.
- **Efecto sobre la precondición de invitar de 35b** (ADR-053 §1.3): la corrida `e2e-remote` contra staging pasa a
  comprobar también la CSP (D8). Una violación en staging **bloquea invitar** hasta corregirla o aplicar D9. No se
  añade ninguna corrida contra staging (el cupo de análisis de ADR-053 no cambia): las verificaciones del grupo 9 se
  hacen con `curl` y con esa misma corrida.
- **35c**: añade guardias a `tools/repo-checks` y a `infra/ci/repo-checks.sh`. Este change solo añade un target y su
  entrada en el agregador de `tools/repo-checks` (conflicto de texto trivial en `project.json`, si lo hay); no toca
  `infra/ci/`.
- **`e2e-suite`** (abierto, PR-2 pendiente de staging): este change edita `critical-path.spec.ts` y añade
  `support/csp-guard.ts`. Si el PR-2 de `e2e-suite` toca el mismo spec, el segundo en fusionarse rebasa.

## Casos de prueba

Derivados de los escenarios de `specs/platform/edge-security-headers/spec.md`, con el nombre que tendrán en el test.

**API** — `apps/api/src/presentation/http/security-headers.spec.ts` (unitario sobre el hook):
- «adds every default header to a response that has none»
- «does not overwrite a header the route already set»
- «leaves the payload untouched»

**API** — `apps/api/src/app/security-headers.int.spec.ts` (`createApp` + `app.inject`):
- «a JSON 200 carries the API security headers»
- «an unknown /api route (404) carries the API security headers»
- «the auth CSRF rejection (403) carries the API security headers»
- «a validation error (400) carries the API security headers»
- «the public page keeps its own CSP and Referrer-Policy and gains X-Frame-Options»
- «the extension CORS preflight carries the API security headers»
- «the API never sends Strict-Transport-Security»

**SSE** — `apps/api/src/infrastructure/realtime/sse-stream.spec.ts`:
- «writes nosniff in the SSE head»

**Web** — `apps/web/src/zod-csp.spec.ts`:
- «configures zod as jitless»

**Repo** — `tools/repo-checks/src/edge-security-headers.check.mjs` (falsaciones en la tarea 5.x):
- «every websecure router has edge-hsts»
- «edge-hsts is one year with subdomains and without preload»
- «the web router keeps spa-referrer-policy»
- «nginx declares the six SPA headers at server level with always»
- «no nginx location declares add_header»
- «the SPA CSP forbids inline and external scripts and framing»
- «web production build disables inlineCritical»

**e2e** — `apps/web-e2e/src/support/csp-guard.spec.ts` (Vitest del parser) y lote 1:
- «reads the server-level headers of nginx.conf»
- «ignores add_header inside a location»
- «fails when nginx.conf has no Content-Security-Policy»
- lote 1, cada `test.step`: «no CSP violations» (local, con la política inyectada; remote, con la servida e idéntica)

## Risks / Trade-offs

- [Una ruta fuera del lote 1 necesita algo que la CSP bloquea] → inventario del build (2.3), barrido a mano de todas
  las rutas (7.1) y vuelta atrás de una línea (D9). Riesgo residual aceptado: cinco personas, observadas.
- [`'unsafe-inline'` en estilos] → permite inyectar CSS si hay una inyección de HTML; sin script, sin orígenes externos
  para `img-src`/`connect-src`/`font-src`, la exfiltración por CSS queda muy limitada. Q3 para quitarlo.
- [Sin CSS crítico en línea, el primer pintado tarda más] → se mide en 2.1 (tamaño de la hoja y tiempo en un perfil de
  red móvil de Chromium); si pasa de lo razonable, vuelve como decisión (no como `'unsafe-hashes'` sin debate).
- [HSTS bloquea a quien ya la guardó si el certificado se rompe] → renovación con 30 días de margen, comprobación de la
  Public Suffix List en 35b, ensayo antes de invitar; `max-age=0` como salida (D7, D9).
- [La suite local inyecta la cabecera; no prueba nginx] → el guardia estático prueba la configuración, la tarea 3.2 la
  prueba en un nginx real una vez y el perfil `remote` contra staging exige la cabecera servida (D8).
- [Interceptar documentos con `context.route` cambia algo del recorrido] → solo navegaciones principales; la admisión
  con `--repeat-each=5` bajo carga en los dos proyectos lo comprueba (6.5).
- [La CSP bloquea invitar si staging tiene una violación] → es la intención (D10); la salida es corregir o D9.
- [Fusionar entre PR-1 y PR-2 de 35b contradice la nota de su `tasks.md`] → por eso es una excepción del owner (Q1), y
  solo antes de la 6.1, cuando la fusión no despliega.

## Migration Plan

1. Aprobación del owner de la Q1 y del design tras el debate; ADR-057 pasa a Aceptado y ADR-048 §Consecuencias gana su
   línea de excepción (tarea 0.1, 8.2).
2. Un PR con todo el código, la configuración y la documentación (grupos 1-8). Se fusiona en la ventana que diga la Q1:
   antes de la 6.1 de 35b (recomendado) o entre su 11.6 y su 10.7.
3. Llega a staging con el primer despliegue que lo contenga (PR-2 de 35b, en el camino recomendado).
4. Grupo 9 contra staging con ese commit desplegado; sus casillas y su anotación se marcan **en el PR de archivo** (una
   fusión con solo eso no despliega nada nuevo de este change; si la 6.1 ya se hizo, se fusiona fuera de los días 7 y
   14 de la medición, como los PR de 35b).
5. Vuelta atrás: D9.

## Open Questions

- **Q1 [bloqueante] — Cuándo entra respecto de 35b.**
  - (a) **Excepción coordinada, fusión antes de la 6.1 de 35b** (secretos sin configurar: la fusión no despliega). Las
    cabeceras llegan a staging con el despliegue de PR-2, antes de invitar. Si la 6.1 se adelanta a la aprobación, el
    respaldo es fusionar **entre la 11.6 y la 10.7** de 35b, fuera de los días 7 y 14, repitiendo la corrida
    `e2e-remote` de la precondición de invitar.
  - (b) **Después de 35c**, sin excepción: las cinco personas usan staging durante toda la medición sin CSP, sin HSTS y
    sin protección contra encuadre, con el token en memoria.
  - (c) **Partido**: como excepción solo lo que no toca `dynamic.yml` (nginx, API, build, suite); HSTS después de 35c.
    Evita el único fichero compartido, a cambio de una primera visita degradable a HTTP durante la medición y de un
    segundo change.
  - **Recomendación: (a).** El único fichero compartido se toca solo para añadir, 35b no cambia ninguna tarea, y es la
    única opción en la que nadie invitado ve staging sin cabeceras. La respuesta se anota en ADR-057 §1 en una línea
    que empieza por «Respuesta del owner (Q1), AAAA-MM-DD:».
- **Q2 [no bloqueante] — Destino de informes de CSP.** (a) ninguno hasta tener dominio propio y observabilidad
  externa; (b) un endpoint `POST /api/csp-reports` con límite por IP y solo recuento en `/metrics`. **Recomendación:
  (a)**; la suite y el barrido cubren lo que cinco personas pueden ver.
- **Q3 [no bloqueante] — Trusted Types y estilos con `nonce`.** (a) change posterior a 35c que añada `nonce` por
  respuesta en nginx, `ngCspNonce`, quite `'unsafe-inline'` de `style-src` y pruebe `require-trusted-types-for
  'script'` primero como `report-only` adicional; (b) no hacerlo. **Recomendación: (a)**, como candidato en el
  manifiesto cuando el owner lo apruebe.
- **Q4 [no bloqueante] — HSTS con dominio propio.** Cuando haya dominio: (a) mantener `includeSubDomains` si
  `PUBLIC_HOST` es un subdominio y revisar si es el apex; pedir `preload` solo con el dominio entero en HTTPS; (b)
  quitar `includeSubDomains`. **Recomendación: (a)**, como punto de la decisión del dominio (ADR-051 §Riesgos).
