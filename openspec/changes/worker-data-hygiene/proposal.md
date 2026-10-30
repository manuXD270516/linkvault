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
  frescura arrastra un comentario de diseño sin cerrar (`:210-220`) sobre qué significa `confirmed`. **Este defecto
  no lo arregla este change** (Q5 = (a), 2026-10-29): lo hace el change posterior de marcas atómicas multi-réplica
  (ver `openspec-changes.yaml` y ADR-061 §6), antes del primer `--scale worker=2`.
- **Las marcas confirmadas de stale y ASN son el registro duradero de «ya se avisó»** (`notifications/stale-applications`,
  «Un aviso por estancamiento»): no se pueden caducar por tiempo sin reemitir avisos, pero tampoco se borran cuando su
  clave muere (la postulación cambió de estado o se borró la cuenta). Además, `listEligible` de stale toma 50
  postulaciones **antes** de descartar las ya avisadas: con más de 50 estancadas y avisadas, las nuevas no se ven nunca.
- **La toma de una entrega vencida** en `notification_deliveries` hace `updateOne` sin condición tras leer: dos workers
  que encuentran el mismo `claimed` vencido envían los dos. Con un solo worker no ocurre; también va al change
  posterior de marcas atómicas multi-réplica.
- **Una entrega en vuelo se pierde**: si el worker muere entre reclamar una entrega y completarla, BullMQ recupera el
  job, `claim` responde `in_flight` (la toma sigue dentro de sus 5 minutos) y los consumidores de `notify-fanout` y del
  digest **terminan el job**; la entrega queda `claimed` para siempre y el aviso no llega. Pasa con un solo worker.
- **Jobs fallidos de BullMQ** (`outbox-queues.ts:25`, `removeOnFail` a 7 días): evaluado en design D8; no hace falta
  retenerlos más, porque el rastro duradero es el estado del agregado (`platform/outbox`, «El trabajo encolado no se
  pierde»). El único hueco real son dos consumidores de notificaciones que no registran el fallo (Q3).

Ninguno de estos defectos afecta a la medición de 35b (design D10): staging corre **un** worker, la medición no lee
ninguna de estas colecciones y el volumen de 3-5 personas en 14 días es despreciable frente a los 12 GB del host.

## What Changes

El owner partió el change el 2026-10-29 (Q5 = (a); design, «Partición (Q5)»): este change es la parte A, lo que ve el
usuario. Las marcas atómicas multi-réplica (antes parte B) van a un change posterior.

**Parte A — lo que ve el usuario:**

- **Retención de los eventos publicados del outbox** (ADDED en `platform/outbox`): índice TTL parcial sobre
  `publishedAt` (solo documentos con fecha), 8 días, un día más que la retención de los jobs fallidos de sus colas, con
  un test que impide que las dos cifras se acerquen. Los **pendientes** y los **agotados** no se borran nunca.
- **Selección de stale sin inanición** (ADDED en `notifications/stale-applications`): las ya avisadas no consumen el
  lote.
- **Entrega en vuelo reintentada** (ADDED en `notifications/dispatch`): el job que encuentra una entrega `in_flight` se
  aplaza hasta que vence su lease, con un tope de aplazamientos, en vez de terminar.
- **Cascada de frescura sin puntos ciegos** (Q2 = (a)): `listCascadePending` filtra los links cerrados antes del límite.
- **Rastro de los avisos agotados** (Q3 = (a)): una línea `warn` por job agotado de `notify-fanout` y `group-digest`.

**Documentos:** ADR-061 (Propuesto) con la retención y el modelo de marcas (este change aplica §1, §5, §5b y la
selección de stale; §2-§4 los aplica el change posterior); una línea en ADR-009. El barrido diario de las
marcas duraderas muertas se retiró en el debate (B4): el RUNBOOK documenta el borrado manual de las huérfanas que deja
la semilla.

## Encaje en la fase

**Después de la fila 35** (Q1 = (a), respuesta del owner del 2026-10-29): justo después de 35c y antes de
`golden-sets-reales`, con fila «tras 35c» en `docs/design-v0.2.md` §6. No pide excepción a la precedencia de ADR-048 §Consecuencias (extendida a la fila entera por ADR-051
§Enmiendas 3), porque no hay riesgo real para la medición de 35b (design D10):

- **Duplicados**: solo con dos réplicas del worker; staging corre una (`deploy.sh` hace `up -d` sin `--scale`) y
  `docker compose up` recrea el contenedor parando el viejo antes de arrancar el nuevo.
- **Medición**: `infra/staging/measure.mongosh.js` y `uninvited.mongosh.js` no leen `outbox_events` ni ninguna marca.
- **Volumen**: cientos o pocos miles de documentos de unos cientos de bytes en 14 días.
- **Inanición de stale**: exige más de 50 postulaciones abiertas, estancadas 10 días y ya avisadas; en 14 días de
  medición solo se estancan las creadas en los primeros 4.

Adelantarlo, en cambio, obligaría a redesplegar staging antes de invitar y a repetir la 9.4 de `e2e-suite` sobre el
nuevo commit (las reglas de ADR-056 §1); por eso el owner no eligió la Q1 (b).

**Seeds de `infra/staging/`**: compatibles. `seed-volume.mongosh.js` borra en `clean` los eventos del outbox cuyo
payload nombra a un usuario del lote; el TTL solo quita publicados antiguos, que `clean` también habría borrado o que no
le importan, y ni `expect` ni `digest` cuentan el outbox. La semilla no escribe marcas; las que deja huérfanas al
borrar postulaciones se borran a mano con el procedimiento del RUNBOOK (design R5). No se toca ningún fichero de
`infra/staging/`.

## Capabilities

### New Capabilities

Ninguna. La capacidad de plataforma de las marcas atómicas la crea el change posterior (Q5 = (a)).

### Modified Capabilities

- `platform/outbox`: ADDED «Retención de los eventos publicados».
- `notifications/stale-applications`: ADDED «Las postulaciones ya avisadas no consumen el lote».
- `notifications/dispatch`: ADDED «Una entrega en vuelo se reintenta al vencer su lease»; MODIFIED «Auto-expire de
  vacante cerrada sin outbox» (la selección de la cascada se acota después de descartar los links abiertos y los ya
  avisados).

## Impact

**Parte A:**

- `apps/api/src/infrastructure/outbox/`: índice TTL en `outbox-event.schemas.ts`, constante de retención y su test de
  coherencia con `outbox-queues.ts`. Sin cambio en el relay.
- `apps/worker/src/modules/notifications/`: `listEligible` de stale con `$lookup`; casos de uso de fan-out y digest que
  informan las entregas en vuelo; `infrastructure/queue/worker-factory.ts` propio del módulo; consumidores que aplazan
  el job y registran los jobs agotados.
- `apps/worker/src/modules/freshness/`: `listCascadePending` con el filtro de cerrados y de ya avisados antes del
  límite.
- Sin variables de entorno nuevas, sin cambios en `docker-compose*.yml`, workflows ni `libs/`. En `infra/`, solo una
  línea de advertencia bajo «Escalar worker» de `infra/README.md` (no escalar `worker` hasta archivar el change
  posterior de marcas), ya
  escrita en el debate (B6); la 5.2 la repone si 35b/35c reescriben la sección. La misma regla está en el `scope` de
  35c del manifiesto.
- RUNBOOK: cómo comprobar el índice del outbox, listar sus agotados y borrar las marcas huérfanas de la semilla.

## Fuera de alcance

- **Rotación de logs de Docker** en el host (ningún compose declara `logging:`; `json-file` sin `max-size` crece sin
  límite): es un fichero de despliegue de 35b. Recomendación escrita para 35b, Q4.
- Crecimiento de `notification_deliveries` (es el registro de idempotencia; su retención depende de cuánto puede
  reaparecer un hecho): candidato a un change de notificaciones.
- Barrido de las marcas confirmadas de stale y ASN cuya clave murió (retirado en el debate, B4; design D6).
- Una cola de mensajes muertos o una colección de jobs fallidos (design D8).
- Índices nuevos en `applications` (los dueños son de `api`).
- Marcas atómicas multi-réplica (índice único, toma atómica con testigo, caducidad de tomas abandonadas, migración y
  compuerta al arrancar) y toma única de una entrega vencida: change posterior (Q5 = (a), 2026-10-29; diseño debatido
  en el commit `776e12a`).
