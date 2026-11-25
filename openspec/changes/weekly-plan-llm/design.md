## Context

Corte 2 de «Tu semana» (ADR-068 §3 y «Cortes siguientes» §1 del change archivado
`openspec/changes/archive/2026-11-25-weekly-plan/design.md`). El panel multiagente del 2026-11-25 lo dejó diseñado así:
un `LlmWeeklyPlanner` detrás del mismo puerto, vía `runTask`, que **solo elige y ordena `candidateId` de un enum
cerrado** construido con las candidatas del `RuleBasedPlanner`; validador determinista (ids del enum, tope 3, sin
duplicados); reparación, siguiente proveedor y degradación honesta a reglas; entradas canónicas con ids sintéticos y
fechas relativas para que la clave de `replay` sea estable; tope de llamadas **en código**; consentimiento; golden,
baseline y `schema_validity_rate`; cero texto de CV y, de otros miembros, solo el conteo.

Lo que ya existe y este change reutiliza (verificado en `main` `bed83af6`):

- **Puerto y planificador.** `WeeklyPlanner.plan(input): Promise<WeeklyPlanOutcome>`
  (`apps/api/src/modules/applications/domain/weekly-plan/weekly-planner.ts`), `RuleBasedPlanner` puro
  (`rule-based-planner.ts`: reglas, ocultación por decisiones, turnos por regla y tope 3) y el token `WEEKLY_PLANNER`
  provisto con `useClass: RuleBasedPlanner` (`presentation/applications.module.ts:60`). `WeeklyPlanOutcome.planner` es
  el literal `'rules'` y `eligible` trae todas las candidatas antes de ocultar.
- **Entrada canónica.** `GatherWeeklyPlanCandidates` ya traduce a hechos sin `ObjectId` ni `Date` con claves opacas
  `c001…` en orden de `applicationId` (`application/gather-weekly-plan-candidates.ts`). **Pero** `PlanCandidateFacts`
  todavía lleva `appliedAt` (instante ISO), `expiresAt` (fecha absoluta) y `knowSomeone.groupId` (un `ObjectId`), y
  `WeeklyPlanInput` lleva `today` y `weekKey`: sirven a las reglas y al borrador, **no** pueden ir al LLM (D4).
- **Lecturas y decisiones.** `GetWeeklyPlan.evaluate` llama al planificador (`get-weekly-plan.usecase.ts:51`) y
  `DecideWeeklyPlanAction` lo llama **dos veces** por `POST` (`decide-weekly-plan-action.usecase.ts:33` y `:43`).
- **Contrato.** `weeklyPlanResponseSchema.planner` es `z.enum(['rules'])` a propósito para añadir `'llm'`
  (`libs/shared/src/schemas/weekly-plan.schema.ts:73`). El texto del motivo no viaja: lo arma el SPA desde `reason`.
- **`libs/ai`.** `runTask(task, input, ctx)` valida cada respuesta con `task.outputSchema`, estático
  (`libs/ai/src/application/run-task.usecase.ts:395`): hoy no hay forma de validar contra un enum construido por
  petición. La clave de `replay` es `sha256(canonicalJSON([task, promptVersion, outputLanguage, input]))`
  (`execution-key.ts`), y `executionKey` no se exporta desde `@linkvault/ai`. La cuota solo existe con `ctx.userId`
  y para tareas presentes en `AI_QUOTAS` (`run-task.usecase.ts:156`, `infrastructure/quota/config-quota-policy.ts`),
  que va vacío en producción (`docker-compose.prod.yml:316`). `KNOWN_TASK_NAMES` vive en
  `infrastructure/config/ai-config.schema.ts:22`.
- **Grabación de fixtures.** Una tarea `personal` **solo** puede grabarse contra el mock
  (`libs/ai/src/evals/recording/record-fixtures.ts:83`; specs `ai/eval-harness` «Fixtures de una tarea con datos
  personales» y `ai/deterministic-mock` «Grabación de fixtures con un proveedor real»). Con `personal`, los fixtures
  reales de esta tarea serían imposibles (D8).
- **Consentimiento.** Hay uno solo, `aiConsent.externalProviders`, con un texto versionado que habla del **CV**
  («Permitir que un proveedor de IA externo analice mi CV», `apps/web/src/app/features/profile/profile.page.html:147`).
  La api lo lee por `UsersFacade.aiConsentOf` (`users/application/users.facade.ts:128`).
- **Inyección de la IA.** `LinksModule.register(aiModule)` ya recibe `RUN_TASK`
  (`links/presentation/links.module.ts:185-187`); `ApplicationsModule.register(linksModule, searchModule?)` todavía no
  recibe la IA.

## Goals / Non-Goals

**Goals**

- Que, entre más de tres sugerencias visibles, un LLM elija las 3 que más convienen esta semana mirando **todas** las
  señales de cada postulación, no solo la regla que ganó; y que todo lo que muestra siga siendo verificable.
- Degradación honesta a reglas en cualquier fallo, sin que la tarjeta ni el tablero lo noten salvo por el aviso.
- Tope de ejecuciones en código, independiente de `AI_QUOTAS`, y costo acotado en el cupo `:free` compartido con
  `match-cv`.
- Clave de `replay` estable: CI y el eval corren con el mock; los fixtures reales los graba el owner.
- Una métrica que diga si el LLM vale la pena antes de encenderlo para nadie.

**Non-Goals (este change)**

- Texto redactado por el LLM (ADR-068 §3; ver Q2).
- Memoria episódica de decisiones como entrada del LLM (corte siguiente §2 de `weekly-plan`).
- Precálculo en el worker y aviso del lunes (`weekly-plan-monday`, corte 3).
- Cambios de compose, CI, despliegue o variables obligatorias; encender el flag en staging (Q6).
- Seed demo: Ana tiene 3 candidatas y con 3 no se llama al LLM (D3); para probarlo en local se agregan postulaciones a
  mano (RUNBOOK, tarea 8.1).

## Decisions

### D1. On-read con reclamo atómico, espera corta y fin en segundo plano

`GET /api/applications/weekly-plan` sigue calculando al leer. Con el flag encendido, si hay que ejecutar (D7), la
lectura reclama la ejecución, la lanza y la **espera como mucho 2 500 ms** (`WEEKLY_PLAN_LLM_READ_WAIT_MS`). Si
termina a tiempo, responde con la elección; si no, responde por reglas y la ejecución **sigue** hasta su plazo
(`WEEKLY_PLAN_LLM_RUN_TIMEOUT_MS` = 40 000 ms, pasado como `ctx.signal`) y guarda el resultado; la lectura siguiente lo
usa. El `POST` de decisiones **nunca** lanza una ejecución (`mayStartRun: false`): solo lee una elección ya guardada.
La promesa en segundo plano captura todo error, lo registra por nombre (sin `userId` ni entrada) y marca el documento
`failed`.

*Por qué:* los modelos `:free` tardan de 3 a 20 s; bloquear el tablero ese tiempo no se justifica para reordenar tres
filas, y no esperar nada desaprovecha a un BYOK u Ollama rápido. Un reinicio de la api con una ejecución en vuelo deja
el documento en `pending` con `runs` 1: esa semana sale por reglas (R4). Es el precio de no tener worker.

*Alternativas descartadas:* **precalcular en el worker** (es el corte `weekly-plan-monday`: cron, snapshot, mover el
dominio a una lib compartida; queda ahí, Q4); **síncrono con timeout que aborta** (con proveedores lentos se gastaría el
único intento de la semana en un plazo vencido); **disparar sin esperar** (sencillo, pero un proveedor rápido nunca se
vería en la primera carga).

### D2. El mismo puerto, con un contexto fuera de la entrada canónica

`WeeklyPlanner.plan(input, context)` con `context: { userId: string; mayStartRun: boolean }`. El contexto **no** es
parte de la entrada canónica ni de ningún hash. `RuleBasedPlanner` lo ignora. `WeeklyPlanOutcome` gana
`planner: 'rules' | 'llm'` y un `ranked` con **todas** las candidatas visibles en el orden de reglas (los turnos por
regla de D3 de `weekly-plan` sin cortar en 3); `actions` sigue siendo las 3 primeras de `ranked`, así que el
comportamiento con el flag apagado no cambia (tests actuales intactos).

`LlmWeeklyPlanner` vive en `applications/application/weekly-plan/` (necesita puertos con E/S) y compone
`RuleBasedPlanner`. Las piezas puras van al dominio, `applications/domain/weekly-plan/`:
`buildPlanWeekInput` (D4), `composeLlmActions` (D6) y las constantes de D7. El validador de elecciones es compartido
(D5). El módulo provee `WEEKLY_PLANNER` con `useFactory` según `FEATURE_WEEKLY_PLAN_LLM` (D11).

*Alternativa descartada:* poner caché y tope en `GetWeeklyPlan` (el planificador dejaría de ser intercambiable detrás
del puerto, que es la condición 1 del jurado).

### D3. Qué aporta el LLM frente a las reglas, y cuándo no se le llama

Las reglas tienen dos límites que el LLM puede cubrir sin salirse del enum:

1. **Una postulación produce una sola candidata**, la de la primera regla que cumple: una oferta que cierra en 5 días,
   con encaje 85 y dos personas del grupo que conocen a alguien compite como un `closing_soon` cualquiera. Las señales
   secundarias se pierden.
2. **Los turnos por regla son fijos**: una de cada regla antes de repetir, aunque la segunda `follow_up` (40 días
   quieta) importe más que la primera `ask_know_someone`.

Por eso la entrada lleva **todas** las señales de cada candidata (D4) y el LLM elige 3 entre hasta 9 visibles. Con 3 o
menos visibles **no se le llama**: no hay nada que elegir y reordenar tres filas no paga una llamada del cupo
compartido. Esto tampoco gasta el intento de la semana: si el miércoles aparecen más, se puede ejecutar.

**Cómo se mide si vale la pena** (Q5 para los umbrales):

- *Offline (eval):* `must_include_rate` sobre casos sintéticos anotados —incluidos los de señales múltiples que las
  reglas dejan fuera— y `rules_agreement` (informativa): si las respuestas reales coinciden casi siempre con
  `c1, c2, c3`, el LLM no aporta nada que las reglas no den gratis.
- *Online (staging, 2 semanas):* con `source` en cada decisión (D12), la proporción `done / (done + dismissed)` de las
  acciones elegidas por el LLM frente a las de relleno por reglas, y semanas-persona con algún «Hecho» con `planner`
  `llm` frente a `rules`. Con 3 a 5 personas no hay significancia: se reportan números absolutos y decide el owner.

### D4. Entrada canónica: hechos relativos, ids sintéticos, nada que identifique

`buildPlanWeekInput(ranked, factsByKey)` (puro) toma las candidatas visibles en el orden de reglas, como mucho
`WEEKLY_PLAN_LLM_MAX_CANDIDATES` = 9, y les asigna `c1…cN` en ese orden. Por candidata:

| Campo | Origen | Cota |
|---|---|---|
| `id` | posición en el orden de reglas | `^c[1-9]$` |
| `rule` | regla que ganó | `weeklyPlanRuleSchema` |
| `status` | estado de la postulación | `saved`, `interested`, `applied`, `in_process` |
| `daysQuiet` | `PlanCandidateFacts.daysQuiet` | entero 0-365 (recortado) |
| `daysUntilClose?` | `daysUntilExpiry` si ≥ 0 | entero 0-365 (recortado) |
| `fitScore?` | `fit.score` solo con `degraded === false` | entero 0-100 |
| `knowSomeoneCount?` | `knowSomeone.count` si ≥ 1 | entero 1-50 (recortado) |

Fuera, siempre: `today`, `weekKey`, `appliedAt`, `expiresAt`, `groupId`, ids reales, título, empresa, `displayUrl`,
notas, texto de CV, nombres. `outputLanguage` fijo `es` (la salida no tiene texto). Así la misma situación relativa da
la misma entrada para cualquier persona y cualquier día, y por tanto la misma clave: el golden y los fixtures de
`replay` sirven para los tests de integración de la api. `@linkvault/ai` exporta `executionKey` para que un test lo
compruebe (falsación: meter `today` rompe «Clave estable entre personas y días»).

*Por qué sin título ni empresa*, aunque el corte del change anterior los mencionaba: sin el CV el LLM no puede usarlos
para nada mejor que un prejuicio sobre la marca, y su ausencia es lo que permite D8. Si más adelante aportan, se
añaden con otra versión del prompt (y la tarea pasa a `personal`).

*Por qué 9:* con 3-5 personas, rara vez hay más; 9 da tres turnos completos de reglas y acota tokens y el enum.

### D5. Salida de enum cerrado, validada dos veces

`plan-week` devuelve `{ picks: [{ candidateId }] }` con **exactamente 3** (siempre hay más de 3 visibles, D3).

1. **En `runTask`, por petición.** `AiTask` gana `outputSchemaFor?(input): ZodType<O>`; `runTask` lo usa en lugar de
   `outputSchema` en el pipeline de cada proveedor (`run-task.usecase.ts:395`), así un id fuera del enum o repetido
   recorre el camino normal: **una reparación** con los errores, **siguiente proveedor**, `degraded`. Una tarea con
   `outputSchemaFor` no puede ser cacheable (la caché valida con el schema estático). Las demás tareas no cambian.
2. **En la api, antes de guardar.** `validateWeeklyPlanPicks(ids, picks)` en `libs/shared` (puro: 3 elementos, todos
   en `ids`, sin repetir) se usa en `outputSchemaFor`, en la métrica `valid_pick_rate` y en `LlmWeeklyPlanner`. La
   segunda pasada es defensa en profundidad frente a un BYOK raro, un fixture editado a mano o una regresión de 1; un
   rechazo marca `failed` (falsación en la tarea 4.3).

*Alternativa descartada:* devolver de 0 a 3 (ADR-068 lo admitía). Exactamente 3 simplifica el validador y la
composición; «menos es más» no es una decisión que el LLM tenga datos para tomar.

### D6. Composición: urgentes, elecciones vigentes, relleno

`composeLlmActions(ranked, picks)` (puro), hasta 3 y sin repetir:

1. **Urgentes**: visibles con `closing_soon` y `daysLeft` ≤ 1 (`WEEKLY_PLAN_URGENT_DAYS_LEFT`), en orden de reglas.
2. **Elecciones** guardadas que siguen visibles, en el orden del LLM.
3. **Relleno** en orden de reglas.

`planner` es `llm` si y solo si al menos una acción viene del paso 2. La regla 1 existe porque la elección es de toda la
semana y la fecha corre: lo que el lunes cerraba en 5 días el jueves cierra mañana, y no hay ejecución nueva hasta la
semana siguiente (D7). Ningún juicio del LLM puede esconder un cierre inminente; también lo pide el golden
(`must_include` de lo que cierra hoy).

### D7. Tope en código: 1 ejecución por persona y semana, 20 por día en total

- **Por persona y semana** (`WEEKLY_PLAN_LLM_RUNS_PER_USER_WEEK` = 1, ADR-068 §3): reclamo en
  `weekly_plan_llm_picks` con `updateOne({ userId, weekKey, runs: { $lt: 1 } }, { $inc: { runs: 1 }, $set: {
  status: 'pending', startedAt } , $setOnInsert: { createdAt } }, { upsert: true })`; si el documento ya tiene
  `runs` 1, el `upsert` choca con el índice único y **eso es la denegación**. Cuenta la ejecución, no el éxito: un
  `failed` no se reintenta esa semana.
- **Global por día UTC** (`WEEKLY_PLAN_LLM_DAILY_RUNS_MAX` = 20): `weekly_plan_llm_budget` con `_id` = día y el mismo
  `$inc` condicionado (`count < 20`). Es el patrón que ADR-069 §6 fijó para `summarize-group-week`.
- **Orden:** persona primero, global después; si el global deniega, se compensa (`runs` 0, sin `status`) para que la
  persona pueda intentarlo otro día de la semana. Si Mongo falla en cualquiera de los dos pasos: **falla cerrada**,
  reglas y sin `runTask` (al revés que la cuota de `libs/ai`, que falla abierta: aquí no hay otro tope detrás).
- **Antes de reclamar**, el consentimiento (D8): sin consentimiento o ilegible, no se reclama nada.
- `plan-week` entra en `KNOWN_TASK_NAMES`, así un operador **puede** añadir un tope extra por `AI_QUOTAS`, pero nada
  depende de ello. Una ejecución gasta como mucho 2 intentos por proveedor de la cadena.

*Por qué 20:* con 3-5 personas el techo real es 5 por semana; 20 por día solo frena un bucle o un error, y deja
cupo `:free` para `match-cv`.

### D8. `plan-week` es `public` y el consentimiento lo exige quien la llama

La entrada, por construcción del schema (objetos estrictos, enums, enteros acotados, `id` con patrón, **ningún string
libre**), no puede contener un dato personal ni identificar a nadie. Declararla `public` (ADR-018 §11) tiene una
consecuencia necesaria: la regla vigente **prohíbe grabar contra un proveedor real** una tarea `personal`, así que con
`personal` los fixtures reales con la clave del owner serían imposibles sin enmendar dos specs de seguridad de `libs/ai`.

El panel pidió consentimiento y `PiiRedactor`. Se cumplen así:

- **Consentimiento:** `LlmWeeklyPlanner` exige `aiConsent.externalProviders` concedido antes de reclamar; sin él, la
  persona tiene el plan por reglas (es el único consentimiento que existe; su texto habla del CV y **no** se cambia:
  Q1).
- **`PiiRedactor`:** no corre (no corre para tareas `public`), pero su objetivo se cumple con más fuerza: no hay texto
  que redactar. Un test de guarda recorre el JSON Schema de `planWeekInputSchema` y falla si aparece un `string` que no
  sea enum ni el `id` con patrón (falsación: añadir `title: z.string()`).

*Alternativas descartadas:* `personal` con fixtures solo del mock (sin medición real antes de encender); `personal`
enmendando la regla de grabación (debilita una regla de seguridad para un caso que no la necesita).

### D9. Persistencia: elección por persona y semana, presupuesto diario

`weekly_plan_llm_picks`:

```ts
{ userId: ObjectId; weekKey: string; runs: 0 | 1;
  status?: 'pending' | 'ready' | 'failed';
  picks?: string[];            // <rule>:<applicationId>, en el orden del LLM; solo con 'ready'
  candidateCount?: number;     // N de la entrada
  rulesAgreement?: number;     // |picks ∩ c1..c3| / 3
  inputKey?: string;           // executionKey de la entrada (para medir deriva, nunca la entrada)
  providerId?: string; model?: string; promptVersion?: string;
  failure?: 'invalid_output' | 'degraded' | 'timeout' | 'error';
  createdAt: Date; startedAt?: Date; finishedAt?: Date }
```

Índice único `(userId, weekKey)`, TTL 35 días sobre `createdAt` (igual que las decisiones: la métrica de D3 cruza las
dos colecciones antes de que caduquen). Nunca se guardan la entrada, el prompt ni texto del proveedor.
`weekly_plan_llm_budget`: `{ _id: 'YYYY-MM-DD', count: number, day: Date }`, TTL 3 días sobre `day`. La cascada de
borrado de cuenta elimina `weekly_plan_llm_picks` del usuario; el presupuesto no guarda datos de nadie.

### D10. El LLM no redacta: el motivo sigue siendo i18n, y la tarjeta lo avisa

ADR-068 §3 dice «No redacta texto visible», y es una decisión aceptada por el owner: este change no la cambia. Los
motivos siguen saliendo de `reason` con los textos de `web/weekly-plan`. Lo único nuevo en el SPA es una línea
honesta cuando `planner` es `llm`: «Elegidas con IA entre tus sugerencias de la semana.» Si el owner quiere un motivo
redactado, se diseña como **complemento** del i18n, nunca reemplazo (Q2).

### D11. `FEATURE_WEEKLY_PLAN_LLM`, apagado por defecto

Opcional en `apiConfigSchema`, `default('false')`. ADR-069 §2 encendió `FEATURE_GROUP_BRIEF` por defecto como
**excepción** con tres condiciones, una de ellas que «el trabajo no sale de Mongo (sin red, IA ni correo)». Aquí sale a
la IA, gasta cupo y su puerta de calidad (fixtures reales, D13) todavía no se pasó: rige la regla general, apagado. Sin
variables obligatorias ni cambios de compose (la comprobación `compose-env-contract` acepta opcionales con default).
Consecuencia aceptada: en staging queda apagado hasta un change que lo reenvíe en el compose (Q6). `.env.example` lo
explica.

### D12. Cada decisión sabe quién eligió la acción

`DecideWeeklyPlanAction` guarda `source: 'llm' | 'rules'` en `weekly_plan_decisions` (opcional en el schema de
Mongoose; los documentos viejos siguen valiendo). `llm` si el `candidateId` está en las elecciones de un documento
`ready` de esa semana. No viaja en la respuesta ni cambia la ocultación. Es lo que permite la métrica online de D3 sin
registrar visitas.

### D13. Eval, fixtures y puerta de activación

- `libs/ai/src/evals/plan-week/`: golden de ≥ 8 casos sintéticos (etiqueta `synthetic` obligatoria), `expected`
  `{ mustInclude }`, métricas `valid_pick_rate` y `must_include_rate` (bloqueantes) y `rules_agreement` (informativa).
- **Fixtures de CI**: `nx run ai:record-fixtures --task=plan-week --upstream=mock` (synth: elige `c1, c2, c3`), y
  `nx run ai:eval --provider=mock --update-baseline` en el mismo commit. Todo se implementa y prueba sin clave.
- **Fixtures reales** (tarea 2.7, **la ejecuta el owner o con su clave**): `--upstream=openrouter --allow-external
  --overwrite`, luego `--update-baseline`, todo en un commit, con el reporte en este design.
- **Puerta para encender el flag en cualquier entorno** (umbrales en Q5): con fixtures reales,
  `schema_validity_rate` = 1, `valid_pick_rate` = 1, `must_include_rate` ≥ 0,9 y `rules_agreement` ≤ 0,8. Si el
  acuerdo es mayor, el LLM no aporta y el flag se queda apagado.

### D14. Logs

`LlmWeeklyPlanner` registra con pino: inicio y fin de ejecución con `weekKey`, `candidateCount`, `status`, `failure` y
latencia; nunca `userId`, la entrada, las elecciones ni texto del proveedor. `runTask` ya registra su ledger
(`ai_usage`) con `userId`, como el resto de tareas.

## Casos de prueba derivados (para el implementador)

| Escenario (spec) | Test |
|---|---|
| applications «Elección del LLM con el mock en replay» | `llm-weekly-planner.int.spec.ts` › «uses the replayed picks in the chosen order» |
| «Id fuera del enum» / «Ids repetidos» | `llm-weekly-planner.spec.ts` › «rejects a pick outside the enum and falls back to rules» / «rejects duplicated picks» |
| «Pocas candidatas no llaman a la IA» | «does not run with three or fewer visible candidates» |
| «Decidir no lanza una ejecución» | `decide-weekly-plan-action.usecase.spec.ts` › «never starts a run on decide» |
| «Una elegida se oculta y entra la siguiente por reglas» | `compose-llm-actions.spec.ts` › «fills a hidden pick from rules order» |
| «Lo urgente no se esconde» | `compose-llm-actions.spec.ts` › «puts urgent closing candidates first» |
| «Degradación honesta» | «marks failed on degraded and does not retry the same week» |
| «Respuesta lenta» | «answers rules after the read wait and stores the late result» (timers falsos) |
| «Sin consentimiento» / «Consentimiento ilegible» | «skips without consent» / «skips when consent cannot be read» |
| «Dos lecturas a la vez» | `mongo-weekly-plan-llm-store.int.spec.ts` › «only one concurrent claim wins» |
| «Tope diario global agotado» | «denies at the global cap and releases the user claim» |
| «Mongo falla al reclamar» | «fails closed when the claim cannot be written» |
| «Sin identificadores reales» / «Clave estable…» / «Como mucho nueve» | `build-plan-week-input.spec.ts` › «contains no real ids, dates or titles» / «same relative facts give the same key» / «caps at nine candidates» |
| «Decisión sobre una elegida por el LLM» / «…el relleno» / «…sin atribución» | `decide-weekly-plan-action.usecase.spec.ts` › «records source llm for a pick» / «records source rules for a fill» / «accepts a decision without source» |
| ai «Id fuera del enum de la petición» y siguientes | `run-task.usecase.spec.ts` › «validates against the per-request schema and repairs» … |
| ai «Entrada con texto libre» / «El schema no admite texto» | `plan-week.task.spec.ts` › «rejects free text in the input» / «input JSON schema has no free strings» |
| eval «Elección que ignora lo que cierra hoy» | `plan-week/metrics.spec.ts` › «must_include_rate drops when a must-include id is missing» |
| web «Plan elegido con IA» y siguientes | `weekly-plan-card.component.spec.ts` › «shows the AI notice only for planner llm with actions» (ES y EN) |
| users «Elecciones eliminadas» | `mongo-account-deletion.cascade.spec.ts` › «deletes weekly plan llm picks of the user only» |

## Risks / Trade-offs

- **R1. El LLM no aporta.** Con hechos numéricos, un buen modelo puede coincidir casi siempre con las reglas.
  Mitigación: `rules_agreement` y la puerta de D13; si no pasa, el código queda con el flag apagado y se decide si se
  revierte.
- **R2. Cupo `:free` compartido con `match-cv`.** Tope 1/persona/semana y 20/día; una ejecución gasta como mucho 2
  intentos por proveedor.
- **R3. Elección vieja dentro de la semana.** Lo nuevo que no es urgente no desplaza a las elegidas hasta el lunes.
  Mitigación: urgentes primero (D6) y el relleno ocupa los huecos que dejan las decisiones; una segunda ejecución por
  semana queda como Q3.
- **R4. Ejecución perdida por reinicio.** Documento `pending` con `runs` 1: esa semana, reglas. Al leer, un `pending`
  más viejo que dos plazos de ejecución se marca `failed` con `failure: 'timeout'` para que la métrica no lo cuente como
  en curso.
- **R5. El orden cambia entre la primera carga y las siguientes** (reglas → LLM). El aviso de D10 lo explica; ocurre
  como mucho una vez por semana.
- **R6. Consentimiento con texto de CV** usado como puerta de otra cosa (Q1). Lo que sale no es personal; la puerta es
  conservadora, no una ampliación del permiso.
- **R7. Fixture ausente en tests.** Un test de integración con el mock en `replay` y una entrada sin fixture lanza
  `FixtureMissing`; por eso los tests de la api usan un `RunTaskFn` falso salvo uno, cuya entrada coincide con un caso
  del golden (lo garantiza D4).

## Migration Plan

Dos colecciones nuevas con índices por `autoIndex` (incluidos los TTL) y un campo opcional en `weekly_plan_decisions`;
sin migración de datos. Flag apagado por defecto: desplegar no cambia nada. Rollback: apagar el flag (o revertir el
PR); las colecciones caducan solas (35 y 3 días) o se borran con `db.weekly_plan_llm_picks.drop()` y
`db.weekly_plan_llm_budget.drop()`. Todo en `docs/RUNBOOK.md` (tarea 8.1).

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] Consentimiento y sensibilidad.** El único consentimiento existente habla del
  CV. Opciones: (a) `plan-week` `public` y puerta en el consentimiento existente, sin cambiar su texto (D8);
  (b) `public` sin puerta (lo que sale no es personal); (c) consentimiento propio para «Tu semana con IA» (cambio en
  el perfil, nueva versión de texto, más alcance) y `personal`, que además impide grabar fixtures reales sin enmendar
  `ai/eval-harness` y `ai/deterministic-mock`. **Recomendación: (a).**
- **Q2 [no bloqueante] Motivo redactado.** (a) Ninguno en este corte (ADR-068 §3) — **recomendada**; (b) en un corte
  siguiente, un código cerrado de «señal adicional» por elección (p. ej. `also_know_someone`), validado contra los
  hechos y renderizado con i18n **debajo** del motivo de reglas; (c) una línea libre del LLM como complemento, con
  evaluador determinista de números y nombres, enmendando ADR-068 §3. En ningún caso reemplaza al i18n.
- **Q3 [no bloqueante] Segunda ejecución en la semana.** (a) 1 por persona y semana (ADR-068 §3) — **recomendada**
  hasta tener datos; (b) hasta 2, la segunda solo si una candidata visible nueva entra en las 3 primeras del orden de
  reglas y la elección no la vio.
- **Q4 [no bloqueante] Dónde se ejecuta.** Se confirma on-read (D1) y el precálculo se deja para `weekly-plan-monday`.
  **Recomendación: confirmar.**
- **Q5 [no bloqueante] Umbrales de la puerta de activación** (D13): `must_include_rate` ≥ 0,9 y `rules_agreement`
  ≤ 0,8 con fixtures reales; online, 2 semanas de staging con lectura de números absolutos. **Recomendación: esos
  valores.**
- **Q6 [no bloqueante] Encender en staging.** Requiere reenviar `FEATURE_WEEKLY_PLAN_LLM` en `docker-compose.prod.yml`,
  fuera de este change y sujeto a la precedencia de la fila 35. (a) Esperar a cerrar 35b — **recomendada**; (b) un
  change mínimo de compose tras pasar la puerta, con excepción explícita del owner.
- **Q7 [bloqueante para `/opsx:apply`] Aprobación del owner** para aplicar en la rama `change/weekly-plan-llm` tras
  el debate. La autorización del 2026-11-25 dejó dicho que los cortes siguientes necesitan su propio change y su
  propia aprobación. No incluye fusión, que espera una ventana.
- **Q8 [no bloqueante] Valores de los topes y plazos** (20 por día, 9 candidatas, 2 500 ms, 40 000 ms, urgente ≤ 1
  día): constantes de código revisables con datos de 35b. **Recomendación: estos.**
