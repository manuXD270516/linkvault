## Context

LinkVault descarga páginas a partir de URLs que escriben personas: el enriquecimiento (`links/enrichment`, ADR-003,
ADR-022) pide el `robots.txt` del host y luego la página, siguiendo redirecciones; la frescura (ADR-037) reutiliza esa
misma cadena. Y el worker hace un `POST` firmado a la URL que el navegador declaró como endpoint push (ADR-035).

Lo que hay hoy, leído en `main` `5b92d28`:

| Pieza | Qué comprueba | Qué no |
|---|---|---|
| `links/domain/url.ts` (API) | esquema `http(s)` y host no vacío | nada del host |
| `HttpPageFetcher` (worker) | esquema; redirecciones solo al mismo host, contadas (3) y con permiso de `robots.txt` por salto | a qué dirección resuelve el host, en ningún salto |
| `createHttpRobotsFetcher` (worker) | plazo | redirecciones (`follow`, sin contar, a cualquier host); tope de bytes (lee entero y descarta después) |
| `pushSubscriptionRequestSchema` (shared) | que sea una URL | esquema, host, puerto |
| `WebPushVapidSender` (worker) | `410`/`404` borran | adónde envía |

El worker está en la misma red que servicios internos que confían en quien ya está dentro (almacén de objetos, Mongo,
Redis, métricas de la API; `docker-compose.prod.yml`). En staging el registro es abierto (ADR-051 §5). El riesgo es el
clásico de peticiones del lado del servidor: una persona registrada consigue que el servidor pida recursos de
direcciones internas o de metadatos de la nube. Este documento lo describe en general y no da recetas.

**Hechos que condicionan el diseño:**

- `HttpPageFetcher` recibe el `fetch` inyectado (`HttpFetch`), y el módulo lo construye con el `fetch` global.
- `undici@7.29.1` e `ipaddr.js@2.5.0` ya están en `pnpm-lock.yaml` como transitivas; Node es 22.
- Ninguna prueba e2e enriquece hoy contra un servidor local: el camino crítico usa un host `.invalid` y el resto, URLs
  de bolsas públicas que no se descargan en la pila de pruebas. Ningún spec del worker levanta un servidor HTTP para el
  enriquecimiento. La opción de destinos locales (D8) sirve para desarrollo y para los tests del propio filtro.
- El SPA muestra cualquier motivo que no sea `robots_disallowed`, `blocked` o `not_a_job` con el texto genérico «No
  pudimos leer esta oferta» (`features/links/link-status.ts`), y ofrece reintentar según
  `isRetryableEnrichmentReason` de `@linkvault/shared`.
- No hay adaptador headless (`headless.extractor.ts` es un eslabón apagado).

## Goals / Non-Goals

**Goals**

- Ninguna conexión iniciada por una URL de usuario llega a una dirección no pública, en ningún salto, ni por un cambio
  de DNS entre comprobar y conectar.
- Un solo clasificador de direcciones, usado por la API (rechazo temprano) y por el worker (decisión final).
- El push solo habla con servicios push.
- Desarrollo y tests pueden seguir usando servidores locales, sin que esa puerta exista en producción.
- Sin tocar ficheros de despliegue, workflows ni `platform/*` (condición de la excepción, D9).

**Non-Goals**

- Segmentar la red del despliegue o autenticar los servicios internos (recomendación para 35b, D9 y ADR-056 §6).
- Filtrar las salidas que no dependen de datos de usuario (IA, correo, `job-discovery`, almacén).
- Detectar contenido malicioso en páginas públicas.

## Decisions

### D1. Un guardia en el worker y un clasificador puro en `libs/shared`

- **Clasificador** `libs/shared/src/net/egress-address.ts`: funciones puras `classifyAddress(ip)` →
  `public | loopback | private | link_local | shared_cgnat | unspecified | multicast | broadcast | reserved |
  documentation | ipv4_mapped | ula`, y `classifyHost(host)` → `ip literal (con su clase) | dotless | localhost |
  name`. Sobre `ipaddr.js` (sin dependencias de Node, apto para el SPA si algún día lo importa). Un predicado
  `isEgressAllowed(cls, { allowPrivateTargets })` decide con la política de D8.
- **Guardia** `apps/worker/src/infrastructure/egress/`: crea el `Agent` de `undici` con el `lookup` de D3 y la
  comprobación previa de hosts literales (D2), y expone un `HttpFetch` ya filtrado. Lo usan `HttpPageFetcher` y el
  fetcher del `robots.txt`; ninguno de los dos llama al `fetch` global.
- El rechazo viaja como un error tipado del guardia (`EgressBlockedError` con la categoría y nada más) que cada fetcher
  traduce: la página a `unsafe_destination`, el `robots.txt` a «no disponible».

*Descartado:* dos listas (una en la API y otra en el worker), porque se separan; `node:net` `BlockList` en
`libs/shared`, porque rompe el build del SPA; validar en la API con DNS, porque la API no conecta y la respuesta de DNS
puede cambiar antes de que conecte el worker.

### D2. Qué se rechaza

Lista completa en la spec `links/egress-guard`. Criterios:

- **Cualquier dirección mala tumba la resolución entera**: si un nombre devuelve una pública y una privada, no se
  conecta. Elegir la buena sería tolerable, pero deja una superficie (el orden, la familia) que no compensa: ninguna
  bolsa de empleo publica direcciones internas en su DNS.
- **Hosts literales se comprueban antes de conectar**, porque el cliente no llama a `lookup` cuando el host ya es una
  dirección. Se clasifica `URL.hostname` tras el análisis WHATWG, que normaliza las notaciones alternativas de IPv4 a la
  forma con puntos; los corchetes de IPv6 se quitan antes de clasificar.
- **Nombres sin punto** (tras quitar el punto final), `localhost` y `*.localhost` se rechazan sin resolver: cubren los
  nombres de servicio de la red de contenedores y la búsqueda por dominio del resolvedor.
- **Traducción IPv6** (`64:ff9b::/96`, `2002::/16`): se clasifica la IPv4 de dentro. Rechazarlas enteras rompería un
  host solo-IPv6 con DNS64.
- **Mapeadas y compatibles con IPv4** (`::ffff:0:0/96`, `::/96`): se rechazan enteras, como pide el relevamiento.

*Descartado:* lista de permitidos «solo unicast global» expresada como un único rango de `ipaddr.js` sin enumerar,
porque la spec quedaría sin contenido verificable; se enumera y el test recorre la tabla.

### D3. Se conecta a la dirección comprobada: `lookup` propio en el `Agent` de `undici`

El `Agent` se crea con `connect: { lookup }`, donde `lookup` llama a `dns.lookup(host, { all: true, ... })`, clasifica
todas las direcciones y, si todas pasan, devuelve exactamente esas al socket (respetando `options.all` y la familia
pedidas, que `net.connect` usa con `autoSelectFamily`). Si alguna no pasa, devuelve el error tipado. Como el socket se
abre con lo que devolvió `lookup`, **no hay segunda resolución**: el cambio de DNS entre comprobar y conectar no tiene
ventana. Una conexión del pool reutilizada para el mismo origen ya está contra una dirección comprobada.

- Se usan **`fetch` y `Agent` del paquete `undici`** (dependencia directa), no el `fetch` global con un `dispatcher`
  de otro `undici`: mezclar la copia interna de Node con la del paquete es una fuente conocida de incompatibilidades.
- **Sin proxy del entorno**: el `Agent` es el dispatcher explícito de cada petición; no se usa `EnvHttpProxyAgent`. Con
  un proxy, el filtro comprobaría la dirección del proxy y no la del destino (R5).
- TLS y `Host` siguen usando el nombre: el certificado se valida contra el host de la URL.

*Descartado:* resolver aparte y reescribir la URL con la IP (rompe SNI y la validación del certificado, y obliga a
reescribir `Host`); `node:http`/`node:https` a mano con `lookup` (habría que reimplementar el flujo de `Response` del
que dependen los fetchers y sus tests); una librería de terceros de «fetch seguro» (más superficie y otra política de
redirecciones que la nuestra).

### D4. La página: cada salto por el guardia y motivo `unsafe_destination`

`HttpPageFetcher` no cambia su política (redirecciones al mismo host, tres como mucho, permiso de `robots.txt` por
salto); cambia su transporte, que es el `HttpFetch` del guardia, de modo que cada salto abre su conexión por D3. El
motivo `unsafe_destination` se añade a `enrichmentFailureReasonSchema` y a `NON_RETRYABLE_ENRICHMENT_REASONS`, y a
`PageFetchFailureReason`.

- **No reintentable**: volver a pedir no cambia nada; `POST /api/links/:id/enrich` responde `409` por la regla que ya
  usa `isRetryableEnrichmentReason`. El SPA no ofrece reintentar y muestra el texto genérico.
- **Frescura**: «Cierre por relectura» enumera de forma cerrada las señales que cierran; `unsafe_destination` no está,
  así que no cierra. Se fija con un test.
- **Un nombre que no resuelve sigue siendo `http_error`**: el `lookup` distingue «no hay respuesta» de «respuesta
  prohibida»; solo la segunda es `unsafe_destination`.
- **Registro**: `warn` con `linkId`, `stage` (`page`/`robots`) y `category`; nunca la URL, el host ni la dirección
  (`links/enrichment` ya prohíbe registrar la URL del usuario).

*Descartado:* reutilizar `http_error` (es reintentable y deja un bucle de reintentos inútiles); reutilizar `blocked`
(dice «la bolsa nos bloquea», que es falso y activa en el SPA el texto de pegar la descripción de una plataforma).

### D5. El `robots.txt`: redirecciones a mano, hasta cinco, y lectura por trozos

`createHttpRobotsFetcher` pasa a `redirect: 'manual'` sobre el `HttpFetch` del guardia:

- hasta **cinco** saltos (el mínimo que pide el estándar del `robots.txt`, RFC 9309 §2.3.1.2), **también a otro
  host**, porque el estándar lo admite y hoy ya se sigue así; cada salto pasa por el guardia;
- un plazo único para toda la cadena (`AbortSignal.timeout(ENRICH_FETCH_TIMEOUT_MS)`, como hoy);
- cuerpo leído por trozos, abandonando al pasar `ROBOTS_MAX_BYTES`; lo que no cabe se trata como hoy: sin reglas;
- más saltos, destino rechazado o cuerpo demasiado grande → `null` («no disponible», permitido), sin abrir conexión
  hacia el destino rechazado. Es la semántica que ya tiene `null` en `RedisCachedRobots`, y la página tiene su propio
  filtro: si el host de la página es interno, la página cae en D4.

*Descartado:* prohibir que el `robots.txt` redirija a otro host (rompería sitios que sirven sus reglas desde otro
dominio y el estándar lo admite); tratar un destino rechazado del `robots.txt` como «prohibido» (castigaría a la página
por una decisión que es del `robots.txt`).

### D6. La API rechaza lo que se ve sin resolver

`normalizeUrl` (o el caso de uso que lo llama, que recibe la política por un token de configuración: el dominio no
lee configuración) rechaza como no reconocida una URL cuyo host es un nombre sin punto, `localhost`/`*.localhost` o una
dirección literal no pública, con el mismo clasificador de D1 y la misma política de D8. `POST /api/links` responde
`invalid_url`; la importación la cuenta en `unrecognized`; la extensión usa el mismo guardado. **No se resuelve DNS en
la API**: la decisión de adónde se conecta es del worker, y un nombre público que resuelve a una dirección interna solo
se detecta allí.

*Descartado:* no tocar la API (guarda basura que nunca se podrá leer y da peor respuesta a quien la escribió);
resolver en la API (latencia en el guardado, y la respuesta puede cambiar antes de que el worker conecte, así que no
aporta seguridad).

### D7. Push: lista de servicios push conocidos, en el alta y antes de enviar

El endpoint push lo genera el navegador y siempre es de su servicio push. Se valida contra una lista en
`libs/shared/src/notifications/push-services.ts`: `https`, sin credenciales, puerto 443 (o ausente) y host igual a,
o terminado en `.` + uno de: `fcm.googleapis.com` (Chrome y derivados de Chromium), `push.services.mozilla.com`
(Firefox), `push.apple.com` (Safari) y `notify.windows.com` (Edge). El predicado lo usan el `refine` de
`pushSubscriptionRequestSchema` (alta → `400 validation_error` nombrando `endpoint`) y `WebPushVapidSender`, que lo
recibe inyectado: antes de enviar, un endpoint que no cumpla se borra sin conectar (suscripciones guardadas antes de
la regla). Los tests del sender que hoy usan servidores locales inyectan una política permisiva; los del API pasan a
hosts de la lista.

*Descartado:*
- **El mismo filtro de salida de D1** en lugar de la lista: impediría las direcciones internas, pero dejaría el
  servidor enviando `POST` firmados con nuestra identidad VAPID a cualquier host público que alguien registre, y exige
  inyectar un agente en las entrañas de `web-push`.
- **Lista y filtro a la vez**: los hosts de la lista son públicos y de grandes proveedores; el filtro añadiría
  acoplamiento a `web-push` sin cubrir un caso realista.
- **Lista por configuración** (`PUSH_ALLOWED_HOST_SUFFIXES`): una superficie más que se puede dejar mal en un
  despliegue; ampliar la lista es un cambio de código pequeño y revisado.

### D8. `EGRESS_ALLOW_PRIVATE_TARGETS`, solo fuera de producción

Booleano, por defecto `false`, en `api-config.schema.ts` y `worker-config.schema.ts`. Encendido permite loopback,
`10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `fc00::/7`, `localhost` y nombres sin punto. **Sigue prohibiendo**
enlace local (`169.254/16`, `fe80::/10`, donde viven los metadatos de la nube), `0/8`, `::`, multidifusión, difusión y
reservadas: un portátil de desarrollo dentro de una VM en la nube también tiene metadatos. Con `NODE_ENV=production` y
`true`, el `superRefine` de cada esquema falla nombrando la variable, como hace `parseAiConfig` con el mock. Encendido,
un `warn` en el arranque. No se declara en `apps/web-e2e/e2e.env` (no la necesita nadie hoy) y en `.env.example` va
documentada y apagada. No afecta a la lista de push (D7), que no tiene excepción por entorno.

*Descartado:* una lista de hosts permitidos por configuración (más superficie y más fácil de dejar abierta); permitirlo
por `NODE_ENV !== 'production'` sin variable (la pila e2e corre con `NODE_ENV=development` y quedaría abierta sin que
nadie lo pidiera).

### D9. Encaje con la fila 35 (excepción pedida)

Las condiciones de la proposal: no cambia el orden de la fila, no libera la precedencia para nadie y no toca ficheros de
despliegue, workflows, `infra/ci/` ni requirements de `platform/*`. Que la producción no pueda arrancar con la opción
encendida lo garantiza el esquema de configuración (D8), no un guardia en `repo-checks`, precisamente para no tocar
`infra/ci/` (35c tiene guardias diferidos ahí). La defensa del lado del despliegue se escribe como recomendación en
ADR-056 §6 y no se edita `openspec/changes/staging-host/`. Cuándo se aplica y fusiona es la Q1.

### D10. Cómo se verifica

- **Unitarios del clasificador**: tabla con un caso por rango de la spec (dentro, borde y fuera), notaciones IPv4 que
  normaliza el analizador WHATWG, IPv6 con corchetes, mapeadas, traducción con IPv4 pública y privada dentro, nombres
  sin punto con y sin punto final, `localhost` y subdominios; con y sin `allowPrivateTargets`.
- **Integración del guardia** (worker, sin red externa): un servidor HTTP en loopback que **cuenta conexiones** y un
  resolvedor inyectado que mapea nombres de prueba de `.test` a direcciones elegidas. Así se prueba que el servidor
  recibe cero conexiones cuando el filtro rechaza, y una cuando la opción de D8 está encendida.
- **Cambio de DNS**: un resolvedor que responde distinto en la primera y la segunda consulta y cuenta llamadas; se
  afirma una consulta por conexión y que la conexión va a la dirección aprobada.
- **Falsación** de cada guardia: quitar el `lookup` del `Agent`, quitar la comprobación previa de literales, volver a
  `redirect: 'follow'` en el `robots.txt`, quitar el `refine` del schema push y quitar el `superRefine` de producción;
  en cada caso cae el test nombrado en `tasks.md`.

## Risks / Trade-offs

- **R1. Falsos positivos.** Un sitio público cuyo DNS devuelve alguna dirección interna queda ilegible
  (`unsafe_destination`). Se acepta: no se conoce ninguna bolsa así, y el motivo lo deja visible en el link.
- **R2. Dependencias directas nuevas** (`undici`, `ipaddr.js`). Ya están en el lockfile; pasar a directas obliga a
  vigilarlas en Renovate. La versión de `undici` del paquete y la interna de Node pueden diferir: por eso se usan juntos
  `fetch` y `Agent` del paquete (D3).
- **R3. La lista de push envejece.** Un navegador con un servicio push nuevo no podrá suscribirse (`400`), el SPA lo
  muestra como fallo no bloqueante y el correo sigue igual (`web/notifications`). La suscripción local del navegador
  queda creada pero el servidor nunca le envía nada. Se corrige ampliando la lista.
- **R4. Headless futuro.** Un navegador headless resuelve y conecta por su cuenta y saltaría este filtro. Cuando exista
  su adaptador, tendrá que salir por el mismo guardia (proxy local filtrado o equivalente); ADR-056 lo deja escrito.
- **R5. Proxy de salida.** Si algún día el worker sale por un proxy, el filtro comprobaría la dirección del proxy. El
  diseño fija «sin proxy del entorno» y un test lo comprueba; usar un proxy sería un change con su propio filtro.
- **R6. El filtro no sustituye a la segmentación.** Cubre las conexiones iniciadas por URLs de usuario; un fallo en
  otra parte del worker seguiría viendo los servicios internos. Por eso la recomendación de ADR-056 §6 para 35b.
- **R7. Reversión.** Los links con `lastEnrichmentError.reason = unsafe_destination` no los acepta el esquema anterior.
  Ver Migration Plan.
- **R8. Pestañas abiertas durante el despliegue.** Un SPA anterior que reciba `unsafe_destination` en un aviso en
  tiempo real no lo reconoce; se recarga (mismo trato que ADR-055).

## Migration Plan

1. Sin migración de datos: los links existentes no cambian; los guardados antes con hosts internos fallarán con
   `unsafe_destination` en su próxima lectura, y las suscripciones push fuera de la lista se borran en su próximo envío.
2. Despliegue normal por `cd-staging` tras fusionar; ningún fichero de despliegue cambia y la variable nueva no se
   declara en producción (vale `false`).
3. **Reversión**: antes de desplegar el commit anterior, poner en `http_error` los `lastEnrichmentError.reason` que
   valgan `unsafe_destination` (una actualización sobre `job_links`, anotada en el PR de apply con la orden exacta y
   ensayada en local), para que el esquema anterior los lea. Las suscripciones push borradas no se recuperan: el
   navegador las vuelve a registrar al reactivar.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`]. Excepción a la precedencia de la fila 35: ¿cuándo se aplica y fusiona?**
  - (a) **Antes de invitar en 35b**: aplicar y fusionar antes de la 10.7 de `staging-host`; idealmente antes de su 6.3
    (primer despliegue), porque el registro es abierto desde que staging tiene destino. Si se fusiona después de la
    6.3, el despliegue siguiente de `main` lo lleva a staging antes de invitar.
  - (b) **Después de 35c**, sin excepción: entonces 35b no debería invitar —ni dejar el registro abierto con destino—
    hasta tenerlo, lo que retrasa la fila entera.
  - (c) **Dentro de 35b**: absorberlo en `staging-host`, que es un change de despliegue con dos PR en ventanas
    autorizadas y ya muy cargado; mezclaría código de producto con infraestructura.
  - **Recomendación: (a)**, con el mismo patrón que ADR-055. La respuesta se anota en ADR-056 §1 en una línea que
    empieza por «Respuesta del owner (Q1), AAAA-MM-DD:» y en ADR-048 §Consecuencias.
- **Q2 [no bloqueante]. Mensajes propios en el SPA** para `unsafe_destination` («Esta dirección no es pública») y para
  el `400` del alta push («Este navegador no es compatible con los avisos push»). Recomendación: no ahora; el texto
  genérico es honesto y evita tocar `web/*` y el catálogo i18n. Candidato para un change de producto tras la fila 35.
- **Q3 [no bloqueante]. Trasladar la recomendación de ADR-056 §6 a `staging-host`** (tareas o riesgos de su design) en
  un PR solo de spec, como hizo ADR-053 §1.4, o dejarla solo en el ADR para que 35b la recoja en su debate.
  Recomendación: PR solo de spec tras la aprobación de este change, con el texto de §6 y sin cambiar su orden de tareas.
- **Q4 [no bloqueante]. Métrica de rechazos** (`linkvault_egress_blocked_total{stage,category}`) en `/metrics`.
  Toca `platform/observability`, que la condición de D9 deja fuera. Recomendación: solo registro ahora; la métrica
  después de 35c.
