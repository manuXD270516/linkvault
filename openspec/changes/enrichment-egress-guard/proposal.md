## Why

Dos relevamientos independientes del 2026-10-28 (critic y arquitecto) encontraron que, cuando una persona guarda una
URL, LinkVault abre conexiones hacia donde esa URL diga, **sin ninguna defensa contra destinos internos**:

- **Al guardar**, `apps/api/src/modules/links/domain/url.ts` acepta cualquier host `http(s)`: nombres sin punto,
  `localhost` y direcciones literales de rangos privados o de loopback.
- **Al enriquecer**, `apps/worker/src/modules/enrichment/infrastructure/http/http-page-fetcher.ts` solo comprueba el
  esquema. Sigue redirecciones dentro del mismo host y las vuelve a comprobar solo contra `robots.txt`; nada impide que
  el host resuelva a una dirección interna, ni que resuelva distinto entre una petición y la siguiente.
- **El `robots.txt`** (`.../robots/http-robots-fetcher.ts`) se pide con `redirect: 'follow'`, sin contar saltos ni
  mirar adónde llevan, y su cuerpo se lee entero en memoria antes de comprobar el tope.
- **El alta de suscripción push** (`libs/shared/src/schemas/notifications.schema.ts`, `endpoint: z.string().url()`)
  guarda cualquier URL, y el worker le hace un `POST` firmado en cada aviso.

El worker comparte red con servicios internos que no piden autenticación a quien ya está dentro de esa red (el almacén
de objetos, Mongo, Redis y las métricas de la API, según `docker-compose.prod.yml`). Con lo de arriba, cualquier persona
registrada puede hacer que el servidor envíe peticiones a direcciones internas o de metadatos del proveedor de nube. El
registro en staging (fila 35b, `staging-host`) es **abierto** por decisión del owner (ADR-051 §5), así que el defecto es
explotable por cualquiera que se dé de alta en cuanto staging tenga destino, y antes de invitar a los primeros usuarios
no-autor.

## What Changes

- **Filtro de salida compartido** (capacidad nueva `links/egress-guard`) para toda descarga iniciada por datos de
  usuario: la página, su `robots.txt` y cada salto de redirección de ambos. Resuelve el nombre y rechaza si **alguna**
  dirección resuelta es loopback, privada (RFC 1918), de enlace local, `100.64.0.0/10`, `0.0.0.0/8`, multidifusión,
  difusión, reservada o de documentación, IPv6 fuera de `2000::/3`, ULA, de enlace local o mapeada a IPv4; rechaza
  también nombres sin punto, `localhost` y puertos que no sean el por defecto, `80` o `443`. Ninguna configuración lo
  relaja: los tests inyectan su política en código. La comprobación ocurre
  **en el conector del cliente HTTP** (`undici`, conector propio sobre `buildConnector` con su `lookup`), así que cubre
  nombres y literales en cada salto, se conecta exactamente a la dirección comprobada y no hay ventana para un cambio
  de DNS.
- **Motivo nuevo `unsafe_destination`** en la lista cerrada de `links/enrichment`: no reintentable (`409` al
  reintentar), no cierra vacantes por frescura y no se registra con la URL. El SPA lo muestra con el texto genérico
  existente («No pudimos leer esta oferta»), como pendiente de una persona y sin acción de reintentar.
- **`robots.txt` con redirecciones a mano**: hasta cinco saltos, cada uno por el filtro, a otro host solo hacia
  `/robots.txt` sin query, cuerpo leído por trozos con tope, un plazo para toda la cadena.
- **Rechazo sintáctico al guardar** (MODIFIED de `links/job-link`): host sin punto, `localhost` o dirección literal no
  pública → `invalid_url` / no reconocida. Sin DNS en la API. Un puerto no web no se rechaza al guardar: el link se
  guarda y el worker lo marca `unsafe_destination`.
- **Push solo a servicios push conocidos** (MODIFIED de `notifications/web-push`): el alta exige `https`, un host de la
  lista compartida (FCM, Mozilla, Apple, Windows) y un endpoint ya canónico que ningún analizador pueda leer distinto;
  el worker vuelve a comprobarlo antes de enviar y borra, sin conectar, las suscripciones antiguas que no cumplan,
  registrando el host y nunca el endpoint completo. Si el alta se rechaza, el SPA cancela la suscripción local
  (MODIFIED de `web/notifications`).
- **ADR-056** (Propuesto) con las decisiones y la excepción pedida a la precedencia de la fila 35.

## Excepción a la precedencia de la fila 35

La precedencia de ADR-048 §Consecuencias, extendida a la fila entera por ADR-051 §Enmiendas 3, dice que ningún change
de otra fila entra entre 35a, 35b y 35c y que adelantar uno es una decisión humana explícita. Este change **no es una
pieza de la fila** y **la pide**: abrir 35b con registro abierto sin este filtro expone los servicios internos del host
a cualquiera que se registre. Las condiciones, a la manera de ADR-053 §1 y ADR-055 §1:

- No cambia el orden de la fila (35b → 35c) ni libera la precedencia para ningún otro change.
- No toca ficheros de despliegue (`docker-compose*.yml`, `infra/deploy/`), workflows (`.github/workflows/`),
  `infra/ci/` ni requirements de `platform/*`. La defensa del lado del despliegue queda como recomendación para 35b
  (ver «Fuera de alcance»). Si el debate rompe esta condición, el change vuelve al owner.
- **Cuándo se fusiona es la Q1 del design, bloqueante para `/opsx:apply`.** Con el PR-1 de 35b ya en `main` (#86),
  sus tareas prohíben fusionar entre su PR-1 y su PR-2, y `e2e-suite` (D15) entre su PR-2 y su 11.6. Opciones:
  (a) después de la 11.6 de 35b y antes de su 10.7, repitiendo la 9.4 de `e2e-suite` —recomendación—, (b) después de
  35c, (c) dentro de 35b, (d) excepción expresa del owner a la regla «entre PR-1 y PR-2» de 35b, o (e) que 35b no abra
  el registro hasta tener este change. La respuesta se anota con fecha en ADR-056 §1 y en ADR-048 §Consecuencias. La
  excepción cubre tres clases de fusión —la del change, la del PR de archivo y una eventual vuelta atrás con su
  vuelta—, cada una con su guardia (ADR-056 §1).
  **Respondida por el owner el 2026-10-29: (a)** (ADR-056 §1; design, «Respuestas del owner y aprobación»).

## Capabilities

### New Capabilities

- `links/egress-guard`: qué destinos de red se aceptan para las descargas iniciadas por datos de usuario, la garantía
  de que la dirección comprobada es la conectada y que ninguna configuración lo relaja.

### Modified Capabilities

- `links/enrichment`: ADDED «Motivo de destino no permitido» y «El robots.txt se pide con redirecciones contadas y tope
  de bytes».
- `links/job-link`: MODIFIED «Normalización de URL para identidad» (rechazo sintáctico de hosts internos).
- `notifications/web-push`: MODIFIED «Alta de suscripción» (lista de servicios push y endpoint canónico) y «Envío con
  VAPID» (comprobación antes de enviar, borrado de las antiguas y registro sin el endpoint completo).
- `web/notifications`: MODIFIED «Suscripción push opcional» (cancelar la suscripción local si la API rechaza el alta y
  tratarlo como navegador sin soporte push, con el texto existente).

## Impact

- `libs/shared`: clasificador puro de direcciones y nombres y política pública (`src/net/`, sobre `ipaddr.js`, sin
  dependencias de Node), publicado en la subruta `@linkvault/shared/net`, que importan solo la API y el worker;
  lista de servicios push y su predicado; `unsafe_destination` en `enrichmentFailureReasonSchema` y en
  `NON_RETRYABLE_ENRICHMENT_REASONS`; `pushSubscriptionRequestSchema` con el refinamiento.
- `apps/worker`: guardia de salida (`src/infrastructure/egress/`) con un `Agent` de `undici` y su `lookup`;
  `HttpPageFetcher` y `createHttpRobotsFetcher` sobre él; `PageFetchFailureReason` con `unsafe_destination`;
  `WebPushVapidSender` con la política de endpoints inyectada.
- `apps/api`: `url.ts` con el rechazo sintáctico, usando la política pública directamente; fixtures de tests de push con hosts
  de la lista.
- Dependencias: `undici` e `ipaddr.js` pasan a `dependencies` de la raíz (ya están en el lockfile como transitivas);
  `selfsigned`, a `devDependencies`,
  con la versión del lockfile, para el servidor TLS de los tests.
- Sin variables de entorno nuevas: `.env.example`, `apps/web-e2e/e2e.env` y los esquemas de configuración no cambian.
- `eslint.config.mjs`: regla que impide el `fetch` global y los clientes HTTP de bajo nivel en el módulo de
  enriquecimiento del worker.
- SPA: `core/notifications/push-notifications.ts` cancela la suscripción local ante un alta rechazada y lo
  muestra con el texto existente de navegador sin soporte push; el motivo nuevo
  cae en el texto genérico existente, sin cambio de código (lo fija un test en `link-status.spec.ts`). Sin textos
  nuevos ni cambios en el catálogo i18n.

## Fuera de alcance

- **Defensa en profundidad del despliegue** (ficheros de 35b): red propia para el worker con solo los servicios que
  necesita, autenticación o filtro por dirección de origen en las interfaces del almacén de objetos que no la piden,
  contraseñas en Redis y Mongo, métricas de la API no alcanzables desde el worker, y bloqueo a nivel de host de la
  dirección de metadatos del proveedor. Queda como **recomendación escrita para 35b** en ADR-056 §6; trasladarla a los
  artefactos de `staging-host` es la Q3.
- Una métrica de rechazos del filtro en `/metrics` (tocaría `platform/observability`): Q4.
- Mensajes específicos en el SPA para «destino no permitido»: Q2. El alta push rechazada usa el texto existente de
  navegador sin soporte push (B3-a del debate).
- La etapa headless (no tiene adaptador; cuando lo tenga, tendrá que pasar por el filtro: riesgo R4 del design).
- Descargas que no parten de datos de usuario (APIs fijas de `job-discovery`, proveedores de IA, correo, almacén).
- **Texto propio para una URL con dirección literal interna** (hallazgo V2-1 de business): con este change, guardar una
  URL cuyo host es una IP literal privada responde `invalid_url` y el SPA dice «no reconocida», un texto engañoso
  —la URL se reconoce, pero no se admite— aunque el caso es raro. Un texto nuevo toca el catálogo i18n; llega con el
  change de producto de la Q2.
- **Destinos locales por configuración** (una variable que abra loopback o redes privadas para desarrollo): hoy no la
  necesita nadie; si algún change necesita enriquecer contra un servidor local, la variable entra con ese change.
