## Context

**Origen.** Parte B de `worker-data-hygiene`, partida por el owner el 2026-10-29 (Q5 = (a)). El diseño se debatió allí
en tres iteraciones y una verificación puntual (convergencia SI); su texto de cierre es el commit `776e12a` de la rama
`spec/worker-data-hygiene`: decisiones D2-D5, D7 y la viñeta del ledger de D9, grupos 7-11 de tareas, la capacidad
`platform/worker-claims` y el requirement «Toma única de una entrega vencida». Este design los retoma **con la
numeración propia de este change** (tabla de correspondencia abajo), con una precisión nueva (D6: la migración no
bloquea el arranque) y dos piezas nuevas (D8 inventario de crons, D9 levantar la regla de no escalar).

Estado de `main` en `5b92d28` (2026-11-04), sin cambios en el worker desde el relevamiento del 2026-10-28:

- **Marcas**, sin esquema ni índice, sobre `connection.collection(...)`:

  | Colección | Clave | Quién la usa | Qué significa `confirmed` |
  |---|---|---|---|
  | `link_freshness_claims` | `linkId` | `DetectLinkFreshness` (cascada y abiertas) | nada: `confirm` borra el documento |
  | `application_status_group_notify_claims` | `applicationId` + `statusChangedAt` | `ExpireApplicationsForClosedLinkUseCase`, `listCascadePending`, `listForExpireCascade` | «el ASN de este expire ya se encoló»; bloquea para siempre |
  | `application_stale_claims` | `applicationId` + `statusChangedAt` | `DetectStaleApplications` | «el stale de este `statusChangedAt` ya se encoló»; bloquea para siempre |

  Las tres: `findOne` por clave, decisión en memoria, `updateOne(clave, $set, { upsert: true })`; `release` =
  `deleteOne({ clave, confirmed: false })`. Los casos de uso leen `now` al principio (`ExpireApplications…` una vez por
  link; `DetectLinkFreshness.processClaimed` y `DetectStaleApplications` por fila) y lo pasan a `claim`. Leases:
  `FRESHNESS_CLAIM_LEASE_MS`, `ASN_CLAIM_LEASE_MS`, `STALE_CLAIM_LEASE_MS`, los tres `60_000`.
- **Crons del worker** (cuatro, montados por `@nestjs/schedule` en `onApplicationBootstrap`, solo fuera de `test`):
  `LinkFreshnessScheduler` y `StaleApplicationsScheduler` (`EVERY_HOUR`), el host dinámico del digest semanal
  (`GROUP_DIGEST_CRON`, `notifications.module.ts:91`) y `SnapshotSweepScheduler` (diario). Cada réplica corre los suyos.
- **Ledger de entregas** (`notification_deliveries`): índice único `(type, aggregateKey, userId, channel)` declarado en
  el esquema de `api`. En el worker, `MongoNotifyDeliveryLedger.claim` retoma un `claimed` vencido con `updateOne` sin
  condición. `api` tiene una copia (`MongoNotificationDeliveryRepository.claim`) con el mismo defecto y **sin ningún
  llamador** (solo se usa su `deleteByUserId` en el borrado de cuenta; Q3).
- **Arranque**: la conexión de Mongoose del worker es **perezosa** (`lazyConnection: true`, `MongoPersistenceModule`) y
  `platform/runtime-health` («Arranque independiente de las dependencias») exige servir la liveness con Mongo caído. Una
  operación de Mongo esperada en `onModuleInit` con Mongo caído queda en el búfer de Mongoose y falla a los
  `bufferTimeoutMS` (10 s por defecto; los 30 s son la selección de servidor del driver, que corre aparte): durante ese
  tiempo el `app.init()` no termina y el puerto de salud no abre. El test
  `startup-without-dependencies.spec.ts` corre con `NODE_ENV=test`, donde los schedulers no se registran, así que **no**
  lo detectaría.
- **Despliegue**: staging con un worker; `infra/README.md` bajo «Escalar worker» dice «No escalar `worker` hasta archivar
  `worker-claims-multi-replica`; ADR-061 §6»; `docker-compose.prod.yml:281` conserva el comentario
  `# Scale without touching other services: docker compose … up -d --scale worker=2`, que corrige 35c.

**Lo que deja `worker-data-hygiene` (parte A) y este change da por hecho** (precondición, tarea 0.3):
`NOTIFY_DELIVERY_LEASE_MS` exportada desde `mongo-notify.adapters.ts` (antes `CLAIM_LEASE_MS`); `deliverChannel` lee el
reloj justo antes de `ledger.claim`; los consumidores de avisos aplazan un job con entregas en vuelo; existe
`mongo-notify.adapters.spec.ts` con la retoma tras la muerte del worker (su 3.6); `listEligible` de stale y
`listCascadePending` hacen `$lookup` con `$expr`/`$eq` sobre `applicationId` + `statusChangedAt` y `confirmed: true`
contra las colecciones de marcas, que sin `uniq_claim_key` escanean la colección.

Requisitos que mandan: `notifications/stale-applications` («Un aviso por estancamiento»), `notifications/dispatch`
(«Idempotencia de entrega», «Auto-expire de vacante cerrada sin outbox»: el claim no se borra por estar `expired`),
`notifications/group-digest` («Idempotencia semanal»), `links/freshness` («Límite por ejecución e idempotencia»: lease;
la marca no queda dura si el encolado falla), `platform/runtime-health` («Arranque independiente de las dependencias»),
`platform/production-deploy` («Réplicas del worker»: el compose permite escalar `worker`), `cv/documents` («Dos
réplicas barren a la vez»).

## Goals / Non-Goals

**Goals:** que tomar una marca sea correcto con N réplicas sin depender del `jobId` de BullMQ; que las tomas abandonadas
caduquen y ningún «ya se avisó» lo haga; que los datos existentes, con posibles duplicados, migren solos sin perder
ninguno y sin retrasar el arranque; que dos workers no retomen la misma entrega vencida; que cada cron del worker tenga
escrito qué lo protege; que todo se verifique con `mongodb-memory-server` (replset) y dos conexiones, de forma
determinista; y que, archivado el change, la regla de no escalar `worker` se sustituya por su condición real.

**Non-Goals:** cambiar qué se notifica o cuándo; nada de la parte A; retención de `notification_deliveries`; barrido
de marcas confirmadas de clave muerta; escalar `api`; observabilidad nueva; locks distribuidos o réplica líder.

## Relación con `worker-data-hygiene` y ADR-061

Los dos changes comparten ADR-061 y el manifiesto. Reparto de ADR-061:

| Sección de ADR-061 | Quién la aplica | Qué hace este change con ella |
|---|---|---|
| §1 Retención del outbox | `worker-data-hygiene` | nada |
| §2 Una marca por clave, toma atómica | **este change** (D2, D3) | aplica sin cambios |
| §3 Caducidad | **este change** (D4, D5) | aplica sin cambios |
| §4 Índices al arrancar, migración y compuerta | **este change** (D6) | aplica y **precisa**: la migración no bloquea el arranque; la compuerta nace cerrada (anotación de una línea en §4) |
| §5 Jobs fallidos de BullMQ | `worker-data-hygiene` | nada |
| §5b Entregas en vuelo | `worker-data-hygiene` | lo da por hecho (D7 se apoya en él) |
| §6 Encaje / «Para 35c» | ambos | **cierra** la regla «No escalar `worker` hasta archivar…» al archivar (D9) |
| §Consecuencias, las dos «(al aplicarse `worker-claims-multi-replica`)» | **este change** | pasan a vigentes al archivar |
| «Toma vencida del ledger» (sin sección propia; cabecera y §6) | **este change** (D7) | aplica sin cambios |

**ADR propio: no.** Las decisiones de fondo ya están en ADR-061 §2-§4, debatidas y con la partición aprobada por el
owner. D6 precisa el «cómo» de §4 sin cambiar su «qué» (antes del primer tick de los detectores, sin tumbar el worker);
D8 y D9 son de diseño y de documentación, no de arquitectura. Basta una anotación de una línea en §4 y otra en §6; el
estado de §2-§4 pasa a «Aceptado» al archivar (tarea 11.7). ADR-066 queda libre.

Orden en el tiempo: `worker-data-hygiene` aplica, se fusiona y se archiva (su 6.7 deja ADR-061 «Aceptado» con §2-§4
«Propuestas»); después este change aplica (precondición 0.3). Las ramas `spec/*` de los dos solo tocan en común ADR-061
(líneas distintas) y filas distintas del manifiesto.

Correspondencia con `776e12a`:

| Este change | `776e12a` (`worker-data-hygiene`) |
|---|---|
| D2 toma atómica | D2 |
| D3 testigo | D3 |
| D4 frescura | D4 |
| D5 caducidad | D5 |
| D6 migración y compuerta | D7 (**precisada**) |
| D7 ledger | D9, viñeta de la parte B |
| R1-R2, R6 | R1, R2, R6 |
| grupos 1-8 de tareas | grupos 7-11 |

## Decisions

### D1. Alcance: la parte B de `776e12a`, más lo que la hace verificable

Entra: D2-D7 (lo debatido, con la precisión de D6), D8 (inventario de crons, Q2) y D9 (levantar la regla). No entra
nada que `worker-data-hygiene` ya aplica. Los títulos de los tests de `776e12a` se conservan tal cual, para que la
trazabilidad con el debate sea un `grep`.

### D2. Una marca es un documento por clave con índice único, y tomarla es una sola operación

Para cada colección, índice único sobre su clave (`{ linkId: 1 }` o `{ applicationId: 1, statusChangedAt: 1 }`,
nombre `uniq_claim_key`) y toma con `findOneAndUpdate` + `upsert`, cuyo filtro incluye **la condición de que la marca
esté libre**:

```ts
const now = this.clock.now(); // en el momento de tomar, no al empezar la pasada (H5)
filter = { ...key, confirmed: false, $or: [
  { leaseUntil: { $lte: now } },
  { leaseUntil: { $exists: false }, claimedAt: { $lte: new Date(now - leaseMs) } }, // heredado (D5)
]};
update = { $set: { claimedAt: now, leaseUntil: new Date(now + leaseMs), token, holder, confirmed: false } };
```

- **Compuerta en la toma (C1 del debate)**: antes del `findOneAndUpdate`, `take` hace `await gate.ensure()` de su
  colección (D6) y, si queda cerrada, devuelve `null` sin escribir. Sin `uniq_claim_key`, el filtro de arriba no casa con
  una marca vigente y el `upsert` **insertaría un duplicado y ganaría**: por eso la compuerta no puede vivir solo en los
  schedulers. Hay un camino que no pasa por ellos: `enrich-link.usecase.ts:114` → `close-job-link.usecase.ts:63` →
  `ExpireApplicationsForClosedLinkUseCase` (`:78`), que toma marcas de ASN desde el consumidor de enriquecimiento, y
  `listForExpireCascade` devuelve también postulaciones ya `expired` con su ASN sin confirmar. Sería una regresión
  incluso con un solo worker. Una toma rechazada por la compuerta no pierde el aviso: la postulación queda `expired` de
  grupo sin ASN confirmada y la recoge `listCascadePending` en una pasada posterior.
- **`holder` (B5)**: `os.hostname()` del proceso (el id del contenedor en Docker), leído una vez al construir. Solo es
  diagnóstico (qué réplica tiene una toma sin confirmar); ninguna lógica lo lee. No es un dato personal.

- **Libre o vencida** → el filtro casa, se actualiza y la réplica gana.
- **No existe** → `upsert` inserta (copia la clave y `confirmed: false` del filtro) y la réplica gana.
- **Ocupada o confirmada** → el filtro no casa, `upsert` intenta insertar y el índice único lo rechaza con `E11000`: el
  adaptador lo traduce a «no tomada». Mongo **no** reintenta este `upsert` por su cuenta, porque el filtro no es solo
  igualdades sobre la clave del índice.
- **Dos réplicas a la vez**: dos inserciones de la misma clave → una gana y la otra recibe `E11000`; dos tomas del mismo
  documento vencido → `findOneAndUpdate` es atómico por documento, la segunda ya no casa y cae en `E11000`.
- **El instante es el de la toma** (H5): el adaptador lee su reloj inyectado en cada `take`, `confirm` y `release`; el
  `now` de principio de pasada desaparece de la firma de los puertos.
- **Sin sesión**: el puerto de toma no recibe ni usa una sesión de transacción; un `E11000` dentro de una transacción la
  abortaría entera.
- **Dónde vive**: `apps/worker/src/infrastructure/claims/mongo-lease-claims.ts`, plataforma del worker como
  `infrastructure/storage/` o `infrastructure/config/`, que los módulos ya importan. Recibe en el constructor la
  conexión, el nombre de la colección, los campos de la clave, `mode: 'lease' | 'durable'` y un `{ now(): Date }`; los
  adaptadores de cada módulo la construyen con su propio reloj (`FRESHNESS_CLOCK`, `NOTIFY_CLOCK`). No es un módulo de
  dominio: no rompe la regla de que un módulo no importa la infraestructura de otro.

*Descartado:* mantener «leer y después upsert» y confiar en el `jobId` (con `removeOnComplete: true`, el primer job puede
haber terminado y desaparecido antes del segundo `add`); un lock distribuido por tick en Redis o Mongo (serializa
réplicas enteras en vez de claves, y su vencimiento tiene los mismos problemas); una réplica «líder» para los crons (otra
pieza de coordinación para un problema que una clave única resuelve).

### D3. Cada toma lleva un testigo; `release` solo borra la propia

La toma genera `token = randomUUID()` y el puerto devuelve `ClaimLease { token } | null` en vez de `boolean`.

- `release(lease)` = `deleteOne({ ...key, token, confirmed: false })`.
- `confirm` de stale y ASN = `updateOne({ ...key }, { $set: { confirmed: true, confirmedAt: now }, $unset: { leaseUntil:
  '', token: '' } }, { upsert: true })`, **sin** condicionar al testigo y **con `upsert`** (H3). El filtro es solo de
  igualdad sobre la clave única, así que Mongo reintenta el `upsert` si choca con otra inserción y no crea duplicados.
  Si A encoló, el aviso existe aunque su toma haya vencido; al quitar el testigo, el `release` posterior de B no casa; y
  si B ya liberó antes de que A confirme, el `upsert` recrea la marca confirmada.
- `confirm` de frescura = `updateOne({ linkId, token }, { $set: { leaseUntil: now + FRESHNESS_CONFIRMED_HOLD_MS } })`
  (D4), sin `upsert`.
- Puertos (`FreshnessLinkClaims`, `StatusGroupNotifyClaims`, `ApplicationStaleClaims`) en `application/ports`: cambian
  firmas y dobles en memoria; la lógica de los casos de uso no cambia. `isConfirmed` de ASN y `listEligible` de stale se
  conservan.

*Descartado:* condicionar `release` al `claimedAt` leído (dos réplicas pueden escribir el mismo `now` en milisegundos);
`confirm` sin `upsert` (pierde el registro en la secuencia «B libera, A confirma»).

### D4. La marca de frescura es solo un lease, con una retención corta tras confirmar

En frescura `confirmed` no significa nada y queda siempre en `false` (se escribe explícito en cada toma, para el filtro
parcial de D5). `confirm` deja la marca con `leaseUntil = now + FRESHNESS_CONFIRMED_HOLD_MS` (30 minutos, menor que el
periodo del cron de 1 h): el siguiente tick puede reclamar, el mismo tick en otra réplica no. `release` (fallo) borra la
propia y deja el link reclamable enseguida, como pide «Reclamación con lease». Desaparece el comentario de
`mongo-freshness.adapters.ts:210-220`.

*Descartado:* borrar en `confirm` (la ventana del mismo tick); una marca duradera por cubeta de cadencia (duplica
`lastFreshnessCheckAt`).

### D5. Caducidad: TTL sobre `leaseUntil`, solo para las no confirmadas

En las tres colecciones, índice TTL `{ leaseUntil: 1 }`, `expireAfterSeconds: 86_400`, nombre `ttl_lease`, con
`partialFilterExpression: { confirmed: false }` (H4).

- Una toma abandonada se borra un día después de vencer; equivale a lo que ya permite la toma.
- Una marca de frescura confirmada (sigue con `confirmed: false`) se borra 24 h después de su retención.
- Una confirmada de stale o ASN queda **fuera del índice** por el filtro parcial, lleve o no `leaseUntil`: una réplica de
  la versión anterior que confirma con `$set: { confirmed: true }` sobre una toma nueva deja un `leaseUntil` pasado en
  una confirmada, y sin el filtro parcial el monitor la borraría y el aviso se reemitiría.
- **Heredados**: los documentos de la versión anterior no tienen `leaseUntil` ni `token`; el filtro de D2 los acepta por
  `claimedAt` y la migración (D6) les completa `leaseUntil`.

*Descartado:* TTL sobre `claimedAt`; TTL sin filtro parcial confiando en el `$unset`; TTL largo sobre las confirmadas
(contradice «Un aviso por estancamiento»).

### D6. Migración e índices sin bloquear el arranque; la compuerta nace cerrada y vive en la toma *(precisa ADR-061 §4 y D7 de `776e12a`)*

`ClaimIndexesBootstrap` (plataforma del worker) con `ensure(collection): Promise<boolean>` y `ClaimIndexesGate` por
colección, que **nace cerrada**. Semántica de `ensure` (C10):

- compuerta abierta → `true` sin tocar Mongo (queda **cacheada** abierta para la vida del proceso);
- hay una migración en curso → se une a ella y devuelve su resultado; **unirse cuenta como el intento**: quien se unió a
  un vuelo que terminó cerrado no lanza otro;
- cerrada y sin vuelo → lanza un intento nuevo (`migrate`) y devuelve su resultado.

`migrate(collection)` es el de `776e12a` D7:

1. **Completar heredados**: `updateMany({ leaseUntil: { $exists: false }, confirmed: { $ne: true } }, [{ $set:
   { confirmed: false, leaseUntil: { $add: [{ $ifNull: ['$claimedAt', now] }, leaseMs] } } }])`. En la colección de
   **modo lease** (frescura), además (C15): `updateMany({ confirmed: true }, { $set: { confirmed: false, leaseUntil: now
   } })`, para que ninguna marca de frescura quede confirmada fuera del TTL y bloqueando para siempre.
2. **Quitar duplicados**: agregación con `maxTimeMS` que agrupa por clave con más de un documento y conserva el
   confirmado, después el de `claimedAt` más reciente, después el de `_id` menor; borra el resto por `_id`. Dos réplicas
   calculan el mismo superviviente. Nunca se pierde un «ya se avisó».
3. **Crear** con un `createIndex` por índice, **`ttl_lease` primero** y `uniq_claim_key` después.
4. **Comprobar** con `listIndexes` que la clave única existe con `unique: true` y la clave esperada; si sí, abre la
   compuerta y registra `log` con el texto fijo **`claims migration complete: <colección> (platform/worker-claims)`**
   (B3).

Si 3 falla con `E11000` (un escritor heredado insertó un duplicado entre 2 y 3), se repiten 2-4 hasta tres veces.
**`migrate` nunca lanza**: cualquier otro error se captura, deja la compuerta cerrada y registra un `warn` con el texto
fijo **`claims gate closed: <colección> (<codeName|code>)`** (B4), sin documentos ni claves.

**Dónde se consulta la compuerta (C1).** En **la toma**: `MongoLeaseClaims.take` hace `await ensure()` de su colección y
devuelve `null` si queda cerrada (D2). Así ningún camino toma una marca sin el índice único, tampoco la cascada de ASN
que dispara el consumidor de enriquecimiento al cerrar un link. Los schedulers, además, hacen `ensure` al empezar el
tick (`StaleApplicationsScheduler`: `application_stale_claims`; `LinkFreshnessScheduler`: `link_freshness_claims` **y**
`application_status_group_notify_claims`, H6) para registrar el `warn` y saltarse el tick entero en vez de recorrer un
lote cuyas tomas responderían todas `null`. Con la compuerta cacheada abierta, el `ensure` de cada toma no toca Mongo.

**Cuándo corre la migración (lo nuevo respecto de `776e12a`).** `776e12a` la esperaba en `onModuleInit` y apoyaba el
«antes del primer tick» en que los crons se montan en `onApplicationBootstrap`. Con la conexión perezosa y Mongo caído,
ese `await` deja `app.init()` colgado hasta que el búfer de Mongoose falla (`bufferTimeoutMS`, 10 s por defecto) y el
worker no sirve su liveness: rompe «Arranque independiente de las dependencias», y ningún test de hoy lo vería. Por eso:

- `ClaimsModule` (`apps/worker/src/infrastructure/claims/claims.module.ts`) es **estático y `@Global()`**, importado una
  sola vez en `AppModule` (C11): una única instancia de `ClaimIndexesBootstrap` y de cada compuerta para los schedulers y
  para los adaptadores de los dos módulos. Existe también en `test`, porque los adaptadores lo necesitan.
- `ClaimIndexesBootstrap.onApplicationBootstrap()`, **solo con los consumidores habilitados** (`NODE_ENV !== 'test'`, leído
  de `APP_CONFIG`), lanza `ensure` de las tres colecciones **sin esperarlo** (`void`; el error ya lo captura `migrate`).
  En `test` no lanza nada y la migración corre perezosa en la primera toma; `startup-without-dependencies.spec.ts` no
  cambia.
- **El «antes del primer tick» lo garantiza la compuerta, no el ciclo de vida**: el primer tick se une a la migración de
  arranque o la reintenta; si queda cerrada, `warn` y salto.
- El apagado no espera a una migración en curso: `MongoInitialConnectRetry.beforeApplicationShutdown` cierra el cliente
  si la conexión sigue pendiente, y la operación abortada cae en el `catch` de `migrate`.
- **Una compuerta abierta no se vuelve a cerrar sola**: si alguien borra un índice (`dropIndex`) o restaura la base, los
  workers siguen creyéndola abierta hasta reiniciarse. El RUNBOOK lo dice (C12).

*Descartado:* esperar la migración en `onModuleInit` (bloquea el arranque con Mongo caído); la compuerta solo en los
schedulers (deja abierta la cascada desde el enriquecimiento, C1); volver a comprobar los índices en cada toma (una
consulta por toma para un caso de operación manual que cubre el reinicio); esperar al evento `connected` antes de
lanzarla; esquemas de Mongoose con `autoIndex`; una migración manual por `mongosh`; que el worker no arranque;
`createIndexes` de los dos índices a la vez.

### D7. La toma vencida del ledger es de uno solo

`MongoNotifyDeliveryLedger.claim`, rama de toma vencida: `updateOne({ ...filter, status: 'claimed', claimedAt:
existing.claimedAt }, ...)` y `'claimed'` solo con `modifiedCount === 1`; si no, se vuelve a leer una vez y se responde
según el estado nuevo (`in_flight` o `already_done`); si la relectura **no encuentra documento** (lo borró el borrado de
cuenta entre la lectura y la retoma), `already_done` (C19). Entre la lectura y la retoma, un método `protected async
beforeRetake(): Promise<void>` vacío es el punto de inyección del test (H8). Con la entrega en vuelo de la parte A
(§5b), el perdedor que obtiene `in_flight` aplaza su job y en la vuelta encuentra `already_done`: nadie envía dos veces y
nadie pierde el aviso.

La copia de `api` (`MongoNotificationDeliveryRepository.claim`) tiene el mismo defecto pero ningún llamador; queda
fuera (Q3) y se anota como candidato en el manifiesto (tarea 10.4).

### D8. Inventario de crons con varias réplicas *(Q2; con Q2 = (b) sale)*

Las marcas cubren tres de los cuatro crons del worker. Los otros dos ya son seguros por otro mecanismo, y este change
lo deja escrito y vigilado en vez de suponerlo:

| Cron | Fichero | Declaraciones | Mecanismo con N réplicas |
|---|---|---|---|
| frescura (`EVERY_HOUR`) | `freshness/infrastructure/queue/link-freshness.scheduler.ts` | 1 | marcas `link_freshness_claims` + ASN (D2-D6) |
| stale (`EVERY_HOUR`) | `notifications/infrastructure/queue/stale-applications.scheduler.ts` | 1 | marcas `application_stale_claims` (D2-D6) |
| digest semanal (`GROUP_DIGEST_CRON`) | `notifications/notifications.module.ts` (host dinámico) | 1 | job raíz de un solo vuelo (`digest:week:{weekKey}`) + ledger por entrega (D7) + entrega en vuelo (§5b) |
| barrido de snapshots (diario) | `enrichment/infrastructure/schedule/snapshot-sweep.scheduler.ts` | 1 | caso de uso idempotente (`cv/documents`, «Dos réplicas barren a la vez») |

- **Guardia**: `apps/worker/src/app/worker-crons.inventory.spec.ts` recorre los `.ts` no `spec` de `apps/worker/src`,
  **quita los comentarios** (`/* … */`, `/** … */` y `// …`; C2: `group-digest.scheduler.ts:12` menciona `@Cron(` en un
  JSDoc) y cuenta por fichero las apariciones de `@Cron(`, `@Interval(`, `@Timeout(`, `addCronJob(`, `addInterval(`,
  `addTimeout(`, `repeat:` y `upsertJobScheduler(` (C4). Compara el mapa fichero → número con la tabla exportada del
  propio test (C3) y falla nombrando el fichero que sobra, el que falta o el que no cuadra. Es un test de Vitest del
  proyecto `worker`: su caché de Nx depende de los fuentes del worker, que es lo que inspecciona.
- **Digest con dos réplicas**: si los dos crons encolan la misma `weekKey` y el primer job ya terminó y se borró, corre
  un segundo; el ledger responde `already_done` (o `in_flight` y aplaza). Un test de integración con dos
  `ProcessGroupWeeklyDigest` y dos conexiones lo fija (tarea 9.2); como el índice único de `notification_deliveries` lo
  declara el esquema de `api`, el setup lo crea igual, con un comentario que apunta a
  `apps/api/src/modules/notifications/infrastructure/notification-delivery.schemas.ts` (C6).

*Descartado:* un lint o un `grep` en `repo-checks` (más frágil ante el host dinámico del digest y fuera del proyecto
que lo usa); marcas también para el digest (duplicaría lo que el ledger ya garantiza).

### D9. Levantar la regla de no escalar `worker`

La regla existe porque escalar sin este change duplica avisos. Al archivar:

- `infra/README.md`, bajo «Escalar worker»: la línea «No escalar `worker` hasta archivar `worker-claims-multi-replica`;
  ADR-061 §6» pasa a «Escalar `worker` solo cuando todas las réplicas corran una imagen que incluya
  `worker-claims-multi-replica` (ADR-061 §2-§4)», seguida de los **dos chequeos** antes de `--scale … --no-recreate`
  (B3, C5): (1) `docker compose … ps` / `images` muestra que la réplica existente corre el `IMAGE_TAG` desplegado
  después del PR de este change; (2) su log contiene `claims migration complete` para las tres colecciones. Archivar no
  es desplegar: la condición es la imagen, no el archivo.
- **Versiones mezcladas** (R6, C5): con `uniq_claim_key` creado no hay **documentos duplicados**, pero una réplica vieja
  sigue con «leer y después upsert» y **puede repetirse un aviso** mientras convivan. Por eso los chequeos van antes de
  escalar, y la recreación de contenedores de un despliegue normal (un worker, el viejo se para antes) no es un riesgo.
- `docker-compose.prod.yml`, comentario del servicio `worker` (Q4 = (a)), en inglés como el resto del fichero:
  `# Scale only when every worker replica runs an image that includes worker-claims-multi-replica (see infra/README.md)`.
- ADR-061 §6 «Para 35c»: la regla queda como histórica con una anotación de una línea (tarea 11.7).

### D10. Encaje: después de `worker-data-hygiene`; la fila la decide el owner

Disparador del owner: «antes del primer `--scale worker=2`». Hoy no hay host de producción ni plan de escalar staging:
el valor para el usuario es nulo hasta que se escale, y la spec ya queda escrita. Q1 decide si entra como fila
ejecutable o queda como candidato. Precondición dura en cualquier caso: `worker-data-hygiene` archivado (0.3). Si se
aplica, llega a staging por el CD normal de `main` (no tiene despliegue propio); la 11.6 comprueba ese despliegue. No hay
excepción a ADR-048 que pedir: la fila 35 termina antes que `worker-data-hygiene`.

### D11. Cómo se prueba la concurrencia

- Integración con el `MongoMemoryReplSet` del preset de `@linkvault/testing` (`getMongoTestUri()`), una base por
  fichero. «Dos réplicas» = **dos conexiones de Mongoose distintas** (`mongoose.createConnection` dos veces sobre la
  misma URI y base), cada una con su adaptador o caso de uso.
- **Sin esperas fijas.** Las carreras se fijan de dos maneras: (a) propiedades que valen para cualquier intercalado
  (`Promise.all` de dos tomas → exactamente una gana, un documento por clave), repetidas 50 rondas; (b) intercalados
  forzados con puntos de inyección (`beforeRetake` del ledger, dobles de `migrate` con **promesa diferida** que resuelve
  el test, C8). Las falsaciones de las carreras son **secuenciales** (H8): sin `uniq_claim_key`, A toma y luego B toma la
  misma clave.
- Fixtures con **`_id` explícitos** (C14) donde el orden importa (superviviente por `_id` menor, orden de inserción).
- Los tests del monitor TTL arrancan su propio `MongoMemoryServer` con `ttlMonitorSleepSecs=1` y sondean cada 250 ms con
  tope de 10 s un **centinela** que tiene que desaparecer antes de afirmar que algo no desapareció (H9).
- Las pruebas de arranque usan un módulo de testing con `app.init()`, **sin adaptador HTTP** (C8), y la de Mongo caído
  (C7) usa el `ClaimIndexesBootstrap` real con una conexión perezosa a un puerto sin servidor y `bufferTimeoutMS` bajo
  (200 ms): el test espera la promesa de `ensure`, no un reloj.

## Risks / Trade-offs

- **R1. `E11000` como «no tomada»**: si otro índice único fallara, se leería como ocupada. Mitigación: las colecciones
  solo tienen `_id`, `uniq_claim_key` y `ttl_lease`; el adaptador comprueba que el `keyPattern` del error es la clave y
  relanza cualquier otro (test con un índice único extra).
- **R2. Compuerta cerrada en silencio prolongado**: si la migración no converge, stale, ASN y frescura no corren.
  Mitigación: `warn` con texto fijo (`claims gate closed`) por tick; RUNBOOK con el `grep` exacto, la consulta de
  índices y la tabla causa → acción por `codeName`.
- **R3. Primer tick tras un arranque con Mongo caído** *(por D6)*: el tick se une a la migración o la reintenta; con
  Mongo caído falla a los `bufferTimeoutMS` y el tick se salta con un `warn`, una vez por hora hasta que vuelva Mongo.
- **R4. `listEligible` y `listCascadePending` con `uniq_claim_key`**: el `$lookup` de la parte A pasa a usar el índice;
  no cambia su resultado. Lo cubren los tests de la parte A, que siguen en verde (7.3).
- **R5. Dos réplicas migrando a la vez**: las dos calculan el mismo superviviente y `createIndex` es idempotente; lo fija
  la 3.5.
- **R6. Despliegue escalado con versiones mezcladas** (C5): con el índice único, el upsert por igualdad de la réplica
  vieja se reintenta sin crear **documentos duplicados**, y la rama heredada del filtro evita que bloquee a las nuevas;
  pero la réplica vieja sigue decidiendo en memoria tras leer, así que **puede repetirse un aviso** mientras convivan.
  Una confirmación vieja sobre una toma nueva deja un `leaseUntil` pasado en una confirmada: el filtro parcial la deja
  fuera del TTL (5.1). Mitigación: los chequeos de D9 antes de escalar; 8.6 fija que una réplica nueva toma una clave que
  dejó una vieja.
- **R7. Vuelta atrás** con el ledger: la versión anterior retoma sin condición, como hoy; no rompe nada que hoy funcione.
- **R8. El inventario de crons como guardia textual** *(D8)*: un cron declarado de una forma que ningún patrón vea se
  escaparía. Mitigación: ocho patrones (decoradores, registro dinámico y jobs repetibles de BullMQ), comentarios fuera.
- **R9. Toma con la compuerta cerrada fuera de un tick** *(por C1)*: cada toma del camino de enriquecimiento con la
  compuerta cerrada lanza o se une a un intento de migración. Es un estado anómalo y el vuelo único comparte el intento
  entre tomas simultáneas; el aviso no se pierde (lo recoge `listCascadePending`).
- **R10. Compuerta cacheada tras un `dropIndex`** *(por D6)*: los workers no lo notan hasta reiniciarse. Mitigación:
  RUNBOOK (C12).

## Migration Plan

1. **Apply y CI**: todo con `mongodb-memory-server` (replset del preset), incluidas la migración de heredados con
   duplicados, dos réplicas migrando y la prueba de dos réplicas por cada detector y por el digest.
2. **Despliegue** por el CD normal de `main` (con un worker): el worker nuevo sirve la liveness enseguida y migra en
   segundo plano; ninguna toma corre antes de que exista el índice único. Sin scripts ni paradas.
3. **Comprobación tras desplegar** (RUNBOOK): `getIndexes()` de las tres colecciones con `uniq_claim_key` y `ttl_lease`
   (con su filtro parcial), tres líneas `claims migration complete` y ningún `claims gate closed` en
   `docker compose logs worker`.
4. **Escalar**: solo después de 3 y de los dos chequeos de D9.
5. **Vuelta atrás**: revertir el código. Los índices no estorban a la versión anterior: con el único, su upsert por
   igualdad se reintenta sin error; con `ttl_lease` parcial, sus tomas sin `leaseUntil` no caducan, las que dejó el
   código nuevo caducan como abandonadas y las confirmadas quedan fuera. **Antes de revertir, volver a un worker** (la
   versión anterior duplica avisos con dos). Si hiciera falta quitarlos: `dropIndex('uniq_claim_key')`,
   `dropIndex('ttl_lease')`, y reiniciar los workers que sigan con la versión nueva (R10).

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`]. Fila del plan.** En cualquier opción, si se aplica, llega a staging por el CD
  normal de `main`, sin despliegue propio; la 11.6 comprueba ese despliegue.
  - (a) **Fila ejecutable «tras `worker-data-hygiene`»**: la 0.1 mueve la fila de `openspec-changes.yaml` justo después
    de `worker-data-hygiene` y antes de `golden-sets-reales`, y añade la fila en `docs/design-v0.2.md` §6, sin
    renumerar y sin excepción a ADR-048. *Argumento:* aprovecha capacidad ociosa mientras la 36 espera uso real.
    *Costo:* unas 42 tareas de backend e infra (45 con el grupo 0) sin valor visible hasta que se escale.
  - (b) **Candidato con disparador** —**recomendación de reflect (iteración 1)**: el valor para el usuario es nulo
    hasta escalar y la spec ya queda escrita—. La 0.1 **saca la fila de `openspec-changes.yaml`** como fila ejecutable
    (para que `/lv:new next` y `scripts/autopilot.sh` no la tomen) y la anota en `docs/design-v0.2.md` §6 como
    **candidata** con su disparador «antes del primer `--scale worker=2`», como `web-english-locale` (fila 37: «No está
    en `openspec-changes.yaml` a propósito»). El directorio del change queda en `openspec/changes/`. *Costo:* la regla de
    no escalar sigue vigente sin fecha y el diseño puede envejecer contra el código (la 0.3 lo vuelve a comprobar).
  - (c) Fila ejecutable después de la 36: la 0.1 la mueve detrás de `golden-sets-reales` en el manifiesto y en §6.
    *Costo:* el de (b), acotado.
  - La respuesta se anota aquí en una línea que empieza por «Respuesta del owner (Q1), AAAA-MM-DD:» y en ADR-061 §6
    con «Respuesta del owner (Q1 de `worker-claims-multi-replica`), AAAA-MM-DD:» (ADR-061 ya tiene la Q1 de
    `worker-data-hygiene`). Q2-Q4 se anotan aquí con la misma forma.
- **Q2 [no bloqueante]. Inventario de crons y digest con dos réplicas (D8).**
  - (a) **Incluirlo** (grupo 9 de tareas y el requirement «Cada cron del worker declara qué lo protege con varias
    réplicas») —**recomendación**: convierte «se puede escalar» en algo comprobado para los cuatro crons; dos tareas sin
    código de producción—.
  - (b) Alcance estricto de `776e12a`: quitar el grupo 9 y ese requirement en la 0.1.
- **Q3 [no bloqueante]. Copia del ledger en `api`.** `MongoNotificationDeliveryRepository.claim`/`markCompleted`/
  `markFailed` tienen la toma vencida sin condición y ningún llamador (solo se usa `deleteByUserId`).
  - (a) **Fuera**, anotado como candidato de limpieza de `notifications` en `api` (tarea 10.4) —**recomendación**,
    mantenida en la iteración 1 (B9): no hay defecto observable y tocar `api` amplía el change a otro proceso—.
  - (b) Aplicar aquí la misma condición de D7.
  - (c) Borrar aquí los tres métodos sin uso del puerto de `api`.
- **Q4 [no bloqueante]. Comentario `--scale worker=2` de `docker-compose.prod.yml`.**
  - (a) **Este change lo ajusta en su cierre** (solo el comentario del servicio `worker`, texto de D9), sobre el que
    deje 35c —**recomendación**: un comentario no cambia el despliegue y deja una sola regla en los dos sitios—.
  - (b) Dejarlo al siguiente change de despliegue; el README manda mientras tanto.

## Debate iteración 1 (2026-11-04)

Critic: P0 0, P1 C1 y C2-C19. Business: V0 0, B1-B9. Reflect: la sesión principal.

| id | decisión | motivo |
|---|---|---|
| C1 | aceptado: compuerta en `MongoLeaseClaims.take` (`ensure` de un solo vuelo, cacheado abierto; `null` si cerrada); scheduler conserva `warn` y salto; spec «Ninguna toma…»; test 1.4 con falsación y escenario de la cascada desde el enriquecimiento (7.2) | la cascada de ASN desde `enrich-link` → `close-job-link` → `expire-applications` tomaba sin compuerta e insertaba un duplicado que «ganaba», aun con un worker |
| C2 | aceptado: la guardia quita comentarios antes de buscar (D8, 9.1) | `group-digest.scheduler.ts:12` menciona `@Cron(` en un JSDoc |
| C3 | aceptado: inventario fichero → número de declaraciones; segunda falsación en un fichero ya inventariado (9.1) | por fichero no veía un cron extra en un fichero conocido |
| C4 | aceptado: patrones `@Interval(`, `@Timeout(`, `addInterval(`, `addTimeout(`, `repeat:`, `upsertJobScheduler(` (D8, spec) | había formas de programar trabajo que la guardia no veía |
| C5 | aceptado (= B2): R6 y D9 dicen «sin documentos duplicados; con versiones mezcladas puede repetirse un aviso»; README con chequeo de `ps`/`images` antes de `--scale … --no-recreate` (10.2) | el texto prometía más de lo que da una réplica vieja |
| C6 | aceptado: el setup de 9.2 crea el índice único de `notification_deliveries` con comentario a su esquema de `api` | el worker no declara ese índice; sin él la prueba no prueba |
| C7 | aceptado: 4.5 «boots and closes the gate when MongoDB is unreachable», bootstrap real, conexión perezosa a un puerto sin servidor, `bufferTimeoutMS` bajo | el doble no probaba el búfer de Mongoose real |
| C8 | aceptado: dobles de `migrate` con promesa diferida; módulo de testing sin adaptador HTTP (4.4) | `setImmediate` como reloj era frágil y el HTTP sobraba |
| C9 | aceptado: el test tautológico de la antigua 4.4 se sustituye por el de C1 (1.4) | afirmaba algo que ningún código podía romper |
| C10 | aceptado: unirse a un vuelo en curso cuenta como el intento (D6), test en 4.2 | evitaba dobles migraciones por tick, sin definir |
| C11 | aceptado: `ClaimsModule` estático `@Global()`, importado una vez en `AppModule`; test de misma instancia (4.4) | dos instancias tendrían compuertas distintas |
| C12 | aceptado: RUNBOOK, reiniciar los workers tras `dropIndex` o restauración (10.1, R10) | la compuerta queda cacheada abierta |
| C13 | aceptado: 1.1, 3.3, 4.2 y 8.6 partidas (8.6 combinada con B6) | tareas de más de una hora |
| C14 | aceptado: `_id` explícitos en los fixtures donde el orden importa (D11, 3.2) | el `ObjectId` puede no ordenar como se inserta |
| C15 | aceptado: en modo lease, el paso 1 normaliza `confirmed: true` → `false` con `leaseUntil: now` (D6, 3.1) | una frescura confirmada heredada quedaba fuera del TTL y bloqueando |
| C16 | aceptado: 10.3 verifica con `grep` el texto nuevo del comentario, en inglés | «solo comentarios» no comprobaba qué decía |
| C17 | aceptado: 11.7 cambia también la línea «Precisión propuesta por…» de ADR-061 §4 | quedaba «propuesta» tras archivar |
| C18 | aceptado: 10.4 anota en `openspec-changes.yaml` el candidato de limpieza de `api` | Q3 (a) sin rastro se pierde |
| C19 | aceptado: documento ausente en la relectura → `already_done` (D7, spec, 6.1) | caso no definido tras un borrado de cuenta |
| C-prec | aceptado: el búfer de Mongoose falla a los `bufferTimeoutMS` (10 s); los 30 s son la selección de servidor (Context, D6) | cifra mal atribuida |
| C-Q1 | aceptado: Q1 aclara que va por el CD normal | «sin despliegue propio» chocaba con la 11.6 |
| B1 | aceptado: cada opción de Q1 dice qué pasa con la fila; recomendación de reflect (b), precedente `web-english-locale` | el owner decide viendo el efecto en el manifiesto |
| B2 | aceptado (= C5) | — |
| B3 | aceptado: línea fija `claims migration complete` (spec, 3.4, 11.3) y los dos chequeos en el README (10.2) | escalar necesita una condición comprobable |
| B4 | aceptado: `warn` estable `claims gate closed` (spec, 3.4, 4.2); `grep` exacto en el RUNBOOK, usado en 11.6 | un mensaje variable no se puede buscar |
| B5 | aceptado: la toma escribe `holder` (`os.hostname()`); RUNBOOK con la consulta de tomas vivas (D2, 1.2, 10.1) | diagnosticar qué réplica tiene una toma |
| B6 | aceptado: 8.6 reducida a «a new replica takes a key last written by a legacy writer after its lease» | el adaptador heredado completo costaba más de lo que probaba |
| B7 | aceptado: RUNBOOK con salida esperada de `getIndexes()`, agregación de duplicados y tabla causa → acción por `codeName` (10.1) | el operador no tenía qué comparar |
| B8 | aceptado: la cifra pasa a «unas 42 tareas de backend e infra (45 con el grupo 0)» (Q1) | la cifra anterior era vieja |
| B9 | rechazo de business mantenido: Q3 sigue con recomendación (a) | — |

Convergencia: pendiente de la iteración 2.
