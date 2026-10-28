> **Cómo leer este fichero.** Cada tarea cabe en **menos de una hora**, lleva su etiqueta y dice **qué se ejecuta**
> para darla por cerrada. Un **guardia permanente** (test, comprobación del repositorio, guardia de la suite) se rompe a
> mano, se ve fallar y se restaura (ADR-048 §7): eso es la **Falsación**. Para contar líneas o coincidencias en esta
> máquina se usa `node`, no `grep -c`, y `nx` nunca se canaliza por una tubería (se redirige a fichero).
>
> **Un PR** con los grupos 1-8, fusionado en la ventana que fije la Q1 (design D10): recomendado, **antes de la 6.1 de
> 35b**; respaldo, entre su 11.6 y su 10.7, fuera de los días 7 y 14. El grupo 9 se hace contra staging con el commit
> desplegado y se marca en el PR de archivo.
>
> **Límites de este change** (ADR-057 §1): no se tocan `docker-compose*.yml`, `.env.example`, `infra/deploy/**`,
> `infra/ci/**`, `.github/workflows/**` ni `docker/*.Dockerfile`; de `infra/traefik/dynamic.yml` solo se **añade**
> `edge-hsts` y su nombre en tres listas.

## 0. Antes de aplicar

- [ ] 0.1 [infra] **[bloqueada: owner — Q1]** Q1 respondida por el owner y anotada en ADR-057 §1 en una línea que
  empieza por «Respuesta del owner (Q1), AAAA-MM-DD:» con la fecha real, y en este design (sección «Open Questions»).
  Si Q1 = (b), el change no pasa de aquí hasta archivar 35c; si Q1 = (c), se retira la tarea 4.1 y la parte de Traefik
  de 5.1, y HSTS pasa a un change posterior. Verificar con un `node -e` que lea `docs/adr/ADR-057.md` y encuentre
  exactamente una línea que case con `^Respuesta del owner \(Q1\), \d{4}-\d{2}-\d{2}:` (hoy, cero).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. Verificar:
  `design.md` lleva la sección del debate de la última iteración con «Convergencia: SI» y la fecha de la aprobación.
- [ ] 0.3 [infra] Comprobar la ventana de Q1 antes de abrir el PR: en `openspec/changes/staging-host/tasks.md`, la 6.1
  sin marcar (camino recomendado) o la 11.6 marcada y la 10.7 sin marcar (respaldo). Verificar con un `node -e` que lea
  ese fichero e imprima el estado de 6.1, 11.6 y 10.7; anotar la salida en el PR.

## 1. API (design D6)

- [ ] 1.1 [backend] `apps/api/src/presentation/http/security-headers.ts`: `API_SECURITY_HEADERS` (las cuatro de D6) y
  `securityHeadersOnSend(request, reply, payload)`, que por cada cabecera la pone solo si `reply.hasHeader` es falso y
  devuelve el `payload` sin tocarlo. Sin dependencias nuevas. Verificar con
  `apps/api/src/presentation/http/security-headers.spec.ts`: «adds every default header to a response that has none»,
  «does not overwrite a header the route already set» y «leaves the payload untouched». Falsación: quitar la
  comprobación de `hasHeader` y ver caer «does not overwrite a header the route already set»; restaurar.
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
  el doble de `SseResponse` que captura `writeHead`). Falsación: quitar la entrada y ver caer el caso; restaurar.

## 2. Build del SPA compatible con la CSP (design D3)

- [ ] 2.1 [frontend] `apps/web/project.json`, `build.configurations.production`: `"optimization": { "scripts": true,
  "styles": { "minify": true, "inlineCritical": false }, "fonts": true }`. Verificar con `pnpm nx run web:build
  --configuration=production --skip-nx-cache` redirigido a fichero y un `node -e` sobre
  `dist/apps/web/browser/index.html`: cero `onload=`, cero `<script` sin `src`, cero `<style`, y un `<link
  rel="stylesheet"` sin `media="print"`. Anotar en esta tarea el tamaño de la hoja de estilos y la diferencia del primer
  pintado con y sin el cambio (Chromium, perfil «Fast 4G», tres cargas de `/login` cada uno). Falsación: cubierta por el
  guardia estático (5.1, «web production build disables inlineCritical») y por el e2e (6.6).
- [ ] 2.2 [frontend] `apps/web/src/zod-csp.ts` con `z.config({ jitless: true })` y `import './zod-csp';` como **primera
  línea** de `apps/web/src/main.ts`, con un comentario que remita a ADR-057. Verificar con
  `apps/web/src/zod-csp.spec.ts`: «configures zod as jitless» (importa el módulo y lee `z.config().jitless`) y con un
  `node -e` que compruebe que la primera sentencia de `main.ts` es ese `import`. Falsación: retirar el `import` de
  `main.ts` y ver la violación de `script-src` (`eval`) en el lote 1 (tarea 6.6); restaurar.
- [ ] 2.3 [frontend] Inventario del build de 2.1, anotado en esta tarea: un `node` de un solo uso (scratchpad) que
  recorra `dist/apps/web/browser/*.{js,css}` y cuente `url(data:`, `data:image`, `new Function`, `eval(`, `http://` y
  `https://` (con el contexto de cada aparición), y liste las URL absolutas encontradas. Cada aparición se clasifica:
  inocua (texto, comentario de licencia, sonda en `try` ya resuelta por 2.2) o **necesita la política**; si alguna la
  necesita, la tarea **se detiene** y vuelve al design como decisión (no se añade una fuente a la CSP sin debate).

## 3. Cabeceras del SPA en nginx (design D1, D2, D5)

- [ ] 3.1 [infra] `docker/web/nginx.conf`: un `map $uri $lv_cache_control` en el nivel del fichero (dentro de `http`,
  donde lo incluye `conf.d/default.conf`) que reproduce los valores de hoy (`/index.html` → `no-cache`; estáticos por
  extensión → `public, max-age=604800, immutable`; resto → vacío); en el bloque `server`, con `always`, las seis
  cabeceras del SPA de D1 con los valores de D2 y D5 y `add_header Cache-Control $lv_cache_control always;`; **ningún
  `add_header` dentro de un `location`** (se conserva el `try_files` y se quita `expires` si su `Cache-Control` choca
  con el del `map`). Comentario de cabecera que remite a ADR-057 y explique la trampa de herencia de `add_header`.
  Verificar con 3.2 y con el guardia de 5.1.
- [ ] 3.2 [infra] Prueba de un solo uso en un nginx real (scratchpad, no queda en el repositorio):
  `docker run --rm -d -p 18080:80 -v <conf>:/etc/nginx/conf.d/default.conf:ro -v <dist>:/usr/share/nginx/html:ro
  nginx:1.27-alpine` con el `dist` de 2.1, `nginx -t` en el contenedor, y `curl -sSI` a `/`, `/index.html`, `/grupos/x`,
  un `.js` con hash, `/sw.js` y `/no-existe.png`, volcado a fichero y leído con `node`: las seis cabeceras en las seis
  respuestas, `Cache-Control: no-cache` en `index.html` y en el fallback, `public, max-age=604800, immutable` en el
  `.js` y en `sw.js` (como hoy), y el `404` con las cabeceras. Apagar el contenedor. Anotar la salida resumida.
  Falsación: mover el `add_header` de CSP a un `location` en la copia, ver desaparecer la cabecera en ese tipo de
  respuesta, y restaurar.

## 4. HSTS en el borde (design D7, D10)

- [ ] 4.1 [infra] `infra/traefik/dynamic.yml`: middleware `edge-hsts` (`headers.stsSeconds: 31536000`,
  `stsIncludeSubdomains: true`, `stsPreload: false`) y su nombre **añadido** a `middlewares` de `web`, `api` y
  `api-cv-upload` (en `api`, la lista se crea); comentario de cabecera ampliado con «HSTS (ADR-057)». Nada más del
  fichero cambia. Verificar con un `node -e` que parsee el fichero antes y después con el `yaml` del repositorio y
  compare: solo difieren `http.middlewares.edge-hsts` y las tres listas `middlewares`, y `spa-referrer-policy` sigue
  igual; y con `docker run --rm -v <dir>:/etc/traefik:ro traefik:v3.3.5 traefik --providers.file.filename=/etc/traefik/dynamic.yml
  --log.level=DEBUG` unos segundos (con `PUBLIC_HOST` de prueba), volcado a fichero y leído con `node`, sin errores de
  configuración del proveedor de ficheros. Falsación: cubierta por 5.1.

## 5. Guardia estático (design D8)

- [ ] 5.1 [infra] `tools/repo-checks/src/edge-security-headers.check.mjs` con las cinco reglas de D8 (Traefik, la
  permanencia de `spa-referrer-policy`, nginx en el `server` con `always` y sin `add_header` en `location`, la CSP, y
  `inlineCritical: false`), con la excepción fechada `# csp-report-only: AAAA-MM-DD <motivo>` de D9, y mensajes que
  nombran fichero, router, `location` o directiva. Reutiliza `src/lib/report.mjs`. Verificar con `node
  tools/repo-checks/src/edge-security-headers.check.mjs` en verde sobre el árbol. Falsación, una por regla, cada una
  sobre el árbol de trabajo y restaurada con `git checkout --` antes de la siguiente: quitar `edge-hsts` de
  `api-cv-upload` («every websecure router has edge-hsts»); `stsPreload: true` («edge-hsts is one year with subdomains
  and without preload»); quitar `spa-referrer-policy` de `web` («the web router keeps spa-referrer-policy»); quitar
  `always` de `X-Frame-Options` («nginx declares the six SPA headers at server level with always»); un `add_header`
  dentro de `location /` («no nginx location declares add_header»); `'unsafe-inline'` en `script-src` y, aparte, quitar
  `frame-ancestors` («the SPA CSP forbids inline and external scripts and framing»); `inlineCritical: true` («web
  production build disables inlineCritical»). Cada una sale ≠0 nombrando lo roto.
- [ ] 5.2 [infra] Target `check-edge-security-headers` en `tools/repo-checks/project.json` con `cache: true` e
  **inputs explícitos** (`infra/traefik/dynamic.yml`, `docker/web/nginx.conf`, `apps/web/project.json`, el `.check.mjs`
  y `src/lib/report.mjs`), y su entrada en el `dependsOn` del agregador `check`. Verificar con `bash
  infra/ci/repo-checks.sh` redirigido a fichero y leído con `node`: una comprobación más que antes, todas en verde.
  Falsación: dejar el target fuera del `dependsOn` y ver fallar el agregador (`aggregate.mjs`) nombrándolo; restaurar.
  Segunda falsación (caché): con el target en verde, cambiar `stsSeconds` a `300` en `dynamic.yml` y comprobar que
  `pnpm nx run repo-checks:check-edge-security-headers` **se ejecuta** (no `[local cache]`) y falla; restaurar.

## 6. Guardia de CSP en el lote 1 (design D8)

- [ ] 6.1 [frontend] `readSpaSecurityHeaders(path)` en `apps/web-e2e/src/support/csp-guard.ts`: lee los `add_header`
  del bloque `server` de `docker/web/nginx.conf` (no los de `location`, no el `Cache-Control` variable) y devuelve un
  `Record<string,string>`; falla si no hay `Content-Security-Policy`. Verificar con `apps/web-e2e/src/support/csp-guard.spec.ts`
  (Vitest del proyecto `web-e2e`): «reads the server-level headers of nginx.conf», «ignores add_header inside a
  location» y «fails when nginx.conf has no Content-Security-Policy», sobre fixtures de texto en el propio spec y un
  caso sobre el fichero real. Falsación: hacer que el parser lea también los `location` y ver caer el segundo; restaurar.
- [ ] 6.2 [frontend] En `csp-guard.ts`, `installCspGuard(context, profile, baseUrl)`: en `local`, `context.route` sobre
  el origen de la suite que solo actúa en navegaciones principales (`request.isNavigationRequest()` y
  `resourceType() === 'document'`), con `route.fetch()` + `route.fulfill({ response, headers })` añadiendo las
  cabeceras leídas; el resto, `route.fallback()`. En `remote`, sin interceptar. En los dos, `addInitScript` que acumula
  los `securitypolicyviolation` (`violatedDirective`, `blockedURI`, `documentURI`, `sourceFile`, `lineNumber`) y un
  escuchador de consola que recoge «Refused to…» y «Content Security Policy». Exporta `assertNoCspViolations(page)`,
  que falla listando cada violación. Verificar con `pnpm nx run web-e2e:typecheck` y `lint` redirigidos a fichero y en
  verde.
- [ ] 6.3 [frontend] Usar el guardia en `critical-path.spec.ts`: `installCspGuard` en cada contexto que abre la prueba
  (A y B), `assertNoCspViolations` al final de cada `test.step`, y en `remote` una aserción sobre la respuesta de la
  primera navegación: su `content-security-policy` es idéntica a la leída de `nginx.conf` (fallo con las dos). Se
  actualiza la tabla de pasos del comentario de cabecera. Verificar con `pnpm nx run web-e2e:e2e-stack` redirigido a
  fichero: verde en los dos proyectos.
- [ ] 6.4 [frontend] Medir el servidor de desarrollo de la suite (design D8): con la pila de la suite levantada
  (`--keep-stack` si el runner lo ofrece), pedir el documento de `web` y buscar `@vite/client` con `node`; repasar las
  violaciones de 6.3 por `sourceFile`. Anotar el resultado aquí. **Solo si** aparece una violación atribuible al
  servidor de desarrollo, añadir `--live-reload=false --hmr=false` al lanzamiento de `web:serve:production` en
  `apps/web-e2e/scripts/e2e-stack.ts`, con su comentario, y repetir 6.3. Nunca filtrar violaciones por origen.
- [ ] 6.5 [frontend] Admisión del lote 1 modificado (ADR-053 §6): `--repeat-each=5` bajo carga en cada proyecto
  (escritorio y móvil emulado), con el procedimiento de carga de la admisión original de `e2e-suite`. Verificar con los
  informes volcados a fichero y leídos con `node`: 10 de 10 en verde por proyecto, cero reintentos, cero violaciones.
- [ ] 6.6 [frontend] Falsaciones del guardia, cada una restaurada antes de la siguiente, con `e2e-stack` sobre el
  proyecto de escritorio: (1) retirar `import './zod-csp'` de `main.ts` → falla el primer paso que valida con zod,
  nombrando `script-src` y `eval`; (2) `inlineCritical: true` → falla el primer paso nombrando `script-src-attr` (el
  `onload`); (3) cambiar en la copia de trabajo de `nginx.conf` `script-src 'self'` por `script-src 'none'` → falla al
  cargar el primer documento. Anotar el mensaje de cada una.

## 7. Barrido de las rutas fuera del lote 1 (design D4)

- [ ] 7.1 [frontend] Una sola vez, con un script de Playwright de un solo uso (scratchpad) que usa `installCspGuard`
  sobre la pila de la suite (`e2e-stack` con la pila conservada) y una cuenta creada por la interfaz: visitar en
  escritorio y en `Pixel 7` cada ruta de `apps/web/src/app/app.routes.ts` que el lote 1 no recorre —`/oferta/:slug`
  (con un link publicado), `/privacidad`, `/recuperar-contrasena`, `/restablecer-contrasena`, `/verificar-email`,
  `/mis-links`, `/buscar`, `/descubrir`, `/plan/:analysisId` (si el mock lo produce), `/perfil` (incluida la bóveda BYOK
  si está visible) y `/notificaciones` (activando el push, que registra `sw.js`)— y abrir en cada una el diálogo o menú
  principal. Verificar con la lista de violaciones volcada a fichero y leída con `node`: cero. Si hay alguna, la tarea
  se detiene y vuelve al design (como en 2.3). Anotar rutas y resultado.

## 8. Documentación y ADR

- [ ] 8.1 [infra] `docs/RUNBOOK.md`: sección nueva «Paso 6 septendecies — Cabeceras de seguridad del borde
  (edge-security-headers / ADR-057)», insertada **antes** de «Paso 6 sexdecies» (que es de 35b), con: qué cabecera
  vive dónde (tabla de D1), cómo comprobarlas con `curl -sSI`, la vuelta atrás de D9 (CSP a `-Report-Only` con su
  línea de excepción fechada; HSTS a `max-age=0`) y cómo leer un fallo del guardia de CSP. `infra/README.md`: la
  descripción de la fila de `infra/traefik/dynamic.yml` añade «HSTS (`edge-hsts`)». Verificar con un `node -e` que
  encuentre el encabezado nuevo antes de «Paso 6 sexdecies», las palabras `Report-Only`, `max-age=0` y `edge-hsts` en
  la sección, y `edge-hsts` en la fila de `infra/README.md`.
- [ ] 8.2 [infra] Tras la aprobación: ADR-057 pasa a «Aceptado» con la fecha; ADR-048 §Consecuencias gana su línea
  «· **Excepción de ADR-057 (AAAA-MM-DD), por decisión del owner.** …» tras la de ADR-055; `docs/design-v0.2.md` §6 gana
  la fila «∥ 35b `edge-security-headers`»; y la nota de la fila de `openspec-changes.yaml` pasa de «propuesto» a la
  decisión con su fecha. Verificar con un `node -e` que encuentre las cuatro cosas.

## 9. Staging (bloqueado por el primer despliegue que contenga este change)

- [ ] 9.1 [infra] **[bloqueada: despliegue a staging de un commit con este change]** Con `curl -sSI` (sin `-k`) a
  `https://<nombre>/`, `/unirse?codigo=PRUEBA`, `/grupos/x`, un `.js` con hash, `/sw.js`, `/api/health` (debe dar el
  `404` de la API: `/health` no es público), una ruta `GET /api/…` sin sesión (`401`) y `/p/<slug-inexistente>`,
  volcado a fichero y leído con `node`: HSTS en todas; las seis del SPA en las cinco primeras, idénticas a
  `nginx.conf`; las cuatro de la API en las de API; la CSP de ADR-027 en `/p/`; `Referrer-Policy` en `/unirse` (la
  6.11 de 35b sigue valiendo). Anotar el commit desplegado (del host o del estado `cd-staging/artifact`).
- [ ] 9.2 [infra] **[bloqueada: 9.1]** Encuadre: una página HTML local de un solo uso con un `iframe` a
  `https://<nombre>/unirse` y otro a `https://<nombre>/p/<slug>`, abierta en Chromium y en Firefox: los dos se niegan a
  mostrarlos (anotar el mensaje de consola de cada navegador).
- [ ] 9.3 [infra] **[bloqueada: 9.1; sin corrida propia]** Anotar el resultado del guardia de CSP en la corrida
  `e2e-remote` contra staging que 35b lanza como precondición de invitar (ADR-053 §1.3): cero violaciones y la CSP
  servida idéntica, en los dos proyectos, sobre el commit de 9.1. Si esa corrida ya se hizo antes de que el commit
  desplegado tuviera este change, se usa la repetición que exige D10 (respaldo de Q1). No se lanza ninguna corrida
  adicional contra staging.

## 10. Cierre

- [ ] 10.1 [infra] `pnpm nx affected -t lint,typecheck,test,i18n-check` redirigido a fichero y en verde; `bash
  infra/ci/repo-checks.sh` en verde; `pnpm exec openspec validate edge-security-headers --strict --no-interactive` y
  `validate --all --strict --no-interactive` en verde.
- [ ] 10.2 [infra] `/opsx:verify` sobre el change tras el grupo 9, y archivo con las casillas del grupo 9 marcadas en
  el PR de archivo (fuera de los días 7 y 14 de la medición de 35b si la 6.1 ya se hizo).
