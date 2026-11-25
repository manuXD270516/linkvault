## Purpose

Plan semanal personal «Tu semana»: como mucho tres acciones para la semana ISO en curso, calculadas al leer a partir de
las postulaciones, la frescura de las ofertas y el conteo de «conozco a alguien», con las decisiones del usuario
guardadas aparte y sin cambiar nunca el estado de una postulación.

## ADDED Requirements

### Requirement: Plan semanal calculado al leer

`GET /api/applications/weekly-plan`, autenticado, SHALL responder `200` con `{ weekKey, planner, actions,
doneThisWeek }` validado por `weeklyPlanResponseSchema` de `libs/shared`. `weekKey` SHALL ser la semana ISO en curso en
UTC con formato `YYYY-Www`; `planner` SHALL ser `rules`; `actions` SHALL tener como mucho 3 elementos. El cálculo SHALL
hacerse en cada lectura, de forma determinista para las mismas postulaciones, señales de links, decisiones y fecha, y
la lectura NO SHALL escribir en ninguna colección. El plan SHALL salir de un puerto `WeeklyPlanner` cuya única
implementación en este change es `RuleBasedPlanner`, sin llamadas a `libs/ai`.

#### Scenario: Tope de tres acciones

- **GIVEN** Ana con cinco postulaciones que cumplen alguna regla
- **WHEN** pide `GET /api/applications/weekly-plan`
- **THEN** la respuesta SHALL ser `200` con exactamente 3 acciones y `planner` `rules`

#### Scenario: Sin nada que hacer

- **GIVEN** Ana con postulaciones que no cumplen ninguna regla
- **WHEN** pide el plan
- **THEN** `actions` SHALL ser una lista vacía y la respuesta SHALL ser `200`

#### Scenario: La lectura no escribe

- **GIVEN** Ana con candidatas
- **WHEN** pide el plan dos veces seguidas con el mismo reloj
- **THEN** las dos respuestas SHALL ser iguales
- **AND** NO SHALL existir ningún documento nuevo en `weekly_plan_decisions`, `applications` ni `application_events`

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
`ask_know_someone` por `count` descendente; desempate por `applicationId` ascendente. La selección SHALL tomar por
turnos la primera candidata visible de cada regla en el orden 1, 2, 3 hasta llegar a 3 o agotarlas. El `candidateId`
SHALL ser `<rule>:<applicationId>`.

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

### Requirement: Privacidad de las acciones

Una acción SHALL contener solo datos del propio usuario y de la oferta: identificadores de su postulación y del link,
`displayUrl`, título, empresa y el motivo. De otros miembros SHALL contener como mucho el **conteo** de quienes marcaron
«conozco a alguien» y el `groupId` de un grupo del que quien pide es miembro. NO SHALL contener userIds, nombres,
notas, comentarios ni estados de otras personas.

#### Scenario: Conteo sin identidades

- **GIVEN** Bob y Carla marcaron «conozco a alguien» en un link que Ana sigue en su grupo
- **WHEN** Ana pide el plan
- **THEN** la acción `ask_know_someone` SHALL tener `count` 2
- **AND** el cuerpo de la respuesta NO SHALL contener el userId ni el `displayName` de Bob ni de Carla

#### Scenario: Conteo del grupo elegido

- **GIVEN** Ana miembro de G1 y G2 con el mismo link en los dos, Bob marcado en G1, Carla y Dan en G2, y Ana en G2
- **WHEN** Ana pide el plan
- **THEN** la acción `ask_know_someone` SHALL tener `count` 2 y `groupId` G2

### Requirement: Decisiones sobre una acción

`POST /api/applications/weekly-plan/decisions`, autenticado, con `{ candidateId, decision }` validado por
`weeklyPlanDecisionRequestSchema` (`decision` ∈ `done`, `dismissed`, `snoozed`), SHALL guardar la decisión en la
colección `weekly_plan_decisions` con clave única `(userId, weekKey, candidateId)` —la última escritura gana— y SHALL
responder `200` con el plan recalculado. El `candidateId` SHALL estar entre las candidatas elegibles de ese momento
(antes del tope y de ocultar); si no, SHALL responder `404` con código `weekly_plan_action_not_found` —registrado en
`apiErrorCodeSchema` de `libs/shared`—, igual para un id inventado, ajeno o que ya no aplica. Un cuerpo inválido SHALL responder `400`. Una decisión NO SHALL modificar
`applications` ni `application_events`. Los documentos SHALL caducar a los 35 días de `decidedAt`.

Al leer, una decisión `snoozed` SHALL ocultar la candidata solo en la semana de la decisión; `done` SHALL ocultarla en
esa semana y en la siguiente; `dismissed` SHALL ocultarla mientras la decisión exista (hasta que caduque). `doneThisWeek` SHALL contar las decisiones `done`
de la semana en curso.

#### Scenario: Hecho oculta y entra la siguiente

- **GIVEN** Ana con cuatro candidatas y la tarjeta mostrando tres
- **WHEN** marca la primera como `done`
- **THEN** la respuesta SHALL ser `200` con tres acciones sin esa candidata, incluida la cuarta
- **AND** `doneThisWeek` SHALL ser 1

#### Scenario: La decisión no toca la postulación

- **GIVEN** una acción `follow_up` de una postulación `applied` con `version` 4
- **WHEN** Ana la marca como `done`
- **THEN** la postulación SHALL seguir `applied` con `version` 4 y el mismo `statusChangedAt`
- **AND** NO SHALL existir un evento nuevo en `application_events`

#### Scenario: La semana que viene

- **GIVEN** Ana marcó `snoozed` una candidata en la semana `2026-W48`
- **WHEN** pide el plan en `2026-W48` y después en `2026-W49` con la candidata aún elegible
- **THEN** en `2026-W48` NO SHALL aparecer y en `2026-W49` SHALL poder aparecer

#### Scenario: Hecho no vuelve el lunes

- **GIVEN** Ana marcó `done` una candidata en `2026-W48`
- **WHEN** pide el plan en `2026-W49` y en `2026-W50` con la candidata aún elegible
- **THEN** en `2026-W49` NO SHALL aparecer y en `2026-W50` SHALL poder aparecer

#### Scenario: Ocultar sugerencia

- **GIVEN** Ana marcó `dismissed` una candidata en `2026-W48`
- **WHEN** pide el plan en `2026-W49`, `2026-W50` y `2026-W52` con la candidata aún elegible
- **THEN** NO SHALL aparecer en ninguna de esas semanas

#### Scenario: Candidata ajena o inventada

- **GIVEN** Bob con una candidata `follow_up:<idDeBob>`
- **WHEN** Ana envía esa `candidateId`, o `follow_up:no-es-un-id`
- **THEN** las dos respuestas SHALL ser `404` con código `weekly_plan_action_not_found`
- **AND** NO SHALL escribirse ningún documento

#### Scenario: Decisión repetida

- **GIVEN** Ana marcó `snoozed` una candidata esta semana
- **WHEN** la marca `done`
- **THEN** SHALL existir un único documento para `(Ana, semana, candidata)` con `decision` `done`
