## Purpose

Ofrece a cualquier módulo de LinkVault una forma única y predecible de ejecutar tareas de IA con salida estructurada:
valida entradas y salidas, repara respuestas inválidas una sola vez, reutiliza resultados idénticos y devuelve un
resultado degradado explícito en lugar de fallar cuando no hay IA disponible.

## ADDED Requirements

### Requirement: Punto de entrada único

El sistema SHALL exponer `runTask(task, input, ctx)` como única forma de invocar modelos de lenguaje. Toda tarea SHALL
declararse como `AiTask` con nombre, versión de prompt, schema de entrada, schema de salida, capacidades requeridas,
temperatura, presupuesto (`maxTokens` y `maxAttempts` igual a 1 o 2) y sensibilidad de datos. `runTask` SHALL validar el
input contra el schema de entrada antes de contactar a ningún proveedor.

#### Scenario: Ejecución correcta de una tarea declarada

- **GIVEN** la tarea `classify-skills` y un input válido
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver un resultado con `status: "success"`, la salida validada contra el schema de salida, el
  identificador del proveedor, el modelo y la versión de prompt usados

#### Scenario: Input inválido

- **GIVEN** un input que no cumple el schema de entrada de la tarea
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL rechazar la ejecución con un error de validación
- **AND** ningún proveedor SHALL recibir una petición

#### Scenario: Presupuesto de intentos inválido

- **GIVEN** una tarea que declara `maxAttempts: 3`
- **WHEN** se registra la tarea
- **THEN** el registro SHALL fallar nombrando la tarea

### Requirement: Idioma de salida

`runTask` SHALL usar el idioma de salida del contexto, `es` por defecto, SHALL hacerlo disponible al prompt y SHALL incluirlo
en la identidad de la ejecución, de modo que el mismo input con idiomas distintos no comparta resultados.

#### Scenario: Idioma por defecto

- **GIVEN** un contexto sin idioma de salida
- **WHEN** se renderiza el prompt de una tarea
- **THEN** el prompt SHALL indicar el idioma `es`

#### Scenario: Mismo input en otro idioma

- **GIVEN** una ejecución exitosa en caché con idioma `es`
- **WHEN** se ejecuta la misma tarea con el mismo input e idioma `en`
- **THEN** NO SHALL devolverse el resultado en caché de `es`

### Requirement: Parámetros deterministas para tareas estructuradas

Las peticiones SHALL enviarse con la temperatura declarada por la tarea (0 para todas las tareas de este change) y SHALL
pedir respuesta JSON a los proveedores cuya capacidad `jsonMode` lo permita.

#### Scenario: Proveedor con modo JSON

- **GIVEN** un proveedor con `jsonMode: true`
- **WHEN** `runTask` le envía una tarea estructurada
- **THEN** la petición SHALL llevar `temperature: 0` y formato de respuesta JSON

### Requirement: Salida estructurada validada con una reparación

`runTask` SHALL extraer el JSON de la respuesta de forma tolerante (bloques de código y texto alrededor) y validarlo contra
el schema de salida. Si la validación falla y la tarea permite dos intentos, SHALL enviar exactamente una petición de
reparación al mismo proveedor que incluya la salida inválida y los errores de validación. Si la salida sigue siendo inválida,
SHALL registrar `schema_error` y continuar con el siguiente proveedor de la cadena.

#### Scenario: JSON dentro de un bloque de código

- **GIVEN** un proveedor que responde el JSON válido envuelto en un bloque de código y texto explicativo
- **WHEN** `runTask` procesa la respuesta
- **THEN** SHALL devolver la salida validada sin enviar petición de reparación

#### Scenario: JSON inválido en el primer intento

- **GIVEN** un proveedor que devuelve JSON que no cumple el schema de salida y, tras la reparación, JSON válido
- **WHEN** `runTask` procesa las respuestas
- **THEN** SHALL enviar exactamente una petición de reparación que incluya los errores de validación
- **AND** SHALL devolver la salida reparada

#### Scenario: JSON inválido también tras la reparación

- **GIVEN** un primer proveedor que devuelve salida inválida dos veces y un segundo proveedor que responde bien
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL registrar `schema_error` para el primer proveedor
- **AND** SHALL devolver la salida del segundo proveedor

### Requirement: Degradación tipada

Cuando ningún proveedor de la cadena produce una salida válida, o la cadena queda vacía tras el filtrado o por configuración,
`runTask` NO SHALL lanzar una excepción: SHALL devolver `status: "degraded"` con un motivo (`no_providers`,
`providers_failed` o `quota_exceeded`). Si la tarea declara una función de degradación, el resultado SHALL incluir su salida
validada contra el schema de salida; una salida de degradación inválida SHALL lanzarse como error de programación.
`runTask` solo SHALL propagar como excepción el input inválido y los errores de programación: fixture ausente o inválido
del mock, tarea sin muestra en modo synth, uso incorrecto del mock, prompt que no puede renderizarse y salida de
degradación inválida. Cualquier otro fallo SHALL traducirse en fallback o degradación.

#### Scenario: Cadena agotada sin función de degradación

- **GIVEN** una tarea sin función de degradación y todos los proveedores fallando
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con motivo `providers_failed` y sin salida

#### Scenario: Cadena agotada con función de degradación

- **GIVEN** una tarea que declara una función de degradación válida y todos los proveedores fallando
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con la salida de la función de degradación

#### Scenario: Función de degradación con salida inválida

- **GIVEN** una tarea cuya función de degradación devuelve una salida que no cumple el schema
- **WHEN** la cadena se agota
- **THEN** `runTask` SHALL lanzar un error que nombre la tarea

#### Scenario: Ningún proveedor elegible

- **GIVEN** una cadena en la que ningún proveedor supera el filtrado
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con motivo `no_providers` sin contactar a ningún proveedor

### Requirement: Caché de resultados

`runTask` SHALL reutilizar una salida válida previa con la misma identidad de ejecución (tarea, versión de prompt, idioma de
salida e input canónico) sin contactar a ningún proveedor. La caché SHALL compartirse entre procesos, NO SHALL guardar
resultados degradados, NO SHALL usarse cuando la cadena configurada incluye el mock, y un fallo del almacén de caché SHALL
tratarse como ausencia de caché sin hacer fallar la tarea.

#### Scenario: Segunda ejecución idéntica

- **GIVEN** una ejecución exitosa de una tarea con un input usando proveedores reales
- **WHEN** se ejecuta de nuevo la misma tarea con el mismo input escrito con otro orden de claves
- **THEN** SHALL devolver la misma salida con `cached: true`
- **AND** ningún proveedor SHALL recibir una petición

#### Scenario: Caché compartida entre procesos

- **GIVEN** dos instancias independientes de `runTask` conectadas al mismo almacén de caché
- **WHEN** la primera ejecuta una tarea y la segunda ejecuta la misma tarea con el mismo input
- **THEN** la segunda SHALL obtener el resultado desde la caché

#### Scenario: Nueva versión de prompt

- **GIVEN** una salida en caché para la versión `v1` de una tarea
- **WHEN** la tarea pasa a la versión `v2` y se ejecuta con el mismo input
- **THEN** SHALL contactar a un proveedor en lugar de usar la salida de `v1`

#### Scenario: Cadena con mock

- **GIVEN** `AI_CHAIN` que incluye `mock`
- **WHEN** se ejecuta dos veces la misma tarea
- **THEN** el almacén de caché NO SHALL leerse ni escribirse

#### Scenario: Almacén de caché caído

- **GIVEN** el almacén de caché no disponible
- **WHEN** se ejecuta una tarea
- **THEN** SHALL devolverse el resultado del proveedor sin error

### Requirement: Prompts versionados

Cada tarea SHALL tener su prompt en un archivo versionado con metadatos (tarea y versión) y una plantilla sin lógica, con
partes de sistema y de usuario, que se rellena con el input validado y el idioma de salida sin escapar caracteres. El sistema
SHALL negarse a registrar una tarea cuyo prompt de la versión declarada no exista o cuyos metadatos no coincidan.

#### Scenario: Prompt renderizado con el input

- **GIVEN** la tarea `classify-skills` versión `v1` y un input con un texto que contiene `&` y comillas
- **WHEN** se renderiza su prompt
- **THEN** el mensaje de usuario SHALL contener el texto tal cual, sin entidades HTML

#### Scenario: Versión de prompt inexistente

- **GIVEN** una tarea que declara la versión `v9` sin archivo de prompt para esa versión
- **WHEN** se registra la tarea
- **THEN** el registro SHALL fallar con un error que nombre la tarea y la versión
