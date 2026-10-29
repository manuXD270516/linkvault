## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos uno. La falsación de un guardia se hace, se ve caer el test nombrado
y se restaura en la misma tarea. Los tests de integración usan el `MongoMemoryReplSet` del preset de
`@linkvault/testing` (`getMongoTestUri()`), con una base por fichero; las «dos réplicas» son **dos conexiones de
Mongoose distintas** (`mongoose.createConnection` dos veces sobre la misma URI y la misma base), cada una con su
instancia del adaptador o del caso de uso. Solo los tests del monitor TTL arrancan su propio `MongoMemoryServer` (ver
1.3), para no acelerar el monitor del servidor compartido.

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada en ADR-061 (línea que empieza por «Respuesta del owner (Q1),
  AAAA-MM-DD:»). Con Q1 = (a), la fila asignada en `docs/design-v0.2.md` §6 y el `scope` de `openspec-changes.yaml`
  actualizado; el change no pasa de aquí hasta archivar 35c. Con Q1 = (b), se reescriben 8.2-8.3 con las tres clases de
  fusión de ADR-056 §1 antes de aplicar. Verificar: `grep -c "Respuesta del owner (Q1), 20" docs/adr/ADR-061.md`
  devuelve `1` (hoy `0`).
- [ ] 0.2 [infra] Q2, Q3 y Q4 respondidas (o anotado que se aplican las recomendaciones) en `design.md`, con fecha.
  Verificar: cada Q del design tiene una línea «Respuesta del owner (Qn), AAAA-MM-DD:».
- [ ] 0.3 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada en
  `design.md` con su fecha. Verificar: la sección del debate de la última iteración dice «Convergencia: SI».

## 1. Retención del outbox (`apps/api`, design D1)

- [ ] 1.1 [backend] `OUTBOX_PUBLISHED_RETENTION_S = 604_800` exportada desde `outbox-event.schemas.ts` y el índice
  `ttl_published` (`{ publishedAt: 1 }`, `expireAfterSeconds`, `partialFilterExpression: { publishedAt: { $type: 'date'
  } }`); actualizar el comentario «Único índice de la colección». Verificar en `mongo-outbox.spec.ts`, tras
  `model.init()`, con `listIndexes`: «declares a ttl index on publishedAt limited to dated documents» (nombre, clave,
  `expireAfterSeconds` y filtro parcial exactos) y que el índice parcial de pendientes sigue igual («keeps the pending
  partial index unchanged»).
- [ ] 1.2 [backend] Coherencia de retenciones en `outbox-queues.spec.ts`: «keeps published events at least as long as
  any outbox queue keeps failed jobs», que recorre `OUTBOX_QUEUES` con `outboxJobOptionsFor` y compara con
  `removeOnFail.age`. Falsación: poner `OUTBOX_PUBLISHED_RETENTION_S = 86_400` y verlo caer; restaurar.
- [ ] 1.3 [backend] `outbox-ttl.spec.ts` con un `MongoMemoryServer` propio (`binary.version: MONGOMS_VERSION`,
  `instance.args: ['--setParameter', 'ttlMonitorSleepSecs=1']`) y el modelo del outbox con su índice. Inserta un
  publicado de hace 8 días, uno de hace 6, un pendiente de hace 10 y un agotado de hace 30, y espera (sondeo cada
  250 ms, tope 10 s) a que el primero desaparezca. Verificar: «expires a published event older than seven days», «keeps
  a published event younger than seven days», «never expires a pending event» y «never expires an exhausted event»
  (estos tres comprueban tras la desaparición del primero, que prueba que el monitor pasó). Falsación: quitar el
  `partialFilterExpression` **y** escribir el pendiente con `publishedAt: new Date(0)` en una copia local del test para
  ver que el monitor sí borra lo que tiene fecha; descartar la copia. Además, «publishes a pending event that survived
  ten days once the relay runs» con el relay del spec existente sobre ese pendiente.

## 2. Toma atómica genérica (`apps/worker/src/infrastructure/claims/`, design D2, D3, D4, D5)

- [ ] 2.1 [backend] `MongoLeaseClaims` con la clave como parámetro (`['linkId']` o `['applicationId',
  'statusChangedAt']`) y `mode: 'lease' | 'durable'`: `take(key, now, leaseMs)` con `findOneAndUpdate` + `upsert` y el
  filtro de D2 (incluida la rama heredada), que devuelve `{ token }` o `null`; `E11000` con `keyPattern` igual a la
  clave → `null`; cualquier otro error se relanza (R1). Verificar en `mongo-lease-claims.spec.ts`: «takes a missing
  claim», «reports an occupied claim as not taken, not as an error», «takes an expired unconfirmed claim», «reports a
  confirmed durable claim as not taken» y «rethrows a duplicate key error from another unique index» (índice único
  extra creado solo en ese test).
- [ ] 2.2 [backend] `release(key, token)` y `confirm(key, token, now)` según D3 (durable: confirma por clave, quita
  `leaseUntil` y `token`; lease: extiende `leaseUntil` a `now + holdMs` solo con su testigo). Verificar: «release does
  not delete a claim taken by another holder», «confirm after losing the lease keeps the claim confirmed» (A toma, vence,
  B toma, A confirma, B libera → confirmada) y «a confirmed durable claim carries no leaseUntil».
- [ ] 2.3 [backend] Retención de frescura (D4): `FRESHNESS_CONFIRMED_HOLD_MS = 30 * 60_000`. Verificar: «a confirmed
  freshness claim blocks another replica within the same tick» (reloj +2 min → `null`), «a confirmed freshness claim is
  takeable on the next hourly tick» (+60 min → toma) y «a released freshness claim is takeable at once».
- [ ] 2.4 [backend] Marca heredada (D5, R6): «takes a legacy claim without leaseUntil once its lease counted from
  claimedAt expired» y «does not take a legacy claim whose lease is still running», con documentos escritos a mano con
  la forma de hoy (`claimedAt`, `confirmed: false`, sin `leaseUntil` ni `token`).

## 3. Arranque de índices con migración (design D7)

- [ ] 3.1 [backend] `ClaimIndexesBootstrap.migrate(collection)`, paso 1: completar `leaseUntil` de los sin confirmar
  que no lo tienen (`$ifNull` sobre `claimedAt`). Verificar: «backfills leaseUntil on legacy unconfirmed claims» y
  «leaves confirmed durable claims without leaseUntil».
- [ ] 3.2 [backend] Paso 2: duplicados por clave, superviviente determinista (confirmado > `claimedAt` más reciente >
  `_id` menor). Verificar: «keeps the confirmed claim among duplicates», «keeps the most recent claim when none is
  confirmed» y «computes the same survivor regardless of insertion order» (mismos documentos insertados en dos órdenes).
  Falsación: invertir la prioridad de `confirmed` y ver caer el primero; restaurar.
- [ ] 3.3 [backend] Pasos 3-4 con reintento: `createIndexes` de `uniq_claim_key` y `ttl_lease` (`expireAfterSeconds:
  86_400`), comprobación con `listIndexes`, hasta tres vueltas si `E11000`. Verificar: «creates the unique key and the
  lease ttl index», «is idempotent when the indexes already exist» y «retries after a duplicate inserted between dedupe
  and index creation» (un doble que inserta un duplicado la primera vez que se llama a `createIndexes`).
- [ ] 3.4 [backend] Dos réplicas arrancando: dos conexiones ejecutan `migrate` de las tres colecciones con
  `Promise.all` sobre los mismos duplicados. Verificar: «two replicas migrating at once end with the indexes and the same
  survivors as one».
- [ ] 3.5 [backend] Compuerta (`ClaimIndexesGate`, una por colección) registrada en `onModuleInit` y consultada por
  `LinkFreshnessScheduler` y `StaleApplicationsScheduler`; cerrada → `warn` con el nombre de la colección, reintento de
  `migrate` y salto del tick. Verificar en los specs de los schedulers: «skips the stale tick and warns naming the
  collection when the unique index is missing» y «runs the tick once the gate opens on retry». Y en
  `worker.module` (spec de arranque existente o nuevo): «keeps enrichment consumers running when a claims gate is closed».
  Falsación: hacer que el scheduler de stale ignore la compuerta y ver caer el primero; restaurar.
- [ ] 3.6 [backend] Orden de arranque: «finishes the claims migration before the first cron tick», que monta el módulo
  de testing con `ScheduleModule` y comprueba que `migrate` terminó antes de que `SchedulerRegistry` tenga los crons
  arrancados (`onApplicationBootstrap`).

## 4. Puertos, adaptadores y casos de uso (design D3, D9)

- [ ] 4.1 [backend] Frescura: `FreshnessLinkClaims` devuelve `ClaimLease | null`; `release`/`confirm` reciben la toma;
  `MongoFreshnessLinkClaims` delega en `MongoLeaseClaims` (`mode: 'lease'`) y desaparece el comentario de `:210-220`;
  `DetectLinkFreshness` y sus dobles en memoria ajustados. Verificar: `detect-link-freshness.usecase.spec.ts` en verde
  sin cambiar sus expectativas y «releases with its own lease when the effect fails».
- [ ] 4.2 [backend] ASN: `StatusGroupNotifyClaims` con `ClaimLease`; `MongoStatusGroupNotifyClaims` sobre
  `MongoLeaseClaims` (`mode: 'durable'`); `isConfirmed` igual; `ExpireApplicationsForClosedLinkUseCase` y dobles
  ajustados. Verificar: `expire-applications-for-closed-link.usecase.spec.ts` en verde sin cambiar sus expectativas.
- [ ] 4.3 [backend] Stale: `ApplicationStaleClaims` con `ClaimLease`; `MongoApplicationStaleClaims` sobre
  `MongoLeaseClaims` (`mode: 'durable'`); `DetectStaleApplications` y dobles ajustados. Verificar:
  `detect-stale-applications.usecase.spec.ts` en verde sin cambiar sus expectativas.
- [ ] 4.4 [backend] `listEligible` como agregación (D9). Verificar en `mongo-notify.adapters.spec.ts`: «includes a
  newly stale application when more than a batch of notified ones remain open» (60 avisadas + P, lote 50) y «picks the
  oldest unnotified applications first». Falsación: volver a `find().limit()` + filtro en memoria y ver caer el primero;
  restaurar.
- [ ] 4.5 [backend] Ledger (D9): toma vencida condicionada. Verificar en `mongo-notify.adapters.spec.ts`: «only one of
  two concurrent workers retakes an expired delivery» (dos conexiones, `Promise.all`, 50 rondas: exactamente un
  `claimed` por ronda) y «retakes an expired delivery without contention». Falsación: quitar la condición de
  `claimedAt` y ver caer el primero (si no cae en tres corridas, ver R7 y 6.3); restaurar.

## 5. Barrido de marcas duraderas (design D6)

- [ ] 5.1 [backend] `SweepDeadDurableClaims` (plataforma del worker) con `$lookup` a `applications`, tandas de 500 y
  tope de 10 por pasada y colección. Verificar en su spec: «deletes a stale claim whose application changed status»,
  «deletes an asn claim whose application no longer exists», «keeps a claim that matches the current statusChangedAt»,
  «never deletes an unconfirmed claim» y «stops after the per-run batch cap» (5 001 muertas → 5 000 borradas).
  Falsación: comparar solo `applicationId` (sin `statusChangedAt`) y ver caer el primero; restaurar.
- [ ] 5.2 [backend] `ClaimsSweepScheduler` con `@Cron('30 3 * * *', { timeZone: 'UTC' })` y una línea de log con los
  totales, sin identificadores. Verificar: «two replicas sweeping at once delete each dead claim once and no live one»
  (dos conexiones, `Promise.all`) y «logs only counts» (el texto registrado no contiene ningún `applicationId`).
- [ ] 5.3 [backend] Caducidad (D5) con el `MongoMemoryServer` de 1.3 o uno igual en el worker: «expires an abandoned
  claim a day after its lease», «expires a confirmed freshness claim a day after its hold» y «never expires a confirmed
  durable claim» (confirmada con `confirmedAt` de hace 400 días).

## 6. Concurrencia de extremo a extremo (dos réplicas)

- [ ] 6.1 [backend] `worker-claims.concurrency.spec.ts`, toma directa: por cada colección, 50 rondas de
  `Promise.all([replicaA.take(k), replicaB.take(k)])` sobre claves nuevas. Verificar: «exactly one replica takes each
  new key» y «exactly one replica takes each expired key», con un documento por clave al final.
- [ ] 6.2 [backend] Detectores completos: dos `DetectStaleApplications` con su conexión y una cola grabadora compartida
  **sin** deduplicar por `jobId`, sobre 30 postulaciones estancadas; ídem dos `DetectLinkFreshness` sobre 20 links
  elegibles y dos `ExpireApplicationsForClosedLinkUseCase` sobre un link cerrado con 10 postulaciones de grupo.
  Verificar: «two stale detectors enqueue each application once», «two freshness detectors process each link once in
  the same tick» y «two expire cascades enqueue each group notification once», con una marca confirmada por clave en
  stale y ASN.
- [ ] 6.3 [backend] Falsación de 6.1-6.2: con el índice único eliminado (`dropIndex('uniq_claim_key')` en una copia
  local del test), al menos una ronda de 6.1 obtiene dos tomas o dos documentos. Anotar en el PR cuántas rondas cayeron
  en tres corridas. Si ninguna cae (R7), sustituir el `Promise.all` por una barrera: un adaptador de test que espera a
  que las dos réplicas hayan enviado su `findOneAndUpdate` (contador compartido y `Promise` resuelta al llegar a dos)
  antes de dejarlas continuar. Descartar la copia.
- [ ] 6.4 [backend] Versiones mezcladas (R6): una réplica con el adaptador de hoy (copiado al test como
  `LegacyReadThenUpsertClaims`) y otra con el nuevo, con los índices ya creados. Verificar: «a legacy writer does not
  create duplicates once the unique index exists» y «a new replica takes a key last written by a legacy writer after its
  lease».

## 7. Documentación y comprobaciones

- [ ] 7.1 [infra] RUNBOOK: sección «Higiene de datos del worker» con `getIndexes()` de las cuatro colecciones, la
  consulta de agotados del outbox (`{ failedAt: { $type: 'date' } }`, proyección sin payload), el aviso de compuerta
  cerrada y qué hacer, la hora del barrido y la nota de R5 junto a `seed-volume.sh`. Verificar: `grep -c
  "uniq_claim_key\|ttl_published\|ttl_lease" docs/RUNBOOK.md` devuelve al menos `3`.
- [ ] 7.2 [infra] Semillas de `infra/staging/` sin cambios y compatibles: en un Mongo local con la pila arrancada y el
  worker nuevo, `bash infra/staging/seed-volume.sh seed`, `expect`, `digest` (SHA-256 anotada), `clean` y otra vez
  `seed` + `digest`. Verificar: los dos `digest` coinciden, `seed` repetido informa 0/0/0 y `git diff --stat
  infra/staging` está vacío.
- [ ] 7.3 [backend] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salida anotada en el PR.
- [ ] 7.4 [infra] `pnpm exec openspec validate --all --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en
  verde. Verificar: salida anotada en el PR.
- [ ] 7.5 [infra] Al archivar: ADR-061 pasa a «Aceptado» con fecha y PR, y la línea de ADR-009 deja de decir
  «propuesta». Verificar: `grep -n "^\*\*Estado:\*\* Aceptado" docs/adr/ADR-061.md` devuelve una línea.

## 8. Despliegue

- [ ] 8.1 [infra] Smoke local con `pnpm infra:up` y `nx serve` de `api` y `worker`: el worker arranca, registra la
  migración de las tres colecciones y el primer tick de stale y frescura corre. Verificar: líneas de log anotadas y
  `getIndexes()` de las cuatro colecciones con los nombres de D1-D5.
- [ ] 8.2 [infra] Fusión en la ventana que fije Q1 (con Q1 = (a), después de archivar 35c y en una ventana autorizada
  por el owner). Verificar: número de PR y commit en la descripción del PR de archivo.
- [ ] 8.3 [infra] Tras el despliegue a staging: `getIndexes()` de las cuatro colecciones y
  `db.outbox_events.countDocuments({ publishedAt: { $lt: <ahora − 7 días> } })` = `0` antes de una hora, con
  `measure.mongosh.js` dando los mismos valores antes y después. Verificar: salidas anotadas en el PR de archivo.

## 9. Condicionales

- [ ] 9.1 [backend] **Solo si Q2 = (a).** `listCascadePending` filtra los links cerrados antes del `$limit`
  (`$lookup` a `job_links` con `closedAt`). Verificar: «finds a closed link with open applications behind more than four
  batches of open links» (201 links abiertos con postulaciones + 1 cerrado, límite 50). Falsación: devolver el
  `$limit` antes del `$lookup` y verlo caer; restaurar.
- [ ] 9.2 [backend] **Solo si Q2 = (a).** Mismo cambio en la consulta de ASN pendientes de `listCascadePending` con la
  marca confirmada por `$lookup` (usa `uniq_claim_key`). Verificar: `freshness-close.spec.ts` y
  `detect-link-freshness.usecase.spec.ts` en verde y «skips a closed link whose group notifications are all confirmed».
- [ ] 9.3 [backend] **Solo si Q3 = (a).** `on('failed')` en `notify-fanout` y `group-digest` con una línea `warn` (cola,
  `jobId`, nombre del error). Verificar: «logs an exhausted notify-fanout job without recipients» y su par de
  `group-digest`, comprobando que el texto no contiene ningún correo ni `userId` del job.
