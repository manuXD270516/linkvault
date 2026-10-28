## Context

LinkVault descarga páginas a partir de URLs que escriben personas: el enriquecimiento (`links/enrichment`, ADR-003,
ADR-022) pide el `robots.txt` del host y luego la página, siguiendo redirecciones; la frescura (ADR-037) reutiliza esa
misma cadena. Y el worker hace un `POST` firmado a la URL que el navegador declaró como endpoint push (ADR-035).

Lo que hay hoy, leído en `main` `5b92d28`:

| Pieza | Qué comprueba | Qué no |
|---|---|---|
| `links/domain/url.ts` (API) | esquema `http(s)` y host no vacío | nada del host ni del puerto |
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
- `undici@7.29.1` e `ipaddr.js@2.5.0` ya están en `pnpm-lock.yaml` como transitivas; Node es 22. `undici` expone
  `buildConnector` y la opción `connect` del `Agent` acepta un conector propio.
- Ninguna prueba e2e enriquece hoy contra un servidor local: el camino crítico usa un host `.invalid` y el resto, URLs
  de bolsas públicas que no se descargan en la pila de pruebas. Ningún spec del worker levanta un servidor HTTP para el
  enriquecimiento. La opción de destinos locales (D8) sirve para desarrollo y para los tests del propio filtro.
- El SPA muestra cualquier motivo que no sea `robots_disallowed`, `blocked` o `not_a_job` con el texto genérico «No
  pudimos leer esta oferta» (`features/links/link-status.ts`), marca la tarjeta como pendiente de una persona
  (`needsHand`) y ofrece reintentar según `isRetryableEnrichmentReason` de `@linkvault/shared`.
- `asksForHistoryRescue` (API, `links/domain/job-link.ts`) pide una lectura nueva cuando un link `failed` por
  `robots_disallowed` se vuelve a guardar con otra URL del mismo host. Importa para la reversión (Migration Plan).
- El SPA, al activar push, crea la suscripción del navegador antes de llamar a la API
  (`core/notifications/push-notifications.ts`); si la API la rechaza, hoy la suscripción local queda creada.
- No hay adaptador headless (`headless.extractor.ts` es un eslabón apagado).

## Goals / Non-Goals

**Goals**

- Ninguna conexión iniciada por una URL de usuario llega a una dirección no pública ni a un puerto que no sea el web,
  en ningún salto, ni por un cambio de DNS entre comprobar y conectar.
- Un solo clasificador de direcciones, nombres y puertos, usado por la API (rechazo temprano) y por el worker (decisión
  final).
- El push solo habla con servicios push, con un criterio de URL que no pueda leerse de dos maneras.
- Desarrollo y tests pueden seguir usando servidores locales, sin que esa puerta exista en producción.
- Sin tocar ficheros de despliegue, workflows ni `platform/*` (condición de la excepción, D9). El SPA solo recibe los
  dos toques mínimos de D11.

**Non-Goals**

- Segmentar la red del despliegue o autenticar los servicios internos (recomendación para 35b, D9 y ADR-056 §6).
- Filtrar las salidas que no dependen de datos de usuario (IA, correo, `job-discovery`, almacén).
- Detectar contenido malicioso en páginas públicas.
- Mensajes propios del SPA para los motivos nuevos (Q2).

## Decisions

### D1. Un guardia en el worker y un clasificador puro en `libs/shared`

- **Clasificador** `libs/shared/src/net/egress-address.ts`: funciones puras `classifyAddress(ip)` →
  `public | loopback | private | link_local | shared_cgnat | unspecified | multicast | broadcast | reserved |
  documentation | ipv4_mapped | ula`, `classifyHost(host)` → `ip literal (con su clase) | dotless | localhost | name`,
  y `isEgressPortAllowed(protocol, port, cls, policy)` (D2). Sobre `ipaddr.js` (sin dependencias de Node, apto para el
  SPA si algún día lo importa). Un predicado `isEgressAllowed(cls, { allowPrivateTargets })` decide con la política de
  D8. La API y el guardia llaman a las mismas funciones; ninguno repite rangos ni puertos.
- **Guardia** `apps/worker/src/infrastructure/egress/`: un **conector propio** que envuelve el `buildConnector` de
  `undici` (D3) y un `createGuardedFetch` que expone un `HttpFetch` ya filtrado. Lo usan `HttpPageFetcher` y el fetcher
  del `robots.txt`; ninguno de los dos llama al `fetch` global, y una regla de ESLint lo impide en el módulo (D10).
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
- **Hosts literales y nombres sin punto se juzgan en el conector**, que recibe el host de cada conexión, sea un nombre o
  una dirección (D3). Se clasifica el host tras el análisis WHATWG, que normaliza las notaciones alternativas de IPv4 a
  la forma con puntos; los corchetes de IPv6 se quitan antes de clasificar.
- **Nombres sin punto** (tras quitar el punto final), `localhost` y `*.localhost` se rechazan sin resolver: cubren los
  nombres de servicio de la red de contenedores y la búsqueda por dominio del resolvedor.
- **IPv6 por lista de permitidos** (E4 del debate): solo es pública una dirección de `2000::/3` (unicast global) que no
  caiga en ninguno de los rangos enumerados de la spec; todo lo que está fuera de `2000::/3` es `reserved`, salvo la
  traducción. **Traducción** (`64:ff9b::/96`, `2002::/16`): se clasifica la IPv4 de dentro; `64:ff9b::/96` queda fuera
  de `2000::/3` y es la única excepción a la regla anterior. Rechazarlas enteras rompería un host solo-IPv6 con DNS64.
- **Mapeadas y compatibles con IPv4** (`::ffff:0:0/96`, `::/96`): se rechazan enteras, como pide el relevamiento.
- **Puertos** (E3 del debate): solo el puerto por defecto del esquema (ausente en la URL) o `80`/`443` explícitos. Un
  servicio interno escucha casi siempre en otro puerto; un destino público de una bolsa, nunca. La regla vive en
  `isEgressPortAllowed` y la aplican la API (rechazo al guardar) y el conector (cada conexión, cada salto). Con
  `EGRESS_ALLOW_PRIVATE_TARGETS` encendida (D8), los destinos que esa opción abre admiten cualquier puerto, para que el
  desarrollo y los tests usen servidores en puertos efímeros; los destinos públicos siguen limitados a `80`/`443`.

*Descartado:* lista de permitidos IPv6 expresada solo como `2000::/3` sin enumerar las excepciones de dentro, porque
dejaría pasar documentación y otros rangos especiales; puertos por configuración (otra superficie que se puede dejar
abierta).

### D3. Se conecta a la dirección comprobada: conector propio sobre `buildConnector`

El `Agent` de `undici` se crea con `connect` = un conector propio (E2 del debate). Para cada conexión, el conector:

1. clasifica el host que recibe (literal, nombre sin punto, `localhost`) y el puerto, y, si no pasan, llama a su
   callback con `EgressBlockedError` **sin abrir socket**;
2. si es un nombre, delega en un conector base creado con `buildConnector({ lookup })`, donde `lookup` llama a
   `dns.lookup(host, { all: true, ... })`, clasifica **todas** las direcciones y, si todas pasan, devuelve exactamente
   esas al socket (respetando `options.all` y la familia pedidas, que `net.connect` usa con `autoSelectFamily`); si
   alguna no pasa, devuelve el error tipado.

Como el socket se abre con lo que devolvió `lookup`, **no hay segunda resolución**: el cambio de DNS entre comprobar y
conectar no tiene ventana. Y como la comprobación está en el conector, cubre por igual los nombres y los literales,
venga la petición de quien venga y en el salto que sea: no depende de que el que llama haga una comprobación previa.

- `createGuardedFetch` **fuerza** `redirect: 'manual'` en cada petición (cada salto lo pide el fetcher, otra vez por el
  conector) y crea el `Agent` con `allowH2: false`, para que cada origen abra su propia conexión por el conector y
  ninguna se comparta entre orígenes.
- Se usan **`fetch` y `Agent` del paquete `undici`** (dependencia directa), no el `fetch` global con un `dispatcher`
  de otro `undici`: mezclar la copia interna de Node con la del paquete es una fuente conocida de incompatibilidades.
- **Sin proxy del entorno**: el `Agent` es el dispatcher explícito de cada petición; no se usa `EnvHttpProxyAgent`. Con
  un proxy, el filtro comprobaría la dirección del proxy y no la del destino (R5).
- TLS y `Host` siguen usando el nombre: el certificado se valida contra el host de la URL.

*Descartado:* comprobar los literales antes de llamar a `fetch` (no cubre un salto que siga el propio cliente ni a un
llamador que se la salte: E2); resolver aparte y reescribir la URL con la IP (rompe SNI y la validación del
certificado, y obliga a reescribir `Host`); `node:http`/`node:https` a mano con `lookup` (habría que reimplementar el
flujo de `Response` del que dependen los fetchers y sus tests); una librería de terceros de «fetch seguro» (más
superficie y otra política de redirecciones que la nuestra).

### D4. La página: cada salto por el guardia y motivo `unsafe_destination`

`HttpPageFetcher` no cambia su política (redirecciones al mismo host, tres como mucho, permiso de `robots.txt` por
salto); cambia su transporte, que es el `HttpFetch` del guardia, de modo que cada salto abre su conexión por D3. El
motivo `unsafe_destination` se añade a `enrichmentFailureReasonSchema` y a `NON_RETRYABLE_ENRICHMENT_REASONS`, y a
`PageFetchFailureReason`.

- **No reintentable**: volver a pedir no cambia nada; `POST /api/links/:id/enrich` responde `409` por la regla que ya
  usa `isRetryableEnrichmentReason`. El SPA no ofrece reintentar, muestra el texto genérico y marca la tarjeta como
  pendiente de una persona (`needsHand`), sin cambiar código: lo fija un test (D11).
- **Frescura**: «Cierre por relectura» enumera de forma cerrada las señales que cierran; `unsafe_destination` no está,
  así que no cierra. Se fija con un test.
- **Un nombre que no resuelve sigue siendo `http_error`**: el `lookup` distingue «no hay respuesta» de «respuesta
  prohibida»; solo la segunda es `unsafe_destination`.
- **Registro**: `warn` con `linkId`, `stage: 'page'` y `category`; nunca la URL, el host ni la dirección
  (`links/enrichment` ya prohíbe registrar la URL del usuario).

*Descartado:* reutilizar `http_error` (es reintentable y deja un bucle de reintentos inútiles); reutilizar `blocked`
(dice «la bolsa nos bloquea», que es falso y activa en el SPA el texto de pegar la descripción de una plataforma).

### D5. El `robots.txt`: redirecciones a mano, hasta cinco, y lectura por trozos

`createHttpRobotsFetcher` pasa a `redirect: 'manual'` sobre el `HttpFetch` del guardia:

- hasta **cinco** saltos (el mínimo que pide el estándar del `robots.txt`, RFC 9309 §2.3.1.2); cada salto pasa por el
  guardia;
- un salto **a otro host** se sigue solo si el destino es exactamente la ruta `/robots.txt` sin query (E6 del debate):
  es el caso que el estándar contempla (el sitio sirve sus reglas desde otro dominio) y no convierte el `robots.txt` en
  un medio para pedir rutas arbitrarias de otro host; cualquier otro salto a otro host es «no disponible»;
- un plazo único para toda la cadena (`AbortSignal.timeout(ENRICH_FETCH_TIMEOUT_MS)`, como hoy);
- cuerpo leído por trozos, abandonando al pasar `ROBOTS_MAX_BYTES`; lo que no cabe se trata como hoy: sin reglas;
- más saltos, destino rechazado o cuerpo demasiado grande → `null` («no disponible», permitido), sin abrir conexión
  hacia el destino rechazado. Es la semántica que ya tiene `null` en `RedisCachedRobots`, y la página tiene su propio
  filtro: si el host de la página es interno, la página cae en D4;
- **registro** (E7 del debate): el fetcher del `robots.txt` no conoce el link, así que su `warn` lleva
  `stage: 'robots'` y `category`, **sin** `linkId`, y tampoco URL, host ni dirección.

*Descartado:* prohibir todo salto a otro host (rompería sitios que sirven sus reglas desde otro dominio); seguir
cualquier ruta en otro host (más superficie que la necesaria); tratar un destino rechazado del `robots.txt` como
«prohibido» (castigaría a la página por una decisión que es del `robots.txt`); pasar el `linkId` al fetcher del
`robots.txt` (cambia el puerto de `RedisCachedRobots`, que cachea por host y no por link).

### D6. La API rechaza lo que se ve sin resolver

`normalizeUrl` (o el caso de uso que lo llama, que recibe la política por un token de configuración: el dominio no
lee configuración) rechaza como no reconocida una URL cuyo host es un nombre sin punto, `localhost`/`*.localhost` o una
dirección literal no pública, o cuyo puerto no admite D2, con el mismo clasificador de D1 y la misma política de D8.
`POST /api/links` responde `invalid_url`; la importación la cuenta en `unrecognized`; la extensión usa el mismo
guardado. **No se resuelve DNS en la API**: la decisión de adónde se conecta es del worker, y un nombre público que
resuelve a una dirección interna solo se detecta allí.

*Descartado:* no tocar la API (guarda basura que nunca se podrá leer y da peor respuesta a quien la escribió);
resolver en la API (latencia en el guardado, y la respuesta puede cambiar antes de que el worker conecte, así que no
aporta seguridad).

### D7. Push: lista de servicios push conocidos, con un solo criterio de URL, en el alta y antes de enviar

El endpoint push lo genera el navegador y siempre es de su servicio push. Se valida con `isKnownPushEndpoint(raw)` en
`libs/shared/src/notifications/push-services.ts`: `https`, sin credenciales, puerto 443 (o ausente) y host igual a,
o terminado en `.` + uno de: `fcm.googleapis.com` (Chrome y derivados de Chromium), `push.services.mozilla.com`
(Firefox), `push.apple.com` (Safari) y `notify.windows.com` (Edge).

**Un solo criterio para dos analizadores** (E1 del debate). El alta analiza con WHATWG (`new URL`) y la librería de
envío analiza con el analizador heredado de Node; si una cadena se puede leer distinto en uno y otro, el host aprobado
no sería el host al que se envía. Por eso el predicado exige, sobre el texto crudo recibido:

- que no tenga espacios, caracteres de control ni barra invertida;
- que `new URL(raw).href === raw`, es decir, que ya esté en su forma canónica y no haya nada que normalizar;
- que el host esté formado solo por letras ASCII, dígitos, guiones y puntos.

Y `WebPushVapidSender`, **antes de enviar**, además de volver a pasar el predicado, exige que el host que obtiene el
analizador heredado (`url.parse`) sea igual al de WHATWG; si difieren, la suscripción se trata como fuera de la lista.

El predicado lo usan el `refine` de `pushSubscriptionRequestSchema` (alta → `400 validation_error` nombrando
`endpoint`) y `WebPushVapidSender`, que lo recibe inyectado: un endpoint que no cumpla se borra sin conectar
(suscripciones guardadas antes de la regla). **Registro del borrado** (V2-3 del debate): `warn` con el host del
endpoint, o la categoría `unparseable` si no se puede analizar; nunca el endpoint completo, cuya ruta identifica la
suscripción. Los tests del sender que hoy usan servidores locales inyectan una política permisiva; los del API pasan
a hosts de la lista.

*Descartado:*
- **El mismo filtro de salida de D1** en lugar de la lista: impediría las direcciones internas, pero dejaría el
  servidor enviando `POST` firmados con nuestra identidad VAPID a cualquier host público que alguien registre, y exige
  inyectar un agente en las entrañas de `web-push`.
- **Lista y filtro a la vez**: los hosts de la lista son públicos y de grandes proveedores; el filtro añadiría
  acoplamiento a `web-push` sin cubrir un caso realista.
- **Lista por configuración** (`PUSH_ALLOWED_HOST_SUFFIXES`): una superficie más que se puede dejar mal en un
  despliegue; ampliar la lista es un cambio de código pequeño y revisado.
- **Normalizar el endpoint y guardar la forma normalizada**: cambia la identidad del endpoint que usa la idempotencia
  del alta y la baja por endpoint; rechazar lo no canónico es más simple y ningún navegador envía un endpoint así.

### D8. `EGRESS_ALLOW_PRIVATE_TARGETS`, solo fuera de producción

Booleano, por defecto `false`, en `api-config.schema.ts` y `worker-config.schema.ts`. Encendido permite **solo**
loopback (`127.0.0.0/8`, `::1`), los rangos de RFC 1918 (`10/8`, `172.16/12`, `192.168/16`), `localhost` y nombres sin
punto, con cualquier puerto (D2). **Sigue prohibiendo** (E5 del debate) `100.64/10` y `fc00::/7` —direcciones de
infraestructura del proveedor o de redes superpuestas, que nadie necesita para desarrollar—, enlace local
(`169.254/16`, `fe80::/10`, donde viven los metadatos de la nube), `0/8`, `::`, multidifusión, difusión, reservadas,
documentación y las mapeadas a IPv4: un portátil de desarrollo dentro de una VM en la nube también tiene metadatos. Con
`NODE_ENV=production` y `true`, el `superRefine` de cada esquema falla nombrando la variable, como hace `parseAiConfig`
con el mock. Encendido, un `warn` en el arranque. No se declara en `apps/web-e2e/e2e.env` (no la necesita nadie hoy) y
en `.env.example` va documentada y apagada. No afecta a la lista de push (D7), que no tiene excepción por entorno.

*Descartado:* abrir también `100.64/10` y `fc00::/7` (la versión anterior de este design; E5); una lista de hosts
permitidos por configuración (más superficie y más fácil de dejar abierta); permitirlo por `NODE_ENV !== 'production'`
sin variable (la pila e2e corre con `NODE_ENV=development` y quedaría abierta sin que nadie lo pidiera).

### D9. Encaje con la fila 35 (excepción pedida)

Las condiciones de la proposal: no cambia el orden de la fila, no libera la precedencia para nadie y no toca ficheros de
despliegue, workflows, `infra/ci/` ni requirements de `platform/*`. Que la producción no pueda arrancar con la opción
encendida lo garantiza el esquema de configuración (D8), no un guardia en `repo-checks`, precisamente para no tocar
`infra/ci/` (35c tiene guardias diferidos ahí). La regla de ESLint de D10 va en `eslint.config.mjs` de la raíz, que no
es `infra/ci/`. La defensa del lado del despliegue se escribe como recomendación en ADR-056 §6 y no se edita
`openspec/changes/staging-host/`. Cuándo se aplica y fusiona es la Q1, con las ventanas que ya fijan 35b y
`e2e-suite`; dos tareas de cierre comprueban la ventana del PR de apply (7.7) y la del PR de archivo (7.8).

### D10. Cómo se verifica

- **Rangos con literales de la spec** (E10 del debate): los tests del clasificador recorren tablas de direcciones
  **copiadas a mano de la spec** (dentro, borde y fuera por rango), sin importar ninguna tabla de la implementación;
  así un rango que falte en el código no desaparece también del test. Además: notaciones IPv4 que normaliza el
  analizador WHATWG, IPv6 con corchetes, mapeadas, traducción con IPv4 pública y privada dentro, IPv6 fuera de
  `2000::/3`, nombres sin punto con y sin punto final, `localhost` y subdominios, puertos; con y sin
  `allowPrivateTargets`.
- **Integración del guardia** (worker, sin red externa): servidores HTTP en loopback que **cuentan conexiones** y un
  resolvedor inyectado que mapea nombres de prueba de `.test` a direcciones elegidas. **Cada test de «no abre
  conexión»** (E9 a) afirma además que la causa del fallo es `EgressBlockedError` (no un rechazo de conexión ni un
  plazo vencido) y va acompañado, en el mismo fichero, de un **control positivo** que abre exactamente una conexión
  con la misma pila: sin eso, «cero conexiones» lo daría también un guardia roto que no conecta nunca.
- **Cambio de DNS** (E9 b): dos servidores en `127.0.0.2` y `127.0.0.3`, una **política inyectada** que aprueba el
  primero y rechaza el segundo, y un resolvedor que responde distinto en la primera y la segunda consulta y cuenta
  llamadas; se afirma una consulta por conexión, que la conexión llegó al servidor aprobado y que el otro contó cero.
- **Proxy** (E9 c): un proxy HTTP local que cuenta conexiones, apuntado por `HTTP_PROXY`/`HTTPS_PROXY` en el entorno
  del test; cuenta cero. Falsación: usar `EnvHttpProxyAgent` como dispatcher y ver al proxy contar una.
- **Fetcher real sobre guardia real** (E8): `HttpPageFetcher` con el `createGuardedFetch` real, en `http://` y
  `https://` (servidor TLS local con certificado autofirmado generado en el test y confiado solo en ese `Agent`):
  destino rechazado → `unsafe_destination` con cero conexiones; nombre que no resuelve → `http_error`.
- **Regla de ESLint** (E11) en `apps/worker/src/modules/enrichment/**`: `no-restricted-globals` (`fetch`) y
  `no-restricted-imports` (`undici`, `node:http`, `node:https`, `http`, `https`). El guardia vive en
  `apps/worker/src/infrastructure/egress/`, fuera de ese alcance. Como ESLint no combina las opciones de una regla entre
  bloques (ADR-017), el bloque que cubra `enrichment/domain/**` repite `DOMAIN_RESTRICTED_PATTERNS`.
- **Falsación** de cada guardia: se hace, se ve caer el test nombrado en `tasks.md` y se restaura.

### D11. Dos toques mínimos al SPA

- **Alta push rechazada** (V1-1 del debate): si `registerPushSubscription` responde `400` con código
  `validation_error`, `PushNotifications.enable()` llama a `subscription.unsubscribe()` sobre la suscripción del
  navegador antes de devolver el fallo, y `subscribed` queda en `false`. Así la pantalla no dice «activados» para un
  navegador al que el servidor nunca enviará nada. Otros fallos (red, `5xx`) no la cancelan: son transitorios y la
  suscripción sirve para el siguiente intento. Vive en `core/notifications/push-notifications.ts`, sin textos nuevos ni
  cambios en el catálogo i18n.
- **Tarjeta con `unsafe_destination`** (V2-2 del debate): sin cambio de código; un test en `link-status.spec.ts` fija
  `needsHand: true`, `canRetry: false`, `pasteFirst: false` y el texto genérico.

*Descartado:* textos propios para los dos casos (Q2; tocaría el catálogo i18n); cancelar la suscripción local ante
cualquier fallo del alta (un corte de red la perdería sin motivo).

## Risks / Trade-offs

- **R1. Falsos positivos.** Un sitio público cuyo DNS devuelve alguna dirección interna, o que publica sus ofertas en
  un puerto que no es `80`/`443`, queda ilegible (`unsafe_destination`, o `invalid_url` al guardar si el puerto está en
  la URL). Se acepta: no se conoce ninguna bolsa así, y el motivo lo deja visible en el link.
- **R2. Dependencias directas nuevas** (`undici`, `ipaddr.js`). Ya están en el lockfile; pasar a directas obliga a
  vigilarlas en Renovate. La versión de `undici` del paquete y la interna de Node pueden diferir: por eso se usan juntos
  `fetch` y `Agent` del paquete (D3). Un cambio de la firma de `buildConnector` en una versión mayor rompe el conector:
  lo detectan los tests de integración de 2.2a/2.2b.
- **R3. La lista de push envejece.** Un navegador con un servicio push nuevo no podrá suscribirse (`400`), el SPA lo
  muestra como fallo no bloqueante, cancela la suscripción local (D11) y el correo sigue igual (`web/notifications`).
  Se corrige ampliando la lista.
- **R4. Headless futuro.** Un navegador headless resuelve y conecta por su cuenta y saltaría este filtro. Cuando exista
  su adaptador, tendrá que salir por el mismo guardia (proxy local filtrado o equivalente); ADR-056 lo deja escrito.
- **R5. Proxy de salida.** Si algún día el worker sale por un proxy, el filtro comprobaría la dirección del proxy. El
  diseño fija «sin proxy del entorno» y un test lo comprueba; usar un proxy sería un change con su propio filtro.
- **R6. El filtro no sustituye a la segmentación.** Cubre las conexiones iniciadas por URLs de usuario; un fallo en
  otra parte del worker seguiría viendo los servicios internos. Por eso la recomendación de ADR-056 §6 para 35b.
- **R7. Reversión reabre el defecto** (E12 del debate). Revertir este change devuelve el worker a descargar sin filtro:
  con el registro abierto de staging, el defecto vuelve a ser explotable por cualquiera que se registre. Por eso **no
  se revierte** mientras el registro siga abierto **salvo** que antes se cierre el registro o que el despliegue ya
  tenga la defensa de ADR-056 §6 (red propia del worker y servicios internos autenticados). Además, los links con
  `lastEnrichmentError.reason = unsafe_destination` no los acepta el esquema anterior: ver Migration Plan.
- **R8. Pestañas abiertas durante el despliegue.** Un SPA anterior que reciba `unsafe_destination` en un aviso en
  tiempo real no lo reconoce; se recarga (mismo trato que ADR-055).
- **R9. Ventana de exposición antes de fusionar.** Con la Q1 en (a), staging tiene registro abierto desde la 6.3 de 35b
  hasta que este change se despliega tras la 11.6. Mientras tanto el defecto existe en staging, sin invitados todavía.
  Lo acotan no anunciar el origen de staging y, si 35b la adopta, la defensa de ADR-056 §6; lo elimina la opción (e).
- **R10. `127.0.0.2`/`127.0.0.3` en tests.** En Linux (CI) todo `127.0.0.0/8` es local; en otros sistemas puede no
  estarlo. Si un sistema de desarrollo no los admite, el test de 2.3 se salta allí con un motivo escrito, nunca en CI.

## Migration Plan

1. Sin migración de datos: los links existentes no cambian; los guardados antes con hosts internos fallarán con
   `unsafe_destination` en su próxima lectura, y las suscripciones push fuera de la lista se borran en su próximo envío.
2. Despliegue normal por `cd-staging` tras fusionar, en la ventana de la Q1; ningún fichero de despliegue cambia y la
   variable nueva no se declara en producción (vale `false`).
3. **Reversión** (E12 del debate; solo si R7 lo permite). El esquema anterior no conoce `unsafe_destination`, así que
   ese motivo pasa a **`blocked`**: es no reintentable en el esquema anterior (el código viejo no reintenta ni ofrece
   reintentar, que es lo que importa sin filtro) y no cierra vacantes por frescura (`links/freshness`, «Cierre por
   relectura», lo excluye). Se descartan `http_error` (reintentable: el código viejo volvería a pedir la página sin
   filtro), `not_found` (cierra por frescura), `not_a_job` (dice que no es una oferta) y `robots_disallowed` (dispara
   el rescate por historial de `asksForHistoryRescue`, que pediría una lectura nueva sin filtro). El SPA anterior
   mostrará esos links como «esta web no nos deja leer» y ofrecerá pegar la descripción: es inexacto, pero no lleva a
   ninguna descarga. Orden:
   1. parar el worker (nadie escribe motivos nuevos ni lee sin filtro);
   2. actualizar en `job_links` los `lastEnrichmentError.reason` que valgan `unsafe_destination` a `blocked`;
   3. desplegar el commit anterior;
   4. repetir la actualización del paso 2 (recoge lo que escribiera una réplica o un job en vuelo entre 2 y 3) y
      comprobar que el recuento de `unsafe_destination` es `0`.

   La orden exacta (`mongosh`) se anota en el PR de apply y se ensaya en local (7.3a, 7.3b). Las suscripciones push
   borradas no se recuperan: el navegador las vuelve a registrar al reactivar.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`]. Excepción a la precedencia de la fila 35: ¿cuándo se fusiona?** El PR-1 de 35b
  ya está en `main` (#86). Las reglas vigentes: `staging-host/tasks.md` dice «Entre PR-1 y PR-2 no se fusiona nada a
  `main`», y D15 de `e2e-suite` prohíbe fusionar entre el PR-2 de 35b y su 11.6. Aplicar (escribir el código en su
  rama) puede empezar en cuanto se responda; lo que tiene ventana es la fusión.
  - (a) **Después de la 11.6 de 35b y antes de su 10.7.** Es la única ventana que respetan las dos reglas. La fusión
    despliega un commit nuevo en staging, así que la precondición de invitar se rehace: se **repite la 9.4 de
    `e2e-suite`** sobre el commit desplegado con este change. Y, si por cualquier motivo la fusión cae con la medición
    de 35b ya en marcha, nunca en sus días 7 y 14. El estado de la 11.6 y la 10.7 se toma de una confirmación escrita
    y fechada del owner en el PR, porque sus casillas solo se marcan en el PR de archivo de 35b (tarea 7.7). El PR de
    archivo de este change, que lleva las anotaciones posteriores a la fusión y también despliega staging, se fusiona
    después de la 10.7 de 35b y fuera de los días 7 y 14, con la misma guardia (tarea 7.8). Costo: staging tiene registro abierto sin filtro desde la 6.3
    hasta esta fusión (R9), y una corrida más de la 9.4 (dos análisis del cupo de IA de la cuenta de pruebas).
  - (b) **Después de 35c**, sin excepción: entonces 35b no debería invitar —ni dejar el registro abierto con destino—
    hasta tenerlo, lo que retrasa la fila entera.
  - (c) **Dentro de 35b**: absorberlo en `staging-host`, que es un change de despliegue con dos PR en ventanas
    autorizadas y ya muy cargado; mezclaría código de producto con infraestructura.
  - (d) **Excepción expresa del owner a la regla «entre PR-1 y PR-2» de 35b**: fusionar antes del PR-2 de 35b. Gana
    que el filtro llegue antes, pero arriesga la 6.3: la 6.3 despliega el commit de PR-1 relanzando su corrida, así que
    el primer despliegue seguiría sin filtro hasta el siguiente; su alternativa escrita («lanzar `cd-staging` sobre
    `main`, el commit de PR-1») dejaría de apuntar a ese commit; y, con los secretos ya configurados (6.1), el push de
    la fusión desplegaría otro commit en medio de los ensayos que relanzan la corrida de la 6.3 (6.5-6.7, 9.1-9.4).
    Exige reescribir esas tareas de 35b, que este change no puede editar.
  - (e) **Si no hay ventana antes de invitar, 35b no abre el registro hasta tener este change.** Elimina R9 para los
    invitados, pero retrasa la 10.7 y la medición hasta que la ventana (a) exista; y si el registro es abierto desde
    la 6.3 por cómo está desplegado, (e) solo pospone invitar: cerrar el registro de verdad es una decisión del owner
    sobre ADR-051 §5 que este change no toma.
  - **Recomendación: (a)**, con (e) como regla de respaldo si la 11.6 se retrasa hasta el día previsto para invitar.
    (d) no se recomienda: su costo cae sobre tareas de 35b ya ensayadas. La respuesta se anota en ADR-056 §1 en una
    línea que empieza por «Respuesta del owner (Q1), AAAA-MM-DD:» y en ADR-048 §Consecuencias.
- **Q2 [no bloqueante]. Mensajes propios en el SPA** para `unsafe_destination` («Esta dirección no es pública») y para
  el `400` del alta push («Este navegador no es compatible con los avisos push»). Recomendación: no ahora; el texto
  genérico es honesto y evita tocar el catálogo i18n. Candidato para un change de producto tras la fila 35.
- **Q3 [no bloqueante]. Trasladar la recomendación de ADR-056 §6 a `staging-host`** (tareas o riesgos de su design) en
  un PR solo de spec, como hizo ADR-053 §1.4, o dejarla solo en el ADR para que 35b la recoja en su debate.
  Recomendación: PR solo de spec tras la aprobación de este change, con el texto de §6 y sin cambiar su orden de tareas.
- **Q4 [no bloqueante]. Métrica de rechazos** (`linkvault_egress_blocked_total{stage,category}`) en `/metrics`.
  Toca `platform/observability`, que la condición de D9 deja fuera. Recomendación: solo registro ahora; la métrica
  después de 35c.

## Debate — iteración 1

Critic: P0 0, trece P1 (E1-E13). Business: V0 0, cuatro hallazgos (V1-1, V2-1, V2-2, V2-3). Reflect: la sesión
principal. Los hallazgos de seguridad se describen en términos generales: el repositorio es público.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| E1 | critic | Aceptado: un solo criterio para el endpoint push (host solo con letras, dígitos, guiones y puntos; texto crudo sin espacios, controles ni barra invertida; forma canónica WHATWG idéntica al texto; antes de enviar, mismo host en el analizador heredado y en WHATWG). D7; 6.1, 6.3 | Dos analizadores de URL podían leer distinto el mismo endpoint y aprobar un host distinto del que recibe el envío |
| E2 | critic | Aceptado: la clasificación pasa a un conector propio que envuelve `buildConnector`; `createGuardedFetch` fuerza `redirect: 'manual'` y `allowH2: false`. D3; 2.2a, 2.2b | Una comprobación previa al `fetch` no cubría los literales en saltos que siguiera el cliente ni a un llamador que se la saltara |
| E3 | critic | Aceptado: solo puerto por defecto u `80`/`443`, en el clasificador compartido. D2, D6; 1.4, 5.2 | Los servicios internos escuchan en otros puertos; ninguna bolsa los usa |
| E4 | critic | Aceptado: IPv6 público solo dentro de `2000::/3`, menos los rangos de la spec; la traducción sigue juzgándose por su IPv4. D2; 1.2 | Una lista de prohibidos IPv6 deja pasar rangos especiales no enumerados |
| E5 | critic | Aceptado: la opción de desarrollo abre solo loopback, RFC 1918, `localhost` y nombres sin punto; `100.64/10` y `fc00::/7`, siempre prohibidos. D8; spec; ADR-056 §4; 1.3 | Nadie los necesita para desarrollar y son direcciones de infraestructura |
| E6 | critic | Aceptado: un salto del `robots.txt` a otro host solo si el destino es `/robots.txt` sin query. D5; spec; 4.1 | Evita usar el `robots.txt` para pedir rutas arbitrarias de otro host |
| E7 | critic | Aceptado: el fetcher del `robots.txt` registra `stage: 'robots'` y `category` sin `linkId`. D5; spec; 4.1 | No conoce el link; la spec pedía un dato que no tiene |
| E8 | critic | Aceptado: test de integración del fetcher real sobre el guardia real, en `http://` y `https://`. D10; 3.5 | Los dobles de `HttpFetch` no prueban la traducción de errores reales del cliente |
| E9 | critic | Aceptado: causa `EgressBlockedError` con control positivo; dos servidores `127.0.0.2`/`127.0.0.3` con política inyectada; proxy contador con falsación `EnvHttpProxyAgent`. D10; 2.2a, 2.2b, 2.3 | «Cero conexiones» también lo daba un guardia roto |
| E10 | critic | Aceptado: tablas de rangos copiadas de la spec, sin importar la implementación. D10; 1.1, 1.2 | Un test que importa la tabla del código no detecta un rango que falte |
| E11 | critic | Aceptado: ESLint (`no-restricted-globals` `fetch`; `no-restricted-imports` `undici`, `node:http`, `node:https`) en el módulo de enriquecimiento, en lugar del `grep`. D10; 3.2 | Un `grep` no queda como guardia permanente y se esquiva con otra forma de escribir |
| E12 | critic | Aceptado: la reversión usa `blocked`; orden parar worker → actualizar → desplegar anterior → repetir; R7 dice que revertir reabre el defecto y exige cerrar el registro o la defensa de ADR-056 §6. Migration Plan; R7; 7.3a, 7.3b | `http_error` es reintentable y `robots_disallowed` dispara el rescate por historial: los dos pedirían lecturas sin filtro |
| E13 | critic | Aceptado: 2.2 partida en 2.2a/2.2b y 7.3 en 7.3a/7.3b. tasks | Superaban la hora |
| V1-1 | business | Aceptado: ante `400 validation_error` en el alta push, el SPA cancela la suscripción local. D11; spec `web/notifications`; 6.4 | La pantalla decía «activados» para un navegador al que nunca se enviará nada |
| V2-1 | business | Diferido: queda en «Fuera de alcance» de la proposal | Decisión de reflect en esta iteración |
| V2-2 | business | Aceptado: escenario «`unsafe_destination` → pendiente de una persona, sin reintentar» y test en `link-status.spec.ts`. D4, D11; spec; 3.6 | Fija el comportamiento del SPA, que no cambia de código |
| V2-3 | business | Aceptado: el registro del borrado push lleva el host (o `unparseable`), nunca el endpoint completo. D7; spec; 6.3 | Sin el host no se puede diagnosticar qué servicio falta en la lista |
| Ventana | critic (P0 en otro change, aplica a todos) | Q1 reescrita: la única ventana válida es tras la 11.6 de 35b y antes de su 10.7, repitiendo la 9.4 de `e2e-suite`; opciones (d) y (e) nuevas con su costo; tarea 7.7 que comprueba la ventana con la confirmación fechada del owner y el número del PR-2 de 35b; tarea 7.8: el PR de archivo, con las anotaciones posteriores, se fusiona tras la 10.7 y fuera de los días 7 y 14. Q1; ADR-056 §1; 0.1, 7.7, 7.8 | La Q1 anterior proponía fusionar entre PR-1 y PR-2 de 35b, que su cabecera de tareas prohíbe |

Convergencia: pendiente de la iteración 2.
