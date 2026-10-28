## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos uno. La falsación de un guardia se hace, se ve caer el test
nombrado y se restaura en la misma tarea. Un test de «no abre conexión» afirma además que la causa es
`EgressBlockedError` y tiene en su fichero un control positivo que abre exactamente una conexión (design D10).

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada con fecha en ADR-056 §1 (línea que empieza por «Respuesta del
  owner (Q1), AAAA-MM-DD:») y, en una línea, en ADR-048 §Consecuencias bajo las excepciones de ADR-053 y ADR-055; con
  Q1 = (a) o (e), una fila «∥ 35b (fusión tras su 11.6, antes de su 10.7)» en `docs/design-v0.2.md` §6, como la de
  `usage-guide-fixes`. Si Q1 = (b), el change no pasa de aquí hasta archivar 35c; si Q1 = (c), se vuelve a
  `/lv:debate` para fundirlo con `staging-host`; si Q1 = (d), la autorización expresa del owner a la excepción de «entre
  PR-1 y PR-2» de 35b, con su riesgo para la 6.3 aceptado por escrito, se anota en la misma línea. Verificar:
  `grep -c "Respuesta del owner (Q1), 20" docs/adr/ADR-056.md` devuelve `1` (hoy `0`) y
  `grep -c "ADR-056" docs/adr/ADR-048.md` devuelve al menos `1` (hoy `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada en
  `design.md` con su fecha. Verificar: la sección del debate de la última iteración dice «Convergencia: SI».

## 1. Clasificador compartido (`libs/shared`, design D1, D2, D8)

- [ ] 1.1 [backend] `ipaddr.js` como dependencia directa (la versión del lockfile, sin `minimumReleaseAgeExclude`) y
  `libs/shared/src/net/egress-address.ts` con `classifyAddress` para **IPv4**, exportado desde el índice. Verificar en
  `egress-address.spec.ts`, con una tabla de literales **copiados a mano de la spec** (dentro, borde y fuera por rango;
  el spec no importa ninguna tabla de la implementación): «classifies every non-public IPv4 range of the spec»,
  «classifies a public IPv4 address as public» y «classifies the limited broadcast address as broadcast». Falsación:
  quitar `100.64.0.0/10` de la tabla de rangos de la implementación y ver caer el primero; restaurar.
- [ ] 1.2 [backend] `classifyAddress` para **IPv6** con lista de permitidos: público solo dentro de `2000::/3` y fuera
  de los rangos de la spec (`::`, `::1`, `::/96`, `::ffff:0:0/96`, `100::/64`, `2001:db8::/32`, `fc00::/7`,
  `fe80::/10`, `fec0::/10`, `ff00::/8`), y la IPv4 interna de `64:ff9b::/96` y `2002::/16`. Verificar, con literales
  copiados de la spec: «classifies every non-public IPv6 range of the spec», «rejects an IPv6 address outside 2000::/3
  that is not a translation prefix», «rejects an IPv4-mapped IPv6 address whatever it embeds» y «classifies a
  translated IPv6 address by its embedded IPv4» (pública → `public`, privada → `private`). Falsación: aceptar como
  `public` todo lo que no esté en la lista de prohibidos (sin la condición de `2000::/3`) y ver caer el segundo;
  clasificar `64:ff9b::/96` entero como `reserved` y ver caer el cuarto; restaurar.
- [ ] 1.3 [backend] `classifyHost(hostname)` (literal IPv4, literal IPv6 con o sin corchetes, `dotless` tras quitar el
  punto final, `localhost` y `*.localhost`, `name`) e `isEgressAllowed(class, { allowPrivateTargets })` con la política
  de D8. Verificar: «treats a single-label host as dotless with or without a trailing dot», «treats localhost
  subdomains as localhost», «classifies alternative IPv4 notations after WHATWG URL parsing» (el caso pasa por
  `new URL(...).hostname`), «allowPrivateTargets allows loopback, RFC 1918, localhost and dotless hosts»,
  «allowPrivateTargets still rejects shared address space and ULA» y «allowPrivateTargets still rejects link-local,
  unspecified, multicast and broadcast». Falsación: hacer que `allowPrivateTargets` permita `shared_cgnat` y ver caer
  el quinto; que permita `link_local` y ver caer el sexto; restaurar.
- [ ] 1.4 [backend] `isEgressPortAllowed(protocol, port, cls, policy)`: puerto ausente u `80`/`443`; con
  `allowPrivateTargets`, cualquier puerto solo para los destinos que la opción abre. Verificar: «allows the default
  port and explicit 80 and 443», «rejects any other port on a public destination», «allowPrivateTargets allows any
  port only on the destinations it opens». Falsación: devolver `true` para cualquier puerto y ver caer el segundo;
  restaurar.
- [ ] 1.5 [backend] `unsafe_destination` en `enrichmentFailureReasonSchema` y en `NON_RETRYABLE_ENRICHMENT_REASONS`
  (`libs/shared/src/schemas/preview.schema.ts`), con su línea en el comentario de la lista. Verificar en
  `preview.schema.spec.ts`: «unsafe_destination is a known enrichment failure reason» y «unsafe_destination is not
  retryable». Falsación: quitarlo de `NON_RETRYABLE_ENRICHMENT_REASONS` y ver caer el segundo; restaurar.

## 2. Guardia de salida del worker (design D3, D8)

- [ ] 2.1 [backend] `undici` como dependencia directa y `apps/worker/src/infrastructure/egress/egress-lookup.ts`:
  `createEgressLookup(resolve, policy)` con la firma de `lookup` de `net` (honra `all` y `family`), que resuelve una vez,
  clasifica **todas** las direcciones y devuelve o todas o `EgressBlockedError` (solo la categoría). Un `ENOTFOUND` del
  resolvedor se propaga tal cual. Verificar en `egress-lookup.spec.ts` con un resolvedor inyectado: «rejects when any
  resolved address is not public», «returns exactly the approved addresses», «honours the all option»,
  «propagates a resolution failure unchanged» y «calls the resolver once per lookup». Falsación: devolver solo las
  direcciones públicas en vez de rechazar y ver caer el primero; restaurar.
- [ ] 2.2a [backend] Conector guardado en `egress/guarded-connector.ts`: envuelve `buildConnector({ lookup })` de
  `undici`; antes de delegar clasifica el host recibido (`classifyHost`) y el puerto (`isEgressPortAllowed`) y, si no
  pasan, llama al callback con `EgressBlockedError` sin abrir socket. Verificar en `guarded-fetch.int.spec.ts`, con un
  servidor HTTP en loopback que **cuenta conexiones** y nombres de `.test` resueltos por un resolvedor inyectado:
  «a name resolving to loopback opens no connection», «a literal loopback host opens no connection», «a dotless host is
  rejected without resolving», «a non-web port opens no connection» y el control positivo «with allowPrivateTargets a
  loopback page is fetched over exactly one connection». Falsación: quitar el `lookup` del conector base y ver caer el
  primero (el servidor cuenta una conexión); quitar la clasificación del host en el conector y ver caer el segundo;
  restaurar.
- [ ] 2.2b [backend] `createGuardedFetch({ policy, resolve? })` en `egress/guarded-fetch.ts`: `fetch` y `Agent` del
  paquete `undici` con `connect` = conector de 2.2a y `allowH2: false`; fuerza `redirect: 'manual'` en cada petición;
  dispatcher explícito, sin proxy del entorno. Devuelve un `HttpFetch`. Verificar en `guarded-fetch.int.spec.ts`:
  «a followed redirect to a literal loopback opens no connection» (servidor aprobado por la política inyectada que
  redirige a un literal de loopback donde escucha otro servidor contador; con `redirect: 'follow'` pedido por el
  llamador y siguiéndolo a mano: el segundo servidor cuenta cero y la causa es `EgressBlockedError`), «forces manual
  redirects whatever the caller asks» e «ignores proxy variables in the environment» (proxy HTTP local contador en
  `HTTP_PROXY`/`HTTPS_PROXY`: cuenta cero y el destino cuenta una). Falsación: usar `EnvHttpProxyAgent` como dispatcher
  y ver caer el tercero (el proxy cuenta una); quitar el forzado de `redirect` y ver caer el segundo; restaurar.
- [ ] 2.3 [backend] Cambio de DNS entre comprobación y conexión. Verificar en `guarded-fetch.int.spec.ts`, con dos
  servidores contadores en `127.0.0.2` y `127.0.0.3` y una **política inyectada** que aprueba el primero y rechaza el
  segundo: «connects to the address approved in the same resolution» (resolvedor que responde `.2` y luego `.3`, con
  contador: una consulta por conexión, `.2` cuenta una y `.3` cero) y «a later hop resolving to a private address opens
  no connection». Si el sistema local no admite esas direcciones, el test se salta con motivo escrito (nunca en CI,
  design R10). Falsación: resolver otra vez el nombre fuera del `lookup` (simulando un pre-chequeo separado) y ver caer
  el primero; restaurar.
- [ ] 2.4 [backend] `EGRESS_ALLOW_PRIVATE_TARGETS` en `worker-config.schema.ts` (booleano, por defecto `false`, mismo
  parser de booleanos que `FEATURE_HEADLESS_EXTRACTION`), error en `superRefine` con `NODE_ENV=production`, `warn` de
  arranque sin datos de usuario cuando está encendida, y `apps/worker/src/test-support/test-config.ts` con `false`.
  Verificar en el spec del esquema: «EGRESS_ALLOW_PRIVATE_TARGETS=true fails in production naming the variable»,
  «EGRESS_ALLOW_PRIVATE_TARGETS defaults to false» y «EGRESS_ALLOW_PRIVATE_TARGETS=true is accepted in development».
  Falsación: quitar la rama de producción del `superRefine` y ver caer el primero; restaurar.

## 3. Descarga de la página (design D4, D10, D11)

- [ ] 3.1 [backend] `PageFetchFailureReason` con `unsafe_destination` (y la categoría en el fallo, para el registro);
  `HttpPageFetcher` traduce `EgressBlockedError` (venga del conector o del `lookup`, en cualquier salto, buscándolo en
  la cadena de `cause` del error del cliente) a `unsafe_destination`, y un error de resolución a `http_error`. Verificar
  en `http-page-fetcher.spec.ts` con dobles de `HttpFetch`: «maps an egress rejection to unsafe_destination», «maps an
  egress rejection on a redirect hop to unsafe_destination» y «a name that does not resolve stays http_error».
  Falsación: tratar todo error de red como `http_error` y ver caer el primero; restaurar.
- [ ] 3.2 [backend] `enrichment.module.ts`: `PAGE_FETCHER` y el fetcher del `robots.txt` construidos sobre **un mismo**
  `createGuardedFetch` con la política de `WorkerConfig`. En `eslint.config.mjs`, un bloque para
  `apps/worker/src/modules/enrichment/**` con `no-restricted-globals` (`fetch`) y `no-restricted-imports` (`undici`,
  `node:http`, `node:https`, `http`, `https`); el guardia vive en `apps/worker/src/infrastructure/egress/`, fuera del
  alcance. Como ESLint no combina opciones entre bloques (ADR-017), el bloque que cubre `enrichment/domain/**` repite
  `DOMAIN_RESTRICTED_PATTERNS`. Verificar: `pnpm nx run worker:lint` en verde; en `enrichment.module.spec.ts` (o el spec
  de arranque del worker): «page and robots fetchers share the guarded transport». Falsación: devolver
  `fetch as HttpFetch` al `PAGE_FETCHER` y ver fallar `worker:lint` con `no-restricted-globals`; añadir un
  `import 'mongoose'` en un fichero de `enrichment/domain/` y ver que la regla del dominio sigue fallando; restaurar.
- [ ] 3.3 [backend] Registro del rechazo en el caso de uso del enriquecimiento: `warn` con `linkId`, `stage: 'page'` y
  `category`, sin URL, host ni dirección. Verificar en el spec del caso de uso con un logger que captura: «logs an
  unsafe destination with linkId, stage and category only» (afirma que ningún campo serializado contiene la URL ni el
  host del link). Falsación: añadir `url` al objeto del `warn` y ver caer el test; restaurar.
- [ ] 3.4 [backend] Escenarios del motivo. Verificar: en el spec del caso de uso del worker, «an internal page leaves
  the link failed with unsafe_destination»; en `request-link-enrichment.usecase.spec.ts` (API), «retry of an
  unsafe_destination link answers 409 and requests nothing»; en el spec de cierre por relectura de frescura, «a
  freshness re-check ending in unsafe_destination does not close the job». Falsación: sacar `unsafe_destination` de
  `NON_RETRYABLE_ENRICHMENT_REASONS` y ver caer el segundo; restaurar.
- [ ] 3.5 [backend] Integración del fetcher real sobre el guardia real (E8). Verificar en
  `http-page-fetcher.int.spec.ts`, con `HttpPageFetcher` sobre el `createGuardedFetch` real, en `http://` y `https://`
  (servidor TLS local con certificado autofirmado generado en el test y confiado solo en ese `Agent`), servidores que
  cuentan conexiones y un resolvedor inyectado: «a host resolving to a blocked address ends in unsafe_destination with
  no connection» (por esquema), «a name that does not resolve ends in http_error» (por esquema) y el control positivo
  «an approved host is fetched over exactly one connection» (por esquema). Falsación: hacer que el fetcher no busque
  `EgressBlockedError` en la cadena de `cause` y ver caer el primero en los dos esquemas; restaurar.
- [ ] 3.6 [frontend] Tarjeta de un link con `unsafe_destination` (V2-2). Sin cambio de código en `link-status.ts`.
  Verificar en `apps/web/src/app/features/links/link-status.spec.ts`: «unsafe_destination needs a hand and offers no
  retry» (`needsHand: true`, `canRetry: false`, `pasteFirst: false`, texto genérico) con
  `pnpm nx run web:test --include="**/link-status.spec.ts" --skip-nx-cache`. Falsación: añadir temporalmente
  `unsafe_destination` a `isClosedToUs` y ver caer el test (`pasteFirst` pasa a `true`); restaurar.

## 4. `robots.txt` (design D5)

- [ ] 4.1 [backend] `createHttpRobotsFetcher` recibe el `HttpFetch` guardado y sigue redirecciones a mano: hasta cinco
  saltos, a otro host **solo** si el destino es `/robots.txt` sin query, un `AbortSignal.timeout` para la cadena entera;
  más saltos, otro host con otra ruta o `EgressBlockedError` → `null`, con un `warn` de `stage: 'robots'` y `category`
  sin `linkId`, URL ni host. Verificar en `http-robots-fetcher.spec.ts` (nuevo) con dobles y un logger que captura:
  «follows up to five redirects», «does not request a sixth redirect target», «follows a redirect to robots.txt on
  another public host and returns its rules», «does not follow a cross-host redirect to another path or with a query»
  y «returns null when a hop is rejected by the egress guard and logs stage robots without linkId or url». Falsación:
  volver a `redirect: 'follow'` y ver caer el segundo y el quinto; quitar la condición de ruta y ver caer el cuarto;
  restaurar.
- [ ] 4.2 [backend] Lectura del cuerpo por trozos con corte al pasar `ROBOTS_MAX_BYTES` (lo que no cabe → cuerpo
  vacío, como hoy). Verificar: «stops reading a robots body over the cap without a content-length» (el doble cuenta
  los trozos leídos y afirma que no se leyó hasta el final) y «returns no rules for an oversized robots body».
  Falsación: volver a `response.text()` y ver caer el primero; restaurar.
- [ ] 4.3 [backend] Integración con el guardia real. Verificar en `guarded-fetch.int.spec.ts`: «a robots redirect to an
  internal address opens no connection to it» (el servidor de destino cuenta cero conexiones, la causa registrada es
  `EgressBlockedError` y `RedisCachedRobots` decide permitido), con su control positivo «a robots redirect to an
  approved host opens exactly one connection to it». Falsación: construir el fetcher del `robots.txt` con el `fetch`
  global y ver caer el primero; restaurar.

## 5. Rechazo sintáctico en la API (design D6, D8)

- [ ] 5.1 [backend] `EGRESS_ALLOW_PRIVATE_TARGETS` en `api-config.schema.ts` con la misma regla de producción y el mismo
  `warn`, y `apps/api/src/test-support/test-config.ts` con `false`. Verificar en el spec del esquema de la API:
  «EGRESS_ALLOW_PRIVATE_TARGETS=true fails in production naming the variable». Falsación: quitar la rama de producción
  y ver caer el test; restaurar.
- [ ] 5.2 [backend] Rechazo como no reconocida de hosts sin punto, `localhost`/`*.localhost`, literales no públicos y
  puertos no web, con el clasificador de 1.3 y 1.4 y la política inyectada por token (el dominio no lee configuración).
  Verificar en `url.spec.ts` (o el spec del caso de uso que aplique la política): «rejects a literal private or
  loopback host as unrecognized», «rejects a dotless host as unrecognized», «rejects an explicit non-web port as
  unrecognized», «accepts localhost with a port with allowPrivateTargets»; en `save-link.usecase.spec.ts`: «saving an
  internal literal host answers invalid_url and creates nothing» y «saving a non-web port answers invalid_url and
  creates nothing»; en `import-links.usecase.spec.ts`: «an internal URL in an import counts as unrecognized».
  Falsación: no aplicar la política en `normalizeUrl` y ver caer los cuatro primeros; restaurar.
- [ ] 5.3 [backend] Sin DNS al guardar. Verificar en `url.spec.ts`: «does not resolve names when saving» con
  `vi.mock('node:dns')` y `node:dns/promises` sin llamadas. Falsación: añadir una llamada a `dns.lookup` en la ruta
  de guardado y ver caer el test; restaurar.

## 6. Push (design D7, D11)

- [ ] 6.1 [backend] `libs/shared/src/notifications/push-services.ts` con la lista de D7 e `isKnownPushEndpoint(raw)`:
  texto crudo sin espacios, controles ni barra invertida; `new URL(raw).href === raw`; host solo con letras ASCII,
  dígitos, guiones y puntos; `https`, sin credenciales, puerto 443 o ausente; host exacto o sufijo con punto. El
  `refine` de `pushSubscriptionRequestSchema` con `path: ['endpoint']`. Verificar en `notifications.schema.spec.ts`:
  «accepts an endpoint of each known push service», «rejects an unknown push host», «rejects http and non-443 ports on
  a known host», «rejects a host that ends with a known suffix without a label boundary» y «rejects an endpoint that is
  not already in canonical WHATWG form or carries forbidden characters» (tabla de casos generados en el test por
  categoría: espacio, control, barra invertida, carácter fuera del juego permitido en el host, forma no canónica).
  Falsación: comparar con `endsWith(sufijo)` sin el punto y ver caer el cuarto; quitar la comparación con `href` y ver
  caer el quinto; restaurar.
- [ ] 6.2 [backend] API: los fixtures de push de `apps/api/**` pasan a hosts de la lista. Verificar en el spec del
  controlador o de `register-push-subscription.usecase.spec.ts`: «an unknown push endpoint answers 400 validation_error
  naming endpoint and stores nothing». Falsación: quitar el `refine` de 6.1 y ver caer el test; restaurar.
- [ ] 6.3 [backend] `WebPushVapidSender` recibe la política de endpoints por constructor (por defecto
  `isKnownPushEndpoint` más la igualdad del host de `url.parse` con el host WHATWG); un endpoint que no la cumple se
  borra con `deleteEndpoint` sin llamar a `web-push`, con un `warn` que lleva el host (o `unparseable`) y nunca el
  endpoint completo. Los specs que hoy usan servidores locales inyectan una política permisiva. Verificar en
  `web-push-sender.spec.ts`: «deletes a stored subscription outside the known push services without connecting» (el
  servidor local cuenta cero conexiones; el registro capturado contiene el host y no contiene el endpoint completo) y
  «deletes a stored subscription whose legacy-parsed host differs from the WHATWG host». Falsación: saltarse la
  comprobación con la política por defecto y ver caer el primero; quitar la igualdad de hosts y ver caer el segundo;
  registrar el endpoint completo y ver caer el primero; restaurar.
- [ ] 6.4 [frontend] `core/notifications/push-notifications.ts` (V1-1): si `registerPushSubscription` falla con `400` y
  código `validation_error`, `enable()` llama a `subscription.unsubscribe()` antes de devolver `failed`, y `subscribed`
  queda en `false`; ante otros fallos no la cancela. Sin textos nuevos. Verificar en `push-notifications.spec.ts`:
  «unsubscribes the browser subscription when the API rejects the endpoint» y «keeps the browser subscription on a
  transient registration failure», con `pnpm nx run web:test --include="**/push-notifications.spec.ts"
  --skip-nx-cache`. Falsación: quitar la llamada a `unsubscribe()` y ver caer el primero; llamarla ante cualquier fallo
  y ver caer el segundo; restaurar.
- [ ] 6.5 [infra] Comprobación manual de la lista en local (`pnpm infra:up`, `nx serve api`, `nx serve web`) con los
  navegadores disponibles (al menos Chrome y Firefox; Edge y Safari si hay equipo): activar push en Notificaciones y
  anotar en el PR, por navegador, el **host** del endpoint (no el endpoint entero) y la respuesta `201`. Verificar: la
  nota del PR lista cada navegador probado con host y `201`; un navegador con `400` es un hallazgo que amplía la lista
  en esta misma tarea.

## 7. Documentación y cierre

- [ ] 7.1 [infra] `.env.example`: `EGRESS_ALLOW_PRIVATE_TARGETS=false` con un comentario de dos líneas (solo desarrollo y
  tests; el proceso no arranca con `true` en producción). Verificar: `grep -n "^EGRESS_ALLOW_PRIVATE_TARGETS=false" .env.example`
  devuelve una línea y `grep -c EGRESS_ALLOW_PRIVATE_TARGETS apps/web-e2e/e2e.env` devuelve `0`.
- [ ] 7.2 [infra] Condición de la excepción (design D9). Verificar: `git diff --name-only origin/main...HEAD | grep -E
  '^(docker-compose|infra/deploy/|infra/ci/|\.github/workflows/|openspec/specs/platform/|openspec/changes/staging-host/)'`
  no devuelve nada.
- [ ] 7.3a [backend] Ensayo de la reversión, pasos 1 y 2 del Migration Plan 3, en la pila local con este change: un
  link con `lastEnrichmentError.reason = unsafe_destination`; parar el worker; la actualización a `blocked` con
  `mongosh`. Verificar: recuento de `unsafe_destination` en `0` y del link en `blocked`, con la orden exacta y el
  resultado en la descripción del PR.
- [ ] 7.3b [backend] Ensayo de la reversión, pasos 3 y 4: servir el commit anterior (worktree de `origin/main`), escribir
  a mano otro `unsafe_destination` simulando una escritura en vuelo, repetir la actualización y leer con el código
  anterior. Verificar: `GET /api/links/mine` en `200`, el link sin acción de reintentar en el SPA anterior, un nuevo
  guardado del mismo host con otra URL que **no** pide lectura (sin rescate por historial), y el recuento de
  `unsafe_destination` en `0`; todo anotado en el PR. La anotación recuerda R7: no se revierte con el registro abierto
  sin cerrarlo o sin la defensa de ADR-056 §6.
- [ ] 7.4 [infra] Camino crítico e2e sin regresión: `pnpm nx run web-e2e:e2e-stack -- --project=chromium` (perfil `local`) en
  verde, con el link del host `.invalid` terminando como antes (`http_error`). Verificar: salida del comando anotada en
  el PR.
- [ ] 7.5 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salida anotada en el PR.
- [ ] 7.6 [infra] `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en verde.
  Al archivar, ADR-056 pasa a «Aceptado» con la fecha y el PR. Verificar: `grep -n "^\*\*Estado:\*\* Aceptado"
  docs/adr/ADR-056.md` devuelve una línea tras el archivo.
- [ ] 7.7 [infra] Ventana de fusión del PR de apply (Q1), justo antes de fusionar. Con Q1 = (a) o (e):
  1. **Fuente del estado de 35b**: una confirmación escrita y fechada del owner en la conversación del PR, con la forma
     «11.6 hecha el AAAA-MM-DD; 10.7 no hecha». Las casillas de la 11.6 y la 10.7 se marcan en el PR de archivo de
     35b, después de invitar, así que **no** se leen de `main`; la rama de archivo de 35b, si existe, queda solo como
     apoyo.
  2. **PR-2 de 35b por su número**: `git fetch` y `git log --first-parent --oneline origin/main` volcado a fichero
     muestran, después del merge de #86 (PR-1), el merge del PR-2 de `staging-host` identificado por su número (`#NN`).
  3. **Resultado**: «en ventana» solo si el PR-2 está en `main`, el owner declara la 11.6 hecha y la 10.7 no hecha;
     cualquier otra combinación es «fuera de ventana» y no se fusiona. La 9.4 de `e2e-suite` se repite sobre el commit
     desplegado con este change antes de la 10.7.

  Con Q1 = (d), la autorización del owner anotada en 0.1 sustituye a los puntos 1-3. Verificar: la cita de la
  confirmación del owner, el volcado de `git log` con el número del PR-2 y el resultado quedan en la descripción del
  PR. Falsación: aplicar la regla del punto 3 a una confirmación de prueba que declara la 10.7 hecha y obtener «fuera
  de ventana»; ídem con la 11.6 no hecha.
- [ ] 7.8 [infra] PR de archivo de este change. Las anotaciones posteriores a la fusión del PR de apply (números de PR,
  hashes de commit, el paso de ADR-056 a «Aceptado» de 7.6) viajan **en este PR**, nunca en un push suelto a `main`
  tras la fusión. Como también despliega staging, se fusiona **después de la 10.7 de 35b** y **fuera de los días 7 y
  14** de su medición, con la misma guardia de 7.7: confirmación escrita y fechada del owner en el PR («10.7 hecha el
  AAAA-MM-DD; hoy es el día N de la medición») y resultado «en ventana» solo si la 10.7 está hecha y N no es 7 ni 14.
  Verificar: la cita del owner y el resultado en la descripción del PR de archivo. Falsación: aplicar la regla a una
  confirmación de prueba con la 10.7 no hecha, o con N = 7, y obtener «fuera de ventana».
