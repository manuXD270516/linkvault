## Why

`worker-data-hygiene` se partió el 2026-10-29 (Q5 = (a), owner): su parte A arregla lo que ve el usuario con un solo
worker, y la parte B —las marcas atómicas multi-réplica— sale a este change, con el disparador «antes del primer
`--scale worker=2`». Hasta archivarlo rige la regla «No escalar `worker` hasta archivar `worker-claims-multi-replica`»
(ADR-061 §6, `infra/README.md`, `scope` de 35c). El diseño ya se debatió dentro de `worker-data-hygiene` (commit
`776e12a`, tres iteraciones y la verificación puntual de N1, convergencia SI); este change lo retoma sin reescribirlo.

Los defectos, en `main` (`5b92d28`) y tras la parte A:

- **Las tres colecciones de marcas** (`link_freshness_claims`, `application_status_group_notify_claims` y
  `application_stale_claims`, en `mongo-freshness.adapters.ts` y `mongo-notify.adapters.ts`) no tienen índice y
  reclaman con «leer y después `updateOne` con `upsert`». Con dos réplicas y los `@Cron(EVERY_HOUR)` disparando a la
  vez, dos upserts concurrentes crean dos documentos de la misma clave y **las dos réplicas creen haber ganado**: el
  aviso de stale o de grupo se encola dos veces. El `jobId` determinista no lo evita, porque las colas del worker borran
  el job al completarse (`removeOnComplete: true`).
- **`release` borra cualquier marca sin confirmar** de la clave, también la que tomó otra réplica tras vencer la
  propia; una tercera pasada vuelve a encolar.
- **Las tomas abandonadas no caducan** y el lease se cuenta desde el `now` del principio de la pasada, no desde la toma.
- **La marca de frescura** borra el documento al confirmar (comentario sin cerrar en `:210-220`): otra réplica, en el
  mismo tick, vuelve a procesar el link.
- **La toma de una entrega vencida** en `notification_deliveries` hace `updateOne` sin condición tras leer: dos workers
  que encuentran el mismo `claimed` vencido envían los dos.

Nada de esto ocurre con un solo worker, que es lo que corre staging (`deploy.sh`, `up -d` sin `--scale`).

## What Changes

- **Toma atómica con clave única** (ADDED en `platform/worker-claims`, capacidad nueva): índice único por clave,
  `findOneAndUpdate` + `upsert` con la condición de «libre» en el filtro, lease contado desde la toma, testigo por toma,
  `release` solo de la propia, `confirm` duradero por igualdad de clave con `upsert`. Una implementación de plataforma
  del worker (`MongoLeaseClaims`) para las tres colecciones; los puertos devuelven `ClaimLease | null` en vez de
  `boolean` y dejan de recibir `now`.
- **Frescura como lease con retención corta** (30 min tras confirmar), para que no se repita en el mismo tick.
- **Caducidad**: TTL de 24 h sobre `leaseUntil`, parcial sobre `confirmed: false`; las confirmadas de stale y ASN no
  caducan nunca.
- **Migración e índices al arrancar, sin bloquear el arranque** (precisión de ADR-061 §4, design D6): completar
  `leaseUntil` heredado, deduplicar con superviviente determinista, `ttl_lease` y después `uniq_claim_key`; la migración
  corre en segundo plano y la **compuerta** de cada colección nace cerrada, así que ningún detector toma una marca antes
  de que exista su índice único y la liveness no espera a Mongo.
- **Toma única de una entrega vencida** (ADDED en `notifications/dispatch`): retoma condicionada a la toma leída.
- **Inventario de crons con varias réplicas** (ADDED en `platform/worker-claims`; Q2): un test lista los `@Cron` del
  worker con su mecanismo y falla ante uno nuevo sin inventariar; prueba de dos réplicas del digest semanal.
- **Levantar la regla de no escalar**: al archivar, la advertencia de `infra/README.md` pasa a la condición «todas las
  réplicas con una imagen que incluya este change» (Q4 para el comentario del compose de producción).

**Documentos:** sin ADR nuevo. Este change **aplica** ADR-061 §2, §3 y §4 y la toma vencida del ledger, **precisa**
§4 (la migración no bloquea el arranque; anotación de una línea) y **cierra** la regla de §6 «Para 35c». No toca §1, §5
ni §5b, que aplica `worker-data-hygiene`.

## Encaje en la fase

**Candidato posterior a `worker-data-hygiene`**, sin fila en `docs/design-v0.2.md` §6 hasta que el owner la asigne
(Q1, bloqueante para `/opsx:apply`). Precondición dura: **`worker-data-hygiene` archivado** antes de aplicar, porque este
change parte de lo que aquel deja en `main` (`NOTIFY_DELIVERY_LEASE_MS`, `mongo-notify.adapters.spec.ts`, el `$lookup`
de stale y de la cascada a las marcas confirmadas, que `uniq_claim_key` pasa a indexar, y la retoma de 3.6). Sin
excepción a ADR-048: la fila 35 habrá terminado para entonces (worker-data-hygiene va «tras 35c»).

Spec-only hasta el debate: la especificación se adelanta en paralelo por pedido del owner del 2026-11-04.

## Capabilities

### New Capabilities

- `platform/worker-claims`: toma atómica con clave única y testigo; caducidad de las tomas abandonadas sin caducar
  ningún «ya se avisó»; migración e índices antes del primer tick sin bloquear el arranque; inventario de crons con
  varias réplicas.

### Modified Capabilities

- `notifications/dispatch`: ADDED «Toma única de una entrega vencida».

## Impact

- `apps/worker/src/infrastructure/claims/` (nuevo): `MongoLeaseClaims`, `ClaimIndexesBootstrap`, `ClaimIndexesGate` y
  su módulo, que solo se registra con los consumidores habilitados (fuera de `test`), como los schedulers.
- `apps/worker/src/modules/freshness/`: `FreshnessLinkClaims` y `StatusGroupNotifyClaims` con `ClaimLease`;
  `MongoFreshnessLinkClaims` y `MongoStatusGroupNotifyClaims` delegan en `MongoLeaseClaims`; `DetectLinkFreshness`,
  `ExpireApplicationsForClosedLinkUseCase`, sus dobles y `LinkFreshnessScheduler` (dos compuertas).
- `apps/worker/src/modules/notifications/`: `ApplicationStaleClaims` con `ClaimLease`; `MongoApplicationStaleClaims`
  delega la toma y conserva `listEligible`; `MongoNotifyDeliveryLedger.claim` con retoma condicionada y
  `beforeRetake`; `DetectStaleApplications`, dobles y `StaleApplicationsScheduler` (compuerta).
- `apps/worker/src/app/`: test de inventario de crons y test de arranque con compuerta cerrada.
- Sin variables de entorno nuevas, sin cambios en `libs/`, workflows ni `apps/api`. En `infra/`: la línea de
  `infra/README.md` bajo «Escalar worker» y, con Q4 = (a), el comentario del servicio `worker` de
  `docker-compose.prod.yml` (solo comentario).
- RUNBOOK: `getIndexes()` de las tres colecciones, el `warn` de compuerta cerrada y qué hacer.

## Fuera de alcance

- Todo lo de la parte A (retención del outbox, stale sin inanición, entrega en vuelo, cascada de frescura, `warn` de
  avisos agotados): `worker-data-hygiene`.
- Barrido de las marcas confirmadas de clave muerta (retirado en el debate, B4) y retención de `notification_deliveries`.
- Varias réplicas de `api` (el relay del outbox y el SSE corren en `api`; su escalado es otro disparador).
- La copia del ledger de `api` (`MongoNotificationDeliveryRepository.claim`), con la misma toma sin condición pero sin
  ningún llamador en producción (Q3).
- Lock distribuido o réplica líder para los crons (descartados en ADR-061).
