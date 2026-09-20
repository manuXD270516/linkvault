## MODIFIED Requirements

### Requirement: Métricas

El reporte SHALL incluir, para toda tarea: `schema_validity_rate` (casos con resultado `success` sobre casos ejecutados),
`degraded_rate`, `latency_p50` en milisegundos y `cost_per_run` (coste estimado medio por caso), además de las métricas propias
de la tarea. `schema_validity_rate`, `degraded_rate` y las métricas propias SHALL ser bloqueantes; `latency_p50` y
`cost_per_run` SHALL ser informativas. Para `classify-skills`, `skills_recall` y `skills_precision` SHALL compararse por nombre
de skill normalizado (minúsculas, espacios colapsados, sin puntuación final) y agregarse como media de los casos con resultado
`success`. Para toda tarea `personal` cuyo golden set traiga anotaciones de redacción, el reporte SHALL incluir además dos
métricas de redacción, ambas bloqueantes y ambas mejores cuanto más cerca de 0:

- `redaction_skill_loss`: proporción de las skills anotadas del caso cuyo texto deja de aparecer en el input redactado
  (sobre-redacción, la que hace perder señal de encaje).
- `pii_leak_rate`: proporción de los valores de PII anotados del caso que siguen apareciendo literalmente en el input
  redactado (falso negativo del redactor, el que hace salir un dato personal).

Las dos SHALL calcularse aplicando la redacción como si el proveedor fuera `external`, con independencia del proveedor con el
que se ejecute la evaluación, sin contactar a ningún proveedor para obtenerlas y contando también los casos degradados. Las
dos SHALL agregarse como media de los casos anotados, y el reporte SHALL nombrar los `id` de los casos en que cada una es
distinta de 0, sin incluir el valor de PII ni el texto del CV.

#### Scenario: Caso degradado

- **GIVEN** una evaluación en la que 1 de 5 casos termina degradado
- **WHEN** se calculan las métricas
- **THEN** `degraded_rate` SHALL valer 0.2 y `schema_validity_rate` SHALL valer 0.8

#### Scenario: Recall y precision de classify-skills

- **GIVEN** un caso con skills esperadas `TypeScript`, `NestJS` y `Docker`, y una salida con `typescript`, `NestJS` y `Kafka`
- **WHEN** se calculan las métricas del caso
- **THEN** `skills_recall` SHALL valer 2/3 y `skills_precision` SHALL valer 2/3

#### Scenario: Sobre-redacción de una skill

- **GIVEN** un caso del golden de `match-cv` con las skills anotadas `C/C++` y `Python`, donde el detector de dirección se lleva `C/C++` por empezar con un indicador de vía
- **WHEN** se calculan las métricas de redacción
- **THEN** `redaction_skill_loss` SHALL valer 0.5 para ese caso
- **AND** el reporte SHALL nombrar el `id` del caso sin incluir su texto

#### Scenario: PII anotada que sobrevive a la redacción

- **GIVEN** un caso con cuatro valores de PII anotados —email, teléfono, dirección y documento— de los que el documento sigue apareciendo literal en el input redactado
- **WHEN** se calculan las métricas de redacción
- **THEN** `pii_leak_rate` SHALL valer 0.25 para ese caso
- **AND** el reporte SHALL nombrar el `id` del caso y el tipo `id`, nunca el valor

### Requirement: Línea base estricta en replay

Cada tarea evaluable SHALL tener una línea base versionada con la versión de prompt, el hash del golden set (calculado sobre
sus casos parseados, independiente de los finales de línea) y los valores de sus métricas bloqueantes en replay, incluidas
`redaction_skill_loss` y `pii_leak_rate` cuando la tarea las tenga. Con
`--provider=mock`, el corredor SHALL terminar con código 1 si no existe la línea base, si alguna métrica bloqueante difiere de
ella (empeore o mejore, con mensajes distintos que nombran la métrica, ambos valores y el comando para actualizar), si
`schema_validity_rate` es menor que 1, si `pii_leak_rate` es mayor que 0, o si la versión de prompt o el hash del golden no
coinciden; en todos los casos el
mensaje SHALL incluir el comando `--update-baseline`. Con
`--update-baseline` SHALL reescribir la línea base con el resultado actual y terminar con código 0, salvo que `pii_leak_rate`
sea mayor que 0: una fuga de PII anotada NO SHALL poder fijarse como línea base y SHALL fallar también con `--update-baseline`.
`redaction_skill_loss` sí SHALL poder actualizarse a propósito, como cualquier otra métrica bloqueante. Con proveedores reales
NO SHALL compararse ni modificarse la línea base.

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

#### Scenario: Empeora la sobre-redacción en CI

- **GIVEN** una línea base de `match-cv` con `redaction_skill_loss` 0.05 y un detector nuevo que la sube a 0.2
- **WHEN** CI ejecuta la evaluación en replay
- **THEN** SHALL terminar con código 1 nombrando `redaction_skill_loss`, `0.2`, `0.05` y el comando `--update-baseline`
- **AND** la comprobación de CI SHALL quedar en rojo hasta que se corrija el detector o se actualice la línea base a propósito

#### Scenario: Fuga de PII con la línea base a la fuerza

- **GIVEN** un resultado en replay con `pii_leak_rate` 0.1
- **WHEN** se ejecuta el corredor con `--provider=mock --update-baseline`
- **THEN** SHALL terminar con código 1 nombrando `pii_leak_rate` y los `id` de los casos con fuga
- **AND** la línea base NO SHALL reescribirse

## ADDED Requirements

### Requirement: Anotaciones de redacción en el golden de CVs

El golden set de una tarea `personal` que trate CVs SHALL contener únicamente CVs anonimizados, con valores de PII
inventados, y cada uno de sus casos SHALL llevar la etiqueta `anonymized` en `tags`. Un caso SHALL poder traer además `pii`
(lista de valores presentes en su `input`, cada uno con su `type`: `email`, `phone`, `url`, `name`, `address` o `id`) y
`skills` (lista de términos que la redacción no debe ocultar). El corredor SHALL rechazar con código 2, antes de ejecutar
ningún caso, un caso de esa tarea sin la etiqueta `anonymized` y un caso cuyo valor anotado en `pii` o en `skills` no
aparezca literalmente en su `input`, nombrando en ambos casos la línea y el `id`; al nombrar una anotación incoherente SHALL
indicar su `type` y su posición en la lista, nunca el valor.

#### Scenario: Golden de CVs con anotaciones

- **GIVEN** el golden set de `match-cv` con casos etiquetados `anonymized` y con `pii` y `skills` anotados
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** el reporte SHALL incluir `redaction_skill_loss` y `pii_leak_rate`

#### Scenario: Caso sin la etiqueta de anonimizado

- **GIVEN** un caso del golden de `match-cv` sin `anonymized` en `tags`
- **WHEN** se ejecuta el corredor
- **THEN** SHALL terminar con código 2 antes de ejecutar ningún caso, nombrando la línea y el `id`

#### Scenario: Anotación que no aparece en el input

- **GIVEN** un caso con un valor en `pii` que no está en su `input`
- **WHEN** se ejecuta el corredor
- **THEN** SHALL terminar con código 2 nombrando la línea, el `id`, el `type` y la posición de la anotación
- **AND** el mensaje NO SHALL contener el valor anotado
