## Why

El relevamiento del 2026-10-28 encontró que LinkVault sale a internet casi sin cabeceras de seguridad:

- El SPA solo manda `Referrer-Policy` (Traefik, `infra/traefik/dynamic.yml:16-19`) y `X-Content-Type-Options: nosniff`
  (`docker/web/nginx.conf:8-9`). Y ni eso del todo: nginx **no hereda** los `add_header` del bloque `server` en un
  `location` que tenga los suyos, así que `index.html` y los ficheros estáticos salen **sin `nosniff`** (sus dos
  `location` repiten a mano solo `Referrer-Policy`).
- No hay HSTS: la primera visita a staging (o la de alguien que escribe el nombre sin `https://`) se puede degradar a
  HTTP antes de la redirección de Traefik.
- No hay CSP ni `frame-ancestors`/`X-Frame-Options` en el SPA. El access token vive **en memoria** (ADR-012), así que
  cualquier XSS lo lee; y sin protección contra encuadre, acciones de un clic —unirse a un grupo con un código, borrar
  la cuenta, publicar un link— quedan expuestas a clickjacking.
- La API no registra ninguna cabecera de seguridad (`apps/api/src/app/create-app.ts:85-103`). Solo `/p/:slug` tiene la
  suya (ADR-027, `public-page.headers.ts`).

35b (`staging-host`) va a poner el producto en manos de cinco personas que buscan empleo y que van a subir su CV. Lo
barato es cerrar esto **antes** de invitarlas.

**Excepción a la fila 35.** Este change no es una pieza de la fila 35 (35a → 35b → 35c) y la precedencia de ADR-048
§Consecuencias —extendida a la fila entera por ADR-051 §1 y su §Enmiendas, punto 3— impide abrirlo hasta cerrar 35c.
Se **propone el 2026-10-28** como excepción, que solo puede decidir el owner (Q1 del design, **bloqueante**), con las
condiciones de ADR-057 §1: no cambia el orden de la fila, no libera la precedencia para ningún otro change, no toca
ficheros ni requirements que modifiquen 35b o 35c salvo la única línea compartida que se coordina en el design D10
(`infra/traefik/dynamic.yml`), y no se fusiona en ningún momento en el que una fusión a `main` despliegue a staging
fuera del plan de 35b.

## What Changes

- **HSTS en el borde** (Traefik): middleware nuevo `edge-hsts` (`max-age=31536000; includeSubDomains`, sin `preload`)
  en los tres routers de `websecure` (`web`, `api`, `api-cv-upload`). No cambia ninguna regla, prioridad ni servicio, y
  `spa-referrer-policy` sigue igual (la tarea 6.11 de 35b lo comprueba).
- **CSP del SPA aplicada desde el primer día** (no `report-only`), servida por nginx:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self';
  connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
  frame-src 'none'; frame-ancestors 'none'`.
- **Para que esa CSP no rompa el SPA**, dos ajustes del build de `web`: `inlineCritical: false` en producción (el CSS
  crítico en línea mete un `onload="this.media='all'"`, que es un script en línea y la CSP bloquea, dejando la hoja de
  estilos en `media="print"`), y `zod` configurado `jitless` antes del arranque (su sonda `new Function('')` dispara una
  violación de `script-src` en cada carga).
- **Resto de cabeceras del SPA** en nginx: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` (sensores, cámara, micrófono, geolocalización, pago, USB y
  `browsing-topics` apagados; portapapeles intacto para «Copiar invitación») y `Cross-Origin-Opener-Policy: same-origin`.
  Todas en el bloque `server`, con `always`, y **ningún `add_header` dentro de un `location`**: el `Cache-Control` por
  tipo de fichero pasa a un `map`, que conserva los valores de hoy.
- **Cabeceras de la API** desde la propia aplicación: un hook `onSend` de Fastify que añade `nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y `Content-Security-Policy: default-src 'none';
  frame-ancestors 'none'; base-uri 'none'; form-action 'none'` **solo si la ruta no puso ya la suya**, de modo que
  `/p/:slug` conserva su CSP de ADR-027. El flujo SSE (respuesta secuestrada, sin `onSend`) añade `nosniff` en su
  cabecera.
- **Verificación**: tests unitarios y de integración de la API (`app.inject`), una comprobación de repositorio nueva
  (`check-edge-security-headers`) que lee `dynamic.yml`, `nginx.conf` y la configuración de build de `web`, y un
  **guardia de CSP en el lote 1 de la suite e2e**: en `local` inyecta en el documento la política leída de
  `nginx.conf`; en `remote` exige que staging la sirva igual; en los dos, una sola violación hace fallar el paso.
- **Documentación**: procedimiento de vuelta atrás en el RUNBOOK (CSP a `Report-Only` en una línea; HSTS a `max-age=0`).
- **ADR-057** (Propuesto) con las decisiones y la excepción pendiente.

## Capabilities

### New Capabilities

- `platform/edge-security-headers`: qué cabeceras de seguridad sirve cada superficie pública de LinkVault (SPA, API y
  borde), dónde vive cada una, y cómo se comprueba que siguen ahí y que la CSP no rompe el camino crítico.

### Modified Capabilities

Ninguna. `platform/production-deploy` («Referrer-Policy en rutas del SPA») y `links/public-share` («Cabeceras de
seguridad de la página pública») siguen valiendo tal como están; este change los refuerza sin cambiar su texto, para no
crear un orden de archivo con 35b ni con 35c.

## Impact

- **Código** (`apps/**`, con el change activo): `apps/api/src/presentation/http/security-headers.ts` (nuevo),
  `apps/api/src/app/create-app.ts` (registro del hook), `apps/api/src/infrastructure/realtime/sse-stream.ts`
  (`SSE_HEADERS`), `apps/web/project.json` (`optimization` de producción), `apps/web/src/main.ts` y un módulo
  `zod-csp.ts`, `apps/web-e2e/src/support/csp-guard.ts` (nuevo) y su uso en `critical-path.spec.ts`.
- **Configuración servida**: `docker/web/nginx.conf` (viaja dentro de la imagen `web`) e `infra/traefik/dynamic.yml`
  (viaja al host con la configuración del commit desplegado, D4 de 35b).
- **Herramientas**: `tools/repo-checks` gana un target `check-edge-security-headers` y su entrada en el agregador.
- **Docs**: `docs/RUNBOOK.md` (vuelta atrás), `infra/README.md` (la fila de `dynamic.yml` en la tabla de ficheros),
  `docs/adr/ADR-057.md`.
- **Sin cambios**: `docker-compose*.yml`, `.env.example`, `infra/deploy/**`, `infra/ci/**`, `.github/workflows/**`,
  `docker/*.Dockerfile`, ningún requirement de `platform/ci-pipeline` ni de `platform/production-deploy`.
- **Personas**: ninguna pantalla cambia. El primer pintado del SPA puede tardar algo más sin CSS crítico en línea
  (medido en la tarea 2.1).

## Fuera de alcance

- **Trusted Types** (`require-trusted-types-for 'script'`) y **estilos sin `'unsafe-inline'`** por `nonce`: los dos
  exigen nonce por respuesta en nginx (`sub_filter` + `$request_id`) o revisar Material y las plantillas; candidatos a
  un change posterior a 35c (Q3).
- **Un endpoint de informes de CSP** (`report-to`): abriría una ruta anónima de escritura; hasta tener dominio propio y
  un destino de observabilidad, los detecta la suite (Q2).
- **`preload` de HSTS**: imposible sobre `sslip.io` (no es nuestro) y prematuro sin dominio propio (Q4).
- **`Cross-Origin-Embedder-Policy` y `Cross-Origin-Resource-Policy`**: nada lo pide hoy, y CORP en la API necesitaría
  probar antes la extensión de Chromium y de Firefox (ADR-038, ADR-047).
- **`Cache-Control: no-store` en la API** y la caché de `sw.js` (hoy `immutable` siete días como cualquier `.js`):
  son decisiones de caché, no de cabeceras de seguridad; el `map` de nginx conserva exactamente los valores de hoy.
- **CSP en `nx serve web` de desarrollo**: el servidor de desarrollo no se toca; la política se prueba en la suite e2e
  y en staging.
- **Añadir el guardia de CSP a los specs e2e no admitidos**: llega con cada lote (`e2e-suite-lot-2` en adelante).
- **Cualquier cambio en el compose, en los workflows, en `infra/deploy/` o en `infra/ci/`**, y cualquier tarea de 35b o
  35c.
