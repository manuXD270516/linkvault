## MODIFIED Requirements

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
