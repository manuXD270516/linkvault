## ADDED Requirements

### Requirement: Clase del fallo de proveedor

Todo error de proveedor no disponible SHALL llevar una clase derivada de su código HTTP:

- `rate_limited` para `429`, con un instante de reinicio opcional;
- `rejected` para `401`, `402`, `403` y `404`;
- `unavailable` para cualquier otro código y para la ausencia de código (error de red, cuerpo inválido, plazo).

La clase SHALL decidirse en un único lugar del dominio de `libs/ai`, de modo que todos los proveedores la hereden. El
error NO SHALL incluir el cuerpo de la respuesta, la petición, las cabeceras ni la credencial, tampoco en su causa.

#### Scenario: Cupo agotado

- **WHEN** un proveedor responde `429`
- **THEN** el error SHALL tener clase `rate_limited`

#### Scenario: Ningún proveedor acepta la política de datos

- **WHEN** OpenRouter responde `404` porque ningún proveedor del modelo acepta `data_collection: deny`
- **THEN** el error SHALL tener clase `rejected`

#### Scenario: Caída del proveedor

- **WHEN** un proveedor responde `502`, o la petición falla por red
- **THEN** el error SHALL tener clase `unavailable`

## MODIFIED Requirements

### Requirement: Circuit breaker por proveedor

Cada proceso SHALL mantener un circuit breaker por proveedor, que se abre tras 5 errores de proveedor dentro de
60 segundos. Mientras está abierto, el proveedor NO SHALL recibir peticiones. A los 30 segundos SHALL conceder un único
permiso de prueba, que se toma justo antes de enviar la petición: una respuesta del proveedor (válida o no según el
schema) cierra el circuito y un error de proveedor lo reabre. Un permiso no tomado NO SHALL dejar el circuito bloqueado.

Un error de clase `rate_limited` **con** instante de reinicio SHALL abrir el circuito de ese proveedor de inmediato y
**hasta ese instante**, sin contar en la ventana de 5 errores. Al llegar el instante SHALL conceder el permiso de prueba
como en cualquier half-open. Un `rate_limited` sin instante, un `rejected` y un `unavailable` SHALL contar como error de
proveedor, como cualquier otro. Cada circuito SHALL recordar la clase de su último error, y el instante de reapertura si
lo hay; una respuesta del proveedor SHALL borrarla. El breaker SHALL exponer, para los circuitos abiertos, esa clase
recordada. Si su almacén no responde, SHALL devolver un conjunto vacío (fallar abierto), igual que la instantánea de
circuitos abiertos.

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

#### Scenario: Cupo agotado hasta mañana

- **GIVEN** un proveedor que responde `429` con reinicio a las 00:00 UTC del día siguiente
- **WHEN** se construye la cadena para una ejecución posterior, antes de ese instante
- **THEN** ese proveedor NO SHALL formar parte de la cadena ni recibir peticiones
- **AND** la clase recordada de su circuito SHALL ser `rate_limited` con ese instante
- **AND** ese `429` NO SHALL contar en la ventana de 5 errores

#### Scenario: El cupo vuelve

- **GIVEN** un circuito pausado por `rate_limited` hasta un instante que ya pasó
- **WHEN** llega una ejecución
- **THEN** el proveedor SHALL recibir el permiso de prueba
- **AND** si responde, el circuito SHALL cerrarse y olvidar la clase recordada

#### Scenario: Cupo agotado sin instante

- **GIVEN** un proveedor que responde `429` sin instante de reinicio
- **WHEN** se registra el error
- **THEN** SHALL contar como un error más en la ventana de 5, sin pausa propia

#### Scenario: Almacén del breaker caído

- **GIVEN** el almacén compartido del breaker sin responder
- **WHEN** se piden las clases recordadas de los circuitos abiertos
- **THEN** SHALL devolverse un conjunto vacío sin lanzar

### Requirement: Proveedor OpenRouter

El sistema SHALL integrar OpenRouter como proveedor externo (`external: true`) solo con modelos gratuitos (identificador
terminado en `:free`), contra la URL base configurada (HTTPS salvo en tests), pidiendo que no se recolecten los datos
enviados y enviando la credencial solo en la cabecera de autorización. Los errores NO SHALL incluir la credencial ni el
cuerpo de la respuesta.

Ante un `429`, el proveedor SHALL buscar el instante de reinicio en este orden:

1. la cabecera `Retry-After`, en segundos o como fecha HTTP;
2. la cabecera `X-RateLimit-Reset`, en milisegundos epoch;
3. el campo `error.metadata.headers["X-RateLimit-Reset"]` del cuerpo JSON.

Del cuerpo SHALL leer **solo** ese número. Si no puede leerlo, no habrá instante. Un instante anterior al reloj local, o
posterior en más de 48 horas, SHALL descartarse. Ni el cuerpo ni el error de su lectura SHALL aparecer en el error, en
su causa ni en los logs.

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

#### Scenario: Límite diario de modelos gratuitos con el instante en el cuerpo

- **GIVEN** OpenRouter respondiendo `429` con un cuerpo cuyo `error.metadata.headers["X-RateLimit-Reset"]` es un
  instante de dentro de 6 horas, y cuyo mensaje repite el prompt
- **WHEN** el proveedor recibe una petición
- **THEN** SHALL lanzar un error de clase `rate_limited` con ese instante
- **AND** el error, su causa y los logs NO SHALL contener el cuerpo ni el prompt

#### Scenario: Instante en la cabecera

- **GIVEN** OpenRouter respondiendo `429` con `Retry-After: 120`
- **WHEN** el proveedor recibe una petición
- **THEN** el instante de reinicio SHALL ser el reloj local más 120 segundos

#### Scenario: Instante absurdo

- **GIVEN** OpenRouter respondiendo `429` con un instante de reinicio de dentro de 30 días
- **WHEN** el proveedor recibe una petición
- **THEN** SHALL lanzar un error de clase `rate_limited` sin instante

#### Scenario: Cuerpo ilegible

- **GIVEN** OpenRouter respondiendo `429` con un cuerpo que no es JSON
- **WHEN** el proveedor recibe una petición
- **THEN** SHALL lanzar un error de clase `rate_limited` sin instante, sin el cuerpo ni el mensaje del parser
