## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos uno. Los títulos que vienen de `776e12a` (grupos 7-11 de
`worker-data-hygiene`) se conservan. La falsación de un guardia se hace, se ve caer el test nombrado y se restaura en la
misma tarea. Los tests de integración usan el `MongoMemoryReplSet` del preset de `@linkvault/testing`
(`getMongoTestUri()`), con una base por fichero; las «dos réplicas» son **dos conexiones de Mongoose distintas**
(`mongoose.createConnection` dos veces sobre la misma URI y la misma base), cada una con su instancia del adaptador o del
caso de uso. **Sin esperas fijas** (design D11): las carreras se fijan por propiedades que valen para cualquier
intercalado o por puntos de inyección; solo los tests del monitor TTL sondean (250 ms, tope 10 s) con un centinela, en
su propio `MongoMemoryServer`.

- [ ] 0.1 [infra] Q1-Q4 respondidas por el owner y anotadas en `design.md` (una línea por pregunta que empieza por
  «Respuesta del owner (Qn), AAAA-MM-DD:»); la de Q1, además, en ADR-061 §6 con la forma «Respuesta del owner (Q1 de
  `worker-claims-multi-replica`), AAAA-MM-DD:». Con Q1 = (a) o (c): la fila en `docs/design-v0.2.md` §6 y el `scope` de
  la fila del manifiesto actualizado. Con Q2 = (b): borrar el grupo 9 y el requirement «Cada cron del worker declara qué
  lo protege con varias réplicas» de `specs/platform/worker-claims/spec.md`. Con Q3 = (b) o (c): añadir aquí la tarea
  de `api` correspondiente antes de aplicar. Con Q4 = (b): borrar la 10.3. Verificar:
  `grep -c "Respuesta del owner (Q[1-4]), 20" openspec/changes/worker-claims-multi-replica/design.md` devuelve `4`;
  `grep -c "Respuesta del owner (Q1 de .worker-claims-multi-replica.), 20" docs/adr/ADR-061.md` devuelve `1`; con
  Q2 = (b), `grep -c "^## 9\." openspec/changes/worker-claims-multi-replica/tasks.md` devuelve `0`; y
  `openspec validate worker-claims-multi-replica --strict` sigue en verde.
- [ ] 0.2 [infra] Debate critic/business/reflect (`/lv:debate`) cerrado sin P0/V0 abiertos y aprobación humana
  registrada en `design.md` con su fecha. Verificar: la sección del debate de la última iteración dice
  «Convergencia: SI» y existe `## Aprobación humana (AAAA-MM-DD)`.
- [ ] 0.3 [infra] Precondición: `worker-data-hygiene` archivado en `main` y la rama del apply cortada de ese `main`.
  Verificar: `ls openspec/changes/archive | grep -c "worker-data-hygiene"` devuelve `1`;
  `grep -c "export const NOTIFY_DELIVERY_LEASE_MS" apps/worker/src/modules/notifications/infrastructure/persistence/mongo-notify.adapters.ts`
  devuelve `1`; existe `apps/worker/src/modules/notifications/infrastructure/persistence/mongo-notify.adapters.spec.ts`;
  y `grep -c "Una entrega en vuelo se reintenta al vencer su lease" openspec/specs/notifications/dispatch/spec.md`
  devuelve `1`. Si alguno falla, este change no pasa de aquí.

## 1. Toma atómica (`apps/worker/src/infrastructure/claims/`, design D2, D5)

- [ ] 1.1 [backend] `MongoLeaseClaims` (`mongo-lease-claims.ts`) con conexión, colección, campos de la clave (`['linkId']`
  o `['applicationId', 'statusChangedAt']`), `mode: 'lease' | 'durable'` y un reloj `{ now(): Date }` en el
  constructor: `take(key, leaseMs)` lee `clock.now()` en el momento de tomar (H5), hace `findOneAndUpdate` + `upsert`
  con el filtro de design D2 y escribe `confirmed: false` explícito en los dos modos; devuelve `{ token }` o `null`;
  `E11000` con `keyPattern` igual a la clave → `null`; cualquier otro error se relanza (R1). Sin parámetro de sesión.
  Verificar en `mongo-lease-claims.spec.ts`: «takes a missing claim», «reports an occupied claim as not taken, not as an
  error», «takes an expired unconfirmed claim», «reports a confirmed durable claim as not taken», «rethrows a duplicate
  key error from another unique index» (índice único extra creado solo en ese test), «writes confirmed false on a
  freshness take» y «a claim taken late in a slow pass still blocks another replica» (reloj que avanza 50 min entre dos
  `take` del mismo adaptador; la segunda clave queda con `leaseUntil` futuro y otra réplica recibe `null`). Falsación
  (R1): traducir a `null` cualquier `E11000` sin mirar `keyPattern` y ver caer «rethrows a duplicate key error…»;
  restaurar.
- [ ] 1.2 [backend] Rama heredada del filtro (`leaseUntil` ausente, lease contado desde `claimedAt`; D5, R6), con
  documentos escritos a mano con la forma de hoy (`claimedAt`, `confirmed: false`, sin `leaseUntil` ni `token`).
  Verificar: «takes a legacy claim without leaseUntil once its lease counted from claimedAt expired» (escenario «Marca
  heredada sin caducidad») y «does not take a legacy claim whose lease is still running». Falsación: quitar la rama
  `$exists: false` y ver caer el primero; restaurar.

## 2. Liberar y confirmar (design D3, D4)

- [ ] 2.1 [backend] `release(key, lease)` = `deleteOne({ ...key, token, confirmed: false })`. Verificar en
  `mongo-lease-claims.spec.ts`: «release does not delete a claim taken by another holder» (escenario «Liberar no borra
  una toma ajena») y «release frees its own claim». Falsación: quitar `token` del filtro y ver caer el primero;
  restaurar.
- [ ] 2.2 [backend] `confirm(key)` en modo `durable`: `updateOne` por igualdad de clave con `$set { confirmed: true,
  confirmedAt }`, `$unset { leaseUntil, token }` y `upsert: true` (H3). Verificar: «confirm after losing the lease keeps
  the claim confirmed» (A toma, vence, B toma, A confirma, B libera → confirmada), «confirm after the other holder
  released keeps the claim confirmed» (A toma, vence, B toma, B libera, A confirma → existe y está confirmada) y «a
  confirmed durable claim carries no leaseUntil». Falsación: quitar `upsert: true` y ver caer el segundo; restaurar.
- [ ] 2.3 [backend] `confirm(key, lease)` en modo `lease` (frescura, D4): extiende `leaseUntil` a `now +
  FRESHNESS_CONFIRMED_HOLD_MS` (`30 * 60_000`) solo con su testigo y sin `upsert`. Verificar: «a confirmed freshness
  claim blocks another replica within the same tick» (reloj +2 min → `null`), «a confirmed freshness claim is takeable
  on the next hourly tick» (+60 min → toma) y «a released freshness claim is takeable at once» (escenarios «Frescura no
  se repite en el mismo tick» y «Frescura liberada tras un fallo»). Falsación: borrar el documento en `confirm`, como
  hoy, y ver caer el primero; restaurar.

## 3. Migración de las colecciones de marcas (design D6, pasos 1-4)

- [ ] 3.1 [backend] `ClaimIndexesBootstrap.migrate(collection)`, paso 1: completar `leaseUntil` (y `confirmed: false`
  si falta) de los sin confirmar que no lo tienen (`$ifNull` sobre `claimedAt`). Verificar en
  `claim-indexes.bootstrap.spec.ts`: «backfills leaseUntil on legacy unconfirmed claims» y «leaves confirmed durable
  claims without leaseUntil».
- [ ] 3.2 [backend] Paso 2: duplicados por clave con agregación con `maxTimeMS` y superviviente determinista
  (confirmado > `claimedAt` más reciente > `_id` menor). Verificar: «keeps the confirmed claim among duplicates»
  (escenario «Duplicados heredados con una confirmada»), «keeps the most recent claim when none is confirmed» y
  «computes the same survivor regardless of insertion order» (mismos documentos insertados en dos órdenes). Falsación:
  invertir la prioridad de `confirmed` y ver caer el primero; restaurar.
- [ ] 3.3 [backend] Pasos 3-4: `createIndex` de `ttl_lease` (`expireAfterSeconds: 86_400`, `partialFilterExpression:
  { confirmed: false }`) y después de `uniq_claim_key`, comprobación con `listIndexes` que abre la compuerta, hasta tres
  vueltas si `E11000`; cualquier otro error deja la compuerta cerrada con un `warn` con colección y `code`/`codeName`,
  sin datos, y `migrate` no lanza. Verificar: «creates the lease ttl index before the unique key» (orden de llamadas en
  un doble), «declares the lease ttl index only over unconfirmed claims» (filtro parcial exacto en `listIndexes`), «is
  idempotent when the indexes already exist», «retries after a duplicate inserted between dedupe and index creation»
  (un doble que inserta un duplicado la primera vez que se crea el único) y «closes the gate instead of failing
  bootstrap on a non-duplicate index error» (doble de `createIndex` que lanza un error con `code` 85; `migrate`
  resuelve, la compuerta queda cerrada y el `warn` contiene `85` y ninguna clave; escenario «Error inesperado al crear
  un índice»). Falsación: dejar que el error de `code` 85 se propague y ver caer el último; restaurar.
- [ ] 3.4 [backend] Dos réplicas migrando: dos conexiones ejecutan `migrate` de las tres colecciones con `Promise.all`
  sobre los mismos duplicados. Verificar: «two replicas migrating at once end with the indexes and the same survivors as
  one» (escenario «Dos réplicas arrancan a la vez sobre duplicados»).

## 4. Compuerta y arranque sin bloqueo (design D6)

- [ ] 4.1 [backend] `ClaimIndexesGate` por colección, que nace cerrada, y `ClaimIndexesBootstrap.ensure(collection)` de
  un solo vuelo (una llamada en curso se comparte; abierta, no se repite). Verificar en
  `claim-indexes.bootstrap.spec.ts`, con un `migrate` doble cuya promesa resuelve el test: «starts with every claims
  gate closed», «shares one migration between concurrent ensure calls» (dos `ensure` simultáneos → una llamada a
  `migrate`) y «does not migrate again once the gate is open». Falsación: quitar el un-solo-vuelo y ver caer el segundo
  (dos llamadas); restaurar.
- [ ] 4.2 [backend] Schedulers: `StaleApplicationsScheduler` hace `await ensure('application_stale_claims')` al empezar
  el tick; `LinkFreshnessScheduler`, `ensure` de `link_freshness_claims` **y** de
  `application_status_group_notify_claims` (H6). Alguna cerrada → `warn` con el nombre de la colección y se salta el
  tick. Verificar en `stale-applications.scheduler.spec.ts` y `link-freshness.scheduler.spec.ts` (nuevos, con el caso de
  uso como espía): «skips the stale tick and warns naming the collection when the unique index is missing» (escenario
  «Índice imposible de crear»), «skips the freshness tick and warns naming the asn collection when its unique index is
  missing» (escenario «Compuerta de ASN cerrada»), «runs the tick once the gate opens on retry» y «never runs a detector
  tick before the claims migration opened the gate» (el `ensure` doble queda pendiente; tras `setImmediate` el espía no
  fue llamado; el test resuelve `ensure` abierto y el espía se llama una vez; escenario «El primer tick llega antes de
  que termine la migración»). Falsación: hacer que el scheduler de frescura consulte solo su compuerta y ver caer el
  segundo; restaurar.
- [ ] 4.3 [backend] `ClaimsModule` (`apps/worker/src/infrastructure/claims/claims.module.ts`), registrado solo con los
  consumidores habilitados, con `ClaimIndexesBootstrap.onApplicationBootstrap()` que lanza `ensure` de las tres
  colecciones **sin esperarlo**. Verificar en `apps/worker/src/app/claims-gate-startup.spec.ts` (nuevo), módulo de
  testing con `ClaimsModule` y un `migrate` doble que resuelve en `setImmediate` y apunta `'migrate'` en un array
  compartido; el test apunta `'init'` al resolver `await app.init()`: «boots without awaiting the claims migration»
  (array `['init', 'migrate']`; escenario «Arranque con MongoDB caído»). Falsación: `await` de `ensure` en
  `onModuleInit` y ver el orden invertido; restaurar.
- [ ] 4.4 [backend] En el mismo spec: compuerta de stale cerrada y `EnrichLinkConsumer` con un `WorkerFactory` doble
  que captura el procesador y le pasa un job. Verificar: «keeps enrichment consumers running when a claims gate is
  closed» (el `init` resuelve y el procesador capturado corre el job) y «boots the worker when migrate fails» (`migrate`
  con error interno; `init` resuelve). Además, `startup-without-dependencies.spec.ts` sigue en verde sin cambios.

## 5. Caducidad (design D5)

- [ ] 5.1 [backend] `worker-claims-ttl.spec.ts` con un `MongoMemoryServer` propio (`binary.version: MONGOMS_VERSION`,
  `instance.args: ['--setParameter', 'ttlMonitorSleepSecs=1']`) y los índices de 3.3. Inserta un **centinela** (toma sin
  confirmar con `leaseUntil` de hace 2 días); sondea cada 250 ms, tope 10 s, hasta que desaparece, y solo entonces
  afirma (H9). Verificar: «expires an abandoned claim a day after its lease» (el centinela; escenario «Toma
  abandonada»), «expires a confirmed freshness claim a day after its hold», «never expires a confirmed durable claim»
  (confirmada con `confirmedAt` de hace 400 días, sin `leaseUntil`; escenario «Aviso ya emitido») y «never expires a
  confirmed claim that still carries a past leaseUntil» (escenario «Confirmada con un leaseUntil pasado», H4).
  Falsación: crear `ttl_lease` sin `partialFilterExpression` y ver caer el último; restaurar.

## 6. Toma vencida del ledger (design D7)

- [ ] 6.1 [backend] `MongoNotifyDeliveryLedger.claim`: retoma condicionada a `status: 'claimed'` y al `claimedAt` leído,
  `'claimed'` solo con `modifiedCount === 1` y una relectura si no; método `protected async beforeRetake():
  Promise<void>` vacío entre la lectura y la retoma. Verificar en `mongo-notify.adapters.spec.ts`: «retakes an expired
  delivery without contention» (escenario «Retoma sin competencia») y que «a delivery left claimed by a dead worker is
  sent once its lease expires» (de `worker-data-hygiene`) sigue en verde.
- [ ] 6.2 [backend] Concurrencia del ledger, determinista (H8): subclase de test de `MongoNotifyDeliveryLedger` cuyo
  `beforeRetake` de A espera a que B (otra conexión) complete su `claim` entero; luego A intenta. Verificar: «only one
  of two workers retakes an expired delivery» (B → `claimed`, A → `in_flight`; escenario «Dos workers retoman la misma
  entrega vencida»). Falsación: quitar la condición de `claimedAt` y ver caer el test (A también obtiene `claimed`);
  restaurar.

## 7. Puertos y casos de uso (design D3)

- [ ] 7.1 [backend] Frescura: `FreshnessLinkClaims.claim(linkId, leaseMs)` devuelve `ClaimLease | null`;
  `release`/`confirm` reciben la toma y no reciben `now`; `MongoFreshnessLinkClaims` delega en `MongoLeaseClaims`
  (`mode: 'lease'`) y desaparece el comentario de `mongo-freshness.adapters.ts:210-220`; `DetectLinkFreshness` y sus
  dobles en memoria ajustados. Verificar: `detect-link-freshness.usecase.spec.ts` y `freshness-close.spec.ts` en verde
  sin cambiar sus expectativas, y «releases with its own lease when the effect fails».
- [ ] 7.2 [backend] ASN: `StatusGroupNotifyClaims` con `ClaimLease`; `MongoStatusGroupNotifyClaims` sobre
  `MongoLeaseClaims` (`mode: 'durable'`); `isConfirmed` igual; `ExpireApplicationsForClosedLinkUseCase` y dobles
  ajustados (deja de pasar su `now` de principio de pasada a `claim`). Verificar:
  `expire-applications-for-closed-link.usecase.spec.ts` en verde sin cambiar sus expectativas.
- [ ] 7.3 [backend] Stale: `ApplicationStaleClaims` con `ClaimLease`; `MongoApplicationStaleClaims` delega toma,
  `release` y `confirm` en `MongoLeaseClaims` (`mode: 'durable'`) y conserva `listEligible` de `worker-data-hygiene`;
  `DetectStaleApplications` y dobles ajustados. Verificar: `detect-stale-applications.usecase.spec.ts` y los tests de
  `listEligible` de `mongo-notify.adapters.spec.ts` («includes a newly stale application when more than a batch of
  notified ones remain open», «picks the oldest unnotified applications first») en verde sin cambiar sus expectativas
  (R4).

## 8. Concurrencia de extremo a extremo (dos réplicas)

- [ ] 8.1 [backend] `worker-claims.concurrency.spec.ts`, toma directa: por cada colección, 50 rondas de
  `Promise.all([replicaA.take(k), replicaB.take(k)])` sobre claves nuevas y sobre claves vencidas. Verificar: «exactly
  one replica takes each new key» y «exactly one replica takes each expired key», con un documento por clave al final
  (escenarios «Dos réplicas toman la misma clave a la vez» y «Marca vencida tomada por una sola réplica»).
- [ ] 8.2 [backend] Dos `DetectStaleApplications`, cada uno con su conexión, y una cola grabadora compartida **sin**
  deduplicar por `jobId`, sobre 30 postulaciones estancadas. Verificar: «two stale detectors enqueue each application
  once», con una marca confirmada por clave (escenario «Dos réplicas corren el detector de stale a la vez»).
- [ ] 8.3 [backend] Dos `DetectLinkFreshness` sobre 20 links elegibles con la misma cola grabadora. Verificar: «two
  freshness detectors process each link once in the same tick» (escenario «Dos réplicas corren el detector de frescura
  a la vez»).
- [ ] 8.4 [backend] Dos `ExpireApplicationsForClosedLinkUseCase` sobre un link cerrado con 10 postulaciones de grupo.
  Verificar: «two expire cascades enqueue each group notification once», con una marca confirmada de ASN por clave
  (escenario «Dos réplicas expiran las postulaciones de un mismo link cerrado»).
- [ ] 8.5 [backend] Falsación determinista de 1.1 y 8.1 (H8): en una copia local del test, `dropIndex('uniq_claim_key')`
  y tomas **secuenciales** (A toma, B toma la misma clave; A toma una clave vencida, B toma la misma). Ver caer «reports
  an occupied claim as not taken» (B obtiene un testigo: el `upsert` inserta un segundo documento) y «exactly one
  replica takes each expired key». Descartar la copia. Verificar: las dos caídas anotadas en el PR.
- [ ] 8.6 [backend] Versiones mezcladas (R6): una réplica con el adaptador de hoy (copiado al test como
  `LegacyReadThenUpsertClaims`) y otra con el nuevo, con los índices ya creados. Verificar: «a legacy writer does not
  create duplicates once the unique index exists», «a new replica takes a key last written by a legacy writer after its
  lease» y «a legacy confirm over a new take leaves a confirmed claim outside the lease ttl» (la confirmación heredada
  deja `leaseUntil`; con el servidor TTL de 5.1, el documento sigue tras desaparecer un centinela).

## 9. Inventario de crons (Q2 = (a); design D8)

- [ ] 9.1 [backend] `apps/worker/src/app/worker-crons.inventory.spec.ts`: recorre los `.ts` no `spec` de
  `apps/worker/src`, busca `@Cron(` y `addCronJob(` y compara el conjunto de ficheros con la tabla del test (los cuatro
  de design D8, cada uno con su mecanismo). Verificar: «every worker cron declares its multi-replica guard» en verde.
  Falsación: añadir en local un fichero `apps/worker/src/modules/notifications/infrastructure/queue/tmp-cron.ts` con un
  `@Cron(CronExpression.EVERY_MINUTE)` y ver caer el test nombrando ese fichero (escenario «Cron nuevo sin
  inventariar»); borrarlo.
- [ ] 9.2 [backend] Digest con dos réplicas: dos `ProcessGroupWeeklyDigest`, cada uno con su conexión y el ledger Mongo
  real, sobre un grupo con tres miembros que aceptan el digest y la misma `weekKey`, a la vez (`Promise.all`), con un
  mailer doble compartido. Verificar: «two digest runs for the same week send one email per member» (tres envíos en
  total, uno por miembro, con cualquier intercalado; escenario «Dos réplicas disparan el digest semanal»).

## 10. Documentación

- [ ] 10.1 [infra] RUNBOOK, sección «Higiene de datos del worker» (la de `worker-data-hygiene`): `getIndexes()` de las
  tres colecciones de marcas (`uniq_claim_key`, `ttl_lease` con su filtro parcial), el `warn` de compuerta cerrada (qué
  significa, qué consulta mirar y que el worker reintenta en cada tick) y el paso «antes de escalar `worker`» de design
  D9 y Migration Plan §3-§4. Verificar: `grep -c "uniq_claim_key\|ttl_lease" docs/RUNBOOK.md` devuelve al menos `2` y
  `grep -c "antes de escalar" docs/RUNBOOK.md` al menos `1`.
- [ ] 10.2 [infra] `infra/README.md`, bajo «Escalar worker»: la línea «No escalar `worker` hasta archivar
  `worker-claims-multi-replica`; ADR-061 §6» pasa a la condición de design D9. Verificar:
  `grep -c "No escalar .worker. hasta archivar" infra/README.md` devuelve `0` y
  `grep -c "imagen que incluya .worker-claims-multi-replica." infra/README.md` devuelve `1`.
- [ ] 10.3 [infra] (Q4 = (a)) Comentario del servicio `worker` en `docker-compose.prod.yml`, sobre el texto que dejó
  35c: la misma condición de D9, sin cambiar ninguna clave del servicio. Verificar:
  `git diff -U0 -- docker-compose.prod.yml | grep "^[+-][^+-]" | grep -vc "^[+-][[:space:]]*#"` devuelve `0` (solo
  cambian comentarios).

## 11. Cierre

- [ ] 11.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salida anotada en el PR.
- [ ] 11.2 [infra] `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en
  verde. Verificar: salida anotada en el PR.
- [ ] 11.3 [infra] Smoke local con `pnpm infra:up` y **dos** procesos del worker (el segundo con otro
  `WORKER_HEALTH_PORT`), con marcas heredadas duplicadas sembradas a mano en el Mongo local: los dos sirven
  `/health/live` enseguida, los dos registran la migración de las tres colecciones y `getIndexes()` muestra
  `uniq_claim_key` y `ttl_lease` en cada una. Comprobar antes que los puertos están libres y, al terminar, matar solo el
  árbol de procesos propio. Verificar: líneas de log y salidas anotadas en el PR.
- [ ] 11.4 [infra] Semillas de `infra/staging/` sin cambios. Verificar: `git diff --stat main -- infra/staging` vacío y
  `grep -c "_claims" infra/staging/seed-volume.mongosh.js` igual a `0`.
- [ ] 11.5 [infra] Fusión en la fila que fije Q1, en una ventana autorizada por el owner. Verificar: número de PR y
  commit en la descripción del PR de archivo.
- [ ] 11.6 [infra] Tras el despliegue a staging (un worker): `getIndexes()` de las tres colecciones de marcas y ningún
  `warn` de compuerta en `docker compose logs worker` después del primer tick de stale y de frescura, con
  `measure.mongosh.js` dando los mismos valores antes y después. Verificar: salidas anotadas en el PR de archivo.
- [ ] 11.7 [infra] Al archivar: en ADR-061, §2, §3 y §4 cambian «sigue Propuesto» por «Aceptado el AAAA-MM-DD (PR #NN)»;
  las dos Consecuencias «(al aplicarse `worker-claims-multi-replica`)» pierden el paréntesis; en §6 «Para 35c», una
  línea «Cerrada el AAAA-MM-DD por `worker-claims-multi-replica`: ver `infra/README.md`». Fila del manifiesto y de
  `docs/design-v0.2.md` §6 (si Q1 le dio una) con el estado archivado. Verificar:
  `grep -c "sigue Propuesto" docs/adr/ADR-061.md` devuelve `0` y
  `grep -c "(al aplicarse .worker-claims-multi-replica.)" docs/adr/ADR-061.md` devuelve `0`.
