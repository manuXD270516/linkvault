## MODIFIED Requirements

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
