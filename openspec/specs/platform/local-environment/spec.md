# platform/local-environment Specification

## Purpose

Garantiza que cualquier persona pueda levantar la infraestructura de LinkVault con un solo comando, con la misma versión
mayor de MongoDB y la misma topología de replica set que usan los tests, y desarrollar las aplicaciones en su propia
máquina contra esa infraestructura sin configuración manual.

## Requirements

### Requirement: Infraestructura con un comando

El repositorio SHALL incluir una definición de contenedores que, con un solo comando y sin perfiles, levante MongoDB,
Redis, MinIO y **Mailpit** y espere a que los cuatro estén saludables. Las aplicaciones `api`, `worker` y `web` NO
SHALL formar parte de esa definición: se ejecutan en el host.

MinIO SHALL quedar saludable solo con **sus dos buckets** creados de forma idempotente: el de los snapshots del
enriquecimiento, con su regla de expiración, y el de los **CV**, **sin** regla de expiración —un CV no caduca solo— y
**sin** ninguna política de acceso anónimo. La comprobación de cada bucket SHALL ser **independiente** de la del otro,
de modo que un entorno que ya tenía el de snapshots creado SHALL crear igualmente el de CV.

Mailpit SHALL exponer SMTP para que `api` envíe correo en local y una UI de captura en el puerto documentado (por
defecto UI `8025`, SMTP `1025`, configurables).

#### Scenario: Arranque en limpio

- **GIVEN** un equipo sin volúmenes previos del proyecto
- **WHEN** se ejecuta el comando de arranque documentado en el README con espera de salud
- **THEN** el comando SHALL terminar con éxito con MongoDB, Redis, MinIO y Mailpit saludables
- **AND** NO SHALL haber ningún contenedor de `api`, `worker` ni `web`

#### Scenario: Los dos buckets existen

- **WHEN** la infraestructura queda saludable
- **THEN** SHALL existir el bucket de snapshots y el de CV
- **AND** repetir el arranque NO SHALL duplicar ni cambiar su configuración

#### Scenario: Volumen que ya existía

- **GIVEN** un volumen de MinIO con el bucket de snapshots ya creado y sin el de CV
- **WHEN** se levanta la infraestructura y se espera a que esté saludable
- **THEN** SHALL existir también el bucket de CV

#### Scenario: El bucket de CV no es público ni caduca

- **WHEN** se inspecciona el bucket de CV recién creado
- **THEN** NO SHALL tener acceso anónimo
- **AND** NO SHALL tener ninguna regla de expiración

#### Scenario: Apps en el host contra la infraestructura

- **GIVEN** la infraestructura saludable y un `.env` copiado de `.env.example`
- **WHEN** se arrancan `api` y `worker` en el host con el comando documentado
- **THEN** `GET /health` de ambos SHALL responder 200

#### Scenario: Mailpit recibe correo local

- **GIVEN** la infraestructura saludable y `api` con `MAIL_PROVIDER=smtp` hacia Mailpit
- **WHEN** se dispara un correo de verificación en desarrollo
- **THEN** el mensaje SHALL aparecer en la UI de Mailpit en el puerto documentado

### Requirement: MongoDB siempre como replica set

MongoDB SHALL arrancar como replica set `rs0` de un nodo. La inicialización SHALL ser automática e idempotente: SHALL
completarse sola en el primer arranque y NO SHALL fallar sobre un volumen ya inicializado. El servicio NO SHALL
reportarse saludable hasta que el replica set tenga primario.

#### Scenario: Primer arranque

- **GIVEN** un volumen de datos vacío
- **WHEN** se levanta la infraestructura
- **THEN** el replica set `rs0` SHALL quedar inicializado sin intervención manual

#### Scenario: Reinicio sobre un volumen existente

- **GIVEN** un volumen con el replica set ya inicializado
- **WHEN** se vuelve a levantar la infraestructura
- **THEN** MongoDB SHALL quedar saludable sin errores de inicialización

#### Scenario: Transacción desde el host

- **GIVEN** la infraestructura saludable
- **WHEN** un proceso en el host se conecta con la URI documentada en `.env.example` y ejecuta una transacción
  multi-documento
- **THEN** la transacción SHALL confirmarse

### Requirement: Ollama solo bajo demanda

El servicio de Ollama SHALL estar detrás del perfil opcional `ai-local` y NO SHALL arrancar con el comando por defecto.

#### Scenario: Arranque por defecto

- **WHEN** se levanta la infraestructura sin activar perfiles
- **THEN** Ollama NO SHALL estar en ejecución

#### Scenario: Arranque con el perfil de IA local

- **WHEN** se levanta la infraestructura con el perfil `ai-local`
- **THEN** Ollama SHALL responder en su puerto publicado en el host

### Requirement: Web y API comparten origen en desarrollo

En desarrollo, las rutas de la API SHALL servirse bajo el prefijo `/api`, excepto `/health`, `/health/live` y la página
pública `/p/:slug`. El servidor de desarrollo de `web` SHALL reenviar a la API toda petición bajo `/api`, de modo que el
navegador vea un único origen.

La página pública de la API (`/p/:slug`) y la vista pública del SPA (`/oferta/:slug`) SHALL tener rutas distintas, para
que puedan servirse desde el mismo dominio sin que ninguna tape a la otra.

#### Scenario: Petición de la SPA a la API

- **GIVEN** `api` y `web` en ejecución en el host
- **WHEN** el navegador pide `/api/<ruta-inexistente>` al origen de `web`
- **THEN** la respuesta SHALL ser un 404 emitido por la API, no el HTML de la SPA

#### Scenario: Salud fuera del prefijo

- **WHEN** se hace `GET /health` contra el puerto de la API
- **THEN** SHALL responder sin necesidad del prefijo `/api`

#### Scenario: Página pública fuera del prefijo

- **WHEN** se hace `GET /p/<slug>` contra el puerto de la API
- **THEN** SHALL responder HTML sin necesidad del prefijo `/api`

#### Scenario: Las dos rutas públicas no chocan

- **GIVEN** `api` y `web` en ejecución
- **WHEN** se piden `/p/<slug>` a la API y `/oferta/<slug>` al origen de `web`
- **THEN** la primera SHALL responder el HTML de la API y la segunda el HTML de la SPA

### Requirement: Configuración por entorno documentada

El repositorio SHALL incluir `.env.example` con todas las variables que leen `api` y `worker`, con valores válidos para
el entorno local y seguros por defecto. La selección de proveedores de IA SHALL expresarse con `AI_CHAIN` y
`AI_MOCK_MODE`; la variable `AI_PROVIDER` NO SHALL usarse. Ningún secreto real SHALL estar versionado.

Las URLs públicas de la página (`PUBLIC_PAGE_BASE_URL`) y del SPA (`WEB_BASE_URL`) SHALL declararse como variables, con
los valores del entorno local, y NO SHALL deducirse de la cabecera `Host` de una petición.

Las variables del almacenamiento de objetos (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_SNAPSHOTS_BUCKET` y `S3_BUCKET`) SHALL validarse en el arranque de **quien las lee**: `worker` todas, y `api` las
que necesita para los CV, incluida `S3_BUCKET`. El plazo y la concurrencia de la lectura de un CV
(`CV_EXTRACTION_TIMEOUT_MS`, `CV_EXTRACT_CONCURRENCY`) SHALL ser variables de `worker` con valores locales en el
ejemplo.

Las variables de correo (`MAIL_PROVIDER`, `MAIL_FROM`, SMTP hacia Mailpit y `RESEND_API_KEY` placeholder) SHALL
declararse para el entorno local con `MAIL_PROVIDER=smtp` (o el valor documentado hacia Mailpit) y sin clave real de
Resend.

#### Scenario: Valores por defecto seguros

- **WHEN** se inspecciona `.env.example`
- **THEN** `FEATURE_HEADLESS_EXTRACTION` SHALL valer `false`
- **AND** `AI_CHAIN` SHALL valer `mock`
- **AND** NO SHALL contener ninguna clave de API real ni la variable `AI_PROVIDER`

#### Scenario: URLs públicas declaradas

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL` con las URLs del entorno local
- **AND** `api` SHALL negarse a arrancar si falta alguna de las dos

#### Scenario: El bucket de CV es obligatorio para la API

- **WHEN** se arranca `api` sin `S3_BUCKET`
- **THEN** el proceso SHALL terminar con código distinto de cero nombrando la variable, sin mostrar su valor

#### Scenario: La lectura del CV se configura en el worker

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `CV_EXTRACTION_TIMEOUT_MS` y `CV_EXTRACT_CONCURRENCY` con valores válidos para el entorno local

#### Scenario: Correo local documentado

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `MAIL_PROVIDER`, `MAIL_FROM` y la configuración SMTP de Mailpit
- **AND** `RESEND_API_KEY` SHALL estar vacía o comentada como placeholder

### Requirement: Variables VAPID documentadas

`.env.example` SHALL documentar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (mailto: o URL) usadas por el
worker/api para web push. En local, valores de desarrollo son suficientes; Mailpit sigue cubriendo el canal email.
El RUNBOOK SHALL indicar cómo generar un par VAPID.

#### Scenario: Arranque local sin push real

- **GIVEN** un entorno local con VAPID de desarrollo en `.env`
- **WHEN** arrancan api y worker
- **THEN** el arranque NO SHALL fallar solo por usar claves de desarrollo
- **AND** el email de producto sigue pudiendo comprobarse en Mailpit

### Requirement: Meilisearch solo bajo el perfil search

El servicio de Meilisearch SHALL estar detrás del perfil opcional `search` de docker-compose y NO SHALL arrancar con el
comando por defecto de infraestructura (mismo patrón que Ollama / `ai-local`). Con el perfil activo, Meilisearch SHALL
escuchar en el puerto documentado y quedar saludable antes de que api/worker lo usen en desarrollo. `.env.example`
SHALL documentar `MEILI_HOST`, `MEILI_MASTER_KEY` (o el nombre canónico elegido en design), `FEATURE_SEARCH` y el resto
de variables de D11, con valores seguros de desarrollo. Sin el perfil, api/worker SHALL poder arrancar; las rutas de
búsqueda se comportarán según `search/query` (`503` si el índice no está disponible o el flag está off).

Meilisearch SHALL tratarse como servicio de **red interna** (compose network / VPC); el RUNBOOK SHALL indicar que no se
expone a Internet ni se publica la master key.

Con `FEATURE_SEARCH=false`, api/worker SHALL arrancar sin exigir Meili; emitters de search NO SHALL escribir outbox de
indexación.

#### Scenario: Arranque por defecto sin Meili

- **WHEN** se levanta la infraestructura sin activar perfiles
- **THEN** Meilisearch NO SHALL estar en ejecución
- **AND** Mongo, Redis, MinIO y Mailpit SHALL seguir saludables

#### Scenario: Arranque con perfil search

- **WHEN** se levanta la infraestructura con el perfil `search`
- **THEN** Meilisearch SHALL responder saludable en su puerto publicado
- **AND** `.env.example` SHALL documentar cómo apuntar `api`/`worker` a ese host

#### Scenario: Variables de búsqueda documentadas

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir las variables de conexión a Meilisearch del entorno local y `FEATURE_SEARCH`
- **AND** NO SHALL contener una master key de producción real

#### Scenario: Feature search off sin Meili

- **GIVEN** `FEATURE_SEARCH=false` y sin perfil `search`
- **WHEN** arrancan api y worker
- **THEN** SHALL iniciar sin error por ausencia de Meili
- **AND** mutaciones de agregados indexables NO SHALL escribir eventos Search* en outbox


### Requirement: Variables de frescura de links documentadas

`.env.example` SHALL documentar `FEATURE_LINK_FRESHNESS` (default seguro `false` en ejemplo local
salvo que el RUNBOOK indique lo contrario para demos), el intervalo de cadencia (p. ej.
`LINK_FRESHNESS_INTERVAL_DAYS=7`) y el tope por pasada (`LINK_FRESHNESS_BATCH_LIMIT`). El worker
SHALL leerlas; con el flag en `false` el detector SHALL ser no-op.

#### Scenario: Defaults documentados

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `FEATURE_LINK_FRESHNESS`, el intervalo y el límite de lote
- **AND** `FEATURE_LINK_FRESHNESS` SHALL valer `false` por defecto en el ejemplo

### Requirement: CORS y origen de la extensión en local

El entorno local documentado SHALL permitir configurar allowlist de orígenes
`chrome-extension://<extension-id>` (variable de entorno documentada en `.env.example`) para que
la API acepte peticiones CORS preflight/simple desde la extensión unpacked. El README o RUNBOOK
SHALL documentar cómo cargar la extensión unpacked y cómo obtener el extension id.

#### Scenario: Variable documentada

- **WHEN** un desarrollador abre `.env.example`
- **THEN** SHALL existir la variable de allowlist CORS de extensión documentada
- **AND** la guía local SHALL indicar pasos para cargar el build unpacked
