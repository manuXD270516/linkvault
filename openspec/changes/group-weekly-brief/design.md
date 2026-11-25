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
4. Calculada una vez en el worker por `(groupId, weekKey ISO UTC)`, idempotente; la api solo lee.
5. Evaluador determinista: cada viñeta cita un hecho existente y los números coinciden.
6. Cortes posteriores diseñados sin implementar: síntesis LLM `summarize-group-week` por `runTask` con tope de llamadas
   en código y mock `replay` con entradas canónicas; el mismo bloque en el correo del `group-digest`.

**Restricciones del owner para este change:** costo 0 (Oracle Always Free, una máquina); no tocar despliegue, CI ni
compose; si el worker necesita un flag o un cron, justificarlo, con valor por defecto seguro y sin variables nuevas
obligatorias; repo público; i18n ES/EN con tuteo.

Lo que ya existe y este change reutiliza (verificado en el código de `a6e943be`):

- **Cron semanal en el worker.** El digest de grupo registra un host `@Cron` dinámico en UTC
  (`apps/worker/src/modules/notifications/notifications.module.ts`, `createGroupDigestCronHost`) que solo se registra
  fuera de `NODE_ENV=test`; su flag `FEATURE_GROUP_DIGEST` es opcional con `default('false')`
  (`apps/worker/src/infrastructure/config/worker-config.schema.ts:39-49`).
- **El worker lee las colecciones de ofertas directamente.** `MongoGroupDigestCatalog` pagina `groups` por `_id` de 50 en
  50, lee `group_links` por `(groupId, sharedAt)` con proyección sin `note`, etiquetas ni fijado, y luego `job_links`
  por `$in` (`notifications/infrastructure/persistence/mongo-group-digest.catalog.ts`). Índice
  `{ groupId: 1, sharedAt: -1, _id: -1 }` en `apps/api/src/modules/links/infrastructure/link.schemas.ts:253`.
- **Semana ISO.** `isoWeekKey`, `startOfIsoWeekUtc`, `windowForWeekKey` y `previousClosedIsoWeek` en
  `apps/worker/src/modules/notifications/domain/iso-week.ts`; copia de `isoWeekKey` con `previousWeekKey`/`nextWeekKey`
  en `apps/api/src/modules/applications/domain/weekly-plan/week-key.ts` (R5 de `weekly-plan`: «se unifica después»).
- **Datos de la oferta.** `closedAt` ausente = abierta (ADR-037); `preview.expiresAt` fecha `YYYY-MM-DD` o `null`, y un
  `expiresAt` pasado es cierre de calendario (ADR-041); `preview.skills` es una lista de `{ name, required }` de como
  mucho 40 (`libs/shared/src/schemas/preview.schema.ts:17`, `:57-60`, `:83`, `:87`). Las habilidades las extrae
  `extract-job` o las edita un miembro; en ambos casos son datos de la oferta que el listado del grupo ya muestra.
- **Borrado de grupo.** `groups` ejecuta los hooks registrados dentro de su transacción
  (`groups/application/group-deletion-hooks.ts`); `links` registra el suyo (`links/presentation/links.module.ts:257-262`,
  `links/infrastructure/group-links-deletion.hook.ts`).
- **Listado y detalle del grupo.** Rutas de `links` bajo `@Controller('groups')`
  (`links/presentation/group-links.controller.ts:46`, `@Get(':id/links')` en `:59`); reloj `LINKS_CLOCK`
  (`links/application/ports/clock.port.ts:3`). En el SPA, `/grupos/:id` es `features/groups/group-detail.page.*` y pinta
  `<lv-link-list>`; la tarjeta de link abre la oferta con `target="_blank"` y `rel="noopener noreferrer"`
  (`features/links/link-card.component.html:4-6`).
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

- Que cualquier miembro vea, en la página del grupo, de 1 a 5 viñetas verificadas sobre las ofertas del grupo esta
  semana, cada una con sus ofertas a un toque.
- Cálculo una vez por grupo y semana en el worker, idempotente, determinista y sin IA; la api solo lee.
- Cero datos de miembros: ni postulaciones, ni marcas, ni notas, ni comentarios, ni etiquetas, ni quién compartió.
- Un evaluador determinista que el corte LLM reutiliza tal cual.

**Non-Goals (este change)**

- LLM, correo, web push, avisos, deltas contra la semana anterior. Diseñados en «Cortes siguientes».
- «No la sigue nadie» y cualquier conteo derivado de postulaciones o marcas de miembros (D4).
- Recalcular una semana ya guardada (D2), resaltar la oferta dentro del listado del grupo.
- Despliegue, CI, compose, variables obligatorias, `libs/ai`.

## Decisions

### D1. Se calcula en el worker, una vez por `(groupId, weekKey)`, y la api solo lee

La semana del grupo es un **documento por grupo y semana ISO UTC** en la colección nueva `group_weekly_briefs`, con
índice **único** `(groupId, weekKey)`. Lo escribe solo el worker; la api lo lee y nunca lo escribe ni lo recalcula.

Por qué en el worker y no al leer (como `weekly-plan`): (a) es la condición 4 del jurado; (b) todos los miembros ven
**los mismos números** toda la semana, que es lo que permite hablar de ellos en el grupo; (c) el corte LLM necesita un
punto único de cálculo para gastar como mucho una llamada por grupo y semana, y el corte del correo necesita el mismo
bloque que la tarjeta; (d) la lectura se vuelve un `findOne` y no depende del tamaño del grupo.

*Alternativas descartadas:* on-read en la api (números que cambian entre miembros durante la semana y un LLM por
lectura en el corte 1); cron en la api (la api no tiene scheduler y el worker ya tiene el patrón del digest); recalcular
cada día pisando el documento (rompe «una vez» y hace que la viñeta que se comentó el lunes cambie el martes).

### D2. Cuándo: tick diario a las 05:00 UTC y al arrancar, solo para los grupos sin semana

- **Tick.** `@Cron('0 5 * * *', { timeZone: 'UTC' })` con la expresión como **constante en código**
  (`GROUP_BRIEF_CRON`), no como variable: no hace falta ajustarla por entorno. El lunes calcula todos los grupos; el
  resto de días solo los que aún no tienen la semana en curso (grupos creados a mitad de semana, o sin viñetas el
  lunes). Además, el worker dispara un tick al arrancar (`onApplicationBootstrap`), así un worker caído el lunes a las
  05:00 recupera la semana al volver. Con `NODE_ENV=test` no se registra ni el cron ni el arranque (patrón del digest).
- **Semana.** `weekKey = isoWeekKey(now)` (la semana **en curso**, no la cerrada del digest) y `asOf` = fecha UTC del
  cálculo `YYYY-MM-DD`.
- **Idempotencia.** El tick pagina `groups` por `_id` (50 por página), descarta los que ya tienen documento para
  `weekKey` (una lectura por página) y, por cada grupo restante, calcula e **inserta**. Un error de clave duplicada (otro
  tick concurrente ganó) cuenta como «ya existe» y no se reintenta. No hay cola BullMQ: un tick fallido lo repite el del
  día siguiente; un guardia en memoria evita dos ticks solapados en el mismo proceso.
- **Semana vacía no se guarda.** Si el cálculo no produce ninguna viñeta (D5), **no** se inserta nada y el grupo vuelve
  a intentarse en el tick siguiente; es el mismo criterio del digest («vacío no deja rastro»). Una semana ya guardada
  no se recalcula aunque el grupo cambie.
- **Flag.** `FEATURE_GROUP_BRIEF`, **opcional**, `z.enum(['true','false']).default('true')`. Con `false`, ni cron ni
  tick de arranque. Encendido por defecto porque el trabajo es seguro: lecturas de Mongo y una inserción por grupo y
  semana, sin red saliente, sin IA, sin correo. Y porque el compose de producción **no** reenvía variables del worker que
  no declara (Context): con `default('false')`, como el digest, la feature quedaría muerta en staging sin tocar el
  compose, que este change no puede tocar. Consecuencia escrita: en staging el interruptor no es operable sin un change
  de compose; la salida de emergencia es revertir el PR (Migration Plan). Ver **Q1**.

*Alternativas descartadas:* solo el lunes (un grupo creado el martes no tiene semana hasta el lunes siguiente); cola
BullMQ con `jobId` por día (la idempotencia ya la da el índice único y el reintento lo da el tick diario); cron como
variable de entorno (sin necesidad real y sería otra variable que el compose no reenvía).

### D3. Universo y tabla de hechos

**Universo del grupo:** sus `group_links` ordenados por `sharedAt` desc y `_id` desc, como mucho
`GROUP_BRIEF_SCAN_MAX = 500` (se leen 501 para saber si hay más: `scanTruncated`), y de cada uno su `job_link` con
proyección `closedAt`, `preview.expiresAt` y `preview.skills` y nada más. **Dos lecturas por grupo**, sea cual sea el
número de ofertas. Una oferta está **abierta** si no tiene `closedAt` y su `expiresAt` es `null` o `≥ asOf` (un
`expiresAt` pasado es cierre de calendario aunque el detector aún no pasara, ADR-041).

**Hechos** (`kind`, `factId`, cuándo existe y qué guarda). Cada lista de ofertas va en el orden del universo
(`sharedAt` desc, `_id` desc) y sin repetidos.

| `kind` | `factId` | Existe si | Guarda |
|---|---|---|---|
| `open_offers` | `open_offers` | siempre que haya viñetas | `count`, `linkIds` de las abiertas |
| `closing_soon` | `closing_soon` | ≥ 1 abierta con `expiresAt` en `[asOf, asOf+6]` | `count`, `linkIds`, `from` = `asOf`, `until` = `asOf`+6 días |
| `skill_demand` | `skill_demand:<skillKey>` | ≥ 2 abiertas mencionan la habilidad | `skillKey`, `skillLabel`, `count`, `total`, `linkIds` |
| `shared_last_week` | `shared_last_week` | ≥ 1 `group_link` con `sharedAt` en la semana W−1 | `count`, `linkIds`, `weekKey` = W−1 |
| `closed_last_week` | `closed_last_week` | ≥ 1 oferta del grupo con `closedAt` en la semana W−1 | `count`, `linkIds`, `weekKey` = W−1 |

- **Habilidades.** `skillKey` = `name` con `normalize('NFKC')`, recortado, espacios internos colapsados y en minúsculas;
  vacía o de más de 60 caracteres se ignora. Cada oferta cuenta una vez por clave aunque la repita. `total` = abiertas
  con al menos una habilidad válida (el denominador honesto: las que no tienen habilidades leídas no cuentan ni a favor
  ni en contra). `skillLabel` = la forma original recortada más frecuente de esa clave; empate, la menor por orden de
  unidades de código. Se guardan como mucho `GROUP_BRIEF_SKILL_FACTS_MAX = 5` hechos de habilidad, por `count` desc y
  `skillKey` asc. Se cuentan las obligatorias y las deseables por igual, y por eso el texto dice «mencionan», no
  «exigen».
- **`closing_soon`** usa una ventana de 7 días desde el cálculo (`GROUP_BRIEF_CLOSING_WINDOW_DAYS = 7`), no «hasta el
  domingo»: calculada el lunes cubre la semana; calculada el jueves no se queda con tres días. La fecha exacta viaja
  en el hecho y en el texto, así la viñeta sigue siendo verdadera aunque se lea el viernes.
- **`shared_last_week`** cuenta también ofertas ya cerradas: lo que dice es «entraron», no «siguen abiertas».
- `factId` es **estable y legible**: el mismo hecho la semana siguiente tiene el mismo `factId`. Hoy sirve para el
  evaluador y mañana para que el LLM cite (D13).

*Alternativas descartadas:* «ofertas sin fecha de cierre» (no lleva a ninguna acción); modalidad o salario (cubiertos
por los filtros de búsqueda y con cobertura baja); etiquetas del grupo (las escriben los miembros: D4).

### D4. Privacidad: solo datos de las ofertas, y por qué «no la sigue nadie» queda fuera

**Entra:** lo que cualquier miembro ya ve en cada tarjeta del listado de su grupo **y no depende de quién es cada
miembro**: `closedAt`, `preview.expiresAt`, `preview.skills` y `group_links.sharedAt`. **No entra, ni se lee:**
`applications`, `group_links.knowSomeoneUserIds`, `note`, `tags`, `pinned`, `sharedBy`, comentarios, membresías (más
allá de pertenecer al grupo para leer) ni ningún nombre o identificador de usuario. El catálogo del worker proyecta
solo esos campos (no hay un `find` sin proyección) y el documento guardado no tiene ningún campo de usuario: el tipo no
lo admite y un test lo comprueba sobre la serialización.

**«No la sigue nadie» queda fuera del MVP.** Se calcularía sobre las postulaciones de todos los miembros, que nacen
**privadas** (ADR-024, `applications/group-visibility`), y filtra estado privado:

- Su complemento se deduce del listado: lo que no aparece como «no la sigue nadie» lo sigue alguien. En un grupo de
  2 personas, Ana sabe exactamente qué ofertas sigue Beto; con 3 a 5, lo reduce a una o dos personas.
- Cada viñeta enlaza a sus ofertas, así que la lista exacta queda expuesta, no un total agregado.
- Contradice la letra de «Privada por defecto»: una postulación privada influiría en una respuesta dirigida a otra
  persona.

Con 3 a 5 miembros ningún umbral mínimo de grupo lo anonimiza de forma útil. La variante que no filtra nada —contar solo
postulaciones con `visibility` `group`, que el grupo ya ve en cada tarjeta— dice otra cosa («nadie comparte su proceso
en esta oferta») y entra en la pregunta **Q2**; queda diseñada en «Cortes siguientes» §3. Por la misma razón, el conteo
de «conozco a alguien» también queda fuera: ya se ve por tarjeta y agregarlo no aporta.

### D5. Viñetas por plantilla, como mucho 5

Una viñeta es `{ factId, source: 'template' }`: **no lleva texto ni números propios**. El SPA arma el texto desde el
hecho citado con `$localize` (D9). Selección determinista, en este orden y saltando lo que no existe:

1. `closing_soon`;
2. el primer `skill_demand` (más ofertas; desempate `skillKey` asc);
3. `shared_last_week`;
4. `closed_last_week`;
5. el segundo `skill_demand`.

Tope `GROUP_BRIEF_MAX_BULLETS = 5` en el dominio y en el contrato (`.max(5)`); como mucho
`GROUP_BRIEF_SKILL_BULLETS_MAX = 2` de habilidades. `open_offers` **no** es viñeta: es la línea de cabecera. Con 0
viñetas la semana no se guarda (D2). El mínimo es 1 y no 3: una viñeta verdadera vale más que tres de relleno, y con
grupos pequeños en 35b un mínimo de 3 dejaría la tarjeta vacía casi siempre (**Q3**).

### D6. Evaluador determinista compartido

`verifyGroupWeeklyBrief(brief): { ok: true } | { ok: false; violations: readonly GroupBriefViolation[] }`, función pura
en `libs/shared`. Comprueba:

1. `factId` únicos; existe exactamente un `open_offers`; cada `factId` corresponde a su `kind` (los de habilidad,
   `skill_demand:<skillKey>` con el `skillKey` del hecho).
2. Cada viñeta cita un hecho **existente** que no es `open_offers`; sin viñetas repetidas; de 1 a 5; como mucho 2 de
   habilidad.
3. En cada hecho, `count === linkIds.length` y sin ids repetidos.
4. `closing_soon.linkIds` y cada `skill_demand.linkIds` ⊆ `open_offers.linkIds`; `skill_demand`: `2 ≤ count ≤ total ≤
   open_offers.count`.
5. Fechas: `closing_soon.from === asOf` y `until === asOf + 6 días`; `shared_last_week.weekKey` y
   `closed_last_week.weekKey` = la semana anterior a la del documento.

Dónde corre: el **worker**, antes de insertar (una semana que no pasa **no** se guarda; se registra una línea de log
con `groupId`, `weekKey` y los códigos de violación, nunca contenido); y la **api**, al leer (una semana guardada que no
pasa se responde como `brief: null` y se registra igual). Es la red de seguridad del corte LLM: el sintetizador pasará
por la misma función ampliada (Cortes siguientes §1).

### D7. Documento y contrato en `libs/shared` (`schemas/group-weekly-brief.schema.ts`)

```ts
GROUP_BRIEF_MAX_BULLETS = 5; GROUP_BRIEF_SKILL_BULLETS_MAX = 2; GROUP_BRIEF_SKILL_FACTS_MAX = 5
GROUP_BRIEF_SKILL_MIN_OFFERS = 2; GROUP_BRIEF_CLOSING_WINDOW_DAYS = 7; GROUP_BRIEF_SCAN_MAX = 500
GROUP_BRIEF_OFFERS_PER_BULLET = 10; GROUP_BRIEF_TTL_DAYS = 35
objectIdString = z.string().regex(/^[0-9a-f]{24}$/)
linkIds = z.array(objectIdString).max(GROUP_BRIEF_SCAN_MAX)
groupBriefFactSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('open_offers'), factId: z.literal('open_offers'), count: int.min(0), linkIds }),
  z.strictObject({ kind: z.literal('closing_soon'), factId: z.literal('closing_soon'), count: int.min(1), linkIds,
                   from: z.iso.date(), until: z.iso.date() }),
  z.strictObject({ kind: z.literal('skill_demand'), factId: z.string().regex(/^skill_demand:.{1,60}$/),
                   skillKey: z.string().min(1).max(60), skillLabel: z.string().min(1).max(60),
                   count: int.min(2), total: int.min(2), linkIds }),
  z.strictObject({ kind: z.literal('shared_last_week'), factId: z.literal('shared_last_week'), count: int.min(1), linkIds,
                   weekKey: weekKeySchema }),
  z.strictObject({ kind: z.literal('closed_last_week'), factId: z.literal('closed_last_week'), count: int.min(1), linkIds,
                   weekKey: weekKeySchema }),
])
groupBriefBulletSchema = z.strictObject({ factId: z.string().min(1), source: z.literal('template') })
groupWeeklyBriefSchema = z.strictObject({           // lo que se guarda (sin _id; groupId como string en el contrato)
  version: z.literal(1), groupId: objectIdString, weekKey: weekKeySchema, asOf: z.iso.date(),
  computedAt: z.iso.datetime(), scanTruncated: z.boolean(),
  facts: z.array(groupBriefFactSchema).min(1).max(9), bullets: z.array(groupBriefBulletSchema).min(1).max(5),
})
groupBriefOfferSchema = z.strictObject({ linkId: objectIdString, displayUrl: z.string().min(1),
                                         title: z.string().optional(), company: z.string().optional() })
groupWeeklyBriefResponseSchema = z.strictObject({
  weekKey: weekKeySchema,                             // la semana en curso, haya documento o no
  brief: z.strictObject({
    asOf: z.iso.date(), openOffers: int.min(0), scanTruncated: z.boolean(),
    bullets: z.array(z.strictObject({
      factId: z.string().min(1),
      fact: <groupBriefFactSchema sin linkIds>,       // lo que el SPA necesita para el texto
      offers: z.array(groupBriefOfferSchema).max(GROUP_BRIEF_OFFERS_PER_BULLET),
      moreCount: int.min(0), missingCount: int.min(0),
    })).min(1).max(5),
  }).nullable(),
})
```

`weekKeySchema` es el de `group-weekly-digest.event.ts` (`^\d{4}-W\d{2}$`), reutilizado. La respuesta **no** lleva
`linkIds` crudos ni `computedAt`: solo lo que la tarjeta pinta. `version` permite que el corte LLM añada
`source: 'llm'` y viñetas con texto sin romper documentos viejos.

### D8. Lectura en la api: `GET /api/groups/:id/weekly-brief`

En el módulo `links` (las viñetas son sobre sus ofertas y la ruta vive con `:id/links`): caso de uso
`GetGroupWeeklyBrief` y puerto `GROUP_WEEKLY_BRIEF_READER` (`findOne(groupId, weekKey): Promise<unknown | null>`; el
caso de uso valida con zod y con `verifyGroupWeeklyBrief`). Pasos:

1. Pertenencia por la entrada de `groups` (`isMember`); no miembro o `:id` mal formado → `404 group_not_found`.
2. `weekKey = isoWeekKey(LINKS_CLOCK.now())`; lee el documento de **esa** semana (no cae a la anterior: una semana
   vieja diría «cierran hasta el» con fechas pasadas). Sin documento, o inválido → `200 { weekKey, brief: null }`.
3. Por la unión de los `linkIds` de los hechos citados: **una** lectura de `group_links` (`groupId`, `linkId $in`)
   para quedarse con los que **siguen en el grupo**, y **una** de fichas de `job_links` (`displayUrl`, título, empresa).
4. Por viñeta: `offers` = las primeras 10 que siguen en el grupo, en el orden del hecho; `moreCount` = las demás que
   siguen; `missingCount` = `count` − las que siguen. El texto de la viñeta usa los números del hecho (lo que era
   verdad al calcular); `missingCount` explica la diferencia.

Lecturas fijas: pertenencia, documento, relaciones y fichas, sea cual sea el número de viñetas u ofertas. **No escribe
nada.** Sin códigos de error nuevos. El documento, el índice único y el TTL los declara el worker (dueño de la
escritura); la api lee la colección sin modelo con `autoIndex`.

### D9. Tarjeta «La semana del grupo» en `/grupos/:id`

`GroupWeeklyBriefCardComponent` (`features/groups/group-weekly-brief-card.component.*`) en
`group-detail.page.html`, **encima** del listado de links y debajo del formulario de guardar, a todo el ancho, también
en el móvil. Store propio `core/groups/group-weekly-brief.store.ts` (`@ngrx/signals`) y cliente
`core/groups/group-weekly-brief.api.ts` que valida con el schema de `libs/shared`: un fallo de la tarjeta **no** bloquea
el detalle ni el listado.

- **Cabecera:** «La semana del grupo» y debajo «Calculada el {fecha} · N ofertas abiertas» (singular «1 oferta
  abierta»); si `scanTruncated`, añade « (de las 500 más recientes)». Pie fijo: «Solo cuenta datos de las ofertas, nunca
  lo que hace cada miembro.»
- **Viñeta:** el texto en una línea y un botón «Ver ofertas (N)» / «Ocultar ofertas» (N = `offers.length` +
  `moreCount`), con `aria-expanded`, `aria-controls` y alto mínimo de 44 px (`min-h-11`). Desplegada: cada oferta con
  su título (o `displayUrl`) y empresa, enlazada a `displayUrl` con `target="_blank"` y `rel="noopener noreferrer"`,
  como la tarjeta de link; si `moreCount > 0`, «y N más en el listado del grupo»; si `missingCount > 0`, «N ya no
  están en el grupo». Con N = 0 (todas salieron del grupo) el botón no se muestra y solo queda esa línea.
- **Cargando:** esqueleto de 3 líneas con `aria-busy="true"`. **Vacío** (`brief: null`): «Todavía no hay resumen de
  esta semana.» y «Se arma solo una vez por semana cuando el grupo tiene ofertas abiertas.». **Error:** «No pudimos
  cargar la semana del grupo.» con «Reintentar».
- **Fechas:** `asOf` y `until` son fechas sin hora; se formatean en UTC con `Intl.DateTimeFormat(locale, { weekday:
  'long', day: 'numeric', month: 'long', timeZone: 'UTC' })` («lunes, 23 de noviembre» / «Monday, November 23»).
- **Textos de las viñetas** (función pura `groupBriefBulletText(fact, locale)` con **un mensaje `$localize` por
  variante**, singular y plural elegidos en código, como `weeklyPlanReasonText`):

  | Hecho | Español | English |
  |---|---|---|
  | `closing_soon`, 1 | `1 oferta cierra hasta el {until}.` | `1 offer closes by {until}.` |
  | `closing_soon`, N | `N ofertas cierran hasta el {until}.` | `N offers close by {until}.` |
  | `skill_demand` | `N de M ofertas con requisitos leídos mencionan {skill}.` | `N of M offers with known requirements mention {skill}.` |
  | `shared_last_week`, 1 | `1 oferta nueva la semana pasada.` | `1 new offer last week.` |
  | `shared_last_week`, N | `N ofertas nuevas la semana pasada.` | `N new offers last week.` |
  | `closed_last_week`, 1 | `1 oferta cerró la semana pasada.` | `1 offer closed last week.` |
  | `closed_last_week`, N | `N ofertas cerraron la semana pasada.` | `N offers closed last week.` |

  Resto de textos EN: «The group's week», «Calculated on {date} · N open offers» / «1 open offer», « (of the 500 most
  recent)», «It only counts offer data, never what each member does.», «Show offers (N)», «Hide offers», «and N more in
  the group list» / «and 1 more in the group list», «N are no longer in the group» / «1 is no longer in the group»,
  «There is no summary for this week yet.», «It is built automatically once a week when the group has open offers.»,
  «We couldn't load the group's week.», «Retry». En español, el singular de las dos últimas variables: «y 1 más en el
  listado del grupo» y «1 ya no está en el grupo».
- Ids `@@groups.weeklyBrief.*`; `messages.xlf` se regenera y `messages.en.xlf` se traduce (ADR-050). `{skill}` es la
  etiqueta tal como vino de la oferta y no se traduce.

### D10. `isoWeekKey` unificada en `libs/shared`

`libs/shared/src/time/iso-week.ts` con `startOfIsoWeekUtc`, `isoWeekKey`, `previousWeekKey`, `nextWeekKey`,
`startOfWeekKeyUtc`, `windowForWeekKey` y `previousClosedIsoWeek`, movidas del worker y de `applications` con **los
mismos vectores de test** de las dos copias. Las dos copias se borran y sus usos importan de `@linkvault/shared`. Cierra
R5 de `weekly-plan`; sin esto habría tres copias (worker, `applications`, `links`).

### D11. Borrado, retención y cuenta

- **Borrado de grupo:** el hook de `links` (`group-links-deletion.hook.ts`) borra también
  `group_weekly_briefs` con `{ groupId }` dentro de la misma sesión; si falla, no se borra nada (mismo contrato que los
  comentarios).
- **Retención:** índice TTL de 35 días sobre `computedAt` (`expireAfterSeconds` 3 024 000). La lectura solo pide la
  semana en curso, así que el TTL no afecta lo que se ve; deja W−1..W−4 para el corte de deltas y para medir.
- **Borrado de cuenta:** nada que hacer: los documentos no tienen datos de usuario (D4). Se dice en la spec para que
  nadie lo añada «por si acaso».
- **Ofertas quitadas del grupo después del cálculo:** el documento no se reescribe; la lectura las excluye (D8).

### D12. Seed demo

Tres links demo ganan habilidades por el mismo camino de edición de preview (`ensurePreview`): `openSalary` (Docker,
TypeScript, NestJS), `staleApp` (Docker, Kotlin) y `closingSoon` (Docker, TypeScript, SQL). Con lo que ya hay
(`closingSoon` vence en 3 días), el grupo demo produce al calcular: `closing_soon` (1), «3 de 3 … Docker» y «2 de 3 …
TypeScript» → **tres viñetas** (los `sharedAt` y `closedAt` del seed caen en la semana de la corrida, no en W−1). Para
verlo en local, el worker calcula al arrancar: el RUNBOOK dice «reinicia el worker después del seed» y cómo borrar la
semana para recalcularla.

### D13. Entradas canónicas desde ya

El dominio del worker trabaja sobre un **universo canónico**: ofertas con id opaco, fechas `YYYY-MM-DD`, habilidades ya
normalizadas, en un orden fijo; los hechos salen ordenados y con `factId` estables. Hoy no cuesta nada y es lo que hace
que, en el corte 1, la entrada del LLM (los hechos con ids sintéticos `f1…fN` en ese orden) tenga una clave `replay`
estable entre corridas.

### Condiciones del jurado → decisiones

| Condición | Dónde |
|---|---|
| 1. Sin LLM; viñetas por plantilla desde hechos con `factId` | D3, D5, D9 |
| 2. Solo datos de ofertas; conteos de miembros fuera; «no la sigue nadie» justificado | D3, D4, Q2 |
| 3. Nunca notas, comentarios ni nombres | D4 (proyecciones y test de serialización) |
| 4. Una vez en el worker por `(groupId, weekKey)`, idempotente; api solo lee | D1, D2, D8 |
| 5. Evaluador determinista: hecho existente y números que coinciden | D6 |
| 6. Cortes LLM y correo diseñados sin implementar | Cortes siguientes §1 y §2 |

## Cortes siguientes (diseñados, fuera de las tareas de este change)

Cada corte es un change propio, con su debate y su aprobación, y ninguno se abre antes de fusionar este.

1. **`group-weekly-brief-llm` — síntesis `summarize-group-week`.** Tarea nueva por `runTask` (`KNOWN_TASK_NAMES`,
   prompt `summarize-group-week.v1.md`, `temperature 0`, salida zod), ejecutada en el mismo cálculo del worker, después
   de los hechos y antes de insertar.
   - **Entrada canónica:** los hechos en el orden de D13 con ids sintéticos `f1…fN`, números, `skillLabel` y fechas
     relativas («dentro de 6 días»), `outputLanguage` del grupo (Q4 del corte); **sin** `linkIds`, títulos, empresas,
     nombres de grupo ni de personas. No hay PII que redactar, pero pasa igual por `PiiRedactor` hacia proveedores
     `external`.
   - **Salida:** `{ sentences: { text: string(≤160), factIds: z.enum([f1…fN]).array().min(1).max(3) }[] }` de 1 a 3,
     **enum cerrado construido por petición**.
   - **Evaluador ampliado** (misma función de D6 con `source: 'llm'`): cada frase cita hechos existentes; todo número
     del texto (`\d+`) es un `count`, `total` o día relativo de un hecho citado; toda `skillLabel` nombrada pertenece a
     un hecho citado; sin fechas absolutas, URLs ni `@`. Falla → un repair con las violaciones, luego el siguiente
     proveedor, luego **las viñetas por plantilla** (degradación honesta: la tarjeta no cambia de forma).
   - **Tope en código, no en `AI_QUOTAS`** (vacío en producción, y una corrida de sistema sin `userId` no tiene cuota):
     como mucho **1 llamada por `(groupId, weekKey)`** —lo garantiza el cálculo único de D2— y un **tope diario
     global** `GROUP_BRIEF_LLM_DAILY_MAX` (constante, propuesta 20) contado con un documento
     `{ _id: 'group-brief-llm:<YYYY-MM-DD>', n }` y `$inc` condicionado a `n < max`; agotado, plantillas. Repair y
     siguiente proveedor cuentan dentro de la misma llamada lógica, con un máximo de 3 intentos.
   - **Mock y eval:** fixtures `replay` grabadas con `nx run ai:record-fixtures` sobre entradas canónicas; golden
     sintético; `nx run ai:eval --provider=mock --update-baseline` en el mismo commit; métricas
     `schema_validity_rate`, `citation_validity_rate` y `number_match_rate` con puerta 1,0.
   - **Decisiones que necesitará del owner:** consentimiento (los hechos no son datos de una persona, pero la corrida es
     de sistema y hoy `aiConsent` es por usuario) e idioma del grupo.
2. **El bloque en el correo del `group-digest`.** El digest corre el lunes a las 14:00 UTC sobre W−1; para entonces ya
   existe la semana W (05:00). Si existe y pasa el evaluador, el correo añade las viñetas renderizadas por plantillas de
   correo ES/EN (por `MailLocale`) desde los mismos hechos, sin ofertas desplegadas y con el CTA al grupo; si no
   existe, el correo no cambia. Mismo tipo `group_weekly_digest`, misma preferencia de opt-out, sin tipo nuevo. Hoy
   `FEATURE_GROUP_DIGEST` está apagado en staging (Context): el corte también decide si se enciende.
3. **Variante de «nadie comparte su proceso»** (solo si el debate y el owner la aceptan, Q2): conteo de ofertas
   abiertas sin ninguna postulación con `visibility` `group` de miembros actuales, sobre los mismos datos que ya
   devuelve `GET /api/groups/:id/applications`. Exige que el worker lea `applications` filtrando por `visibility` en la
   consulta (nunca leer las privadas) y un test que lo demuestre.
4. **Deltas contra la semana anterior** («Docker: de 2 a 4 ofertas»): con W−1 retenida por el TTL, hechos nuevos
   `*_delta` citando los dos documentos.

## Risks / Trade-offs

- **R1. Números congelados durante la semana.** Una oferta que cierra el martes sigue contando en «cierran hasta el»
  del lunes. Mitigación: la cabecera dice «Calculada el {fecha}», el texto lleva la fecha exacta y la lista desplegada
  enlaza a la oferta, cuya tarjeta muestra el cierre. Es el precio de D1 (b).
- **R2. Cobertura de `expiresAt` y de habilidades.** Muchas ofertas no traen fecha de cierre y las habilidades dependen
  de `extract-job`. Mitigación: el denominador honesto de `skill_demand` y viñetas que solo existen si hay datos. Se
  mide en 35b (métrica 1).
- **R3. Habilidades escritas distinto** («Node.js» y «NodeJS») cuentan separadas. La normalización es deliberadamente
  simple y verificable; un diccionario de sinónimos sería otro change.
- **R4. El interruptor no es operable en staging** (D2, Q1): apagarlo exige revertir o un change de compose.
- **R5. Grupo con más de 500 links:** los hechos cubren los 500 más recientes y la cabecera lo dice.
- **R6. Bolivia (UTC−4):** el cálculo del lunes ocurre el lunes a la 01:00 local y la semana ISO cambia el domingo a
  las 20:00; entre las 20:00 del domingo y la 01:00 del lunes la tarjeta muestra el vacío. Se acepta (mismo criterio que
  `weekly-plan` D6).
- **R7. Carga:** un tick recorre todos los grupos; con 3-5 usuarios son unos pocos grupos y dos lecturas por grupo.
- **R8. La rama no se fusiona** hasta que el owner lo diga; la medición real llega con 35b.

**Métrica de éxito (35b, 3-5 invitados):**

1. **Cobertura:** semanas-grupo con documento guardado sobre semanas-grupo con al menos una oferta abierta, y número de
   viñetas por documento (distribución 1-5). Consulta agregada en el RUNBOOK sobre `group_weekly_briefs`, antes del TTL.
2. **Pregunta directa** a cada invitado a las 2 semanas: «¿"La semana del grupo" te dijo algo que no sabías? ¿Lo
   comentaron en el grupo?», anotada en el informe de 35b.
3. No hay métrica de visitas ni de despliegues: no se registran, a propósito.

## Migration Plan

Colección e índices nuevos (único `(groupId, weekKey)` y TTL 35 días sobre `computedAt`, declarados por el esquema del
worker con `autoIndex`); sin migración de datos. Al fusionar, el primer arranque del worker calcula la semana en curso
de todos los grupos con viñetas. Rollback: revertir el PR; la colección queda huérfana y su TTL la vacía en 35 días (o
`db.group_weekly_briefs.drop()`). En local, `FEATURE_GROUP_BRIEF=false` lo apaga. Todo queda en `docs/RUNBOOK.md`
(tarea 8.1), con cómo recalcular una semana en local (borrar su documento y reiniciar el worker).

## Open Questions

- **Q1 [no bloqueante] — valor por defecto de `FEATURE_GROUP_BRIEF`.** Opciones: (a) `true` (la tarjeta funciona en
  staging sin tocar el compose; apagarla allí exige revertir o un change de compose); (b) `false` como el digest (seguro
  por omisión, pero la feature queda muerta en staging hasta un change de compose, que este change tiene prohibido);
  (c) sin flag. **Recomendación: (a)**, porque el trabajo no sale de Mongo ni gasta nada. Las tareas lo implementan
  así; cambiar a (b) es una línea.
- **Q2 [no bloqueante] — «no la sigue nadie».** Opciones: (a) fuera, como decide D4; (b) la variante «nadie comparte
  su proceso» solo con postulaciones `visibility` `group` (Cortes siguientes §3), en este change; (c) la versión con
  postulaciones privadas y un mínimo de miembros. **Recomendación: (a) en este change y (b) como corte propio si el
  debate lo pide**; (c) se descarta por D4 (filtra estado privado con 2 a 5 personas).
- **Q3 [no bloqueante] — mínimo de viñetas.** Opciones: (a) 1 (D5); (b) 3, como sugería el panel («3 a 5 viñetas»), y
  si no llega no se guarda. **Recomendación: (a)**; se revisa con la distribución de la métrica 1 en 35b.
- **Q4 [no bloqueante] — número de fila en §6.** Se anota como 39 (candidata); si otra rama sin fusionar usa el 39, se
  renumera al fusionar sin cambiar nada más.

## Aprobación humana

Pendiente. El panel del 2026-11-25 propuso este corte; el owner todavía no autorizó el apply. La tarea 0.2 exige
registrar aquí, con fecha, el pedido literal del owner y su alcance (apply en la rama `change/group-weekly-brief`, sin
fusión salvo ventana abierta por el owner), igual que en `weekly-plan`.
