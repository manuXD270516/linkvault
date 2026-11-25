## MODIFIED Requirements

### Requirement: Plan semanal calculado al leer

`GET /api/applications/weekly-plan`, autenticado, SHALL responder `200` con `{ weekKey, planner, actions,
doneThisWeek }` validado por `weeklyPlanResponseSchema` de `libs/shared`. `weekKey` SHALL ser la semana ISO en curso en
UTC con formato `YYYY-Www`; `planner` SHALL ser `rules` o `llm` (`llm` si y solo si al menos una de las acciones
devueltas es una elección guardada del planificador LLM, requirement «Selección con LLM»); `actions` SHALL tener como
mucho 3 elementos. El plan SHALL salir del puerto `WeeklyPlanner`, que recibe la entrada canónica y un contexto
`{ userId, mayStartRun }` que no forma parte de la entrada canónica. Con `FEATURE_WEEKLY_PLAN_LLM` apagado (valor por
defecto) la implementación SHALL ser `RuleBasedPlanner`, sin llamadas a `libs/ai`, el cálculo SHALL ser determinista
para las mismas postulaciones, señales de links, decisiones y fecha, y la lectura NO SHALL escribir en ninguna
colección. Con el flag encendido, la lectura SHALL poder escribir **solo** en `weekly_plan_llm_picks` y
`weekly_plan_llm_budget`, y NUNCA en `weekly_plan_decisions`, `applications` ni `application_events`; el resultado SHALL
ser determinista para las mismas postulaciones, señales, decisiones, fecha y documento de `weekly_plan_llm_picks`.

#### Scenario: Tope de tres acciones

- **GIVEN** Ana con cinco postulaciones que cumplen alguna regla y `FEATURE_WEEKLY_PLAN_LLM` apagado
- **WHEN** pide `GET /api/applications/weekly-plan`
- **THEN** la respuesta SHALL ser `200` con exactamente 3 acciones y `planner` `rules`

#### Scenario: Sin nada que hacer

- **GIVEN** Ana con postulaciones que no cumplen ninguna regla
- **WHEN** pide el plan
- **THEN** `actions` SHALL ser una lista vacía y la respuesta SHALL ser `200`

#### Scenario: La lectura no escribe

- **GIVEN** Ana con candidatas y `FEATURE_WEEKLY_PLAN_LLM` apagado
- **WHEN** pide el plan dos veces seguidas con el mismo reloj
- **THEN** las dos respuestas SHALL ser iguales
- **AND** NO SHALL existir ningún documento nuevo en `weekly_plan_decisions`, `applications` ni `application_events`
- **AND** NO SHALL existir ningún documento en `weekly_plan_llm_picks` ni en `weekly_plan_llm_budget`

#### Scenario: Con el flag encendido la lectura solo escribe la elección

- **GIVEN** Ana con cinco candidatas visibles, `FEATURE_WEEKLY_PLAN_LLM` encendido y el mock en `replay`
- **WHEN** pide el plan
- **THEN** SHALL existir como mucho un documento nuevo en `weekly_plan_llm_picks` para `(Ana, semana)` y como mucho un
  incremento en `weekly_plan_llm_budget`
- **AND** NO SHALL existir ningún documento nuevo en `weekly_plan_decisions`, `applications` ni `application_events`

#### Scenario: Flag apagado no llama a la IA

- **GIVEN** Ana con cinco candidatas visibles y `FEATURE_WEEKLY_PLAN_LLM` apagado
- **WHEN** pide el plan
- **THEN** `runTask` NO SHALL invocarse y `planner` SHALL ser `rules`

#### Scenario: Semana ISO en UTC

- **GIVEN** el reloj en `2026-12-31T23:30:00Z`
- **WHEN** Ana pide el plan
- **THEN** `weekKey` SHALL ser `2026-W53`

### Requirement: Reglas del plan

Solo SHALL considerarse postulaciones del usuario que no estén cerradas ni `accepted` y cuyo link exista y no tenga
`closedAt`; si hay más de 200, SHALL considerarse las 200 con `statusChangedAt` más antiguo (desempate por identificador). Cada postulación SHALL producir como mucho una candidata,
la de la primera regla que cumpla en este orden:

1. `apply_before_close`: estado `saved` o `interested`, `preview.expiresAt` ausente o no anterior a hoy, y
   `preview.expiresAt` entre hoy y hoy + 7 días (UTC, ambos incluidos) —motivo `closing_soon` con `expiresAt` y
   `daysLeft`— o, si no, último encaje ≥ 75 de un análisis no degradado —motivo `high_fit` con `score`—.
2. `follow_up`: estado `applied` o `in_process` y al menos 10 días desde `statusChangedAt` —motivo `quiet` con
   `daysQuiet`, `status` y `appliedAt` si existe—.
3. `ask_know_someone`: estado `saved`, `interested`, `applied` o `in_process`, y al menos una persona distinta de quien
   pide marcó «conozco a alguien» en ese link en un grupo del que quien pide es miembro —motivo `know_someone` con
   `count` igual al número de esas personas en el grupo de quien pide con más marcas, y el `groupId` de ese grupo
   (desempate por `groupId` ascendente)—.

Un `expiresAt` anterior a hoy SHALL dejar la postulación fuera de `apply_before_close`, también por encaje. Dentro de cada regla el orden SHALL ser: `closing_soon`
por `daysLeft` ascendente y después `high_fit` por `score` descendente; `follow_up` por `daysQuiet` descendente;
`ask_know_someone` por `count` descendente; desempate por `applicationId` ascendente. El **orden de reglas** de las
candidatas visibles SHALL tomar por turnos la primera candidata visible de cada regla en el orden 1, 2, 3, después la
segunda, y así hasta agotarlas. Cuando el plan no usa una elección del planificador LLM (requirement «Selección con
LLM»), la selección SHALL ser las 3 primeras de ese orden de reglas. Con una elección LLM vigente, los huecos que la
elección no cubre SHALL llenarse en ese mismo orden de reglas. El `candidateId` SHALL ser `<rule>:<applicationId>`.

#### Scenario: Guardada que vence pronto

- **GIVEN** una postulación `saved` cuyo link tiene `expiresAt` dentro de 3 días y no tiene `closedAt`
- **WHEN** Ana pide el plan
- **THEN** SHALL incluir una acción `apply_before_close` con motivo `closing_soon` y `daysLeft` 3

#### Scenario: Vencida sin cierre todavía

- **GIVEN** una postulación `interested` cuyo link tiene `expiresAt` de ayer y no tiene `closedAt`
- **WHEN** Ana pide el plan
- **THEN** esa postulación NO SHALL aparecer como `closing_soon`

#### Scenario: Vencida con encaje alto

- **GIVEN** una postulación `saved` cuyo link tiene `expiresAt` de ayer, sin `closedAt`, y último encaje 80 no degradado
- **WHEN** Ana pide el plan
- **THEN** NO SHALL incluir ninguna acción `apply_before_close` de esa postulación

#### Scenario: Cierra hoy

- **GIVEN** una postulación `interested` cuyo link tiene `expiresAt` igual a la fecha UTC de hoy
- **WHEN** Ana pide el plan
- **THEN** SHALL incluir una acción `apply_before_close` con motivo `closing_soon` y `daysLeft` 0

#### Scenario: Encaje alto sin fecha de cierre

- **GIVEN** una postulación `interested` sin `expiresAt` con último encaje 80 no degradado
- **WHEN** Ana pide el plan
- **THEN** SHALL incluir una acción `apply_before_close` con motivo `high_fit` y `score` 80

#### Scenario: Encaje degradado no cuenta

- **GIVEN** una postulación `interested` sin `expiresAt` cuyo último análisis dio 90 con `degraded` verdadero
- **WHEN** Ana pide el plan
- **THEN** NO SHALL incluir una acción `high_fit` de esa postulación

#### Scenario: Postulación quieta

- **GIVEN** una postulación `applied` con `statusChangedAt` hace 12 días
- **WHEN** Ana pide el plan
- **THEN** SHALL incluir una acción `follow_up` con `daysQuiet` 12

#### Scenario: Quieta pero sin postular

- **GIVEN** una postulación `saved` con `statusChangedAt` hace 30 días, sin `expiresAt` ni encaje
- **WHEN** Ana pide el plan
- **THEN** NO SHALL incluir ninguna acción de esa postulación

#### Scenario: Link cerrado

- **GIVEN** una postulación `applied` quieta 15 días cuyo link tiene `closedAt`
- **WHEN** Ana pide el plan
- **THEN** NO SHALL incluir ninguna acción de esa postulación

#### Scenario: Solo cuenta a otras personas

- **GIVEN** un link de Ana compartido en su grupo donde solo Ana marcó «conozco a alguien»
- **WHEN** Ana pide el plan
- **THEN** NO SHALL incluir una acción `ask_know_someone` de ese link

#### Scenario: Una por regla antes de repetir

- **GIVEN** Ana con dos candidatas `follow_up` y una `ask_know_someone`, y ninguna `apply_before_close`
- **WHEN** pide el plan
- **THEN** las acciones SHALL ser, en orden, la primera `follow_up`, la `ask_know_someone` y la segunda `follow_up`


## ADDED Requirements

### Requirement: Selección con LLM

Con `FEATURE_WEEKLY_PLAN_LLM` encendido, el puerto `WeeklyPlanner` SHALL implementarse con `LlmWeeklyPlanner`, que
primero calcula el plan de `RuleBasedPlanner` y después decide si usa una elección del LLM. Una **ejecución** SHALL
lanzarse solo si se cumplen todas estas condiciones: la lectura es `GET /api/applications/weekly-plan`
(`mayStartRun` verdadero; el `POST` de decisiones NUNCA lanza una ejecución), hay **más de 3** candidatas visibles, no
existe documento de `weekly_plan_llm_picks` para `(userId, weekKey)` con `runs` 1, el consentimiento de proveedores
externos de la persona se pudo leer y está concedido, y el tope del requirement «Tope de ejecuciones del planificador
LLM» lo permite. La ejecución SHALL llamar a `runTask` con la tarea `plan-week` y la entrada canónica del requirement
«Entrada canónica del planificador LLM».

La salida SHALL pasar por un **validador determinista** antes de guardarse: exactamente 3 `candidateId`, todos
distintos y todos dentro del enum de ids sintéticos de esa petición. Una salida válida SHALL guardarse como
`status: 'ready'` con las elecciones traducidas a `<rule>:<applicationId>`; una salida inválida, un resultado
`degraded` de `runTask` o un plazo vencido SHALL guardarse como `status: 'failed'` y esa semana NO SHALL reintentarse.
NUNCA SHALL guardarse el prompt renderizado, la entrada ni texto alguno del proveedor.

La lectura SHALL esperar a la ejecución como mucho `WEEKLY_PLAN_LLM_READ_WAIT_MS` (2 500 ms); si no terminó, SHALL
responder el plan por reglas y la ejecución SHALL seguir hasta su plazo (`WEEKLY_PLAN_LLM_RUN_TIMEOUT_MS`, 40 000 ms,
como `ctx.signal`), guardando su resultado al terminar. Un error de la ejecución en segundo plano SHALL registrarse por
su nombre de error, sin `userId` ni entrada, y NO SHALL afectar a ninguna petición.

Con un documento `ready`, las acciones SHALL componerse así, sin repetir candidata y hasta 3: primero las candidatas
visibles **urgentes** (motivo `closing_soon` con `daysLeft` ≤ 1) en orden de reglas; después las elecciones guardadas
que sigan visibles, en el orden que eligió el LLM; después el relleno en orden de reglas. Una elección que ya no es
visible (decidida, cerrada, cambiada de regla o fuera del universo) SHALL ignorarse. Sin documento `ready`, el plan
SHALL ser el de reglas. Los motivos SHALL ser siempre los de las reglas (`reason`): el LLM NO SHALL redactar texto
visible.

#### Scenario: Elección del LLM con el mock en replay

- **GIVEN** Ana con cinco candidatas visibles, el flag encendido, consentimiento concedido y un fixture de `plan-week`
  cuya salida elige `c4`, `c2` y `c5`
- **WHEN** pide el plan y la ejecución termina antes de 2 500 ms
- **THEN** las acciones SHALL ser las candidatas `c4`, `c2` y `c5`, en ese orden, con sus `candidateId` reales
- **AND** `planner` SHALL ser `llm`

#### Scenario: Id fuera del enum

- **GIVEN** cinco candidatas visibles y un planificador cuyo resultado `success` trae `c9`
- **WHEN** Ana pide el plan
- **THEN** `planner` SHALL ser `rules` y las acciones SHALL ser las 3 primeras del orden de reglas
- **AND** el documento de `(Ana, semana)` SHALL quedar con `status` `failed`

#### Scenario: Ids repetidos

- **GIVEN** cinco candidatas visibles y un resultado `success` con `c1`, `c1` y `c3`
- **WHEN** Ana pide el plan
- **THEN** `planner` SHALL ser `rules` y el documento SHALL quedar `failed`

#### Scenario: Pocas candidatas no llaman a la IA

- **GIVEN** Ana con exactamente 3 candidatas visibles y el flag encendido
- **WHEN** pide el plan
- **THEN** `runTask` NO SHALL invocarse, NO SHALL existir documento en `weekly_plan_llm_picks` y `planner` SHALL ser
  `rules`

#### Scenario: Decidir no lanza una ejecución

- **GIVEN** Ana con cinco candidatas visibles, el flag encendido y ningún documento de elección esta semana
- **WHEN** envía una decisión válida por `POST /api/applications/weekly-plan/decisions`
- **THEN** `runTask` NO SHALL invocarse y la respuesta SHALL tener `planner` `rules`

#### Scenario: Una elegida se oculta y entra la siguiente por reglas

- **GIVEN** una elección `ready` con A, B y C y la candidata D primera del orden de reglas fuera de la elección
- **WHEN** Ana marca A como `done`
- **THEN** las acciones SHALL ser B, C y D, en ese orden, y `planner` SHALL ser `llm`

#### Scenario: Lo urgente no se esconde

- **GIVEN** una elección `ready` con A, B y C, y una candidata visible E con motivo `closing_soon` y `daysLeft` 1 que
  no está en la elección
- **WHEN** Ana pide el plan
- **THEN** las acciones SHALL ser E, A y B, en ese orden

#### Scenario: Degradación honesta

- **GIVEN** cinco candidatas visibles y `runTask` que devuelve `degraded` con motivo `providers_failed`
- **WHEN** Ana pide el plan
- **THEN** `planner` SHALL ser `rules`, las acciones SHALL ser las del orden de reglas y el documento SHALL quedar
  `failed`
- **AND** una segunda lectura de la misma semana NO SHALL invocar `runTask`

#### Scenario: Respuesta lenta

- **GIVEN** cinco candidatas visibles y un proveedor que tarda 10 s en responder una salida válida
- **WHEN** Ana pide el plan
- **THEN** la respuesta SHALL llegar sin esperar más de 2 500 ms a la ejecución, con `planner` `rules`
- **AND** al terminar la ejecución el documento SHALL quedar `ready` y la lectura siguiente SHALL tener `planner` `llm`

#### Scenario: Sin consentimiento

- **GIVEN** Ana con cinco candidatas visibles, el flag encendido y `aiConsent.externalProviders` falso
- **WHEN** pide el plan
- **THEN** `runTask` NO SHALL invocarse, NO SHALL reclamarse ninguna ejecución y `planner` SHALL ser `rules`

#### Scenario: Consentimiento ilegible

- **GIVEN** cinco candidatas visibles y la fachada de `users` que falla al leer el consentimiento
- **WHEN** Ana pide el plan
- **THEN** `runTask` NO SHALL invocarse, la respuesta SHALL ser `200` con `planner` `rules` y NO SHALL reclamarse ninguna
  ejecución

### Requirement: Tope de ejecuciones del planificador LLM

El tope SHALL vivir en código y NO SHALL depender de `AI_QUOTAS`. Como mucho SHALL haber **una** ejecución de
`runTask('plan-week')` por `(userId, weekKey)` (`WEEKLY_PLAN_LLM_RUNS_PER_USER_WEEK` = 1), sea cual sea su resultado,
reclamada de forma atómica en `weekly_plan_llm_picks` (índice único `(userId, weekKey)`, actualización con `$inc` de
`runs` condicionada a `runs < 1` y `upsert`; un choque de clave única SHALL contar como denegado). Además, como mucho
SHALL haber `WEEKLY_PLAN_LLM_DAILY_RUNS_MAX` (20) ejecuciones por día UTC entre todas las personas, contadas en
`weekly_plan_llm_budget` (`_id` = día `YYYY-MM-DD`) con `$inc` condicionado a `count < 20` y `upsert`. El reclamo de la
persona SHALL hacerse antes que el global; si el global se deniega, el reclamo de la persona SHALL compensarse
(`runs` vuelve a 0, sin `status`) y el plan SHALL salir por reglas. Un error de Mongo al reclamar SHALL tratarse como
denegado (falla cerrada): plan por reglas, sin `runTask`. `weekly_plan_llm_picks` SHALL caducar a los 35 días de su
creación y `weekly_plan_llm_budget` a los 3 días.

#### Scenario: Dos lecturas a la vez

- **GIVEN** Ana con cinco candidatas visibles y sin documento de elección esta semana
- **WHEN** llegan dos `GET /api/applications/weekly-plan` simultáneos
- **THEN** `runTask` SHALL invocarse exactamente una vez
- **AND** SHALL existir un único documento de `(Ana, semana)` con `runs` 1

#### Scenario: La semana siguiente vuelve a haber ejecución

- **GIVEN** Ana con un documento `failed` en `2026-W48`
- **WHEN** pide el plan en `2026-W49` con cinco candidatas visibles
- **THEN** `runTask` SHALL invocarse una vez para `2026-W49`

#### Scenario: Tope diario global agotado

- **GIVEN** el documento del día en `weekly_plan_llm_budget` con `count` 20
- **WHEN** Ana, sin documento de elección esta semana, pide el plan con cinco candidatas visibles
- **THEN** `runTask` NO SHALL invocarse y `planner` SHALL ser `rules`
- **AND** el documento de `(Ana, semana)` SHALL quedar con `runs` 0, de modo que otro día de la misma semana pueda
  ejecutarse

#### Scenario: Sin AI_QUOTAS sigue habiendo tope

- **GIVEN** `AI_QUOTAS` vacío y Ana con una ejecución ya hecha esta semana
- **WHEN** pide el plan tres veces más con candidatas distintas
- **THEN** `runTask` NO SHALL invocarse otra vez esa semana

#### Scenario: Mongo falla al reclamar

- **GIVEN** cinco candidatas visibles y la escritura del reclamo que falla
- **WHEN** Ana pide el plan
- **THEN** la respuesta SHALL ser `200` con `planner` `rules` y `runTask` NO SHALL invocarse

### Requirement: Entrada canónica del planificador LLM

La entrada de `plan-week` SHALL construirse con una función pura del dominio a partir de las candidatas **visibles**
(elegibles y no ocultas por decisiones) en el orden de reglas, como mucho `WEEKLY_PLAN_LLM_MAX_CANDIDATES` (9), con ids
sintéticos `c1`…`cN` asignados en ese orden. Por candidata SHALL contener solo: `id`, `rule`, `status`, `daysQuiet`,
`daysUntilClose` (si la oferta tiene `expiresAt` no anterior a hoy), `fitScore` (solo de un análisis no degradado) y
`knowSomeoneCount` (si es al menos 1). NO SHALL contener identificadores reales (`ObjectId`, `applicationId`, `linkId`,
`groupId`), fechas absolutas, `today`, `weekKey`, el instante actual, título, empresa, `displayUrl`, notas, etiquetas,
texto de CV, userIds ni nombres. `outputLanguage` SHALL ser siempre `es`. Las mismas candidatas con los mismos hechos
relativos SHALL producir la misma entrada y, por tanto, la misma clave de ejecución.

#### Scenario: Sin identificadores reales

- **GIVEN** Ana con cinco candidatas visibles, una de ellas `ask_know_someone` en un grupo
- **WHEN** se construye la entrada de `plan-week`
- **THEN** su JSON NO SHALL contener ninguna cadena de 24 caracteres hexadecimales, ninguna fecha `YYYY-MM-DD`, el
  `groupId`, el título ni la empresa de ninguna oferta

#### Scenario: Clave estable entre personas y días

- **GIVEN** Ana el `2026-11-23` y Bob el `2026-12-07`, cada uno con candidatas de distintos `ObjectId` pero los mismos
  hechos relativos en el mismo orden de reglas
- **WHEN** se construyen sus entradas
- **THEN** las dos entradas SHALL ser iguales y su clave de ejecución SHALL coincidir

#### Scenario: Como mucho nueve

- **GIVEN** Ana con doce candidatas visibles
- **WHEN** se construye la entrada
- **THEN** SHALL contener las 9 primeras del orden de reglas, con ids `c1` a `c9`

### Requirement: Atribución de las decisiones

Al guardar una decisión, el sistema SHALL registrar en el documento de `weekly_plan_decisions` el campo `source`:
`llm` si en ese momento el `candidateId` está entre las elecciones de un documento `ready` de `weekly_plan_llm_picks`
de esa persona y esa semana, y `rules` en cualquier otro caso. `source` NO SHALL viajar en ninguna respuesta HTTP ni
cambiar qué oculta una decisión; un documento sin `source` (anterior a este change) SHALL seguir siendo válido.

#### Scenario: Decisión sobre una elegida por el LLM

- **GIVEN** una elección `ready` de Ana con la candidata A
- **WHEN** Ana marca A como `done`
- **THEN** el documento de la decisión SHALL tener `source` `llm`

#### Scenario: Decisión sobre el relleno

- **GIVEN** una elección `ready` de Ana sin la candidata D, que aparece como relleno
- **WHEN** Ana marca D como `snoozed`
- **THEN** el documento de la decisión SHALL tener `source` `rules`

#### Scenario: Decisión anterior sin atribución

- **GIVEN** un documento de `weekly_plan_decisions` sin `source`
- **WHEN** Ana pide el plan
- **THEN** la decisión SHALL ocultar la candidata como antes y la respuesta SHALL ser `200`
