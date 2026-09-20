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

Como `personal` es la sensibilidad por defecto y hay ya más de una tarea declarada así, este endurecimiento SHALL aplicarse
**también a los fixtures grabados antes de esta decisión**: un fixture de una tarea `personal` cuyo origen declarado no sea el
mock SHALL considerarse inválido, SHALL volver a grabarse contra el mock o retirarse, y una comprobación automatizada SHALL
fallar nombrando el fixture y su tarea mientras siga existiendo.

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

- **GIVEN** un fixture de una tarea `personal` cuyo origen declarado es un proveedor real
- **WHEN** se ejecuta la comprobación automatizada de los fixtures
- **THEN** SHALL fallar nombrando el fixture y su tarea
- **AND** SHALL indicar que debe volver a grabarse contra el mock o retirarse

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
