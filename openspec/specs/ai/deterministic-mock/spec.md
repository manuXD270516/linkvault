# ai/deterministic-mock Specification

## Purpose

Permite desarrollar y probar las tareas de IA sin red ni coste con un proveedor que responde siempre igual ante la misma
ejecución: reproduce respuestas grabadas en CI y sintetiza respuestas creíbles en desarrollo, sin poder usarse en producción.

## Requirements

### Requirement: Clave determinista independiente del texto del prompt

El proveedor mock SHALL identificar cada ejecución por el SHA-256 del JSON canónico de la tupla (nombre de tarea, versión de
prompt, idioma de salida, input validado). El JSON canónico SHALL ordenar las claves de los objetos, omitir valores
indefinidos y conservar el orden de los arrays. La clave NO SHALL depender del texto renderizado del prompt ni del orden de
las claves del input.

#### Scenario: Vector de referencia

- **GIVEN** la tarea `classify-skills`, versión `v1`, idioma `es` y el input `{ "text": "TypeScript y NestJS" }`
- **WHEN** se calcula la clave del mock
- **THEN** SHALL coincidir con el valor de referencia fijado en los tests

#### Scenario: Mismo input con claves en otro orden

- **GIVEN** dos inputs con los mismos valores y distinto orden de claves
- **WHEN** se calcula la clave del mock para la misma tarea, versión e idioma
- **THEN** ambas claves SHALL ser iguales

#### Scenario: Cambio en el texto de la plantilla

- **GIVEN** una tarea y un input
- **WHEN** se modifica el texto de la plantilla del prompt sin cambiar su versión
- **THEN** la clave del mock SHALL seguir siendo la misma

### Requirement: Modo replay

Con `AI_MOCK_MODE=replay` el mock SHALL devolver la respuesta grabada para la clave y, si no existe, SHALL lanzar
`FixtureMissing` con la clave, de modo que el test que lo provoca falle.

#### Scenario: Fixture existente

- **GIVEN** una respuesta grabada para la clave de una ejecución
- **WHEN** el mock recibe esa ejecución en modo replay
- **THEN** SHALL devolver exactamente la respuesta grabada

#### Scenario: Fixture ausente en CI

- **GIVEN** `AI_MOCK_MODE=replay` y ninguna respuesta grabada para la clave
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL lanzarse `FixtureMissing` con la clave
- **AND** NO SHALL devolverse un resultado degradado que oculte el fixture ausente

### Requirement: Modo synth

Con `AI_MOCK_MODE=synth` y sin respuesta grabada, el mock SHALL producir la salida mediante la muestra determinista que
declara la tarea, alimentada con el input y con un generador pseudoaleatorio sembrado con la clave. Si la tarea no declara
muestra, SHALL lanzar `SynthUnsupported` con el nombre de la tarea.

#### Scenario: Mismo input dos veces en modo synth

- **GIVEN** `AI_MOCK_MODE=synth`
- **WHEN** se ejecuta dos veces la misma tarea con el mismo input canónico
- **THEN** ambas salidas SHALL ser idénticas byte a byte

#### Scenario: Salida sintetizada válida y creíble

- **GIVEN** `AI_MOCK_MODE=synth`, la tarea `classify-skills` y un texto que menciona `TypeScript`
- **WHEN** se ejecuta `runTask`
- **THEN** la salida SHALL cumplir el schema de salida de la tarea
- **AND** SHALL incluir una skill `TypeScript`

#### Scenario: Tarea sin muestra

- **GIVEN** `AI_MOCK_MODE=synth` y una tarea sin muestra declarada
- **WHEN** el mock recibe la ejecución
- **THEN** SHALL lanzarse `SynthUnsupported` con el nombre de la tarea

### Requirement: Mock fuera de producción

El mock NO SHALL poder usarse en producción: `mock` en `AI_CHAIN` con `NODE_ENV=production` SHALL impedir el arranque con
un error que nombre `AI_CHAIN` y `mock`. `AI_MOCK_MODE` SHALL exigirse y validarse solo cuando `AI_CHAIN` incluye `mock`, y
SHALL admitir únicamente `replay` y `synth`.

#### Scenario: Arranque en producción con el mock en la cadena

- **GIVEN** `NODE_ENV=production`, `AI_CHAIN=mock` y `AI_MOCK_MODE=synth`
- **WHEN** arranca la aplicación
- **THEN** el arranque SHALL fallar con un error que nombre `AI_CHAIN` y `mock`

#### Scenario: Producción sin mock con AI_MOCK_MODE heredado

- **GIVEN** `NODE_ENV=production`, `AI_CHAIN=ollama` y `AI_MOCK_MODE=synth`
- **WHEN** arranca la aplicación
- **THEN** el arranque NO SHALL fallar por `AI_MOCK_MODE`

#### Scenario: Modo no soportado

- **GIVEN** `AI_CHAIN=mock` y `AI_MOCK_MODE=record`
- **WHEN** arranca la aplicación
- **THEN** el arranque SHALL fallar nombrando `AI_MOCK_MODE`

### Requirement: Grabación de fixtures con un proveedor real

El sistema SHALL ofrecer `nx run ai:record-fixtures --task=<task> --upstream=<ollama|openrouter|mock>`, fuera de las aplicaciones y
de los tests, que ejecute la tarea con `runTask` contra el proveedor real para cada caso del golden set de la tarea y guarde
como fixture de replay, bajo la clave determinista de la ejecución, únicamente las salidas con resultado `success`. El fixture
SHALL identificar su origen con el proveedor y el modelo. Una tarea `personal` SHALL poder grabarse **únicamente contra el mock
determinista**: con cualquier otro upstream, y con `--allow-external` o sin él, el comando SHALL terminar con código 2 antes de
contactar a ningún proveedor, nombrando la tarea y su sensibilidad. Lo que se escriba a disco para una tarea `personal` SHALL
ir redactado y NO SHALL guardar la salida con los valores reinyectados: reponer los valores antes de escribir dejaría en el
directorio de fixtures el email, el teléfono, la dirección, el documento y el nombre reales que la redacción protege frente al
proveedor.

Como `personal` es la sensibilidad por defecto y hay ya más de una tarea declarada así, este endurecimiento SHALL venir
acompañado de una comprobación automatizada sobre **los fixtures escritos antes de esta decisión**. Lo que esa comprobación
protege es que **ningún dato personal real llegue al disco**, no el trámite de cómo se escribió el archivo:

- Un fixture de una tarea `personal` con el **origen escrito a mano** SHALL ser válido: sus valores se inventaron, no son de
  nadie, y «volver a grabarlo contra el mock» no significaría nada.
- Un fixture de una tarea `personal` cuyo origen declarado sea un **proveedor externo** SHALL considerarse inválido, SHALL
  retirarse o sustituirse por uno escrito a mano o grabado contra el mock, y la comprobación SHALL fallar nombrando el fixture
  y su tarea mientras siga existiendo: es el único origen que pudo sacar el input de la máquina y dejar en el repositorio lo
  que volvió.
- Un fixture de una tarea `personal` con origen de **mock o de un proveedor local** NO SHALL invalidarse por su origen. El
  endurecimiento del grabador mira hacia delante y NO SHALL dejar en rojo, sin que nadie cambie nada, fixtures ya escritos y
  limpios.
- Sea cual sea su origen, un fixture de una tarea `personal` cuyo contenido cambie al aplicarle la redacción de proveedor
  externo SHALL considerarse inválido, porque eso es exactamente un dato personal en el disco; la comprobación SHALL fallar
  nombrando el fixture, su tarea y el `type` de lo que encontró, nunca el valor.

Un fixture existente NO SHALL sobrescribirse
salvo con `--overwrite`. Un upstream externo SHALL exigir `--allow-external`. El comando SHALL terminar con código 1 si algún
caso no se grabó, listándolos, y con código 2 ante uso inválido o `NODE_ENV=production`, sin contactar a ningún proveedor. Las
aplicaciones SHALL seguir rechazando `AI_MOCK_MODE=record`.

#### Scenario: Grabar y reproducir

- **GIVEN** una tarea que no es `personal` y un proveedor real que responde con una salida válida para un caso de su golden set
- **WHEN** se ejecuta el comando de grabación y después `runTask` con el mock en replay para ese caso
- **THEN** el replay SHALL devolver la salida grabada sin contactar al proveedor real
- **AND** el fixture SHALL indicar el proveedor y el modelo

#### Scenario: Respuesta inválida no se graba

- **GIVEN** un proveedor real que devuelve una salida inválida también tras la reparación para un caso
- **WHEN** se ejecuta el comando de grabación
- **THEN** NO SHALL escribirse fixture para ese caso
- **AND** el comando SHALL terminar con código 1 listando el caso

#### Scenario: Upstream externo con datos personales

- **GIVEN** la tarea `classify-skills`, declarada `personal`, un upstream externo con `--allow-external` y un caso con un email
- **WHEN** se ejecuta el comando de grabación
- **THEN** SHALL terminar con código 2 nombrando la tarea y su sensibilidad
- **AND** ningún proveedor SHALL recibir petición
- **AND** NO SHALL escribirse ningún fixture para ese caso

#### Scenario: Grabar una tarea personal contra el mock

- **GIVEN** una tarea `personal` y `--upstream=mock`
- **WHEN** se ejecuta el comando de grabación para un caso cuya salida no contiene nada que la redacción de proveedor externo sustituiría
- **THEN** el fixture SHALL escribirse con su origen
- **AND** NO SHALL contener ningún valor personal repuesto

#### Scenario: Un fixture personal grabado con la regla anterior

- **GIVEN** un fixture de una tarea `personal` cuyo origen declarado es un proveedor externo
- **WHEN** se ejecuta la comprobación automatizada de los fixtures
- **THEN** SHALL fallar nombrando el fixture y su tarea
- **AND** SHALL indicar que debe retirarse o sustituirse por uno escrito a mano o grabado contra el mock

#### Scenario: Un fixture personal escrito a mano sigue valiendo

- **GIVEN** los fixtures ya escritos de `classify-skills` y `extract-pasted-job`, ambas tareas `personal`, con origen escrito a
  mano o de un proveedor local, y ningún valor que la redacción de proveedor externo sustituiría
- **WHEN** se ejecuta la comprobación automatizada de los fixtures
- **THEN** SHALL pasar sin nombrar ninguno de ellos
- **AND** la comprobación NO SHALL exigir regrabar contra el mock un fixture cuyos valores se inventaron

#### Scenario: Un fixture personal con un dato personal dentro

- **GIVEN** un fixture de una tarea `personal`, con el origen que sea, cuyo contenido cambia al aplicarle la redacción de
  proveedor externo
- **WHEN** se ejecuta la comprobación automatizada de los fixtures
- **THEN** SHALL fallar nombrando el fixture, su tarea y el `type` encontrado
- **AND** el mensaje NO SHALL contener el valor

#### Scenario: Upstream externo sin permiso explícito

- **WHEN** se ejecuta el comando con `--upstream=openrouter` sin `--allow-external`
- **THEN** SHALL terminar con código 2 sin contactar a ningún proveedor

#### Scenario: Fixture existente

- **GIVEN** un fixture ya existente para un caso
- **WHEN** se ejecuta el comando de grabación sin `--overwrite`
- **THEN** el fixture NO SHALL modificarse y el proveedor NO SHALL recibir petición para ese caso

#### Scenario: Grabación en producción

- **GIVEN** `NODE_ENV=production`
- **WHEN** se ejecuta el comando de grabación
- **THEN** SHALL terminar con código 2 sin contactar a ningún proveedor

### Requirement: Registro de entradas pendientes de fixture

En modo replay y solo durante los tests, una entrada sin fixture SHALL anotarse en un registro con la tarea, el idioma
de salida, la clave que identifica su fixture y la entrada, además de fallar como ya hace. La entrada de una tarea
`personal` NO SHALL escribirse: de esas se anota todo lo demás y que no son grabables, porque el registro vive en disco
y el texto de un CV no puede acabar ahí. El registro SHALL poder
escribirse desde varios procesos de test a la vez sin perder anotaciones, y al consumirse SHALL producir una sola
entrada por clave, de modo que grabar los fixtures sea una sola pasada. Un test que espera a
propósito la ausencia de fixture SHALL poder quedar fuera del registro. Fuera de los tests NO SHALL escribirse nada.

#### Scenario: Entrada anotada

- **GIVEN** un test en replay con una entrada sin fixture
- **WHEN** se ejecuta
- **THEN** el test SHALL fallar como hasta ahora
- **AND** el registro SHALL contener esa tarea, su idioma, su entrada y la clave de su fixture

#### Scenario: La misma entrada dos veces

- **GIVEN** dos archivos de test que corren a la vez
- **WHEN** ambos piden la misma entrada sin fixture
- **THEN** al consumirse el registro SHALL producirse una sola entrada para esa clave

#### Scenario: Entrada de una tarea con datos personales

- **GIVEN** un test en replay de una tarea `personal` sin fixture
- **WHEN** se ejecuta
- **THEN** el registro SHALL anotar la tarea y su clave
- **AND** NO SHALL contener la entrada
- **AND** al consumirse SHALL decir que no es grabable

#### Scenario: Test que espera la ausencia

- **GIVEN** un test que comprueba el error de fixture ausente
- **WHEN** se ejecuta
- **THEN** su entrada NO SHALL anotarse en el registro

#### Scenario: Fuera de los tests

- **GIVEN** la aplicación corriendo fuera de los tests
- **WHEN** ocurre una entrada sin fixture
- **THEN** NO SHALL escribirse ningún registro
