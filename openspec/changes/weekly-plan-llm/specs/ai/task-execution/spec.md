## ADDED Requirements

### Requirement: Schema de salida por petición

Una tarea SHALL poder declarar `outputSchemaFor(input)`, que construye a partir del input ya parseado el schema de
salida de esa ejecución (por ejemplo, un enum cerrado de ids). Si la tarea lo declara, `runTask` SHALL validar con ese
schema, en lugar de `outputSchema`, la respuesta de cada proveedor y la de su reparación, de modo que una salida fuera
del schema de la petición siga el camino de la salida inválida: una reparación con los errores, el siguiente proveedor
y, si se agota la cadena, `degraded`. El schema por petición SHALL ser más estricto o igual que `outputSchema`: una
salida que lo cumpla SHALL cumplir también `outputSchema`. Una tarea que lo declare NO SHALL poder registrarse como
cacheable. Las tareas que no lo declaran SHALL comportarse exactamente igual que antes.

#### Scenario: Id fuera del enum de la petición

- **GIVEN** una tarea con `outputSchemaFor` que admite solo `c1`, `c2` y `c3`, y un proveedor que responde `c7` y,
  tras la reparación, `c2`
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL enviar exactamente una petición de reparación cuyos errores mencionen el campo inválido
- **AND** SHALL devolver la salida con `c2`

#### Scenario: Fuera del enum también tras la reparación

- **GIVEN** un primer proveedor que responde dos veces un id fuera del enum de la petición y un segundo proveedor que
  responde un id válido
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL registrar `schema_error` para el primer proveedor y devolver la salida del segundo

#### Scenario: Tarea sin schema por petición

- **GIVEN** la tarea `classify-skills`, que no declara `outputSchemaFor`
- **WHEN** se ejecuta `runTask` con un fixture válido
- **THEN** el resultado SHALL ser idéntico al anterior a este requirement

#### Scenario: Tarea cacheable con schema por petición

- **GIVEN** una tarea que declara `outputSchemaFor` y `cacheable: true`
- **WHEN** se registra
- **THEN** el registro SHALL fallar con `InvalidTaskRegistration` nombrando la tarea

### Requirement: Selección del plan semanal

El sistema SHALL ejecutar `plan-week` solo vía `runTask`, con `temperature` 0, dos intentos por proveedor y
`cacheable: false`. Entrada (`planWeekInputSchema`): de 4 a `WEEKLY_PLAN_LLM_MAX_CANDIDATES` (9) candidatas con `id`
sintético `c1`…`c9`, únicos y consecutivos desde `c1`, `rule` y `status` de enums cerrados y hechos numéricos enteros
acotados (`daysQuiet`, y opcionales `daysUntilClose`, `fitScore`, `knowSomeoneCount`); objetos estrictos y **ningún
campo de texto libre**. Salida: `{ picks: [{ candidateId }] }` con exactamente 3 elementos; `outputSchemaFor` SHALL
restringir `candidateId` al enum de ids de la petición y exigir que no se repitan. La tarea SHALL declararse
`dataSensitivity: 'public'` porque su entrada, por construcción del schema, no puede contener datos personales; quien la
invoca SHALL exigir igualmente el consentimiento de proveedores externos de la persona antes de llamarla. SHALL tener
`sample` para el modo `synth` (las 3 primeras candidatas en el orden recibido) y NO SHALL tener `degrade`: la
degradación honesta es del llamador. SHALL figurar en `KNOWN_TASK_NAMES`, con prompt `plan-week.v1.md`.

#### Scenario: Entrada con texto libre

- **GIVEN** un input de `plan-week` con un campo `title` en una candidata
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL lanzar el error de validación del input y ningún proveedor SHALL recibir petición

#### Scenario: Ids no consecutivos

- **GIVEN** un input de `plan-week` con candidatas `c1`, `c2`, `c4` y `c5`
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL lanzar el error de validación del input

#### Scenario: Muestra de synth

- **GIVEN** el mock en `synth` sin fixture y un input con candidatas `c1` a `c5`
- **WHEN** se ejecuta `plan-week`
- **THEN** la salida SHALL ser `c1`, `c2` y `c3`, en ese orden

#### Scenario: El schema no admite texto

- **GIVEN** el schema `planWeekInputSchema`
- **WHEN** se recorre su representación JSON Schema
- **THEN** toda propiedad de tipo `string` SHALL ser un enum o el `id` con patrón `^c[1-9]$`
