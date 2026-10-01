## MODIFIED Requirements

### Requirement: Infraestructura con un comando

El repositorio SHALL incluir una definición de contenedores y **un solo comando documentado**, sin perfiles, que levante
MongoDB, Redis, el almacén de objetos (`platform/object-store`) y **Mailpit**, espere a que los cuatro estén saludables
y **deje el almacén aprovisionado** con la orden de aprovisionamiento de `platform/object-store`. Las aplicaciones
`api`, `worker` y `web` NO SHALL formar parte de esa definición: se ejecutan en el host.

La salud y el aprovisionamiento del almacén SHALL ser **dos cosas distintas**: su healthcheck SHALL ser de solo lectura
(«Healthcheck del almacén de solo lectura») y los buckets los SHALL crear la orden de aprovisionamiento que el comando
encadena tras la espera de salud. Esa orden SHALL dejar **sus dos buckets** creados de forma idempotente: el de los
snapshots del enriquecimiento, con su retención, y el de los **CV**, **sin** regla de expiración —un CV no caduca solo—
y **sin** ninguna política de acceso anónimo. La preparación de cada bucket SHALL ser **independiente** de la del otro,
de modo que un entorno que ya tenía el de snapshots creado SHALL crear igualmente el de CV. Si el aprovisionamiento
falla, el comando SHALL terminar con código distinto de cero nombrando el bucket y la propiedad.

Mailpit SHALL exponer SMTP para que `api` envíe correo en local y una UI de captura en el puerto documentado (por
defecto UI `8025`, SMTP `1025`, configurables).

#### Scenario: Arranque en limpio

- **GIVEN** un equipo sin volúmenes previos del proyecto
- **WHEN** se ejecuta el comando de arranque documentado en el README
- **THEN** el comando SHALL terminar con éxito con MongoDB, Redis, el almacén de objetos y Mailpit saludables y el
  almacén aprovisionado
- **AND** NO SHALL haber ningún contenedor de `api`, `worker` ni `web`

#### Scenario: Los dos buckets existen

- **WHEN** el comando de arranque termina con éxito
- **THEN** SHALL existir el bucket de snapshots y el de CV
- **AND** repetir el arranque NO SHALL duplicar ni cambiar su configuración

#### Scenario: Volumen que ya existía

- **GIVEN** un volumen del almacén con el bucket de snapshots ya creado y sin el de CV
- **WHEN** se ejecuta el comando de arranque
- **THEN** SHALL existir también el bucket de CV

#### Scenario: El bucket de CV no es público ni caduca

- **WHEN** se inspecciona el bucket de CV recién creado
- **THEN** NO SHALL tener acceso anónimo
- **AND** NO SHALL tener ninguna regla de expiración

#### Scenario: El healthcheck del almacén no crea buckets

- **GIVEN** el almacén levantado y sano, sin haber ejecutado la orden de aprovisionamiento
- **WHEN** se evalúa su healthcheck varias veces
- **THEN** SHALL darlo por sano
- **AND** NO SHALL existir ningún bucket

#### Scenario: Apps en el host contra la infraestructura

- **GIVEN** la infraestructura saludable y un `.env` copiado de `.env.example`
- **WHEN** se arrancan `api` y `worker` en el host con el comando documentado
- **THEN** `GET /health` de ambos SHALL responder 200

#### Scenario: Mailpit recibe correo local

- **GIVEN** la infraestructura saludable y `api` con `MAIL_PROVIDER=smtp` hacia Mailpit
- **WHEN** se dispara un correo de verificación en desarrollo
- **THEN** el mensaje SHALL aparecer en la UI de Mailpit en el puerto documentado

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
- **AND** Mongo, Redis, el almacén de objetos y Mailpit SHALL seguir saludables

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
