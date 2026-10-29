## Context

Estado de `main` en `5b92d28` (2026-10-28):

- **Outbox** (`apps/api/src/infrastructure/outbox/`, ADR-009, D6 de `job-links`). Tres estados explícitos: pendiente
  (`publishedAt` y `failedAt` nulos), publicado (`publishedAt` con fecha) y agotado (`failedAt` con fecha, tras 24 h sin
  publicar). Un único índice, parcial sobre los pendientes. El relay (`outbox-relay.ts`) solo lee pendientes; marca
  publicado tras la confirmación de la cola. Ningún código ni procedimiento del RUNBOOK lee publicados. Los índices se
  crean por `autoIndex` de Mongoose al compilar el modelo (precedente: los TTL de `auth_sessions`, `refresh_tokens` y
  `auth_email_tokens`). `MongoOutbox` escribe `publishedAt: null` y `failedAt: null` explícitos al insertar.
- **Colas** (`outbox-queues.ts`): `removeOnComplete` a 1 día / 1000, `removeOnFail` a 7 días (`age: 604_800`), para
  todas las colas del outbox. En el worker, las colas propias de frescura y notificaciones usan `removeOnComplete: true`
  (el `jobId` determinista solo deduplica mientras el job espera o corre); `notify-fanout` y `group-digest` no declaran
  `attempts` (uno solo).
- **Marcas del worker**, sin esquema ni índice, sobre `connection.collection(...)`:

  | Colección | Clave | Quién la usa | Qué significa `confirmed` |
  |---|---|---|---|
  | `link_freshness_claims` | `linkId` | `DetectLinkFreshness` (cascada y abiertas) | nada: `confirm` borra el documento |
  | `application_status_group_notify_claims` | `applicationId` + `statusChangedAt` | `ExpireApplicationsForClosedLink`, `listCascadePending`, `listForExpireCascade` | «el ASN de este expire ya se encoló»; bloquea para siempre |
  | `application_stale_claims` | `applicationId` + `statusChangedAt` | `DetectStaleApplications` | «el stale de este `statusChangedAt` ya se encoló»; bloquea para siempre |

  Las tres reclaman igual: `findOne` por clave, decisión en memoria, `updateOne(clave, $set, { upsert: true })`.
  `release` hace `deleteOne({ clave, confirmed: false })`. Los casos de uso leen `now` una vez al principio de la pasada
  y lo pasan a cada `claim`.
- **Crons**: `@Cron(EVERY_HOUR)` en frescura y stale; `@nestjs/schedule` los monta en `onApplicationBootstrap`, después
  de todos los `onModuleInit`. Cada réplica del worker corre los suyos.
- **Ledger de entregas** (`notification_deliveries`): índice único `(type, aggregateKey, userId, channel)` declarado
  en el esquema de `api`; la toma de un `claimed` vencido hace `updateOne` sin condición. Si la entrega está `claimed`
  dentro de su lease de 5 minutos, `claim` responde `in_flight` y los dos consumidores (`ProcessNotifyFanOut`,
  `ProcessGroupWeeklyDigest`) **terminan el job**: si quien la tenía murió, nadie la retoma nunca.
- **Despliegue**: staging con un solo worker (`infra/deploy/deploy.sh`, `up -d --wait` sin `--scale`); Mongo 7.0.43,
  replica set de un nodo; tests con `MongoMemoryReplSet` del preset de `@linkvault/testing`.

Requisitos que mandan: `platform/outbox` (ningún evento se pierde; agotados con aviso), `notifications/stale-applications`
(«Un aviso por estancamiento»), `notifications/dispatch` («Idempotencia de entrega», «Auto-expire de vacante cerrada
sin outbox»: el claim no se borra por estar `expired`), `links/freshness` («Límite por ejecución e idempotencia»: lease,
la marca no queda dura si el encolado falla).

## Goals / Non-Goals

**Goals:** que `outbox_events` tenga un tamaño acotado por el uso vivo; que ninguna entrega de aviso se pierda porque
su toma quedó en vuelo; que stale no deje de ver postulaciones nuevas; que tomar una marca sea correcto con N réplicas
sin depender del `jobId` de BullMQ, y que las tomas abandonadas caduquen; que los datos existentes, con posibles
duplicados, migren solos y sin perder ningún «ya se avisó»; que todo se verifique con `mongodb-memory-server` (replset),
incluida una prueba con dos réplicas.

**Non-Goals:** cambiar qué se notifica o cuándo; retención de `notification_deliveries`; colas de mensajes muertos;
ficheros de despliegue; observabilidad nueva; índices en colecciones de `api` que no sean el outbox; borrar las marcas
confirmadas de stale y ASN cuya clave murió (retirado en el debate, B4: crecen a lo sumo una por aviso emitido).

## Partición (Q5)

El change tiene dos partes que se pueden fusionar por separado; `tasks.md` las ordena así para que partir sea trivial.

| Parte | Decisiones | Specs | Tareas |
|---|---|---|---|
| **A. Lo que ve el usuario** (se queda siempre) | D1, D8 (Q3), D9 (stale), D10 (regla de no escalar, B6), D11, Q2 | `platform/outbox`, `notifications/stale-applications`, `notifications/dispatch` «Una entrega en vuelo se reintenta…» y «Auto-expire de vacante cerrada sin outbox» (MODIFIED, B7) | grupos 1-6 |
| **B. Marcas atómicas multi-réplica** (sale si Q5 = (a)) | D2-D5, D7, D9 (ledger) | `platform/worker-claims`, `notifications/dispatch` «Toma única de una entrega vencida» | grupos 7-11 |

Con Q5 = (a), la parte B pasa a un change posterior (nombre propuesto `worker-claims-multi-replica`, en el manifiesto),
disparado por «antes del primer `--scale worker=2`», que se lleva sus specs, sus grupos de tareas y ADR-061 §2-§4. La
parte A no depende de B: el `$lookup` de D9 y de Q2 a las marcas confirmadas funciona sin `uniq_claim_key` (escanea la
colección de marcas, que a esta escala son decenas o cientos de documentos) y B lo indexa después.

## Decisions

### D1. Los eventos publicados se borran a los 8 días; los pendientes y los agotados, nunca

Índice TTL en `outbox-event.schemas.ts`:

```ts
export const OUTBOX_PUBLISHED_RETENTION_S = 691_200; // 8 días

outboxEventSchema.index(
  { publishedAt: 1 },
  {
    name: 'ttl_published',
    expireAfterSeconds: OUTBOX_PUBLISHED_RETENTION_S,
    partialFilterExpression: { publishedAt: { $type: 'date' } },
  },
);
```

- **Por qué no se pierde nada vivo**: el TTL de Mongo solo borra documentos cuyo campo indexado es una fecha; un
  pendiente o un agotado tiene `publishedAt: null`. **Esa es la protección**; el filtro parcial solo achica el índice
  (deja fuera a pendientes y agotados) y no protege nada por sí mismo: si un código escribiera `publishedAt` con fecha en
  un agotado, el TTL lo borraría igual. Por eso la falsación de 1.3 es justamente esa (`markFailed` escribe
  `publishedAt: now`) y no quitar el filtro. Ningún código pasa un evento de publicado a pendiente.
- **Por qué 8 días** (H1): un publicado solo sirve para diagnosticar —correlacionar un job con su evento (`createdAt`,
  `attempts`, `type`)—. El job fallido vive 7 días en Redis (`removeOnFail.age`); mientras exista, su evento también, y
  con un día de margen, para que el monitor TTL (cada 60 s) y la limpieza de BullMQ (perezosa, al completar o fallar
  otro job) no se crucen en el borde. Un test fija que `OUTBOX_PUBLISHED_RETENTION_S >= removeOnFail.age + 86_400` para
  todas las colas de `OUTBOX_QUEUES` (`outboxJobOptionsFor`), para que no se separen sin que nadie lo note.
- **Agotados**: se quedan. Son raros (24 h de fallos seguidos), son el único rastro de trabajo que no llegó a la cola y
  llevan solo identificadores (ADR-009). El RUNBOOK añade la consulta para listarlos.
- **Primera pasada**: al crear el índice, el monitor TTL borra en tandas todos los publicados de más de 8 días. En
  staging es trivial; en un volumen grande la carga se reparte sola entre pasadas.
- La idempotencia no cambia: un evento borrado ya estaba publicado y el relay nunca lo volvería a tomar; «Evento
  republicado tras la retención» de `platform/outbox` sigue siendo responsabilidad del consumidor.

*Descartado:* barrido programado en el relay (más código para lo que Mongo hace solo, y correría en cada réplica de
`api`); TTL de 24 h (deja jobs fallidos sin su evento durante 6 días); retención igual a `removeOnFail` (7 días: sin
margen en el borde); retención de meses (sin uso que la pida); TTL también sobre `failedAt` (perdería el rastro que
`platform/outbox` exige conservar).

### D2. Una marca es un documento por clave con índice único, y tomarla es una sola operación *(parte B)*

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
// frescura: el mismo filtro y la misma escritura, `confirmed: false` incluido (D5, H4)
```

- **Libre o vencida** → el filtro casa, se actualiza y la réplica gana.
- **No existe** → `upsert` inserta (copia la clave y `confirmed: false` del filtro) y la réplica gana.
- **Ocupada o confirmada** → el filtro no casa, `upsert` intenta insertar y el índice único lo rechaza con `E11000`:
  el adaptador lo traduce a «no tomada». Mongo **no** reintenta este `upsert` por su cuenta, porque el filtro no es solo
  igualdades sobre la clave del índice; los tests lo fijan («reports an occupied claim as not taken, not as an error»).
- **Dos réplicas a la vez**: dos inserciones de la misma clave → una gana y la otra recibe `E11000`; dos tomas del
  mismo documento vencido → `findOneAndUpdate` es atómico por documento, la segunda ya no casa y cae en `E11000`.
- **El instante es el de la toma** (H5): el adaptador lee su reloj inyectado en cada `take`, `confirm` y `release`; el
  `now` de principio de pasada que reciben hoy los puertos desaparece de su firma. Si no, una pasada lenta que toma su
  marca número 50 minutos después de empezar la escribe con un `leaseUntil` ya vencido y otra réplica la retoma en
  seguida.
- **Sin sesión** (sugerencia del critic): el puerto de toma no recibe ni usa una sesión de transacción. La toma es una
  operación atómica de un documento y no forma parte de ninguna transacción del caso de uso; meterla en una haría que
  un `E11000` abortara la transacción entera.

*Descartado:* mantener «leer y después upsert» y confiar en el `jobId` (con `removeOnComplete: true` en las colas del
worker, el primer job puede haber terminado y desaparecido antes del segundo `add`); un lock distribuido por tick en
Redis o Mongo (serializa réplicas enteras en vez de claves, y su vencimiento tiene los mismos problemas); elegir una
sola réplica «líder» para los crons (otra pieza de coordinación para un problema que una clave única resuelve).

### D3. Cada toma lleva un testigo; `release` solo borra la propia *(parte B)*

La toma genera `token = randomUUID()` y el puerto devuelve `ClaimLease { token } | null` en vez de `boolean`.

- `release(lease)` = `deleteOne({ ...key, token, confirmed: false })`. Hoy, si la toma de A venció, B la tomó y A falla
  después, el `release` de A borra la de B y una tercera pasada puede encolar de nuevo.
- `confirm` de stale y ASN = `updateOne({ ...key }, { $set: { confirmed: true, confirmedAt: now }, $unset: { leaseUntil:
  '', token: '' } }, { upsert: true })`, **sin** condicionar al testigo y **con `upsert`** (H3). El filtro es solo de
  igualdad sobre la clave única, así que Mongo reintenta el `upsert` si choca con otra inserción y no crea duplicados.
  Casos: si A encoló, el aviso existe aunque su toma haya vencido; al quitar el testigo, el `release` posterior de B no
  casa y no borra la marca duradera; y si B **ya** liberó (borró) antes de que A confirme, el `upsert` vuelve a crear la
  marca confirmada en vez de no hacer nada y dejar el aviso sin registro.
- `confirm` de frescura = `updateOne({ linkId, token }, { $set: { leaseUntil: now + FRESHNESS_CONFIRMED_HOLD_MS } })`
  (D4), sin `upsert`: si la toma ya no es suya, perder la retención solo reabre la ventana del mismo tick.
- Ni `confirm` ni `release` reciben sesión (D2).

Los puertos (`FreshnessLinkClaims`, `StatusGroupNotifyClaims`, `ApplicationStaleClaims`) viven en `application/ports`,
no en `domain/`. Cambian sus firmas, sus dobles en memoria y los tres casos de uso; la lógica de los casos de uso no
cambia. `isConfirmed` de ASN se conserva.

*Descartado:* condicionar `release` al `claimedAt` leído (dos réplicas pueden escribir el mismo `now` en milisegundos;
un testigo aleatorio no colisiona); `confirm` sin `upsert` (pierde el registro en la secuencia «B libera, A confirma»).

### D4. La marca de frescura es solo un lease, con una retención corta tras confirmar *(parte B)*

Cierra el comentario de `mongo-freshness.adapters.ts:210-220`: en frescura `confirmed` no significa nada y queda
siempre en `false` (se escribe explícito en cada toma, para el filtro parcial de D5). Lo que importa es que, en **el
mismo tick**, otra réplica no vuelva a procesar un link que esta acaba de terminar (su selector se leyó antes del
efecto). Hoy `confirm` borra el documento y deja esa ventana abierta.

- `confirm` deja la marca con `leaseUntil = now + FRESHNESS_CONFIRMED_HOLD_MS` (30 minutos, menor que el periodo del
  cron de 1 h): el siguiente tick puede reclamar, el mismo tick en otra réplica no.
- `release` (fallo) borra la propia y deja el link reclamable enseguida, como pide «Reclamación con lease».
- La elegibilidad sigue siendo la de los selectores (`lastFreshnessCheckAt`, `expiresAt`, cascada).

*Descartado:* borrar en `confirm` (la ventana de arriba); una marca duradera por cubeta de cadencia (duplica lo que ya
dice `lastFreshnessCheckAt`).

### D5. Caducidad: TTL sobre `leaseUntil`, solo para las no confirmadas *(parte B)*

En las tres colecciones, índice TTL `{ leaseUntil: 1 }`, `expireAfterSeconds: 86_400`, nombre `ttl_lease`, con
`partialFilterExpression: { confirmed: false }` (H4).

- Una toma abandonada (réplica muerta entre `claim` y `confirm`/`release`) se borra un día después de vencer. Borrar
  una marca no confirmada y vencida equivale a lo que ya permite la toma: cualquier pasada podía reclamarla.
- Una marca de frescura confirmada (que sigue con `confirmed: false`, D4) se borra 24 h después de su retención: la
  colección queda acotada por los links procesados el último día.
- Una marca confirmada de stale o ASN queda **fuera del índice** por el filtro parcial, lleve o no `leaseUntil`. El
  `$unset` de D3 la deja además sin el campo, pero la protección no depende de él: una réplica de la versión anterior
  que confirma con `$set: { confirmed: true }` sobre una marca que tomó una réplica nueva deja un `leaseUntil` pasado
  en una confirmada, y sin el filtro parcial el monitor la borraría y el aviso se reemitiría.
- Las confirmadas de stale y ASN no caducan nunca. Crecen a lo sumo en una por aviso emitido (stale: una por
  postulación y `statusChangedAt`; ASN: una por postulación expirada): miles en años de uso. El barrido que las borraba
  al morir su clave se retiró en el debate (B4, ver D6).
- **Heredados**: los documentos escritos por la versión anterior no tienen `leaseUntil` ni `token`. El filtro de D2
  los acepta por `claimedAt` (rama `$exists: false`), así que una réplica antigua que siga escribiendo durante un
  despliegue escalado no bloquea a las nuevas; y el arranque (D7) les completa `leaseUntil` (y `confirmed: false` si
  falta) para que el TTL los alcance.

*Descartado:* TTL sobre `claimedAt` (borraría la marca de frescura confirmada según cuándo se tomó, no según su
retención); TTL sin filtro parcial confiando en el `$unset` (una escritura heredada o un error futuro que deje
`leaseUntil` en una confirmada reemite el aviso); TTL largo sobre las confirmadas (reemite el aviso si la postulación
sigue igual pasado el plazo: contradice «Un aviso por estancamiento»).

### D6. Barrido de las marcas duraderas muertas: retirado (B4)

El barrido diario de las confirmadas de stale y ASN cuya clave murió (`ClaimsSweepScheduler`) sale del change en el
debate (iteración 1, B4): el crecimiento que evita es de una marca por aviso emitido (D5) y su único efecto visible era
el de R5, que solo afecta a Mongo locales sembrados. En su lugar, el RUNBOOK documenta cómo borrar las marcas
huérfanas tras `seed-volume.sh clean` (tarea 5.1). Si algún día el volumen lo pide, el diseño retirado (`$lookup` a
`applications` con `$convert` y `onError: null`, tandas acotadas, `deleteMany` con `confirmed: true`) sirve de
punto de partida.

### D7. Los índices se crean al arrancar, después de migrar, y su ausencia cierra solo a los detectores *(parte B)*

`ClaimIndexesBootstrap` (plataforma del worker), en `onModuleInit` y por colección:

1. **Completar heredados**: `updateMany({ leaseUntil: { $exists: false }, confirmed: { $ne: true } }, [{ $set:
   { confirmed: false, leaseUntil: { $add: [{ $ifNull: ['$claimedAt', now] }, leaseMs] } } }])`.
2. **Quitar duplicados** de forma determinista: agregación (con `maxTimeMS`, H7) que agrupa por clave con más de un
   documento y conserva, por este orden, el confirmado, el de `claimedAt` más reciente y el de `_id` menor; borrar el
   resto por `_id`. Dos réplicas que arrancan a la vez calculan el mismo superviviente y borran lo mismo. **Nunca** se
   pierde un «ya se avisó»: si alguno de los duplicados está confirmado, sobrevive un confirmado.
3. **Crear** los índices con un `createIndex` por índice, **`ttl_lease` primero** y `uniq_claim_key` después (H7): si
   el único no se puede crear, las tomas abandonadas siguen caducando. `createIndex` es idempotente si ya existe con
   las mismas opciones.
4. **Comprobar** con `listIndexes` que la clave única existe con `unique: true` y la clave esperada.

Si el paso 3 falla con `E11000` (una réplica antigua insertó un duplicado entre 2 y 3), se repiten 2-4 hasta tres
veces. **`migrate` nunca lanza** (H7): cualquier otro error (red, permisos, `maxTimeMS` agotado, opciones de índice en
conflicto) se captura, cierra la compuerta de esa colección y registra un `warn` con la colección y el código del error
(`code`/`codeName`), sin documentos ni claves. Así el arranque sin Mongo (`startup-without-dependencies.spec.ts`) sigue
funcionando y un fallo de las marcas no tumba el worker.

Con la compuerta **cerrada**, su scheduler registra un aviso y se salta el tick, y en cada tick vuelve a intentar 1-4
una vez. `LinkFreshnessScheduler` consulta **dos** compuertas (H6): la de `link_freshness_claims` y la de
`application_status_group_notify_claims`, porque su cascada expira postulaciones con `ExpireApplicationsForClosedLink`
y toma marcas de ASN; si cualquiera de las dos está cerrada se salta el tick y el aviso nombra la colección cerrada.
`StaleApplicationsScheduler` consulta la de `application_stale_claims`. El resto del worker (colas de enriquecimiento,
CV, match, búsqueda) sigue: una marca sin índice único es un riesgo de avisos duplicados, no de perder trabajo encolado.

Como los crons se montan en `onApplicationBootstrap`, el arranque termina antes del primer tick.

*Descartado:* esquemas de Mongoose con `autoIndex` (un índice único que falla por duplicados lo hace en silencio, y el
worker seguiría reclamando sin índice); una migración manual por `mongosh` en el RUNBOOK (staging se reconstruye con
volúmenes nuevos y producción la olvidaría); que el worker no arranque (para la cola de enriquecimiento por un problema
de los avisos); `createIndexes` de los dos a la vez (un fallo del único se lleva también el TTL).

### D8. Jobs fallidos de BullMQ: sin cambio de retención; una línea por aviso agotado *(parte A)*

Evaluado, no se cambia la retención. `platform/outbox` («El trabajo encolado no se pierde») exige que el agregado quede
con un estado que explique el fallo: link con motivo, CV con `failed`, análisis con su estado. Ese es el rastro
duradero; el job en Redis es un detalle de 7 días. Los consumidores de `cv`, `enrichment`, `match` y `search` registran
el fallo (`on('failed')`).

El hueco: `notify-fanout` y `group-digest` no registran el fallo y su publicador no reintenta (`removeOnFail: 100` por
cantidad). Un aviso que no se pudo enviar no deja ni línea de log. Con Q3 = (a) (debate, iteración 1), se añade una
línea `warn` por job agotado (cola, `jobId`, nombre del error, sin destinatarios ni correos).

*Descartado:* una colección de jobs fallidos o una cola de mensajes muertos (duplica el estado de los agregados);
alargar `removeOnFail` (Redis no es un almacén de auditoría y compite por memoria en un host de 12 GB).

### D9. Stale elige entre las no avisadas, y la toma vencida del ledger es de uno solo

- *(parte A)* `MongoApplicationStaleClaims.listEligible`: agregación sobre `applications` con `$match` (no cerradas,
  `statusChangedAt <= threshold`), `$sort { statusChangedAt: 1, _id: 1 }`, `$lookup` a `application_stale_claims`,
  `$match` sin marca, `$limit` y `maxTimeMS`. Las avisadas no consumen el lote; la más antigua sin avisar va primero.
  El `$lookup` tiene que comparar un `ObjectId` (`applications._id`) con el `applicationId` de la marca, que es un
  `string`, así que **no** puede ser `localField`/`foreignField` (F4); es la forma con variables:

  ```ts
  {
    $lookup: {
      from: 'application_stale_claims',
      let: { appId: { $toString: '$_id' }, sca: '$statusChangedAt' },
      pipeline: [
        { $match: { $expr: { $and: [
          { $eq: ['$applicationId', '$$appId'] },
          { $eq: ['$statusChangedAt', '$$sca'] },
        ] }, confirmed: true } },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as: 'notified',
    },
  },
  { $match: { notified: { $size: 0 } } },
  ```

  Con `uniq_claim_key` (parte B), el `$expr` con `$eq` sobre los dos campos lo usa; sin él, escanea la colección de
  marcas, que a esta escala son decenas o cientos de documentos. El mismo `$lookup`, contra
  `application_status_group_notify_claims`, es el de Q2 (tareas 4.2). En la cascada de Q2, además, `$group` no
  garantiza orden: `{ $sort: { _id: 1 } }` va justo después del `$group` por `linkId` (N1), así la selección es
  determinista (primero los links más antiguos) y los tests de 4.1 y 4.2, que crean el link L el último, prueban que
  ningún `$limit` aplicado antes de filtrar lo deja afuera.
- *(parte B)* `MongoNotifyDeliveryLedger.claim`, rama de toma vencida: `updateOne({ ...filter, status: 'claimed',
  claimedAt: existing.claimedAt }, ...)` y `'claimed'` solo con `modifiedCount === 1`; si no, se vuelve a leer una vez
  y se responde según el estado nuevo (`in_flight` o `already_done`). Entre la lectura y la retoma, un método
  `protected async beforeRetake(): Promise<void>` vacío es el punto de inyección del test (H8): una subclase de test
  deja que B retome completa mientras A espera, y luego A intenta.

### D10. Encaje: después de la fila 35, sin excepción

Lo que tendría que pasar para que esto afecte a 35b, y por qué no pasa:

| Riesgo | Condición | En 35b |
|---|---|---|
| Avisos duplicados por la toma | dos réplicas del worker a la vez | una réplica; `up -d` sin `--scale`; la recreación para el contenedor viejo antes |
| Toma vencida del ledger | dos procesadores del mismo hecho tras 5 min | un worker; BullMQ da cada job a uno solo |
| Entrega en vuelo perdida | el worker muere entre `claim` y `markCompleted` y BullMQ recupera el job antes de 5 min | posible con un worker, pero raro: exige una caída a mitad de envío |
| Inanición de stale | > 50 postulaciones abiertas, estancadas y avisadas | 14 días de medición: solo se estancan las de los primeros 4 |
| Disco | publicados y marcas | cientos de KB frente a 12 GB |
| Medición | lectura de estas colecciones | `measure`/`uninvited` no las leen |

Adelantarlo cuesta un redespliegue antes de invitar y repetir la 9.4 de `e2e-suite` (ADR-056 §1). Por eso el change es
**candidato posterior a la fila 35** y Q1 pide al owner la fila. Para 35c (B2, B6): no escalar `worker` hasta archivar
este change (o `worker-claims-multi-replica` si Q5 = (a)). La regla queda escrita ya, sin esperar a la 11.7, en el
`scope` de `verify-reusable-workflow` (35c) del manifiesto y en una línea de advertencia bajo «Escalar worker» de
`infra/README.md` (tarea 5.2); el comentario `--scale worker=2` de `docker-compose.prod.yml` es de despliegue y queda
como pendiente para 35c en ADR-061 §6.

### D11. Una entrega en vuelo se reintenta cuando vence su lease *(parte A, B3)*

Hoy, si el worker muere entre `ledger.claim` y `markCompleted`, BullMQ recupera el job estancado (`stalledInterval`,
30 s) y lo vuelve a correr; `claim` responde `in_flight` porque la toma sigue dentro de sus 5 minutos, y el consumidor
termina el job. La entrega queda `claimed` para siempre y el aviso no llega nunca. Pasa también con un solo worker.

- **Adaptador**: `mongo-notify.adapters.ts` exporta `NOTIFY_DELIVERY_LEASE_MS` (hoy `CLAIM_LEASE_MS`, 5 min); `claim`
  no cambia de forma.
- **Casos de uso**: `ProcessNotifyFanOut.execute` deja de devolver `void` y devuelve `{ inFlight: number }`;
  `ProcessGroupWeeklyDigest.execute` amplía lo que ya devuelve a `{ groupsScanned, emailsSent, inFlight }` (F2). Los
  dos cuentan las entregas que encontraron `in_flight` y siguen con las demás como hoy. Ninguna lógica de BullMQ entra
  en `application/`. `deliverChannel` de fan-out lee `this.clock.now()` justo antes de `ledger.claim` y deja de
  recibir `now` (F6): con el `now` del principio del job, una entrega reclamada tras varios envíos lentos nace con un
  lease más corto de lo que dice `NOTIFY_DELIVERY_LEASE_MS` (el digest ya lee el reloj por entrega).
- **El contador se separa antes de validar** (F1): los payloads de los jobs se validan con `z.strictObject`, así que un
  `job.data` con `inFlightDeferrals` haría fallar el parse de siempre en la ejecución aplazada. El helper hace
  `const { inFlightDeferrals, ...payload } = data` (el consumidor le pasa `job.data`, plano como lo publican el relay y
  los productores), valida el contador con `z.number().int().min(0).default(0)` y
  devuelve `payload`, que es lo único que llega a `parseFanOutJob` o a `groupDigestJobPayloadSchema.parse`. Al aplazar,
  `job.updateData({ ...payload, inFlightDeferrals: n + 1 })`.
- **Consumidores** (`notify-fanout.consumer.ts`, `group-digest.consumer.ts`): adoptan el `WorkerHandle` y el
  procesador `(job, token?)` de `enrich-link.consumer.ts` (F2), porque `moveToDelayed` necesita el `token` del lock
  del job. El `WorkerHandle`/`WorkerFactory` es una copia propia del módulo en
  `notifications/infrastructure/queue/worker-factory.ts`, como la de `match` (N4): un módulo no importa la
  infraestructura de otro. Su listener `on('failed')` (D8) ignora `DelayedError`, como `enrich-link.consumer.ts:133`,
  para que un aplazamiento no se registre como aviso agotado. Si `inFlight > 0` y el contador es menor que `NOTIFY_IN_FLIGHT_MAX_DEFERRALS` (3), incrementan el contador
  (`job.updateData`), llaman a `job.moveToDelayed(Date.now() + NOTIFY_DELIVERY_LEASE_MS + 1_000, token)` y lanzan
  `DelayedError` (el patrón de BullMQ para aplazar sin gastar intentos). El job vuelve después de que la toma ajena
  venció: la retoma (`claimed`) o, si quien la tenía terminó, la encuentra `already_done`. Las ya completadas en la
  primera pasada responden `already_done`: el reproceso no reenvía nada.
- **Tope**: con el contador agotado, una línea `warn` con la cola, el `jobId` y el número de entregas en vuelo (sin
  destinatarios ni correos) y el job termina. El tope evita un bucle si otra toma se renueva una y otra vez.

*Descartado:* `attempts` + `backoff` en los publicadores (reintentaría también los fallos de negocio y cuenta intentos
por un estado que no es un error); que el caso de uso lance una excepción para aplazar (mezcla el control de la cola
con el resultado del caso de uso); reducir el lease (no cambia que el job termine sin reintentar).

## Risks / Trade-offs

- **R1. `E11000` como «no tomada»** *(B)*: si otro índice único de la colección fallara por otra razón, se leería como
  ocupada. Mitigación: las colecciones de marcas solo tienen `_id` y `uniq_claim_key`; el adaptador comprueba que el
  error nombra `uniq_claim_key` (`keyPattern`) y relanza cualquier otro.
- **R2. Compuerta cerrada en silencio prolongado** *(B)*: si la migración no converge, los avisos de stale/ASN y la
  frescura no corren. Mitigación: un `warn` por tick con la colección y el código del error; RUNBOOK con la consulta de
  índices.
- **R3. Primera pasada del TTL en un outbox grande** *(A)*: carga de borrado durante unos minutos. Mitigación: Mongo
  borra en tandas; en staging son pocos miles de documentos.
- **R4. `$lookup` de stale sin índice en `applications` por `statusChangedAt`** *(A)*: escaneo de las no cerradas. A la
  escala de 35b es irrelevante; un índice en `applications` es de `api` y queda fuera. `maxTimeMS` acota el peor caso.
- **R5. Semilla de `infra/staging/` y marcas huérfanas** *(A)*: `seed-volume.sh clean` borra postulaciones del lote y
  deja sus marcas; un `seed` posterior recrea los mismos `_id` y `statusChangedAt` (son deterministas), así que una
  marca confirmada huérfana de una corrida anterior suprime el aviso stale del lote. Solo afecta a Mongo locales
  desechables y a avisos, que la medición no cuenta. No se toca la semilla; sin barrido (D6), el RUNBOOK da el borrado
  manual de las huérfanas tras `clean` (tarea 5.1).
- **R6. Despliegue escalado con versiones mezcladas** *(B)*: una réplica vieja hace upsert por igualdad de clave; con
  el índice único, Mongo reintenta ese upsert y no crea duplicados, y la rama heredada del filtro (D5) evita que bloquee
  a las nuevas. Una réplica vieja que confirma con `$set: { confirmed: true }` sobre una toma nueva deja un `leaseUntil`
  pasado en una confirmada: el filtro parcial `{ confirmed: false }` de `ttl_lease` la deja fuera del TTL (H4). Lo
  cubren tests con un escritor heredado.
- **R7. Aplazamiento de una entrega que nunca se libera** *(A)*: si un bug renovara la toma ajena en cada vuelta, el job
  se aplazaría sin fin. Mitigación: tope de 3 aplazamientos y `warn` al agotarlo (D11).

## Migration Plan

1. **Apply y CI**: todo con `mongodb-memory-server` (replset del preset), incluidas la migración de documentos
   heredados con duplicados y la prueba de dos réplicas.
2. **Despliegue**: el primer arranque de `api` crea `ttl_published` (D1); el primer arranque del worker nuevo migra e
   indexa (D7) antes del primer tick. No hace falta parar nada ni correr scripts.
3. **Comprobación tras desplegar** (RUNBOOK): `db.outbox_events.getIndexes()` muestra `ttl_published` y
   `db.outbox_events.countDocuments({ publishedAt: { $lt: <hace 8 días> } })` llega a `0` en unos minutos; con la
   parte B, `getIndexes()` de las tres colecciones de marcas muestra `uniq_claim_key` y `ttl_lease` (con su filtro
   parcial).
4. **Vuelta atrás**: revertir el código. Los índices nuevos no estorban a la versión anterior: con el único, su upsert
   por igualdad se reintenta sin error; con `ttl_lease` (parcial sobre `confirmed: false`), sus tomas sin confirmar sin
   `leaseUntil` no caducan, las que el código nuevo dejó con `leaseUntil` caducan como abandonadas (lo mismo que su
   toma permitía reclamar) y sus confirmadas, lleven o no `leaseUntil`, quedan fuera del TTL; con `ttl_published`, el
   outbox sigue borrando publicados antiguos, que la versión anterior no lee. **Antes de revertir**, esperar a que
   `getDelayedCount()` de `notify-fanout` y de `group-digest` sea `0` (como mucho unos 15 min: tres aplazamientos de
   lease + 1 s): un job aplazado lleva `inFlightDeferrals` en `job.data`, y el consumidor anterior lo valida entero con
   `z.strictObject` y lo rechaza (F3). Si hiciera falta quitarlos: `dropIndex('uniq_claim_key')`,
   `dropIndex('ttl_lease')`, `dropIndex('ttl_published')`.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`]. Fila del plan.**
  - (a) **Candidato posterior a la fila 35**, con fila asignada por el owner en `docs/design-v0.2.md` §6 —recomendación,
    y la sugerencia es justo después de 35c, antes de `golden-sets-reales`, porque la 36 depende de tener uso real y
    este change es lo que mantiene acotado ese uso—. Sin excepción a ADR-048.
  - (b) **Excepción antes de la 10.7 de 35b.** Solo si el owner ve un riesgo que D10 no recoge. Hereda desde el
    principio las reglas de ADR-056 §1: tres clases de fusión (la del change y sus correctivas antes de la 10.7; el PR
    de archivo; las vueltas atrás y su vuelta después, nunca entre el PR-2 de 35b y su 11.6, ni durante sus 9.1-9.4, ni
    los días 7 y 14, ni el día de una corrida `e2e-remote`); confirmación escrita y fechada del owner en cada PR con la
    forma «PR-2 de 35b = #NN; 11.6 hecha el AAAA-MM-DD; 10.7 no hecha; sin `e2e-remote` hoy»; y repetir la 9.4 de
    `e2e-suite` sobre el último commit desplegado antes de invitar. Además rompería la condición de los otros changes
    de excepción («no toca requirements de `platform/*`»): este añade a `platform/outbox` y crea `platform/worker-claims`.
  - La respuesta se anota en ADR-061 en una línea que empieza por «Respuesta del owner (Q1), AAAA-MM-DD:».
- **Q2. Selector de la cascada de frescura.** `MongoFreshnessLinkStore.listCascadePending`
  (`mongo-freshness.adapters.ts`; `listForExpireCascade` es por link y sin límite, no cambia) agrupa `applications`
  por `linkId` con `$limit: 4 × límite` **antes** de filtrar los links cerrados: con más de 200 links con postulaciones
  abiertas (con el límite por defecto), los cerrados pueden no verse nunca y sus postulaciones no expiran. Lo mismo
  pasa con los links cerrados cuyas postulaciones de grupo expiradas ya tienen su ASN confirmada: entran en el `$group`
  y consumen el límite sin tener nada pendiente (F5). (a) Incluirlo aquí: antes de `$group`/`$limit`, excluir las
  expiradas de grupo con ASN confirmada con el `$lookup` de D9 contra `application_status_group_notify_claims`
  (`let: { appId: { $toString: '$_id' }, sca: '$statusChangedAt' }`, `pipeline` con `$expr`/`$eq` y
  `confirmed: true`, F4), después `$group` por `linkId` con `{ $sort: { _id: 1 } }` inmediato (N1), `$lookup` a
  `job_links` filtrando `closedAt` y recién entonces `$limit`; (b) un change propio de frescura.
  **Resuelta en el debate (iteración 1), 2026-10-28: (a)** (voto de business, aceptado por reflect); grupo 4 de tareas.
- **Q3. Rastro de los avisos que no se pudieron enviar.** (a) Una línea `warn` por job agotado en `notify-fanout` y
  `group-digest` (cola, `jobId`, nombre del error; sin destinatarios ni correos); (b) dejarlo como está.
  **Resuelta en el debate (iteración 1), 2026-10-28: (a)**; grupo 4 de tareas.
- **Q4. Rotación de logs del host.** Ningún compose declara `logging:` y el `json-file` por defecto no rota: en 12 GB es
  un riesgo de disco mayor que el outbox. Es un fichero de despliegue. (a) Escribirlo como recomendación para 35b en
  ADR-061 §Consecuencias y que el owner decida si lo traslada a `staging-host`; (b) dejarlo para 35c o para producción.
  **Resuelta en el debate (iteración 1), 2026-10-28: (a)**; ya escrita en ADR-061.
- **Q5 [no bloqueante para el debate; decisión del owner antes de `/opsx:apply`]. Partir el change** (B1).
  - (a) **Partir.** Este change se queda con la parte A (D1, D8/Q3, D9 stale, D11/B3, Q2). La parte B —marcas atómicas
    multi-réplica: D2-D5, D7, D9 ledger, grupos 7-11 de tareas, `platform/worker-claims` y el requirement «Toma única
    de una entrega vencida»— pasa a un change posterior, `worker-claims-multi-replica`, disparado por «antes del primer
    `--scale worker=2`» —**recomendación de reflect**: lo que ve el usuario no tiene que esperar a una veintena de
    tareas de concurrencia—.
    *Costo:* un segundo debate y un segundo PR más adelante (B9); además, la regla de no escalar `worker` sigue
    vigente hasta aplicar el change posterior, que no tiene fila asignada en la secuencia (B12).
  - (b) **Mantenerlo entero**, con las dos partes en un PR. *Costo:* unas 25 tareas de concurrencia ahora (grupos
    7-11), antes de que nada de la parte A llegue a `main` (B9).
  - Con (a), antes de aplicar: borrar los grupos 7-11 de `tasks.md`, mover `specs/platform/worker-claims/` y el
    requirement de la toma vencida al change nuevo cuando se cree, y dejar en ADR-061 §2-§4 la nota de que los aplica
    ese change. La respuesta se anota aquí en una línea que empieza por «Respuesta del owner (Q5), AAAA-MM-DD:».

## Debate — iteración 1

Fecha: 2026-10-28. Critic: P0 0, P1 11 (H1-H11). Business: V0 0 (B1-B5 y votos). Reflect: la sesión principal.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| H1 | critic | Aceptado: retención de 8 días (`691_200`); el test exige `>= removeOnFail.age + 86_400` (D1, ADR-061 §1, `platform/outbox`) | Con la misma cifra, el monitor TTL y la limpieza perezosa de BullMQ se cruzan en el borde |
| H2 | critic | Aceptado: falsación de 1.3 = `markFailed` escribe `publishedAt: now`; D1 aclara que el filtro parcial solo achica el índice | Quitar el filtro no falsaba nada: lo que protege es que pendientes y agotados no tienen fecha |
| H3 | critic | Aceptado: `confirm` duradero con `upsert: true` y filtro de igualdad sobre la clave (D3, 8.2) | Si B libera antes de que A confirme, el aviso quedaba sin registro |
| H4 | critic | Aceptado: `ttl_lease` parcial sobre `{ confirmed: false }`; la toma escribe `confirmed: false` explícito (D5, R6, Migration Plan §4, 10.1 y 11.6) | Una confirmada con `leaseUntil` pasado (escritor heredado) caducaba y reemitía el aviso |
| H5 | critic | Aceptado: la toma lee el reloj en el momento de tomar (D2, 7.1) | Una pasada lenta escribía leases ya vencidos |
| H6 | critic | Aceptado: `LinkFreshnessScheduler` consulta las compuertas de frescura y de ASN (D7, 9.5) | Su cascada toma marcas de ASN |
| H7 | critic | Aceptado: `migrate` nunca lanza; `maxTimeMS`; `createIndex` por separado con `ttl_lease` primero (D7, 9.3) | Un error de índice no puede tumbar el arranque del worker |
| H8 | critic | Aceptado: falsación de 11.5 secuencial y determinista con `dropIndex`; punto de inyección `protected` en el ledger (D9, 10.3); R7 anterior eliminado | La falsación por carrera no era reproducible |
| H9 | critic | Aceptado: 10.1 con centinela vencido que desaparece antes de afirmar, más el caso de H4 | Afirmar «no borró» sin probar que el monitor pasó no prueba nada |
| H10 | critic | Aceptado: 6.2 con el worker parado, o `git diff --stat` vacío + grep; el `seed` que da 0/0/0 es el tercero | Con el worker en marcha, frescura escribe en `job_links` y el `seed` repetido no da 0 |
| H11 | critic | Aceptado: 3.5 → 9.5 y 9.6; 6.2 → 11.2-11.4; 2.1 → 7.1 y 7.2; 9.7 dice cómo se fuerza el registro del cron | Tareas de más de una hora o con dos verificaciones independientes |
| S1 | critic (sugerencia) | Aceptada: el puerto de toma no recibe sesión (D2, D3); `$convert` con `onError: null` queda sin objeto al retirarse el barrido (D6) | Sin costo |
| B1 | business | Pasa al owner como Q5; `tasks.md` ordenado en parte A (grupos 1-6) y parte B (grupos 7-11) | Partir es decisión de alcance del owner; recomendación de reflect: (a) |
| B2 | business | Aceptado: nota para 35c en ADR-061 §6 y D10 | Escalar el worker antes de la parte B reabre los avisos duplicados |
| B3 | business | Aceptado: D11, grupo 3 de tareas, requirement nuevo en `notifications/dispatch`; la toma vencida del ledger (antes 4.5) pasa a la parte B | Pierde avisos incluso con un worker |
| B4 | business | Aceptado: barrido retirado (D6); RUNBOOK con el borrado de huérfanas tras `clean` (5.1); se mantienen el TTL y la 10.1 | Coste alto para un crecimiento de una marca por aviso |
| B5 | business | Se mantiene D1 | — |
| Votos | business | Q2 = (a), Q3 = (a), Q4 = (a); el grupo 4 deja de ser condicional | Recomendaciones del design |

Abiertas: Q1 (owner, bloqueante para `/opsx:apply`; recomendación: después de 35c) y Q5 (owner, antes de
`/opsx:apply`; recomendación: (a)). Convergencia: pendiente de la iteración 2.

## Debate — iteración 2

Fecha: 2026-10-29. Critic: P0 1 (F1), P1 7 (F2-F8). Business: V0 1 (B6), B7-B10. Reflect: la sesión principal.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| F1 | critic (P0) | Aceptado: el helper separa `inFlightDeferrals` de `job.data` **antes** de validar (`z.number().int().min(0).default(0)`) y pasa solo el resto al parse de siempre (D11, 3.3, 3.5; la 3.3 se partió en 3.3 y 3.5 para que cada una quepa en una hora); test «reruns a deferred job whose data carries the deferral counter» en los dos consumidores, con los 3 tipos de fan-out y el digest | Los payloads son `z.strictObject`: la ejecución aplazada fallaba el parse y el aviso se perdía igual |
| F2 | critic | Aceptado: `WorkerHandle` y procesador `(job, token?)` como en `enrich-link.consumer.ts`; el doble comprueba que `moveToDelayed` recibe el `token`; digest devuelve `{ groupsScanned, emailsSent, inFlight }` (D11, 3.2, 3.5, 4.3) | Sin `token`, `moveToDelayed` no puede mover un job con lock; el digest ya devolvía dos contadores |
| F3 | critic | Aceptado: Migration Plan §4 espera `getDelayedCount()` = 0 en `notify-fanout` y `group-digest` antes de revertir; fuera la frase de que los consumidores viejos ignoran el contador | El consumidor anterior valida `job.data` entero y rechazaría el job aplazado |
| F4 | critic | Aceptado: `$lookup` con `let: { appId: { $toString: '$_id' }, sca: '$statusChangedAt' }` y `pipeline` con `$expr`/`$eq` y `confirmed: true` (D9, Q2, 2.1, 4.2) | `applications._id` es `ObjectId` y `applicationId` de la marca es `string`: `localField`/`foreignField` no casa nunca |
| F5 | critic | Aceptado: en `MongoFreshnessLinkStore.listCascadePending`, las expiradas de grupo con ASN confirmada se excluyen antes de `$group`/`$limit` (Q2, 4.2); test con 201 links cerrados ya avisados + 1 con una postulación abierta; falsación con el `$lookup` después del `$limit` | Los cerrados ya avisados también consumían el límite |
| F6 | critic | Aceptado: `deliverChannel` lee `this.clock.now()` justo antes de `claim` y deja de recibir `now` (D11, 3.1) | El lease de una entrega tardía nacía acortado |
| F7 | critic | Aceptado: la 0.2 con Q5 = (a) quita de `proposal.md` `platform/worker-claims` y la parte B, y marca en ADR-061 las dos consecuencias de la parte B; verificación `grep -c "worker-claims" … proposal.md` = 0 | La 0.2 dejaba la propuesta prometiendo lo que ya no aplica |
| F8 | critic | Aceptado: la 5.1 dice «entre `clean` y el siguiente `seed`» y la verificación exige la frase | La huérfana solo estorba si se borra antes del `seed`, no en cualquier momento |
| B6 | business (V0) | Aceptado: regla de no escalar `worker` en el `scope` de 35c (con `061` en sus `adrs`) y una línea bajo «Escalar worker» de `infra/README.md` (5.2); el comentario de `docker-compose.prod.yml:281` queda como pendiente para 35c en ADR-061 §6 (D10) | La regla vivía solo en la 11.7, que con Q5 = (a) sale del change, y el README sigue enseñando `--scale worker=2` |
| B7 | business | Aceptado: MODIFIED de «Auto-expire de vacante cerrada sin outbox» en `notifications/dispatch` con el escenario «Link cerrado detrás de más de cuatro lotes de links abiertos» (4.1) y el de los links ya avisados (4.2, F5) | El arreglo de Q2 no tenía escenario que lo exigiera |
| B8 | business | Aceptado: la 0.2 con Q5 = (a) anota el commit fuente del diseño debatido (`<commit de cierre del debate>`, lo completa la sesión principal) en ADR-061 §6 y en una fila `worker-claims-multi-replica` del manifiesto con solo el disparador y ese commit | Que el change posterior parta del diseño debatido y no de una reescritura |
| B9 | business | Aceptado: línea de costo en cada opción de Q5 | El owner decide con el costo a la vista |
| B10 | business | Resuelto con F5: la función es `listCascadePending` | — |

Abiertas: Q1 (owner, bloqueante para `/opsx:apply`) y Q5 (owner, antes de `/opsx:apply`). Convergencia: pendiente de
la iteración 3.

## Debate — iteración 3

Fecha: 2026-10-29. Critic: P0 1 (N1), P1 7 (N2-N8). Business: V0 0, B11-B13 (B11 = N6). Reflect: la sesión principal.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| N1 | critic (P0) | Aceptado: `{ $sort: { _id: 1 } }` justo después del `$group` por `linkId` (D9, Q2, 4.1, 4.2); en los dos fixtures el link L se crea el último (`ObjectId` mayor); la 4.1 exige que el test falle también contra el código actual. Los escenarios de `notifications/dispatch` no cambian de semántica | Sin orden, `$group` podía devolver L entre los primeros y el test pasaba también con el `$limit` antes del filtro: la prueba no falsaba nada |
| N2 | critic | Aceptado: en la 3.5 el `job.data` del doble es plano, como lo publican el relay y los productores; la afirmación es que la segunda ejecución llega al caso de uso con el payload sin `inFlightDeferrals` (espía), sin nombrar `ZodError` | Afirmar sobre el tipo de error ataba el test a la implementación del parse |
| N3 | critic | Aceptado: «a delivery left claimed by a dead worker is sent once its lease expires» pasa a una 3.6 propia; la 3.3 desestructura `data` (D11) | Eran dos verificaciones independientes en una tarea; el helper recibe el dato, no el job |
| N4 | critic | Aceptado: `notifications/infrastructure/queue/worker-factory.ts` con `WorkerHandle`/`WorkerFactory`, copia por módulo como `match`; lo usan los dos consumidores (sale `DigestWorkerFactory`) y los dobles ganan `on`; en la 4.3 `on('failed')` ignora `DelayedError` (D11, 3.5, 4.3) | Importar de otro módulo rompe el monolito modular; sin ignorar `DelayedError`, cada aplazamiento se registraría como aviso agotado |
| N5 | critic | Aceptado: la 4.1 suma «expires the open application of a closed link behind more than four batches» con `DetectLinkFreshness` real sobre el mismo fixture | El escenario exige que la postulación expire, no solo que el adaptador seleccione L |
| N6 | critic | Aceptado: en la 0.2, respondida Q5, las líneas de `infra/README.md`, del `scope` de 35c y de ADR-061 §6 quedan solo con el nombre del change que aplica, con el prefijo «No escalar `worker` hasta archivar»; verificación `grep -c "si Q5" infra/README.md openspec-changes.yaml` = 0 | Una regla operativa condicional a una pregunta ya respondida confunde a quien la lee en 35c |
| N7 | critic | Aceptado: `Impact` de `proposal.md` partido en «Parte A» y «Parte B», con `listCascadePending` en `freshness/`; la 0.2 solo borra el bloque B | La 0.2 tenía que editar viñetas mezcladas |
| N8 | critic | Aceptado: en la 2.1, P se inserta la última y tiene el `statusChangedAt` más reciente | Así el `find().limit()` de la falsación la deja afuera siempre |
| B11 | business | Igual que N6 | — |
| B12 | business | Aceptado: el costo de Q5 (a) dice que la regla de no escalar `worker` sigue vigente hasta aplicar el change posterior, sin fila asignada | El owner decide con ese costo a la vista |
| B13 | business | Aceptado: `Impact` dice que la línea de `infra/README.md` ya está escrita en el debate (B6) y que la 5.2 la repone si 35b/35c reescriben la sección | La propuesta describía como futuro algo que ya está en el repo |

Abiertas: Q1 (owner, bloqueante para `/opsx:apply`) y Q5 (owner, antes de `/opsx:apply`).
Convergencia: pendiente de la verificación puntual de N1 (P0 de la iteración 3)
