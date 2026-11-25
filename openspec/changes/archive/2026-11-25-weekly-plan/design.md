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
  en lenguaje llano, y pueda marcarlas «Hecho», «Ahora no» u «Ocultar sugerencia».
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
| `apply_before_close` | estado `saved` o `interested`, `expiresAt` ausente o ≥ hoy, y (`expiresAt` entre hoy y hoy+7 días UTC **o** último encaje ≥ 75 con `degraded === false`) | `closing_soon` (`expiresAt`, `daysLeft` 0-7) si vence; si no, `high_fit` (`score`) | `closing_soon` por `daysLeft` asc; luego `high_fit` por `score` desc |
| `follow_up` | estado `applied` o `in_process`, y `now − statusChangedAt ≥ 10 días` | `quiet` (`daysQuiet`, `status`, `appliedAt?`) | `daysQuiet` desc |
| `ask_know_someone` | estado `saved`, `interested`, `applied` o `in_process`, y conteo ≥ 1 | `know_someone` (`count`, `groupId`) | `count` desc |

Desempate final en todas: `applicationId` ascendente. Un `expiresAt` anterior a hoy sin `closedAt` (el detector aún no
pasó) es un cierre de calendario (ADR-041): la postulación **no** es elegible para `apply_before_close` por ninguna de
las dos vías, tampoco por encaje (C2). `high_fit` exige un análisis **no degradado** (C7): el `RuleBasedMatcher` no es
señal suficiente para decir «encaja». `daysLeft` 0 se muestra como «Cierra hoy» (B7).

**Universo y tope de 200 (C6).** Antes del tope, las postulaciones se ordenan por `statusChangedAt` **ascendente** (las
más quietas primero, desempate `id`), no por `updatedAt`: así una edición de notas no saca del plan a una postulación
quieta. La carga completa de `listByUser` es la misma que ya hace el embudo de ADR-039 y es aceptable con 3-5 usuarios;
el tope solo acota las lecturas de la fachada. Constantes en `libs/shared`:
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

Efecto al leer (iteración 1: B4 y C8):

- `snoozed` («Ahora no») oculta la candidata **solo** en la semana W de la decisión;
- `done` («Hecho») la oculta en W y W+1 («no me lo repitas el lunes»);
- `dismissed` («Ocultar sugerencia») la oculta mientras viva la decisión, es decir, **todo el TTL** (35 días): la
  persona dijo que esa sugerencia no le sirve. Para leerlo, el caso de uso pide las decisiones de esa candidata sin
  filtrar por semana (`listActive(userId, now)`), no solo las de W y W−1. `listActive` filtra `decidedAt ≥ now − 35 días`
  con el reloj inyectado (N2): el monitor TTL de Mongo borra con retraso de hasta un minuto o más, así que la regla
  no depende de él y una sugerencia oculta vuelve exactamente a los 35 días si sigue aplicando (B10).

Al ocultar una, entra la siguiente candidata si la hay: la tarjeta sigue diciendo lo más útil. La respuesta trae
`doneThisWeek` (conteo de `done` de la semana) para el «Completaste N acciones esta semana».

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
  readonly knowSomeoneCount: number;     // marcas del grupo elegido, sin contar a userId (C1)
  readonly knowSomeoneGroupId?: string;  // grupo de userId con más marcas de otros (desempate groupId asc); ausente si 0
}
```

**Conteo (iteración 1, C1).** `knowSomeoneCount` es el conteo **del grupo elegido** —el máximo entre los grupos de
quien pregunta, sin contarle—, no una unión entre grupos. Así el número coincide con el que la persona ve en el listado
de ese grupo (menos su propia marca) cuando «Abrir» la lleva allí, y no suma personas que no están en ese grupo.

Implementación: (1) `membership.groupsOf(userId)` (ya existe); (2) `JobLinkRepository.planCardsOf(linkIds)`: un `$in`
con proyección `displayUrl`, `preview.title`, `preview.company`, `preview.expiresAt`, `closedAt`; (3)
`GroupLinkRepository.knowSomeoneOf(groupIds, linkIds)`: un `find` por el índice único `(groupId, linkId)` con
proyección `groupId`, `linkId`, `knowSomeoneUserIds`. Por cada link, el conteo es el del grupo de quien pregunta con
más marcas de otras personas (sin contarle a él; desempate `groupId` asc), no una unión entre grupos. **Tres consultas** sea cual sea el número de links; con más de `WEEKLY_PLAN_SCAN_MAX` ids procesa los
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

**Código de error registrado (C3).** `weekly_plan_action_not_found` entra en `apiErrorCodeSchema`
(`libs/shared/src/schemas/auth.schema.ts:112`, junto a `application_not_found` en `:177`), con su estado 404 y su
mensaje en `apps/api/src/presentation/http/api-error.ts` (como `application_not_found`, `:37` y `:96`), en la unión de
códigos del dominio (`applications/domain/errors.ts:5-7`) con su clase de error, y el filtro
`api-exception.filter.ts` lo traduce por su `code` (`:99`). El SPA no muestra ese código al usuario: lo usa para
recargar el plan (D10).

### D9. Seguimiento por plantilla (C4 absorbida; texto fijado en la iteración 1, B6)

En una acción `follow_up`, «Preparar seguimiento» despliega un texto armado **en el SPA** con `$localize` y los datos
de la acción, en el idioma de la interfaz, con «Copiar» (CDK `Clipboard`). Sin LLM, sin destinatario, sin `mailto`,
sin envío y sin guardar nada. El texto es exactamente este (`{título}` → «la vacante» / «the position» y `{empresa}` →
«su empresa» / «your company» si faltan; la fecha en formato largo del idioma):

| | Español | English |
|---|---|---|
| Línea 1 | `Hola:` | `Hello,` |
| Línea 2 (con `appliedAt`) | `Me postulé a {título} en {empresa} el {fecha}. Sigo con mucho interés en el puesto.` | `I applied for {título} at {empresa} on {fecha}. I am still very interested in the role.` |
| Línea 2 (sin `appliedAt`) | `Hace un tiempo me postulé a {título} en {empresa}. Sigo con mucho interés en el puesto.` | `I applied for {título} at {empresa} a while ago. I am still very interested in the role.` |
| Línea 3 | `¿Me podrían contar en qué estado está el proceso de selección?` | `Could you tell me where the selection process currently stands?` |

No dice «adjunto mi CV» ni «como conversamos» (no hay adjunto ni conversación que el sistema conozca) y cierra con una
pregunta abierta sobre el estado del proceso.

### D10. Tarjeta «Tu semana» en el tablero

`WeeklyPlanCardComponent` (`features/applications/weekly-plan-card.component.*`) va **arriba de las columnas** en
`applications-board.page.html`, debajo del encabezado, a todo el ancho y también en el móvil; no se pinta si el
tablero está vacío (el tablero ya tiene su estado vacío y la tarjeta no tendría nada que decir). Store propio
`core/applications/weekly-plan.store.ts` (`@ngrx/signals`), independiente del de postulaciones: un fallo del plan
**no** bloquea el tablero.

- Cargando: esqueleto de 3 líneas con `aria-busy="true"`.
- Vacío: «No hay nada urgente esta semana.», la línea fija (B1) «Aquí verás cuando una oferta guardada esté por
  cerrar, una postulación lleve 10 días sin novedades o alguien de tu grupo conozca a alguien en una de tus ofertas.» (EN: «This is where
  you will see when a saved offer is about to close, an application has gone 10 days without news, or someone in your
  group knows someone at one of your offers.») y, si `doneThisWeek > 0`, «Completaste N acciones esta semana.» (singular: «Completaste 1 acción esta semana.»; EN: «You completed N actions this week.» / «You completed 1 action this week.»).
- Error: «No pudimos armar tu semana.» con «Reintentar»; el tablero sigue funcionando y se pueden mover postulaciones.
- Acción (B4): el **título** de la oferta (o `displayUrl`) es el enlace «Abrir»: abre el detalle de la postulación en la
  misma página (salida hacia `ApplicationsBoardPage.openDetail`) y, en `ask_know_someone`, navega a `/grupos/:groupId`
  (resaltar el link con `?linkId=` queda para el corte siguiente, C13). Debajo, el motivo en una línea y **tres**
  botones con alto mínimo de 44 px (`min-h-11`): «Hecho» (`done`), «Ahora no» (`snoozed`, solo esta semana) y
  «Ocultar sugerencia» (`dismissed`). Nada abre la oferta externa ni actúa hacia fuera.
- Motivos (B2, B7), ES / EN:

  | `reason` | Español | English |
  |---|---|---|
  | `closing_soon`, `daysLeft` 0 | `Cierra hoy: postula hoy.` | `Closes today: apply today.` |
  | `closing_soon`, `daysLeft` 1 | `Cierra en 1 día: postula antes.` | `Closes in 1 day: apply before then.` |
  | `closing_soon`, `daysLeft` N > 1 | `Cierra en N días: postula antes.` | `Closes in N days: apply before then.` |
  | `high_fit` | `Encaja N/100 según tu análisis: postula.` | `Fits N/100 according to your analysis: apply.` |
  | `quiet` | `N días sin novedades: manda un seguimiento.` | `N days with no news: send a follow-up.` |
  | `know_someone`, `count` 1 | `1 persona de tu grupo conoce a alguien ahí: pregunta en el grupo.` | `1 person in your group knows someone there: ask in the group.` |
  | `know_someone`, `count` N > 1 | `N personas de tu grupo conocen a alguien ahí: pregunta en el grupo.` | `N people in your group know someone there: ask in the group.` |

  **Singular y plural (C9):** el motivo lo arma una función pura `weeklyPlanReasonText(reason)` con **un mensaje
  `$localize` por variante** (singular y plural elegidos en código), no ICU en la plantilla: se prueba sin renderizar y
  el catálogo tiene un id por frase.
- Tras «Hecho» en una acción `apply_before_close` (B5) la tarjeta muestra una línea «¿Ya postulaste? Muévela a
  Postulada» cuyo enlace abre el detalle de esa postulación; no escribe nada ni cambia el estado por su cuenta. La
  línea desaparece con la siguiente decisión o al recargar.
- Mientras una decisión viaja, los botones de esa acción quedan deshabilitados; el plan devuelto reemplaza al anterior.
- Errores al decidir (C4): `404 weekly_plan_action_not_found` → el SPA recarga el plan (`GET`) sin mensaje de error,
  porque la acción ya no aplica; cualquier otro error → «No pudimos guardar tu elección. Prueba de nuevo.» y los
  botones vuelven a habilitarse.
- Coherencia con el tablero (C4, N4): la recarga se engancha en `ApplicationMoves.move`
  (`features/applications/application-moves.ts:58`), el camino común del tablero y del diálogo de detalle, cuando el
  cambio de estado termina bien; un movimiento cancelado o fallido no recarga. Así una postulación movida a `applied`
  deja de aparecer como «postula antes» venga de donde venga el cambio.

Textos con ids `@@applications.weeklyPlan.*`; `messages.xlf` se regenera y `messages.en.xlf` se traduce (ADR-050).

### D11. Seed demo: una oferta que vence en 3 días

`DEMO_LINKS.closingSoon` (estado `saved`, `expiresInDays: 3`): el seed fija `preview.expiresAt` = hoy+3 por
`UpdateLinkPreview` (el mismo camino que `ensurePreview`, `seed-demo.runner.ts:252-268`). Con lo que ya hay, Ana ve
exactamente tres acciones: `apply_before_close` (`closingSoon`), `follow_up` (`staleApp`) y `ask_know_someone`
(`openSalary`, marcado por Bob). Idempotente: una segunda corrida mueve la fecha a hoy+3 y no duplica nada.

**Estabilidad entre corridas (C5).** `openSalary` está `applied`; si el seed se corre otra vez 10 días después, sin
más, pasaría a `follow_up` y el plan de Ana dejaría de tener `ask_know_someone`. Por eso el seed fija también
`statusChangedAt = now` de `openSalary` en **cada** corrida (con el mismo ayudante que ya fija el de `staleApp`,
`markStaleStatusChangedAt`, `seed-demo.runner.ts:114-117`), y el test de segunda corrida usa `now` + 12 días.

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
  alguien deja el grupo sin que se le quite la marca, cuenta. Mismo comportamiento que `groups/know-someone`; queda
  fuera de este change y, si se corrige, es en `groups` (iteración 1).
- **R3. Solo postulaciones.** Una oferta en «Solo para mí» sin seguir no entra al plan. Es deliberado (el tablero es
  la superficie) y reduce lecturas; se revisa con datos.
- **R4. Más de 200 postulaciones abiertas**: entran las 200 más quietas (`statusChangedAt` asc, C6); una guardada
  recién movida podría quedar fuera de `apply_before_close`. Con 3-5 invitados no ocurre.
- **R8. Registro de los textos (cerrado).** Los textos de B1 y B2 se redactaron con voseo; se pasaron a tuteo, como el
  resto del SPA («Pulsa», «muévela», «Aquí verás»). Ver Q5.
- **R5. `isoWeekKey` duplicada** en api y worker. Mismos vectores de test en las dos; se unifica en el corte 3.
- **R6. La rama no se fusiona** hasta una ventana del owner: la medición real llega con 35b y `main`. Hasta entonces se
  mide con el seed en local.
- **R7. Ruido de decisiones**: un usuario puede descartar todo. Es su derecho; `doneThisWeek` y el conteo de
  `dismissed` son la métrica (ver Métrica).

**Métrica de éxito (35b, 3-5 invitados; iteraciones 1 y 2, B3 y B3'):**

1. **Semanas-persona con al menos un «Hecho»** sobre **semanas-persona con al menos una postulación abierta** (no
   cerrada ni `accepted` en algún momento de esa semana; sale de `applications`, no de visitas, que no se registran):
   objetivo ≥ 50 % en las dos semanas de medición. Se reporta también el **número absoluto** de semanas-persona con
   algún «Hecho»: con 3-5 personas un porcentaje solo engaña.
2. **«Hecho» frente a «Ocultar sugerencia»** (`done` vs `dismissed`) por regla: si `dismissed` supera a `done` en una
   regla, esa regla se revisa.
3. Numeradores de `weekly_plan_decisions` **antes de que venza el TTL** de 35 días y denominador de `applications`
   (consultas agregadas en el RUNBOOK, tarea 9.4), sin `userId` en el resultado.
4. **Pregunta directa** a cada invitado a las 2 semanas: «¿"Tu semana" te ayudó a decidir qué hacer? ¿Qué le
   sacarías o agregarías?», anotada en el informe de 35b.

## Migration Plan

Colección e índices nuevos (Mongoose `autoIndex` como el resto del módulo, incluido el índice TTL); sin migración de
datos. Rollback: revertir el PR; la colección queda huérfana y su TTL la vacía en 35 días (o se borra a mano con
`db.weekly_plan_decisions.drop()`). Sin variables de entorno ni flags. Todo esto queda escrito en `docs/RUNBOOK.md`
(tarea 9.4, C12).

## Open Questions

Q1-Q4 quedaron resueltas en la iteración 1 con la recomendación (ver la tabla del debate); se conservan como registro.

- **Q5 [no bloqueante] — voseo o tuteo en los textos nuevos.** B1 y B2 fijaron textos con voseo; el SPA vigente tutea.
  Opciones: (a) respetar los textos tal como los fijó el debate; (b) pasarlos a tuteo («postula», «manda», «Aquí
  verás») para que coincidan con el resto del catálogo; (c) decidir un registro único para todo el SPA en otro change.
  Recomendación: (b) en este change, porque el texto no cambia y la tarjeta no desentona; se aplica solo si el owner o
  la iteración 2 lo confirman.
  **Q5: tuteo (reflect, 2026-11-25).** Todos los textos ES fijados (vacío, motivos, botones, «¿Ya postulaste? Muévela
  a Postulada», borrador) quedan en tuteo, como el resto del catálogo.
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

## Debate iteración 1 (2026-11-25)

Participaron `critic` y `business`; la sesión principal actuó como `reflect`. V0 de business = obligatorio.

| id | origen | decisión | motivo |
|---|---|---|---|
| B1 | business | aceptado | El vacío explica qué aparecerá y cuándo; texto fijo ES/EN en D10 y escenario en `web/weekly-plan`. |
| B2 | business | aceptado | Cada motivo dice qué hacer con un verbo; textos ES/EN de los cuatro motivos en D10 y escenario. |
| B3 | business | aceptado | La métrica pasa a semanas-persona con al menos un «Hecho», `done` vs `dismissed` antes del TTL y pregunta directa a las 2 semanas. |
| B4 | business | adaptado | Tres botones: «Hecho», «Ahora no» (`snoozed`) y «Ocultar sugerencia» (`dismissed`); «Abrir» pasa al título de la acción. |
| B5 | business | aceptado | Tras «Hecho» en `apply_before_close`, «¿Ya postulaste? Muévela a Postulada» abre el detalle; sin escritura automática. |
| B6 | business | aceptado | Texto del borrador fijado en D9: sin «adjunto mi CV» ni «como conversamos», cierra con una pregunta abierta. |
| B7 | business | aceptado | `daysLeft` 0 se muestra «Cierra hoy». |
| C1 | critic | aceptado | `count` = conteo del grupo elegido (máximo por grupo, sin quien pregunta), igual al del listado de ese grupo (D7). |
| C2 | critic | aceptado | `expiresAt < hoy` no es elegible para `apply_before_close`, tampoco por encaje (D2). |
| C3 | critic | aceptado | `weekly_plan_action_not_found` registrado en `apiErrorCodeSchema`, `api-error.ts`, errores del dominio y filtro (D8, tarea 4.5). |
| C4 | critic | aceptado | 404 al decidir recarga el plan; otro error muestra mensaje y reactiva botones; el plan se recarga tras un `moveTo` exitoso (D10). |
| C5 | critic | aceptado | El seed fija `statusChangedAt = now` de `openSalary` en cada corrida; test de segunda corrida con `now` + 12 días (D11). |
| C6 | critic | adaptado | Antes del tope de 200, orden por `statusChangedAt` asc; la carga completa es aceptable con 3-5 usuarios (D2, R4). |
| C7 | critic | aceptado | `high_fit` exige `degraded === false` (D2). |
| C8 | critic | aceptado | Resuelto con B4: `dismissed` oculta todo el TTL, `done` W y W+1, `snoozed` solo W (D5). |
| C9 | critic | aceptado | Singular/plural con dos mensajes `$localize` elegidos en código por `weeklyPlanReasonText` (D10). |
| C10 | critic | aceptado | Comentario del puerto `ApplicationLinks.planSignalsOf` y spec del adaptador (tarea 4.2). |
| C11 | critic | aceptado | 4.3, 4.6 y 8.1 partidas en tareas de menos de una hora. |
| C12 | critic | aceptado | Tarea de RUNBOOK (colección, TTL, `autoIndex`, rollback, consulta de métrica) y `deleteMany({ userId: userOid })` en 5.1. |
| C13 | critic | diferido | Resaltar el link en el grupo con `?linkId=` va al corte siguiente; en el MVP «Abrir» va al grupo y el motivo ya dice qué hacer. R2 (ex-miembros) queda fuera, en `groups`. |
| Q1 | arquitecto | aceptado | e2e con datos propios en el perfil `local` + test de integración del seed (tareas 6.2, 8.1a-b). |
| Q2-Q4 | arquitecto | aceptado | TTL de 35 días, umbrales como constantes de `libs/shared`, fila 38 renumerable. |

Q5: tuteo (reflect, 2026-11-25). No queda ninguna pregunta abierta tras la iteración 1.

## Debate iteración 2 (2026-11-25)

Participaron `critic` y `business`; la sesión principal actuó como `reflect`. Ningún hallazgo nuevo es P0; el único V0
(B3') queda resuelto con la decisión de esta tabla.

| id | origen | decisión | motivo |
|---|---|---|---|
| B3' | business (V0) | aceptado | El denominador de la métrica 1 pasa a semanas-persona con al menos una postulación abierta, que sale de `applications` (las visitas no se registran); se reporta además el número absoluto de semanas-persona con algún «Hecho». Consultas en el RUNBOOK (tarea 9.4). |
| B8 | business | aceptado | «Completaste N acciones esta semana.» con singular («Completaste 1 acción esta semana.») y EN («You completed N actions / 1 action this week.»); escenario en `web/weekly-plan`, test en 7.2b. |
| B9 | business | aceptado | La línea fija del vacío termina en «…conozca a alguien en una de tus ofertas.» (EN «…knows someone at one of your offers.»). |
| B10 | business | aceptado | El RUNBOOK dice que una sugerencia oculta vuelve a los 35 días si sigue aplicando (tarea 9.4). |
| N1 | critic | aceptado | En 7.2a y 7.4, un `describe` EN que carga `messages.en.xlf` con `loadTranslations` y afirma los textos exactos; queda en verde tras 7.6. |
| N2 | critic | aceptado | `listActive(userId, now)` filtra `decidedAt ≥ now − 35 días` con el reloj inyectado, sin depender del monitor TTL; escenario «La sugerencia oculta vuelve a los 35 días» y test «dismissed reappears after 35 days» (4.1, 4.6b). |
| N3 | critic | aceptado | 6.1 fija `expiresAt` = `deps.now` (UTC) + 3 días. |
| N4 | critic | aceptado | La recarga del plan se engancha en `ApplicationMoves.move` al terminar bien (tablero y detalle); escenarios nuevos del detalle y del movimiento cancelado; 7.5 ajustada (D10). |
| N5 | critic | aceptado | 2.2 partida en 2.2a (`apply_before_close` y tipos) y 2.2b (`follow_up`, `ask_know_someone`, cierre y prioridad). |

Convergencia: SI

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
