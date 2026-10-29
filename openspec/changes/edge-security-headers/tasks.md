> **Cómo leer este fichero.** Cada tarea cabe en **menos de una hora**, lleva su etiqueta y dice **qué se ejecuta**
> para darla por cerrada. Un **guardia permanente** (test, comprobación del repositorio) se rompe a mano, se ve fallar y
> se restaura (ADR-048 §7): eso es la **Falsación**. Para contar líneas o coincidencias en esta máquina se usa `node`,
> no `grep -c`, y `nx` nunca se canaliza por una tubería (se redirige a fichero).
>
> **Un PR** con los grupos 1-5, 7 y 8, que se prepara en cualquier momento. **Tres clases de fusión** (design D10, F1),
> todas cubiertas por la excepción que firma el owner:
>
> 1. **La del change**, solo en la ventana que fije la Q1, comprobada por la 0.3: (a) después de la 11.6 de 35b y antes
>    de su 10.7 (la medición empieza al invitar: sus días 7 y 14 no caen aquí); o la que autorice el owner en (d).
> 2. **El PR de archivo** (casillas y anotaciones del grupo 9 y la 10.3).
> 3. **Las de la vuelta atrás de la CSP** (design D9 (i)) y su regreso.
>
> Las clases 2 y 3: **nunca** entre el PR-2 de 35b y su 11.6, **nunca** durante su 9.1-9.4, **nunca** los días 7 y 14
> de la medición, **nunca** el día de una corrida `e2e-remote` contra staging. El grupo 9 se hace contra staging con el
> commit desplegado, **antes de la 10.7 de 35b**. La 10.3 verifica **cada** fusión de este change en `main`.
>
> **Cómo se comprueba una ventana** (regla común con los demás changes que se fusionan junto a 35b): el PR-2 de 35b se
> identifica **por su número de PR**; el estado de la 11.6 y la 10.7 de 35b se toma de una **confirmación escrita y
> fechada del owner en el PR** que se va a fusionar; la casilla de `openspec/changes/staging-host/tasks.md` es solo
> apoyo y, si la contradice, vuelve al owner.
>
> **Límites de este change** (ADR-057 §1): no se tocan `docker-compose*.yml`, `.env.example`, `infra/deploy/**`,
> `infra/ci/**`, `.github/workflows/**`, `docker/*.Dockerfile` ni `apps/web-e2e/**`; de `infra/traefik/dynamic.yml`
> solo se **añade** `edge-hsts` y su nombre en tres listas.

## 0. Antes de aplicar

- [ ] 0.1 [infra] **[bloqueada: owner — Q1]** Q1 respondida por el owner y anotada en ADR-057 §1 en una línea que
  empieza por «Respuesta del owner (Q1), AAAA-MM-DD:» con la fecha real, y en este design (sección «Open Questions»).
  Si Q1 = (b), el change no pasa de aquí hasta archivar 35c; si Q1 = (c), se retira la tarea 4.1 y la regla 1 de 5.1, y
  HSTS pasa a un change posterior; si Q1 = (d), la excepción se anota también junto a la regla «Entre PR-1 y PR-2» del
  `tasks.md` de 35b. **Línea de bloqueo en 35b** (V0-1): si Q1 = (a) —y también con (c) o (d), que llegan a staging
  antes de la 10.7—, pedir por escrito a la sesión dueña de 35b (o al owner) que agregue a la lista de bloqueos de su
  10.7 la condición «9.3 de `edge-security-headers` anotada (comentario en su PR fusionado)». **Este change no edita
  35b.** Verificar con un `node -e` que lea `docs/adr/ADR-057.md` y encuentre exactamente una línea que case con
  `^Respuesta del owner \(Q1\), \d{4}-\d{2}-\d{2}:` (hoy, cero); y, con (a), (c) o (d), con un `node -e` sobre
  `openspec/changes/staging-host/tasks.md` de `origin/main` (o de la rama donde la agregó su dueño, anotada aquí) que
  encuentre `edge-security-headers` en la línea de la 10.7.
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. Verificar:
  `design.md` lleva la sección del debate de la última iteración con «Convergencia: SI» y la fecha de la aprobación.
- [ ] 0.3 [infra] Depende de 0.1. **Guardia de la ventana de la clase 1**, **justo antes de fusionar** el PR (no al
  abrirlo). Con (a), las cuatro condiciones:
  1. con `git fetch` y `git log --first-parent --merges --format='%H %cI %s' origin/main` volcado a fichero y leído con
     `node`, el merge del PR-2 de 35b, **identificado por su número de PR**, está en `main`;
  2. el estado de la 11.6 y la 10.7 de 35b se toma de una **confirmación escrita y fechada del owner en el PR** de este
     change («11.6 hecha el AAAA-MM-DD; 10.7 no hecha»); la casilla de `openspec/changes/staging-host/tasks.md` (en
     `origin/main` o en la rama del PR de archivo de 35b), leída con `node`, es solo apoyo y, si contradice la
     confirmación, vuelve al owner;
  3. el ensayo de reconstrucción de 35b (9.1-9.4) está cerrado (F5): sus cuatro casillas marcadas en `origin/main` o
     en la rama del PR de archivo de 35b, o cerrado en la misma confirmación del owner;
  4. si ya hubo una corrida `e2e-remote` contra staging para la 10.7 de 35b, se anota su fecha y commit, y que **hay
     que repetirla** sobre el commit que despliegue esta fusión (F4).

  Sin confirmación, con la 11.6 sin hacer o con el 9.1-9.4 abierto: fuera de ventana. Con la 10.7 declarada hecha:
  fuera de ventana, vuelve al owner. Con (d): la 6.1 sin marcar y la excepción anotada en el `tasks.md` de 35b.
  Verificar con un comentario en el PR, antes de fusionar, con el número y el hash del merge del PR-2 de 35b, la
  confirmación del owner citada con su fecha, el estado del 9.1-9.4, la nota de la `e2e-remote`, la fecha de hoy y el
  resultado («en ventana» / «fuera de ventana»); si dice «fuera de ventana», no se fusiona. Falsación 1: ejecutar la
  comprobación sobre el `origin/main` del 2026-10-28 (`5b92d28`, sin el PR-2 de 35b) y ver «fuera de ventana».
  Falsación 2: con la 11.6 hecha y una confirmación del owner que declara la **10.7 hecha**, ver «fuera de ventana».
  Falsación 3: con todo en regla salvo la 9.4 de 35b sin cerrar, ver «fuera de ventana».

## 1. API (design D6)

- [ ] 1.1 [backend] `apps/api/src/presentation/http/security-headers.ts`: `API_SECURITY_HEADERS` (las cuatro de D6) y
  `export async function securityHeadersOnSend(request, reply, payload)`, que por cada cabecera la pone solo si
  `reply.hasHeader` es falso y devuelve el `payload` sin tocarlo. Sin dependencias nuevas. Verificar con
  `apps/api/src/presentation/http/security-headers.spec.ts`: «adds every default header to a response that has none»,
  «does not overwrite a header the route already set» y «resolves to the payload untouched» (con `await`). Falsación:
  quitar la comprobación de `hasHeader` y ver caer «does not overwrite a header the route already set»; restaurar.
- [ ] 1.2 [backend] Registrar el hook en `configureApp` (`create-app.ts`) con `addHook('onSend', …)` junto al de
  `authHeadersHook`, y actualizar el comentario JSDoc de `configureApp`. Verificar con
  `apps/api/src/app/security-headers.int.spec.ts` (`createApp` con la configuración de test e `inject`): «a JSON 200
  carries the API security headers», «an unknown /api route (404) carries the API security headers», «the auth CSRF
  rejection (403) carries the API security headers», «a validation error (400) carries the API security headers», «the
  extension CORS preflight carries the API security headers» (con `EXTENSION_CORS_ORIGINS` de prueba) y «the API never
  sends Strict-Transport-Security». Falsación: comentar el `addHook` y ver caer los cinco primeros; restaurar.
- [ ] 1.3 [backend] Coexistencia con la página pública (ADR-027). Verificar en el mismo fichero de integración: «the
  public page keeps its own CSP and Referrer-Policy and gains X-Frame-Options», para un `200` (link publicado) y un
  `404` (slug inexistente), comparando la CSP con `PUBLIC_PAGE_SECURITY_HEADERS` importado, no con un literal.
  Falsación: forzar en el hook la escritura incondicional y ver caer el caso (la CSP pasa a la de la API); restaurar.
- [ ] 1.4 [backend] `SSE_HEADERS` (`apps/api/src/infrastructure/realtime/sse-stream.ts`) gana
  `'X-Content-Type-Options': 'nosniff'`. Verificar con «writes nosniff in the SSE head» en `sse-stream.spec.ts` (sobre
  el doble de `SseResponse` que captura `writeHead`), que afirma el **literal** `'nosniff'`, no `SSE_HEADERS`.
  Falsación: quitar la entrada y ver caer el caso; restaurar.

## 2. Build del SPA compatible con la CSP (design D3)

- [ ] 2.1 [frontend] `apps/web/project.json`, `build.configurations.production`: `"optimization": { "scripts": true,
  "styles": { "minify": true, "inlineCritical": false }, "fonts": true }`. Verificar con `pnpm nx run web:build
  --configuration=production --skip-nx-cache` redirigido a fichero y un `node -e` sobre
  `dist/apps/web/browser/index.html`: cero `onload=`, cero `<script` sin `src`, cero `<style`, y un `<link
  rel="stylesheet"` sin `media="print"`. Anotar en esta tarea el tamaño de la hoja de estilos con y sin el cambio; el
  primer pintado se mide en la 3.3, contra nginx. Conservar en el scratchpad una copia del `dist` de `main` (base) para
  la 3.3. Falsación: cubierta por el guardia estático (5.1,
  «web production build disables inlineCritical»); y, después de 7.1a, con su script sobre `/login` y
  `inlineCritical: true`: violación de `script-src-attr` (el `onload`) y la página sin estilos; restaurar.
- [ ] 2.2 [frontend] `apps/web/src/zod-csp.ts` con `z.config({ jitless: true })` y `import './zod-csp';` como **primera
  línea** de `apps/web/src/main.ts`, con un comentario que remita a ADR-057. Verificar con
  `apps/web/src/zod-csp.spec.ts`: «configures zod as jitless» (importa el módulo y lee `z.config().jitless`) y con un
  `node -e` que compruebe que la primera sentencia de `main.ts` es ese `import`. Falsación (después de 7.1a): retirar el
  `import` de `main.ts`, reconstruir y ver con el script de 7.1a, en `/login` tras un envío que valide con zod, la
  violación de `script-src` por `eval`; restaurar.
- [ ] 2.3 [frontend] Inventario del build de 2.1, anotado en esta tarea: un `node` de un solo uso (scratchpad) que
  recorra `dist/apps/web/browser/*.{js,css}` y cuente `url(data:`, `data:image`, `new Function`, `eval(`, `http://` y
  `https://` (con el contexto de cada aparición), y liste las URL absolutas encontradas. Cada aparición se clasifica:
  inocua (texto, comentario de licencia, sonda en `try` ya resuelta por 2.2) o **necesita la política**; si alguna la
  necesita, la tarea **se detiene** y vuelve al design como decisión (no se añade una fuente a la CSP sin debate).

## 3. Cabeceras del SPA en nginx (design D1, D2, D5)

- [ ] 3.1 [infra] `docker/web/nginx.conf`: un `map $uri $lv_cache_control` en el nivel del fichero (dentro de `http`,
  donde lo incluye `conf.d/default.conf`) que reproduce los valores de hoy (`/index.html` → `no-cache`; estáticos por
  extensión → `public, max-age=604800, immutable`; resto → vacío). En el bloque `server`, con `always`, las seis
  cabeceras del SPA de D1 con los valores de D2 y D5, y `add_header Cache-Control $lv_cache_control;` **sin `always`**
  (E3: así una respuesta de error no lleva `immutable`). **Ningún `add_header` dentro de un `location`**; se conserva el
  `try_files` y se **quita `expires`** sin condición (su `Cache-Control` duplicaría el del `map`). Comentario de cabecera
  que remite a ADR-057 y explica la trampa de herencia de `add_header` y por qué `Cache-Control` va sin `always`.
  Verificar con 3.2 y con el guardia de 5.1.
- [ ] 3.2 [infra] Prueba de un solo uso en un nginx real (scratchpad, no queda en el repositorio):
  `docker run --rm -d -p 18080:80 -v <conf>:/etc/nginx/conf.d/default.conf:ro -v <dist>:/usr/share/nginx/html:ro
  nginx:1.27-alpine` con el `dist` de 2.1, `nginx -t` en el contenedor, y `curl -sSI` a `/`, `/index.html`, `/grupos/x`,
  un `.js` con hash, `/sw.js` y `/no-existe.png`, volcado a fichero y leído con `node`: las seis cabeceras en las seis
  respuestas; `Cache-Control: no-cache` en `index.html` y en el fallback; `public, max-age=604800, immutable` en el
  `.js` y en `sw.js` (como hoy); el `404` con las seis cabeceras y **sin `immutable`**; y **como mucho una** línea
  `Cache-Control` y ninguna `Expires` en cada respuesta (E3). Apagar el contenedor. Anotar la salida resumida.
  Falsación: mover el `add_header` de CSP a un `location` en la copia, ver desaparecer la cabecera en ese tipo de
  respuesta, y restaurar; y, aparte, poner `always` en `Cache-Control` en la copia y ver `immutable` en el `404`.
- [ ] 3.3 [frontend] Depende de 2.1 y 3.2. **Primer pintado contra nginx** (B6, V1-2), con un script de Playwright de
  un solo uso (scratchpad): el contenedor de la 3.2 sirve primero el `dist` de `main` con el `nginx.conf` de `main`
  (base) y después el `dist` de 2.1 con el `nginx.conf` de 3.1; por cada uno, Chromium con una sesión CDP
  (`context.newCDPSession(page)`) que ejecuta `Network.enable`, `Network.setCacheDisabled({ cacheDisabled: true })` y
  `Network.emulateNetworkConditions` con los valores del perfil «Fast 4G» de las DevTools (latencia, bajada y subida,
  **copiados del código fuente de las DevTools** con su enlace anotado, no de memoria), cinco cargas de `/login` en
  contextos nuevos, y en cada una la entrada `first-contentful-paint` leída con un `PerformanceObserver` (`type:
  'paint'`, `buffered: true`). Verificar con la salida volcada a fichero y leída con `node`: las diez medidas, la media
  de cada lado y la regresión. **Umbral**: si la regresión media supera **300 ms**, la tarea se detiene y vuelve al
  design. Anotar valores del perfil, medidas y resultado. Apagar el contenedor.

## 4. HSTS en el borde (design D7, D10)

- [ ] 4.1 [infra] `infra/traefik/dynamic.yml`: middleware `edge-hsts` (`headers.stsSeconds: 604800`,
  `stsIncludeSubdomains: true`, `stsPreload: false`) y su nombre **añadido** a `middlewares` de `web`, `api` y
  `api-cv-upload` (en `api`, la lista se crea); comentario de cabecera ampliado con «HSTS (ADR-057): siete días
  mientras el nombre sea `<ip>.sslip.io`; el año con el dominio propio (Q4); sin vuelta atrás: si el certificado se
  rompe, se arregla el certificado (design D7)». Nada más del fichero cambia. Verificar con un `node -e` que parsee el fichero antes y después con
  el `yaml` del repositorio y compare: solo difieren `http.middlewares.edge-hsts` y las tres listas `middlewares`, y
  `spa-referrer-policy` sigue igual. Y arrancar `traefik:v3.3.5` con **los flags del servicio `traefik` de
  `docker-compose.prod.yml` copiados de ese fichero** (no de memoria: proveedor de fichero, entrypoints `web` y
  `websecure` con la redirección, resolver `letsencrypt` con almacenamiento en un directorio temporal y
  `acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory`, `httpchallenge`), `-e PUBLIC_HOST=` un nombre
  de prueba y `--log.level=DEBUG`, unos segundos, volcado a fichero y leído con `node`: ningún error del proveedor de
  ficheros ni de middlewares o routers (el error ACME del nombre de prueba es esperado y no cuenta). Falsación:
  cubierta por 5.1.

## 5. Guardia estático (design D8)

- [ ] 5.1 [infra] `tools/repo-checks/src/edge-security-headers.check.mjs` con las cinco reglas de D8, incluida la única
  excepción fechada (`# csp-report-only:` en `nginx.conf`, válida solo sin ninguna `Content-Security-Policy` aplicada;
  HSTS **no** tiene excepción, F2) y la exención de `always` solo para `Cache-Control`, con mensajes que nombran
  fichero, router, `location` o directiva.
  Reutiliza `src/lib/report.mjs`. Verificar con `node tools/repo-checks/src/edge-security-headers.check.mjs` en verde
  sobre el árbol. Falsación, una por caso, cada una sobre el árbol de trabajo y restaurada con `git checkout --` antes de
  la siguiente; cada una sale ≠0 nombrando lo roto, salvo las marcadas «pasa»:
  - quitar `edge-hsts` de `api-cv-upload` («every websecure router has edge-hsts»);
  - `stsPreload: true`, y aparte `stsSeconds: 300` («edge-hsts is at least seven days with subdomains and without
    preload»);
  - `stsSeconds: 0`, también con un comentario `# hsts-rollback: 2026-10-28 prueba` en el fichero → falla («edge-hsts
    max-age 0 fails with no rollback exception»);
  - quitar `spa-referrer-policy` de `web` («the web router keeps spa-referrer-policy»);
  - quitar `always` de `X-Frame-Options` («nginx declares the six SPA headers at server level with always»);
  - poner `always` en `Cache-Control` («Cache-Control is the only server header without always»);
  - un `add_header` dentro de `location /` («no nginx location declares add_header»);
  - renombrar la cabecera a `Content-Security-Policy-Report-Only` sin línea → falla; con `# csp-report-only:
    2026-10-28 prueba` → **pasa**; la línea con la cabecera aplicada → falla («a Report-Only CSP requires a dated
    csp-report-only line»);
  - la línea `# csp-report-only:` con la cabecera aplicada **y** una `Content-Security-Policy-Report-Only` adicional →
    falla (F7); y, aparte, la aplicada con una `-Report-Only` adicional **sin** la línea → **pasa** («a csp-report-only
    line with an enforced CSP fails, even with an extra Report-Only»);
  - `'unsafe-inline'` en `script-src` y, aparte, quitar `frame-ancestors` («the SPA CSP forbids inline and external
    scripts and framing»);
  - `inlineCritical: true` («web production build disables inlineCritical»).
- [ ] 5.2 [infra] Target `check-edge-security-headers` en `tools/repo-checks/project.json` con `cache: true` e
  **inputs explícitos** (`infra/traefik/dynamic.yml`, `docker/web/nginx.conf`, `apps/web/project.json`, el `.check.mjs`
  y `src/lib/report.mjs`), y su entrada en el `dependsOn` del agregador `check`. Verificar con `bash
  infra/ci/repo-checks.sh` redirigido a fichero y leído con `node`: una comprobación más que antes, todas en verde.
  Falsación: dejar el target fuera del `dependsOn` y ver fallar el agregador (`aggregate.mjs`) nombrándolo; restaurar.
  Segunda falsación (caché): con el target en verde, cambiar `stsSeconds` a `300` en `dynamic.yml` y comprobar que
  `pnpm nx run repo-checks:check-edge-security-headers` **se ejecuta** (no `[local cache]`) y falla; restaurar.

## 6. (Retirado en la iteración 1 del debate)

El guardia dinámico de CSP en el lote 1 de la suite e2e, su readmisión y sus falsaciones salieron de este change (B1)
y pasan al change posterior de la Q3. Este change no toca `apps/web-e2e/**`. La numeración de los grupos se conserva.

## 7. Barrido de todas las rutas del SPA (design D4, D8)

- [ ] 7.1a [frontend] Script de Playwright de un solo uso (scratchpad, no queda en el repositorio) sobre la pila de la
  suite (`pnpm nx run web-e2e:e2e-stack` con la pila conservada, redirigido a fichero), como describe D8: lee los
  `add_header` del bloque `server` de `docker/web/nginx.conf` salvo `Cache-Control`; `context.route` solo sobre
  navegaciones principales con `route.fetch()` + `route.fulfill()` añadiéndolas (el resto, `route.fallback()`);
  `addInitScript` que acumula `securitypolicyviolation`; escuchador de consola que recoge «Refused to», «Content
  Security Policy» y «Permissions-Policy». Mide si el documento contiene `@vite/client` y lo anota. **Control positivo**
  (E8): en `/login`, crear desde el DOM un `<script>` en línea (`document.createElement('script')`, `textContent`,
  `appendChild`); verificar con la salida volcada a fichero y leída con `node` que el script registra exactamente esa
  violación (F6): `effectiveDirective === 'script-src-elem'` (o `'script-src'` como alternativa), `blockedURI ===
  'inline'` y `documentURI` cuya ruta es `/login`. Si no la registra, el script no vale y no se pasa a 7.1b. El script
  admite un modo **sin inyección** (`--no-inject`) y una URL base, que usa la 9.3a contra staging.
- [ ] 7.1b [frontend] Con el script de 7.1a y una cuenta creada por la interfaz, visitar en escritorio y en `Pixel 7`
  **cada ruta de `apps/web/src/app/app.routes.ts`**, las del lote 1 incluidas: `/login`, `/registro`,
  `/recuperar-contrasena`, `/restablecer-contrasena`, `/verificar-email`, `/privacidad`, `/oferta/:slug` (con un link
  publicado), `/grupos`, `/grupos/:id`, `/unirse`, `/mis-links`, `/postulaciones`, `/buscar`, `/descubrir`, `/mi-cv`,
  `/plan/:analysisId` (si el mock lo produce), `/perfil` (incluida la bóveda BYOK si está visible) y `/notificaciones`;
  y abrir en cada una el diálogo o menú principal. Push (E8): el contexto concede `notifications`; en `/notificaciones`
  se activa y se mide que `navigator.serviceWorker.getRegistration()` devuelve el registro de `sw.js`; un fallo de
  `pushManager.subscribe` no cuenta. Verificar con la lista de violaciones y de mensajes de consola volcada a fichero y
  leída con `node`: cero violaciones y cero errores de `Permissions-Policy`, y `sw.js` registrado. Si `browsing-topics`
  aparece como no reconocida (E10), se quita de `nginx.conf`, de D5 y del requirement, y se repite la ruta. Cualquier
  otra violación detiene la tarea y vuelve al design (como en 2.3); una atribuible al servidor de desarrollo, también.
  Anotar rutas, proyectos y resultado.
- 7.2 (retirada en la iteración 2 del debate, V2-a: el push a mano se hace solo contra staging, en la 9.3b; se
  conserva el número.)

## 8. Documentación y ADR

- [ ] 8.1 [infra] `docs/RUNBOOK.md`: sección nueva «Paso 6 septendecies — Cabeceras de seguridad del borde
  (edge-security-headers / ADR-057)», insertada **antes** de «Paso 6 sexdecies» (que es de 35b), con: qué cabecera
  vive dónde (tabla de D1); cómo comprobarlas con `curl -sSI`; **síntomas, empezando por «página sin estilos»** (B4),
  asociado a `inlineCritical` y al `onload` bloqueado; la vuelta atrás de D9 con sus dos caminos y lo que implica cada
  uno: (i) CSP a `-Report-Only` con su línea `# csp-report-only:`, una fusión de clase 3 con sus reglas (nunca entre el
  PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4, nunca los días 7 y 14, nunca el día de una `e2e-remote`); (ii)
  despliegue anterior **solo como puente** (F3): antes de cualquier otra fusión a `main` se aplica el (i), y pasados 30
  días el puente es el `.incoming-*` anterior en el host con `install-config.sh` (remitiendo a «Operar staging» de
  35b). **HSTS sin vuelta atrás** (F2): si el certificado se rompe, se arregla; quien ya la guardó espera como mucho
  siete días. `infra/README.md`: la descripción de la fila de `infra/traefik/dynamic.yml` añade «HSTS (`edge-hsts`)».
  Verificar con un `node -e` que encuentre el encabezado nuevo antes de «Paso 6 sexdecies», en la sección las cadenas
  `página sin estilos`, `inlineCritical`, `Report-Only`, `csp-report-only`, `puente`, `.incoming-`, `30 días`,
  `sin vuelta atrás` y `edge-hsts`, con `página sin estilos` antes que las otras, **ninguna** `hsts-rollback` ni
  `max-age=0`, y `edge-hsts` en la fila de `infra/README.md`.
- [ ] 8.2 [infra] Tras la aprobación: ADR-057 pasa a «Aceptado» con la fecha; ADR-048 §Consecuencias gana su línea
  «· **Excepción de ADR-057 (AAAA-MM-DD), por decisión del owner.** …» tras la de ADR-055; `docs/design-v0.2.md` §6 gana
  la fila «∥ 35b `edge-security-headers`»; la nota de la fila de `openspec-changes.yaml` pasa de «propuesto» a la
  decisión con su fecha; y `openspec-changes.yaml` gana el **candidato de la Q3** (`nonce`, Trusted Types y guardia
  dinámico, después de 35c), marcado como propuesto y pendiente del owner, con la nota «trae el guardia dinámico de
  CSP (B1 de `edge-security-headers`)» (V2-d). Verificar con un `node -e` que encuentre las cinco cosas.

## 9. Staging (bloqueado por el primer despliegue que contenga este change; todo antes de la 10.7 de 35b)

- [ ] 9.1 [infra] **[bloqueada: despliegue a staging de un commit con este change]** Con `curl -sSI` (sin `-k`) a
  `https://<nombre>/`, `/unirse?codigo=PRUEBA`, `/grupos/x`, un `.js` con hash, `/sw.js`, `/api/health` (debe dar el
  `404` de la API: `/health` no es público), una ruta `GET /api/…` sin sesión (`401`) y `/p/<slug-inexistente>`,
  volcado a fichero y leído con `node`: HSTS `max-age=604800; includeSubDomains` sin `preload` en todas; las seis del
  SPA en las cinco primeras, idénticas a `nginx.conf` (con `frame-ancestors 'none'` y `X-Frame-Options: DENY`, que
  cubren el encuadre: la 9.2 se retiró, V2-b); las cuatro de la API en las de API; la CSP de ADR-027 y
  `X-Frame-Options: DENY` en `/p/`; `Referrer-Policy` en `/unirse` (la 6.11 de 35b sigue valiendo). Y el flujo SSE
  detrás de Traefik (E7): con un access token obtenido por `POST /api/auth/login` con la cuenta `+e2e`, con las
  cabeceras `X-Requested-With: linkvault` y `Content-Type: application/json` y el cuerpo **por stdin** (`curl … --data
  @-`, la contraseña nunca en un argumento, en un fichero ni en la salida; el token, solo en una variable), `curl -N -sS
  -D <cabeceras> --max-time 40 -H "Authorization: Bearer …" https://<nombre>/api/events`: la cabecera lleva `nosniff`
  y HSTS, y el cuerpo recibe al menos un latido (intervalo `SSE_HEARTBEAT_INTERVAL_MS`, 25 s). Anotar el commit
  desplegado (del host o del estado `cd-staging/artifact`) y comprobar con `git merge-base --is-ancestor <merge de este
  change> <commit desplegado>` que lo contiene (F5); si no, la tarea no vale.
- 9.2 (retirada en la iteración 2 del debate, V2-b: la 9.1 ya comprueba `frame-ancestors` y `X-Frame-Options`
  servidos; se conserva el número.)
- [ ] 9.3a [infra] **[bloqueada: 9.1; antes de la 10.7 de 35b]** **Pasada de staging, la ejecuta un agente** (B2, F4,
  V1-1): el script de la 7.1a con `--no-inject` y la URL de staging (las cabeceras las sirven nginx y Traefik), con los
  navegadores `chromium` y `firefox` de Playwright y la cuenta `+e2e`: primero el control positivo de la 7.1a contra
  staging (la misma comparación de F6), y después los pasos del lote 1 (`critical-path.spec.ts`) **sin el análisis**.
  No consume cupo, así que puede ir el mismo día que la corrida `e2e-remote` de la 10.7 de 35b. Verificar con la salida
  volcada a fichero y leída con `node`, por navegador: versión, commit desplegado (el de la 9.1), control positivo
  registrado, cada paso, y cero violaciones de CSP y cero errores de `Permissions-Policy`. El resultado se publica como
  **comentario en el PR fusionado** de este change (la hora la pone GitHub) y se **avisa al owner antes de que
  invite**. Una violación **bloquea invitar** hasta corregirla o aplicar D9.
- [ ] 9.3b [infra] **[bloqueada: usuario — en la misma sesión que la alternativa manual de la 10.7 de 35b; después de
  9.3a]** Push a mano, una vez (B5, V2-a): en un Chromium real (no automatizado) contra staging, con la cuenta `+e2e`
  y la consola abierta, activar las notificaciones en `/notificaciones`, aceptar el permiso y comprobar en
  `chrome://serviceworker-internals` el registro de `sw.js` y en la consola cero violaciones. Verificar con un
  comentario en el mismo PR fusionado: navegador, versión, commit desplegado y resultado.

## 10. Cierre

- [ ] 10.1 [infra] `pnpm nx affected -t lint,typecheck,test,i18n-check` redirigido a fichero y en verde; `bash
  infra/ci/repo-checks.sh` en verde; `pnpm exec openspec validate edge-security-headers --strict --no-interactive` y
  `validate --all --strict --no-interactive` en verde.
- [ ] 10.2 [infra] `/opsx:verify` sobre el change tras el grupo 9, y archivo con las casillas del grupo 9 marcadas en
  el PR de archivo, que es una fusión de **clase 2**: antes de fusionarlo, la guardia de la 0.3 con la regla de su
  clase (nunca entre el PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4, nunca los días 7 y 14 de la medición, nunca
  el día de una `e2e-remote`), con una confirmación escrita y fechada del owner en ese PR.
- [ ] 10.3 [infra] Verificar **cada fusión de este change en `main`** contra la regla de su clase (F1). Con `git log
  --first-parent --merges --format='%H %cI %s' origin/main` volcado a fichero y leído con `node`, listar las fusiones
  de este change (la del change, la del archivo y, si las hubo, las de D9) y, por cada una:
  - **clase 1**: después del merge del PR-2 de 35b (identificado por su número) en (a), o antes de la anotación de la
    6.1 en (d); con `git show <merge>:openspec/changes/staging-host/tasks.md` leído con `node`, la 10.7 de 35b sin
    marcar en ese commit; y el comentario de la 0.3 («en ventana») con la confirmación del owner en el PR fusionado;
  - **clases 2 y 3**: la fecha no es la de ningún día entre el merge del PR-2 de 35b y la 11.6, ni del 9.1-9.4 de 35b,
    ni el día 7 o 14 de la medición, ni el de una corrida `e2e-remote` contra staging (fechas tomadas de la
    confirmación del owner y de las anotaciones de 35b).

  Además (F4, F5): el commit desplegado de la 9.1 contiene la fusión de clase 1; el comentario de la 9.3a es anterior a
  la fecha de la 10.7 de 35b; y **el commit de la 9.3a, el de la corrida `e2e-remote` de la 10.7 y el desplegado el día
  de invitar son el mismo**. Anotar la salida en el PR de archivo; si algo no cuadra, se avisa al owner antes de
  archivar. Falsación: correr la comprobación con una fecha de archivo inventada que caiga el día 7 de la medición y
  ver que la marca fuera de regla; y con un commit de la `e2e-remote` distinto del de la 9.3a y ver que lo marca.
