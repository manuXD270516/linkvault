## Purpose

Decide qué proveedores de IA pueden atender cada ejecución y en qué orden, respetando la configuración del entorno, las
capacidades de cada proveedor, el consentimiento del usuario y el estado de salud reciente, e integra los proveedores
gratuitos Ollama y OpenRouter.

## ADDED Requirements

### Requirement: Cadena limitada por configuración

El universo de proveedores SHALL definirse con `AI_CHAIN`: `none`, o una lista de identificadores conocidos (`mock`,
`ollama`, `openrouter`) separados por comas. `AI_CHAIN=none` SHALL ser una configuración válida en la que toda ejecución se
degrada con motivo `no_providers`. Un identificador desconocido, un proveedor listado sin la configuración que necesita, o
`mock` con `NODE_ENV=production` SHALL impedir el arranque, antes de crear la aplicación, con un error que nombre la variable
y el identificador y nunca el valor de una credencial. Ningún proveedor ausente de `AI_CHAIN` SHALL recibir peticiones.

#### Scenario: Sin IA configurada

- **GIVEN** `AI_CHAIN=none`
- **WHEN** se ejecuta cualquier tarea
- **THEN** SHALL devolverse `status: "degraded"` con motivo `no_providers`

#### Scenario: Proveedor desconocido

- **GIVEN** `AI_CHAIN=mock,gpt-magic`
- **WHEN** arranca la aplicación
- **THEN** el arranque SHALL fallar nombrando `AI_CHAIN` y `gpt-magic`

#### Scenario: Proveedor externo sin credencial

- **GIVEN** `AI_CHAIN=openrouter` y ninguna clave de OpenRouter configurada
- **WHEN** arranca la aplicación
- **THEN** el arranque SHALL fallar nombrando la variable de la credencial, sin mostrar ningún valor

#### Scenario: Mock en producción

- **GIVEN** `NODE_ENV=production` y `AI_CHAIN=mock,openrouter`
- **WHEN** arranca la aplicación
- **THEN** el arranque SHALL fallar nombrando `AI_CHAIN` y `mock`

### Requirement: Filtrado por capacidades, consentimiento y circuitos abiertos

Antes de elegir, la política de routing SHALL descartar los proveedores que no satisfacen las capacidades requeridas por la
tarea (cada capacidad booleana requerida debe ser verdadera y el contexto máximo debe ser mayor o igual al requerido), los
proveedores con circuito abierto y, cuando la tarea es `personal` y el contexto no tiene consentimiento para proveedores
externos, los proveedores con `external: true`. El consentimiento SHALL ser un dato obligatorio del contexto, sin valor por
defecto. La política SHALL ser una función pura sin acceso a red ni a almacenamiento.

#### Scenario: Capacidad insuficiente

- **GIVEN** una tarea que requiere `jsonMode` y un proveedor sin `jsonMode`
- **WHEN** se construye la cadena
- **THEN** ese proveedor NO SHALL formar parte de la cadena

#### Scenario: Sin consentimiento en una tarea personal

- **GIVEN** una tarea `personal`, un contexto con `externalProviders: false` y una cadena con un proveedor externo y otro local
- **WHEN** se construye la cadena
- **THEN** solo el proveedor local SHALL formar parte de la cadena

#### Scenario: Tarea pública sin consentimiento

- **GIVEN** una tarea `public` y un contexto con `externalProviders: false`
- **WHEN** se construye la cadena
- **THEN** los proveedores externos SHALL seguir siendo elegibles

### Requirement: Orden de la cadena

La cadena SHALL ordenarse por: proveedores BYOK del usuario primero; menor coste por token de salida; a igual coste,
proveedores locales antes que externos; mayor contexto máximo; y, como último desempate, el orden en `AI_CHAIN`.

#### Scenario: Proveedor gratuito antes que uno de pago

- **GIVEN** dos proveedores elegibles, uno con coste 0 y otro con coste mayor que 0
- **WHEN** se construye la cadena
- **THEN** el de coste 0 SHALL ir primero

#### Scenario: Local antes que remoto a igual coste

- **GIVEN** Ollama y OpenRouter elegibles, ambos con coste 0, con `AI_CHAIN=openrouter,ollama`
- **WHEN** se construye la cadena
- **THEN** Ollama SHALL ir antes que OpenRouter

### Requirement: Fallos y tiempos de espera de proveedores

Cada intento SHALL abortarse al exceder el tiempo máximo de su proveedor, aunque el proveedor no coopere con la cancelación.
Si el contexto trae una señal de cancelación, SHALL aplicarse como plazo total de la ejecución. Un error de red, un código de
error del proveedor o un tiempo excedido SHALL registrarse como `provider_error` y `runTask` SHALL pasar al siguiente
proveedor. Si se cancela la señal del contexto, la ejecución SHALL terminar degradada con motivo `providers_failed` sin
registrar `provider_error` ni contar como fallo del proveedor en su circuit breaker.

#### Scenario: Cancelación del llamador

- **GIVEN** una ejecución cuya señal de contexto se cancela mientras un proveedor responde
- **WHEN** `runTask` termina
- **THEN** SHALL devolver `status: "degraded"` con motivo `providers_failed`
- **AND** el circuit breaker de ese proveedor NO SHALL contar un fallo

#### Scenario: Proveedor que no responde

- **GIVEN** un primer proveedor que nunca resuelve y un segundo proveedor sano
- **WHEN** se ejecuta `runTask`
- **THEN** el intento del primero SHALL abortarse al cumplirse su tiempo máximo
- **AND** el resultado SHALL venir del segundo proveedor

### Requirement: Circuit breaker por proveedor

Cada proceso SHALL mantener un circuit breaker por proveedor que se abre tras 5 errores de proveedor dentro de 60 segundos.
Mientras está abierto, el proveedor NO SHALL recibir peticiones. A los 30 segundos SHALL conceder un único permiso de prueba
que se toma justo antes de enviar la petición: una respuesta del proveedor (válida o no según el schema) cierra el circuito y
un error de proveedor lo reabre. Un permiso no tomado NO SHALL dejar el circuito bloqueado.

#### Scenario: Apertura tras fallos repetidos

- **GIVEN** un proveedor con 5 errores de proveedor en los últimos 60 segundos
- **WHEN** se construye la cadena para una nueva ejecución
- **THEN** ese proveedor NO SHALL formar parte de la cadena

#### Scenario: Recuperación en half-open

- **GIVEN** un circuito abierto hace más de 30 segundos
- **WHEN** la petición de prueba al proveedor recibe respuesta
- **THEN** el circuito SHALL cerrarse y el proveedor SHALL volver a ser elegible

#### Scenario: Permiso de prueba no usado

- **GIVEN** un circuito en half-open y una ejecución resuelta por un proveedor anterior en la cadena
- **WHEN** llega una ejecución posterior
- **THEN** el proveedor en half-open SHALL poder recibir su petición de prueba

### Requirement: Proveedor Ollama

El sistema SHALL integrar Ollama como proveedor local (`external: false`, coste 0) contra la URL, el modelo y el tamaño de
contexto configurados, enviando ese tamaño de contexto en cada petición, con modo JSON, y SHALL reportar su salud
consultando el servidor.

#### Scenario: Completado contra Ollama

- **GIVEN** un servidor Ollama que responde a la API de chat
- **WHEN** el proveedor recibe una petición
- **THEN** SHALL devolver el texto, el uso de tokens, el modelo y la latencia
- **AND** la petición enviada SHALL incluir el tamaño de contexto configurado

#### Scenario: Ollama no disponible

- **GIVEN** la URL de Ollama sin servidor escuchando
- **WHEN** se consulta la salud del proveedor
- **THEN** SHALL reportar que no está sano sin lanzar excepción

### Requirement: Proveedor OpenRouter

El sistema SHALL integrar OpenRouter como proveedor externo (`external: true`) solo con modelos gratuitos (identificador
terminado en `:free`), contra la URL base configurada (HTTPS salvo en tests), pidiendo que no se recolecten los datos
enviados y enviando la credencial solo en la cabecera de autorización. Los errores NO SHALL incluir la credencial ni el
cuerpo de la respuesta.

#### Scenario: Completado contra OpenRouter

- **GIVEN** la API de OpenRouter respondiendo a una petición de chat
- **WHEN** el proveedor recibe una petición
- **THEN** SHALL devolver el texto, el uso de tokens, el modelo y la latencia
- **AND** la petición enviada SHALL pedir que no se recolecten los datos

#### Scenario: Error de la API

- **GIVEN** la API de OpenRouter respondiendo con un código de error y un cuerpo que repite el prompt
- **WHEN** el proveedor recibe una petición
- **THEN** SHALL lanzar un error de proveedor no disponible con el código HTTP, sin la credencial ni el cuerpo

#### Scenario: Modelo de pago configurado

- **GIVEN** `AI_CHAIN` con `openrouter` y un `OPENROUTER_MODEL` que no termina en `:free`
- **WHEN** arranca la aplicación
- **THEN** el arranque SHALL fallar nombrando `OPENROUTER_MODEL`
