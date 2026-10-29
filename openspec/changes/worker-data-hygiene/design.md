## Context

Estado de `main` en `5b92d28` (2026-10-28):

- **Outbox** (`apps/api/src/infrastructure/outbox/`, ADR-009, D6 de `job-links`). Tres estados explícitos: pendiente
  (`publishedAt` y `failedAt` nulos), publicado (`publishedAt` con fecha) y agotado (`failedAt` con fecha, tras 24 h sin
  publicar). Un único índice, parcial sobre los pendientes. El relay (`outbox-relay.ts`) solo lee pendientes; marca
  publicado tras la confirmación de la cola. Ningún código ni procedimiento del RUNBOOK lee publicados. Los índices se
  crean por `autoIndex` de Mongoose al compilar el modelo (precedente: los TTL de `auth_sessions`, `refresh_tokens` y
  `auth_email_tokens`).
- **Colas** (`outbox-queues.ts`): `removeOnComplete` a 1 día / 1000, `removeOnFail` a 7 días, para todas las colas del
  outbox. En el worker, las colas propias de frescura y notificaciones usan `removeOnComplete: true` (el `jobId`
  determinista solo deduplica mientras el job espera o corre).
- **Marcas del worker**, sin esquema ni índice, sobre `connection.collection(...)`:

  | Colección | Clave | Quién la usa | Qué significa `confirmed` |
  |---|---|---|---|
  | `link_freshness_claims` | `linkId` | `DetectLinkFreshness` (cascada y abiertas) | nada: `confirm` borra el documento |
  | `application_status_group_notify_claims` | `applicationId` + `statusChangedAt` | `ExpireApplicationsForClosedLink`, `listCascadePending`, `listForExpireCascade` | «el ASN de este expire ya se encoló»; bloquea para siempre |
  | `application_stale_claims` | `applicationId` + `statusChangedAt` | `DetectStaleApplications` | «el stale de este `statusChangedAt` ya se encoló»; bloquea para siempre |

  Las tres reclaman igual: `findOne` por clave, decisión en memoria, `updateOne(clave, $set, { upsert: true })`.
  `release` hace `deleteOne({ clave, confirmed: false })`.
- **Crons**: `@Cron(EVERY_HOUR)` en frescura y stale; `@nestjs/schedule` los monta en `onApplicationBootstrap`, después
  de todos los `onModuleInit`. Cada réplica del worker corre los suyos.
- **Ledger de entregas** (`notification_deliveries`): índice único `(type, aggregateKey, userId, channel)` declarado
  en el esquema de `api`; la toma de un `claimed` vencido hace `updateOne` sin condición.
- **Despliegue**: staging con un solo worker (`infra/deploy/deploy.sh`, `up -d --wait` sin `--scale`); Mongo 7.0.43,
  replica set de un nodo; tests con `MongoMemoryReplSet` del preset de `@linkvault/testing`.

Requisitos que mandan: `platform/outbox` (ningún evento se pierde; agotados con aviso), `notifications/stale-applications`
(«Un aviso por estancamiento»), `notifications/dispatch` («Idempotencia de entrega», «Auto-expire de vacante cerrada
sin outbox»: el claim no se borra por estar `expired`), `links/freshness` («Límite por ejecución e idempotencia»: lease,
la marca no queda dura si el encolado falla).

## Goals / Non-Goals

**Goals:** que `outbox_events` y las tres colecciones de marcas tengan un tamaño acotado por el uso vivo; que tomar
una marca sea correcto con N réplicas sin depender del `jobId` de BullMQ; que los datos existentes, con posibles
duplicados, migren solos y sin perder ningún «ya se avisó»; que todo se verifique con `mongodb-memory-server` (replset),
incluida una prueba con dos réplicas.

**Non-Goals:** cambiar qué se notifica o cuándo; retención de `notification_deliveries`; colas de mensajes muertos;
ficheros de despliegue; observabilidad nueva; índices en colecciones de `api` que no sean el outbox.

## Decisions

### D1. Los eventos publicados se borran a los 7 días; los pendientes y los agotados, nunca

Índice TTL en `outbox-event.schemas.ts`:

```ts
outboxEventSchema.index(
  { publishedAt: 1 },
  {
    name: 'ttl_published',
    expireAfterSeconds: OUTBOX_PUBLISHED_RETENTION_S, // 604_800
    partialFilterExpression: { publishedAt: { $type: 'date' } },
  },
);
```

- **Por qué no se pierde nada vivo**: el TTL de Mongo solo borra documentos cuyo campo indexado es una fecha; un
  pendiente o un agotado tiene `publishedAt: null`. El filtro parcial lo hace explícito y además deja fuera del índice
  a esos documentos. Ningún código pasa un evento de publicado a pendiente.
- **Por qué 7 días**: un publicado solo sirve para diagnosticar —correlacionar un job con su evento (`createdAt`,
  `attempts`, `type`)—. El job fallido vive 7 días en Redis (`removeOnFail.age`); mientras exista, su evento también. Un
  test fija que `OUTBOX_PUBLISHED_RETENTION_S` sea **mayor o igual** que el `removeOnFail.age` de todas las colas de
  `OUTBOX_QUEUES` (`outboxJobOptionsFor`), para que no se separen sin que nadie lo note.
- **Agotados**: se quedan. Son raros (24 h de fallos seguidos), son el único rastro de trabajo que no llegó a la cola y
  llevan solo identificadores (ADR-009). El RUNBOOK añade la consulta para listarlos.
- **Primera pasada**: al crear el índice, el monitor TTL (cada 60 s) borra en tandas todos los publicados de más de 7
  días. En staging es trivial; en un volumen grande la carga se reparte sola entre pasadas.
- La idempotencia no cambia: un evento borrado ya estaba publicado y el relay nunca lo volvería a tomar; «Evento
  republicado tras la retención» de `platform/outbox` sigue siendo responsabilidad del consumidor.

*Descartado:* barrido programado en el relay (más código para lo que Mongo hace solo, y correría en cada réplica de
`api`); TTL de 24 h (deja jobs fallidos sin su evento durante 6 días); retención de meses (sin uso que la pida);
TTL también sobre `failedAt` (perdería el rastro que `platform/outbox` exige conservar).

### D2. Una marca es un documento por clave con índice único, y tomarla es una sola operación

Para cada colección, índice único sobre su clave (`{ linkId: 1 }` o `{ applicationId: 1, statusChangedAt: 1 }`,
nombre `uniq_claim_key`) y toma con `findOneAndUpdate` + `upsert`, cuyo filtro incluye **la condición de que la marca
esté libre**:

```ts
// stale y ASN
filter = { ...key, confirmed: false, $or: [
  { leaseUntil: { $lte: now } },
  { leaseUntil: { $exists: false }, claimedAt: { $lte: new Date(now - leaseMs) } }, // heredado (D5)
]};
update = { $set: { claimedAt: now, leaseUntil: new Date(now + leaseMs), token, confirmed: false } };
// frescura: igual, sin `confirmed`
```

- **Libre o vencida** → el filtro casa, se actualiza y la réplica gana.
- **No existe** → `upsert` inserta (copia la clave y `confirmed: false` del filtro) y la réplica gana.
- **Ocupada o confirmada** → el filtro no casa, `upsert` intenta insertar y el índice único lo rechaza con `E11000`:
  el adaptador lo traduce a «no tomada». Mongo **no** reintenta este `upsert` por su cuenta, porque el filtro no es solo
  igualdades sobre la clave del índice; los tests lo fijan («an occupied claim is reported as not taken, not as an
  error»).
- **Dos réplicas a la vez**: dos inserciones de la misma clave → una gana y la otra recibe `E11000`; dos tomas del
  mismo documento vencido → `findOneAndUpdate` es atómico por documento, la segunda ya no casa y cae en `E11000`.

*Descartado:* mantener «leer y después upsert» y confiar en el `jobId` (con `removeOnComplete: true` en las colas del
worker, el primer job puede haber terminado y desaparecido antes del segundo `add`); un lock distribuido por tick en
Redis o Mongo (serializa réplicas enteras en vez de claves, y su vencimiento tiene los mismos problemas); elegir una
sola réplica «líder» para los crons (otra pieza de coordinación para un problema que una clave única resuelve).

### D3. Cada toma lleva un testigo; `release` solo borra la propia

La toma genera `token = randomUUID()` y el puerto devuelve `ClaimLease { token } | null` en vez de `boolean`.

- `release(lease)` = `deleteOne({ ...key, token, confirmed: false })`. Hoy, si la toma de A venció, B la tomó y A falla
  después, el `release` de A borra la de B y una tercera pasada puede encolar de nuevo.
- `confirm` de stale y ASN = `updateOne({ ...key }, { $set: { confirmed: true, confirmedAt: now }, $unset: { leaseUntil:
  '', token: '' } })`, **sin** condicionar al testigo: si A encoló, el aviso existe aunque su toma haya vencido; al
  quitar el testigo, el `release` posterior de B no casa y no borra la marca duradera.
- `confirm` de frescura = `updateOne({ linkId, token }, { $set: { leaseUntil: now + FRESHNESS_CONFIRMED_HOLD_MS } })`
  (D4).

Los puertos (`FreshnessLinkClaims`, `StatusGroupNotifyClaims`, `ApplicationStaleClaims`) viven en `application/ports`,
no en `domain/`. Cambian sus firmas, sus dobles en memoria y los tres casos de uso; la lógica de los casos de uso no
cambia. `isConfirmed` de ASN se conserva.

*Descartado:* condicionar `release` al `claimedAt` leído (dos réplicas pueden escribir el mismo `now` en milisegundos;
un testigo aleatorio no colisiona).

### D4. La marca de frescura es solo un lease, con una retención corta tras confirmar

Cierra el comentario de `mongo-freshness.adapters.ts:210-220`: en frescura `confirmed` no significa nada y desaparece.
Lo que importa es que, en **el mismo tick**, otra réplica no vuelva a procesar un link que esta acaba de terminar
(su selector se leyó antes del efecto). Hoy `confirm` borra el documento y deja esa ventana abierta.

- `confirm` deja la marca con `leaseUntil = now + FRESHNESS_CONFIRMED_HOLD_MS` (30 minutos, menor que el periodo del
  cron de 1 h): el siguiente tick puede reclamar, el mismo tick en otra réplica no.
- `release` (fallo) borra la propia y deja el link reclamable enseguida, como pide «Reclamación con lease».
- La elegibilidad sigue siendo la de los selectores (`lastFreshnessCheckAt`, `expiresAt`, cascada).

*Descartado:* borrar en `confirm` (la ventana de arriba); una marca duradera por cubeta de cadencia (duplica lo que ya
dice `lastFreshnessCheckAt`).

### D5. Caducidad: TTL sobre `leaseUntil`; las confirmadas no lo llevan

En las tres colecciones, índice TTL `{ leaseUntil: 1 }`, `expireAfterSeconds: 86_400`, nombre `ttl_lease`.

- Una toma abandonada (réplica muerta entre `claim` y `confirm`/`release`) se borra un día después de vencer. Borrar
  una marca no confirmada y vencida equivale a lo que ya permite la toma: cualquier pasada podía reclamarla.
- Una marca de frescura confirmada se borra 24 h después de su retención: la colección queda acotada por los links
  procesados el último día.
- Una marca confirmada de stale o ASN no tiene `leaseUntil` (`$unset` en D3): el TTL no la toca. Su vida la decide D6.
- **Heredados**: los documentos escritos por la versión anterior no tienen `leaseUntil` ni `token`. El filtro de D2
  los acepta por `claimedAt` (rama `$exists: false`), así que una réplica antigua que siga escribiendo durante un
  despliegue escalado no bloquea a las nuevas; y el arranque (D7) les completa `leaseUntil` para que el TTL los alcance.

*Descartado:* TTL sobre `claimedAt` con filtro parcial `confirmed: false` (borraría la marca de frescura confirmada
según cuándo se tomó, no según su retención, y obliga a un índice parcial por estado); TTL largo sobre las confirmadas
(reemite el aviso si la postulación sigue igual pasado el plazo: contradice «Un aviso por estancamiento»).

### D6. Las marcas duraderas se barren cuando su clave muere

Una marca confirmada de stale o ASN solo puede volver a consultarse para la misma `(applicationId, statusChangedAt)`.
`statusChangedAt` solo avanza (cambio de estado o de etapa, reapertura), y una cuenta borrada borra sus postulaciones.
Así que una marca confirmada está **muerta** cuando no existe ninguna postulación con `_id = applicationId` **y**
`statusChangedAt` igual al de la marca, y entonces nada la volverá a leer.

- `ClaimsSweepScheduler` en el worker, `@Cron('30 3 * * *', { timeZone: 'UTC' })`: por cada colección, agregación con
  `$lookup` a `applications` (`$toObjectId(applicationId)` y `statusChangedAt`), tandas de 500 `_id` muertos borrados
  con `deleteMany({ _id: { $in }, confirmed: true })`, hasta 10 tandas por pasada. Cuenta lo borrado en una línea de
  log, sin identificadores.
- Con varias réplicas, el barrido corre en todas: es idempotente (el segundo `deleteMany` no encuentra nada).
- Una marca que se toma para un `statusChangedAt` viejo (el caso de uso leyó la postulación antes de que cambiara) muere
  igual y se barre.
- Cota: tras cada pasada, a lo sumo una marca confirmada viva por postulación y por colección.

*Descartado:* guardar la marca en el propio documento de `applications` (el worker escribiría un agregado de
`applications` desde `notifications` y `freshness`); borrar la marca en el momento del cambio de estado en `api`
(acopla `applications` a dos colecciones del worker, y no cubre las cuentas borradas sin tocar la cascada de
`users/account-deletion`).

### D7. Los índices se crean al arrancar, después de migrar, y su ausencia cierra solo a los detectores

`ClaimIndexesBootstrap` (plataforma del worker), en `onModuleInit` y por colección:

1. **Completar heredados**: `updateMany({ leaseUntil: { $exists: false }, confirmed: { $ne: true } }, [{ $set:
   { leaseUntil: { $add: [{ $ifNull: ['$claimedAt', now] }, leaseMs] } } }])`.
2. **Quitar duplicados** de forma determinista: agrupar por clave con más de un documento y conservar, por este orden,
   el confirmado, el de `claimedAt` más reciente y el de `_id` menor; borrar el resto por `_id`. Dos réplicas que
   arrancan a la vez calculan el mismo superviviente y borran lo mismo. **Nunca** se pierde un «ya se avisó»: si alguno
   de los duplicados está confirmado, sobrevive un confirmado.
3. **Crear** `uniq_claim_key` y `ttl_lease` con `createIndexes` (idempotente si ya existen con las mismas opciones).
4. **Comprobar** con `listIndexes` que la clave única existe con `unique: true` y la clave esperada.

Si el paso 3 falla con `E11000` (una réplica antigua insertó un duplicado entre 2 y 3), se repiten 2-4 hasta tres
veces. Si al final no hay índice único, la compuerta de esa colección queda **cerrada**: su scheduler registra un aviso
y se salta el tick, y en cada tick vuelve a intentar 1-4 una vez. El resto del worker (colas de enriquecimiento, CV,
match, búsqueda) sigue: una marca sin índice único es un riesgo de avisos duplicados, no de perder trabajo encolado.

Como los crons se montan en `onApplicationBootstrap`, el arranque termina antes del primer tick.

*Descartado:* esquemas de Mongoose con `autoIndex` (un índice único que falla por duplicados lo hace en silencio, y el
worker seguiría reclamando sin índice); una migración manual por `mongosh` en el RUNBOOK (staging se reconstruye con
volúmenes nuevos y producción la olvidaría); que el worker no arranque (para la cola de enriquecimiento por un problema
de los avisos).

### D8. Jobs fallidos de BullMQ: sin cambio de retención

Evaluado, no se cambia. `platform/outbox` («El trabajo encolado no se pierde») exige que el agregado quede con un estado
que explique el fallo: link con motivo, CV con `failed`, análisis con su estado. Ese es el rastro duradero; el job en
Redis es un detalle de 7 días. Los consumidores de `cv`, `enrichment`, `match` y `search` registran el fallo (`on('failed')`).

El hueco: `notify-fanout` y `group-digest` no registran el fallo y su publicador no reintenta (`removeOnFail: 100` por
cantidad). Un aviso que no se pudo enviar no deja ni línea de log. Añadir una línea por job agotado (cola, `jobId`,
nombre del error, sin destinatarios) es la Q3.

*Descartado:* una colección de jobs fallidos o una cola de mensajes muertos (duplica el estado de los agregados);
alargar `removeOnFail` (Redis no es un almacén de auditoría y compite por memoria en un host de 12 GB).

### D9. Stale elige entre las no avisadas, y la toma vencida del ledger es de uno solo

- `MongoApplicationStaleClaims.listEligible`: agregación sobre `applications` con `$match` (no cerradas,
  `statusChangedAt <= threshold`), `$sort { statusChangedAt: 1, _id: 1 }`, `$lookup` a `application_stale_claims` por
  `applicationId` y `statusChangedAt` con `confirmed: true` (usa `uniq_claim_key`), `$match` sin marca y `$limit`. Las
  avisadas no consumen el lote; la más antigua sin avisar va primero.
- `MongoNotifyDeliveryLedger.claim`, rama de toma vencida: `updateOne({ ...filter, status: 'claimed', claimedAt:
  existing.claimedAt }, ...)` y `'claimed'` solo con `modifiedCount === 1`; si no, se vuelve a leer una vez y se
  responde según el estado nuevo (`in_flight` o `already_done`).

### D10. Encaje: después de la fila 35, sin excepción

Lo que tendría que pasar para que esto afecte a 35b, y por qué no pasa:

| Riesgo | Condición | En 35b |
|---|---|---|
| Avisos duplicados por la toma | dos réplicas del worker a la vez | una réplica; `up -d` sin `--scale`; la recreación para el contenedor viejo antes |
| Toma vencida del ledger | dos procesadores del mismo hecho tras 5 min | un worker; BullMQ da cada job a uno solo |
| Inanición de stale | > 50 postulaciones abiertas, estancadas y avisadas | 14 días de medición: solo se estancan las de los primeros 4 |
| Disco | publicados y marcas | cientos de KB frente a 12 GB |
| Medición | lectura de estas colecciones | `measure`/`uninvited` no las leen |

Adelantarlo cuesta un redespliegue antes de invitar y repetir la 9.4 de `e2e-suite` (ADR-056 §1). Por eso el change es
**candidato posterior a la fila 35** y Q1 pide al owner la fila.

## Risks / Trade-offs

- **R1. `E11000` como «no tomada»**: si otro índice único de la colección fallara por otra razón, se leería como
  ocupada. Mitigación: las colecciones de marcas solo tienen `_id` y `uniq_claim_key`; el adaptador comprueba que el
  error nombra `uniq_claim_key` (`keyPattern`) y relanza cualquier otro.
- **R2. Compuerta cerrada en silencio prolongado**: si la migración no converge, los avisos de stale/ASN y la frescura
  no corren. Mitigación: un `warn` por tick con la colección y el motivo; RUNBOOK con la consulta de índices.
- **R3. Primera pasada del TTL en un outbox grande**: carga de borrado durante unos minutos. Mitigación: Mongo borra en
  tandas; en staging son pocos miles de documentos.
- **R4. `$lookup` de stale sin índice en `applications` por `statusChangedAt`**: escaneo de las no cerradas. A la
  escala de 35b es irrelevante; un índice en `applications` es de `api` y queda fuera.
- **R5. Semilla de `infra/staging/` y marcas huérfanas**: `seed-volume.sh clean` borra postulaciones del lote y deja sus
  marcas; un `seed` posterior recrea los mismos `_id` y `statusChangedAt` (son deterministas), así que una marca
  confirmada huérfana de una corrida anterior suprimiría el aviso stale del lote si el barrido no pasó entre medias.
  Solo afecta a Mongo locales desechables y a avisos, que la medición no cuenta. No se toca la semilla; se anota en
  el RUNBOOK junto al barrido.
- **R6. Despliegue escalado con versiones mezcladas**: una réplica vieja hace upsert por igualdad de clave; con el
  índice único, Mongo reintenta ese upsert y no crea duplicados, y la rama heredada del filtro (D5) evita que bloquee a
  las nuevas. Lo cubre un test con un escritor heredado.
- **R7. La falsación de la prueba de concurrencia no es determinista**: sin el índice único, dos `upsert` simultáneos
  crean duplicados solo si coinciden. Mitigación: 50 rondas con `Promise.all` y dos conexiones; si en tres corridas
  la falsación no cae, se rehace con una barrera explícita (tarea 6.3).

## Migration Plan

1. **Apply y CI**: todo con `mongodb-memory-server` (replset del preset), incluidas la migración de documentos
   heredados con duplicados y la prueba de dos réplicas.
2. **Despliegue**: el primer arranque del worker nuevo migra e indexa (D7) antes del primer tick; el primer arranque de
   `api` crea `ttl_published` (D1). No hace falta parar nada ni correr scripts.
3. **Comprobación tras desplegar** (RUNBOOK): `db.<colección>.getIndexes()` en las cuatro colecciones muestra
   `uniq_claim_key`/`ttl_lease` y `ttl_published`; `db.outbox_events.countDocuments({ publishedAt: { $lt: <hace 7 días> }
   })` llega a `0` en unos minutos.
4. **Vuelta atrás**: revertir el código. Los índices nuevos no estorban a la versión anterior: con el único, su upsert
   por igualdad se reintenta sin error; con `ttl_lease`, sus documentos no tienen `leaseUntil` y no caducan; con
   `ttl_published`, el outbox sigue borrando publicados antiguos, que la versión anterior no lee. Si hiciera falta
   quitarlos: `dropIndex('uniq_claim_key')`, `dropIndex('ttl_lease')`, `dropIndex('ttl_published')`.

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
- **Q2 [no bloqueante]. Selector de la cascada de frescura.** `listCascadePending` agrupa `applications` por `linkId`
  con `$limit: 4 × límite` **antes** de filtrar los links cerrados: con más de 200 links con postulaciones abiertas (con
  el límite por defecto), los cerrados pueden no verse nunca y sus postulaciones no expiran. (a) Incluirlo aquí,
  con `$lookup` a `job_links` filtrando `closedAt` antes del `$limit` —recomendación: mismo fichero, mismo patrón que
  D9, dos tareas condicionales (grupo 9)—; (b) un change propio de frescura.
- **Q3 [no bloqueante]. Rastro de los avisos que no se pudieron enviar.** (a) Una línea `warn` por job agotado en
  `notify-fanout` y `group-digest` (cola, `jobId`, nombre del error; sin destinatarios ni correos) —recomendación,
  una tarea condicional (grupo 9)—; (b) dejarlo como está.
- **Q4 [no bloqueante]. Rotación de logs del host.** Ningún compose declara `logging:` y el `json-file` por defecto no
  rota: en 12 GB es un riesgo de disco mayor que el outbox. Es un fichero de despliegue. (a) Escribirlo como
  recomendación para 35b en ADR-061 §Consecuencias y que el owner decida si lo traslada a `staging-host`
  —recomendación—; (b) dejarlo para 35c o para producción.
