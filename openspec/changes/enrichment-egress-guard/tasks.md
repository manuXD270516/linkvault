## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos uno. La falsación de un guardia se hace, se ve caer el test
nombrado y se restaura en la misma tarea.

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada con fecha en ADR-056 §1 (línea que empieza por «Respuesta del
  owner (Q1), AAAA-MM-DD:») y, en una línea, en ADR-048 §Consecuencias bajo las excepciones de ADR-053 y ADR-055; con
  Q1 = (a), una fila «∥ 35b» en `docs/design-v0.2.md` §6, como la de `usage-guide-fixes`. Si
  Q1 = (b), el change no pasa de aquí hasta archivar 35c; si Q1 = (c), se vuelve a `/lv:debate` para fundirlo con
  `staging-host`. Verificar: `grep -c "Respuesta del owner (Q1), 20" docs/adr/ADR-056.md` devuelve `1` (hoy `0`) y
  `grep -c "ADR-056" docs/adr/ADR-048.md` devuelve al menos `1` (hoy `0`).
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada en
  `design.md` con su fecha. Verificar: la sección del debate de la última iteración dice «Convergencia: SI».

## 1. Clasificador compartido (`libs/shared`, design D1, D2, D8)

- [ ] 1.1 [backend] `ipaddr.js` como dependencia directa (la versión del lockfile, sin `minimumReleaseAgeExclude`) y
  `libs/shared/src/net/egress-address.ts` con `classifyAddress` para **IPv4**, exportado desde el índice. Verificar en
  `egress-address.spec.ts`, una tabla con dentro/borde/fuera por rango de la spec: «classifies every non-public IPv4
  range of the spec», «classifies a public IPv4 address as public» y «classifies the limited broadcast address as
  broadcast». Falsación: quitar `100.64.0.0/10` de la tabla de rangos y ver caer el primero; restaurar.
- [ ] 1.2 [backend] `classifyAddress` para **IPv6**: `::`, `::1`, `::/96`, `::ffff:0:0/96`, `100::/64`, `2001:db8::/32`,
  `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`, y la IPv4 interna de `64:ff9b::/96` y `2002::/16`. Verificar:
  «classifies every non-public IPv6 range of the spec», «rejects an IPv4-mapped IPv6 address whatever it embeds»,
  «classifies a translated IPv6 address by its embedded IPv4» (pública → `public`, privada → `private`). Falsación:
  clasificar `64:ff9b::/96` entero como `reserved` y ver caer el tercero; restaurar.
- [ ] 1.3 [backend] `classifyHost(hostname)` (literal IPv4, literal IPv6 con o sin corchetes, `dotless` tras quitar el
  punto final, `localhost` y `*.localhost`, `name`) e `isEgressAllowed(class, { allowPrivateTargets })` con la política
  de D8. Verificar: «treats a single-label host as dotless with or without a trailing dot», «treats localhost
  subdomains as localhost», «classifies alternative IPv4 notations after WHATWG URL parsing» (el caso pasa por
  `new URL(...).hostname`), «allowPrivateTargets allows loopback and private ranges» y «allowPrivateTargets still
  rejects link-local, unspecified, multicast and broadcast». Falsación: hacer que `allowPrivateTargets` permita
  `link_local` y ver caer el último; restaurar.
- [ ] 1.4 [backend] `unsafe_destination` en `enrichmentFailureReasonSchema` y en `NON_RETRYABLE_ENRICHMENT_REASONS`
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
- [ ] 2.2 [backend] `createGuardedFetch({ policy, resolve? })` en `egress/guarded-fetch.ts`: `fetch` y `Agent` del
  paquete `undici`, `connect: { lookup }` de 2.1, comprobación previa de `classifyHost` del host de cada petición (para
  literales y nombres sin punto) y dispatcher explícito sin proxy del entorno. Devuelve un `HttpFetch`. Verificar en
  `guarded-fetch.int.spec.ts`, con un servidor HTTP en loopback que **cuenta conexiones** y nombres de `.test`
  resueltos por un resolvedor inyectado: «a name resolving to loopback opens no connection», «a literal loopback host
  opens no connection», «a dotless host is rejected without resolving», «with allowPrivateTargets a loopback page is
  fetched» y «ignores proxy variables in the environment». Falsación: quitar el `lookup` del `Agent` y ver caer el
  primero (el servidor cuenta una conexión); quitar la comprobación previa y ver caer el segundo; restaurar.
- [ ] 2.3 [backend] Cambio de DNS entre comprobación y conexión. Verificar en `guarded-fetch.int.spec.ts`: «connects to
  the address approved in the same resolution» (resolvedor que responde distinto en la primera y la segunda consulta,
  con contador) y «a later hop resolving to a private address opens no connection». Falsación: resolver otra vez el
  nombre fuera del `lookup` (simulando un pre-chequeo separado) y ver caer el primero; restaurar.
- [ ] 2.4 [backend] `EGRESS_ALLOW_PRIVATE_TARGETS` en `worker-config.schema.ts` (booleano, por defecto `false`, mismo
  parser de booleanos que `FEATURE_HEADLESS_EXTRACTION`), error en `superRefine` con `NODE_ENV=production`, `warn` de
  arranque sin datos de usuario cuando está encendida, y `apps/worker/src/test-support/test-config.ts` con `false`.
  Verificar en el spec del esquema: «EGRESS_ALLOW_PRIVATE_TARGETS=true fails in production naming the variable»,
  «EGRESS_ALLOW_PRIVATE_TARGETS defaults to false» y «EGRESS_ALLOW_PRIVATE_TARGETS=true is accepted in development».
  Falsación: quitar la rama de producción del `superRefine` y ver caer el primero; restaurar.

## 3. Descarga de la página (design D4)

- [ ] 3.1 [backend] `PageFetchFailureReason` con `unsafe_destination` (y la categoría en el fallo, para el registro);
  `HttpPageFetcher` traduce `EgressBlockedError` (venga de la comprobación previa o del `lookup`, en cualquier salto) a
  `unsafe_destination`, y un error de resolución a `http_error`. Verificar en `http-page-fetcher.spec.ts` con dobles de
  `HttpFetch`: «maps an egress rejection to unsafe_destination», «maps an egress rejection on a redirect hop to
  unsafe_destination» y «a name that does not resolve stays http_error». Falsación: tratar todo error de red como
  `http_error` y ver caer el primero; restaurar.
- [ ] 3.2 [backend] `enrichment.module.ts`: `PAGE_FETCHER` y el fetcher del `robots.txt` construidos sobre **un mismo**
  `createGuardedFetch` con la política de `WorkerConfig`; nada del módulo usa el `fetch` global. Verificar:
  `grep -nE "\bfetch as HttpFetch\b|[^.]\bfetch\(" apps/worker/src/modules/enrichment --include=*.ts -r | grep -v spec`
  no devuelve líneas, y en `enrichment.module.spec.ts` (o el spec de arranque del worker): «page and robots fetchers
  share the guarded transport». Falsación: devolver `fetch as HttpFetch` al `PAGE_FETCHER` y ver el `grep` con una
  línea; restaurar.
- [ ] 3.3 [backend] Registro del rechazo en el caso de uso del enriquecimiento: `warn` con `linkId`, `stage` y
  `category`, sin URL, host ni dirección. Verificar en el spec del caso de uso con un logger que captura: «logs an
  unsafe destination with linkId, stage and category only» (afirma que ningún campo serializado contiene la URL ni el
  host del link). Falsación: añadir `url` al objeto del `warn` y ver caer el test; restaurar.
- [ ] 3.4 [backend] Escenarios del motivo. Verificar: en el spec del caso de uso del worker, «an internal page leaves
  the link failed with unsafe_destination»; en `request-link-enrichment.usecase.spec.ts` (API), «retry of an
  unsafe_destination link answers 409 and requests nothing»; en el spec de cierre por relectura de frescura, «a
  freshness re-check ending in unsafe_destination does not close the job». Falsación: sacar `unsafe_destination` de
  `NON_RETRYABLE_ENRICHMENT_REASONS` y ver caer el segundo; restaurar.

## 4. `robots.txt` (design D5)

- [ ] 4.1 [backend] `createHttpRobotsFetcher` recibe el `HttpFetch` guardado y sigue redirecciones a mano: hasta cinco
  saltos, también a otro host, un `AbortSignal.timeout` para la cadena entera; más saltos o `EgressBlockedError` →
  `null`. Verificar en `http-robots-fetcher.spec.ts` (nuevo) con dobles: «follows up to five redirects», «does not
  request a sixth redirect target», «follows a redirect to another public host and returns its rules» y «returns null
  when a hop is rejected by the egress guard». Falsación: volver a `redirect: 'follow'` y ver caer el segundo y el
  cuarto; restaurar.
- [ ] 4.2 [backend] Lectura del cuerpo por trozos con corte al pasar `ROBOTS_MAX_BYTES` (lo que no cabe → cuerpo
  vacío, como hoy). Verificar: «stops reading a robots body over the cap without a content-length» (el doble cuenta
  los trozos leídos y afirma que no se leyó hasta el final) y «returns no rules for an oversized robots body».
  Falsación: volver a `response.text()` y ver caer el primero; restaurar.
- [ ] 4.3 [backend] Integración con el guardia real. Verificar en `guarded-fetch.int.spec.ts`: «a robots redirect to an
  internal address opens no connection to it» (el servidor de destino cuenta cero conexiones y `RedisCachedRobots`
  decide permitido). Falsación: construir el fetcher del `robots.txt` con el `fetch` global y ver caer el test;
  restaurar.

## 5. Rechazo sintáctico en la API (design D6, D8)

- [ ] 5.1 [backend] `EGRESS_ALLOW_PRIVATE_TARGETS` en `api-config.schema.ts` con la misma regla de producción y el mismo
  `warn`, y `apps/api/src/test-support/test-config.ts` con `false`. Verificar en el spec del esquema de la API:
  «EGRESS_ALLOW_PRIVATE_TARGETS=true fails in production naming the variable». Falsación: quitar la rama de producción
  y ver caer el test; restaurar.
- [ ] 5.2 [backend] Rechazo como no reconocida de hosts sin punto, `localhost`/`*.localhost` y literales no públicos,
  con el clasificador de 1.3 y la política inyectada por token (el dominio no lee configuración). Verificar en
  `url.spec.ts` (o el spec del caso de uso que aplique la política): «rejects a literal private or loopback host as
  unrecognized», «rejects a dotless host as unrecognized», «accepts localhost with allowPrivateTargets»; en
  `save-link.usecase.spec.ts`: «saving an internal literal host answers invalid_url and creates nothing»; en
  `import-links.usecase.spec.ts`: «an internal URL in an import counts as unrecognized». Falsación: no aplicar la
  política en `normalizeUrl` y ver caer los tres primeros; restaurar.
- [ ] 5.3 [backend] Sin DNS al guardar. Verificar en `url.spec.ts`: «does not resolve names when saving» con
  `vi.mock('node:dns')` y `node:dns/promises` sin llamadas. Falsación: añadir una llamada a `dns.lookup` en la ruta
  de guardado y ver caer el test; restaurar.

## 6. Push (design D7)

- [ ] 6.1 [backend] `libs/shared/src/notifications/push-services.ts` con la lista de D7 e `isKnownPushEndpoint(url)`
  (`https`, sin credenciales, puerto 443 o ausente, host exacto o sufijo con punto), y el `refine` de
  `pushSubscriptionRequestSchema` con `path: ['endpoint']`. Verificar en `notifications.schema.spec.ts`: «accepts an
  endpoint of each known push service», «rejects an unknown push host», «rejects http and non-443 ports on a known
  host» y «rejects a host that ends with a known suffix without a label boundary». Falsación: comparar con
  `endsWith(sufijo)` sin el punto y ver caer el último; restaurar.
- [ ] 6.2 [backend] API: los fixtures de push de `apps/api/**` pasan a hosts de la lista. Verificar en el spec del
  controlador o de `register-push-subscription.usecase.spec.ts`: «an unknown push endpoint answers 400 validation_error
  naming endpoint and stores nothing». Falsación: quitar el `refine` de 6.1 y ver caer el test; restaurar.
- [ ] 6.3 [backend] `WebPushVapidSender` recibe la política de endpoints por constructor (por defecto
  `isKnownPushEndpoint`); un endpoint que no la cumple se borra con `deleteEndpoint` sin llamar a `web-push` y se
  registra sin el endpoint. Los specs que hoy usan servidores locales inyectan una política permisiva. Verificar en
  `web-push-sender.spec.ts`: «deletes a stored subscription outside the known push services without connecting» (el
  servidor local cuenta cero conexiones y el registro capturado no contiene el endpoint). Falsación: saltarse la
  comprobación con la política por defecto y ver caer el test; restaurar.
- [ ] 6.4 [infra] Comprobación manual de la lista en local (`pnpm infra:up`, `nx serve api`, `nx serve web`) con los
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
- [ ] 7.3 [backend] Ensayo de la reversión (Migration Plan 3) en la pila local: un link con
  `lastEnrichmentError.reason = unsafe_destination`, la actualización a `http_error` con `mongosh` y la lectura del link
  con el commit anterior (`GET /api/links/mine` en `200`). Verificar: la orden exacta y el resultado quedan en la
  descripción del PR.
- [ ] 7.4 [infra] Camino crítico e2e sin regresión: `pnpm nx run web-e2e:e2e-stack -- --project=chromium` (perfil `local`) en
  verde, con el link del host `.invalid` terminando como antes (`http_error`). Verificar: salida del comando anotada en
  el PR.
- [ ] 7.5 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salida anotada en el PR.
- [ ] 7.6 [infra] `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en verde.
  Al archivar, ADR-056 pasa a «Aceptado» con la fecha y el PR. Verificar: `grep -n "^\*\*Estado:\*\* Aceptado"
  docs/adr/ADR-056.md` devuelve una línea tras el archivo.
