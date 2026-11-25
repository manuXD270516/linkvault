## 0. Antes de aplicar

Cada tarea cabe en menos de una hora (la iteración 1 partió 4.3, 4.5, 4.6, 7.2 y 8.1, C11). Los títulos de test van en
inglés y salen de los escenarios de `specs/`. Rutas de `apps/api` relativas a `apps/api/src/modules/` salvo que se diga
otra cosa.

- [ ] 0.1 [infra] Debate critic/business/reflect de este change cerrado sin P0/V0 abiertos. Verificar: `design.md` lleva
  la sección `## Debate iteración N (fecha)` de la última iteración con «Convergencia: SI», P0 0 y V0 0, y las
  decisiones no triviales nuevas están en ADR-068. **Estado (2026-11-25):** iteración 1 aplicada (tabla en design);
  falta la iteración de convergencia.
- [ ] 0.2 [infra] Aprobación humana registrada. Verificar: `grep -c "## Aprobación humana (2026-11-25)" design.md` = 1
  y la sección cita literalmente el pedido del owner y dice que autoriza el apply en la rama, **no** la fusión.
  Falsación: si la sección dijera que autoriza fusionar, el revisor la rechaza; ningún PR de esta rama se fusiona sin
  una ventana abierta por el owner.
- [ ] 0.3 [infra] Plan y ADR coherentes. Verificar: `docs/design-v0.2.md` §6 tiene la fila `weekly-plan` como
  **Candidata** y `grep -c "weekly-plan" openspec-changes.yaml` = 0; `docs/adr/ADR-068.md` existe; `bash
  infra/ci/repo-checks.sh` y `openspec validate weekly-plan --strict --no-interactive` en verde.

## 1. Contrato en `libs/shared` (design D8)

- [ ] 1.1 [backend] `libs/shared/src/schemas/weekly-plan.schema.ts` con las constantes, enums y schemas de D8, exportado
  desde `libs/shared/src/index.ts`. Verificar con `weekly-plan.schema.spec.ts`: «accepts a plan with three actions of
  each rule», «rejects a plan with four actions», «rejects an unknown reason kind», «rejects a quiet reason under ten
  days», «accepts closing_soon with daysLeft 0», «rejects extra fields in an action» y «decision request accepts done,
  dismissed and snoozed only».

## 2. Dominio del plan en `applications` (design D1-D5, D6, D12)

- [ ] 2.1 [backend] `applications/domain/weekly-plan/week-key.ts`: `isoWeekKey(date)`, `previousWeekKey(weekKey)` y
  `nextWeekKey(weekKey)` en UTC, copiados de `apps/worker/src/modules/notifications/domain/iso-week.ts:21` con un
  comentario que lo diga. Verificar con `week-key.spec.ts`: «2026-12-31T23:30Z is 2026-W53», «2027-01-03 is 2026-W53»,
  «2027-01-04 is 2027-W01», «previous of 2027-W01 is 2026-W53», «next of 2026-W53 is 2027-W01» y «Monday 00:00Z starts
  a new week».
- [ ] 2.2 [backend] `applications/domain/weekly-plan/weekly-plan.ts` (tipos canónicos sin `ObjectId` ni `Date`: días
  relativos y `today` `YYYY-MM-DD`; el encaje lleva `degraded`), `weekly-planner.ts` (interfaz `WeeklyPlanner` con
  `plan(input): Promise<WeeklyPlanOutcome>`) y `rules.ts` (elegibilidad pura por regla). Verificar con `rules.spec.ts`:
  «saved link closing in 3 days is apply_before_close closing_soon», «closing today has daysLeft 0», «expiresAt
  yesterday without closedAt is not closing_soon», «expired with fit 80 yields no apply action», «interested with
  non-degraded fit 80 and no expiresAt is high_fit», «degraded fit does not count as high_fit», «applied quiet 12 days
  is follow_up», «saved quiet 30 days without signals yields nothing», «closed link yields nothing», «own flag alone
  does not count for ask_know_someone» y «one candidate per application, first rule wins».
- [ ] 2.3 [backend] `applications/domain/weekly-plan/rule-based-planner.ts`: orden dentro de cada regla, desempate por
  `applicationId`, ocultación por decisiones (D5: `snoozed` solo W; `done` W y W+1; `dismissed` mientras exista), turnos
  por regla y tope 3. Verificar con `rule-based-planner.spec.ts`: «caps at three actions», «round-robins one per rule
  before repeating», «snoozed hides only its own week», «done hides its week and the next one», «dismissed hides while
  the decision exists», «fills the slot of a hidden action with the next candidate» y «same input yields the same
  output». Falsación del tope: con `WEEKLY_PLAN_MAX_ACTIONS` cambiado a 4 en el test, «caps at three actions» falla.
- [ ] 2.4 [backend] Guardia de capas. Verificar: `pnpm nx run api:lint` en verde con `domain/weekly-plan/**` sin
  `@nestjs/*`, `mongoose` ni imports de otros módulos. Falsación: añadir temporalmente `import '@nestjs/common'` en
  `rules.ts` hace fallar el lint; se revierte.

## 3. Señales de plan en `links` (design D7, spec `links/sharing`)

- [ ] 3.1 [backend] `JobLinkRepository.planCardsOf(linkIds)` en el puerto, el repositorio en memoria y
  `mongo-job-link.repository.ts` (un `$in` con proyección de D7). Verificar en `mongo-job-link.repository.spec.ts` (replset
  en memoria) y en el spec del doble: «planCardsOf returns closed and expiresAt», «planCardsOf ignores malformed ids».
- [ ] 3.2 [backend] `GroupLinkRepository.knowSomeoneOf(groupIds, linkIds)` en el puerto, el doble en memoria y
  `mongo-group-link.repository.ts` (un `find` por el índice único `(groupId, linkId)` con proyección
  `groupId, linkId, knowSomeoneUserIds`). Verificar en `mongo-group-link.repository.spec.ts`: «knowSomeoneOf returns only
  relations of the given groups» y «knowSomeoneOf with empty inputs makes no query».
- [ ] 3.3 [backend] `LinksFacade.planSignalsOf(userId, linkIds)`: `groupsOf` + las dos lecturas en paralelo; por link, el
  grupo de quien pregunta con más marcas de otras personas (sin contarle; desempate `groupId` asc) y ese conteo (C1);
  tope 200. Verificar en `links.facade.spec.ts`: «planSignalsOf reports the count of the group with most flags by
  others» (Bob en G1; Carla, Dan y Ana en G2 → 2 y G2), «planSignalsOf count matches the group listing minus own
  flag», «planSignalsOf with only the own flag reports zero and no group», «planSignalsOf ignores groups the user is
  not in», «planSignalsOf reports freshness and skips malformed ids», «planSignalsOf never returns flagger ids» (la
  serialización JSON no contiene ids de Bob, Carla ni Dan) y «planSignalsOf makes the same number of queries for 3 and
  150 links». Falsación del último: un bucle de una consulta por link hace fallar el conteo de consultas.

## 4. Casos de uso, persistencia y rutas en `applications` (design D2, D5, D8)

- [ ] 4.1 [backend] Puerto `WEEKLY_PLAN_DECISION_REPOSITORY` (`upsert`, `listActive(userId)` —todas las vivas, acotadas
  por el TTL—), `InMemoryWeeklyPlanDecisionRepository` en `application/testing/` y `MongoWeeklyPlanDecisionRepository`
  con `weekly-plan-decision.schemas.ts` (colección `weekly_plan_decisions`, índice único `(userId, weekKey,
  candidateId)`, TTL 35 días en `decidedAt`). Verificar en `mongo-weekly-plan-decision.repository.spec.ts`: «upsert
  keeps a single document per key with the last decision», «listActive returns only the user's decisions» y «declares
  the unique and TTL indexes» (lee `listIndexes`, `expireAfterSeconds` = 3 024 000).
- [ ] 4.2 [backend] `ApplicationLinks.planSignalsOf` en `ports/application-links.port.ts`, con comentario del puerto que
  diga qué devuelve, que es una sola llamada a la fachada, que el conteo es el del grupo elegido y que nunca trae
  identidades (C10); el adaptador `links-facade-application-links.ts` y el doble de `applications-test-doubles.ts`.
  Verificar: `pnpm nx run api:typecheck` y el spec del adaptador `links-facade-application-links.spec.ts`: «delegates
  planSignalsOf to the facade with the same arguments» y «returns the facade map untouched».
- [ ] 4.3a [backend] `application/gather-weekly-plan-candidates.ts`: `listByUser`, filtro de estados (sin cerrados ni
  `accepted`), orden por `statusChangedAt` asc con desempate `id` y tope 200 (C6), `planSignalsOf`, `scoresFor` solo para
  `saved`/`interested` con `degraded`, y traducción a la entrada canónica. Verificar en
  `gather-weekly-plan-candidates.spec.ts`: «keeps the 200 quietest applications», «skips closed and accepted
  applications», «skips links that no longer exist» y «does not call the fit source with no saved or interested
  applications».
- [ ] 4.3b [backend] Token `WEEKLY_PLANNER` en `application/ports/weekly-planner.port.ts` y `GetWeeklyPlan`
  (`get-weekly-plan.usecase.ts`): recolecta (4.3a), lee `listActive`, llama al planificador, traduce de vuelta a ids
  reales y calcula `doneThisWeek`. Verificar en `get-weekly-plan.usecase.spec.ts` (repos en memoria, reloj fijo):
  «returns three actions for five candidates», «returns an empty plan when nothing applies», «reading twice writes
  nothing» y «uses the UTC ISO week of the clock».
- [ ] 4.4 [backend] `DecideWeeklyPlanAction` (`decide-weekly-plan-action.usecase.ts`): recalcula elegibles, error de
  dominio `WeeklyPlanActionNotFound` (`code = 'weekly_plan_action_not_found'`) uniforme, upsert y plan recalculado.
  Verificar en su spec: «done hides the action and the next candidate enters», «decision does not touch the
  application» (misma `version`, mismo `statusChangedAt`, sin eventos), «unknown, foreign or malformed candidate is not
  found and writes nothing» y «repeating a decision keeps one document». Falsación: si el caso de uso escribiera antes
  de validar, el test de no encontrada encuentra un documento y falla.
- [ ] 4.5a [backend] Registro del código (C3): `weekly_plan_action_not_found` en `apiErrorCodeSchema`
  (`libs/shared/src/schemas/auth.schema.ts:112`), su estado 404 y mensaje en
  `apps/api/src/presentation/http/api-error.ts` (junto a `application_not_found`, `:37` y `:96`), la unión de códigos y
  la clase en `applications/domain/errors.ts`, y el filtro `api-exception.filter.ts`. Verificar: casos nuevos
  «accepts weekly_plan_action_not_found» en el spec de `auth.schema`, «maps weekly_plan_action_not_found to 404» en
  `api-error.spec.ts`, «translates WeeklyPlanActionNotFound to a 404 body with its code» en
  `api-exception.filter.spec.ts` y el test de paridad de `applications/domain/errors.spec.ts` en verde. Falsación: sin
  la entrada en `apiErrorCodeSchema`, el test de paridad falla.
- [ ] 4.5b [backend] Rutas `@Get('weekly-plan')` y `@Post('weekly-plan/decisions')` en `applications.controller.ts`
  (validación zod del cuerpo como el resto del controlador) y providers en `applications.module.ts`
  (`{ provide: WEEKLY_PLANNER, useClass: RuleBasedPlanner }`, repositorio, casos de uso). Verificar en
  `applications.controller.spec.ts`: «GET weekly-plan returns the plan of the token user», «POST decisions rejects an
  invalid body with 400», «POST decisions responds 404 weekly_plan_action_not_found», y en `applications.module.spec.ts`
  «resolves WEEKLY_PLANNER to RuleBasedPlanner».
- [ ] 4.6a [backend] Integración HTTP de privacidad en `applications/weekly-plan.privacy.int.spec.ts`
  (`mongodb-memory-server` replset): Ana, Bob, Carla y Dan en G1/G2. Verificar: «response carries the chosen group
  count but no ids or names of other members» (el cuerpo serializado no contiene ids ni `displayName` de Bob, Carla ni
  Dan; `count` 2 y `groupId` G2).
- [ ] 4.6b [backend] Integración HTTP de semanas en `applications/weekly-plan.weeks.int.spec.ts`: reloj movido de
  2026-W48 a W49, W50 y W52. Verificar: «snoozed returns next week», «done skips one week» y «dismissed stays hidden
  while the decision lives».

## 5. Borrado de cuenta (spec `users/account-deletion`)

- [ ] 5.1 [backend] `users/infrastructure/mongo-account-deletion.cascade.ts`: `deleteMany({ userId: userOid }, { session })`
  en `weekly_plan_decisions` (el `ObjectId` de `:105`, porque la colección guarda `userId` como `ObjectId`; C12), junto a
  `applications` (`:154-170`). Verificar en `users/presentation/account-deletion.cascade.spec.ts`: «deletes weekly plan
  decisions of the user only» y «a failing cascade keeps weekly plan decisions». Falsación: con `{ userId }` como
  string, el primero falla porque no borra nada.

## 6. Seed demo (design D11, spec `platform/demo-seed`)

- [ ] 6.1 [backend] `apps/api/src/seed/demo-seed.dataset.ts`: `DEMO_LINKS.closingSoon` (`appStatus: 'saved'`,
  `expiresInDays: 3`); `seed-demo.runner.ts`: `ensurePreview` escribe `expiresAt` = hoy UTC + 3 cuando el seed lo trae, y
  cada corrida fija `statusChangedAt = now` de `openSalary` (C5). Verificar en `seed-demo.runner.spec.ts`: «seeds a saved
  link closing in three days», «resets openSalary statusChangedAt on every run» y «second run moves expiresAt without
  duplicating links or applications».
- [ ] 6.2 [backend] `apps/api/src/seed/seed-demo.weekly-plan.int.spec.ts` (replset en memoria): corre el seed y
  `GetWeeklyPlan` para Ana. Verificar: «demo Ana gets one action of each rule» (`apply_before_close`, `follow_up`,
  `ask_know_someone`, en ese orden) y «a second run 12 days later still yields one action of each rule» (reloj en
  `now` + 12 días).

## 7. SPA (design D9, D10, spec `web/weekly-plan`)

- [ ] 7.1 [frontend] `core/applications/weekly-plan.api.ts` (`get`, `decide`, tipos de `@linkvault/shared`) y
  `weekly-plan.store.ts` (`@ngrx/signals`: `loading | ready | error`, `plan`, `decidingId`, `saveFailed`,
  `justAppliedId`). Verificar en sus specs: «loads the plan», «exposes error and retries», «decide replaces the plan
  with the response», «decide disables only the deciding action», «a 404 on decide reloads the plan without error»
  y «another error on decide sets saveFailed and re-enables the action» (C4).
- [ ] 7.2a [frontend] `features/applications/weekly-plan-reason.ts`: `weeklyPlanReasonText(reason)` con un mensaje
  `$localize` por variante, singular y plural elegidos en código (C9), con los textos de D10. Verificar en
  `weekly-plan-reason.spec.ts`: «closing today reads Cierra hoy», «closing in one day is singular», «closing in four
  days is plural», «high fit names the score», «quiet names the days» y «know someone is singular for one and plural
  for two».
- [ ] 7.2b [frontend] `features/applications/weekly-plan-card.component.{ts,html}`: estados cargando (`aria-busy`), vacío
  con las dos líneas fijas de B1 y `doneThisWeek`, error con «Reintentar» y «No pudimos guardar tu elección. Probá de
  nuevo.». Verificar en `weekly-plan-card.component.spec.ts`: «renders three actions with their reasons», «renders the
  honest empty state with the explanation line», «renders done this week when greater than zero», «renders the error
  with retry», «renders the save failure message» y «uses the URL when there is no title».
- [ ] 7.3 [frontend] Título como enlace «Abrir» (emite `applicationId` o navega a `/grupos/:groupId`), botones «Hecho»,
  «Ahora no», «Ocultar sugerencia» con `min-h-11` (B4) y la línea «¿Ya postulaste? Muévela a Postulada» tras «Hecho» en
  `apply_before_close` (B5). Verificar en el spec de la tarjeta: «done sends the done decision with its candidateId»,
  «not now sends snoozed and hide sends dismissed», «title opens the application», «title navigates to the group for
  ask_know_someone» y «done on apply_before_close offers to move it to applied without a status request».
- [ ] 7.4 [frontend] `features/applications/follow-up-draft.ts` (función pura con `$localize`, texto exacto de D9) y su
  panel con «Copiar» (CDK `Clipboard`) en acciones `follow_up`. Verificar en `follow-up-draft.spec.ts` y el spec de la
  tarjeta: «draft with appliedAt names title, company and date», «draft without appliedAt says a while ago», «draft
  falls back to generic words without title or company», «draft ends with the open question about the process»,
  «draft never says attached CV or as we discussed» y «copy puts the draft in the clipboard without HTTP calls»
  (`HttpTestingController.verify()` sin peticiones).
- [ ] 7.5 [frontend] `applications-board.page.html`/`.ts`: la tarjeta encima de las columnas, fuera del
  `@if (isEmpty())`, conectada a `openDetail`; recarga del store del plan tras un `moveTo` exitoso (C4). Verificar en
  `applications-board.page.spec.ts`: «shows the weekly plan above the columns», «hides the weekly plan when the board is
  empty», «a weekly plan error still lets the user move an application» (mueve una tarjeta con el plan en error y
  comprueba la petición de estado) y «a successful move reloads the weekly plan».
- [ ] 7.6 [frontend] i18n: `pnpm nx run web:extract-i18n` y traducciones `@@applications.weeklyPlan.*` en
  `messages.en.xlf` con los textos EN de D9 y D10 (ADR-050). Verificar: `pnpm nx run web:i18n-check` en verde.
  Falsación: borrar una traducción inglesa nueva hace fallar el check; se restaura.

## 8. E2E (Q1: datos propios en el perfil `local`)

- [ ] 8.1a [frontend] `apps/web-e2e/src/weekly-plan.spec.ts`, solo perfil `local`, preparación y flujo de escritorio:
  alta por la API, un link seguido como `saved` con `expiresAt` hoy + 3 y otro `applied` con `statusChangedAt` hace 12
  días (escritos en Mongo como `links.spec.ts:182`). Verificar en `chromium`: «weekly plan card shows two actions and
  marks one done» (la acción marcada desaparece y aparece «¿Ya postulaste? Muévela a Postulada»).
- [ ] 8.1b [frontend] Mismo fichero, caso de móvil y borrador. Verificar en `mobile`: «weekly plan card sits above the
  columns on mobile and copies a follow-up draft» (tarjeta por encima de la primera columna y botones ≥ 44 px por
  `boundingBox`; el portapapeles contiene «¿Me podrían contar en qué estado está el proceso de selección?»).

## 9. Cierre

- [ ] 9.1 [infra] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde (salida a fichero, sin pipes), sin `any`
  ni `console.log` nuevos. Verificar: el fichero de salida termina sin proyectos en rojo.
- [ ] 9.2 [infra] Smoke manual con el seed: `pnpm infra:up`, `api:seed-demo`, `nx serve api` y `web`; Ana ve tres
  acciones en `/postulaciones` en escritorio y en 390 px; marca una «Hecho» y la tarjeta muestra otra o el vacío.
  Verificar: capturas en la PR y puertos liberados al terminar.
- [ ] 9.3 [infra] PR desde `change/weekly-plan` **sin fusionar**, con la etiqueta de candidata y la nota «no se fusiona
  hasta que el owner abra una ventana». Verificar: la PR existe en estado abierto y su descripción enlaza ADR-068.
- [ ] 9.4 [infra] `docs/RUNBOOK.md`: sección «Plan semanal (`weekly_plan_decisions`)» con qué guarda la colección (sin
  texto), su TTL de 35 días, que los índices los crea `autoIndex` al arrancar la api, cómo comprobarlos
  (`db.weekly_plan_decisions.getIndexes()`), el rollback (revertir el PR; `drop()` opcional) y la consulta agregada de
  la métrica de B3 (semanas-persona con `done`, `done` vs `dismissed` por regla, sin `userId` en la salida), a correr
  antes de que venza el TTL (C12). Verificar: `grep -c "weekly_plan_decisions" docs/RUNBOOK.md` ≥ 3 y `bash
  infra/ci/repo-checks.sh` en verde.
