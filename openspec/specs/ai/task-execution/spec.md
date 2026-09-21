# ai/task-execution Specification

## Purpose

Ofrece a cualquier módulo de LinkVault una forma única y predecible de ejecutar tareas de IA con salida estructurada:
valida entradas y salidas, repara respuestas inválidas una sola vez, reutiliza resultados idénticos y devuelve un
resultado degradado explícito en lugar de fallar cuando no hay IA disponible.

## Requirements

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
`runTask` NO SHALL lanzar una excepción: SHALL devolver `status: "degraded"` con un motivo de un **conjunto cerrado de
cuatro**: `no_providers`, `providers_failed`, `quota_exceeded` y el motivo propio de que **faltaba el consentimiento**. Si la
tarea declara una función de degradación, el resultado SHALL incluir su salida validada contra el schema de salida; una
salida de degradación inválida SHALL lanzarse como error de programación. `runTask` solo SHALL propagar como excepción el
input inválido y los errores de programación: fixture ausente o inválido del mock, tarea sin muestra en modo synth, uso
incorrecto del mock, prompt que no puede renderizarse y salida de degradación inválida. Cualquier otro fallo SHALL traducirse
en fallback o degradación.

El motivo de falta de consentimiento existe porque los otros tres no significan eso: sin él, a quien no ha dado el permiso se
le devolvía el mismo motivo que a quien no tiene ninguna IA configurada, y quien lo lee tenía que **adivinar** justo en el
único caso que la persona puede arreglar. Sus reglas:

- SHALL darse **solo cuando conceder el consentimiento habría hecho elegible a algún proveedor**, es decir cuando la política
  de routing informa `consentWouldEnable` en verdadero (`ai/provider-routing`). `runTask` NO SHALL recalcular ese hecho por
  su cuenta.
- SHALL darse además **solo cuando la cadena quedó vacía tras el filtrado**, sin haber contactado a ningún proveedor. Si la
  cadena tenía proveedores y todos fallaron, el motivo SHALL ser `providers_failed` aunque conceder el permiso hubiera
  añadido a otro: lo que ocurrió fue una avería, y ofrecer «te falta autorizarlo» como salida sería ofrecer la salida
  equivocada.
- Con la cadena vacía y `consentWouldEnable` en falso, el motivo SHALL ser `no_providers`.

Los cuatro motivos SHALL ser **mutuamente excluyentes y deterministas** para una misma ejecución, con esta precedencia:
`quota_exceeded` primero —la cuota se comprueba antes de componer la cadena—; después, con la cadena vacía, el de falta de
consentimiento si procede y `no_providers` en otro caso; y `providers_failed` solo cuando hubo al menos un intento.

**Cuando el motivo es `quota_exceeded`**, el resultado degradado SHALL incluir además el **instante en que se podrá volver a
intentar**: el momento en que la ejecución contada más antigua sale de la ventana de la cuota y el conteo vuelve a estar por
debajo del límite. SHALL ser un instante absoluto, para que quien lo guarde lo devuelva tal cual sin recalcularlo, y NO SHALL
acompañar a ninguno de los otros tres motivos. Sin ese dato, lo único que puede hacerse es invitar a reintentar en el vacío,
que es la manera más rápida de gastar una cuota que ya está agotada.

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

#### Scenario: Faltaba el consentimiento y el permiso era la diferencia

- **GIVEN** una tarea `personal`, un contexto sin consentimiento y una política de routing que devuelve la cadena vacía con `consentWouldEnable` en verdadero
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con el motivo propio de la falta de consentimiento
- **AND** ningún proveedor SHALL recibir una petición

#### Scenario: Faltaba el consentimiento pero no habría cambiado nada

- **GIVEN** una tarea `personal`, un contexto sin consentimiento y una política de routing que devuelve la cadena vacía con `consentWouldEnable` en falso
- **WHEN** se ejecuta `runTask`
- **THEN** el motivo SHALL ser `no_providers` y NO SHALL ser el de la falta de consentimiento

#### Scenario: Sin consentimiento, con un proveedor local que falla

- **GIVEN** una tarea `personal` sin consentimiento, un proveedor local elegible que devuelve error y `consentWouldEnable` en verdadero
- **WHEN** se ejecuta `runTask`
- **THEN** el motivo SHALL ser `providers_failed`
- **AND** NO SHALL ser el de la falta de consentimiento, porque hubo intento

#### Scenario: Los cuatro motivos se distinguen entre sí

- **GIVEN** cuatro ejecuciones degradadas por cadena vacía, por fallo de todos los proveedores, por cuota agotada y por falta de consentimiento
- **WHEN** se comparan sus motivos
- **THEN** los cuatro SHALL ser distintos entre sí
- **AND** el de la falta de consentimiento SHALL poder distinguirse de `no_providers`

#### Scenario: La cuota agotada dice cuándo volver

- **GIVEN** un usuario que alcanzó el límite diario de una tarea
- **WHEN** se ejecuta `runTask`
- **THEN** SHALL devolver `status: "degraded"` con motivo `quota_exceeded` y con el instante en que se podrá volver a intentar
- **AND** ese instante SHALL ser aquel en que la ejecución contada más antigua sale de la ventana

#### Scenario: El instante de vuelta no acompaña a otro motivo

- **GIVEN** una ejecución degradada con motivo `providers_failed`, otra con `no_providers` y otra por falta de consentimiento
- **WHEN** se inspeccionan los tres resultados
- **THEN** ninguno SHALL traer instante de vuelta

### Requirement: Caché de resultados

`runTask` SHALL reutilizar una salida válida previa con la misma identidad de ejecución (tarea, versión de prompt, idioma de
salida e input canónico) sin contactar a ningún proveedor **solo cuando el resultado de la tarea es cacheable**, según la
propiedad que cada tarea declara y que `ai/data-protection` fija: una tarea `personal` NO SHALL ser cacheable, de modo que su
resultado NO SHALL leerse ni escribirse en la caché y su ejecución NO SHALL devolver nunca `cached: true`. La caché SHALL
compartirse entre procesos, NO SHALL guardar resultados degradados, NO SHALL usarse cuando la cadena configurada incluye el
mock, y un fallo del almacén de caché SHALL tratarse como ausencia de caché sin hacer fallar la tarea.

#### Scenario: Segunda ejecución idéntica

- **GIVEN** una ejecución exitosa de una tarea cacheable con un input usando proveedores reales
- **WHEN** se ejecuta de nuevo la misma tarea con el mismo input escrito con otro orden de claves
- **THEN** SHALL devolver la misma salida con `cached: true`
- **AND** ningún proveedor SHALL recibir una petición

#### Scenario: Caché compartida entre procesos

- **GIVEN** dos instancias independientes de `runTask` conectadas al mismo almacén de caché y una tarea cacheable
- **WHEN** la primera ejecuta una tarea y la segunda ejecuta la misma tarea con el mismo input
- **THEN** la segunda SHALL obtener el resultado desde la caché

#### Scenario: Nueva versión de prompt

- **GIVEN** una salida en caché para la versión `v1` de una tarea cacheable
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

#### Scenario: Una tarea personal no toca la caché

- **GIVEN** un almacén de caché compartido disponible y una tarea `personal` con proveedores reales
- **WHEN** se ejecuta dos veces con el mismo input y el mismo idioma de salida
- **THEN** el almacén NO SHALL recibir ninguna lectura ni ninguna escritura para esa identidad de ejecución
- **AND** un proveedor SHALL recibir la petición las dos veces

#### Scenario: Una tarea personal nunca se devuelve cacheada

- **GIVEN** una tarea `personal` cuya salida ya trae los valores reinyectados
- **WHEN** `runTask` devuelve su resultado
- **THEN** SHALL devolverse con `cached: false`
- **AND** ningún camino de ejecución SHALL poder devolver `cached: true` para esa tarea

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

### Requirement: Crítica de sugerencias

El sistema SHALL poder ejecutar la tarea `critique-suggestions` por el mismo punto de entrada que el resto de tareas. Su salida SHALL ser un score entre 0 y 1 y una lista de issues. SHALL ser una tarea con datos personales a efectos de consentimiento y NO SHALL poder cachearse. El resultado SHALL validarse igual que el resto de salidas estructuradas: un intento de reparación y, si no valida, la tarea no entrega score.

#### Scenario: Salida que no valida

- **GIVEN** un modelo que responde algo que no es un score y una lista de issues
- **WHEN** se ejecuta `critique-suggestions`
- **THEN** NO SHALL devolverse un score inventado tras agotar la reparación

### Requirement: Construcción de roadmap

El sistema SHALL ejecutar `build-roadmap` solo vía `runTask`. Entrada: `missingSkills` priorizables + contexto mínimo de vacante (sin texto completo del CV en MVP). Salida: roadmap estructurado. Tras la salida (o solo catálogo), el sistema SHALL forzar `verified: true` únicamente en hits de `searchCatalog` y `verified: false` en el resto. Tarea NO cacheable. Datos personales a efectos de consentimiento si la cadena usa proveedores external.

#### Scenario: Salida que no valida

- **GIVEN** JSON inválido del modelo
- **WHEN** `build-roadmap`
- **THEN** NO inventar roadmap tras repair
- **AND** NO marcar como verificados recursos inventados

#### Scenario: El modelo miente verified

- **GIVEN** salida con `verified: true` en un recurso que no está en el catálogo
- **WHEN** termina el post-proceso
- **THEN** ese recurso SHALL quedar `verified: false`
