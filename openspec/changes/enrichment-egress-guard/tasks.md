## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos uno. La falsación de un guardia se hace, se ve caer el test
nombrado y se restaura en la misma tarea. Un test de «no abre conexión» afirma además que la causa es
`EgressBlockedError` **con su categoría** (design D1) y tiene en su fichero un control positivo que abre exactamente
una conexión (design D10). Los tests que necesitan un servidor local inyectan una `EgressPolicy` de test completa
(`allowsHost`, `allowsAddress`, `allowsPort`) y **nombrada** desde `apps/worker/src/test-support/` (design D8):
`PERMISSIVE_TEST_POLICY` para los controles positivos, `PUBLIC_WITH_ANY_PORT_TEST_POLICY` (la pública salvo
`allowsPort`, que admite el puerto efímero) para los negativos de host y de dirección, `LOOPBACK_BY_NAME_TEST_POLICY`
(aprueba el `loopback` resuelto desde un nombre y rechaza el literal `loopback`) para las redirecciones y el cambio de
DNS, y `PUBLIC_EGRESS_POLICY` tal cual para el negativo de puerto. No hay variable de entorno que abra ninguna.

- [x] 0.1 [infra] Q1 respondida por el owner y anotada con fecha en ADR-056 §1 (línea que empieza por «Respuesta del
  owner (Q1), AAAA-MM-DD:») y, en una línea, en ADR-048 §Consecuencias bajo las excepciones de ADR-053 y ADR-055, línea que repite la condición «la 10.7 de 35b solo procede con la 9.4 en verde sobre el último hash desplegado», que además se pide en la confirmación del owner previa a la 10.7; con
  Q1 = (a) o (e), una fila «∥ 35b (fusión tras su 11.6, antes de su 10.7)» en `docs/design-v0.2.md` §6, como la de
  `usage-guide-fixes`. Si Q1 = (b), el change no pasa de aquí hasta archivar 35c; si Q1 = (c), se vuelve a
  `/lv:debate` para fundirlo con `staging-host`; si Q1 = (d), la autorización expresa del owner a la excepción de «entre
  PR-1 y PR-2» de 35b, con su riesgo para la 6.3 aceptado por escrito, se anota en la misma línea. Verificar:
  `grep -c "Respuesta del owner (Q1), 20" docs/adr/ADR-056.md` devuelve `1` (hoy `0`) y
  `grep -c "ADR-056" docs/adr/ADR-048.md` devuelve al menos `1` (hoy `0`). **Estado (2026-10-29):** Q1 = (a) («Toma las recomendaciones»), anotada en ADR-056 §1, en design.md (Open Questions y «Respuestas del owner y aprobación»), en ADR-048 §Consecuencias (línea de la excepción de ADR-056, con la condición de la 9.4 sobre el último hash) y en `docs/design-v0.2.md` §6 (fila «∥ 35b (fusión tras su 11.6, antes de su 10.7)»). `grep -c "Respuesta del owner (Q1), 20" docs/adr/ADR-056.md` devuelve `1`; `grep -c "ADR-056" docs/adr/ADR-048.md` devuelve `1`.
- [x] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada en
  `design.md` con su fecha. Verificar: la sección del debate de la última iteración dice «Convergencia: SI». **Estado (2026-10-29):** iteración 3 más verificación puntual con «Convergencia: SI» (critic P0 0, business V0 0); aprobación del owner del 2026-10-29 en la sección «Respuestas del owner y aprobación» de design.md.

## 1. Clasificador compartido (`libs/shared`, design D1, D2)

- [ ] 1.1 [backend] `ipaddr.js` como dependencia directa en `dependencies` del `package.json` raíz (la versión del
  lockfile, sin `minimumReleaseAgeExclude`) y
  `libs/shared/src/net/egress-address.ts` con `classifyAddress` para **IPv4**, publicado por la subruta
  `@linkvault/shared/net` (`libs/shared/src/net/index.ts` y su entrada en `tsconfig.base.json`), **no** desde el índice
  de `@linkvault/shared`. Verificar en `egress-address.spec.ts`, con una tabla de literales **copiados a mano de la
  spec** (dentro, borde y fuera por rango; el spec no importa ninguna tabla de la implementación): «classifies every
  non-public IPv4 range of the spec», «classifies a public IPv4 address as public» y «classifies the limited broadcast
  address as broadcast». Además, `pnpm nx run web:build` sin avisos nuevos respecto de `main` (salida comparada y
  anotada en el PR) y `grep -rn "shared/net" apps/web/src` sin resultados. Tras `pnpm nx run api:build` y
  `pnpm nx run worker:build` (P1-4): `dist/apps/api/package.json` y `dist/apps/worker/package.json` contienen
  `ipaddr.js` y ninguno contiene `selfsigned` (`grep -c` anotado en el PR). Falsación: quitar `100.64.0.0/10` de la
  tabla de rangos de la implementación y ver caer el primero; restaurar. **Estado (2026-10-29):** parcial. Hecho: `ipaddr.js` 2.5.0 en `dependencies` raíz (versión del lockfile), `libs/shared/src/net/` publicado por `@linkvault/shared/net` (entrada en `tsconfig.base.json`), `egress-address.spec.ts` con los tres tests nombrados en verde (117 tests de `net`+`preview` en verde con `pnpm nx run shared:test --skip-nx-cache`), `grep -rn "shared/net" apps/web/src` sin resultados y `pnpm nx run web:build` sin avisos propios (el único es el presupuesto de bundle inicial, ya existente; web no importa la subruta). Falsación hecha: sin `100.64.0.0/10` cae «classifies every non-public IPv4 range of the spec» (`100.64.0.0/10 first: expected 'public' to be 'shared_cgnat'`); restaurada. **Pendiente**: la comprobación de `dist/apps/api/package.json` (`ipaddr.js`) y la de `selfsigned` solo tienen sentido cuando la API importe la subruta (5.1); hoy la API no la usa. En `dist/apps/worker/package.json` `ipaddr.js` ya figura y `selfsigned` no.
- [x] 1.2 [backend] `classifyAddress` para **IPv6** con lista de permitidos: público solo dentro de `2000::/3` y fuera
  de los rangos de la spec (`::`, `::1`, `::/96`, `::ffff:0:0/96`, `100::/64`, `2001::/23`, `2001:db8::/32`,
  `3fff::/20`, `fc00::/7`, `fe80::/10`, `fec0::/10`, `ff00::/8`), y la IPv4 interna de `64:ff9b::/96` y `2002::/16`.
  Verificar, con literales copiados de la spec: «classifies every non-public IPv6 range of the spec» (incluye
  `2001::/23` y `3fff::/20`), «rejects an IPv6 address outside 2000::/3 that is not a translation prefix», «rejects an
  IPv4-mapped IPv6 address whatever it embeds» y «classifies a translated IPv6 address by its embedded IPv4» (pública →
  `public`, privada → `private`). Falsación: aceptar como `public` todo lo que no esté en la lista de prohibidos (sin
  la condición de `2000::/3`) y ver caer el segundo; quitar `3fff::/20` de la implementación y ver caer el primero;
  clasificar `64:ff9b::/96` entero como `reserved` y ver caer el cuarto; restaurar. **Estado (2026-10-29):** `classifyAddress` IPv6 por lista de permitidos (`2000::/3` menos los rangos enumerados; traducción `64:ff9b::/96` y `2002::/16` por su IPv4). Los cuatro tests nombrados en verde. Falsaciones hechas: sin la condición de `2000::/3` cae «rejects an IPv6 address outside 2000::/3 that is not a translation prefix» (`4000::1: expected 'public' to be 'reserved'`); sin `3fff::/20` cae «classifies every non-public IPv6 range of the spec»; `64:ff9b::/96` entero como `reserved` cae «classifies a translated IPv6 address by its embedded IPv4»; restauradas. Decisión menor dentro de la lista cerrada de clases: `::/96` (compatibles) se clasifica `ipv4_mapped`, igual que `::ffff:0:0/96`.
- [x] 1.3 [backend] `classifyHost(hostname)` sobre el `hostname` **sin corchetes** (literal IPv4, literal IPv6, `dotless`
  tras quitar el punto final, `localhost` y `*.localhost`, `name`) y la interfaz `EgressPolicy` (`allowsHost`,
  `allowsAddress`, `allowsPort`) con su implementación `PUBLIC_EGRESS_POLICY` para hosts y direcciones. Verificar:
  «treats a single-label host as dotless with or without a trailing dot», «treats localhost subdomains as localhost»,
  «classifies alternative IPv4 notations after WHATWG URL parsing» (el caso pasa por `new URL(...).hostname`),
  «classifies an IPv6 literal hostname once its brackets are stripped», «the public policy allows only names and public
  literals» y «the public policy allows only public addresses». Falsación: hacer que `PUBLIC_EGRESS_POLICY` permita
  `dotless` y ver caer el quinto; que permita `link_local` y ver caer el sexto; restaurar. **Estado (2026-10-29):** `classifyHost`, `EgressPolicy`, `PUBLIC_EGRESS_POLICY` y `hostRejectionCategory` (categoría de un host rechazado, design D1). Los seis tests nombrados en verde. Falsaciones hechas: permitir `dotless` cae «the public policy allows only names and public literals»; permitir `link_local` cae «the public policy allows only public addresses»; restauradas. `hostRejectionCategory` (helper añadido en `egress-address.ts`): devuelve la categoría de rechazo de un host (la clase del literal, `dotless` o `localhost`) y es lo que usa el conector del worker; aceptado por reflect.
- [x] 1.4 [backend] `allowsPort(protocol, port, hostClass)` de `PUBLIC_EGRESS_POLICY`: puerto ausente u `80`/`443`, sea
  cual sea la clase del host; la decisión no depende de ninguna dirección resuelta. El puerto llega como cadena (la de
  `URL.port`, vacía si es el de por defecto), como número o ausente, según quién llame (P1-2). Verificar, con una
  tabla escrita en el test: «allows the default port and explicit 80 and 443 in every representation» (`''`,
  `undefined`, `'80'`, `80` y `'443'`, cada uno con `http:` y `https:` y con hosts `name` y literal público) y
  «rejects any other port whatever the host class». Falsación: devolver `true` para cualquier puerto en un host
  `name` y ver caer el segundo; tratar `''` como un puerto explícito no web y ver caer el primero; restaurar. **Estado (2026-10-29):** `allowsPort` de `PUBLIC_EGRESS_POLICY` (ausente, `''`, `'80'`, `80`, `'443'`, `443`; resto rechazado, incluidas formas no canónicas como `'080'`). Los dos tests nombrados en verde. Falsaciones hechas: `true` para cualquier puerto en un host `name` cae «rejects any other port whatever the host class»; tratar `''` como explícito no web cae «allows the default port and explicit 80 and 443 in every representation»; restauradas.
- [x] 1.5 [backend] `unsafe_destination` en `enrichmentFailureReasonSchema` y en `NON_RETRYABLE_ENRICHMENT_REASONS`
  (`libs/shared/src/schemas/preview.schema.ts`), con su línea en el comentario de la lista. Verificar en
  `preview.schema.spec.ts`: «unsafe_destination is a known enrichment failure reason» y «unsafe_destination is not
  retryable». Falsación: quitarlo de `NON_RETRYABLE_ENRICHMENT_REASONS` y ver caer el segundo; restaurar. **Estado (2026-10-29):** `unsafe_destination` en `enrichmentFailureReasonSchema` y `NON_RETRYABLE_ENRICHMENT_REASONS`, con su línea en los comentarios. «unsafe_destination is a known enrichment failure reason» y «unsafe_destination is not retryable» en verde (y las listas cerradas del spec existente actualizadas). Falsación hecha: quitarlo de `NON_RETRYABLE_ENRICHMENT_REASONS` cae «unsafe_destination is not retryable» (y «only refuses a retry…»); restaurada.

## 2. Guardia de salida del worker (design D3, D8)

- [x] 2.1 [backend] `undici` en `dependencies` y `selfsigned` en `devDependencies` del `package.json` raíz (las dos
  con la versión del lockfile, sin `minimumReleaseAgeExclude`; `selfsigned` se importa solo desde ficheros `*.spec.ts`,
  nunca desde `test-support/`, que el build cuenta como código de producción), las tres políticas de test
  nombradas de design D8 en `apps/worker/src/test-support/` y
  `apps/worker/src/infrastructure/egress/egress-lookup.ts`: `createEgressLookup(resolve, policy)` con la firma de
  `lookup` de `net` (honra `all` y `family`), que resuelve una vez, clasifica **todas** las direcciones con
  `allowsAddress` y devuelve o todas o `EgressBlockedError` (solo la categoría). Un `ENOTFOUND` del resolvedor se
  propaga tal cual. Verificar en `egress-lookup.spec.ts` con un resolvedor inyectado: «rejects when any resolved
  address is not public», «returns exactly the approved addresses», «honours the all option», «propagates a resolution
  failure unchanged» y «calls the resolver once per lookup»; el primero afirma también la categoría (la clase de la
  dirección rechazada). Tras `pnpm nx run worker:build` (P1-4): `dist/apps/worker/package.json` contiene `undici` e
  `ipaddr.js` y no contiene `selfsigned` (`grep -c` anotado en el PR). Falsación: devolver solo las direcciones
  públicas en vez de rechazar y ver caer el primero; importar `selfsigned` desde un fichero de `test-support/`, volver
  a construir y ver aparecer `selfsigned` en `dist/apps/worker/package.json`; restaurar. **Estado (2026-10-29):** `undici` 7.29.1 en `dependencies` y `selfsigned` 5.5.0 en `devDependencies` (versiones del lockfile), las tres políticas nombradas en `apps/worker/src/test-support/egress-policies.ts`, `EgressBlockedError`/`findEgressBlocked`, `egress-lookup.ts` y los cinco tests de `egress-lookup.spec.ts` en verde. Falsación hecha: devolver solo las públicas en vez de rechazar cae «rejects when any resolved address is not public»; restaurada. Con el guardia ya cableado (3.2), tras `pnpm nx run worker:build`: `dist/apps/worker/package.json` contiene `undici` e `ipaddr.js` y no `selfsigned` (`grep -c` = 1, 1, 0). Nota sobre la falsación de `selfsigned`: importarlo desde `test-support/` (o desde un fichero alcanzable) NO lo hace aparecer mientras esté en `devDependencies`, porque el generador del `package.json` descarta las dependencias de desarrollo de la raíz (0 coincidencias en ambos casos); el guardia es esa colocación. Falsación equivalente ejecutada: con `selfsigned` movido a `dependencies`, importado desde un fichero alcanzable y también desde `test-support/`, aparece en `dist/apps/worker/package.json` (`grep -c` = 1 en los dos casos); restaurado a `devDependencies` (0).
- [x] 2.2a [backend] Conector guardado en `egress/guarded-connector.ts`: envuelve `buildConnector({ lookup })` de
  `undici`; antes de delegar clasifica el host recibido sin corchetes (`classifyHost`, `allowsHost`) y el puerto
  (`allowsPort`) y, si no pasan, llama al callback con `EgressBlockedError` sin abrir socket. Verificar en
  `guarded-fetch.int.spec.ts`, con un servidor HTTP en loopback que **cuenta conexiones** y nombres de `.test`
  resueltos por un resolvedor inyectado. Cada negativo afirma cero conexiones, `EgressBlockedError` y su categoría
  (P0-2):
  - con `PUBLIC_WITH_ANY_PORT_TEST_POLICY`: «a name resolving to loopback opens no connection» (categoría
    `loopback`), «a literal loopback host opens no connection» (categoría `loopback`, la clase del literal) y «a
    dotless host is rejected without resolving» (categoría `dotless`; el resolvedor cuenta cero llamadas);
  - con `PUBLIC_EGRESS_POLICY`: «a non-web port opens no connection» (nombre `.test` resuelto al servidor en el puerto efímero; categoría `port`, y el resolvedor cuenta 0 llamadas porque el puerto se decide antes de resolver)
    y «with the public policy a default-port name reaches the resolver» (P1-2: URL sin puerto de un nombre `.test`,
    resolvedor inyectado que responde `ENOTFOUND`; el resolvedor cuenta una llamada y la causa es `ENOTFOUND`, no
    `EgressBlockedError`);
  - con `PERMISSIVE_TEST_POLICY`, el control positivo «with a permissive test policy a loopback page is fetched over
    exactly one connection».

  Falsación: quitar el `lookup` del conector base y ver caer el primero por la causa (`ENOTFOUND` en lugar de
  `EgressBlockedError`); quitar la clasificación del host en el conector y ver caer el segundo; hacer que el conector
  rechace todo puerto que no venga como número y ver caer «with the public policy a default-port name reaches the
  resolver» (la causa pasa a `EgressBlockedError` con categoría `port`); restaurar. **Estado (2026-10-29):** `guarded-connector.ts` sobre `buildConnector({ lookup })`, clasificando host y puerto antes de abrir socket. Los seis tests de `guarded-fetch.int.spec.ts` en verde (cada negativo afirma cero conexiones, `EgressBlockedError` y categoría exacta; el de puerto y el de nombre sin punto, cero llamadas al resolvedor). Falsaciones hechas: sin `lookup` en el conector base cae «a name resolving to loopback opens no connection» (causa `ENOTFOUND`); sin clasificar el host caen «a literal loopback host opens no connection» y «a dotless host is rejected without resolving»; rechazar el puerto `''` cae «with the public policy a default-port name reaches the resolver»; restauradas.
- [x] 2.2b [backend] `createGuardedFetch({ policy, resolve?, tls? })` en `egress/guarded-fetch.ts`: `fetch` y `Agent`
  del paquete `undici` con `connect` = conector de 2.2a y `allowH2: false`; fuerza `redirect: 'manual'` en cada
  petición; dispatcher explícito, sin proxy del entorno. Devuelve un `HttpFetch`. Verificar en
  `guarded-fetch.int.spec.ts`: «a followed redirect to a literal loopback opens no connection», con
  `LOOPBACK_BY_NAME_TEST_POLICY` (P0-2: aprueba el `loopback` resuelto desde un nombre y rechaza el literal
  `loopback`): un nombre `.test` que resuelve al primer servidor, que redirige a un literal de loopback donde escucha
  otro servidor contador; con `redirect: 'follow'` pedido por el llamador y siguiéndolo a mano, el primero cuenta una,
  el segundo cuenta cero y la causa es `EgressBlockedError` con categoría `loopback`; «forces manual redirects whatever
  the caller asks» (`PERMISSIVE_TEST_POLICY`) e «ignores proxy variables in the environment» (`PERMISSIVE_TEST_POLICY`;
  proxy HTTP local contador en `HTTP_PROXY`/`HTTPS_PROXY`: cuenta cero y el destino cuenta una).
  Falsación: usar `EnvHttpProxyAgent` como dispatcher y ver caer el tercero (el proxy cuenta una); quitar el forzado de
  `redirect` y ver caer el segundo; restaurar. **Estado (2026-10-29):** `createGuardedFetch({ policy, resolve?, tls? })` con `fetch`/`Agent` de `undici`, `allowH2: false`, `redirect: 'manual'` forzado y dispatcher explícito (más `close()`). Los tres tests nombrados en verde. Falsaciones hechas: `EnvHttpProxyAgent` como dispatcher cae «ignores proxy variables in the environment» (el proxy cuenta una conexión); quitar el forzado de `redirect` cae «forces manual redirects whatever the caller asks» (y la redirección de 2.2b); restauradas.
- [x] 2.2c [backend] Opción `tls?: { ca }` de `createGuardedFetch` (design D3, N4, P1-1): como pasar `ca` sustituye
  las raíces del sistema, el conector recibe `ca: [...tls.rootCertificates, ca]` (`node:tls`), las raíces de Node más
  la autoridad dada; sin `tls`, no pasa `ca` y quedan las raíces por defecto. Ninguna opción del guardia desactiva la
  verificación del certificado. Servidor TLS local con certificado de `selfsigned` generado en el test, con
  `PERMISSIVE_TEST_POLICY`. Verificar en `guarded-fetch.int.spec.ts`: «trusts a self-signed test server only through
  the given ca» (control positivo: una conexión), «rejects a self-signed server when no ca is given» (la petición falla
  por el certificado) y «keeps the system roots when a test ca is given» (con un doble de `buildConnector` que captura
  sus opciones: el `ca` recibido contiene cada certificado de `tls.rootCertificates` y además el dado). Falsación:
  hacer que la opción `tls` desactive la verificación en lugar de añadir la autoridad y ver caer el segundo; pasar
  `ca` sin las raíces del sistema y ver caer el tercero; restaurar. **Estado (2026-10-29):** Opción `tls?: { ca }`: el conector recibe `ca: [...tls.rootCertificates, ca]`; sin `tls` no pasa `ca`. Certificado generado en el test con `selfsigned` (solo desde `*.spec.ts`). Los tres tests nombrados en verde. Falsaciones hechas: desactivar la verificación cae «rejects a self-signed server when no ca is given»; pasar `ca` sin las raíces cae «keeps the system roots when a test ca is given»; restauradas.
- [x] 2.3 [backend] Cambio de DNS entre comprobación y conexión (design D10, reescrita por P0-1 sin tocar la
  interfaz: `.2` y `.3` son las dos `loopback`, y ninguna política por clases aprueba una y rechaza la otra). Los dos
  tests usan `LOOPBACK_BY_NAME_TEST_POLICY`, que aprueba `loopback` y admite el puerto efímero. Verificar en
  `guarded-fetch.int.spec.ts`:
  - «connects to the address approved in the same resolution»: dos servidores contadores en `127.0.0.2` y
    `127.0.0.3`, y un resolvedor que responde `.2` en la primera consulta y `.3` en la segunda, con contador. La prueba
    es una consulta por conexión: el resolvedor cuenta una, `.2` cuenta una conexión y `.3` cuenta cero;
  - «a later hop resolving to a private address opens no connection»: un nombre `.test` cuyo primer salto resuelve a
    `127.0.0.2`, que redirige dentro del mismo host (el test sigue la redirección a mano, como en 2.2b, porque el guardia fuerza `redirect: 'manual'`) y responde con `Connection: close` (para que el segundo salto abra
    su propia conexión en lugar de reutilizar la aprobada); para la conexión del segundo salto el resolvedor devuelve una
    dirección de clase `private`. Se afirma que `.2` cuenta una conexión, que no hay conexión del segundo salto y que la
    causa es `EgressBlockedError` con categoría `private`.

  Si el sistema local no admite esas direcciones, el test se salta con motivo escrito (nunca en CI, design R10).
  Falsación: resolver otra vez el nombre fuera del `lookup` (simulando un pre-chequeo separado) y ver caer el primero
  (el resolvedor cuenta dos y `.3` cuenta una); clasificar solo la primera resolución de cada host y ver caer el
  segundo; restaurar. **Estado (2026-10-29):** Dos tests con `LOOPBACK_BY_NAME_TEST_POLICY` y servidores en `127.0.0.2`/`127.0.0.3` (se saltan con motivo escrito si el sistema no admite las direcciones y nunca en CI, R10); en esta máquina corren y pasan (19/19 en `infrastructure/egress`). Falsaciones hechas: segunda resolución fuera del `lookup` cae «connects to the address approved in the same resolution» (y «calls the resolver once per lookup»); clasificar solo la primera resolución de cada host cae «a later hop resolving to a private address opens no connection»; restauradas.

## 3. Descarga de la página (design D4, D10, D11)

- [x] 3.1 [backend] `PageFetchFailureReason` con `unsafe_destination` (y la categoría en el fallo, para el registro);
  `HttpPageFetcher` traduce `EgressBlockedError` (venga del conector o del `lookup`, en cualquier salto, buscándolo en
  la cadena de `cause` del error del cliente) a `unsafe_destination`, y un error de resolución a `http_error`. Verificar
  en `http-page-fetcher.spec.ts` con dobles de `HttpFetch`: «maps an egress rejection to unsafe_destination», «maps an
  egress rejection on a redirect hop to unsafe_destination» y «a name that does not resolve stays http_error».
  Falsación: tratar todo error de red como `http_error` y ver caer el primero; restaurar. **Estado (2026-10-29):** `PageFetchFailureReason` con `unsafe_destination` y `PageFetchFailure.category` (también `ExtractionFailed.category`, que `extract-preview.service` propaga); `HttpPageFetcher` busca `EgressBlockedError` en la cadena de `cause` en cualquier salto y lo traduce; el resto de errores de red sigue siendo `http_error`. Los tres tests nombrados en `http-page-fetcher.spec.ts` en verde. Falsación hecha: anular la rama del rechazo cae los dos primeros; restaurada.
- [x] 3.2 [backend] `enrichment.module.ts`: `PAGE_FETCHER` y el fetcher del `robots.txt` construidos sobre **un mismo**
  `createGuardedFetch` con `PUBLIC_EGRESS_POLICY`. En `eslint.config.mjs`, un bloque con `basePath` para
  `apps/worker/src/modules/enrichment/**` con `ignores: ['**/*.spec.ts']`, `no-restricted-globals` (`fetch`) y
  `no-restricted-imports` (`undici`, `node:http`, `node:https`, `http`, `https`); y, **al final del fichero**, otro
  bloque con `basePath` para `apps/worker/src/modules/enrichment/domain/**` con `DOMAIN_RESTRICTED_PATTERNS` más esas
  mismas rutas (ESLint no combina opciones entre bloques, ADR-017). El guardia vive en
  `apps/worker/src/infrastructure/egress/`, fuera del alcance. Verificar: `pnpm nx run worker:lint` en verde; en
  `enrichment.module.spec.ts` (o el spec de arranque del worker): «page and robots fetchers share the guarded
  transport». Falsación: devolver `fetch as HttpFetch` al `PAGE_FETCHER` y ver fallar `worker:lint` con
  `no-restricted-globals`; añadir un `import 'undici'` en un fichero de `enrichment/domain/` y ver fallar `worker:lint`;
  añadir un `import 'mongoose'` en ese mismo fichero y ver que la regla del dominio sigue fallando; restaurar. **Estado (2026-10-29):** `enrichment.module.ts`: un provider `ENRICHMENT_FETCH` (`createGuardedFetch` con `PUBLIC_EGRESS_POLICY`) que inyectan `PAGE_FETCHER` y `ROBOTS` (el fetcher del `robots.txt` recibe ahora el `HttpFetch`; sus redirecciones llegan en 4.1). `eslint.config.mjs`: bloque con `basePath` para `apps/worker/src/modules/enrichment/**` (`ignores: ['**/*.spec.ts']`, `no-restricted-globals` `fetch`, `no-restricted-imports` `undici`/`node:http`/`node:https`/`http`/`https`) y, al final del fichero, el de `enrichment/domain/**` con `DOMAIN_RESTRICTED_PATTERNS` más esas rutas. `pnpm nx run worker:lint` en verde (0 errores); «page and robots fetchers share the guarded transport» en `enrichment.module.spec.ts` en verde (los dos providers inyectan el mismo token y el transporte rechaza un literal de loopback con categoría `loopback`). Falsaciones hechas: `fetch as HttpFetch` en `PAGE_FETCHER` falla `eslint` con `no-restricted-globals`; `import 'undici'` en un fichero de `enrichment/domain/` falla con la regla de importaciones; `import 'mongoose'` en ese mismo fichero sigue fallando con el mensaje del dominio; restauradas. Encaje del tipo `GuardedFetch` con `HttpFetch`: verificado por typecheck (el guardia se inyecta directamente).
- [x] 3.3 [backend] Registro del rechazo en el caso de uso del enriquecimiento: `warn` con `linkId`, `stage: 'page'` y
  `category`, sin URL, host ni dirección. Verificar en el spec del caso de uso con un logger que captura: «logs an
  unsafe destination with linkId, stage and category only» (afirma que ningún campo serializado contiene la URL ni el
  host del link). Falsación: añadir `url` al objeto del `warn` y ver caer el test; restaurar. **Estado (2026-10-29):** `EnrichLinkUseCase` recibe un `EnrichLinkLogger` (por defecto `Logger` de Nest) y escribe un `warn` con `event`, `linkId`, `stage: 'page'` y `category` cuando el intento falla con `unsafe_destination`. «logs an unsafe destination with linkId, stage and category only» en verde. Falsación hecha: añadir `url` al objeto del `warn` cae el test; restaurada.
- [x] 3.4 [backend] Escenarios del motivo. Verificar: en el spec del caso de uso del worker, «an internal page leaves
  the link failed with unsafe_destination»; en `request-link-enrichment.usecase.spec.ts` (API), «retry of an
  unsafe_destination link answers 409 and requests nothing»; en el spec de cierre por relectura de frescura, «a
  freshness re-check ending in unsafe_destination does not close the job». Falsación: sacar `unsafe_destination` de
  `NON_RETRYABLE_ENRICHMENT_REASONS` y ver caer el segundo; restaurar. **Estado (2026-10-29):** En `enrich-link.usecase.spec.ts` «an internal page leaves the link failed with unsafe_destination»; en `request-link-enrichment.usecase.spec.ts` (API) «retry of an unsafe_destination link answers 409 and requests nothing»; en `freshness-close.spec.ts` «a freshness re-check ending in unsafe_destination does not close the job». Los tres en verde. Falsación hecha: sacar `unsafe_destination` de `NON_RETRYABLE_ENRICHMENT_REASONS` cae el de la API; restaurada.
- [x] 3.5 [backend] Integración del fetcher real sobre el guardia real (E8, B7). Verificar en
  `http-page-fetcher.int.spec.ts`, con `HttpPageFetcher` sobre el `createGuardedFetch` real, una política de test
  completa y nombrada por test (P0-2), servidores que cuentan conexiones y un resolvedor inyectado, en `http://`: «a
  host resolving to a blocked address ends in unsafe_destination with no connection» (`PUBLIC_WITH_ANY_PORT_TEST_POLICY`;
  el nombre resuelve al servidor de loopback, que cuenta cero; el fallo lleva la categoría `loopback`), «a name that
  does not resolve ends in http_error» (`PUBLIC_WITH_ANY_PORT_TEST_POLICY`) y el control positivo «an approved host is
  fetched over exactly one connection» (`PERMISSIVE_TEST_POLICY`); y **un único** caso en `https://`, con el servidor
  TLS de 2.2c confiado por `tls.ca` y `PERMISSIVE_TEST_POLICY`: «an approved https host is fetched over exactly one
  connection».
  Falsación: hacer que el fetcher no busque `EgressBlockedError` en la cadena de `cause` y ver caer el primero;
  restaurar. **Estado (2026-10-29):** `http-page-fetcher.int.spec.ts` con `HttpPageFetcher` sobre el `createGuardedFetch` real, servidores contadores y resolvedor inyectado: los tres casos de `http://` (`PUBLIC_WITH_ANY_PORT_TEST_POLICY` en los dos negativos, categoría `loopback` y cero conexiones; `PERMISSIVE_TEST_POLICY` en el control positivo) y el único de `https://` con el certificado de `selfsigned` confiado por `tls.ca`, en verde (4 tests). Falsación hecha: no buscar `EgressBlockedError` en la cadena de `cause` cae el primero (y los dos de 3.1); restaurada.
- [x] 3.6 [frontend] Tarjeta de un link con `unsafe_destination` (V2-2). Sin cambio de código en `link-status.ts`.
  Verificar en `apps/web/src/app/features/links/link-status.spec.ts`: «unsafe_destination needs a hand and offers no
  retry» (`needsHand: true`, `canRetry: false`, `pasteFirst: false`, texto genérico) con
  `pnpm nx run web:test --include="**/link-status.spec.ts" --skip-nx-cache`. Falsación: añadir temporalmente
  `unsafe_destination` a `isClosedToUs` y ver caer el test (`pasteFirst` pasa a `true`); restaurar. **Estado (2026-10-29):** Sin cambio de código en `link-status.ts`. «unsafe_destination needs a hand and offers no retry» en `link-status.spec.ts` (`needsHand: true`, `canRetry: false`, `pasteFirst: false`, texto «No pudimos leer esta oferta») con `pnpm nx run web:test --skip-nx-cache -- --include="**/link-status.spec.ts"`: 6 tests en verde. Falsación hecha: añadir `unsafe_destination` a `isClosedToUs` cae el test (`expected true to be false`); restaurada.

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
- [ ] 4.3 [backend] Integración con el guardia real y una política de test completa y nombrada (P0-2). Verificar en
  `guarded-fetch.int.spec.ts`: «a robots redirect to an internal address opens no connection to it», con
  `LOOPBACK_BY_NAME_TEST_POLICY`, la misma del test de redirección de 2.2b (el `robots.txt` de un nombre `.test`
  resuelto a loopback redirige a `/robots.txt` de un literal de loopback; el servidor de destino cuenta cero
  conexiones, la categoría registrada es `loopback`, la causa es `EgressBlockedError` y `RedisCachedRobots` decide
  permitido), con su control positivo «a robots redirect to an approved host opens exactly one connection to it»
  (`PERMISSIVE_TEST_POLICY`). Falsación:
  construir el fetcher del `robots.txt` con el `fetch` global y ver caer el primero; restaurar.

## 5. Rechazo sintáctico en la API (design D6)

- [ ] 5.1 [backend] Rechazo como no reconocida de hosts sin punto, `localhost`/`*.localhost` y literales no públicos,
  en `normalizeUrl`, con `classifyHost` y `allowsHost`/`allowsAddress` de `PUBLIC_EGRESS_POLICY` usada directamente
  (P1-5): función pura de `@linkvault/shared/net`, sin token ni configuración. El puerto **no** se juzga al guardar
  (B2). Sin DNS. Verificar en `url.spec.ts`: «rejects a literal private or loopback host as unrecognized», «rejects a
  dotless host as unrecognized», «accepts a dotted name with a non-web port», «accepts a public IP literal with a
  non-web port» (P1-6) y «does not resolve names when saving» (`vi.mock('node:dns')` y `node:dns/promises`, sin
  llamadas); en `save-link.usecase.spec.ts`: «saving an internal literal host answers invalid_url and creates nothing»
  y «saving a dotted name with a non-web port creates the link»; en `import-links.usecase.spec.ts`: «an internal URL
  in an import counts as unrecognized». El escenario de `links/job-link` que sigue en el worker lo cubre la composición
  de «a non-web port opens no connection» (2.2a, categoría `port`) y «maps an egress rejection to unsafe_destination»
  (3.1); no se suma un caso de punta a punta (B2-a). Falsación: no aplicar la política en `normalizeUrl` y ver caer los
  dos primeros; rechazar los puertos no web al guardar y ver caer el tercero y el cuarto; añadir una llamada a
  `dns.lookup` en la ruta de guardado y ver caer el quinto; restaurar.

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
- [ ] 6.4 [frontend] `core/notifications/push-notifications.ts` (V1-1, N7, B3, B3-a): si `registerPushSubscription`
  falla con `400` y código `validation_error`, `enable()` llama a `subscription.unsubscribe()` sobre la suscripción
  del navegador, sea la recién creada o la que ya existía, y devuelve `{ kind: 'unsupported' }` (no `failed`), sin
  dejar el fallo en `failure`; `subscribed` queda en `false`. Un rechazo de `unsubscribe()` se ignora: el resultado
  sigue siendo `unsupported` y `subscribed = false`. Ante otros fallos no la cancela y devuelve `failed` como hoy. La
  página muestra para `unsupported` el texto que ya tiene («Este navegador no admite notificaciones push.»). Sin
  textos nuevos ni cambios en el catálogo i18n. Verificar en `push-notifications.spec.ts`, que afirma solo `kind` y
  `subscribed` (B3-b): «unsubscribes the browser subscription and answers unsupported when the API rejects the
  endpoint» (`kind: 'unsupported'`, `subscribed = false` y `unsubscribe()` llamada una vez), «unsubscribes an existing
  browser subscription when the API rejects the endpoint», «still answers unsupported when unsubscribe rejects» y
  «keeps the browser subscription on a transient registration failure» (`kind: 'failed'`, `unsubscribe()` sin
  llamar); y en `notifications.page.spec.ts`: «shows the unsupported browser text when enabling push answers
  unsupported» (el texto existente y ningún `lv-request-error` del push). Con
  `pnpm nx run web:test --include="**/push-notifications.spec.ts" --skip-nx-cache`, lo mismo con
  `--include="**/notifications.page.spec.ts"`, y `pnpm nx run web:i18n-check` en verde. Falsación: quitar la llamada
  a `unsubscribe()` y ver caer el primero; devolver `failed` ante el `400` y ver caer el primero; propagar el rechazo
  de `unsubscribe()` y ver caer el tercero; llamarla ante cualquier fallo y ver caer el cuarto; restaurar.
- [ ] 6.5 [infra] Comprobación manual de la lista en local (`pnpm infra:up`, `nx serve api`, `nx serve web`) con los
  navegadores disponibles (al menos Chrome y Firefox; Edge y Safari si hay equipo): activar push en Notificaciones y
  anotar en el PR, por navegador, el **host** del endpoint (no el endpoint entero) y la respuesta `201`. Verificar: la
  nota del PR lista cada navegador probado con host y `201`; un navegador con `400` es un hallazgo que amplía la lista
  en esta misma tarea.

## 7. Documentación y cierre

- [ ] 7.1 [infra] Sin variables de entorno nuevas (design D8). Verificar: `git diff --name-only origin/main...HEAD --
  .env.example apps/web-e2e/e2e.env apps/api/src/infrastructure/config apps/worker/src/infrastructure/config` no
  devuelve nada y `git grep -c EGRESS_ALLOW_PRIVATE_TARGETS -- apps libs .env.example` no encuentra coincidencias.
- [ ] 7.2 [infra] Condición de la excepción (design D9). Verificar: `git diff --name-only origin/main...HEAD | grep -E
  '^(docker-compose|infra/deploy/|infra/ci/|\.github/workflows/|openspec/specs/platform/|openspec/changes/staging-host/)'`
  no devuelve nada.
- [ ] 7.3a [infra] Contingencia de pausa (design R7, P1-3). Hay **una** cola que pausar, `enrich-link`
  (`ENRICH_LINK_QUEUE` de `@linkvault/shared`), que la frescura reutiliza con `triggeredBy: freshness`. Un script en
  `tools/queues/enrich-link-queue.mjs` con dos órdenes, `pause` y `resume`, que llama a `Queue.pause()` y
  `Queue.resume()` de BullMQ sobre esa cola con la conexión a Redis del entorno (sin imprimirla) y termina mostrando
  si la cola quedó pausada; no toca ficheros de despliegue (design D9). Ensayo en la pila local (`pnpm infra:up`,
  `nx serve worker`): pausar, guardar un link y ver que queda `pending` sin que el worker lo tome; reanudar y ver que
  se enriquece. Verificar, anotado en el PR: la orden exacta para local y para staging (en staging se ejecuta donde
  Redis es alcanzable, sin publicar puertos nuevos), la salida de `pause` y `resume`, y el link `pending` durante la
  pausa. El PR deja escrito el respaldo, si el script no se puede ejecutar: parar el worker, **aceptando que se cortan
  el correo y el push**, que también salen del worker; y que la corrección posterior es una fusión correctiva de clase
  1 si cae antes de la 10.7 (7.7) o con las reglas de las clases 2 y 3 si cae después (7.8). Falsación: pausar con un
  nombre de cola distinto de `ENRICH_LINK_QUEUE` y ver que el link se enriquece durante la «pausa»; restaurar.
- [ ] 7.3b [backend] Ensayo de la reversión del Migration Plan 3 en la pila local con este change. Antes de empezar,
  contar los links con `unsafe_destination` y una preview usable (N5). Luego: un link con
  `lastEnrichmentError.reason = unsafe_destination`; parar el worker; la actualización a `blocked` con `mongosh`; servir
  el commit anterior (worktree de `origin/main`); escribir a mano otro `unsafe_destination` simulando una escritura en
  vuelo; repetir la actualización y leer con el código anterior. Verificar, anotado en el PR: el recuento previo de
  links con `unsafe_destination` y preview usable; la orden exacta de `mongosh`; `GET /api/links/mine` en `200`; el
  link sin acción de reintentar en el SPA anterior; y el recuento final de `unsafe_destination` en `0`. Una línea del
  PR deja escrito, leído del código, que `asksForHistoryRescue` solo mira `robots_disallowed` y por tanto `blocked` no
  dispara el rescate por historial. La anotación recuerda R7: revertir exige la defensa de ADR-056 §6; antes de
  tenerla, la contingencia es pausar la cola `enrich-link` (7.3a).
- [ ] 7.4 [infra] Camino crítico e2e sin regresión: `pnpm nx run web-e2e:e2e-stack -- --project=chromium` (perfil `local`) en
  verde, con el link del host `.invalid` terminando como antes (`http_error`). Verificar: salida del comando anotada en
  el PR.
- [ ] 7.5 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salida anotada en el PR.
- [ ] 7.6 [infra] `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en verde.
  Al archivar, ADR-056 pasa a «Aceptado» con la fecha y el PR. Verificar: `grep -n "^\*\*Estado:\*\* Aceptado"
  docs/adr/ADR-056.md` devuelve una línea tras el archivo.
- [ ] 7.7 [infra] Fusiones de clase 1 (ADR-056 §1, P0-3). **Toda fusión de este change a `main` antes de la 10.7 es
  de clase 1: la del change, cualquier correctiva y las de clase 2 o 3 si caen antes. Cada una pasa por esta
  comprobación y obliga a repetir la 9.4 sobre el commit desplegado.** Se hace justo antes de cada una de esas fusiones.
  Con Q1 = (a) o (e):
  1. **Fuente del estado de 35b**: una confirmación escrita y fechada del owner en la conversación del PR, con la forma
     «PR-2 de 35b = #NN; 11.6 hecha el AAAA-MM-DD; 10.7 no hecha». Las casillas de la 11.6 y la 10.7 se marcan en el
     PR de archivo de 35b, después de invitar, así que **no** se leen de `main`; la rama de archivo de 35b, si existe,
     queda solo como apoyo.
  2. **PR-2 de 35b por su número**: `git fetch` y `git log --first-parent --oneline origin/main` volcado a fichero
     muestran, después del merge de #86 (PR-1), el merge del PR-2 de `staging-host` con el mismo número `#NN` que cita
     el owner.
  3. **Resultado**: «en ventana» solo si el PR-2 está en `main` con ese número, el owner declara la 11.6 hecha y la
     10.7 no hecha; cualquier otra combinación es «fuera de ventana» y no se fusiona. La cláusula de los días 7 y 14
     no aplica a esta clase: la ventana termina antes de la 10.7.
  4. **Después de desplegar**: la 9.4 de `e2e-suite` se repite sobre el commit que desplegó esa fusión, y la
     descripción del PR recibe el **hash desplegado** y el **id de la corrida de la 9.4 sobre ese hash**.
  5. **Condición de la 10.7**: la 10.7 de 35b solo procede con la 9.4 en verde sobre el **último** hash desplegado,
     es decir, el que figura en la descripción del último PR de clase 1 fusionado. Una 9.4 en verde sobre un hash
     anterior no sirve: hay que repetirla.

  Con Q1 = (d), la autorización del owner anotada en 0.1 sustituye a los puntos 1-3; los puntos 4 y 5 siguen. Verificar:
  en la descripción de cada PR de clase 1, la cita de la confirmación del owner, el volcado de `git log` con el número
  del PR-2, el resultado, el hash desplegado y el id de la corrida de la 9.4 sobre ese hash. Falsación, como ejercicio
  de escritorio y **nunca** como comentario en el PR: aplicar la regla del punto 3 a una confirmación de prueba que
  declara la 10.7 hecha y obtener «fuera de ventana»; ídem con la 11.6 no hecha y con un número de PR-2 que no
  coincide con el de `git log`; y aplicar la regla del punto 5 a una 9.4 en verde sobre un hash anterior al último
  desplegado y obtener «fuera de ventana» (no se invita).
- [ ] 7.8 [infra] Fusiones **posteriores a la 10.7**: de clase 2 (el PR de archivo de este change), de clase 3 (una
  vuelta atrás y su vuelta, si llegan a hacer falta) y cualquier correctiva (P0-3), **cada una verificada por separado**
  justo antes de fusionarla. Si alguna cae antes de la 10.7, es de clase 1 y sigue 7.7. Las anotaciones posteriores a
  la fusión del PR de apply (números de PR, hashes de commit, el paso de ADR-056 a «Aceptado» de 7.6) viajan en el PR
  de archivo, nunca en un push suelto a `main`. Una vuelta atrás exige además la defensa de ADR-056 §6 (R7). Para cada
  fusión, una confirmación escrita y fechada del owner en ese PR, con la forma «PR-2 de 35b = #NN; 11.6 hecha el
  AAAA-MM-DD (o «no hecha»); 10.7 hecha el AAAA-MM-DD; 9.1-9.4 de 35b no en curso; medición: día N (o «no
  empezada»); hoy no hay corrida `e2e-remote`», y el volcado de `git log --first-parent --oneline origin/main` con el
  número del PR-2. Resultado «en ventana» solo si la 10.7 está hecha y se cumplen las cuatro reglas: no está entre el
  PR-2 de 35b y su 11.6 (o el PR-2 no está en `main`), no están en curso las 9.1-9.4 de 35b, N no es 7 ni 14 y no hay
  corrida `e2e-remote` ese día. Verificar: la cita del owner, el volcado y el resultado en la descripción de cada PR.
  Falsación, como ejercicio de escritorio y **nunca** como comentario en el PR: aplicar la regla a confirmaciones de
  prueba con el PR-2 en `main` y la 11.6 no hecha, con las 9.1-9.4 en curso, con N = 7, con una corrida `e2e-remote`
  ese día y con la 10.7 no hecha (que remite a 7.7), y obtener «fuera de ventana» en cada una.
