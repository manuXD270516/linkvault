## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los nombres entre comillas son los títulos exactos de los tests (`it(...)`), en
inglés; cada escenario de los deltas tiene al menos uno. La falsación de un guardia se hace, se ve caer el test nombrado
y se restaura en la misma tarea. Los tests de integración usan el `MongoMemoryReplSet` del preset de
`@linkvault/testing` (`getMongoTestUri()`), con una base por fichero. Solo el test del monitor TTL arranca su propio
`MongoMemoryServer` (ver 1.3), para no acelerar el monitor del servidor compartido.

**Partición (design, «Partición (Q5)»).** Q5 = (a), respuesta del owner del 2026-10-29: este change es solo la
**parte A** (lo que ve el usuario, grupos 1-6). La **parte B** (marcas atómicas multi-réplica, antiguos grupos 7-11)
salió a `worker-claims-multi-replica`; su texto debatido está en el commit `776e12a` de la rama
`spec/worker-data-hygiene`.

- [x] 0.1 [infra] Q1 respondida por el owner y anotada en ADR-061 (línea que empieza por «Respuesta del owner (Q1),
  AAAA-MM-DD:»). Con Q1 = (a), la fila asignada en `docs/design-v0.2.md` §6 y el `scope` de `openspec-changes.yaml`
  actualizado; el change no pasa de aquí hasta archivar 35c. Con Q1 = (b), se reescriben 6.5-6.6 con las tres clases de
  fusión de ADR-056 §1 antes de aplicar. Verificar: `grep -c "Respuesta del owner (Q1), 20" docs/adr/ADR-061.md`
  devuelve `1` (hoy `0`).

  **Estado (2026-10-29):** hecha. Q1 = (a) («Toma las recomendaciones»), anotada en ADR-061 §6 y en `design.md`. Fila
  «tras 35c» en `docs/design-v0.2.md` §6, entre 35c y la 36 (`golden-sets-reales`); la fila del manifiesto se movió a
  ese lugar (después de `verify-reusable-workflow`, antes de `golden-sets-reales`) con el `scope` actualizado (solo la
  parte A). **El change no pasa de aquí hasta archivar 35c.** Salida de la verificación: `1`.
- [x] 0.2 [infra] Q5 respondida por el owner y anotada en `design.md` («Respuesta del owner (Q5), AAAA-MM-DD:»). Con
  Q5 = (a): borrar los grupos 7-11 de este fichero, sacar `specs/platform/worker-claims/` y el requirement «Toma única
  de una entrega vencida» de `specs/notifications/dispatch/spec.md` (se recrean en el change posterior cuando se cree),
  marcar D2-D5, D7 y la viñeta del ledger de D9 como «trasladadas» y anotar en ADR-061 §2-§4 que las aplica
  `worker-claims-multi-replica`. Además (F7): quitar de `proposal.md` la capacidad `platform/worker-claims` y todo lo
  de la parte B (viñetas, `Impact` y el requirement «Toma única…» de `Modified Capabilities`), y marcar en ADR-061
  §Consecuencias las dos de la parte B («Escalar el worker deja de ser un riesgo…» y «Los puertos de las marcas
  devuelven una toma con testigo…») con «(al aplicarse `worker-claims-multi-replica`)»; en `Impact` basta borrar el
  bloque «Parte B» (N7). Con cualquier respuesta (N6, B11): la línea de `infra/README.md` bajo «Escalar worker», la
  del `scope` de `verify-reusable-workflow` (35c) en `openspec-changes.yaml` y la de ADR-061 §6 («Para 35c») quedan
  solo con el nombre del change que aplica la parte B (`worker-claims-multi-replica` con (a), `worker-data-hygiene`
  con (b)), sin el paréntesis condicional, y conservan el prefijo «No escalar `worker` hasta archivar». Y (B8): anotar el commit
  fuente del diseño debatido, `776e12a` (el commit que cerró el debate), en ADR-061 §6 y en una fila propia `worker-claims-multi-replica` de `openspec-changes.yaml` que solo
  lleva el disparador «antes del primer `--scale worker=2`» y ese commit, sin `scope` completo. Verificar:
  `grep -c "Respuesta del owner (Q5), 20" openspec/changes/worker-data-hygiene/design.md` devuelve `1`;
  `grep -c "si Q5" infra/README.md openspec-changes.yaml` devuelve `0` en los dos y
  `grep -c "No escalar .worker. hasta archivar" infra/README.md openspec-changes.yaml` sigue en al menos `1`; con (a),
  además, `grep -c "^## 7\." openspec/changes/worker-data-hygiene/tasks.md` devuelve `0`,
  `grep -c "worker-claims" openspec/changes/worker-data-hygiene/proposal.md` devuelve `0`,
  `grep -c "name: worker-claims-multi-replica" openspec-changes.yaml` devuelve `1`,
  `grep -c "<commit de cierre del debate>" docs/adr/ADR-061.md openspec-changes.yaml` devuelve `0` en los dos (el
  marcador se sustituyó) y `openspec validate worker-data-hygiene --strict` sigue en verde.

  **Estado (2026-10-29):** hecha con Q5 = (a). Grupos 7-11 borrados; `specs/platform/worker-claims/` y el requirement
  «Toma única de una entrega vencida» fuera; D2-D5, D7 y la viñeta del ledger de D9 marcadas como trasladadas; ADR-061
  §2-§4 anotados y sus dos consecuencias de la parte B con «(al aplicarse `worker-claims-multi-replica`)»; `proposal.md`
  sin la capacidad ni la parte B; líneas de `infra/README.md`, del `scope` de 35c y de ADR-061 §6 reescritas a «No
  escalar `worker` hasta archivar `worker-claims-multi-replica`»; `776e12a` en ADR-061 §6 y en la fila candidata
  `worker-claims-multi-replica`. Salidas: Q5 en `design.md` → `1`; `si Q5` → `0` y `0`; `No escalar … hasta archivar`
  → `1` y `1`; `^## 7\.` → `0`; `worker-claims` en `proposal.md` → `0`; `name: worker-claims-multi-replica` → `1`;
  marcador → `0` y `0`; `openspec validate worker-data-hygiene --strict` → «Change 'worker-data-hygiene' is valid».
- [x] 0.3 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada en
  `design.md` con su fecha. Verificar: la sección del debate de la última iteración dice «Convergencia: SI».

  **Estado (2026-10-29):** hecha. Iteración 3 más la verificación puntual de N1 con «Convergencia: SI» y sección
  «Aprobación humana (2026-10-29)». Salida de `grep -n "^Convergencia: SI\|^## Aprobación humana" design.md`:
  `548:Convergencia: SI (…)` y `550:## Aprobación humana (2026-10-29)`.

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
  ones remain open» (60 avisadas + P, lote 50; P se inserta la última y tiene el `statusChangedAt` más reciente, así
  el orden de la agregación la deja detrás de las 60) y «picks the oldest unnotified applications first». Falsación: volver a
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
  `splitInFlightDeferrals(data)` hace `const { inFlightDeferrals, ...payload } = data` (el consumidor le pasa
  `job.data`), valida el contador con
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
  (el texto no contiene ningún correo ni `userId` del job).
- [ ] 3.5 [backend] Consumidores. Crear `notifications/infrastructure/queue/worker-factory.ts` con `WorkerHandle`
  (`close` y `on('failed', …)`), `WorkerFactory` (procesador `(job, token?)`) y `bullmqWorkerFactory`, copia por módulo
  como `match/infrastructure/queue/worker-factory.ts` (N4; **no** se importa de `enrichment` ni de `match`).
  `notify-fanout.consumer.ts` y `group-digest.consumer.ts` lo usan los dos (desaparecen `DigestWorkerFactory`,
  `bullmqDigestWorkerFactory` y el `WorkerFactory` local de fan-out), separan el contador con
  `splitInFlightDeferrals(job.data)`, pasan solo `payload` a `parseFanOutJob` / `groupDigestJobPayloadSchema.parse` y
  llaman a `deferWhileInFlight` con el resultado del caso de uso. Todo doble de `createWorker` que ya exista gana `on`
  (hoy ningún spec construye estos consumidores con un doble; `notifications.module.ts` usa el de por defecto).
  Verificar en los specs de los dos consumidores (nuevos), con un `WorkerFactory` doble que captura el procesador
  (`(job, token)`) y un espía en `useCase.execute`: «defers a notify-fanout job that found an in-flight delivery» y
  «defers a group-digest job that found an in-flight delivery» (los dos comprueban que `moveToDelayed` recibe el
  `token` pasado al procesador), y «reruns a deferred job whose data carries the deferral counter»: un `Job` doble con
  `job.data` **plano**, como lo publican el relay y los productores (`bullmq-notify-publisher.ts`,
  `bullmq-group-digest-publisher.ts`), cuyo `updateData` sustituye `job.data`; tras el `DelayedError`, el test vuelve a
  invocar el procesador capturado con ese mismo job y la segunda ejecución llega al caso de uso con el payload sin
  `inFlightDeferrals` (en fan-out, el argumento de la segunda llamada al espía no tiene la clave `inFlightDeferrals` y
  es igual al de la primera; en digest, el espía recibe las dos veces el mismo `weekKey`). En fan-out cubre los tres tipos
  (`GroupLinkAdded`, `ApplicationStatusNotify`, `ApplicationStale`); en digest, `{ weekKey }`. Falsación (F1): validar
  `job.data` entero, sin separar el contador, y ver caer «reruns a deferred job…» en los dos consumidores; restaurar.
- [ ] 3.6 [backend] Retoma tras la muerte del worker, con el ledger Mongo real (`mongo-notify.adapters.spec.ts`; N3).
  Verificar: «a delivery left claimed by a dead worker is sent once its lease expires» (toma `claimed` sin completar,
  reloj + 6 min, la reejecución de `ProcessNotifyFanOut` obtiene `claimed` y envía una vez).

## 4. Cascada de frescura y rastro de avisos agotados (Q2 = (a), Q3 = (a))

- [ ] 4.1 [backend] `MongoFreshnessLinkStore.listCascadePending` (`mongo-freshness.adapters.ts`; `listForExpireCascade`
  no cambia) filtra los links cerrados antes del `$limit`: `$group` por `linkId`, **`{ $sort: { _id: 1 } }` justo
  después del `$group`** (N1; `$group` no garantiza orden), `$lookup` a `job_links` con `closedAt`, `$limit` y
  `maxTimeMS`. Fixture: 201 links abiertos con postulaciones + 1 cerrado L con una postulación abierta, límite 50; **L se
  crea el último y con un `_id` explícito mayor que todos** (el contador de `ObjectId` puede dar la vuelta dentro de un
  segundo; N1-c), así cualquier `$limit` aplicado antes de filtrar lo deja afuera siempre. Verificar en
  `freshness-close.spec.ts` (escenario «Link cerrado detrás de más de cuatro lotes de links abiertos»): «finds a closed
  link with open applications behind more than four batches of open links». Orden de trabajo (N1-bis): **primero**
  agregar solo `{ $sort: { _id: 1 } }` después del `$group` del código actual y comprobar que el test **falla** (sin el
  `$sort`, el código de hoy no es determinista y podría pasar por azar); **después** mover el filtro de cerrados antes
  del `$limit` y verlo pasar. Además, sobre el mismo fixture con `DetectLinkFreshness` real (N5), «expires the open application of a closed
  link behind more than four batches» (la postulación de L queda `expired`). Falsación: devolver el `$limit` antes del
  `$lookup` y ver caer el primero; restaurar.
- [ ] 4.2 [backend] En la misma agregación, **antes** de `$group`/`$limit`, excluir las postulaciones `expired` de
  grupo con ASN confirmada con el `$lookup` de design D9 contra `application_status_group_notify_claims` (`let: {
  appId: { $toString: '$_id' }, sca: '$statusChangedAt' }`, `pipeline` con `$expr`/`$eq` y `confirmed: true`, F4/F5).
  Verificar: `freshness-close.spec.ts` y `detect-link-freshness.usecase.spec.ts` en verde, «skips a closed link whose
  group notifications are all confirmed» y (escenario «Link cerrado ya avisado no tapa a uno pendiente») «finds a
  closed link with open applications behind more than four batches of fully notified closed links» (201 links cerrados
  con todas sus postulaciones `expired` de grupo y sus ASN confirmadas + 1 cerrado L con una postulación abierta,
  límite 50; L se crea el último, con el `ObjectId` mayor, y el `$sort { _id: 1 }` de 4.1 lo deja detrás de los 201).
  Falsación (N1-b): quitar el `$lookup` de ASN previo y filtrar las ASN en memoria después del `$limit`, como hoy (tras
  el `$group` ya no hay `_id` ni `statusChangedAt` de la postulación para un `$lookup`), y ver caer el segundo; con el
  `$sort` de 4.1, L se cae siempre; restaurar.
- [ ] 4.3 [backend] `on('failed')` en `notify-fanout` y `group-digest` (sobre el `WorkerHandle` de 3.5) con una línea
  `warn` (cola, `jobId`, nombre del error); un `DelayedError` (el aplazamiento de D11) o un job `undefined` se ignoran,
  como `onJobFailed` de `enrich-link.consumer.ts:133`. Verificar además: «ignores a delayed notify-fanout job in the
  failed listener» (el doble emite `failed` con un `DelayedError` y no hay `warn`). Verificar: «logs an exhausted notify-fanout job without recipients» y «logs an exhausted group-digest job
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

## 6. Cierre

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
  frescura corre, y `db.outbox_events.getIndexes()` muestra `ttl_published`. Verificar: líneas de log y salidas
  anotadas.
- [ ] 6.5 [infra] Fusión en la fila que fijó Q1 = (a): después de archivar 35c (y antes de `golden-sets-reales`), en
  una ventana autorizada por el owner. Verificar: número de PR y commit en la descripción del PR de archivo.
- [ ] 6.6 [infra] Tras el despliegue a staging: `getIndexes()` de las colecciones tocadas y
  `db.outbox_events.countDocuments({ publishedAt: { $lt: <ahora − 8 días> } })` = `0` antes de una hora, con
  `measure.mongosh.js` dando los mismos valores antes y después. Verificar: salidas anotadas en el PR de archivo.
- [ ] 6.7 [infra] Al archivar: ADR-061 pasa a «Aceptado» con fecha y PR (§2-§4 siguen «Propuestas» para
  `worker-claims-multi-replica`), y la línea de ADR-009 deja de decir «propuesta». Verificar: `grep -n "^\*\*Estado:\*\* Aceptado"
  docs/adr/ADR-061.md` devuelve una línea.
