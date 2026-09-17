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
