## Why

El relevamiento del 2026-10-28 (devuelto a planificación por la sesión de 35b, porque es código de la aplicación y no
del despliegue) encontró tres colecciones de marcas y una de eventos que crecen sin límite o que no son seguras con más
de una réplica del worker:

- **`outbox_events`** (`apps/api/src/infrastructure/outbox/outbox-event.schemas.ts`): el único índice es el parcial de
  los pendientes; los eventos **publicados** no se borran nunca. Nadie los vuelve a leer: el relay solo toma pendientes
  y el RUNBOOK solo mira pendientes.
- **Marcas de los detectores del worker**: `link_freshness_claims`, `application_status_group_notify_claims` (ASN) y
  `application_stale_claims` (`mongo-freshness.adapters.ts` y `mongo-notify.adapters.ts`). Ninguna tiene esquema ni
  índice en el repositorio, y las tres reclaman con «leer y después `updateOne` con `upsert`». Con dos réplicas
  (`docker-compose.prod.yml` sugiere `--scale worker=2`) y los `@Cron(EVERY_HOUR)` disparando a la vez en cada una,
  dos upserts concurrentes sin índice único pueden crear dos documentos de la misma clave y **ambas réplicas creen haber
  ganado**. `release` borra cualquier marca sin confirmar de esa clave, también la que tomó otra réplica. La marca de
  frescura arrastra un comentario de diseño sin cerrar (`:210-220`) sobre qué significa `confirmed`.
- **Las marcas confirmadas de stale y ASN son el registro duradero de «ya se avisó»** (`notifications/stale-applications`,
  «Un aviso por estancamiento»): no se pueden caducar por tiempo sin reemitir avisos, pero tampoco se borran cuando su
  clave muere (la postulación cambió de estado o se borró la cuenta). Además, `listEligible` de stale toma 50
  postulaciones **antes** de descartar las ya avisadas: con más de 50 estancadas y avisadas, las nuevas no se ven nunca.
- **La toma de una entrega vencida** en `notification_deliveries` hace `updateOne` sin condición tras leer: dos workers
  que encuentran el mismo `claimed` vencido envían los dos.
- **Jobs fallidos de BullMQ** (`outbox-queues.ts:25`, `removeOnFail` a 7 días): evaluado en design D8; no hace falta
  retenerlos más, porque el rastro duradero es el estado del agregado (`platform/outbox`, «El trabajo encolado no se
  pierde»). El único hueco real son dos consumidores de notificaciones que no registran el fallo (Q3).

Ninguno de estos defectos afecta a la medición de 35b (design D10): staging corre **un** worker, la medición no lee
ninguna de estas colecciones y el volumen de 3-5 personas en 14 días es despreciable frente a los 12 GB del host.

## What Changes

- **Retención de los eventos publicados del outbox** (ADDED en `platform/outbox`): índice TTL parcial sobre
  `publishedAt` (solo documentos con fecha), 7 días, igual que la retención de los jobs fallidos de sus colas, con un
  test que impide que las dos cifras se separen. Los **pendientes** y los **agotados** no se borran nunca.
- **Marcas atómicas del worker** (capacidad nueva `platform/worker-claims`): una clave única por colección, toma con
  un solo `findOneAndUpdate` con `upsert` cuya condición incluye el vencimiento (la toma ocupada cae en `E11000` y se
  lee como «no tomada»), un testigo por toma para que `release` solo borre la propia, `leaseUntil` como único campo de
  caducidad (TTL de 24 h sobre las tomas abandonadas; las confirmadas no lo llevan), y en frescura una retención corta
  tras confirmar que impide que otra réplica relea el mismo link en el mismo tick. Cierra el comentario de `:210-220`.
- **Barrido diario de las marcas duraderas muertas**: borra las confirmadas de stale y ASN cuya postulación ya no existe
  o ya no tiene ese `statusChangedAt`. Idempotente con varias réplicas.
- **Arranque de índices con migración**: antes del primer tick, el worker completa `leaseUntil` en los documentos
  heredados, elimina duplicados de forma determinista (gana la confirmada) y crea los índices; si no lo consigue, los
  detectores de esa colección **se saltan el tick** con un aviso y el resto del worker sigue trabajando.
- **Selección de stale sin inanición** (ADDED en `notifications/stale-applications`): las ya avisadas no consumen el
  lote.
- **Toma única de una entrega vencida** (ADDED en `notifications/dispatch`): la toma se condiciona al `claimedAt` leído.
- **ADR-061** (Propuesto) con la retención y el modelo de marcas; una línea en ADR-009.

## Encaje en la fase

**Candidato posterior a la fila 35**, como `e2e-suite-lot-2`: sin fila en `docs/design-v0.2.md` §6 hasta que el owner
la asigne (Q1). No pide excepción a la precedencia de ADR-048 §Consecuencias (extendida a la fila entera por ADR-051
§Enmiendas 3), porque no hay riesgo real para la medición de 35b (design D10):

- **Duplicados**: solo con dos réplicas del worker; staging corre una (`deploy.sh` hace `up -d` sin `--scale`) y
  `docker compose up` recrea el contenedor parando el viejo antes de arrancar el nuevo.
- **Medición**: `infra/staging/measure.mongosh.js` y `uninvited.mongosh.js` no leen `outbox_events` ni ninguna marca.
- **Volumen**: cientos o pocos miles de documentos de unos cientos de bytes en 14 días.
- **Inanición de stale**: exige más de 50 postulaciones abiertas, estancadas 10 días y ya avisadas; en 14 días de
  medición solo se estancan las creadas en los primeros 4.

Adelantarlo, en cambio, obligaría a redesplegar staging antes de invitar y a repetir la 9.4 de `e2e-suite` sobre el
nuevo commit (las reglas de ADR-056 §1). Si el owner lo quiere antes de la 10.7 de 35b, la Q1 (b) recoge desde el
principio las tres clases de fusión, la confirmación escrita y fechada del owner en el PR y la repetición de las
comprobaciones previas a invitar sobre el último commit desplegado.

**Seeds de `infra/staging/`**: compatibles. `seed-volume.mongosh.js` borra en `clean` los eventos del outbox cuyo
payload nombra a un usuario del lote; el TTL solo quita publicados antiguos, que `clean` también habría borrado o que no
le importan, y ni `expect` ni `digest` cuentan el outbox. La semilla no escribe marcas; las que deja huérfanas al
borrar postulaciones las recoge el barrido (design R5). No se toca ningún fichero de `infra/staging/`.

## Capabilities

### New Capabilities

- `platform/worker-claims`: contrato de las marcas de los detectores periódicos del worker (frescura, ASN y stale):
  clave única, toma atómica entre réplicas, testigo, caducidad de las tomas abandonadas, barrido de las duraderas
  muertas y arranque de índices con migración.

### Modified Capabilities

- `platform/outbox`: ADDED «Retención de los eventos publicados».
- `notifications/stale-applications`: ADDED «Las postulaciones ya avisadas no consumen el lote».
- `notifications/dispatch`: ADDED «Toma única de una entrega vencida».

## Impact

- `apps/api/src/infrastructure/outbox/`: índice TTL en `outbox-event.schemas.ts`, constante de retención y su test de
  coherencia con `outbox-queues.ts`. Sin cambio en el relay.
- `apps/worker/src/infrastructure/claims/` (nuevo, plataforma como el outbox de `api`): toma atómica genérica, arranque
  de índices con migración y compuerta por colección, barrido diario.
- `apps/worker/src/modules/freshness/` y `.../notifications/`: los adaptadores delegan en lo anterior; los puertos
  `FreshnessLinkClaims`, `StatusGroupNotifyClaims` y `ApplicationStaleClaims` devuelven una toma con testigo en vez de
  un booleano, y sus dobles en memoria y casos de uso se ajustan; `listEligible` de stale con `$lookup`; la toma del
  ledger condicionada; los schedulers consultan la compuerta.
- Sin variables de entorno nuevas, sin cambios en `docker-compose*.yml`, workflows, `infra/` ni `libs/`.
- RUNBOOK: cómo comprobar los índices y listar los agotados del outbox.

## Fuera de alcance

- **Rotación de logs de Docker** en el host (ningún compose declara `logging:`; `json-file` sin `max-size` crece sin
  límite): es un fichero de despliegue de 35b. Recomendación escrita para 35b, Q4.
- Crecimiento de `notification_deliveries` (es el registro de idempotencia; su retención depende de cuánto puede
  reaparecer un hecho) y la pérdida de una entrega cuando la toma en vuelo muere (`in_flight` termina el job sin
  reintento): candidatos a un change de notificaciones.
- Selector de la cascada de frescura (`listCascadePending`), que puede no ver los links cerrados cuando hay más de
  `4 × LINK_FRESHNESS_BATCH_LIMIT` links con postulaciones abiertas: Q2.
- Una cola de mensajes muertos o una colección de jobs fallidos (design D8).
- Índices nuevos en `applications` (los dueños son de `api`).
