## Context

`groups` dejó la plantilla de módulo (domain/application/infrastructure/presentation), `GroupsFacade` (`isMember`,
`getGroupsOf`) como única entrada desde otros módulos, la regla de lint que la respalda, el guard global, el pipe zod y
el filtro que traduce errores de dominio con `code`. El worker tiene `BullmqConnectionModule` sin colas registradas y su
comentario dice que el primer job llega con este change. Mongo es replica set en todos los entornos, así que hay
transacciones. Motivación y alcance: proposal.md; comportamiento: las specs. Decisiones humanas previas: los cinco
canonicalizadores del manifiesto entran ahora; al borrar un grupo se borran sus `GroupLink` y nunca los `JobLink`; la
visibilidad se elige al guardar y `settings.defaultVisibility` no entra.

## Goals / Non-Goals

**Goals:**
- Que la misma vacante compartida por varias personas sea un solo link, con la clave de ADR-008.
- Que el chat pegado se convierta en links guardados sin pasos intermedios.
- Que nada se pierda entre Mongo y BullMQ (ADR-009) y que `link-enrichment` solo tenga que implementar el consumidor.

**Non-Goals:**
- Enriquecer el preview (título, empresa, skills…) y, con él, el consumidor de la cola: es `link-enrichment`. Aquí no se
  registra ningún consumidor, para que los jobs esperen en la cola en lugar de descartarse (C2 de ADR-009).
- Comentarios, postulaciones, página pública y `settings.defaultVisibility`.
- Borrar el `JobLink` canónico, editarlo a mano y mover un link de un grupo a otro. Quitar la **relación** con un grupo o
  con la lista privada sí entra: sin ella, un chat importado deja ruido irreversible en un espacio compartido.
- Límite de intentos de `POST /groups/join`: se decide en el change que exponga links por código (anotado en el manifiesto).

## Decisions

### D1 — Módulo `links` y datos

```
apps/api/src/modules/links/
├── domain/          url.ts (normalización), canonicalizers/ (linkedin, computrabajo, indeed, trabajopolis, getonboard,
│                    generic, registry), job-link.ts, link-text.ts (extracción de URLs de un texto), errors.ts, limits.ts
├── application/     ports (JOB_LINK_REPOSITORY, GROUP_LINK_REPOSITORY, OUTBOX, LINKS_CLOCK, GROUP_MEMBERSHIP,
│                    LINK_USER_DIRECTORY), save-link, import-links, list-group-links, list-my-links,
│                    remove-group-link, remove-my-link, testing/ (dobles)
├── infrastructure/  mongo-job-link.repository.ts, mongo-group-link.repository.ts, link.schemas.ts,
│                    groups-facade-membership.ts
└── presentation/    links.controller.ts (POST /links, POST /links/import, GET /links/mine),
                     group-links.controller.ts (GET /groups/:id/links), links.module.ts
```

Colecciones:

- `job_links { _id, normalizedUrl, urlHash, dedupeKey (único), platform, externalJobId?, originalUrls[] (las 20
  últimas; la primera es `displayUrl`), previewStatus, previewVersion, createdBy, createdAt, updatedAt }`. `dedupeKey` es `"<platform>:<externalJobId>"` o
  `"url:<urlHash>"`, así que un único índice único cubre los dos casos de ADR-008 sin índices parciales que compitan.
- `group_links { groupId, linkId, sharedBy, sharedAt }` con índice único `(groupId, linkId)` e índice
  `(groupId, sharedAt, _id)` para el listado paginado. Los campos `comment`, `tags` y `pinned` de design.md llegan con
  `group-comments`.
- `user_links { userId, linkId, savedAt }` con índice único `(userId, linkId)` e índice `(userId, savedAt, _id)`: la
  lista privada. Se guarda cuando alguien guarda un link **sin** grupo; guardar en grupo no crea entrada privada, y eso
  implica que si el owner borra el grupo, quien solo lo guardó allí pierde el acceso (Risks).

`GET /groups/:id/links` vive en `links` (no en `groups`) porque su contenido es de este módulo. La pertenencia y el rol
se resuelven con `GroupsFacade` a través del puerto `GROUP_MEMBERSHIP` (nombre distinto del `GROUP_MEMBER_DIRECTORY` de
`groups`, que significa lo contrario), y los nombres visibles de quien compartió con `LINK_USER_DIRECTORY` sobre
`UsersFacade.getDisplayNames`, que ya existe y es entrada pública permitida.

### D2 — Normalización y canonicalización

`domain/url.ts` normaliza con `URL` de Node: minúsculas en esquema y host, `http`→`https`, sin `www.`, sin fragmento,
sin barra final salvo raíz, y sin los parámetros de campaña de la spec (lista cerrada, ordenando el resto para que el
hash sea estable). `urlHash` = `sha256(normalizedUrl)` en hex. La URL normalizada es **solo identidad**: forzar `https` o quitar `ref`/`trk`
puede producir una URL que no resuelve, así que lo que el SPA abre y lo que `link-enrichment` descargará es
`displayUrl` = `originalUrls[0]`, la primera URL que escribió una persona.

Cada canonicalizador es una función pura `(url: URL) => { platform, externalJobId } | null` registrada en un array; el
registro prueba en orden y cae en `generic`. Reglas por plataforma:

- **LinkedIn**: `/jobs/view/<id>`, `/comm/jobs/view/<id>` y `currentJobId=<id>`.
- **Computrabajo**: identificador de oferta del path (`.../ofertas-de-trabajo/oferta-de-trabajo-...-<id>.html`), ignorando el slug.
- **Indeed**: `jk=<id>` (también `vjk`).
- **Trabajopolis** y **Get on Board**: identificador numérico o slug estable del path, según sus formatos publicados.

Cada uno llega con una tabla de URLs reales anonimizadas en su test. Si una plataforma resulta más ambigua de lo previsto
durante el apply, se implementa como `generic` y se anota; no se inventan reglas.

### D3 — Dedupe y altas concurrentes

`save-link` normaliza, canonicaliza y calcula `dedupeKey`; después resuelve el link por esa clave: si no existe lo crea con
`displayUrl` fijado, y si existe añade la URL al historial con `$push … $slice: -20` solo cuando no estaba. El `$slice` acota el historial: sin él, una plataforma reconocida con un parámetro aleatorio
haría crecer el array sin límite hasta los 16 MB del documento y dejaría el link inescribible.

Un upsert simultáneo puede chocar con el índice único y lanzar 11000, que **no** es un `TransientTransactionError`: la
transacción aborta y no se puede continuar sobre la misma sesión. Por eso el reintento es de la **transacción entera**
(bucle externo de hasta 2 intentos sobre `withTransaction`, como el del código de invitación en `groups`); en el segundo
intento el documento ya existe y el upsert solo añade la URL. Así "Altas simultáneas de la misma URL" no falla y solo
queda un documento.

### D4 — Compartir y `alreadyInGroups`

Tras resolver el `JobLink`, el alta de `group_links` (o de `user_links`) es un `updateOne` con `upsert` sobre su índice
único, así que compartir dos veces no duplica ni cambia `sharedBy`; la respuesta indica que no se creó y quién lo había
compartido.

`alreadyInGroups` solo se calcula en `POST /links` (en la importación sería un agregado de 50 links que la UI no podría
atribuir, así que no entra en su contrato): una sola llamada a `GroupsFacade.getGroupsOf(userId)` —que se amplía para
devolver también `name`, dos líneas, en vez de añadir un método nuevo— y una consulta a `group_links` con `$in` de esos
grupos, quitando el destino.

### D5 — Importación de texto

`domain/link-text.ts` extrae URLs con una expresión conservadora (`https?://` hasta espacio o fin), recorta la puntuación
de cierre (`.,;:!?)]}»"'`), descarta las que no normalizan y deduplica por URL normalizada conservando el orden.
`import-links` aplica `save-link` a cada una en secuencia **con una transacción por link**: el motivo no es el tamaño del
oplog (desde Mongo 4.2 una transacción se reparte en varias entradas), sino aislar fallos y no tener una transacción
larga contra `transactionLifetimeLimitSeconds`. Si el texto trae más de 50 URLs, se procesan las 50 primeras y el resto
se cuenta en `skipped`, sin error: rechazar la importación entera dejaría al usuario sin progreso justo en el caso que
justifica el change (pegar meses de chat). El texto pasa por memoria y no se guarda ni se registra. El resumen cuenta
`created`, `existing`, `unrecognized` y `skipped`.

### D6 — Outbox y relay (ADR-009)

`apps/api/src/infrastructure/outbox/` (plataforma, no un módulo de dominio):

- `outbox_events { _id, type, payload, createdAt, publishedAt?, attempts, nextAttemptAt, failedAt? }`, índice parcial
  `(nextAttemptAt, createdAt)` sobre `publishedAt: null, failedAt: null` para tomar pendientes vencidos en orden.
- El puerto `OUTBOX` expone `append(event, session)`; los casos de uso lo llaman **dentro** de la transacción del alta.
- `OutboxRelay` es un `@Interval` de `@nestjs/schedule` (cada 1 s, configurable con `OUTBOX_RELAY_INTERVAL_MS`) que toma
  hasta 50 pendientes vencidos, publica en BullMQ con `jobId` determinista `enrich:<linkId>:<previewVersion>` y marca
  `publishedAt`. Ante error incrementa `attempts` y fija `nextAttemptAt = now + min(2^attempts s, 5 min)`; solo cuando el
  evento lleva más de 24 h sin publicarse marca `failedAt` y registra un `warn` con su id. Así un corte de Redis de
  minutos u horas no quema los intentos, que es justo lo que ADR-009 quiere evitar.
- La cola se crea con `removeOnComplete: { age: 86400, count: 1000 }` y `removeOnFail: { age: 604800 }`. Mientras el job
  vive, el `jobId` repetido evita duplicados; cuando la cola lo olvida, la garantía real es que **el consumidor sea
  idempotente**, requisito que hereda `link-enrichment` (anotado en el manifiesto).
- `OUTBOX_RELAY_ENABLED` (booleano) apaga el relay: va a `false` en `apiTestConfig` para que los tests de integración no
  lancen timers ni golpeen un Redis inexistente, y a `true` en `.env.example`. El relay solo se registra si está activo.
- Un evento por link creado: `LinkCreated { linkId, previewVersion }`. Contrato en `libs/shared/src/events/`.
- El relay corre en `api`: es quien escribe los eventos y así el worker no necesita acceso a `outbox_events`. Se puede
  mover a un proceso propio cuando haya más de un productor.

### D7 — Sin consumidor en este change

El worker **no** registra ningún consumidor de `enrich-link`: los jobs esperan en la cola hasta que `link-enrichment`
implemente la cadena de extractores, y los links siguen en `pending`. Un consumidor provisional que solo registrara un
log consumiría el job y lo descartaría, de modo que todo lo guardado durante la vida de este change no se enriquecería
nunca: exactamente la pérdida que el outbox existe para impedir. La verificación de este change llega hasta que el relay
publica; `link-enrichment` añade el consumidor y, si hubiera quedado algo sin encolar, su backfill (anotado en el
manifiesto).

### D7b — Cascada del borrado de grupo sin romper los límites entre módulos

> Superado por ADR-021 §6: el mecanismo final es la clase `GroupDeletionHooks` provista por `GroupsModule` y registrada
> por `LinksModule` en `onModuleInit`, ejecutada tras confirmar el borrado. El resto de esta decisión sigue vigente.

El borrado de grupo vive en `MongoGroupRepository.deleteGroup` (`groups`) y su `session` es privada; `groups` no puede
importar `links` ni al revés fuera de las entradas públicas. Para que "de forma atómica" sea cierto:

- `groups/application/ports/group-deletion-hook.port.ts` declara `GROUP_DELETION_HOOKS`, un multi-provider opcional con
  `deleteRelationsOf(groupId, session)`.
- `deleteGroup` ejecuta los hooks registrados **dentro** de su `withTransaction`, antes de borrar el grupo. Sin hooks
  registrados la lista está vacía y el borrado se comporta como hoy, así que `groups` sigue sin conocer a `links`.
- `LinksModule` registra su adaptador (`MongoGroupLinkRepository.deleteByGroup`) en ese token. La dependencia va de
  `links` a `groups`, que es la dirección permitida.

Es una decisión no trivial que afecta a un módulo ya archivado: se registra en ADR-021 junto con la clave de dedupe
unificada, el relay dentro de `api` y la colección `user_links`.

### D8 — Contratos y errores

`libs/shared/src/schemas/link.schema.ts`: `saveLinkRequestSchema` (`url` string 1..2048, `groupId?`),
`importLinksRequestSchema` (`text` 1..20000, `groupId?`), `jobLinkSummarySchema` (`id`, `normalizedUrl`, `displayUrl`,
`platform`, `previewStatus`, `sharedBy?`, `sharedAt`/`savedAt`), `saveLinkResponseSchema` (`link`, `created`,
`sharedBy?`, `alreadyInGroups[]`), `importLinksResponseSchema` (`created`, `existing`, `unrecognized`, `skipped`,
`links[]`), `listLinksQuerySchema` (`limit` 1..50, `cursor?`), `linkPageSchema` (`items[]`, `total`, `nextCursor?`),
`platformSchema` y `previewStatusSchema`. `apiErrorCodeSchema` suma `invalid_url` (400), `text_too_long` (400) y
`link_not_found` (404).

El cursor es opaco: base64url de `(sharedAt|savedAt, _id)`. El orden es por fecha y, a igualdad, por `_id`, ambos
descendentes, con índices `(groupId, sharedAt, _id)` y `(userId, savedAt, _id)`; sin ese desempate, importar 50 links en
el mismo instante haría que la paginación repitiera u omitiera filas.
`libs/shared/src/events/link-created.event.ts` define el evento de integración con su versión.

### D9 — SPA

- `core/links/links.api.ts` y `LinksStore` (`@ngrx/signals`) con la lista por grupo y la privada, paginadas por cursor.
- `features/links/link-list.component.ts`: lista reutilizada por el detalle del grupo y por `/mis-links`. Cada fila abre
  `displayUrl` en pestaña nueva con `rel="noopener noreferrer"`, muestra una etiqueta derivada de la URL (último segmento
  del path des-slugificado, o el dominio), la plataforma, quién compartió y "Sin vista previa todavía" (no "Preparando…":
  en este change nadie la prepara), y ofrece quitar el link a quien lo compartió y al owner.
- `features/links/save-link.form.ts` y `import-links.dialog.ts`: guardar una URL y pegar el chat, con el resumen y el
  aviso `alreadyInGroups`.
- `/mis-links` en la barra de navegación, junto a "Perfil".
- Mensajes por código (`invalid_url`, `text_too_long`, `link_not_found`) en el estilo de los changes anteriores; textos
  i18n ES/EN.

### D10 — Tests

- Dominio: tablas de URLs reales anonimizadas por canonicalizador, normalización, extracción de texto.
- Casos de uso: dobles en memoria con `GroupsFacade` falso; dedupe, `alreadyInGroups`, límites.
- Integración: `createApp` + `inject` sobre `mongodb-memory-server` con transacciones reales, incluidas altas
  concurrentes y el borrado de grupo que arrastra sus `GroupLink`.
- Outbox: relay contra Mongo real y una cola falsa, con reloj movible (publicación, reintento, agotamiento, idempotencia
  del `jobId`).
- Worker: sin consumidor; se verifica de forma estructural que `apps/worker` no registra ningún `Worker` para
  `enrich-link` y que el link sigue `pending` tras publicarse su evento.
- Web: TestBed con `HttpTestingController`; smoke de navegador en `apps/web-e2e` (guardar, abrir, importar un chat,
  quitar, ver la lista).

## Risks / Trade-offs

- **Canonicalizadores frágiles**: las plataformas cambian sus URLs. Cada uno es una función pura con su tabla de casos y
  cae en `generic` si no reconoce; una regla rota degrada a dedupe por URL, nunca mezcla vacantes distintas.
- **Falsos positivos de dedupe**: si dos vacantes distintas compartieran `externalJobId` en una plataforma, se fundirían.
  Se acota probando identificadores reales por plataforma y dejando el `platform` en la clave.
- **Una transacción por link en la importación**: 50 links son 50 transacciones cortas; a cambio, un fallo aislado no
  tira el resto. Si el coste se nota, se agrupa en lotes en un change posterior.
- **Relay en `api`**: acopla el reloj del relay a la API; con varias instancias, todas intentarían publicar. Mientras el
  job vive en la cola, el `jobId` determinista evita duplicados; cuando la retención lo olvida, la garantía es que el
  consumidor sea idempotente (requisito que hereda `link-enrichment`).
- **El texto pegado puede traer datos personales** (nombres, teléfonos del chat): solo se guardan las URLs extraídas,
  nunca el texto, y los logs no lo registran. Está escrito como requisito en `links/sharing`, no solo aquí.
- **Un link guardado solo dentro de un grupo desaparece para su autor si el owner borra el grupo**: no se crea entrada
  privada al compartir. Se acepta y se avisa en la confirmación de borrado, que ahora dice cuántas ofertas se pierden; la
  transferencia de propiedad (deuda de `groups`) reduce el caso.
- **Sin límite de peticiones en `POST /links/import`**: 50 URLs por llamada, pero nada impide repetirla. Se anota como
  deuda, con el mismo mecanismo de ventanas en Redis que usa `auth`.

## Migration Plan

Colecciones nuevas, sin datos previos. El worker no cambia: la cola se registra en `api` (con el relay activo) y los jobs se acumulan
en Redis, uno por link, hasta que `link-enrichment` añada el consumidor. Los eventos esperan en `outbox_events` mientras
el relay esté apagado o Redis no responda.

## Open Questions

- Formato exacto del identificador de Trabajopolis y Get on Board: se fija al escribir su tabla de URLs reales; si resulta
  ambiguo, la plataforma queda como `generic` y se anota en el manifiesto para `link-enrichment`.
