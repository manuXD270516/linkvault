## Context

El panel de nuevas features del 2026-11-25 (cuatro proponentes, crítico adversarial y cinco jurados) dejó a **C3
`group-weekly-brief`** segunda, a 3 puntos de 250 de `weekly-plan`, y los cinco jurados la propusieron como corte
siguiente. `weekly-plan` ya está fusionada (PR #98) y archivada (`openspec/changes/archive/2026-11-25-weekly-plan/`);
su design la dejó esbozada como «Cortes siguientes» §5: tabla de hechos de ofertas del grupo, viñetas por plantilla,
calculada en el worker y leída por la api, LLM sintetizador con evaluador determinista después.

**Condiciones del jurado y del crítico para el MVP** (se cumplen una a una; tabla al final de Decisiones):

1. Sin LLM: viñetas por plantilla desde una tabla de hechos con `factId`.
2. Solo datos de ofertas (públicos del link: habilidades ya clasificadas si existen, `closedAt`, `preview.expiresAt`,
   fecha de alta). Los conteos de estados de miembros con 3 a 5 personas no anonimizan y quedan fuera, salvo «no la
   sigue nadie» si el crítico lo acepta, con la decisión justificada.
3. Nunca notas, comentarios ni nombres de miembros.
4. Calculada en el worker por `(groupId, weekKey ISO UTC)`, idempotente; la api solo lee.
5. Evaluador determinista: cada viñeta cita un hecho existente y los números coinciden.
6. Cortes posteriores diseñados sin implementar: síntesis LLM `summarize-group-week` por `runTask` con tope de llamadas
   en código y mock `replay` con entradas canónicas; el mismo bloque en el correo del `group-digest`.

**Restricciones del owner para este change:** costo 0 (Oracle Always Free, una máquina); no tocar despliegue, CI ni
compose; si el worker necesita un flag o un cron, justificarlo, con valor por defecto seguro y sin variables nuevas
obligatorias; repo público; i18n ES/EN con tuteo.

Lo que ya existe y este change reutiliza (verificado en el código de `a6e943be`):

- **Cron semanal en el worker.** El digest de grupo registra un host `@Cron` dinámico en UTC
  (`apps/worker/src/modules/notifications/notifications.module.ts`, `createGroupDigestCronHost`) que solo se registra
  fuera de `NODE_ENV=test`, e importa `ScheduleModule.forRoot()` en ese mismo caso; su flag `FEATURE_GROUP_DIGEST` es
  opcional con `default('false')` (`apps/worker/src/infrastructure/config/worker-config.schema.ts:39-49`).
- **El worker lee las colecciones de ofertas directamente.** `MongoGroupDigestCatalog` pagina `groups` por `_id` de 50 en
  50, lee `group_links` por `(groupId, sharedAt)` con proyección sin `note`, etiquetas ni fijado, y luego `job_links`
  por `$in` (`notifications/infrastructure/persistence/mongo-group-digest.catalog.ts`). Índice
  `{ groupId: 1, sharedAt: -1, _id: -1 }` en `apps/api/src/modules/links/infrastructure/link.schemas.ts:253`.
- **Semana ISO.** `isoWeekKey`, `startOfIsoWeekUtc`, `windowForWeekKey` y `previousClosedIsoWeek` en
  `apps/worker/src/modules/notifications/domain/iso-week.ts`; copia de `isoWeekKey` con `previousWeekKey`/`nextWeekKey`
  en `apps/api/src/modules/applications/domain/weekly-plan/week-key.ts` (R5 de `weekly-plan`: «se unifica después»).
  La regex `^\d{4}-W\d{2}$` está repetida en `group-weekly-digest.event.ts` y en `weekly-plan.schema.ts`.
- **Datos de la oferta.** `closedAt` ausente = abierta (ADR-037); `preview.expiresAt` fecha `YYYY-MM-DD` o `null`, y un
  `expiresAt` pasado es cierre de calendario (ADR-041); `preview.skills` es una lista de `jobSkillSchema`
  (`{ name, required }`) de como mucho 40 (`libs/shared/src/schemas/preview.schema.ts:17`, `:57-60`, `:83`, `:87`). La
  ventana «cierra pronto» de `weekly-plan` es de hoy a hoy + 7 días (`WEEKLY_PLAN_CLOSING_SOON_DAYS = 7`).
- **Borrado de grupo.** `groups` ejecuta los hooks registrados dentro de su transacción
  (`groups/application/group-deletion-hooks.ts`); `links` registra el suyo (`links/presentation/links.module.ts:257-262`,
  `links/infrastructure/group-links-deletion.hook.ts`).
- **Pertenencia.** La fachada de `groups` expone `membershipOf(groupId, userId): GroupRole | null` e `isMember`
  (`groups/application/groups.facade.ts:34-48`).
- **Listado y detalle del grupo.** Rutas de `links` bajo `@Controller('groups')`
  (`links/presentation/group-links.controller.ts:46`, `@Get(':id/links')` en `:59`); reloj `LINKS_CLOCK`
  (`links/application/ports/clock.port.ts:3`). En el SPA, `/grupos/:id` es `features/groups/group-detail.page.*` y pinta
  `<lv-link-list>`, paginado; cada tarjeta es un `<li>` **sin `id`** (`features/links/link-list.component.html:43-45`),
  el router no tiene `anchorScrolling` y la tarjeta abre la oferta con `target="_blank"` y `rel="noopener noreferrer"`
  (`features/links/link-card.component.html:4-6`). Esto decide PO-6 (D9).
- **Privacidad vigente.** `applications/group-visibility`: «Una postulación privada NO SHALL aparecer, ni con su nombre
  ni con su estado, en ninguna respuesta dirigida a otra persona». `groups/know-someone`: solo conteo y `flaggedByMe`.
- **Producción no recibe flags del worker que no declara.** El servicio `worker` de `docker-compose.prod.yml` lista sus
  variables una a una y no reenvía `FEATURE_GROUP_DIGEST` ni `FEATURE_LINK_FRESHNESS`: en staging valen su valor por
  defecto. Esto decide D2.
- **IA de sistema sin cuota.** Una corrida de `runTask` sin `userId` no pasa por la cuota
  (`libs/ai/src/application/run-task.usecase.ts:156`) y `AI_QUOTAS` está vacío en producción; la clave de `replay` es
  `sha256(canonicalJSON([task, promptVersion, lang, input]))` (ADR-018 §3). Esto decide el corte 1.

## Goals / Non-Goals

**Goals**

- Que cualquier miembro vea, en la página del grupo, de 1 a 4 viñetas verificadas sobre las ofertas del grupo esta
  semana, cada una con sus ofertas a un toque.
- Cálculo en el worker, una vez por grupo y día, idempotente, determinista y sin IA; la api solo lee.
- Cero datos de miembros: ni postulaciones, ni marcas, ni notas, ni comentarios, ni etiquetas, ni quién compartió.
- Un evaluador determinista que el corte LLM reutiliza tal cual.

**Non-Goals (este change)**

- LLM, correo, web push, avisos, deltas contra la semana anterior. Diseñados en «Cortes siguientes».
- «No la sigue nadie» y cualquier conteo derivado de postulaciones o marcas de miembros (D4).
- Ofertas cerradas la semana pasada (ronda 1, H4 + PO-8): sin acción asociada y sin `closedAt` en staging.
- Resaltar la oferta dentro del listado del grupo (D9, PO-6: corte siguiente).
- Despliegue, CI, compose, variables obligatorias, `libs/ai`.

## Decisions

### D1. Se calcula en el worker, por `(groupId, weekKey)`, cada día; la api solo lee

La semana del grupo es un **documento por grupo y semana ISO UTC** en la colección nueva `group_weekly_briefs`, con
índice **único** `(groupId, weekKey)`. Lo escribe solo el worker, que lo **recalcula cada día** (ronda 1, PO-1) con
`replaceOne` + `upsert` sobre esa clave. La api lo lee y nunca lo escribe ni lo recalcula; la única operación de la
api sobre la colección es el borrado en cascada del grupo, por su propio hook (D11, ronda 1, H9).

Por qué en el worker y no al leer (como `weekly-plan`): (a) es la condición 4 del jurado; (b) todos los miembros ven
**los mismos números** el mismo día; (c) el corte LLM necesita un punto único de cálculo para acotar llamadas, y el
corte del correo necesita el mismo bloque que la tarjeta; (d) la lectura se vuelve un `findOne` y no depende del tamaño
del grupo.

Por qué cada día y no una sola vez por semana (PO-1, V0 de negocio): una oferta compartida el martes que cierra el
jueves tiene que aparecer el miércoles, no el lunes siguiente. La idempotencia pasa a ser **por día**: con los mismos
datos, el mismo día da el mismo documento, y un segundo tick del mismo día no escribe nada (`unchanged`, D2).

*Alternativas descartadas:* on-read en la api (números que dependen de cuándo mira cada uno y un LLM por lectura en el
corte 1); cron en la api (la api no tiene scheduler y el worker ya tiene el patrón del digest); una sola vez por semana
(propuesta original: congelaba la semana el lunes; PO-1 la descartó).

### D2. Cuándo: tick diario a las 05:00 UTC y al arrancar, sobre todos los grupos

- **Tick.** `@Cron(GROUP_BRIEF_CRON, { timeZone: 'UTC' })` con `GROUP_BRIEF_CRON = '0 5 * * *'` como **constante en
  código**, no como variable. Cada tick pagina `groups` por `_id` (50 por página), lee de una vez los documentos de la
  semana en curso de esa página y, por cada grupo, calcula y convierte el resultado con `toDocument`. La comparación se
  hace **en el espacio del documento** (ronda 2, N4): EJSON canónico sin `_id` ni `computedAt`. Si es igual al guardado
  cuenta `unchanged` y no escribe; si no —o si el guardado no se puede leer—, `replaceOne(..., { upsert: true })` y
  cuenta `upserted`.
- **Semana.** `weekKey = isoWeekKey(now)` (la semana **en curso**, no la cerrada del digest) y `asOf` = fecha UTC del
  cálculo `YYYY-MM-DD`. El lunes nace el documento de la semana nueva; el de la anterior queda hasta el TTL.
- **Día vacío (ronda 2, N1 + R2-1).** Si el cálculo de un día no produce ninguna viñeta (D5), el worker hace
  `deleteOne({ groupId, weekKey })` y cuenta `cleared`: la api devuelve `brief: null` y el grupo ve el vacío honesto, en
  vez de una semana vieja que ya no es verdad.
- **Rechazo.** Si el resultado no pasa el evaluador (D6), no se escribe, se **conserva** la versión anterior y queda la
  línea de log del rechazo (cuenta `rejected`): un error del cálculo no debe borrar lo que era verdad.
- **Concurrencia.** Dos ticks sobre el mismo grupo convergen en un solo documento por el índice único; un error de clave
  duplicada en el `upsert` se reintenta una vez como `replaceOne` sin `upsert`. Un guardia en memoria evita dos ticks
  solapados del mismo proceso.
- **Arranque (ronda 1, H2 y H3).** En `onApplicationBootstrap` el módulo **espera** a que los índices existan
  (`await Model.init()`, que ejecuta `createIndexes` también sobre una colección vacía) y **después** dispara el tick con
  `void scheduler.tick().catch(log)`: el arranque nunca espera al tick ni falla por él. `tick()` **nunca relanza**:
  captura y registra cualquier error. **Si crear los índices falla (ronda 2, N2)**, `ensureGroupBriefIndexes()` lo
  captura, registra el error y deja el módulo **sin cron ni tick** hasta el próximo arranque; el arranque del worker
  sigue. Cambiar el TTL más adelante exige `collMod` (`createIndexes` no modifica un índice existente): lo dice el
  RUNBOOK.
- **Resumen por tick (ronda 1, PO-4).** Una línea de log por tick: `{ weekKey, groupsScanned, upserted, unchanged,
  cleared, rejected, bulletsByKind: { closing_soon, skill_demand, shared_last_week } }`, **sin `groupId`** ni contenido. El
  RUNBOOK explica cómo sumarla por semana. La línea de rechazo (D6) sí lleva `groupId` para poder depurar, nunca
  contenido.
- **Dependencia de `@nestjs/schedule` (ronda 1).** `GroupBriefModule` importa `ScheduleModule.forRoot()` en las mismas
  condiciones que `NotificationsModule` (fuera de `NODE_ENV=test`). La tarea 3.9c comprueba que con los dos módulos el
  cron del digest sigue registrado y que no hay dos registros del mismo host.
- **Flag (ronda 1, H7: Q1 resuelta).** `FEATURE_GROUP_BRIEF`, **opcional**, `z.enum(['true','false']).default('true')`.
  Con `false`, ni cron ni tick de arranque. Va **al revés** que el digest y que `FEATURE_LINK_FRESHNESS` a propósito: el
  compose de producción no reenvía al worker variables que no declara (Context), así que un `default('false')` dejaría
  la feature muerta en staging sin tocar el compose, que este change no puede tocar. Es aceptable encendido solo porque
  el trabajo no sale de Mongo (sin red, IA ni correo), el arranque no depende del tick (H2), los índices existen antes
  (H3) o, si no se pueden crear, el módulo se apaga sin tumbar el arranque (ronda 2, N2), y el tick nunca relanza. Precio escrito: en staging el interruptor no es operable sin un change de compose; la
  salida es revertir. `.env.example` lleva la línea con un comentario que explica por qué este flag está encendido por
  defecto, y `apps/worker/src/test-support/test-config.ts` lo fija explícitamente. ADR-069 §2 nombra la excepción.

*Alternativas descartadas:* solo el lunes (ver D1); cola BullMQ con `jobId` por día (la idempotencia la da la
comparación con lo guardado y el reintento lo da el tick del día siguiente); cron como variable de entorno.

### D3. Universo y tabla de hechos

**Universo del grupo:** sus `group_links` ordenados por `sharedAt` desc y `_id` desc, como mucho
`GROUP_BRIEF_SCAN_MAX = 500` (se leen 501 para saber si hay más: `scanTruncated`, que queda en el documento para el
RUNBOOK y no se muestra), y de cada uno su `job_link` con proyección `closedAt`, `preview.expiresAt` y
`preview.skills` y nada más. **Dos lecturas por grupo**, sea cual sea el número de ofertas. Una oferta está
**abierta** si no tiene `closedAt` y su `expiresAt` es `null` o `≥ asOf` (un `expiresAt` pasado es cierre de
calendario aunque el detector aún no pasara, ADR-041). Cada habilidad leída se valida con `jobSkillSchema`
(ronda 1, H10); la que no valida se ignora, sin error.

**Hechos** (`kind`, `factId`, cuándo existe y qué guarda). Cada lista de ofertas va en el orden del universo
(`sharedAt` desc, `_id` desc) y sin repetidos.

| `kind` | `factId` | Existe si | Guarda |
|---|---|---|---|
| `open_offers` | `open_offers` | siempre que haya viñetas | `count`, `linkIds` de las abiertas |
| `closing_soon` | `closing_soon` | ≥ 1 abierta con `expiresAt` en `[asOf, asOf+7]` | `count`, `linkIds`, `from` = `asOf`, `until` = `asOf`+7 días, `firstExpiresAt` = el menor `expiresAt` |
| `skill_demand` | `skill_demand:<skillKey>` | ≥ 2 abiertas mencionan la habilidad | `skillKey`, `skillLabel`, `count`, `total`, `linkIds` |
| `shared_last_week` | `shared_last_week` | ≥ 1 `group_link` con `sharedAt` en la semana W−1 | `count`, `linkIds`, `weekKey` = W−1 |

- **Habilidades.** `skillKey` = `name` con `normalize('NFKC')`, recortado, espacios internos colapsados y en minúsculas;
  vacía o de más de 60 caracteres se ignora. Cada oferta cuenta una vez por clave aunque la repita. `total` = abiertas
  con al menos una habilidad válida (el denominador honesto). `skillLabel` = la forma original recortada más frecuente
  de esa clave (contada una vez por oferta); empate, la menor por orden de unidades de código. Se guardan como mucho
  `GROUP_BRIEF_SKILL_FACTS_MAX = 5` hechos de habilidad, por `count` desc y `skillKey` asc. Obligatorias y deseables
  cuentan igual, y por eso el texto dice «aparece en», no «exigen».
- **`closing_soon`** usa la misma ventana que `weekly-plan` (ronda 1, PO-9): de `asOf` a `asOf` + 7 días, ambos
  incluidos, reutilizando `WEEKLY_PLAN_CLOSING_SOON_DAYS`. El texto dice la fecha del **primer** cierre
  (`firstExpiresAt`, ronda 2, R2-2), no el final de la ventana, y cada oferta desplegada muestra su propia fecha.
- **`shared_last_week`** cuenta también ofertas ya cerradas: lo que dice es «se compartieron», no «siguen abiertas».
- `factId` es **estable y legible**: el mismo hecho otro día tiene el mismo `factId` (D13).

*Alternativas descartadas:* `closed_last_week` (ronda 1, H4 + PO-8: sin `closedAt` en staging no aparece, y no lleva a
ninguna acción); «ofertas sin fecha de cierre» (sin acción); modalidad o salario (cubiertos por los filtros de búsqueda);
etiquetas del grupo (las escriben los miembros: D4).

### D4. Privacidad: solo datos de las ofertas, y por qué «no la sigue nadie» queda fuera

**Regla (ronda 1, H5).** El cálculo lee **solo** atributos de la oferta y de su alta en el grupo: `closedAt`,
`preview.expiresAt`, `preview.skills` y `group_links.sharedAt`. **No lee** `applications`,
`group_links.knowSomeoneUserIds`, `note`, `tags`, `pinned`, `sharedBy`, comentarios ni datos de usuarios, y el documento
no contiene identificadores, nombres ni texto escrito por un miembro **sobre sí mismo o sobre el grupo**. `skillLabel` es
**dato de la oferta**: sale de su preview y el listado del grupo ya lo muestra en la tarjeta, aunque un miembro lo haya
corregido a mano con la edición de preview (ADR-010). El catálogo del worker proyecta solo esos campos (no hay un `find`
sin proyección) y el tipo del documento no admite campos de usuario.

**«No la sigue nadie» queda fuera (ronda 1: Q2 = (a)).** Se calcularía sobre las postulaciones de todos los miembros,
que nacen **privadas** (ADR-024, `applications/group-visibility`), y filtra estado privado:

- Su complemento se deduce del listado: lo que no aparece como «no la sigue nadie» lo sigue alguien. En un grupo de
  2 personas, Ana sabe exactamente qué ofertas sigue Beto; con 3 a 5, lo reduce a una o dos personas.
- Cada viñeta enlaza a sus ofertas, así que la lista exacta queda expuesta, no un total agregado.
- Contradice la letra de «Privada por defecto»: una postulación privada influiría en una respuesta dirigida a otra
  persona.

Con 3 a 5 miembros ningún umbral mínimo de grupo lo anonimiza. Por la misma razón, el conteo de «conozco a alguien»
también queda fuera: ya se ve por tarjeta y agregarlo no aporta.

**Ofertas quitadas del grupo (ronda 1, H14).** El documento guarda `linkIds` de ofertas, no de personas. Si una oferta
sale del grupo, desaparece del documento en el recálculo del día siguiente (y si con eso no queda ninguna viñeta, la
semana se borra, D2); mientras tanto la lectura la excluye (D8).
Un `linkId` en un documento no revela nada que el miembro no haya podido ver en el listado.

### D5. Viñetas por plantilla, como mucho 4

Una viñeta es `{ factId, source: 'template' }`: **no lleva texto ni números propios**. El SPA arma el texto desde el
hecho citado con `$localize` (D9). Selección determinista, en este orden y saltando lo que no existe (ronda 1, H4):

1. `closing_soon`;
2. el primer `skill_demand` (más ofertas; desempate `skillKey` asc);
3. `shared_last_week`;
4. el segundo `skill_demand`.

Tope `GROUP_BRIEF_MAX_BULLETS = 4` (lo máximo que permiten los hechos sin `closed_last_week`) en el dominio y en el
contrato (`.max(4)`); como mucho `GROUP_BRIEF_SKILL_BULLETS_MAX = 2` de habilidades. `open_offers` **no** es viñeta: es
la línea de cabecera. Con 0 viñetas se borra la semana guardada (D2, ronda 2). El mínimo es 1 (ronda 1: Q3 = (a)).

### D6. Evaluador determinista compartido

`verifyGroupWeeklyBrief(brief): { ok: true } | { ok: false; violations: readonly GroupBriefViolation[] }`, función pura
en `libs/shared`, sobre el **contrato** (D7), no sobre el documento de Mongo. Comprueba:

1. `factId` únicos; existe exactamente un `open_offers`; cada `factId` corresponde a su `kind` (los de habilidad,
   `skill_demand:<skillKey>` con el `skillKey` del hecho).
2. Cada viñeta cita un hecho **existente** que no es `open_offers`; sin viñetas repetidas; de 1 a 4; como mucho 2 de
   habilidad.
3. En cada hecho, `count === linkIds.length` y sin ids repetidos.
4. `closing_soon.linkIds` y cada `skill_demand.linkIds` ⊆ `open_offers.linkIds`; `skill_demand`: `2 ≤ count ≤ total ≤
   open_offers.count`.
5. Fechas: `closing_soon.from === asOf`, `until === asOf + 7 días` y `from ≤ firstExpiresAt ≤ until` (ronda 2,
   R2-2; código `closing_window_invalid`); `shared_last_week.weekKey` = la semana anterior a
   la del documento.

Códigos: `duplicate_fact_id`, `open_offers_missing`, `fact_id_kind_mismatch`, `bullet_fact_missing`,
`bullet_cites_open_offers`, `duplicate_bullet`, `too_many_bullets`, `too_many_skill_bullets`, `count_mismatch`,
`duplicate_link_id`, `not_subset_of_open`, `skill_total_invalid`, `closing_window_invalid`, `previous_week_invalid`.

Dónde corre: el **worker**, antes de escribir (lo que no pasa no se escribe; log con `groupId`, `weekKey` y códigos,
nunca contenido); y la **api**, al leer (lo que no pasa se responde como `brief: null` y se registra igual). Es la red
de seguridad del corte LLM.

### D7. Contrato en `libs/shared` y documento de Mongo, separados

**Contrato** (`libs/shared/src/schemas/group-weekly-brief.schema.ts`), con tipos de transporte (strings):

```ts
GROUP_BRIEF_MAX_BULLETS = 4; GROUP_BRIEF_SKILL_BULLETS_MAX = 2; GROUP_BRIEF_SKILL_FACTS_MAX = 5
GROUP_BRIEF_SKILL_MIN_OFFERS = 2; GROUP_BRIEF_SCAN_MAX = 500; GROUP_BRIEF_OFFERS_PER_BULLET = 10
GROUP_BRIEF_TTL_DAYS = 35            // la ventana de cierre reutiliza WEEKLY_PLAN_CLOSING_SOON_DAYS (7)
objectIdString = z.string().regex(/^[0-9a-f]{24}$/)
linkIds = z.array(objectIdString).max(GROUP_BRIEF_SCAN_MAX)
groupBriefFactSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('open_offers'), factId: z.literal('open_offers'), count: int.min(0), linkIds }),
  z.strictObject({ kind: z.literal('closing_soon'), factId: z.literal('closing_soon'), count: int.min(1), linkIds,
                   from: z.iso.date(), until: z.iso.date(), firstExpiresAt: z.iso.date() }),
  z.strictObject({ kind: z.literal('skill_demand'), factId: z.string().regex(/^skill_demand:.{1,60}$/),
                   skillKey: z.string().min(1).max(60), skillLabel: z.string().min(1).max(60),
                   count: int.min(2), total: int.min(2), linkIds }),
  z.strictObject({ kind: z.literal('shared_last_week'), factId: z.literal('shared_last_week'), count: int.min(1),
                   linkIds, weekKey: isoWeekKeySchema }),
])
groupBriefBulletSchema = z.strictObject({ factId: z.string().min(1), source: z.literal('template') })
groupWeeklyBriefSchema = z.strictObject({
  version: z.literal(1), groupId: objectIdString, weekKey: isoWeekKeySchema, asOf: z.iso.date(),
  computedAt: z.iso.datetime(), scanTruncated: z.boolean(),
  facts: z.array(groupBriefFactSchema).min(1).max(8), bullets: z.array(groupBriefBulletSchema).min(1).max(4),
})
// Vista para el SPA, variante por variante (ronda 1, H13): la misma unión sin linkIds, escrita explícitamente.
groupBriefFactViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('closing_soon'), count: int.min(1), from: z.iso.date(), until: z.iso.date(),
                   firstExpiresAt: z.iso.date() }),
  z.strictObject({ kind: z.literal('skill_demand'), skillLabel: z.string().min(1).max(60), count: int.min(2),
                   total: int.min(2) }),
  z.strictObject({ kind: z.literal('shared_last_week'), count: int.min(1), weekKey: isoWeekKeySchema }),
])
groupBriefOfferSchema = z.strictObject({ linkId: objectIdString, displayUrl: z.string().min(1),
                                         title: z.string().optional(), company: z.string().optional(),
                                         expiresAt: z.iso.date().optional() })   // solo en ofertas de closing_soon
groupWeeklyBriefResponseSchema = z.strictObject({
  weekKey: isoWeekKeySchema,                          // la semana en curso, haya documento o no
  brief: z.strictObject({
    asOf: z.iso.date(), openOffers: int.min(0),
    bullets: z.array(z.strictObject({
      factId: z.string().min(1), fact: groupBriefFactViewSchema,
      offers: z.array(groupBriefOfferSchema).max(GROUP_BRIEF_OFFERS_PER_BULLET),
      moreCount: int.min(0), missingCount: int.min(0),
    })).min(1).max(4),
  }).nullable(),
})
```

`isoWeekKeySchema` vive **una sola vez** en `libs/shared/src/time/iso-week.ts` (ronda 1, H12) y lo importan el evento del
digest, `weekly-plan.schema.ts` y este contrato. La respuesta no lleva `linkIds`, `computedAt` ni `scanTruncated`
(ronda 1: sin «(de las 500…)»).

**Documento de Mongo (ronda 1, H1).** `GroupWeeklyBriefDocument`, tipo **de infraestructura** (no de `libs/shared`):
`{ groupId: ObjectId, weekKey: string, asOf: string, computedAt: Date, version: 1, scanTruncated: boolean, facts:
[...], bullets: [...] }`, con los `linkIds` de los hechos como **strings** de 24 hexadecimales. `toDocument` **no** pone
`_id` (ronda 2, N3): lo asigna Mongo en el primer `upsert` y `replaceOne` lo conserva; el fixture tampoco lo lleva. El
store del worker lo construye con `toDocument(brief)` y el reader de la api lo convierte con `fromDocument(doc)` antes de
validar con zod y con el evaluador. Para que los dos lados no diverjan, un fixture canónico EJSON
(`libs/shared/src/testing/group-weekly-brief.document.ejson`) es lo que escribe el store en su test y lo que lee el
reader en el suyo; además, un test de integración del worker lee con un `fromDocument` equivalente lo que escribió el
store. Las comparaciones con el fixture usan `EJSON.parse(texto, { relaxed: false })` y `toEqual`, y la ruta se
resuelve con un `workspaceRoot()` común a los dos tests (ronda 2, N6). `version` permite que el corte LLM añada `source: 'llm'` sin romper documentos viejos.

### D8. Lectura en la api: `GET /api/groups/:id/weekly-brief`

En el módulo `links` (las viñetas son sobre sus ofertas y la ruta vive con `:id/links`): caso de uso
`GetGroupWeeklyBrief` y puerto `GROUP_WEEKLY_BRIEF_READER` (`findCurrent(groupId, weekKey): Promise<GroupWeeklyBrief |
'invalid' | null>`, que hace `fromDocument` + zod; el caso de uso aplica el evaluador). Pasos:

1. Pertenencia con `membershipOf(groupId, userId)` de la fachada de `groups` (ronda 1, H11); `null` o `:id` mal formado
   → `404 group_not_found`.
2. `weekKey = isoWeekKey(LINKS_CLOCK.now())`; lee el documento de **esa** semana (no cae a la anterior). Sin documento,
   inválido o que no pasa el evaluador → `200 { weekKey, brief: null }`.
3. Por la unión de los `linkIds` de los hechos citados: **una** lectura de `group_links` (`groupId`, `linkId $in`)
   para quedarse con los que **siguen en el grupo**, y **una** de fichas de `job_links` (`displayUrl`, título, empresa
   y `preview.expiresAt`, que solo se devuelve en las ofertas de `closing_soon`, ronda 2, R2-2).
4. Por viñeta: `offers` = las primeras 10 que siguen en el grupo, en el orden del hecho; `moreCount` = las demás que
   siguen; `missingCount` = `count` − las que siguen. El texto usa los números del hecho; `missingCount` explica la
   diferencia hasta el recálculo del día siguiente.

Lecturas fijas: pertenencia, documento, relaciones y fichas. **No escribe nada.** Sin códigos de error nuevos. Los
índices los declara el worker; la api lee la colección sin modelo con `autoIndex`.

### D9. Tarjeta «La semana del grupo» en `/grupos/:id`

`GroupWeeklyBriefCardComponent` (`features/groups/group-weekly-brief-card.component.*`) en
`group-detail.page.html`, **encima** del listado de links y debajo del formulario de guardar, a todo el ancho, también
en el móvil. Store propio `core/groups/group-weekly-brief.store.ts` (`@ngrx/signals`) y cliente
`core/groups/group-weekly-brief.api.ts` que valida con el schema de `libs/shared`: un fallo de la tarjeta **no** bloquea
el detalle ni el listado.

- **Cabecera (ronda 1, PO-1 y «sin (de las 500…)»):** «La semana del grupo» y debajo «Actualizada el {fecha} · N
  ofertas abiertas» (singular «1 oferta abierta»). Pie fijo: «Solo cuenta datos de las ofertas, nunca lo que hace cada
  miembro.»
- **Viñeta:** el texto en una línea y un botón «Ver ofertas (N)» / «Ocultar ofertas» (N = `offers.length` +
  `moreCount`), con `aria-expanded`, `aria-controls` y alto mínimo de 44 px (`min-h-11`). Desplegada: cada oferta con
  su título (o `displayUrl`) y empresa —y, en `closing_soon`, «cierra el {fecha}» / «closes on {date}» con su
  `expiresAt`—, enlazada a `displayUrl` con `target="_blank"` y `rel="noopener noreferrer"`;
  si `moreCount > 0`, «y N más en el listado del grupo»; si `missingCount > 0`, «N ya no están en el grupo». Con N = 0
  el botón no se muestra y solo queda esa línea.
- **PO-6 (decidido en la ronda 1): enlace externo, sin ancla interna.** El listado del grupo no tiene `id` por
  tarjeta, el router no hace `anchorScrolling` y el listado está paginado (una oferta puede no estar cargada), así que
  un `#link-<id>` hoy no lleva a ningún sitio. Se queda el enlace a la oferta, como la tarjeta de link; el ancla
  interna (ids `link-<id>` en `link-list`, `anchorScrolling` y cargar la página que contiene la oferta) es el corte
  siguiente §3.
- **Cargando:** esqueleto de 3 líneas con `aria-busy="true"`. **Vacío** (`brief: null`, ronda 1, H6 + PO-2): «Todavía
  no hay novedades para resumir esta semana.» y «Aparecen cuando una oferta del grupo cierra de hoy a 7 días, dos o
  más mencionan la misma habilidad o se compartieron ofertas la semana pasada. Se revisa cada mañana.» (ronda 2, R2-3 +
  N7). **Error:**
  «No pudimos cargar la semana del grupo.» con «Reintentar».
- **Fechas:** `asOf`, `firstExpiresAt` y `expiresAt` son fechas sin hora; se formatean en UTC con `Intl.DateTimeFormat(locale, { weekday:
  'long', day: 'numeric', month: 'long', timeZone: 'UTC' })` («lunes, 23 de noviembre» / «Monday, November 23»).
- **Textos de las viñetas** (función pura `groupBriefBulletText(fact, locale)` con **un mensaje `$localize` por
  variante**, singular y plural elegidos en código, como `weeklyPlanReasonText`):

  | Hecho | Español | English |
  |---|---|---|
  | `closing_soon`, 1 | `1 oferta cierra el {firstExpiresAt}.` | `1 offer closes on {firstExpiresAt}.` |
  | `closing_soon`, N | `N ofertas cierran en los próximos días; la primera, el {firstExpiresAt}.` | `N offers close soon; the first on {firstExpiresAt}.` |
  | `skill_demand` | `{skill} aparece en N de las M ofertas abiertas con habilidades detectadas.` | `{skill} appears in N of the M open offers with detected skills.` |
  | `shared_last_week`, 1 | `Se compartió 1 oferta en el grupo la semana pasada.` | `1 offer was shared in the group last week.` |
  | `shared_last_week`, N | `Se compartieron N ofertas en el grupo la semana pasada.` | `N offers were shared in the group last week.` |

  Resto de textos EN: «The group's week», «Updated on {date} · N open offers» / «1 open offer», «It only counts offer
  data, never what each member does.», «Show offers (N)», «Hide offers», «and N more in the group list» / «and 1 more in
  the group list», «N are no longer in the group» / «1 is no longer in the group», «There is nothing to summarize for
  this week yet.», «They appear when an offer in the group closes between today and 7 days from now, two or more mention
  the same skill, or offers were shared last week. It is checked every morning.», «We couldn't load the group's week.», «Retry».
  En español, el singular de las dos últimas variables: «y 1 más en el listado del grupo» y «1 ya no está en el grupo».
- Ids `@@groups.weeklyBrief.*`; `messages.xlf` se regenera y `messages.en.xlf` se traduce (ADR-050). `{skill}` es la
  etiqueta tal como vino de la oferta y no se traduce.

### D10. `isoWeekKey` unificada en `libs/shared`

`libs/shared/src/time/iso-week.ts` con `startOfIsoWeekUtc`, `isoWeekKey`, `previousWeekKey`, `nextWeekKey`,
`startOfWeekKeyUtc`, `windowForWeekKey`, `previousClosedIsoWeek` e `isoWeekKeySchema`, movidas del worker y de
`applications` con **los mismos vectores de test** de las dos copias. Las copias se borran y sus usos importan de
`@linkvault/shared`. Cierra R5 de `weekly-plan`.

### D11. Borrado, retención y cuenta

- **Borrado de grupo (ronda 1, H9):** hook **propio** `GroupWeeklyBriefDeletionHook`
  (`links/infrastructure/group-weekly-brief-deletion.hook.ts`), registrado por `links` en `GroupDeletionHooks` junto al
  de relaciones, que borra `group_weekly_briefs` con `{ groupId }` dentro de la misma sesión; si falla, no se borra
  nada. Separado del hook de relaciones para que cada uno tenga un solo motivo de cambio y su propio test.
- **Retención:** índice TTL de 35 días sobre `computedAt` (`expireAfterSeconds` 3 024 000). Con el recálculo diario,
  `computedAt` es la última escritura; la semana en curso nunca caduca mientras se reescriba, y las anteriores
  desaparecen a los 35 días de su última versión.
- **Borrado de cuenta:** nada que hacer: los documentos no tienen datos de usuario (D4). Se dice en la spec para que
  nadie lo añada «por si acaso».
- **Ofertas quitadas del grupo:** salen del documento en el recálculo siguiente (si no queda ninguna viñeta, la semana
  se borra: ronda 2, N1); mientras tanto, la lectura las excluye (D4, H14).

### D12. Seed demo

Tres links demo ganan habilidades por el mismo camino de edición de preview (`ensurePreview`): `openSalary` (Docker,
TypeScript, NestJS), `staleApp` (Docker, Kotlin) y `closingSoon` (Docker, TypeScript, SQL). Con lo que ya hay
(`closingSoon` vence en 3 días), el grupo demo produce al calcular, en este orden relativo: `closing_soon`, «3 de 3 …
Docker» y «2 de 3 … TypeScript» → **al menos tres viñetas** (si un `sharedAt` del seed cayera en W−1, aparecería además
`shared_last_week` entre las dos de habilidad). Para verlo en local basta reiniciar el worker tras el seed (tick de
arranque).

### D13. Entradas canónicas desde ya

El dominio del worker trabaja sobre un **universo canónico**: ofertas con id opaco, fechas `YYYY-MM-DD`, habilidades ya
normalizadas, en un orden fijo; los hechos salen ordenados y con `factId` estables. Es lo que hace que, en el corte 1, la
entrada del LLM (los hechos con ids sintéticos `f1…fN` en ese orden) tenga una clave `replay` estable.

### Condiciones del jurado → decisiones

| Condición | Dónde |
|---|---|
| 1. Sin LLM; viñetas por plantilla desde hechos con `factId` | D3, D5, D9 |
| 2. Solo datos de ofertas; conteos de miembros fuera; «no la sigue nadie» justificado | D3, D4 |
| 3. Nunca notas, comentarios ni nombres | D4 (proyecciones y test de serialización) |
| 4. En el worker por `(groupId, weekKey)`, idempotente; api solo lee | D1, D2, D8 (idempotencia por día tras PO-1) |
| 5. Evaluador determinista: hecho existente y números que coinciden | D6 |
| 6. Cortes LLM y correo diseñados sin implementar | Cortes siguientes §1 y §2 |

## Cortes siguientes (diseñados, fuera de las tareas de este change)

Cada corte es un change propio, con su debate y su aprobación, y ninguno se abre antes de fusionar este.

1. **`group-weekly-brief-llm` — síntesis `summarize-group-week`.** Tarea nueva por `runTask` (`KNOWN_TASK_NAMES`,
   prompt `summarize-group-week.v1.md`, `temperature 0`, salida zod), ejecutada en el cálculo del worker, después de los
   hechos y antes de escribir.
   - **Entrada canónica:** los hechos en el orden de D13 con ids sintéticos `f1…fN`, números, `skillLabel` y fechas
     relativas («dentro de 6 días»), `outputLanguage` del grupo; **sin** `linkIds`, títulos, empresas, nombres de grupo
     ni de personas. Pasa igual por `PiiRedactor` hacia proveedores `external`.
   - **Salida:** `{ sentences: { text: string(≤160), factIds: z.enum([f1…fN]).array().min(1).max(3) }[] }` de 1 a 3,
     **enum cerrado construido por petición**.
   - **Evaluador ampliado** (misma función de D6 con `source: 'llm'`): cada frase cita hechos existentes; todo número
     del texto es un `count`, `total` o día relativo de un hecho citado; toda `skillLabel` nombrada pertenece a un hecho
     citado; sin fechas absolutas, URLs ni `@`. Falla → un repair, luego el siguiente proveedor, luego **las viñetas por
     plantilla** (degradación honesta).
   - **Tope en código, no en `AI_QUOTAS`** (vacío en producción, y una corrida de sistema sin `userId` no tiene cuota).
     Con el recálculo diario (PO-1) el cálculo único ya no acota solo: el LLM corre **solo si cambió el hash canónico de
     los hechos** respecto de la última síntesis guardada, como mucho **1 llamada por `(groupId, weekKey, día)`** y
     **3 por `(groupId, weekKey)`**, más un **tope diario global** `GROUP_BRIEF_LLM_DAILY_MAX` (constante, propuesta 20)
     contado con `{ _id: 'group-brief-llm:<YYYY-MM-DD>', n }` y `$inc` condicionado a `n < max`; agotado, plantillas.
     Repair y siguiente proveedor cuentan dentro de la misma llamada lógica, con un máximo de 3 intentos.
   - **Mock y eval:** fixtures `replay` grabadas con `nx run ai:record-fixtures` sobre entradas canónicas; golden
     sintético; `nx run ai:eval --provider=mock --update-baseline` en el mismo commit; métricas
     `schema_validity_rate`, `citation_validity_rate` y `number_match_rate` con puerta 1,0.
   - **Decisiones que necesitará del owner:** consentimiento (los hechos no son datos de una persona, pero la corrida es
     de sistema y hoy `aiConsent` es por usuario) e idioma del grupo.
2. **El bloque en el correo del `group-digest`.** El digest corre el lunes a las 14:00 UTC sobre W−1; para entonces ya
   existe la semana W (05:00). Si existe y pasa el evaluador, el correo añade las viñetas renderizadas por plantillas de
   correo ES/EN (por `MailLocale`) desde los mismos hechos, sin ofertas desplegadas y con el CTA al grupo; si no existe,
   el correo no cambia. Mismo tipo `group_weekly_digest`, misma preferencia de opt-out. Hoy `FEATURE_GROUP_DIGEST` está
   apagado en staging (Context): el corte también decide si se enciende.
3. **Ancla interna en el listado del grupo (PO-6).** `id="link-<id>"` en cada `<li>` de `link-list`,
   `withInMemoryScrolling({ anchorScrolling: 'enabled' })` y, si la oferta no está en la página cargada, cargar la
   página que la contiene; entonces la viñeta enlaza primero a `#link-<id>` y el enlace externo queda secundario.
4. **Deltas contra la semana anterior** («Docker: de 2 a 4 ofertas»): con W−1 retenida por el TTL, hechos nuevos
   `*_delta` citando los dos documentos.

## Risks / Trade-offs

- **R1. Números de hasta un día.** Con el recálculo diario (PO-1) una oferta que cierra a media mañana sigue contando
  hasta el tick siguiente. Mitigación: «Actualizada el {fecha}», fechas exactas en el texto y la tarjeta de la oferta
  muestra el cierre. Un día sin viñetas borra la semana y la tarjeta muestra el vacío honesto (ronda 2, N1); solo un
  rechazo del evaluador conserva la versión anterior.
- **R2. Cobertura de `expiresAt` y de habilidades.** Muchas ofertas no traen fecha de cierre y las habilidades dependen
  de `extract-job`. Mitigación: el denominador honesto y viñetas que solo existen si hay datos; la tarea diferida 8.3
  mide la cobertura de `preview.skills` antes de invitar en 35b (PO-5); por debajo del 50 % se invita igual y el informe
  de 35b separa la viñeta de habilidades del resto (ronda 2, R2-4).
- **R3. Habilidades escritas distinto** («Node.js» y «NodeJS») cuentan separadas. La normalización es deliberadamente
  simple y verificable; un diccionario de sinónimos sería otro change.
- **R4. El interruptor no es operable en staging** (D2, H7): apagarlo exige revertir o un change de compose.
- **R5. Grupo con más de 500 links:** los hechos cubren los 500 más recientes y `scanTruncated` queda en el documento,
  pero la tarjeta ya no lo dice (ronda 1). Con 3-5 invitados no ocurre; el RUNBOOK da la consulta para detectarlo.
- **R6. Bolivia (UTC−4):** el tick ocurre a la 01:00 local y la semana ISO cambia el domingo a las 20:00; entre las
  20:00 del domingo y la 01:00 del lunes la tarjeta muestra el vacío. Se acepta (mismo criterio que `weekly-plan` D6).
- **R7. Carga:** cada tick recorre todos los grupos (dos lecturas por grupo y una por página de 50); con 3-5 usuarios
  son unos pocos grupos.
- **R8. La rama no se fusiona** hasta que el owner lo diga; la medición real llega con 35b.

**Métrica de éxito (35b, 3-5 invitados):**

1. **Cobertura:** semanas-grupo con documento sobre semanas-grupo con al menos una oferta abierta, y la distribución de
   viñetas por tipo, a partir de la línea de resumen por tick (PO-4) y de una consulta agregada sobre
   `group_weekly_briefs` antes del TTL; ambas en el RUNBOOK, sin `groupId` en el resultado.
2. **Pregunta directa** a cada invitado a las 2 semanas (ronda 1, PO-3): «¿La viste? ¿Te dijo algo que no sabías?
   ¿Lo comentaron en el grupo?», anotada en el informe de 35b. La nota de la invitación de 35b menciona la tarjeta
   (RUNBOOK, tarea 8.1). Sin código.
3. No hay métrica de visitas ni de despliegues: no se registran, a propósito.

## Migration Plan

Colección e índices nuevos (único `(groupId, weekKey)` y TTL 35 días sobre `computedAt`), creados por el worker al
arrancar antes del primer tick (D2, H3); sin migración de datos. Al fusionar, el primer arranque del worker calcula la
semana en curso de todos los grupos con viñetas. Rollback: revertir el PR; la colección queda huérfana y su TTL la
vacía en 35 días (o `db.group_weekly_briefs.drop()`). En local, `FEATURE_GROUP_BRIEF=false` lo apaga. Todo queda en
`docs/RUNBOOK.md` (tarea 8.1).

## Open Questions

Todas resueltas en la ronda 1 (2026-11-25); se conservan como registro.

- **Q1 — valor por defecto de `FEATURE_GROUP_BRIEF`.** **Resuelta: (a) `true`**, condicionada a H2 (arranque sin
  esperar al tick), H3 (índices antes del primer tick) y a que el tick nunca relance (D2).
- **Q2 — «no la sigue nadie».** **Resuelta: (a) fuera** (D4). El antiguo corte siguiente §3 («nadie comparte su
  proceso») se borró.
- **Q3 — mínimo de viñetas.** **Resuelta: (a) 1** (D5).
- **Q4 — número de fila en §6.** **Resuelta: 39**, candidata.

## Debate (ronda 1)

Participaron `critic` y `business`; la sesión principal actuó como `reflect`. Decisiones de reflect del 2026-11-25.

| id | decisión | motivo |
|---|---|---|
| H1 (P0) | aceptado | Documento de Mongo (`ObjectId`, `Date`) separado del contrato zod, `toDocument`/`fromDocument` y fixture EJSON compartido (D7; tareas 3.2, 4.1). |
| H2 | aceptado | Tick de arranque con `void` + `catch`; `init()` resuelve aunque el tick quede colgado (D2; tarea 3.9b). |
| H3 | aceptado | `await Model.init()` antes del primer tick, probado sobre colección vacía (D2; tarea 3.3). |
| H4 + PO-8 | adaptado | Sale `closed_last_week`: sin `closedAt` en staging no aporta y no lleva a acción; orden cierre, habilidad, compartidas, segunda habilidad; tope 4 (D3, D5). |
| H5 | aceptado | Regla de privacidad reescrita: `skillLabel` es dato de la oferta (D4). |
| H6 + PO-2 | adaptado | Vacío: «Todavía no hay novedades para resumir esta semana.» + qué las dispara y «Se revisa cada mañana.», con EN (D9). |
| H7 | aceptado | Q1 = `true` por defecto, condicionado a H2, H3 y tick sin relanzar; `.env.example` y `test-config.ts`; ADR-069 §2 (D2; tarea 3.8). |
| H8 | aceptado | 3.7 partida en 3.9a-c, 4.5 en 4.5a-b y 7.1 en 7.1a-b, con sus falsaciones. |
| H9 | aceptado | Hook propio `GroupWeeklyBriefDeletionHook`; D1 corregido (la api solo borra en la cascada) (D1, D11; tarea 4.5a). |
| H10 | aceptado | Habilidades validadas con `jobSkillSchema`; la inválida se ignora (D3; tarea 3.4). |
| H11 | aceptado | Pertenencia con `membershipOf` (D8; tarea 4.2). |
| H12 | aceptado | `isoWeekKeySchema` único en `time/iso-week.ts` (D7, D10; tarea 1.1). |
| H13 | aceptado | `groupBriefFactViewSchema` escrito variante por variante (D7; tarea 1.5). |
| H14 | aceptado | Ofertas quitadas del grupo: salen en el recálculo siguiente y la lectura las excluye (D4, D11). |
| H15 | aceptado | `monitorCommands` en 3.5 (prueba de que no se lee `applications`) y aserción de contrato en 6.3. |
| H16 | aceptado | Dependencia de `ScheduleModule` escrita (D2; tarea 3.9c); seed «en ese orden relativo» (D12); e2e con `replaceOne` upsert (7.1a); «Ana, miembro que no es dueña» en la spec. |
| PO-1 (V0) | aceptado | Recálculo diario con `replaceOne` upsert; idempotencia por día; día vacío conserva lo guardado; «Actualizada el» (D1, D2, ADR-069 §1). |
| PO-3 | aceptado | La métrica 2 empieza con «¿La viste?»; nota para la invitación de 35b en el RUNBOOK (tarea 8.1). |
| PO-4 | aceptado | Log por tick `{groupsScanned, upserted, unchanged, empty, rejected}` + viñetas por tipo, sin `groupId`; suma en el RUNBOOK (D2; tareas 3.6, 8.1). |
| PO-5 | aceptado | Tarea [infra] 8.3 diferida a 35b: cobertura de `preview.skills` ≥ 50 % antes de invitar; no bloquea el cierre. |
| PO-6 | adaptado | Verificado: el listado no tiene ids por tarjeta, ni `anchorScrolling`, y pagina; se queda el enlace externo y el ancla pasa a corte siguiente §3 (D9). |
| PO-7 | aceptado | Texto de habilidad: «{skill} aparece en N de las M ofertas abiertas con habilidades detectadas.» y su EN (D9). |
| PO-10 | aceptado | Texto de compartidas: «Se compartieron N ofertas en el grupo la semana pasada.», su singular y su EN (D9); el vacío ya habla de ofertas compartidas la semana pasada. |
| PO-12 | aceptado | Se borró el corte siguiente «nadie comparte su proceso» y la cabecera «(de las 500…)». |
| PO-9 | aceptado | Ventana de cierre igual a `weekly-plan`: de `asOf` a `asOf` + 7 (D3, D6). |
| Q2, Q3, Q4 | aceptado | Q2 = (a) fuera; Q3 = (a) mínimo 1; Q4 = fila 39. |

Nota de la ronda 2: N1 sustituye la parte «día vacío conserva lo guardado» de PO-1.

## Debate (ronda 2)

Participaron `critic` y `business` sobre lo cambiado en la ronda 1; la sesión principal actuó como `reflect`. No quedó
ningún P0 ni V0 abierto. Decisiones de reflect del 2026-11-25.

| id | decisión | motivo |
|---|---|---|
| N1 + R2-1 | aceptado | Día sin viñetas: `deleteOne({groupId, weekKey})` y cuenta `cleared`; la api da `null` y se ve el vacío honesto; el rechazo conserva la anterior con log (D2, D4, D5, D11, R1; tarea 3.5). |
| N2 | aceptado | `ensureGroupBriefIndexes()` con try/catch: si falla, log, módulo sin cron ni tick y el arranque sigue; `collMod` para cambiar el TTL en el RUNBOOK (D2; tareas 3.3, 8.1; ADR-069 §2). |
| N3 | aceptado | `toDocument` sin `_id`; el fixture no lo lleva (D7; tarea 3.2). |
| N4 | aceptado | `unchanged` se compara en el espacio del documento (EJSON canónico sin `_id` ni `computedAt`); un guardado ilegible se sobrescribe (D2; tarea 3.5). |
| N5 | adaptado | `FEATURE_GROUP_BRIEF=false` en `apps/web-e2e/e2e.env` para que el worker del perfil local no pise el documento sembrado; es configuración de la suite, no de CI (tarea 7.1a). |
| N6 | aceptado | `EJSON.parse(..., { relaxed: false })` + `toEqual` y un `workspaceRoot()` común en 3.2 y 4.1 (D7). |
| R2-2 | aceptado | `closing_soon` guarda `firstExpiresAt`, comprobado dentro de la ventana; textos «cierra el» / «la primera, el»; `expiresAt` en cada oferta de `closing_soon` (D3, D6, D7, D8, D9). |
| R2-3 + N7 | aceptado | Vacío: «…cierra de hoy a 7 días, dos o más mencionan la misma habilidad o se compartieron ofertas la semana pasada. Se revisa cada mañana.» y su EN (D9). |
| R2-4 | aceptado | 8.3: por debajo del 50 % se invita igual y el informe de 35b separa la viñeta de habilidades del resto. |

Convergencia: SI (2026-11-25, ronda 2: 0 P0 / 0 V0)

## Aprobación humana

**Aprobado por el owner el 2026-11-25.** Cita literal: «Aprobado», en respuesta a la presentación del change tras
«Convergencia: SI» (ronda 2), que pedía aprobar la spec y confirmar Q1 con la recomendación `true` por defecto.
Alcance: apply en la rama `change/group-weekly-brief` y PR **sin fusionar**; la fusión solo con una ventana que abra el
owner. Q1 queda en (a), `FEATURE_GROUP_BRIEF` en `true` por defecto, junto con Q2 (a), Q3 (a) y Q4 (fila 39), como resolvió el debate.
