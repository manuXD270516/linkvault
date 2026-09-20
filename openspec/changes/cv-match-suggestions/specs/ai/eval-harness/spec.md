## MODIFIED Requirements

### Requirement: Métricas

El reporte SHALL incluir, para toda tarea: `schema_validity_rate` (casos con resultado `success` sobre casos ejecutados),
`degraded_rate`, `latency_p50` en milisegundos y `cost_per_run` (coste estimado medio por caso), además de las métricas propias
de la tarea. `schema_validity_rate`, `degraded_rate` y las métricas propias SHALL ser bloqueantes; `latency_p50` y
`cost_per_run` SHALL ser informativas. Para `classify-skills`, `skills_recall` y `skills_precision` SHALL compararse por nombre
de skill normalizado (minúsculas, espacios colapsados, sin puntuación final) y agregarse como media de los casos con resultado
`success`. Para toda tarea `personal` cuyo golden set traiga anotaciones de redacción, el reporte SHALL incluir además tres
métricas de redacción:

- `redaction_skill_loss`, **bloqueante** y mejor cuanto más cerca de 0: proporción de las skills anotadas del caso cuyo
  texto deja de aparecer en el input redactado (sobre-redacción, la que hace perder señal de encaje).
- `pii_leak_rate`, **bloqueante** y con suelo duro en 0: sobre las anotaciones de PII del caso **que no llevan la marca
  `knownGap`**, la proporción que sigue apareciendo literalmente en el input redactado (falso negativo del redactor, el
  que hace salir un dato personal que el detector debería haber capturado). Las anotaciones marcadas `knownGap` NO SHALL
  entrar ni en su numerador ni en su denominador, de modo que un hueco conocido y aceptado NO SHALL hacer que esta métrica
  sea distinta de 0.
- `pii_known_gap_rate`, **informativa**: sobre **todas** las anotaciones de PII del caso, la proporción marcada
  `knownGap` que sigue apareciendo literalmente en el input redactado. Mide cuánta de la PII anotada sale por un hueco
  que se aceptó a sabiendas; bajar a 0 significa que el hueco se cerró y que su marca puede retirarse.

Las tres SHALL calcularse aplicando la redacción como si el proveedor fuera `external`, con independencia del proveedor con el
que se ejecute la evaluación, sin contactar a ningún proveedor para obtenerlas y contando también los casos degradados. Las
tres SHALL agregarse como media de los casos anotados, y un caso sin anotaciones computables para una métrica NO SHALL entrar
en su media. El reporte SHALL nombrar los `id` de los casos en que cada una es distinta de 0, sin incluir el valor de PII ni
el texto del CV, y junto a `pii_known_gap_rate` SHALL listar los identificadores de los huecos conocidos observados con el
`id` de su caso.

#### Scenario: Caso degradado

- **GIVEN** una evaluación en la que 1 de 5 casos termina degradado
- **WHEN** se calculan las métricas
- **THEN** `degraded_rate` SHALL valer 0.2 y `schema_validity_rate` SHALL valer 0.8

#### Scenario: Recall y precision de classify-skills

- **GIVEN** un caso con skills esperadas `TypeScript`, `NestJS` y `Docker`, y una salida con `typescript`, `NestJS` y `Kafka`
- **WHEN** se calculan las métricas del caso
- **THEN** `skills_recall` SHALL valer 2/3 y `skills_precision` SHALL valer 2/3

#### Scenario: Sobre-redacción de una skill

- **GIVEN** un caso del golden de `match-cv` con dos skills anotadas, de las que una deja de aparecer en el input redactado
- **WHEN** se calculan las métricas de redacción
- **THEN** `redaction_skill_loss` SHALL valer 0.5 para ese caso
- **AND** el reporte SHALL nombrar el `id` del caso sin incluir su texto

#### Scenario: Un lenguaje con símbolos no es sobre-redacción esperada

- **GIVEN** un caso del golden de `match-cv` con las skills anotadas `C#`, `C/C++`, `F#` y `.NET`
- **WHEN** se calculan las métricas de redacción
- **THEN** `redaction_skill_loss` SHALL valer 0 para ese caso
- **AND** el reporte NO SHALL nombrar ese caso entre los de pérdida de skills

#### Scenario: PII anotada que sobrevive a la redacción

- **GIVEN** un caso con cuatro valores de PII anotados sin marca `knownGap` —email, teléfono, dirección y documento— de los que el documento sigue apareciendo literal en el input redactado
- **WHEN** se calculan las métricas de redacción
- **THEN** `pii_leak_rate` SHALL valer 0.25 para ese caso
- **AND** el reporte SHALL nombrar el `id` del caso y el tipo `id`, nunca el valor

#### Scenario: Hueco conocido anotado que no rompe el suelo duro

- **GIVEN** un caso con cuatro valores de PII anotados, de los que el documento es un CI escrito desnudo marcado `knownGap` con su identificador, y los otros tres se redactan
- **WHEN** se calculan las métricas de redacción
- **THEN** `pii_leak_rate` SHALL valer 0 para ese caso, porque su denominador son los tres valores sin marca
- **AND** `pii_known_gap_rate` SHALL valer 0.25
- **AND** el reporte SHALL listar el identificador del hueco junto al `id` del caso, nunca el valor

#### Scenario: Hueco conocido que deja de filtrarse

- **GIVEN** un caso con un único valor marcado `knownGap` y un detector nuevo que ya lo captura
- **WHEN** se calculan las métricas de redacción
- **THEN** `pii_known_gap_rate` SHALL valer 0 para ese caso
- **AND** el reporte SHALL señalar que ese hueco conocido ya no se observa

### Requirement: Línea base estricta en replay

Cada tarea evaluable SHALL tener una línea base versionada con la versión de prompt, el hash del golden set (calculado sobre
sus casos parseados, independiente de los finales de línea) y los valores de sus métricas bloqueantes en replay, incluidas
`redaction_skill_loss` y `pii_leak_rate` cuando la tarea las tenga. `pii_known_gap_rate` es informativa y NO SHALL entrar en
la línea base: un hueco conocido se gobierna por su declaración, no por un número que se pueda actualizar. Con
`--provider=mock`, el corredor SHALL terminar con código 1 si no existe la línea base, si alguna métrica bloqueante difiere de
ella (empeore o mejore, con mensajes distintos que nombran la métrica, ambos valores y el comando para actualizar), si
`schema_validity_rate` es menor que 1, si `pii_leak_rate` es mayor que 0, o si la versión de prompt o el hash del golden no
coinciden; en todos los casos el
mensaje SHALL incluir el comando `--update-baseline`. Con
`--update-baseline` SHALL reescribir la línea base con el resultado actual y terminar con código 0, salvo que `pii_leak_rate`
sea mayor que 0: una fuga de PII anotada que el detector debería capturar NO SHALL poder fijarse como línea base y SHALL
fallar también con `--update-baseline`. `--update-baseline` NO SHALL crear ni ampliar la declaración de huecos conocidos, de
modo que la única manera de sacar una fuga del suelo duro SHALL ser una decisión humana registrada en esa declaración.
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

#### Scenario: El golden con un hueco conocido deja el CI verde

- **GIVEN** el golden de `match-cv` con un CI escrito desnudo anotado como PII y marcado `knownGap` con un identificador declarado, y la línea base al día
- **WHEN** CI ejecuta la evaluación en replay
- **THEN** `pii_leak_rate` SHALL valer 0 y el corredor SHALL terminar con código 0
- **AND** el reporte SHALL seguir mostrando `pii_known_gap_rate` distinto de 0 con el identificador del hueco

## ADDED Requirements

### Requirement: Anotaciones de redacción en el golden de CVs

El golden set de una tarea `personal` que trate CVs SHALL contener únicamente CVs anonimizados, con valores de PII
inventados, y cada uno de sus casos SHALL llevar la etiqueta `anonymized` en `tags`. Un caso SHALL poder traer además `pii`
(lista de valores presentes en su `input`, cada uno con su `type`: `email`, `phone`, `url`, `name`, `address` o `id`, y
opcionalmente la marca `knownGap` con el identificador del hueco conocido que lo deja escapar) y
`skills` (lista de términos que la redacción no debe ocultar). El corredor SHALL rechazar con código 2, antes de ejecutar
ningún caso, un caso de esa tarea sin la etiqueta `anonymized`, un caso cuyo valor anotado en `pii` o en `skills` no
aparezca literalmente en su `input`, y un caso cuya marca `knownGap` use un identificador que no esté en la declaración de
huecos conocidos de la tarea, nombrando en todos los casos la línea y el `id`; al nombrar una anotación incoherente SHALL
indicar su `type` y su posición en la lista, nunca el valor.

#### Scenario: Golden de CVs con anotaciones

- **GIVEN** el golden set de `match-cv` con casos etiquetados `anonymized` y con `pii` y `skills` anotados
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** el reporte SHALL incluir `redaction_skill_loss`, `pii_leak_rate` y `pii_known_gap_rate`

#### Scenario: Caso sin la etiqueta de anonimizado

- **GIVEN** un caso del golden de `match-cv` sin `anonymized` en `tags`
- **WHEN** se ejecuta el corredor
- **THEN** SHALL terminar con código 2 antes de ejecutar ningún caso, nombrando la línea y el `id`

#### Scenario: Anotación que no aparece en el input

- **GIVEN** un caso con un valor en `pii` que no está en su `input`
- **WHEN** se ejecuta el corredor
- **THEN** SHALL terminar con código 2 nombrando la línea, el `id`, el `type` y la posición de la anotación
- **AND** el mensaje NO SHALL contener el valor anotado

#### Scenario: Marca de hueco conocido sin declarar

- **GIVEN** un caso con `knownGap` cuyo identificador no está en la declaración de huecos conocidos de la tarea
- **WHEN** se ejecuta el corredor
- **THEN** SHALL terminar con código 2 antes de ejecutar ningún caso, nombrando la línea, el `id` y el identificador
- **AND** el mensaje NO SHALL contener el valor anotado

### Requirement: Huecos conocidos de redacción declarados fuera del golden

Los huecos conocidos y aceptados del redactor SHALL declararse fuera del golden set, junto a la línea base de la tarea
(`libs/ai/src/evals/<task>/known-gaps.json`), con una entrada por identificador que lleve el `type` de PII afectado, el
motivo por el que se acepta y la referencia a la decisión humana que lo aceptó (el ADR o el change donde se debatió). Una
entrada sin motivo o sin referencia SHALL hacer que el corredor termine con código 2 nombrando el identificador. Añadir un
identificador nuevo SHALL ser, por tanto, un cambio de archivo revisable y no un efecto de ejecutar el corredor: ningún
argumento del corredor, incluido `--update-baseline`, SHALL crear, ampliar ni modificar esa declaración. Un identificador
declarado que ningún caso del golden usa SHALL reportarse como retirable, sin hacer fallar la evaluación.

#### Scenario: Hueco conocido sin decisión que lo respalde

- **GIVEN** una declaración con un identificador sin motivo ni referencia a la decisión que lo aceptó
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** SHALL terminar con código 2 nombrando el identificador y lo que le falta

#### Scenario: El corredor no puede silenciar una fuga por su cuenta

- **GIVEN** un caso con una fuga de PII anotada sin marca `knownGap`
- **WHEN** se ejecuta el corredor con `--provider=mock --update-baseline`
- **THEN** SHALL terminar con código 1 por `pii_leak_rate`
- **AND** la declaración de huecos conocidos NO SHALL modificarse

#### Scenario: Hueco declarado que ya no usa ningún caso

- **GIVEN** una declaración con un identificador que ningún caso del golden marca
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** el reporte SHALL indicar que ese identificador puede retirarse
- **AND** el corredor SHALL terminar con código 0 si no hay ningún otro problema

### Requirement: Fixtures de una tarea con datos personales

Grabar fixtures de una tarea `personal` contra un upstream que no sea el mock determinista SHALL rechazarse con código 2,
antes de contactar a ningún proveedor, nombrando la tarea y su sensibilidad: el grabador **reponía** en el fixture los
valores redactados, de modo que grabar un CV real contra un proveedor real habría dejado nombres, direcciones y documentos
en el directorio de fixtures. La regla normativa sobre qué origen puede tener un fixture y qué se escribe en él vive en la
capacidad del mock determinista; aquí se exige solo el rechazo del corredor, para que las dos no puedan divergir.
Además, lo que se escriba a disco para una tarea `personal` SHALL estar redactado: antes de escribir
un fixture de una tarea `personal`, el corredor SHALL aplicarle la redacción de proveedor externo y, si la redacción cambia
algo, NO SHALL escribir el fixture y SHALL terminar con código 1 nombrando el `id` del caso y el `type` de lo que habría
quedado en disco, nunca el valor. Esta comprobación SHALL aplicarse también con `--overwrite`.

#### Scenario: Grabar una tarea personal contra un proveedor real

- **GIVEN** la tarea `match-cv`, declarada `personal`
- **WHEN** se ejecuta el comando de grabación con un upstream distinto del mock, con o sin `--allow-external`
- **THEN** SHALL terminar con código 2 nombrando la tarea y su sensibilidad
- **AND** ningún proveedor SHALL recibir petición

#### Scenario: Fixture de una tarea personal con PII dentro

- **GIVEN** una grabación de `match-cv` cuya salida trae en `suggestions[0].after` un valor que la redacción de proveedor externo sustituiría
- **WHEN** el corredor va a escribir el fixture
- **THEN** el fixture NO SHALL escribirse
- **AND** SHALL terminar con código 1 nombrando el `id` del caso y el `type`, nunca el valor

#### Scenario: Fixture de una tarea personal ya limpio

- **GIVEN** una grabación de `match-cv` contra el mock cuya salida no contiene nada que la redacción de proveedor externo sustituiría
- **WHEN** el corredor escribe el fixture
- **THEN** el fixture SHALL escribirse tal cual y el comando SHALL terminar con código 0
