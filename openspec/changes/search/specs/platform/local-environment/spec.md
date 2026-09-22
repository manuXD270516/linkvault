## ADDED Requirements

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
