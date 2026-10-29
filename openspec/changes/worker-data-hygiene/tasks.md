## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos uno. La falsación de un guardia se hace, se ve caer el test nombrado
y se restaura en la misma tarea. Los tests de integración usan el `MongoMemoryReplSet` del preset de
`@linkvault/testing` (`getMongoTestUri()`), con una base por fichero; las «dos réplicas» son **dos conexiones de
Mongoose distintas** (`mongoose.createConnection` dos veces sobre la misma URI y la misma base), cada una con su
instancia del adaptador o del caso de uso. Solo los tests del monitor TTL arrancan su propio `MongoMemoryServer` (ver
1.3 y 10.1), para no acelerar el monitor del servidor compartido.

**Orden y partición (design, «Partición (Q5)»).** Los grupos 1-6 son la **parte A** (lo que ve el usuario) y se aplican
siempre. Los grupos 7-11 son la **parte B** (marcas atómicas multi-réplica): **si Q5 = (a), salen de este change** y
pasan a `worker-claims-multi-replica`; si Q5 = (b), se aplican **antes** del grupo 6, que cierra el change.

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada en ADR-061 (línea que empieza por «Respuesta del owner (Q1),
  AAAA-MM-DD:»). Con Q1 = (a), la fila asignada en `docs/design-v0.2.md` §6 y el `scope` de `openspec-changes.yaml`
  actualizado; el change no pasa de aquí hasta archivar 35c. Con Q1 = (b), se reescriben 6.5-6.6 con las tres clases de
  fusión de ADR-056 §1 antes de aplicar. Verificar: `grep -c "Respuesta del owner (Q1), 20" docs/adr/ADR-061.md`
  devuelve `1` (hoy `0`).
- [ ] 0.2 [infra] Q5 respondida por el owner y anotada en `design.md` («Respuesta del owner (Q5), AAAA-MM-DD:»). Con
  Q5 = (a): borrar los grupos 7-11 de este fichero, sacar `specs/platform/worker-claims/` y el requirement «Toma única
  de una entrega vencida» de `specs/notifications/dispatch/spec.md` (se recrean en el change posterior cuando se cree),
  marcar D2-D5, D7 y la viñeta del ledger de D9 como «trasladadas» y anotar en ADR-061 §2-§4 que las aplica
  `worker-claims-multi-replica`. Además (F7): quitar de `proposal.md` la capacidad `platform/worker-claims` y todo lo
  de la parte B (viñetas, `Impact` y el requirement «Toma única…» de `Modified Capabilities`), y marcar en ADR-061
  §Consecuencias las dos de la parte B («Escalar el worker deja de ser un riesgo…» y «Los puertos de las marcas
  devuelven una toma con testigo…») con «(al aplicarse `worker-claims-multi-replica`)». Y (B8): anotar el commit
  fuente del diseño debatido, `<commit de cierre del debate>` (lo completa la sesión principal con el commit que cierre
  el debate), en ADR-061 §6 y en una fila propia `worker-claims-multi-replica` de `openspec-changes.yaml` que solo
  lleva el disparador «antes del primer `--scale worker=2`» y ese commit, sin `scope` completo. Verificar:
  `grep -c "Respuesta del owner (Q5), 20" openspec/changes/worker-data-hygiene/design.md` devuelve `1`; con (a),
  además, `grep -c "^## 7\." openspec/changes/worker-data-hygiene/tasks.md` devuelve `0`,
  `grep -c "worker-claims" openspec/changes/worker-data-hygiene/proposal.md` devuelve `0`,
  `grep -c "name: worker-claims-multi-replica" openspec-changes.yaml` devuelve `1`,
  `grep -c "<commit de cierre del debate>" docs/adr/ADR-061.md openspec-changes.yaml` devuelve `0` en los dos (el
  marcador se sustituyó) y `openspec validate worker-data-hygiene --strict` sigue en verde.
- [ ] 0.3 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada en
  `design.md` con su fecha. Verificar: la sección del debate de la última iteración dice «Convergencia: SI».

# Parte A — lo que ve el usuario

## 1. Retención del outbox (`apps/api`, design D1)

- [ ] 1.1 [backend] `OUTBOX_PUBLISHED_RETENTION_S = 691_200` exportada desde `outbox-event.schemas.ts` y el índice
  `ttl_published` (`{ publishedAt: 1 }`, `expireAfterSeconds`, `partialFilterExpression: { publishedAt: { $type: 'date'
  } }`); actualizar el comentario «Único índice de la colección». Verificar en `mongo-outbox.spec.ts`, tras
  `model.init()`, con `listIndexes`: «declares a ttl index on publishedAt limited to dated documents» (nombre, clave,
  `expireAfterSeconds` y filtro parcial exactos) y que el índice parcial de pendientes sigue igual («keeps the pending
  partial index unchanged»).
- [ ] 1.2 [backend] Coherencia de retenciones en `outbox-queues.spec.ts`: «keeps published events at least a day longer
  than any outbox queue keeps failed jobs», que recorre `OUTBOX_QUEUES` con `outboxJobOptionsFor` y comprueba
  `OUTBOX_PUBLISHED_RETENTION_S >= removeOnFail.age + 86_400`. Falsación: poner `OUTBOX_PUBLISHED_RETENTION_S = 604_800`
  (igual a `removeOnFail`) y verlo caer; restaurar.
- [ ] 1.3 [backend] `outbox-ttl.spec.ts` con un `MongoMemoryServer` propio (`binary.version: MONGOMS_VERSION`,
  `instance.args: ['--setParameter', 'ttlMonitorSleepSecs=1']`) y el modelo del outbox con su índice. Crea los eventos
  **por el código real** con relojes del pasado: un publicado de hace 9 días y uno de hace 7 (`markPublished` con `now`
  pasado), un pendiente de hace 10 (sin publicar) y un agotado de hace 30 (`markFailed(id, attempts, now)` con `now`
  pasado); espera (sondeo cada 250 ms, tope 10 s) a que el primero desaparezca. Verificar: «expires a published event
  older than eight days», «keeps a published event seven days old», «never expires a pending event» y «never expires an
  exhausted event» (estos tres comprueban tras la desaparición del primero, que prueba que el monitor pasó). Falsación
  (H2): hacer que `markFailed` escriba también `publishedAt: now` y ver caer «never expires an exhausted event»;
  restaurar. (Un `default: Date.now` en el esquema no sirve de falsación: `MongoOutbox` escribe `publishedAt: null`
  explícito.) Además, «publishes a pending event that survived ten days once the relay runs» con el relay del spec
  existente sobre ese pendiente.

## 2. Stale sin inanición (`apps/worker`, design D9)

- [ ] 2.1 [backend] `MongoApplicationStaleClaims.listEligible` como agregación (`$match`, `$sort { statusChangedAt: 1,
  _id: 1 }`, `$lookup` a `application_stale_claims`, `$match` sin marca, `$limit`, `maxTimeMS`). El `$lookup` es el de
  design D9 (F4): `let: { appId: { $toString: '$_id' }, sca: '$statusChangedAt' }` y `pipeline` con
  `$expr`/`$eq` sobre `applicationId` y `statusChangedAt` más `confirmed: true`; **no** `localField`/`foreignField`
  (`_id` es `ObjectId`, `applicationId` es `string`). Verificar en `mongo-notify.adapters.spec.ts`: «includes a newly stale application when more than a batch of notified
  ones remain open» (60 avisadas + P, lote 50) y «picks the oldest unnotified applications first». Falsación: volver a
  `find().limit()` + filtro en memoria y ver caer el primero; restaurar. Segunda falsación (F4): escribir el `$lookup`
  con `localField: '_id'`/`foreignField: 'applicationId'` y ver caer el primero (ninguna marca casa y las 60 avisadas
  vuelven a llenar el lote); restaurar.

## 3. Entrega en vuelo reintentada (`apps/worker`, design D11)

- [ ] 3.1 [backend] `NOTIFY_DELIVERY_LEASE_MS` exportada desde `mongo-notify.adapters.ts` (renombra `CLAIM_LEASE_MS`) y
  `ProcessNotifyFanOut.execute` devuelve `{ inFlight: number }`, contando las entregas `in_flight` sin dejar de procesar
  las demás. `deliverChannel` lee `this.clock.now()` justo antes de `ledger.claim` y deja de recibir `now` (F6).
  Verificar en `process-notify-fanout.usecase.spec.ts` (ledger en memoria): «reports an in-flight delivery
  instead of dropping it silently» (`inFlight: 1`, la otra entrega del mismo job se envía), «reports no in-flight
  deliveries when all were claimed or done» (`inFlight: 0`) y «claims each delivery with the clock at claim time»
  (reloj doble que avanza 1 min en cada envío; el ledger doble registra un `now` distinto y creciente en cada
  `claim`). Falsación: volver a pasar el `now` del principio del job y ver caer el tercero; restaurar.
- [ ] 3.2 [backend] Lo mismo en `ProcessGroupWeeklyDigest.execute`, que devuelve `{ groupsScanned, emailsSent,
  inFlight }` (F2). Verificar en
  `process-group-weekly-digest.usecase.spec.ts`: «reports in-flight digest deliveries and still sends the rest» y «does
  not resend a completed digest delivery on the deferred rerun» (segunda ejecución con las completadas en el ledger:
  0 envíos nuevos para ellas).
- [ ] 3.3 [backend] Helpers en `notifications/infrastructure/queue/defer-while-in-flight.ts`:
  `splitInFlightDeferrals(data)` hace `const { inFlightDeferrals, ...payload } = job.data`, valida el contador con
  `z.number().int().min(0).default(0)` y devuelve `{ inFlightDeferrals, payload }` (F1); `deferWhileInFlight(job,
  token, { inFlight, inFlightDeferrals, payload }, logger)`, con `inFlight > 0` y `inFlightDeferrals <
  NOTIFY_IN_FLIGHT_MAX_DEFERRALS` (3), hace `job.updateData({ ...payload, inFlightDeferrals: n + 1 })`,
  `job.moveToDelayed(Date.now() + NOTIFY_DELIVERY_LEASE_MS + 1_000, token)` y `throw new DelayedError()`. Verificar en
  `defer-while-in-flight.spec.ts` con un `Job` doble (espías de `updateData` y `moveToDelayed`): «delays the job past
  the delivery lease when a delivery is in flight» (instante de `moveToDelayed` ≥ ahora + lease y segundo argumento
  igual al `token` recibido), «completes the job when nothing is in flight» y «splits the deferral counter from the
  payload» (`payload` sin `inFlightDeferrals`; contador `0` si falta). Falsación: devolver sin aplazar cuando
  `inFlight > 0` y ver caer «delays the job…»; restaurar.
- [ ] 3.4 [backend] Tope: con `inFlightDeferrals = 3`, el helper registra un `warn` con cola, `jobId` y número de
  entregas en vuelo y termina sin aplazar. Verificar: «stops deferring after the maximum and warns without recipients»
  (el texto no contiene ningún correo ni `userId` del job) y, con el ledger Mongo real (`mongo-notify.adapters.spec.ts`),
  «a delivery left claimed by a dead worker is sent once its lease expires» (toma `claimed` sin completar, reloj + 6 min,
  la reejecución obtiene `claimed` y envía una vez).
- [ ] 3.5 [backend] Consumidores: `notify-fanout.consumer.ts` y `group-digest.consumer.ts` adoptan `WorkerHandle` y el
  procesador `(job, token?)` de `enrich-link.consumer.ts` (F2), separan el contador con `splitInFlightDeferrals`, pasan
  solo `payload` a `parseFanOutJob` / `groupDigestJobPayloadSchema.parse` y llaman a `deferWhileInFlight` con el
  resultado del caso de uso. Verificar en los specs de los dos consumidores, con el `WorkerFactory` doble que captura
  el procesador (`(job, token)`): «defers a notify-fanout job that found an in-flight delivery» y «defers a
  group-digest job that found an in-flight delivery» (los dos comprueban que `moveToDelayed` recibe el `token` pasado
  al procesador), y «reruns a deferred job whose data carries the deferral counter»: un `Job` doble cuyo `updateData`
  sustituye `job.data`; tras el `DelayedError`, el test vuelve a invocar el procesador capturado con ese mismo job y
  la segunda ejecución no lanza `ZodError` y llega al caso de uso. En fan-out cubre los tres tipos
  (`GroupLinkAdded`, `ApplicationStatusNotify`, `ApplicationStale`); en digest, `{ weekKey }`. Falsación (F1): validar
  `job.data` entero, sin separar el contador, y ver caer «reruns a deferred job…» en los dos consumidores; restaurar.

## 4. Cascada de frescura y rastro de avisos agotados (Q2 = (a), Q3 = (a))

- [ ] 4.1 [backend] `MongoFreshnessLinkStore.listCascadePending` (`mongo-freshness.adapters.ts`; `listForExpireCascade`
  no cambia) filtra los links cerrados antes del `$limit` (`$lookup` a `job_links` con `closedAt`, `maxTimeMS`).
  Verificar en `freshness-close.spec.ts` (escenario «Link cerrado detrás de más de cuatro lotes de links abiertos»):
  «finds a closed link with open applications behind more than four batches of open links» (201 links abiertos con
  postulaciones + 1 cerrado, límite 50). Falsación: devolver el `$limit` antes del `$lookup` y verlo caer; restaurar.
- [ ] 4.2 [backend] En la misma agregación, **antes** de `$group`/`$limit`, excluir las postulaciones `expired` de
  grupo con ASN confirmada con el `$lookup` de design D9 contra `application_status_group_notify_claims` (`let: {
  appId: { $toString: '$_id' }, sca: '$statusChangedAt' }`, `pipeline` con `$expr`/`$eq` y `confirmed: true`, F4/F5).
  Verificar: `freshness-close.spec.ts` y `detect-link-freshness.usecase.spec.ts` en verde, «skips a closed link whose
  group notifications are all confirmed» y (escenario «Link cerrado ya avisado no tapa a uno pendiente») «finds a
  closed link with open applications behind more than four batches of fully notified closed links» (201 links cerrados
  con todas sus postulaciones `expired` de grupo y sus ASN confirmadas + 1 cerrado con una postulación abierta, límite
  50). Falsación: mover el `$lookup` de ASN después del `$limit` y ver caer el segundo; restaurar.
- [ ] 4.3 [backend] `on('failed')` en `notify-fanout` y `group-digest` (sobre el `WorkerHandle` de 3.5) con una línea
  `warn` (cola, `jobId`, nombre del error). Verificar: «logs an exhausted notify-fanout job without recipients» y «logs an exhausted group-digest job
  without recipients», comprobando que el texto no contiene ningún correo ni `userId` del job.

## 5. Documentación de la parte A

- [ ] 5.1 [infra] RUNBOOK, sección «Higiene de datos del worker»: `db.outbox_events.getIndexes()` con `ttl_published`;
  la consulta de agotados del outbox (`{ failedAt: { $type: 'date' } }`, proyección sin payload); qué significa el
  `warn` de entregas en vuelo agotado (D11); y, junto a `seed-volume.sh`, el borrado de las marcas huérfanas
  **entre `clean` y el siguiente `seed`** (R5, sin barrido por B4; F8): en el Mongo local, `deleteMany` en `application_stale_claims` y
  `application_status_group_notify_claims` de los documentos cuyo `applicationId` no esté entre los `_id` de
  `applications` (agregación con `$convert` a `objectId` y `onError: null`, o lista de `_id` en `mongosh`), con la
  advertencia de que es solo para Mongo locales desechables. Verificar: `grep -c "ttl_published\|seed-volume.sh clean"
  docs/RUNBOOK.md` devuelve al menos `2` más que en `main` y `grep -c "entre .clean. y el siguiente .seed."
  docs/RUNBOOK.md` devuelve al menos `1`.
- [ ] 5.2 [infra] Regla de no escalar `worker` (B6, design D10), ya escrita en la iteración 2 del debate: una línea de
  advertencia bajo «Escalar worker» de `infra/README.md` y el `scope` de `verify-reusable-workflow` (35c) en
  `openspec-changes.yaml`, con `061` en sus `adrs`. Si 35b o 35c reescribieron esa sección del README, reponer la
  línea en un bloque mínimo. Verificar: `grep -c "No escalar .worker. hasta archivar" infra/README.md
  openspec-changes.yaml` devuelve al menos `1` en cada fichero.

## 6. Cierre (con Q5 = (b), después del grupo 11)

- [ ] 6.1 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salida anotada en el PR.
- [ ] 6.2 [infra] Semillas de `infra/staging/` sin cambios y compatibles, **con el worker parado** (si corre, frescura
  escribe en `job_links` y el `seed` repetido deja de dar 0): en un Mongo local con solo `mongo` arrancado,
  `bash infra/staging/seed-volume.sh seed`, `expect`, `digest` (SHA-256 anotada como D1), `clean`, `seed`, `digest`
  (D2) y un **tercer** `seed` con los mismos parámetros. Verificar: D1 = D2; el tercer `seed` imprime `"inserted":0`,
  `"modified":0` y `"removed":0`; `git diff --stat infra/staging` vacío. Si no hay Mongo local disponible, la
  verificación se reduce a `git diff --stat infra/staging` vacío y `grep -c "_claims" infra/staging/seed-volume.mongosh.js`
  igual a `0` (la semilla no nombra ninguna colección de marcas), anotado así en el PR.
- [ ] 6.3 [infra] `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en
  verde. Verificar: salida anotada en el PR.
- [ ] 6.4 [infra] Smoke local con `pnpm infra:up` y `nx serve` de `api` y `worker`: arrancan, el primer tick de stale y
  frescura corre, y `db.outbox_events.getIndexes()` muestra `ttl_published`. Con la parte B, además el log de la
  migración de las tres colecciones y `getIndexes()` de ellas con `uniq_claim_key` y `ttl_lease`. Verificar: líneas de
  log y salidas anotadas.
- [ ] 6.5 [infra] Fusión en la ventana que fije Q1 (con Q1 = (a), después de archivar 35c y en una ventana autorizada
  por el owner). Verificar: número de PR y commit en la descripción del PR de archivo.
- [ ] 6.6 [infra] Tras el despliegue a staging: `getIndexes()` de las colecciones tocadas y
  `db.outbox_events.countDocuments({ publishedAt: { $lt: <ahora − 8 días> } })` = `0` antes de una hora, con
  `measure.mongosh.js` dando los mismos valores antes y después. Verificar: salidas anotadas en el PR de archivo.
- [ ] 6.7 [infra] Al archivar: ADR-061 pasa a «Aceptado» con fecha y PR (con Q5 = (a), §2-§4 siguen «Propuestas» para
  el change posterior), y la línea de ADR-009 deja de decir «propuesta». Verificar: `grep -n "^\*\*Estado:\*\* Aceptado"
  docs/adr/ADR-061.md` devuelve una línea.

# Parte B — marcas atómicas multi-réplica (salen si Q5 = (a))

## 7. Toma atómica (`apps/worker/src/infrastructure/claims/`, design D2, D5)

- [ ] 7.1 [backend] `MongoLeaseClaims` con la clave como parámetro (`['linkId']` o `['applicationId',
  'statusChangedAt']`), `mode: 'lease' | 'durable'` y un `Clock` inyectado: `take(key, leaseMs)` lee `clock.now()` en el
  momento de tomar (H5), hace `findOneAndUpdate` + `upsert` con la rama `leaseUntil` del filtro de D2 y escribe
  `confirmed: false` explícito en los dos modos; devuelve `{ token }` o `null`; `E11000` con `keyPattern` igual a la
  clave → `null`; cualquier otro error se relanza (R1). Sin parámetro de sesión. Verificar en
  `mongo-lease-claims.spec.ts`: «takes a missing claim», «reports an occupied claim as not taken, not as an error»,
  «takes an expired unconfirmed claim», «reports a confirmed durable claim as not taken», «rethrows a duplicate key error
  from another unique index» (índice único extra creado solo en ese test), «writes confirmed false on a freshness take»
  y «a claim taken late in a slow pass still blocks another replica» (reloj que avanza 50 min entre dos `take` del mismo
  adaptador; la segunda clave queda con `leaseUntil` futuro y otra réplica recibe `null`).
- [ ] 7.2 [backend] Rama heredada del filtro (`leaseUntil` ausente, lease contado desde `claimedAt`; D5, R6), con
  documentos escritos a mano con la forma de hoy (`claimedAt`, `confirmed: false`, sin `leaseUntil` ni `token`).
  Verificar: «takes a legacy claim without leaseUntil once its lease counted from claimedAt expired» y «does not take a
  legacy claim whose lease is still running». Falsación: quitar la rama `$exists: false` y ver caer el primero;
  restaurar.

## 8. Liberar y confirmar (design D3, D4)

- [ ] 8.1 [backend] `release(key, token)` = `deleteOne({ ...key, token, confirmed: false })`. Verificar: «release does
  not delete a claim taken by another holder» y «release frees its own claim».
- [ ] 8.2 [backend] `confirm(key, token)` durable: `updateOne` por igualdad de clave con `$set { confirmed: true,
  confirmedAt }`, `$unset { leaseUntil, token }` y `upsert: true` (H3). Verificar: «confirm after losing the lease keeps
  the claim confirmed» (A toma, vence, B toma, A confirma, B libera → confirmada), «confirm after the other holder
  released keeps the claim confirmed» (A toma, vence, B toma, B libera, A confirma → existe y está confirmada) y «a
  confirmed durable claim carries no leaseUntil». Falsación: quitar `upsert: true` y ver caer el segundo; restaurar.
- [ ] 8.3 [backend] Frescura (D4): `confirm` extiende `leaseUntil` a `now + FRESHNESS_CONFIRMED_HOLD_MS` (`30 *
  60_000`) solo con su testigo y sin `upsert`. Verificar: «a confirmed freshness claim blocks another replica within the
  same tick» (reloj +2 min → `null`), «a confirmed freshness claim is takeable on the next hourly tick» (+60 min → toma)
  y «a released freshness claim is takeable at once».

## 9. Arranque de índices con migración (design D7)

- [ ] 9.1 [backend] `ClaimIndexesBootstrap.migrate(collection)`, paso 1: completar `leaseUntil` (y `confirmed: false`
  si falta) de los sin confirmar que no lo tienen (`$ifNull` sobre `claimedAt`). Verificar: «backfills leaseUntil on
  legacy unconfirmed claims» y «leaves confirmed durable claims without leaseUntil».
- [ ] 9.2 [backend] Paso 2: duplicados por clave con agregación con `maxTimeMS`, superviviente determinista (confirmado
  > `claimedAt` más reciente > `_id` menor). Verificar: «keeps the confirmed claim among duplicates», «keeps the most
  recent claim when none is confirmed» y «computes the same survivor regardless of insertion order» (mismos documentos
  insertados en dos órdenes). Falsación: invertir la prioridad de `confirmed` y ver caer el primero; restaurar.
- [ ] 9.3 [backend] Pasos 3-4: `createIndex` de `ttl_lease` (`expireAfterSeconds: 86_400`, `partialFilterExpression:
  { confirmed: false }`) y después de `uniq_claim_key`, comprobación con `listIndexes`, hasta tres vueltas si `E11000`;
  cualquier otro error cierra la compuerta con un `warn` que lleva colección y `code`/`codeName`, sin datos, y `migrate`
  no lanza (H7). Verificar: «creates the lease ttl index before the unique key» (orden de llamadas en un doble),
  «declares the lease ttl index only over unconfirmed claims» (filtro parcial exacto en `listIndexes`), «is idempotent
  when the indexes already exist», «retries after a duplicate inserted between dedupe and index creation» (un doble que
  inserta un duplicado la primera vez que se crea el único) y «closes the gate instead of failing bootstrap on a
  non-duplicate index error» (un doble de `createIndex` que lanza un error con `code` 85; `migrate` resuelve, la
  compuerta queda cerrada y el `warn` contiene `85` y no contiene ninguna clave).
- [ ] 9.4 [backend] Dos réplicas arrancando: dos conexiones ejecutan `migrate` de las tres colecciones con
  `Promise.all` sobre los mismos duplicados. Verificar: «two replicas migrating at once end with the indexes and the same
  survivors as one».
- [ ] 9.5 [backend] Compuerta (`ClaimIndexesGate`, una por colección) consultada por los schedulers:
  `StaleApplicationsScheduler` la de `application_stale_claims`; `LinkFreshnessScheduler` la de `link_freshness_claims`
  **y** la de `application_status_group_notify_claims` (H6). Cerrada → `warn` con el nombre de la colección,
  reintento de `migrate` y salto del tick. Verificar en los specs de los schedulers: «skips the stale tick and warns
  naming the collection when the unique index is missing», «skips the freshness tick and warns naming the asn collection
  when its unique index is missing» y «runs the tick once the gate opens on retry». Falsación: hacer que el scheduler de
  frescura consulte solo su compuerta y ver caer el segundo; restaurar.
- [ ] 9.6 [backend] Arranque del módulo con una compuerta cerrada, en `apps/worker/src/app/claims-gate-startup.spec.ts`
  (nuevo): módulo de testing con `ClaimIndexesBootstrap` cuyo `migrate` cierra la compuerta de stale, y
  `EnrichLinkConsumer` con un `WorkerFactory` doble que captura el procesador y le pasa un job. Verificar: «keeps
  enrichment consumers running when a claims gate is closed» (el `init` resuelve y el procesador capturado corre el
  job) y «boots the worker when migrate fails» (`migrate` con error interno; `init` resuelve).
- [ ] 9.7 [backend] Orden de arranque: «finishes the claims migration before the first cron tick», con un módulo de
  testing que importa `ScheduleModule.forRoot()` y un scheduler con `@Cron`. El registro del cron se fuerza con
  `await app.init()` (que corre `onModuleInit` y luego `onApplicationBootstrap`, donde `@nestjs/schedule` monta los
  crons) y se observa con un espía en `SchedulerRegistry.prototype.addCronJob`; `migrate` es un doble que resuelve tras
  un `setTimeout` y apunta `'migrate'` en un array compartido, y el espía apunta `'cron'`. Verificar: el array es
  `['migrate', 'cron']`. Falsación: mover la migración a `onApplicationBootstrap` sin `await` y ver el orden invertido;
  restaurar.

## 10. Caducidad, ledger y puertos (design D3, D5, D9)

- [ ] 10.1 [backend] Caducidad (D5) en `worker-claims-ttl.spec.ts` con un `MongoMemoryServer` propio igual al de 1.3 y
  los índices de 9.3. Inserta un **centinela**: una toma sin confirmar con `leaseUntil` de hace 2 días; espera a que
  desaparezca (sondeo 250 ms, tope 10 s) y solo entonces afirma (H9). Verificar: «expires an abandoned claim a day after
  its lease» (el centinela), «expires a confirmed freshness claim a day after its hold», «never expires a confirmed
  durable claim» (confirmada con `confirmedAt` de hace 400 días, sin `leaseUntil`) y «never expires a confirmed claim
  that still carries a past leaseUntil» (confirmada con `leaseUntil` de hace 2 días, H4). Falsación: crear `ttl_lease`
  sin `partialFilterExpression` y ver caer el último; restaurar.
- [ ] 10.2 [backend] Ledger (D9): toma vencida condicionada a `status: 'claimed'` y al `claimedAt` leído, `'claimed'`
  solo con `modifiedCount === 1` y relectura única si no; método `protected async beforeRetake(): Promise<void>` vacío
  entre la lectura y la retoma. Verificar en `mongo-notify.adapters.spec.ts`: «retakes an expired delivery without
  contention».
- [ ] 10.3 [backend] Concurrencia del ledger, determinista (H8): subclase de test de `MongoNotifyDeliveryLedger` cuyo
  `beforeRetake` de A espera a que B (otra conexión) complete su `claim` entero; luego A intenta. Verificar: «only one of
  two workers retakes an expired delivery» (B → `claimed`, A → `in_flight`). Falsación: quitar la condición de
  `claimedAt` y ver caer el test (A también obtiene `claimed`); restaurar.
- [ ] 10.4 [backend] Frescura: `FreshnessLinkClaims` devuelve `ClaimLease | null`; `release`/`confirm` reciben la toma y
  no reciben `now`; `MongoFreshnessLinkClaims` delega en `MongoLeaseClaims` (`mode: 'lease'`) y desaparece el
  comentario de `:210-220`; `DetectLinkFreshness` y sus dobles en memoria ajustados. Verificar:
  `detect-link-freshness.usecase.spec.ts` en verde sin cambiar sus expectativas y «releases with its own lease when the
  effect fails».
- [ ] 10.5 [backend] ASN: `StatusGroupNotifyClaims` con `ClaimLease`; `MongoStatusGroupNotifyClaims` sobre
  `MongoLeaseClaims` (`mode: 'durable'`); `isConfirmed` igual; `ExpireApplicationsForClosedLinkUseCase` y dobles
  ajustados. Verificar: `expire-applications-for-closed-link.usecase.spec.ts` en verde sin cambiar sus expectativas.
- [ ] 10.6 [backend] Stale: `ApplicationStaleClaims` con `ClaimLease`; `MongoApplicationStaleClaims` sobre
  `MongoLeaseClaims` (`mode: 'durable'`); `DetectStaleApplications` y dobles ajustados. Verificar:
  `detect-stale-applications.usecase.spec.ts` en verde sin cambiar sus expectativas.

## 11. Concurrencia de extremo a extremo (dos réplicas)

- [ ] 11.1 [backend] `worker-claims.concurrency.spec.ts`, toma directa: por cada colección, 50 rondas de
  `Promise.all([replicaA.take(k), replicaB.take(k)])` sobre claves nuevas y sobre claves vencidas. Verificar: «exactly
  one replica takes each new key» y «exactly one replica takes each expired key», con un documento por clave al final.
- [ ] 11.2 [backend] Dos `DetectStaleApplications`, cada uno con su conexión, y una cola grabadora compartida **sin**
  deduplicar por `jobId`, sobre 30 postulaciones estancadas. Verificar: «two stale detectors enqueue each application
  once», con una marca confirmada por clave.
- [ ] 11.3 [backend] Dos `DetectLinkFreshness` sobre 20 links elegibles con la misma cola grabadora. Verificar: «two
  freshness detectors process each link once in the same tick».
- [ ] 11.4 [backend] Dos `ExpireApplicationsForClosedLinkUseCase` sobre un link cerrado con 10 postulaciones de grupo.
  Verificar: «two expire cascades enqueue each group notification once», con una marca confirmada de ASN por clave.
- [ ] 11.5 [backend] Falsación determinista de 7.1 y 11.1 (H8): en una copia local del test, `dropIndex('uniq_claim_key')`
  y tomas **secuenciales** (A toma, B toma la misma clave; A toma una clave vencida, B toma la misma). Ver caer
  «reports an occupied claim as not taken» (B obtiene un testigo: el `upsert` inserta un segundo documento) y «exactly
  one replica takes each expired key». Descartar la copia.
- [ ] 11.6 [backend] Versiones mezcladas (R6): una réplica con el adaptador de hoy (copiado al test como
  `LegacyReadThenUpsertClaims`) y otra con el nuevo, con los índices ya creados. Verificar: «a legacy writer does not
  create duplicates once the unique index exists», «a new replica takes a key last written by a legacy writer after its
  lease» y «a legacy confirm over a new take leaves a confirmed claim outside the lease ttl» (la confirmación heredada
  deja `leaseUntil`; con el servidor TTL de 10.1, el documento sigue tras desaparecer un centinela).
- [ ] 11.7 [infra] RUNBOOK, misma sección: `getIndexes()` de las tres colecciones de marcas (`uniq_claim_key`,
  `ttl_lease` con su filtro parcial) y el `warn` de compuerta cerrada y qué hacer. Con esta parte archivada, la
  advertencia de no escalar `worker` de `infra/README.md` (5.2, B6) se reduce a «escalar solo con la parte B
  desplegada». Verificar: `grep -c "uniq_claim_key\|ttl_lease" docs/RUNBOOK.md` devuelve al menos `2`.
