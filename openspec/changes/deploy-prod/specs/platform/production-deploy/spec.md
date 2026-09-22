## Purpose

Define el camino reproducible a producción: compose con Traefik y TLS, imágenes publicables, réplicas del worker, contrato
de variables de entorno y documentación del despliegue canónico (compose+Traefik) sin exigir hosts alternativos como
código del repositorio.

## ADDED Requirements

### Requirement: Compose de producción

El repositorio SHALL incluir un `docker-compose.prod.yml` (o nombre equivalente documentado) que declare los servicios
`api`, `worker` (al menos una réplica), `web`, MongoDB como replica set `rs0` de un nodo, Redis, un almacén de objetos
S3-compatible (MinIO por defecto) y Traefik como proxy de entrada. El arranque documentado SHALL dejar esos servicios
saludables según sus healthchecks sin pasos manuales fuera de las variables de entorno y los secretos.

#### Scenario: Stack prod completo

- **GIVEN** un host con Docker y las variables de producción definidas
- **WHEN** se ejecuta el comando de arranque documentado en `infra/README.md`
- **THEN** SHALL quedar en ejecución `api`, al menos una réplica de `worker`, `web`, Mongo `rs0`, Redis, el object store
  y Traefik
- **AND** los healthchecks de `api` y `worker` SHALL reportar salud según `platform/runtime-health`

#### Scenario: Réplicas del worker

- **GIVEN** la configuración de compose con `worker` a escala ≥ 1
- **WHEN** se levanta el stack de producción
- **THEN** SHALL existir al menos una réplica de `worker` consumiendo colas
- **AND** el compose SHALL permitir escalar `worker` sin tocar el resto de servicios

### Requirement: TLS Let's Encrypt vía Traefik

Traefik SHALL terminar TLS con certificados Let's Encrypt para los hosts públicos documentados del entorno. Los logs de
acceso de Traefik (o del proxy de entrada) NO SHALL registrar query strings de las rutas del SPA `/login`, `/registro` ni
`/unirse`, de modo que códigos de invitación u otros secretos en la URL NO SHALL quedar en disco.

#### Scenario: HTTPS público

- **GIVEN** DNS apuntando al host de producción y Let's Encrypt alcanzable
- **WHEN** un cliente abre el origen HTTPS documentado
- **THEN** Traefik SHALL servir un certificado válido de Let's Encrypt
- **AND** el tráfico hacia `api` y `web` SHALL llegar por el proxy de confianza

#### Scenario: Sin query strings de rutas sensibles del SPA

- **GIVEN** una petición a `/unirse?codigo=<secreto>` (o a `/login` / `/registro` con query)
- **WHEN** Traefik escribe el log de acceso de esa petición
- **THEN** la línea de log NO SHALL contener el query string
- **AND** el path `/unirse` (o `/login` / `/registro`) MAY aparecer sin parámetros

### Requirement: Enrutado Traefik de paths públicos

Traefik SHALL enrutar el tráfico de entrada así:

- paths bajo `/p/` → servicio `api` (páginas públicas de share);
- paths bajo `/api/` → servicio `api`;
- el resto de paths del origen público → servicio `web` (SPA).

Las rutas `/metrics` y `/health` / `/health/*` (o equivalentes de liveness/readiness) NO SHALL exponerse a Internet
público; SHALL quedar restringidas a la red interna de Docker o a una ACL Traefik equivalente (allowlist / no entrypoint
público).

#### Scenario: Share y API van a api

- **GIVEN** el stack prod con Traefik
- **WHEN** un cliente pide `GET /p/<slug>` o cualquier path bajo `/api/`
- **THEN** Traefik SHALL enrutar al servicio `api`

#### Scenario: SPA por defecto

- **GIVEN** el stack prod con Traefik
- **WHEN** un cliente pide `/login` o `/privacidad` (u otra ruta que no sea `/p/` ni `/api/`)
- **THEN** Traefik SHALL enrutar al servicio `web`

#### Scenario: Metrics y health no públicos

- **GIVEN** un cliente en Internet sin acceso a la red Docker
- **WHEN** intenta `GET /metrics` o `GET /health` en el origen público HTTPS
- **THEN** la petición NO SHALL alcanzar el scraper/orquestador como endpoint público documentado
- **AND** el acceso legítimo SHALL ser solo desde la red interna o ACL documentada

### Requirement: Rate limit y tope de cuerpo en POST /api/cv

En Traefik (borde), `POST /api/cv` SHALL tener **rate limit por IP** de **10 peticiones / 15 minutos** por IP y un
`clientMaxBodySize` (o equivalente) acotado al contrato de CV: **5 MiB** de archivo más overhead multipart, tope proxy
**6 MiB**. Una petición que exceda el tope SHALL rechazarse en el proxy sin exigir que `api` lea el cuerpo completo.

#### Scenario: Cuerpo demasiado grande en el borde

- **GIVEN** Traefik con el tope de cuerpo de CV configurado
- **WHEN** un cliente envía `POST /api/cv` con un cuerpo mayor al tope documentado
- **THEN** Traefik SHALL rechazar la petición (p. ej. 413)
- **AND** `api` NO SHALL verse obligada a bufferizar el exceso completo

#### Scenario: Rate limit por IP en subida de CV

- **GIVEN** Traefik con rate limit por IP en `POST /api/cv`
- **WHEN** la misma IP supera el umbral documentado en la ventana
- **THEN** las peticiones siguientes desde esa IP SHALL recibir `429` (o equivalente del proxy)
- **AND** otra IP NO SHALL compartir ese contador

### Requirement: Referrer-Policy en rutas del SPA

Las respuestas de las rutas del SPA servidas vía Traefik o `web` (en especial `/unirse`) SHALL incluir una cabecera
`Referrer-Policy` documentada (`no-referrer` o `strict-origin-when-cross-origin`) de modo que códigos de invitación en la
URL NO SHALL filtrarse a terceros vía Referer.

#### Scenario: Unirse no filtra el código por Referer

- **GIVEN** Ana abre `/unirse?codigo=<secreto>`
- **WHEN** el navegador sigue un enlace a un origen tercero desde esa página
- **THEN** la política de referrer documentada SHALL impedir que el query con el código viaje completo a ese tercero
  (según el valor de política elegido)

### Requirement: Imágenes multi-stage publicables

El repositorio SHALL incluir Dockerfiles multi-stage para `api`, `worker` y `web` que produzcan imágenes publicables en
**GHCR**. Las imágenes de `api` y `worker` SHALL incluir healthchecks HTTP que usen `GET /health/live` para liveness
y `GET /health` para readiness. La imagen de `api` SHALL incluir los prompts de IA en la ruta documentada para
`AI_PROMPTS_DIR`.

#### Scenario: Build de imágenes

- **WHEN** se construyen las tres imágenes con los Dockerfiles del repositorio
- **THEN** el build SHALL terminar con éxito sin secretos embebidos en capas
- **AND** las imágenes de `api` y `worker` SHALL declarar healthchecks sobre `/health/live` y `/health`

#### Scenario: Prompts en la imagen de api

- **GIVEN** la imagen de `api` construida
- **WHEN** se inspecciona el filesystem de la imagen en la ruta de `AI_PROMPTS_DIR`
- **THEN** SHALL existir el árbol de prompts versionados necesarios para `runTask` en producción

### Requirement: Outbox relay en exactamente una instancia de api

En producción, el relay del outbox SHALL estar habilitado (`OUTBOX_RELAY_ENABLED=true` o equivalente) en **exactamente
una** instancia de `api`. Las demás instancias de `api`, si las hubiera, SHALL arrancar con el relay apagado. El compose
y `infra/README.md` SHALL documentar cómo se garantiza esa unicidad.

#### Scenario: Una sola api con relay

- **GIVEN** el stack de producción arrancado según la documentación
- **WHEN** se revisa la configuración de las instancias de `api`
- **THEN** exactamente una SHALL tener el relay del outbox habilitado
- **AND** el resto, si existen, SHALL tenerlo deshabilitado

### Requirement: Contrato de variables de producción

El arranque de producción de `api` (y, donde aplique, `worker`) SHALL exigir las variables obligatorias del entorno real,
entre ellas al menos: `PUBLIC_PAGE_BASE_URL`, `WEB_BASE_URL`, `AI_VAULT_KEY`, las de OpenRouter de plataforma
(`OPENROUTER_*` documentadas), las de enriquecimiento (`ENRICH_*`), las de paste (`PASTE_*` documentadas, incluido
`PASTE_EXTRACTION_TIMEOUT_MS` cuando corresponda) y `AI_PROMPTS_DIR` apuntando a los prompts embebidos en la imagen de
`api`. `TRUST_PROXY=true` SHALL figurar en el compose de producción detrás de Traefik y NO SHALL ser el valor por defecto
en local/dev. Una variable obligatoria ausente o inválida SHALL impedir el arranque según `platform/runtime-health`.

#### Scenario: Arranque sin URL pública

- **GIVEN** un entorno de producción sin `PUBLIC_PAGE_BASE_URL`
- **WHEN** se arranca `api`
- **THEN** el proceso SHALL terminar con código distinto de cero nombrando la variable

#### Scenario: Contrato documentado

- **WHEN** un operador lee `.env.example` o el apartado de variables de `infra/README.md`
- **THEN** SHALL constar la lista de variables obligatorias de producción citadas en este requirement
- **AND** SHALL indicarse que `AI_PROMPTS_DIR` en la imagen de `api` apunta a los assets embebidos
- **AND** SHALL indicarse que `TRUST_PROXY=true` aplica solo detrás de Traefik en compose prod

### Requirement: Documentación del camino canónico compose+Traefik

`infra/README.md` SHALL documentar cómo operar el compose de producción (arranque, secretos, TLS, escalado de `worker`,
relay del outbox, placeholders de host **staging** vs **prod** como dos targets de deploy). Otros hosts (VPS genérico
sin este compose, Fly, Railway, Render, k3s+Helm, Cloud Run, etc.) **NO SHALL** presentarse como soportados en este
change: una sola línea MAY indicar que no están soportados y que el camino canónico es compose+Traefik. NO SHALL
exigirse manifiestos Helm ni configs de esos hosts como entregable.

#### Scenario: README cubre el camino canónico

- **WHEN** un operador abre `infra/README.md`
- **THEN** SHALL encontrar el procedimiento del compose prod con Traefik y los placeholders de staging/prod
- **AND** NO SHALL interpretarse una lista larga de alternativas como soporte entregado de este change

#### Scenario: Alternativas sin código obligatorio

- **WHEN** se revisa el repositorio de este change
- **THEN** NO SHALL exigirse manifiestos Helm, configs Fly/Railway/Render ni Cloud Run como entregable
- **AND** la ausencia de esos archivos NO SHALL invalidar el compose prod documentado
