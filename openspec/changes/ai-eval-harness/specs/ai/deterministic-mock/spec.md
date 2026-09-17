## ADDED Requirements

### Requirement: Grabación de fixtures con un proveedor real

El sistema SHALL ofrecer `nx run ai:record-fixtures --task=<task> --upstream=<ollama|openrouter>`, fuera de las aplicaciones y
de los tests, que ejecute la tarea con `runTask` contra el proveedor real para cada caso del golden set de la tarea y guarde
como fixture de replay, bajo la clave determinista de la ejecución, únicamente las salidas con resultado `success`. El fixture
SHALL identificar su origen con el proveedor y el modelo. Si el proveedor es externo y la tarea es `personal`, lo enviado SHALL
ir redactado y el fixture SHALL guardar la salida con los valores reinyectados. Un fixture existente NO SHALL sobrescribirse
salvo con `--overwrite`. Un upstream externo SHALL exigir `--allow-external`. El comando SHALL terminar con código 1 si algún
caso no se grabó, listándolos, y con código 2 ante uso inválido o `NODE_ENV=production`, sin contactar a ningún proveedor. Las
aplicaciones SHALL seguir rechazando `AI_MOCK_MODE=record`.

#### Scenario: Grabar y reproducir

- **GIVEN** un proveedor real que responde con una salida válida para un caso del golden set
- **WHEN** se ejecuta el comando de grabación y después `runTask` con el mock en replay para ese caso
- **THEN** el replay SHALL devolver la salida grabada sin contactar al proveedor real
- **AND** el fixture SHALL indicar el proveedor y el modelo

#### Scenario: Respuesta inválida no se graba

- **GIVEN** un proveedor real que devuelve una salida inválida también tras la reparación para un caso
- **WHEN** se ejecuta el comando de grabación
- **THEN** NO SHALL escribirse fixture para ese caso
- **AND** el comando SHALL terminar con código 1 listando el caso

#### Scenario: Upstream externo con datos personales

- **GIVEN** la tarea `classify-skills`, un upstream externo con `--allow-external` y un caso con un email
- **WHEN** se ejecuta el comando de grabación
- **THEN** la petición recibida por el upstream SHALL contener `[EMAIL_1]` y no el email
- **AND** el fixture SHALL contener la salida con el email reinyectado donde el modelo devolvió el marcador

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
