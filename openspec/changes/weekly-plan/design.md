## Context

El panel de nuevas features del 2026-11-25 (cuatro proponentes, crítico adversarial y cinco jurados; artefactos en el
scratchpad de la sesión: `brief-comun.md`, `lista-corta.md`, `critica.md`, `votacion.md`) eligió **C1 `weekly-plan`**
por 208/250, primera en los cinco rankings. El jurado fijó **siete condiciones obligatorias** para el MVP; este design
las cumple una a una (tabla al final de Decisiones). C4 (`follow-up-draft`) entra absorbida como acción de plantilla y
C3 (`group-weekly-brief`) queda como segundo corte (§«Cortes siguientes»).

Lo que ya existe y este change reutiliza (verificado en el código de `c45ee799`):

- **Postulaciones del usuario, completas y on-read.** `ApplicationRepository.listByUser(userId)` devuelve todas, de la
  más recientemente cambiada a la más antigua (`apps/api/src/modules/applications/application/ports/application-repository.port.ts:93-100`).
  El embudo de ADR-039 ya agrega sobre esa lista sin dual-write (`get-application-analytics.usecase.ts:20-52`).
- **«Postulación quieta».** Umbral `APPLICATION_STALE_AFTER_DAYS = 10` (`libs/shared/src/events/application-stale.event.ts:11`)
  medido contra `statusChangedAt` con el reloj inyectado `APPLICATIONS_CLOCK` (`get-application-analytics.usecase.ts:61-86`,
  `ports/clock.port.ts:4-8`). Estados y cierres: `APPLICATION_STATUSES` y `isClosedStatus`
  (`libs/shared/src/schemas/application.schema.ts:14-24`, `:86-88`).
- **Frescura.** `JobLink.closedAt` ausente = abierta (`apps/api/src/modules/links/domain/job-link.ts:50-53`, ADR-037);
  `preview.expiresAt` es fecha sin hora `YYYY-MM-DD` o `null` (`libs/shared/src/schemas/preview.schema.ts:74-87`); un
  `expiresAt` pasado es cierre de calendario (ADR-041). Índice `{ closedAt, preview.expiresAt, _id }` en
  `links/infrastructure/link.schemas.ts:196`.
- **«Conozco a alguien».** `GroupLink.knowSomeoneUserIds` (`links/application/ports/group-link-repository.port.ts:29-33`),
  persistido en `group_links` (`link.schemas.ts:113`, `:229`) con índice único `(groupId, linkId)` (`link.schemas.ts:250`).
  La spec `groups/know-someone` solo expone **conteo** y `flaggedByMe`, nunca identidades (`openspec/specs/groups/know-someone/spec.md:44-50`).
- **Fachada de links.** `LinksFacade` es la única entrada de otros módulos a `links` y solo lee
  (`links/application/links.facade.ts:24-39`); `applications` la consume detrás del puerto `APPLICATION_LINKS`
  (`applications/application/ports/application-links.port.ts:6-28`, adaptador `infrastructure/links-facade-application-links.ts:13-30`).
  La fachada ya tiene el puerto de pertenencia con `groupsOf(userId)` (`links/application/ports/group-membership.port.ts`).
- **Encaje.** `ApplicationFitScores.scoresFor(userId, linkIds)` por lote, puntuación 0-100 del último análisis `done`
  (`applications/application/application-fit-scores.ts:10-58`); sin `match` registrado devuelve un mapa vacío.
- **Rutas y tablero.** `@Controller('applications')` con `@Get('analytics')` como precedente de ruta estática del
  módulo (`applications/presentation/applications.controller.ts:44`, `:76`); no hay ninguna ruta `/api/me/*`. El SPA
  sirve el tablero en `/postulaciones` (`apps/web/src/app/app.routes.ts:78-81`), página
  `features/applications/applications-board.page.{ts,html}`, que ya abre el detalle desde `applicationId`+`linkId`
  (`applications-board.page.ts:77-94`). Cliente HTTP en `core/applications/applications.api.ts:85-87`.
- **Semana ISO.** El worker ya calcula `isoWeekKey(date)` en UTC (`apps/worker/src/modules/notifications/domain/iso-week.ts:21`)
  para el digest de grupo (`libs/shared/src/events/group-weekly-digest.event.ts:18-21`, regex `^\d{4}-W\d{2}$`).
- **Borrado de cuenta.** Cascada en `users/infrastructure/mongo-account-deletion.cascade.ts:154-170` (postulaciones y
  eventos); la spec lista las colecciones (`openspec/specs/users/account-deletion/spec.md:40-70`).
- **Seed demo.** Ana tiene una postulación `applied` quieta 11 días (`apps/api/src/seed/demo-seed.dataset.ts:77-86`,
  `seed-demo.runner.ts:108-117`) y Bob marca «conozco a alguien» en `openSalary` (`seed-demo.runner.ts:120-122`). Falta
  una oferta guardada que venza pronto.

## Goals / Non-Goals

**Goals**

- Que la persona vea arriba del tablero **como mucho 3 acciones** para esta semana, cada una con un motivo de una línea
  en lenguaje llano, y pueda marcarlas «Hecho», «Descartar» o «La semana que viene».
- Cálculo **on-read, determinista y sin IA**, detrás de un puerto que admita después un planificador LLM sin tocar el
  contrato.
- Cero datos de otros miembros salvo un **conteo**.
- Cumplir las siete condiciones del jurado.

**Non-Goals (este change)**

- LLM, cron, avisos, memoria episódica usada por el planificador, vista de grupo, C3. Diseñados en «Cortes siguientes».
- Regla «skill que falta» (sin fuente fiable: condición 2).
- Links de la lista privada que no están en el tablero (el plan sale de las postulaciones; ver R3 de Riesgos).
- Cambiar el estado de una postulación desde la tarjeta.
- Despliegue, CI, compose, variables de entorno, `libs/ai`, worker.

## Decisions

### D1. Plan on-read detrás del puerto `WeeklyPlanner`, con `RuleBasedPlanner` como única implementación

`GET /api/applications/weekly-plan` recolecta candidatas (solo lecturas), las pasa a `WeeklyPlanner.plan(input)` y
devuelve el resultado. **No escribe nada al leer** (ADR-039: on-read, sin snapshot ni dual-write). La interfaz
`WeeklyPlanner` y su entrada/salida viven en `applications/domain/weekly-plan/` (puras, sin `@nestjs/*`); el token
`WEEKLY_PLANNER` en `application/ports/weekly-planner.port.ts`; el módulo lo provee con
`{ provide: WEEKLY_PLANNER, useClass: RuleBasedPlanner }`. La firma es asíncrona (`Promise<WeeklyPlanOutcome>`) para que
el planificador LLM del corte 2 entre sin cambiar a quien llama; `RuleBasedPlanner` resuelve sin E/S.

La entrada del planificador es **canónica**: hechos por candidata (estado, días quieta, días hasta el cierre, encaje,
conteo), decisiones de la semana y la anterior, `today` como fecha `YYYY-MM-DD`. Así el mismo objeto sirve mañana de
entrada a `runTask` con ids sintéticos (D12).

*Alternativas descartadas:* snapshot semanal persistido por un job (exige cron y worker: es el corte 3); calcular en el
SPA a partir del tablero (el SPA no tiene frescura ni conteos y duplicaría reglas sin tests de dominio).

### D2. Tres reglas, con prioridad fija

Universo: las postulaciones del usuario que **no** están cerradas ni `accepted`, las **200** cambiadas más
recientemente (`WEEKLY_PLAN_SCAN_MAX`), cuyo link existe y **no** tiene `closedAt`. Cada postulación produce como mucho
**una** candidata: la de la primera regla que cumple, en este orden.

| Regla (`rule`) | Cumple si | Motivo (`reason.kind`) | Orden dentro de la regla |
|---|---|---|---|
| `apply_before_close` | estado `saved` o `interested`, y (`expiresAt` entre hoy y hoy+7 días UTC **o** encaje ≥ 75) | `closing_soon` (`expiresAt`, `daysLeft` 0-7) si vence; si no, `high_fit` (`score`) | `closing_soon` por `daysLeft` asc; luego `high_fit` por `score` desc |
| `follow_up` | estado `applied` o `in_process`, y `now − statusChangedAt ≥ 10 días` | `quiet` (`daysQuiet`, `status`, `appliedAt?`) | `daysQuiet` desc |
| `ask_know_someone` | estado `saved`, `interested`, `applied` o `in_process`, y conteo ≥ 1 | `know_someone` (`count`, `groupId`) | `count` desc |

Desempate final en todas: `applicationId` ascendente. Un `expiresAt` anterior a hoy sin `closedAt` (el detector aún no
pasó) **no** cumple `closing_soon`: es un cierre de calendario (ADR-041). Constantes en `libs/shared`:
`WEEKLY_PLAN_CLOSING_SOON_DAYS = 7`, `WEEKLY_PLAN_HIGH_FIT_SCORE = 75`, y se reutiliza `APPLICATION_STALE_AFTER_DAYS`.

*Por qué `applied`/`in_process` y no los mismos estados que el embudo:* seguir a una empresa solo tiene sentido después
de postular; `offer` ya tiene a alguien hablando con la persona.

### D3. Selección: tope de 3, una por regla primero

Tras quitar las ocultas por decisiones (D5), el planificador toma por turnos la primera de cada regla en el orden
`apply_before_close` → `follow_up` → `ask_know_someone` y repite hasta **3** (`WEEKLY_PLAN_MAX_ACTIONS`) o hasta agotar
candidatas. Variedad antes que profundidad: con una de cada, la tarjeta cuenta tres cosas distintas. El tope está en el
dominio y en el contrato (`.max(3)`).

### D4. `candidateId` estable y legible por el dominio

`candidateId = "<rule>:<applicationId>"`. Es estable mientras la postulación siga en la misma regla, no expone nada que
el dueño no tenga ya y permite que la decisión se valide sin otra tabla. Si la postulación cambia de regla (p. ej. de
`saved` a `applied`), nace otra candidata: la decisión anterior no la oculta, que es lo correcto.

### D5. Decisiones en colección propia, sin dual-write

Colección `weekly_plan_decisions`: `{ userId: ObjectId, weekKey: string, candidateId: string, decision: 'done' |
'dismissed' | 'snoozed', decidedAt: Date }`, índice **único** `(userId, weekKey, candidateId)` y TTL de **35 días**
sobre `decidedAt`. `POST /api/applications/weekly-plan/decisions` hace upsert (la última gana) y devuelve el plan
recalculado, así el SPA pinta con una sola petición. **Ninguna** decisión toca `applications` ni `application_events`.

Efecto al leer:

- cualquier decisión de la semana en curso oculta esa candidata esta semana;
- `done` o `dismissed` de la semana anterior la ocultan también esta semana («no me lo repitas el lunes»);
- `snoozed` de la semana anterior **no** la oculta: «La semana que viene» significa exactamente eso.

Al ocultar una, entra la siguiente candidata si la hay: la tarjeta sigue diciendo lo más útil. La respuesta trae
`doneThisWeek` (conteo de `done` de la semana) para el «Hiciste N esta semana».

Validación: el `candidateId` tiene que estar entre las candidatas **elegibles** de ahora (antes del tope y antes de
ocultar). Si no —inventado, de otra persona, o ya no aplica— responde `404 weekly_plan_action_not_found`, el mismo
código para todos los casos (mismo criterio que el 404 uniforme de `applications`).

*Alternativas descartadas:* un campo en la postulación (dual-write, y «Hecho» no es un estado de ADR-004); guardar el
plan entero por semana (es el snapshot del corte 3).

### D6. Semana ISO en UTC

`weekKey` = semana ISO `YYYY-Www` en UTC, el formato del digest (`group-weekly-digest.event.ts:18-21`). La función pura
`isoWeekKey` y `previousWeekKey` se escriben en `applications/domain/weekly-plan/week-key.ts`, **copiando** la del worker
(`iso-week.ts:21`) con los mismos vectores de test; unificarlas en `libs/shared` toca el worker y queda fuera (R5). Para
Bolivia (UTC−4) la semana cambia el domingo a las 20:00: se acepta (crítico, P2) y lo dice la spec.

### D7. `LinksFacade.planSignalsOf(userId, linkIds)`: tres lecturas fijas, solo conteos

Método nuevo de la fachada (condición 3), detrás de un método nuevo del puerto `ApplicationLinks`:

```ts
planSignalsOf(userId: string, linkIds: readonly string[]): Promise<ReadonlyMap<string, LinkPlanSignals>>;
interface LinkPlanSignals {
  readonly id: string; readonly displayUrl: string; readonly title?: string; readonly company?: string;
  readonly closed: boolean;              // closedAt presente
  readonly expiresAt?: string;           // preview.expiresAt YYYY-MM-DD, ausente si null o sin preview
  readonly knowSomeoneCount: number;     // personas distintas, sin contar a userId, en grupos de userId
  readonly knowSomeoneGroupId?: string;  // grupo de userId con más marcas (desempate groupId asc); ausente si 0
}
```

Implementación: (1) `membership.groupsOf(userId)` (ya existe); (2) `JobLinkRepository.planCardsOf(linkIds)`: un `$in`
con proyección `displayUrl`, `preview.title`, `preview.company`, `preview.expiresAt`, `closedAt`; (3)
`GroupLinkRepository.knowSomeoneOf(groupIds, linkIds)`: un `find` por el índice único `(groupId, linkId)` con
proyección `groupId`, `linkId`, `knowSomeoneUserIds`. El conteo deduplica `userId` entre grupos y excluye a quien
pregunta. **Tres consultas** sea cual sea el número de links; con más de `WEEKLY_PLAN_SCAN_MAX` ids procesa los
primeros y lo dice el comentario. Los ids mal formados o inexistentes no aportan nada (contrato de la fachada,
`links/sharing` «Links disponibles para otros módulos»). **Nunca** devuelve userIds ni nombres: el tipo no los tiene.

Si la consulta de conteo no puede hacerse, la regla `ask_know_someone` sale (condición 3: no se aproxima); con este
diseño sí puede, así que entra.

*Alternativa descartada:* ampliar `cardsOf` con frescura (cambia la ficha que usan tablero y `match`); leer
`group_links` desde `applications` (prohibido por lint).

### D8. Contrato en `libs/shared` (`schemas/weekly-plan.schema.ts`)

```ts
WEEKLY_PLAN_MAX_ACTIONS = 3; WEEKLY_PLAN_CLOSING_SOON_DAYS = 7; WEEKLY_PLAN_HIGH_FIT_SCORE = 75; WEEKLY_PLAN_SCAN_MAX = 200
weeklyPlanRuleSchema = z.enum(['apply_before_close', 'follow_up', 'ask_know_someone'])
weeklyPlanDecisionSchema = z.enum(['done', 'dismissed', 'snoozed'])
weeklyPlanWeekKeySchema = z.string().regex(/^\d{4}-W\d{2}$/)
weeklyPlanCandidateIdSchema = z.string().trim().min(1).max(96)        // formato lo juzga el dominio (404 uniforme)
weeklyPlanReasonSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('closing_soon'), expiresAt: z.iso.date(), daysLeft: z.number().int().min(0).max(7) }),
  z.strictObject({ kind: z.literal('high_fit'), score: z.number().int().min(0).max(100) }),
  z.strictObject({ kind: z.literal('quiet'), daysQuiet: z.number().int().min(10),
                   status: z.enum(['applied', 'in_process']), appliedAt: z.iso.datetime().optional() }),
  z.strictObject({ kind: z.literal('know_someone'), count: z.number().int().min(1), groupId: z.string().min(1) }),
])
weeklyPlanActionSchema = z.strictObject({
  candidateId, rule: weeklyPlanRuleSchema, applicationId: z.string().min(1), linkId: z.string().min(1),
  link: z.strictObject({ displayUrl: z.string().min(1), title: z.string().optional(), company: z.string().optional() }),
  reason: weeklyPlanReasonSchema,
})
weeklyPlanResponseSchema = z.strictObject({
  weekKey: weeklyPlanWeekKeySchema, planner: z.enum(['rules']),
  actions: z.array(weeklyPlanActionSchema).max(3), doneThisWeek: z.number().int().nonnegative(),
})
weeklyPlanDecisionRequestSchema = z.strictObject({ candidateId: weeklyPlanCandidateIdSchema, decision: weeklyPlanDecisionSchema })
```

Rutas: `GET /api/applications/weekly-plan` → `200 WeeklyPlanResponse`; `POST /api/applications/weekly-plan/decisions`
con `WeeklyPlanDecisionRequest` → `200 WeeklyPlanResponse`, `400` cuerpo inválido, `404 weekly_plan_action_not_found`.
Autenticadas como el resto del controlador; el usuario sale del token, nunca del cuerpo. `planner` es enum para que el
corte 2 añada `'llm'` sin romper a los clientes que ya lo leen. El texto del motivo **no** viaja: lo arma el SPA desde
`reason` con i18n (D10).

### D9. Seguimiento por plantilla (C4 absorbida)

En una acción `follow_up`, «Preparar seguimiento» despliega un texto de 3-4 líneas armado **en el SPA** con
`$localize` y los datos de la acción (`title`, `company`, `appliedAt` o «hace N días»), en el idioma de la interfaz,
con «Copiar» (CDK `Clipboard`). Sin LLM, sin destinatario, sin `mailto`, sin envío y sin guardar nada. Sin `title` ni
`company`, la plantilla usa «la vacante» / «su empresa».

### D10. Tarjeta «Tu semana» en el tablero

`WeeklyPlanCardComponent` (`features/applications/weekly-plan-card.component.*`) va **arriba de las columnas** en
`applications-board.page.html`, debajo del encabezado, a todo el ancho y también en el móvil; no se pinta si el
tablero está vacío (el tablero ya tiene su estado vacío y la tarjeta no tendría nada que decir). Store propio
`core/applications/weekly-plan.store.ts` (`@ngrx/signals`), independiente del de postulaciones: un fallo del plan
**no** bloquea el tablero.

- Cargando: esqueleto de 3 líneas con `aria-busy="true"`.
- Vacío: «No hay nada urgente esta semana.» y, si `doneThisWeek > 0`, «Hiciste N esta semana.».
- Error: «No pudimos armar tu semana.» con «Reintentar»; el tablero sigue funcionando.
- Acción: motivo en una línea (`i18n` con ICU `plural`), nombre de la oferta y botones «Abrir», «Hecho»,
  «Descartar», «La semana que viene», con alto mínimo de 44 px (`min-h-11`). «Abrir» abre el detalle de la postulación
  en la misma página (salida hacia `ApplicationsBoardPage.openDetail`); en `ask_know_someone` navega a
  `/grupos/:groupId`. Nada abre la oferta externa automáticamente ni actúa hacia fuera.
- Mientras una decisión viaja, los botones de esa acción quedan deshabilitados; el plan devuelto reemplaza al anterior.

Textos con ids `@@applications.weeklyPlan.*`; `messages.xlf` se regenera y `messages.en.xlf` se traduce (ADR-050).

### D11. Seed demo: una oferta que vence en 3 días

`DEMO_LINKS.closingSoon` (estado `saved`, `expiresInDays: 3`): el seed fija `preview.expiresAt` = hoy+3 por
`UpdateLinkPreview` (el mismo camino que `ensurePreview`, `seed-demo.runner.ts:252-268`). Con lo que ya hay, Ana ve
exactamente tres acciones: `apply_before_close` (`closingSoon`), `follow_up` (`staleApp`) y `ask_know_someone`
(`openSalary`, marcado por Bob). Idempotente: una segunda corrida mueve la fecha a hoy+3 y no duplica nada.

### D12. Entradas canónicas desde ya

`RuleBasedPlanner` recibe hechos sin `ObjectId` ni instantes: días relativos, `today` `YYYY-MM-DD` y una clave
opaca por candidata. El caso de uso traduce de ids reales a esa clave y de vuelta. Hoy no cuesta nada y es lo que
hace que la clave del mock `replay` (`sha256(canonicalJSON([task, promptVersion, lang, input]))`,
`libs/ai/src/application/execution-key.ts:17`) sea estable en el corte 2.

### Condiciones del jurado → decisiones

| Condición | Dónde |
|---|---|
| 1. On-read, determinista, puerto `WeeklyPlanner` + `RuleBasedPlanner`; LLM después con enum cerrado, entradas canónicas, eval y tope en código | D1, D12, Cortes siguientes §1 |
| 2. Tres reglas; «skill que falta» fuera | D2, Non-Goals |
| 3. Método de lote en `LinksFacade` con frescura y conteo | D7 |
| 4. Colección propia `(userId, weekKey ISO UTC, candidateId)`, sin dual-write | D5, D6 |
| 5. C4 como plantilla, sin envío ni destinatario | D9 |
| 6. ≤ 3 acciones, motivo de una línea, móvil, 44 px, vacío honesto, solo conteos, i18n | D3, D10, D7 |
| 7. Tests de reglas con repos en memoria, contrato de la fachada, e2e de la tarjeta con datos demo | tareas 2.x, 3.x, 7.x (ver Q1) |

## Cortes siguientes (diseñados, fuera de las tareas de este change)

Cada corte es un change propio, con su debate, y ninguno se abre antes de que el owner fusione este.

1. **`weekly-plan-llm` — planificador LLM como selector.** Tarea nueva `plan-week` en `libs/ai` por `runTask`
   (`KNOWN_TASK_NAMES`, prompt `plan-week.v1.md`, `temperature 0`, salida zod). Entrada: la entrada canónica de D12 con
   ids sintéticos `c1…cN` ordenados por la prioridad de D2, días relativos, título y empresa (datos públicos de la
   oferta), sin notas, CV, nombres ni ids reales; pasa por `PiiRedactor` hacia proveedores `external` y exige
   `aiConsent`. Salida: `{ picks: { candidateId: z.enum([c1…cN]) }[] }` de 0 a 3, **enum cerrado construido por
   petición**. Validador determinista: ids únicos, del conjunto, no ocultos, como mucho 3; si falla, un repair, luego
   siguiente proveedor, luego `RuleBasedPlanner` con `planner: 'rules'` (degradación honesta). Los motivos siguen
   siendo plantillas: el LLM **no** redacta texto visible en este corte. **Tope en código** (no en `AI_QUOTAS`, vacío
   en producción): 1 llamada por persona y semana, caché por `(userId, weekKey, hash de la entrada)` y tope diario
   global. Golden set sintético, baseline con `nx run ai:eval --provider=mock --update-baseline`, métricas
   `schema_validity_rate` y `valid_pick_rate` (puerta = 1,0) y acuerdo con las reglas como métrica informativa.
2. **Memoria episódica de 2 semanas.** Las decisiones de D5 (ids y resultado, sin texto) de W−1 y W−2 entran a la
   entrada canónica como rasgos («descartada la semana pasada»). El TTL de 35 días ya las cubre.
3. **`weekly-plan-monday` — agente programado.** Job del worker el lunes, por persona con postulaciones, con máquina
   `pending → gathering → planning → validating → ready | degraded | skipped`, idempotente por `(userId, weekKey)`,
   pasos máximos y presupuesto de llamadas por corrida (las corridas de sistema no tienen cuota:
   `libs/ai/src/application/run-task.usecase.ts:156`). Guarda un snapshot `weekly_plans` y avisa por los canales de `notifications` con
   preferencia de opt-out. Requiere mover el dominio del plan a una lib compartida por api y worker.
4. **Vista de grupo opt-in (sprint semanal).** Cada miembro decide si su conteo de «Hecho» de la semana cuenta para el
   grupo; la página del grupo muestra solo el total de quienes optaron, nunca quién ni qué. Con 3-5 personas un total
   puede señalar a alguien: el texto de opt-in lo dice y el total no se muestra con menos de 2 participantes.
5. **C3 `group-weekly-brief`.** Segundo corte del panel: tabla de hechos de ofertas del grupo (sin datos de miembros),
   viñetas por plantilla, calculada en el worker y leída por la api; LLM sintetizador con evaluador determinista
   después.

## Risks / Trade-offs

- **R1. `expiresAt` tiene poca cobertura** (crítico, P2): muchas ofertas no lo traen. Mitigación: `high_fit` como
  segunda vía de la misma regla y el seed para la demo. Se mide en 35b cuántas acciones `closing_soon` salen.
- **R2. Ex-miembros en `knowSomeoneUserIds`.** El conteo es el mismo array que ya muestra el listado de grupo; si
  alguien deja el grupo sin que se le quite la marca, cuenta. Mismo comportamiento que `groups/know-someone`; no se
  arregla aquí.
- **R3. Solo postulaciones.** Una oferta en «Solo para mí» sin seguir no entra al plan. Es deliberado (el tablero es
  la superficie) y reduce lecturas; se revisa con datos.
- **R4. Más de 200 postulaciones abiertas**: las más antiguas por `updatedAt` no entran. Con 3-5 invitados no ocurre.
- **R5. `isoWeekKey` duplicada** en api y worker. Mismos vectores de test en las dos; se unifica en el corte 3.
- **R6. La rama no se fusiona** hasta una ventana del owner: la medición real llega con 35b y `main`. Hasta entonces se
  mide con el seed en local.
- **R7. Ruido de decisiones**: un usuario puede descartar todo. Es su derecho; `doneThisWeek` y el conteo de
  `dismissed` son la métrica (ver Métrica).

**Métrica de éxito (35b, 3-5 invitados):** proporción de acciones mostradas que terminan en `done` en su semana
(objetivo ≥ 30 %) y proporción de semanas con al menos un `done` por persona activa; se lee de
`weekly_plan_decisions` antes de que caduquen.

## Migration Plan

Colección e índices nuevos (Mongoose `autoIndex` como el resto del módulo); sin migración de datos. Rollback: revertir
el PR; la colección queda huérfana y su TTL la vacía en 35 días. Sin variables de entorno ni flags.

## Open Questions

- **Q1 [no bloqueante] — e2e «con el seed demo» (condición 7).** `e2e-suite` prohíbe usar `api:seed-demo` en la suite
  por ser estado compartido y mutable (`openspec/changes/e2e-suite/design.md:256`). Opciones: (a) e2e con datos propios
  de la prueba en el perfil `local` (alta por la API y fechas escritas en Mongo como `links.spec.ts:182`) **más** un
  test del runner del seed que comprueba que Ana obtiene las tres reglas; (b) e2e contra el seed, rompiendo D5 de
  `e2e-suite`. **Recomendación: (a)**, que es lo que planifican las tareas 6.x y 7.x.
- **Q2 [no bloqueante] — retención de decisiones.** TTL de 35 días (cubre la memoria de 2 semanas y una ventana de
  medición de 14 días). Alternativas: 14 días (mínimo) o sin TTL (analítica larga). Recomendación: 35 días.
- **Q3 [no bloqueante] — umbrales.** `closing_soon` a 7 días y `high_fit` ≥ 75. Recomendación: dejarlos como
  constantes de `libs/shared` y revisarlos con los datos de 35b.
- **Q4 [no bloqueante] — número de fila en §6.** Se anota como 38 (candidata); si otra rama sin fusionar usa el 38,
  se renumera al fusionar sin cambiar nada más.

## Aprobación humana (2026-11-25)

Pedido literal del owner del 2026-11-25: «trabaja de forma ininterrumpida por las proximas 3 horas con las nuevas
features y propuesta de actividades nuevas para la plataforma usando patrones agenticos y multiagenticos adaptados para
lo que buscamos e iniciando con la implementacion en caso de que tengamos la propuesta final con mejor votacion entre
los agentes internos».

Alcance de esa autorización: elegir la propuesta por votación interna (hecho: C1, 208/250) y **empezar la
implementación en la rama `change/weekly-plan`** una vez que el debate critic/business/reflect de este change converja
sin P0/V0 abiertos. **No** autoriza la fusión a `main`, el archivado ni el despliegue: eso espera a que el owner abra
una ventana de fusión, y no altera la precedencia de la fila 35 (ADR-048, ADR-051). Tampoco aprueba los cortes
siguientes, que necesitan su propio change y su propia aprobación.
