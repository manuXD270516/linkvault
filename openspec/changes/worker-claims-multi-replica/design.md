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
  operación de Mongo esperada en `onModuleInit` con Mongo caído queda en el búfer de Mongoose hasta `bufferTimeoutMS` y
  la selección de servidor (30 s por defecto): el `app.init()` no termina y el puerto de salud no abre. El test
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
update = { $set: { claimedAt: now, leaseUntil: new Date(now + leaseMs), token, confirmed: false } };
```

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

### D6. Migración e índices sin bloquear el arranque; la compuerta nace cerrada *(precisa ADR-061 §4 y D7 de `776e12a`)*

`ClaimIndexesBootstrap` (plataforma del worker) con `ensure(collection): Promise<boolean>` **de un solo vuelo** por
colección (una llamada en curso se comparte; resuelta abierta, no se repite) y `ClaimIndexesGate` por colección, que
**nace cerrada**. `migrate(collection)`, el cuerpo de `ensure`, es el de `776e12a` D7:

1. **Completar heredados**: `updateMany({ leaseUntil: { $exists: false }, confirmed: { $ne: true } }, [{ $set:
   { confirmed: false, leaseUntil: { $add: [{ $ifNull: ['$claimedAt', now] }, leaseMs] } } }])`.
2. **Quitar duplicados**: agregación con `maxTimeMS` que agrupa por clave con más de un documento y conserva el
   confirmado, después el de `claimedAt` más reciente, después el de `_id` menor; borra el resto por `_id`. Dos réplicas
   calculan el mismo superviviente. Nunca se pierde un «ya se avisó».
3. **Crear** con un `createIndex` por índice, **`ttl_lease` primero** y `uniq_claim_key` después.
4. **Comprobar** con `listIndexes` que la clave única existe con `unique: true` y la clave esperada; si sí, abre la
   compuerta.

Si 3 falla con `E11000` (un escritor heredado insertó un duplicado entre 2 y 3), se repiten 2-4 hasta tres veces.
**`migrate` nunca lanza**: cualquier otro error se captura, deja la compuerta cerrada y registra un `warn` con la
colección y `code`/`codeName`, sin documentos ni claves.

**Lo nuevo respecto de `776e12a`: cuándo corre.** `776e12a` la esperaba en `onModuleInit` y apoyaba el «antes del
primer tick» en que los crons se montan en `onApplicationBootstrap`. Con la conexión perezosa y Mongo caído, ese
`await` deja `app.init()` colgado hasta que Mongoose agota el búfer y la selección de servidor, y el worker no sirve su
liveness: rompe «Arranque independiente de las dependencias», y ningún test de hoy lo vería (el de arranque sin
dependencias corre en `test`, sin schedulers). Por eso:

- `ClaimIndexesBootstrap.onApplicationBootstrap()` lanza `ensure` de las tres colecciones **sin esperarlo** (`void`, con
  el error ya capturado dentro de `migrate`). El arranque termina enseguida.
- **El «antes del primer tick» lo garantiza la compuerta, no el orden del ciclo de vida.** Cada scheduler, al empezar su
  tick, hace `await bootstrap.ensure(c)` de sus colecciones (`StaleApplicationsScheduler`: `application_stale_claims`;
  `LinkFreshnessScheduler`: `link_freshness_claims` **y** `application_status_group_notify_claims`, H6). Si la migración
  de arranque sigue en curso, la espera (un solo vuelo); si terminó cerrada, la reintenta una vez; si al final alguna
  está cerrada, `warn` con el nombre de la colección y se salta el tick. Un detector nunca toma una marca sin el índice
  único de su colección.
- El módulo de marcas solo se registra cuando los consumidores están habilitados (`NODE_ENV !== 'test'`), como los
  schedulers; así `startup-without-dependencies.spec.ts` no cambia.
- El apagado no espera a una migración en curso: `MongoInitialConnectRetry.beforeApplicationShutdown` ya cierra el
  cliente si la conexión sigue pendiente, y una operación abortada cae en el `catch` de `migrate`.

El resto del worker (enriquecimiento, CV, match, búsqueda, avisos) no consulta compuertas.

*Descartado:* esperar la migración en `onModuleInit` (bloquea el arranque con Mongo caído, arriba); esperar al evento
`connected` de la conexión antes de lanzarla (añade un camino propio de reconexión que `ensure` en cada tick ya cubre);
esquemas de Mongoose con `autoIndex` (un índice único que falla por duplicados lo hace en silencio); una migración
manual por `mongosh`; que el worker no arranque; `createIndexes` de los dos índices a la vez.

### D7. La toma vencida del ledger es de uno solo

`MongoNotifyDeliveryLedger.claim`, rama de toma vencida: `updateOne({ ...filter, status: 'claimed', claimedAt:
existing.claimedAt }, ...)` y `'claimed'` solo con `modifiedCount === 1`; si no, se vuelve a leer una vez y se responde
según el estado nuevo (`in_flight` o `already_done`). Entre la lectura y la retoma, un método `protected async
beforeRetake(): Promise<void>` vacío es el punto de inyección del test (H8). Con la entrega en vuelo de la parte A
(§5b), el perdedor que obtiene `in_flight` aplaza su job y en la vuelta encuentra `already_done`: nadie envía dos veces y
nadie pierde el aviso.

La copia de `api` (`MongoNotificationDeliveryRepository.claim`) tiene el mismo defecto pero ningún llamador; queda
fuera (Q3).

### D8. Inventario de crons con varias réplicas *(Q2; con Q2 = (b) sale)*

Las marcas cubren tres de los cuatro crons del worker. Los otros dos ya son seguros por otro mecanismo, y este change
lo deja escrito y vigilado en vez de suponerlo:

| Cron | Fichero | Mecanismo con N réplicas |
|---|---|---|
| frescura (`EVERY_HOUR`) | `freshness/infrastructure/queue/link-freshness.scheduler.ts` | marcas `link_freshness_claims` + ASN (D2-D6) |
| stale (`EVERY_HOUR`) | `notifications/infrastructure/queue/stale-applications.scheduler.ts` | marcas `application_stale_claims` (D2-D6) |
| digest semanal (`GROUP_DIGEST_CRON`) | `notifications/notifications.module.ts` (host dinámico) | job raíz de un solo vuelo (`digest:week:{weekKey}`) + ledger por entrega (D7) + entrega en vuelo (§5b) |
| barrido de snapshots (diario) | `enrichment/infrastructure/schedule/snapshot-sweep.scheduler.ts` | caso de uso idempotente (`cv/documents`, «Dos réplicas barren a la vez») |

- **Guardia**: `apps/worker/src/app/worker-crons.inventory.spec.ts` recorre los `.ts` no `spec` de `apps/worker/src`,
  busca `@Cron(` y compara el conjunto de ficheros con una tabla exportada del propio test (fichero → mecanismo). Falla
  nombrando el fichero que sobra o el que falta. Es un test de Vitest del proyecto `worker`, así que su caché de Nx
  depende de los fuentes del worker, que es justo lo que inspecciona.
- **Digest con dos réplicas**: si los dos crons encolan la misma `weekKey` y el primer job ya terminó y se borró, corre
  un segundo; el ledger responde `already_done` (o `in_flight` y aplaza). Un test de integración con dos
  `ProcessGroupWeeklyDigest` y dos conexiones lo fija (tarea 9.2).

*Descartado:* un lint o un `grep` en `repo-checks` (más frágil ante el host dinámico del digest y fuera del proyecto
que lo usa); marcas también para el digest (duplicaría lo que el ledger ya garantiza).

### D9. Levantar la regla de no escalar `worker`

La regla existe porque escalar sin este change duplica avisos. Al archivar:

- `infra/README.md`, bajo «Escalar worker»: la línea «No escalar `worker` hasta archivar `worker-claims-multi-replica`;
  ADR-061 §6» pasa a «Escalar `worker` solo cuando todas las réplicas corran una imagen que incluya
  `worker-claims-multi-replica` (ADR-061 §2-§4); el primer arranque migra los índices de las marcas: comprobarlo antes
  de escalar (RUNBOOK)». Archivar no es desplegar: la condición es la imagen, no el archivo.
- Con versiones mezcladas durante un despliegue escalado (R6) no hay duplicados una vez creado `uniq_claim_key`, así que
  la condición se refiere a escalar a propósito, no a la recreación de contenedores.
- `docker-compose.prod.yml`, comentario del servicio `worker`: Q4.
- ADR-061 §6 «Para 35c»: la regla queda como histórica con una anotación de una línea (tarea 11.7).

### D10. Encaje: después de `worker-data-hygiene`, con fila del owner

Disparador del owner: «antes del primer `--scale worker=2`». Hoy no hay host de producción ni plan de escalar staging,
así que no hay urgencia técnica; el costo de no tener fila es el de B12 de `worker-data-hygiene`: la regla de no escalar
queda vigente sin fecha. Q1 pide la fila. Precondición dura en cualquier caso: `worker-data-hygiene` archivado (0.3).
No hay excepción a ADR-048 que pedir: la fila 35 termina antes que `worker-data-hygiene`.

### D11. Cómo se prueba la concurrencia

- Integración con el `MongoMemoryReplSet` del preset de `@linkvault/testing` (`getMongoTestUri()`), una base por
  fichero. «Dos réplicas» = **dos conexiones de Mongoose distintas** (`mongoose.createConnection` dos veces sobre la
  misma URI y base), cada una con su adaptador o caso de uso.
- **Sin esperas fijas.** Las carreras se fijan de dos maneras: (a) propiedades que valen para cualquier intercalado
  (`Promise.all` de dos tomas → exactamente una gana, un documento por clave), repetidas 50 rondas; (b) intercalados
  forzados con puntos de inyección (`beforeRetake` del ledger, dobles cuya promesa resuelve el test). Las falsaciones de
  las carreras son **secuenciales** (H8): sin `uniq_claim_key`, A toma y luego B toma la misma clave.
- Los tests del monitor TTL arrancan su propio `MongoMemoryServer` con `ttlMonitorSleepSecs=1` y sondean cada 250 ms con
  tope de 10 s un **centinela** que tiene que desaparecer antes de afirmar que algo no desapareció (H9). Si
  `worker-data-hygiene` dejó un helper para su `outbox-ttl.spec.ts`, se reutiliza; es un `api` distinto, así que lo
  normal es copiar las cuatro líneas de arranque.
- Las pruebas de arranque y de compuerta usan dobles cuya promesa controla el test, y `setImmediate` para observar el
  orden; ningún `setTimeout` con milisegundos.

## Risks / Trade-offs

- **R1. `E11000` como «no tomada»**: si otro índice único fallara, se leería como ocupada. Mitigación: las colecciones
  solo tienen `_id`, `uniq_claim_key` y `ttl_lease`; el adaptador comprueba que el `keyPattern` del error es la clave y
  relanza cualquier otro (test con un índice único extra).
- **R2. Compuerta cerrada en silencio prolongado**: si la migración no converge, stale, ASN y frescura no corren.
  Mitigación: un `warn` por tick con la colección y el código; RUNBOOK con la consulta de índices y qué hacer.
- **R3. Primer tick tras un arranque con Mongo caído** *(nuevo, por D6)*: el tick espera la migración dentro de su
  propio tiempo; con Mongo todavía caído, el `ensure` falla tras el búfer de Mongoose y el tick se salta con un `warn`.
  Es el comportamiento querido (sin índice no se toma), con un `warn` por hora hasta que vuelva Mongo.
- **R4. `listEligible` y `listCascadePending` con `uniq_claim_key`**: el `$lookup` de la parte A pasa a usar el índice;
  no cambia su resultado. Lo cubren los tests de la parte A, que siguen en verde (7.3).
- **R5. Dos réplicas migrando a la vez**: las dos calculan el mismo superviviente y `createIndex` es idempotente; lo fija
  la 3.4.
- **R6. Despliegue escalado con versiones mezcladas**: una réplica vieja hace upsert por igualdad de clave; con el índice
  único Mongo lo reintenta sin duplicar, y la rama heredada del filtro evita que bloquee a las nuevas. Una confirmación
  vieja sobre una toma nueva deja un `leaseUntil` pasado en una confirmada: el filtro parcial la deja fuera del TTL. Lo
  cubren tests con un escritor heredado (8.6).
- **R7. Vuelta atrás** con el ledger: la versión anterior retoma sin condición, como hoy; no rompe nada que hoy funcione.
- **R8. El inventario de crons como guardia textual** *(D8)*: un cron declarado de forma que el patrón `@Cron(` no vea
  (por ejemplo, registrado con `SchedulerRegistry.addCronJob`) se escaparía. Mitigación: el test busca también
  `addCronJob(`; hoy no hay ninguno.

## Migration Plan

1. **Apply y CI**: todo con `mongodb-memory-server` (replset del preset), incluidas la migración de heredados con
   duplicados, dos réplicas migrando y la prueba de dos réplicas por cada detector y por el digest.
2. **Despliegue** (con un worker): el primer arranque del worker nuevo sirve la liveness enseguida y migra en segundo
   plano; el primer tick de cada detector espera la migración. Sin scripts ni paradas.
3. **Comprobación tras desplegar** (RUNBOOK): `getIndexes()` de las tres colecciones con `uniq_claim_key` y `ttl_lease`
   (con su filtro parcial) y ningún `warn` de compuerta en el log del worker tras el primer tick.
4. **Escalar**: solo después de 3, con todas las réplicas en la imagen nueva (D9).
5. **Vuelta atrás**: revertir el código. Los índices no estorban a la versión anterior: con el único, su upsert por
   igualdad se reintenta sin error; con `ttl_lease` parcial, sus tomas sin `leaseUntil` no caducan, las que dejó el
   código nuevo caducan como abandonadas y las confirmadas quedan fuera. **Antes de revertir, volver a un worker** (la
   versión anterior duplica avisos con dos). Si hiciera falta quitarlos: `dropIndex('uniq_claim_key')`,
   `dropIndex('ttl_lease')`.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`]. Fila del plan.**
  - (a) **Fila «tras `worker-data-hygiene`»** en `docs/design-v0.2.md` §6, justo después de ella y antes de la 36
    (`golden-sets-reales`), sin renumerar y sin excepción a ADR-048 —**recomendación**: cierra B12 (la regla de no
    escalar deja de ser indefinida), son unas 30 tareas de backend sin despliegue propio y la 36 depende de uso real, que
    lleva semanas igual—.
  - (b) **Seguir candidato sin fila** y aplicar solo cuando se planifique el primer `--scale worker=2`. *Costo:* la regla
    de no escalar sigue sin fecha y el diseño envejece contra el código.
  - (c) Fila después de la 36. *Costo:* el de (b), acotado.
  - La respuesta se anota aquí en una línea que empieza por «Respuesta del owner (Q1), AAAA-MM-DD:» y en ADR-061 §6
    con «Respuesta del owner (Q1 de `worker-claims-multi-replica`), AAAA-MM-DD:» (ADR-061 ya tiene la Q1 de
    `worker-data-hygiene`). Q2-Q4 se anotan aquí con la misma forma.
- **Q2 [no bloqueante]. Inventario de crons y digest con dos réplicas (D8).**
  - (a) **Incluirlo** (grupo 9 de tareas y el requirement «Cada cron del worker declara qué lo protege con varias
    réplicas») —**recomendación**: es lo que convierte «se puede escalar» en algo comprobado para los cuatro crons, no
    solo para tres; dos tareas sin código de producción—.
  - (b) Alcance estricto de `776e12a`: quitar el grupo 9 y ese requirement en la 0.1.
- **Q3 [no bloqueante]. Copia del ledger en `api`.** `MongoNotificationDeliveryRepository.claim`/`markCompleted`/
  `markFailed` tienen la toma vencida sin condición y ningún llamador (solo se usa `deleteByUserId`).
  - (a) **Fuera**, anotado como candidato de limpieza de `notifications` en `api` —**recomendación**: no hay defecto
    observable y tocar `api` amplía el change a otro proceso—.
  - (b) Aplicar aquí la misma condición de D7.
  - (c) Borrar aquí los tres métodos sin uso del puerto de `api`.
- **Q4 [no bloqueante]. Comentario `--scale worker=2` de `docker-compose.prod.yml`.**
  - (a) **Este change lo ajusta en su cierre** (solo el comentario del servicio `worker`), sobre el texto que deje 35c,
    para que diga la misma condición que `infra/README.md` (D9) —**recomendación**: un comentario no cambia el despliegue
    y deja una sola regla en los dos sitios—.
  - (b) Dejarlo al siguiente change de despliegue; el README manda mientras tanto.

## Debate

Pendiente: lo orquesta la sesión principal con `/lv:debate` (critic, business; la sesión principal como reflect). El
diseño de D2-D5, D7 y la mayor parte de D6 ya convergió en `worker-data-hygiene` (iteraciones 1-3 y verificación de
N1); lo nuevo a debatir es D6 (cuándo corre la migración), D8, D9, D10 y Q1-Q4.
