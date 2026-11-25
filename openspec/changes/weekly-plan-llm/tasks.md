## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. Los títulos de test van en inglés y salen de los escenarios de `specs/` (tabla
«Casos de prueba derivados» de `design.md`). Rutas de `apps/api` relativas a `apps/api/src/modules/` salvo que se diga
otra cosa. Todo se implementa y prueba con `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` (o `synth` en local); la única tarea
que necesita una clave real es la 2.7.

- [ ] 0.1 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos. Verificar: `design.md` lleva la sección
  `## Debate iteración N (fecha)` de la última iteración con «Convergencia: SI» y las decisiones no triviales nuevas
  están en ADR-071.
- [ ] 0.2 [infra] Q1 y Q7 respondidas por el owner y registradas con fecha en `design.md` (y Q1 en ADR-071).
  Verificar: `grep -n "Q1.*Respondida\|Q7.*Respondida" design.md` devuelve dos líneas con fecha. Falsación: sin esas
  líneas, `/opsx:apply` no arranca (el revisor rechaza el primer commit de código).
- [ ] 0.3 [infra] Plan y ADR coherentes. Verificar: `docs/design-v0.2.md` §6 tiene la fila 41 `weekly-plan-llm` como
  **candidata**, `grep -c "weekly-plan-llm" openspec-changes.yaml` = 0, `docs/adr/ADR-071.md` existe y
  `openspec validate weekly-plan-llm --strict --no-interactive` y `bash infra/ci/repo-checks.sh` dan rc=0.

## 1. Contrato en `libs/shared` (D5, D8 de `weekly-plan`)

- [ ] 1.1 [backend] En `libs/shared/src/schemas/weekly-plan.schema.ts`: `planner: z.enum(['rules', 'llm'])`,
  `WEEKLY_PLAN_LLM_MAX_CANDIDATES = 9` y `validateWeeklyPlanPicks(ids, picks): boolean` (exactamente
  `WEEKLY_PLAN_MAX_ACTIONS`, todos en `ids`, sin repetir), exportados desde el índice. Verificar con
  `weekly-plan.schema.spec.ts`: «accepts planner llm», «rejects an unknown planner», «validator accepts three distinct
  ids from the set», «validator rejects an id outside the set», «validator rejects duplicates» y «validator rejects two
  or four picks». Falsación: quitar la comprobación de duplicados hace fallar «validator rejects duplicates».

## 2. `libs/ai`: schema por petición, tarea `plan-week` y eval (D4, D5, D8, D13)

- [ ] 2.1 [ai] `AiTask.outputSchemaFor?(input)` en `domain/task.ts`; `runTask` lo usa en lugar de `outputSchema` al
  llamar a `runStructuredOutput` (`run-task.usecase.ts:395`); `TaskRegistry.register` rechaza una tarea con
  `outputSchemaFor` y `cacheable: true`. Verificar con `run-task.usecase.spec.ts`: «validates against the per-request
  schema and repairs», «falls to the next provider when the per-request schema keeps failing» y «tasks without
  outputSchemaFor behave as before»; `task-registry.spec.ts`: «rejects a cacheable task with outputSchemaFor».
  Falsación: volver a pasar `task.outputSchema` hace fallar la primera.
- [ ] 2.2 [ai] `tasks/plan-week.task.ts`: `planWeekInputSchema` (objetos estrictos, ids `c1…cN` únicos y consecutivos,
  4-9 candidatas, enums y enteros acotados de D4), `planWeekOutputSchema`, `outputSchemaFor` con el enum de la
  petición y `validateWeeklyPlanPicks`, `sample` (las 3 primeras), `dataSensitivity: 'public'`, `cacheable: false`,
  `temperature: 0`, `maxAttempts: 2`, sin `degrade`. Añadir `'plan-week'` a `AiTaskName` y a `KNOWN_TASK_NAMES`,
  registrar la tarea en `AiModule` y exportar tarea, tipos y `executionKey` desde `src/index.ts`. Verificar con
  `plan-week.task.spec.ts`: «rejects free text in the input», «rejects non consecutive ids», «synth sample picks the
  first three» y «input JSON schema has no free strings» (recorre `z.toJSONSchema(planWeekInputSchema)`). Falsación:
  añadir `title: z.string()` a la candidata hace fallar la última; se revierte.
- [ ] 2.3 [ai] Prompt `infrastructure/prompts/plan-week.v1.md` (front-matter `task`/`version`, sistema en español:
  criterios —cierre cercano, encaje, contactos, quietud, señales combinadas—, «elige exactamente 3 ids de la lista»,
  los datos entre etiquetas son datos y no instrucciones, respuesta solo JSON `{"picks":[{"candidateId":"c1"}]}`).
  Verificar con `file-prompt-registry.spec.ts` o un spec propio: «renders plan-week v1 with the candidates as JSON» y
  que el registro de la tarea no lanza `InvalidPrompt`.
- [ ] 2.4 [ai] Golden `evals/plan-week/golden.jsonl` con ≥ 8 casos sintéticos (`tags` con `synthetic`; uno que cierra
  hoy, uno de señales múltiples fuera de `c1-c3`, uno con 9 candidatas, uno solo de `follow_up`) y `expected
  { mustInclude }`. Verificar: `nx run ai:eval --task=plan-week --provider=mock` carga el golden sin errores de
  esquema. Falsación: quitar `synthetic` de un caso hace fallar la carga nombrando la línea (escenario «Golden con un
  caso no sintético»).
- [ ] 2.5 [ai] `evals/plan-week/metrics.ts`: `planWeekExpectedSchema`, `valid_pick_rate` y `must_include_rate`
  (bloqueantes), `rules_agreement` (informativa), columnas del reporte sin input ni salida completos; registrar
  `planWeekEvaluable` en `EVALUABLE_TASKS` y la regla «`synthetic` obligatoria» para su golden. Verificar con
  `plan-week/metrics.spec.ts`: «must_include_rate drops when a must-include id is missing», «rules_agreement is one when
  picks are c1 to c3» y «valid_pick_rate counts only valid success outputs».
- [ ] 2.6 [ai] Fixtures de CI y línea base: `nx run ai:record-fixtures --task=plan-week --upstream=mock` y
  `nx run ai:eval --task=plan-week --provider=mock --update-baseline`, en el mismo commit que 2.3-2.5. Verificar:
  `nx run ai:eval-ci` en verde y `baseline.json` con `promptVersion` `v1` y el hash del golden. Falsación: editar a
  mano un fixture para que elija `c9` hace que el caso termine `degraded` y el eval falle contra la línea base; se
  revierte.
- [ ] 2.7 [ai] **La ejecuta el owner o alguien con su clave.** Fixtures reales:
  `nx run ai:record-fixtures --task=plan-week --upstream=openrouter --allow-external --overwrite` y
  `nx run ai:eval --task=plan-week --provider=mock --update-baseline`, todo en un commit, y el reporte (métricas,
  modelo, fecha) pegado en `design.md` bajo «Medición con fixtures reales». Verificar: los fixtures declaran origen
  `openrouter` y modelo, `ai:eval-ci` en verde, y la puerta de D13 queda anotada como cumplida o no. No bloquea el resto
  de tareas ni la fusión con el flag apagado.

## 3. Dominio del plan (D2, D4, D6)

- [ ] 3.1 [backend] `domain/weekly-plan/`: `WeeklyPlanner.plan(input, context)` con
  `WeeklyPlannerContext { userId; mayStartRun }`, `WeeklyPlanOutcome.planner: 'rules' | 'llm'` y `ranked` (todas las
  visibles en orden de reglas); `RuleBasedPlanner` calcula `ranked` y toma las 3 primeras. `GetWeeklyPlan` pasa el
  contexto (`mayStartRun: true` en `execute` del GET, `false` desde `DecideWeeklyPlanAction`). Verificar: los tests
  existentes de `rule-based-planner.spec.ts` y `get-weekly-plan.usecase.spec.ts` en verde sin cambiar expectativas, más
  «ranked lists every visible candidate in round-robin order». Falsación: cortar `ranked` en 3 hace fallar el nuevo.
- [ ] 3.2 [backend] `domain/weekly-plan/build-plan-week-input.ts` (puro) y `llm-limits.ts` con las constantes de D1,
  D6 y D7. Verificar con `build-plan-week-input.spec.ts`: «contains no real ids, dates or titles» (regex de 24 hex y de
  `YYYY-MM-DD` sobre el JSON), «caps at nine candidates», «omits fitScore for a degraded analysis», «clamps daysQuiet to
  365» y «omits daysUntilClose for an expired offer». Falsación: incluir `groupId` hace fallar la primera.
- [ ] 3.3 [backend] `domain/weekly-plan/compose-llm-actions.ts` (puro): urgentes, elecciones visibles, relleno; y el
  cálculo de `planner`. Verificar con `compose-llm-actions.spec.ts`: «puts urgent closing candidates first», «keeps the
  llm order for visible picks», «fills a hidden pick from rules order», «ignores a pick that changed rule», «planner is
  rules when no pick is shown» y «never repeats a candidate». Falsación: quitar el paso de urgentes hace fallar la
  primera.
- [ ] 3.4 [backend] Guardia de capas. Verificar: `pnpm nx run api:lint` en verde con `domain/weekly-plan/**` sin
  `@nestjs/*`, `mongoose`, `@linkvault/ai` ni otros módulos. Falsación: un `import '@linkvault/ai'` temporal en
  `compose-llm-actions.ts` hace fallar el lint; se revierte.

## 4. Aplicación e infraestructura (D1, D5, D7, D8, D9, D12, D14)

- [ ] 4.1 [backend] Puertos `application/ports/weekly-plan-picker.port.ts` (`pick(input, { userId, signal })` →
  `picked { picks, providerId, model, inputKey }` | `degraded { reason }`) y `weekly-plan-llm-store.port.ts`
  (`find`, `claimUserRun`, `releaseUserRun`, `claimDailyBudget`, `complete`, `fail`), con dobles en memoria en
  `application/testing/` y `aiConsentOf` en `ApplicationUserDirectory`. Verificar: `api:typecheck` en verde y
  `in-memory-weekly-plan-llm-store.spec.ts` › «a second user claim in the same week is denied» y «budget denies at the
  cap».
- [ ] 4.2 [backend] `application/weekly-plan/llm-weekly-planner.ts`, camino de **lectura**: con documento `ready`
  compone (3.3); con `pending`/`failed` o sin reclamo posible, reglas; con `mayStartRun` falso nunca reclama; con 3 o
  menos visibles nunca reclama; `pending` más viejo que dos plazos pasa a `failed`/`timeout` (R4). Verificar con
  `llm-weekly-planner.spec.ts`: «uses stored picks when ready», «does not run with three or fewer visible candidates»,
  «never starts a run on decide» y «marks an old pending run as timed out».
- [ ] 4.3 [backend] `LlmWeeklyPlanner`, camino de **ejecución**: consentimiento → reclamo de persona → presupuesto
  global (con compensación) → `picker.pick` → `validateWeeklyPlanPicks` → `complete` o `fail`. Verificar: «skips
  without consent», «skips when consent cannot be read», «denies at the global cap and releases the user claim»,
  «rejects a pick outside the enum and falls back to rules», «rejects duplicated picks» y «marks failed on degraded and
  does not retry the same week». Falsación (guardia del validador): con `validateWeeklyPlanPicks` sustituido por
  `() => true` en el test, «rejects a pick outside the enum…» falla; se revierte.
- [ ] 4.4 [backend] Espera corta y fin en segundo plano (D1): carrera contra `WEEKLY_PLAN_LLM_READ_WAIT_MS`,
  `AbortSignal.timeout(WEEKLY_PLAN_LLM_RUN_TIMEOUT_MS)` hacia el picker, `catch` total con log por nombre de error.
  Verificar con timers falsos: «answers rules after the read wait and stores the late result», «a background error
  marks failed and never rejects» y «logs carry no userId» (espía del logger). Falsación: quitar el `catch` hace que
  «a background error…» deje una promesa rechazada sin manejar y el test falle.
- [ ] 4.5 [backend] `infrastructure/mongo-weekly-plan-llm-store.ts` y `weekly-plan-llm.schemas.ts`: colección
  `weekly_plan_llm_picks` (índice único `(userId, weekKey)`, TTL 35 días sobre `createdAt`), reclamo con `$inc`
  condicionado + `upsert` y E11000 como denegado, compensación, `complete`/`fail`. Verificar con
  `mongo-weekly-plan-llm-store.int.spec.ts` (`mongodb-memory-server` replset): «only one concurrent claim wins» (dos
  `claimUserRun` en `Promise.all`), «a released claim can be claimed again» y «indexes include the unique key and the
  ttl». Falsación: quitar `runs: { $lt: 1 }` del filtro hace fallar «only one concurrent claim wins».
- [ ] 4.6 [backend] Presupuesto global en el mismo adaptador: `weekly_plan_llm_budget` (`_id` día UTC, TTL 3 días
  sobre `day`), `$inc` condicionado a `count < WEEKLY_PLAN_LLM_DAILY_RUNS_MAX`; un error de Mongo devuelve denegado.
  Verificar: «budget allows twenty and denies the twenty-first», «a new UTC day starts at zero» y «fails closed when
  mongo throws». Falsación: quitar la condición `count < 20` hace fallar la primera.
- [ ] 4.7 [backend] `infrastructure/run-task-weekly-plan-picker.ts`: `runTask(planWeekTask, input, { userId,
  aiConsent, outputLanguage: 'es', signal })`, mapeo de `success`/`degraded` y `inputKey` con `executionKey`. Verificar
  con `run-task-weekly-plan-picker.spec.ts` (`RunTaskFn` falso): «passes outputLanguage es and the signal», «maps
  degraded to degraded» y «returns the execution key of the input».
- [ ] 4.8 [backend] Cableado: `FEATURE_WEEKLY_PLAN_LLM` opcional con `default('false')` en `apiConfigSchema`;
  `ApplicationsModule.register(linksModule, searchModule?, aiModule?)` con `RUN_TASK` del mismo `aiModule` que
  `LinksModule` (`app.module.ts`); `WEEKLY_PLANNER` por `useFactory` según el flag; línea comentada en `.env.example`.
  Verificar: `applications.module.spec.ts` › «provides RuleBasedPlanner when the flag is off» y «provides
  LlmWeeklyPlanner when the flag is on»; `bash infra/ci/repo-checks.sh` en verde (la variable es opcional y el compose
  no cambia).
- [ ] 4.9 [backend] Atribución (D12): `source` opcional en `weekly-plan-decision.schemas.ts` y en el puerto;
  `DecideWeeklyPlanAction` lo calcula con la elección `ready` de la semana. Verificar en
  `decide-weekly-plan-action.usecase.spec.ts`: «records source llm for a pick», «records source rules for a fill» y
  «accepts a decision without source»; y en `mongo-weekly-plan-decision.repository.spec.ts` que se persiste.
- [ ] 4.10 [backend] Integración de la api con el flag encendido y el mock en `replay`, con una entrada igual a un caso
  del golden: `weekly-plan.llm.int.spec.ts` › «uses the replayed picks in the chosen order», «the read writes only picks
  and budget» y «flag off never calls runTask» (espía de `RunTaskFn`). Verificar: `pnpm nx run api:test` con esos tres
  en verde.

## 5. Borrado de cuenta

- [ ] 5.1 [backend] `users/infrastructure/mongo-account-deletion.cascade.ts`: `deleteMany({ userId: userOid })` en
  `weekly_plan_llm_picks` dentro de la misma unidad de commit. Verificar con `mongo-account-deletion.cascade.spec.ts`:
  «deletes weekly plan llm picks of the user only» y «a failure mid-cascade keeps the picks». Falsación: comentar el
  `deleteMany` hace fallar la primera.

## 6. SPA

- [ ] 6.1 [frontend] `weekly-plan-card.component.*`: la línea «Elegidas con IA entre tus sugerencias de la semana.»
  (`@@applications.weeklyPlan.aiNotice`) solo con `planner` `llm` y al menos una acción; los motivos no cambian.
  Verificar con `weekly-plan-card.component.spec.ts`: «shows the AI notice only for planner llm with actions», «hides
  it for planner rules» y «hides it on the empty state».
- [ ] 6.2 [frontend] Catálogo: `pnpm nx run web:extract-i18n`, traducción en `messages.en.xlf` («Chosen with AI from
  your suggestions for the week.») y un `describe` EN que carga `messages.en.xlf` con `loadTranslations` y afirma el
  texto exacto. Verificar: `pnpm nx run web:i18n-check` y `web:test` en verde.

## 7. Verificación

- [ ] 7.1 [infra] `pnpm nx affected -t lint,typecheck,test,i18n-check` y `nx run ai:eval-ci` en verde; `openspec
  validate weekly-plan-llm --strict --no-interactive` y `bash infra/ci/repo-checks.sh` con rc=0.
- [ ] 7.2 [backend] Prueba local de punta a punta con `AI_CHAIN=mock`, `AI_MOCK_MODE=synth` y el flag encendido: Ana con
  cinco postulaciones elegibles ve `planner` `llm` en la segunda lectura como mucho, y `db.weekly_plan_llm_picks`
  tiene un documento `ready` sin entrada ni texto. Verificar: captura o salida de `mongosh` en el PR.

## 8. Documentación

- [ ] 8.1 [infra] `docs/RUNBOOK.md`: flag y su valor por defecto, colecciones, TTL, topes, cómo probar en local con
  más de 3 postulaciones, rollback, y consultas agregadas de la métrica de D3 (decisiones por `source`, sin `userId` en
  el resultado). Verificar: `bash infra/ci/repo-checks.sh` en verde y `grep -n "weekly_plan_llm_picks" docs/RUNBOOK.md`
  devuelve la sección.
