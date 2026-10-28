## ADDED Requirements

### Requirement: Clase del fallo de proveedor

Todo error de proveedor no disponible SHALL llevar una clase derivada de su código HTTP:

- `rate_limited` para `429`;
- `rejected` para `401`, `402`, `403` y `404`;
- `unavailable` para cualquier otro código y para la ausencia de código (error de red, cuerpo inválido, plazo).

La clase SHALL decidirse en un único lugar del dominio de `libs/ai`, de modo que todos los proveedores la hereden sin
cambiar su código. El error NO SHALL incluir el cuerpo de la respuesta, la petición, las cabeceras ni la credencial,
tampoco en su causa. La clase NO SHALL depender del texto del cuerpo.

#### Scenario: Cupo agotado

- **WHEN** un proveedor responde `429`
- **THEN** el error SHALL tener clase `rate_limited`

#### Scenario: Ningún proveedor acepta la política de datos

- **WHEN** OpenRouter responde `404` porque ningún proveedor del modelo acepta `data_collection: deny`
- **THEN** el error SHALL tener clase `rejected`

#### Scenario: Caída del proveedor

- **WHEN** un proveedor responde `502`, o la petición falla por red
- **THEN** el error SHALL tener clase `unavailable`

#### Scenario: El cuerpo no viaja con la clase

- **GIVEN** OpenRouter respondiendo `429` con un cuerpo cuyo mensaje repite el prompt
- **WHEN** el proveedor recibe una petición
- **THEN** SHALL lanzar un error de clase `rate_limited` con el código HTTP
- **AND** el error, su causa y los logs NO SHALL contener el cuerpo ni el prompt

## MODIFIED Requirements

### Requirement: Circuit breaker por proveedor

Cada proceso SHALL mantener un circuit breaker por proveedor que se abre tras 5 errores de proveedor dentro de 60 segundos.
Mientras está abierto, el proveedor NO SHALL recibir peticiones. A los 30 segundos SHALL conceder un único permiso de prueba
que se toma justo antes de enviar la petición: una respuesta del proveedor (válida o no según el schema) cierra el circuito y
un error de proveedor lo reabre. Un permiso no tomado NO SHALL dejar el circuito bloqueado.

Todas las clases de error (`rate_limited`, `rejected` y `unavailable`) SHALL contar igual en la ventana de 5 errores: la
clase NO SHALL cambiar cuándo se abre ni cuándo se cierra un circuito. Toda ejecución que registra un error en el
breaker, sea de una tarea o de embeddings, SHALL registrarlo con la clase del error.

Cada circuito SHALL recordar la **clase dominante** de los errores que cuentan en su ventana, con la precedencia
`unavailable` > `rate_limited` > `rejected`, y no la del último error. Si la prueba de half-open falla, la clase SHALL
pasar a ser la de ese error, que es el único de la ventana del nuevo período abierto. La clase SHALL escribirse solo en
los errores que hoy cambian el estado del circuito (los que cuentan en la ventana con el circuito cerrado y el de la
prueba de half-open) y SHALL borrarse solo donde hoy se borra el circuito (cuando la prueba recibe respuesta, o cuando el
circuito queda sin errores ni apertura). Una respuesta con el circuito cerrado NO SHALL alterar la ventana de errores ni
su clase, igual que hoy.

El breaker SHALL exponer, para los circuitos abiertos, esa clase recordada. Si su almacén no responde, SHALL devolver un
conjunto vacío (fallar abierto), igual que la instantánea de circuitos abiertos. Guardar la clase NO SHALL añadir
caducidades nuevas al almacén.

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

#### Scenario: Un cupo agotado abre el circuito como cualquier error

- **GIVEN** un proveedor que respondió `429` cinco veces en los últimos 60 segundos
- **WHEN** se construye la cadena para una nueva ejecución
- **THEN** ese proveedor NO SHALL formar parte de la cadena
- **AND** la clase recordada de su circuito SHALL ser `rate_limited`
- **AND** a los 30 segundos SHALL concederse el permiso de prueba, como en cualquier half-open

#### Scenario: La clase recordada es la dominante de la ventana

- **GIVEN** un proveedor que, en los últimos 60 segundos, respondió `503` una vez y después `429` cuatro veces
- **WHEN** se abre su circuito
- **THEN** la clase recordada SHALL ser `unavailable`, no la del último error

#### Scenario: Un error fuera de la ventana no cuenta para la clase

- **GIVEN** un proveedor que respondió `503` hace más de 60 segundos y después `429` cinco veces dentro de la ventana
- **WHEN** se abre su circuito
- **THEN** la clase recordada SHALL ser `rate_limited`

#### Scenario: Prueba de half-open fallida

- **GIVEN** un circuito abierto con clase recordada `unavailable`, cuya petición de prueba recibe un `404`
- **WHEN** el circuito se reabre
- **THEN** la clase recordada SHALL ser `rejected`

#### Scenario: Una respuesta con el circuito cerrado no borra la ventana

- **GIVEN** un proveedor con 4 errores en los últimos 60 segundos y el circuito cerrado
- **WHEN** el proveedor responde una vez y después falla una vez más dentro de la ventana
- **THEN** el circuito SHALL abrirse, igual que hoy

#### Scenario: Los embeddings registran la clase

- **GIVEN** un proveedor de embeddings que responde `429` cinco veces en 60 segundos
- **WHEN** se abre su circuito
- **THEN** la clase recordada SHALL ser `rate_limited`

#### Scenario: Una respuesta olvida la clase

- **GIVEN** un circuito abierto con clase recordada `rejected`
- **WHEN** la petición de prueba recibe respuesta
- **THEN** el circuito SHALL cerrarse y NO SHALL recordar ninguna clase

#### Scenario: Almacén del breaker caído

- **GIVEN** el almacén compartido del breaker sin responder
- **WHEN** se piden las clases recordadas de los circuitos abiertos
- **THEN** SHALL devolverse un conjunto vacío sin lanzar
