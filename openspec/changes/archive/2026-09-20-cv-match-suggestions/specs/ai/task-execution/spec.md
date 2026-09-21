## MODIFIED Requirements

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
