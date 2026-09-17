# ai/eval-harness Specification

## Purpose

Permite medir de forma reproducible la calidad, el coste y la latencia de cada tarea de IA contra un conjunto de casos
esperados versionado, comparar proveedores y versiones de prompt, y detectar en CI cualquier cambio de comportamiento del
pipeline de IA.

## Requirements

### Requirement: Tareas evaluables

Cada tarea evaluable SHALL registrarse con su tarea de IA, un schema del campo `expected` de sus casos y sus métricas propias,
calculadas sobre el conjunto completo de resultados. El registro y los golden sets SHALL ser coherentes: toda tarea registrada
SHALL tener golden set y todo golden set SHALL corresponder a una tarea registrada.

#### Scenario: Coherencia entre registro y golden sets

- **WHEN** se comparan las tareas registradas con los directorios de `libs/ai/src/evals` que contienen `golden.jsonl`
- **THEN** ambos conjuntos SHALL ser iguales

#### Scenario: Tarea desconocida

- **WHEN** se ejecuta el corredor con `--task=no-existe`
- **THEN** SHALL terminar con código 2 nombrando la tarea y las tareas evaluables

### Requirement: Golden set por tarea

Cada tarea evaluable SHALL tener un golden set en `libs/ai/src/evals/<task>/golden.jsonl`, un caso por línea con `id` único,
`input` válido contra el schema de entrada de la tarea, `expected` válido contra el schema de la tarea evaluable, `tags` y
`outputLanguage` opcional. Dos casos NO SHALL producir la misma clave de ejecución. El corredor SHALL rechazar un golden set
inválido antes de ejecutar ningún caso, con código 2, nombrando la línea y el `id`.

#### Scenario: Golden set válido

- **GIVEN** el golden set de `classify-skills`
- **WHEN** se valida
- **THEN** SHALL contener al menos 5 casos válidos con `id` únicos y claves de ejecución distintas

#### Scenario: Caso con input inválido

- **GIVEN** un golden set con una línea cuyo `input` no cumple el schema de la tarea
- **WHEN** se ejecuta el corredor
- **THEN** SHALL terminar con código 2 antes de ejecutar ningún caso, nombrando la línea y el `id`

#### Scenario: Casos con la misma clave de ejecución

- **GIVEN** dos casos con el mismo `input` y el mismo idioma de salida
- **WHEN** se ejecuta el corredor
- **THEN** SHALL terminar con código 2 nombrando ambos `id`

### Requirement: Corredor de evaluación

El sistema SHALL ofrecer `nx run ai:eval` con `--task=<task>` o `--all` (todas las tareas evaluables) y
`--provider=<mock|ollama|openrouter>`, que ejecute cada caso con `runTask` usando solo ese proveedor (el mock en replay), en
secuencia y en el orden del archivo, sin caché, y escriba un reporte Markdown en `reports/eval/<task>/<proveedor>.md` con
proveedor, modelo, versión de prompt, métricas y una fila por caso, sin incluir inputs ni salidas completas. Si el golden set
está etiquetado `placeholder`, el reporte SHALL advertir que no representa calidad real. Un caso degradado o con fallo de
proveedor SHALL contarse sin detener la evaluación; un error de programación SHALL detenerla con código 3. Un proveedor
externo SHALL exigir `--allow-external` y, sin él, el comando SHALL terminar con código 2 sin contactar a ningún proveedor.

#### Scenario: Evaluación en replay

- **GIVEN** fixtures de replay para todos los casos del golden set de `classify-skills`
- **WHEN** se ejecuta `nx run ai:eval --task=classify-skills --provider=mock`
- **THEN** SHALL escribirse el reporte con una fila por caso, las métricas y la advertencia de golden placeholder
- **AND** ningún proveedor real SHALL recibir petición

#### Scenario: Fixture ausente en replay

- **GIVEN** un caso del golden set sin fixture de replay
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** SHALL terminar con código 3 nombrando el `id` del caso y la clave del fixture ausente

#### Scenario: Proveedor externo sin permiso explícito

- **WHEN** se ejecuta el corredor con `--provider=openrouter` sin `--allow-external`
- **THEN** SHALL terminar con código 2 sin contactar a ningún proveedor

#### Scenario: Proveedor real no disponible

- **GIVEN** la URL de Ollama sin servidor escuchando
- **WHEN** se ejecuta el corredor con `--provider=ollama`
- **THEN** los casos SHALL contarse como degradados, el reporte SHALL generarse y el comando SHALL terminar con código 0

### Requirement: Métricas

El reporte SHALL incluir, para toda tarea: `schema_validity_rate` (casos con resultado `success` sobre casos ejecutados),
`degraded_rate`, `latency_p50` en milisegundos y `cost_per_run` (coste estimado medio por caso), además de las métricas propias
de la tarea. `schema_validity_rate`, `degraded_rate` y las métricas propias SHALL ser bloqueantes; `latency_p50` y
`cost_per_run` SHALL ser informativas. Para `classify-skills`, `skills_recall` y `skills_precision` SHALL compararse por nombre
de skill normalizado (minúsculas, espacios colapsados, sin puntuación final) y agregarse como media de los casos con resultado
`success`.

#### Scenario: Caso degradado

- **GIVEN** una evaluación en la que 1 de 5 casos termina degradado
- **WHEN** se calculan las métricas
- **THEN** `degraded_rate` SHALL valer 0.2 y `schema_validity_rate` SHALL valer 0.8

#### Scenario: Recall y precision de classify-skills

- **GIVEN** un caso con skills esperadas `TypeScript`, `NestJS` y `Docker`, y una salida con `typescript`, `NestJS` y `Kafka`
- **WHEN** se calculan las métricas del caso
- **THEN** `skills_recall` SHALL valer 2/3 y `skills_precision` SHALL valer 2/3

### Requirement: Línea base estricta en replay

Cada tarea evaluable SHALL tener una línea base versionada con la versión de prompt, el hash del golden set (calculado sobre
sus casos parseados, independiente de los finales de línea) y los valores de sus métricas bloqueantes en replay. Con
`--provider=mock`, el corredor SHALL terminar con código 1 si no existe la línea base, si alguna métrica bloqueante difiere de
ella (empeore o mejore, con mensajes distintos que nombran la métrica, ambos valores y el comando para actualizar), si
`schema_validity_rate` es menor que 1, o si la versión de prompt o el hash del golden no coinciden; en todos los casos el
mensaje SHALL incluir el comando `--update-baseline`. Con
`--update-baseline` SHALL reescribir la línea base con el resultado actual y terminar con código 0. Con proveedores reales NO
SHALL compararse ni modificarse la línea base.

#### Scenario: Sin regresión

- **GIVEN** una línea base igual al resultado actual en replay
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** SHALL terminar con código 0

#### Scenario: Regresión de recall

- **GIVEN** una línea base con `skills_recall` 1 y un fixture modificado que pierde una skill
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** SHALL terminar con código 1 nombrando `skills_recall`, el valor actual y el de la línea base

#### Scenario: Mejora sin actualizar la línea base

- **GIVEN** una línea base con `skills_recall` menor que el resultado actual en replay
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** SHALL terminar con código 1 indicando que la métrica mejoró y que debe ejecutarse `--update-baseline`

#### Scenario: Línea base ausente

- **GIVEN** una tarea evaluable sin línea base
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** SHALL terminar con código 1 indicando el comando `--update-baseline`

#### Scenario: Golden set modificado

- **GIVEN** una línea base calculada con otra versión del golden set
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** SHALL terminar con código 1 indicando que el golden cambió

#### Scenario: Actualización consciente de la línea base

- **WHEN** se ejecuta el corredor con `--provider=mock --update-baseline`
- **THEN** la línea base SHALL reescribirse con el resultado actual y el comando SHALL terminar con código 0

### Requirement: Evaluación contra proveedores reales

Con `--provider=ollama` o `--provider=openrouter`, el corredor SHALL usar la configuración de entorno del proveedor, con URL y
timeout sobrescribibles por argumento, y SHALL indicar en el reporte el proveedor, el modelo y la versión de prompt. Un proveedor externo SHALL recibir el input redactado según las reglas de
protección de datos.

#### Scenario: Evaluación contra Ollama

- **GIVEN** Ollama con el modelo configurado disponible
- **WHEN** se ejecuta `nx run ai:eval --task=classify-skills --provider=ollama`
- **THEN** el reporte SHALL indicar `ollama`, el modelo y `v1`, con las métricas de los casos
