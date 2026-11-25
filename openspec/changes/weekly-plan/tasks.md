## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los títulos de test van en inglés y salen de los escenarios de `specs/`. Rutas de
`apps/api` relativas a `apps/api/src/modules/` salvo que se diga otra cosa.

- [ ] 0.1 [infra] Debate critic/business/reflect de este change cerrado sin P0/V0 abiertos. Verificar: `design.md` lleva
  una sección `## Debate — iteración N` con «Convergencia: SI», P0 0 y V0 0, y las decisiones no triviales nuevas están
  en ADR-068.
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
  days», «rejects extra fields in an action» y «decision request accepts done, dismissed and snoozed only».

## 2. Dominio del plan en `applications` (design D1-D4, D6, D12)

- [ ] 2.1 [backend] `applications/domain/weekly-plan/week-key.ts`: `isoWeekKey(date)` y `previousWeekKey(weekKey)` en UTC,
  copiados de `apps/worker/src/modules/notifications/domain/iso-week.ts:21` con un comentario que lo diga. Verificar con
  `week-key.spec.ts`: «2026-12-31T23:30Z is 2026-W53», «2027-01-03 is 2026-W53», «2027-01-04 is 2027-W01»,
  «previous of 2027-W01 is 2026-W53» y «Monday 00:00Z starts a new week».
- [ ] 2.2 [backend] `applications/domain/weekly-plan/weekly-plan.ts` (tipos canónicos de entrada y salida, sin
  `ObjectId` ni `Date`: días relativos y `today` `YYYY-MM-DD`) y `weekly-planner.ts` (interfaz `WeeklyPlanner` con
  `plan(input): Promise<WeeklyPlanOutcome>`). Funciones puras de elegibilidad por regla en `rules.ts`. Verificar con
  `rules.spec.ts`: «saved link closing in 3 days is apply_before_close closing_soon», «expiresAt yesterday without
  closedAt is not closing_soon», «interested with fit 80 and no expiresAt is high_fit», «applied quiet 12 days is
  follow_up», «saved quiet 30 days without signals yields nothing», «closed link yields nothing», «own flag alone does
  not count for ask_know_someone» y «one candidate per application, first rule wins».
- [ ] 2.3 [backend] `applications/domain/weekly-plan/rule-based-planner.ts`: orden dentro de cada regla, desempate por
  `applicationId`, ocultación por decisiones (semana en curso; `done`/`dismissed` de la anterior), turnos por regla y
  tope 3. Verificar con `rule-based-planner.spec.ts`: «caps at three actions», «round-robins one per rule before
  repeating», «hides any decision of the current week», «hides done and dismissed of the previous week», «does not hide
  snoozed of the previous week», «fills the slot of a hidden action with the next candidate» y «same input yields the
  same output». Falsación del tope: con `WEEKLY_PLAN_MAX_ACTIONS` cambiado a 4 en el test, «caps at three actions»
  falla.
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
- [ ] 3.3 [backend] `LinksFacade.planSignalsOf(userId, linkIds)`: `groupsOf` + las dos lecturas en paralelo, conteo sin
  repetir y sin contar a `userId`, grupo con más marcas, tope 200. Verificar en `links.facade.spec.ts`: «planSignalsOf
  counts distinct others across groups», «planSignalsOf ignores groups the user is not in», «planSignalsOf reports
  freshness and skips malformed ids», «planSignalsOf never returns flagger ids» (la serialización JSON del resultado no
  contiene el id de Bob) y «planSignalsOf makes the same number of queries for 3 and 150 links». Falsación del último:
  un bucle de una consulta por link hace fallar el conteo de consultas.

## 4. Casos de uso, persistencia y rutas en `applications` (design D5, D8)

- [ ] 4.1 [backend] Puerto `WEEKLY_PLAN_DECISION_REPOSITORY` (`upsert`, `listForWeeks(userId, weekKeys)`),
  `InMemoryWeeklyPlanDecisionRepository` en `application/testing/` y `MongoWeeklyPlanDecisionRepository` con
  `weekly-plan-decision.schemas.ts` (colección `weekly_plan_decisions`, índice único `(userId, weekKey, candidateId)`,
  TTL 35 días en `decidedAt`). Verificar en `mongo-weekly-plan-decision.repository.spec.ts`: «upsert keeps a single
  document per key with the last decision», «lists decisions of the requested weeks only» y «declares the unique and TTL
  indexes» (lee `listIndexes`, `expireAfterSeconds` = 3 024 000).
- [ ] 4.2 [backend] `ApplicationLinks.planSignalsOf` en `ports/application-links.port.ts`, el adaptador
  `links-facade-application-links.ts` y el doble de `applications-test-doubles.ts`. Verificar: `pnpm nx run
  api:typecheck` y un caso en el spec del adaptador «delegates planSignalsOf to the facade».
- [ ] 4.3 [backend] Token `WEEKLY_PLANNER` en `application/ports/weekly-planner.port.ts` y `GetWeeklyPlan`
  (`get-weekly-plan.usecase.ts`): `listByUser`, filtro de estados, tope 200, `planSignalsOf`, `scoresFor`, decisiones de
  W y W−1, traducción a la entrada canónica y vuelta, `doneThisWeek`. Verificar en `get-weekly-plan.usecase.spec.ts`
  (repos en memoria y reloj fijo): «returns three actions for five candidates», «returns an empty plan when nothing
  applies», «reading twice writes nothing», «uses the UTC ISO week of the clock» y «does not call the fit source with
  no saved or interested applications».
- [ ] 4.4 [backend] `DecideWeeklyPlanAction` (`decide-weekly-plan-action.usecase.ts`): recalcula elegibles, `404
  weekly_plan_action_not_found` uniforme, upsert y plan recalculado. Verificar en su spec: «done hides the action and the
  next candidate enters», «decision does not touch the application» (misma `version`, mismo `statusChangedAt`, sin
  eventos), «unknown, foreign or malformed candidate is 404 and writes nothing» y «repeating a decision keeps one
  document». Falsación: si el caso de uso escribiera antes de validar, el test del 404 encuentra un documento y falla.
- [ ] 4.5 [backend] Rutas `@Get('weekly-plan')` y `@Post('weekly-plan/decisions')` en `applications.controller.ts`
  (validación zod del cuerpo como el resto del controlador) y providers en `applications.module.ts`
  (`{ provide: WEEKLY_PLANNER, useClass: RuleBasedPlanner }`, repositorio, casos de uso). Verificar en
  `applications.controller.spec.ts`: «GET weekly-plan returns the plan of the token user», «POST decisions rejects an
  invalid body with 400», «POST decisions maps not found to 404 weekly_plan_action_not_found», y en
  `applications.module.spec.ts` «resolves WEEKLY_PLANNER to RuleBasedPlanner».
- [ ] 4.6 [backend] Integración HTTP en `applications/weekly-plan.int.spec.ts` (`mongodb-memory-server` replset):
  Ana, Bob y Carla; los escenarios de privacidad y de semanas de `specs/applications/weekly-plan`. Verificar: «response
  carries counts but no ids or names of other members» (el cuerpo serializado no contiene ids ni `displayName` de Bob
  ni de Carla), «snoozed returns next week», «dismissed skips one week» (reloj movido de 2026-W48 a W49 y W50).

## 5. Borrado de cuenta (spec `users/account-deletion`)

- [ ] 5.1 [backend] `users/infrastructure/mongo-account-deletion.cascade.ts`: `deleteMany({ userId })` en
  `weekly_plan_decisions` dentro de la misma sesión, junto a `applications` (`:154-170`). Verificar en
  `users/presentation/account-deletion.cascade.spec.ts`: «deletes weekly plan decisions of the user only» y «a failing
  cascade keeps weekly plan decisions». Falsación: sin la línea nueva, el primero falla.

## 6. Seed demo (design D11, spec `platform/demo-seed`)

- [ ] 6.1 [backend] `apps/api/src/seed/demo-seed.dataset.ts`: `DEMO_LINKS.closingSoon` (`appStatus: 'saved'`,
  `expiresInDays: 3`); `seed-demo.runner.ts`: `ensurePreview` escribe `expiresAt` = hoy UTC + 3 cuando el seed lo trae.
  Verificar en `seed-demo.runner.spec.ts`: «seeds a saved link closing in three days» y «second run moves expiresAt
  without duplicating links or applications».
- [ ] 6.2 [backend] `apps/api/src/seed/seed-demo.weekly-plan.int.spec.ts` (replset en memoria): corre el seed y
  `GetWeeklyPlan` para Ana. Verificar: «demo Ana gets one action of each rule» (reglas `apply_before_close`,
  `follow_up`, `ask_know_someone`, en ese orden).

## 7. SPA (design D9, D10, spec `web/weekly-plan`)

- [ ] 7.1 [frontend] `core/applications/weekly-plan.api.ts` (`get`, `decide`, tipos de `@linkvault/shared`) y
  `weekly-plan.store.ts` (`@ngrx/signals`: `loading | ready | error`, `plan`, `decidingId`). Verificar en sus specs:
  «loads the plan», «exposes error and retries», «decide replaces the plan with the response» y «decide disables only
  the deciding action».
- [ ] 7.2 [frontend] `features/applications/weekly-plan-card.component.{ts,html}`: estados cargando (`aria-busy`), vacío
  (con `doneThisWeek`) y error con «Reintentar»; motivo de una línea por `reason.kind` con ICU `plural`. Verificar en
  `weekly-plan-card.component.spec.ts`: «renders three actions with their reasons», «renders the honest empty state»,
  «renders done this week when greater than zero», «renders the error with retry» y «uses the URL when there is no
  title».
- [ ] 7.3 [frontend] Botones «Abrir», «Hecho», «Descartar», «La semana que viene» con `min-h-11`; «Abrir» emite el
  `applicationId` o navega a `/grupos/:groupId` en `ask_know_someone`. Verificar en el mismo spec: «done sends the done
  decision with its candidateId», «dismiss and snooze send their decisions», «open emits the application» y «open
  navigates to the group for ask_know_someone».
- [ ] 7.4 [frontend] `features/applications/follow-up-draft.ts` (función pura con `$localize`) y su panel con «Copiar»
  (CDK `Clipboard`) en acciones `follow_up`. Verificar en `follow-up-draft.spec.ts` y el spec de la tarjeta: «draft names
  title and company», «draft falls back to generic words without title or company», «copy puts the draft in the
  clipboard without HTTP calls» (`HttpTestingController.verify()` sin peticiones) y «draft has no mailto or recipient».
- [ ] 7.5 [frontend] `applications-board.page.html`/`.ts`: la tarjeta encima de las columnas, fuera del
  `@if (isEmpty())`, conectada a `openDetail`. Verificar en `applications-board.page.spec.ts`: «shows the weekly plan
  above the columns», «hides the weekly plan when the board is empty» y «a weekly plan error does not hide the board».
- [ ] 7.6 [frontend] i18n: `pnpm nx run web:extract-i18n` y traducciones `@@applications.weeklyPlan.*` en
  `messages.en.xlf` (ADR-050). Verificar: `pnpm nx run web:i18n-check` en verde. Falsación: borrar una traducción
  inglesa nueva hace fallar el check; se restaura.

## 8. E2E (Q1, opción recomendada)

- [ ] 8.1 [frontend] `apps/web-e2e/src/weekly-plan.spec.ts`, solo perfil `local`: alta por la API, un link guardado
  seguido como `saved` con `expiresAt` hoy + 3 y otro `applied` con `statusChangedAt` hace 12 días (escritos en Mongo como
  `links.spec.ts:182`). Verificar en `chromium` y `mobile`: «weekly plan card shows actions, marks one done and copies a
  follow-up draft» (la acción marcada desaparece; en `mobile` la tarjeta queda encima de las columnas y los botones
  miden ≥ 44 px por `boundingBox`). Comando de la suite de `e2e-suite` con `--skip-remote` o equivalente.

## 9. Cierre

- [ ] 9.1 [infra] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde (salida a fichero, sin pipes), sin `any`
  ni `console.log` nuevos. Verificar: el fichero de salida termina sin proyectos en rojo.
- [ ] 9.2 [infra] Smoke manual con el seed: `pnpm infra:up`, `api:seed-demo`, `nx serve api` y `web`; Ana ve tres
  acciones en `/postulaciones` en escritorio y en 390 px; marca una «Hecho» y la tarjeta muestra otra o el vacío.
  Verificar: capturas en la PR y puertos liberados al terminar.
- [ ] 9.3 [infra] PR desde `change/weekly-plan` **sin fusionar**, con la etiqueta de candidata y la nota «no se fusiona
  hasta que el owner abra una ventana». Verificar: la PR existe en estado abierto y su descripción enlaza ADR-068.
