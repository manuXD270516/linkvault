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
`success`. Para toda tarea `personal` cuyo golden set traiga anotaciones de redacción, el reporte SHALL incluir además tres
métricas de redacción:

- `redaction_skill_loss`, **bloqueante** y mejor cuanto más cerca de 0: proporción de los **términos anotados en `skills`**
  del caso cuyo texto deja de aparecer en el input redactado (sobre-redacción, la que hace perder señal de encaje). Esos
  términos NO SHALL limitarse a habilidades y tecnologías: SHALL incluir también los **topónimos** y los **nombres de
  empleador** que el análisis necesita, porque la sobre-redacción del nombre propio se lleva por delante exactamente eso y
  de otro modo no se mediría. La métrica conserva su nombre, que ya está en la línea base, y cuenta todo lo anotado.
- `pii_leak_rate`, **bloqueante** y con suelo duro en 0: sobre las anotaciones de PII del caso **que no llevan la marca
  `knownGap`**, la proporción que sigue apareciendo literalmente en el input redactado (falso negativo del redactor, el
  que hace salir un dato personal que el detector debería haber capturado). Las anotaciones marcadas `knownGap` NO SHALL
  entrar ni en su numerador ni en su denominador, de modo que un hueco conocido y aceptado NO SHALL hacer que esta métrica
  sea distinta de 0.
- `pii_known_gap_rate`, **informativa**: sobre **todas** las anotaciones de PII del caso, la proporción marcada
  `knownGap` que sigue apareciendo literalmente en el input redactado. Mide cuánta de la PII anotada sale por un hueco
  que se aceptó a sabiendas; bajar a 0 significa que el hueco se cerró y que su marca puede retirarse.

Las tres SHALL calcularse aplicando la redacción como si el proveedor fuera `external`, con independencia del proveedor con el
que se ejecute la evaluación, sin contactar a ningún proveedor para obtenerlas y contando también los casos degradados. Para
una tarea que redacta el nombre propio SHALL calcularse además **con `redactName` activado** y con el nombre que el caso
declara: es el estado de fábrica, y medirlas con el interruptor apagado mediría una configuración que casi nadie tiene. Las
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

#### Scenario: Sobre-redacción del apellido que también es una ciudad

- **GIVEN** un caso del golden de `match-cv` con el nombre declarado `Ana Paz Flores` y con `La Paz` y `Constructora Flores S.R.L.` anotados en `skills`, y un detector de nombre que sustituye `Paz` y `Flores` dentro de esos dos textos
- **WHEN** se calculan las métricas de redacción con `redactName` activado
- **THEN** `redaction_skill_loss` SHALL valer 1 para ese caso
- **AND** el reporte SHALL nombrar el `id` del caso sin incluir su texto

#### Scenario: El detector preciso no pierde la ciudad ni el empleador

- **GIVEN** el mismo caso y un detector de nombre que respeta los topónimos y los nombres de organización
- **WHEN** se calculan las métricas de redacción con `redactName` activado
- **THEN** `redaction_skill_loss` SHALL valer 0 para ese caso
- **AND** `pii_leak_rate` SHALL valer 0, porque el nombre completo del encabezado sí se sustituyó

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

### Requirement: Evaluación contra proveedores reales

Con `--provider=ollama` o `--provider=openrouter`, el corredor SHALL usar la configuración de entorno del proveedor, con URL y
timeout sobrescribibles por argumento, y SHALL indicar en el reporte el proveedor, el modelo y la versión de prompt. Un proveedor externo SHALL recibir el input redactado según las reglas de
protección de datos.

#### Scenario: Evaluación contra Ollama

- **GIVEN** Ollama con el modelo configurado disponible
- **WHEN** se ejecuta `nx run ai:eval --task=classify-skills --provider=ollama`
- **THEN** el reporte SHALL indicar `ollama`, el modelo y `v1`, con las métricas de los casos

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

La lista `skills` SHALL entenderse como **todo término que la redacción no debe ocultar**, no solo habilidades: entran en
ella los topónimos de la ubicación y los nombres de empleador, que es lo que la sobre-redacción del nombre propio destruye.

Un caso que anote PII de `type` `name` SHALL declarar además el **nombre que el contexto de redacción usa**, sin el cual la
redacción de nombre no puede aplicarse y la métrica mediría cero por construcción; el corredor SHALL rechazarlo con código 2
nombrando la línea y el `id`, nunca el nombre.

Y el golden de una tarea que redacta el nombre propio SHALL incluir **al menos un caso de colisión de nombre**, etiquetado
`name-collision` en `tags`, en el que un apellido de la persona coincida con un **topónimo** y otro con el nombre de una
**empresa**, con esos dos textos anotados en `skills` y con el nombre completo anotado en `pii` con `type: name`. El
corredor SHALL terminar con código 2, antes de ejecutar ningún caso, si el golden de esa tarea no trae ninguno, nombrando la
tarea y la etiqueta que falta. Sin ese caso, `redaction_skill_loss` seguiría mirando solo habilidades y la sobre-redacción
del nombre —la que le ocurre a todo el mundo, porque el interruptor nace activado— sería **invisible**: el daño no aparece
en ninguna métrica, el informe sale igual y solo se nota en que encaja peor.

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

#### Scenario: Golden sin caso de colisión de nombre

- **GIVEN** el golden de `match-cv` sin ningún caso etiquetado `name-collision`
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** SHALL terminar con código 2 antes de ejecutar ningún caso, nombrando la tarea y la etiqueta que falta

#### Scenario: Caso de colisión de nombre completo

- **GIVEN** un caso etiquetado `name-collision` con el nombre declarado `Ana Paz Flores`, con `La Paz` y `Constructora Flores S.R.L.` en `skills` y con el nombre completo en `pii` con `type: name`
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** el caso SHALL aceptarse y entrar en las medias de `redaction_skill_loss` y de `pii_leak_rate`

#### Scenario: Anotación de nombre sin el nombre declarado

- **GIVEN** un caso con una anotación `pii` de `type: name` y sin el nombre que el contexto de redacción usa
- **WHEN** se ejecuta el corredor
- **THEN** SHALL terminar con código 2 nombrando la línea y el `id`
- **AND** el mensaje NO SHALL contener el nombre

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

### Requirement: Calidad del bucle de encaje

El eval de `match-cv` SHALL poder medir la correlación entre el `score` del informe y etiquetas humanas de 1 a 5, y el coste por vuelta del bucle de juez. Una vuelta de más SHALL verse en el reporte como coste, no solo como latencia. El reporte con el proveedor mock SHALL seguir siendo el que corre en CI.

#### Scenario: El coste de la segunda vuelta se ve

- **GIVEN** un caso del golden que usa dos vueltas de juez
- **WHEN** se corre el eval
- **THEN** el reporte SHALL distinguir el coste de cada vuelta

#### Scenario: CI no llama a un proveedor de pago

- **WHEN** el eval corre en CI
- **THEN** SHALL usar el mock en replay
- **AND** NO SHALL requerir una clave de proveedor externo
