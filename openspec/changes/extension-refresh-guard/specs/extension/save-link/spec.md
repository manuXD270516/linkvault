## MODIFIED Requirements

### Requirement: Refresh single-flight en el cliente

La extensión SHALL garantizar como máximo un refresh in-flight a la vez (mutex en service
worker o solo desde el popup). Ante `409` `refresh_conflict` SHALL aplicar la misma política
que el SPA (`web/auth`): hasta **3** reintentos con delays equivalentes a `delaysMs` del cliente
web. NO SHALL disparar refresh concurrente desde popup y background. El único contexto que
construye el cliente HTTP que refresca SHALL ser el service worker; el resto de contextos
(popup y cualquier página futura) SHALL pedirle las operaciones autenticadas por mensajes.

#### Scenario: Un solo refresh a la vez

- **GIVEN** access próximo a caducar
- **WHEN** dos acciones dispararían refresh a la vez
- **THEN** como máximo una petición `extension/refresh` SHALL estar en vuelo

#### Scenario: Tope de reintentos 409

- **GIVEN** la API responde `409` `refresh_conflict` de forma sostenida
- **WHEN** el cliente reintenta
- **THEN** SHALL detenerse tras como máximo 3 reintentos y pedir re-login si sigue fallando

#### Scenario: Solo el service worker refresca

- **GIVEN** el código fuente de la extensión, sin contar los tests
- **WHEN** se buscan las construcciones del cliente HTTP que refresca
- **THEN** SHALL haber exactamente una y SHALL estar en el service worker
- **AND** el popup SHALL obtener sesión, grupos y guardado por mensajes al service worker

## ADDED Requirements

### Requirement: La sesión guardada solo avanza desde el token presentado

Al recibir `200` de `POST /api/auth/extension/refresh`, la extensión SHALL guardar la sesión
nueva solo si el `refreshToken` almacenado en ese momento sigue siendo el que presentó en esa
petición (compare-and-set). Si cambió o ya no hay sesión, SHALL descartar la respuesta sin
escribir nada y el refresh SHALL resolver con la sesión almacenada o, si no hay ninguna, fallar
como «sin sesión» (`401`). Al agotar los reintentos ante `409` `refresh_conflict`, SHALL borrar
la sesión solo si el `refreshToken` almacenado sigue siendo el último presentado. Leer, comparar
y escribir SHALL ser una sección crítica exclusiva compartida por todas las escrituras de la
sesión (login, logout, refresh y reintentos agotados) en todos los contextos de la extensión,
con Web Locks (`navigator.locks`, lock exclusivo con nombre fijo) cuando estén disponibles; la
petición de red NO SHALL quedar dentro de esa sección. Login y logout SHALL seguir escribiendo
y borrando sin condición. Esta regla SHALL cumplirse tanto contra una API que responde `409` a
un token rotado hace menos de 10 s como contra una que reemite un token hermano (ADR-072).

#### Scenario: Logout durante un refresh

- **GIVEN** una sesión con `refreshToken` R0 y un refresh en vuelo que presentó R0
- **WHEN** el usuario cierra sesión y después llega la respuesta `200` del refresh con R1
- **THEN** la extensión NO SHALL tener sesión guardada
- **AND** el refresh SHALL fallar con `401` como «sin sesión»
- **AND** el popup SHALL pedir login

#### Scenario: Login durante un refresh

- **GIVEN** un refresh en vuelo que presentó R0
- **WHEN** un login termina y guarda una sesión con L1, y después llega la respuesta `200` del refresh con R1
- **THEN** la sesión guardada SHALL ser la del login, con L1
- **AND** el refresh SHALL resolver con esa sesión

#### Scenario: Otro contexto ya avanzó la sesión con una API que reemite

- **GIVEN** una API con reemisión (ADR-072) y dos contextos que presentan R0 a la vez
- **WHEN** el primero recibe R1, lo guarda y refresca con él hasta R2, y después llega al segundo el hermano R1′
- **THEN** la sesión guardada SHALL seguir con R2
- **AND** el siguiente refresh SHALL presentar R2 y recibir `200`

#### Scenario: El hermano llega primero

- **GIVEN** una API con reemisión y dos contextos que presentan R0 a la vez
- **WHEN** la respuesta con el hermano R1′ llega antes que la de R1
- **THEN** la sesión guardada SHALL ser la de R1′ y la respuesta con R1 SHALL descartarse
- **AND** el siguiente refresh SHALL presentar R1′ y recibir `200`

#### Scenario: Misma carrera con una API sin reemisión

- **GIVEN** una API que responde `409` a un token rotado hace menos de 10 s y dos contextos que presentan R0 a la vez
- **WHEN** uno recibe `200` con R1 y el otro `409`
- **THEN** el que recibió `409` SHALL reintentar presentando el token guardado
- **AND** la extensión SHALL terminar con una sesión válida, sin pedir login

#### Scenario: Reintentos agotados no borran una sesión más nueva

- **GIVEN** la API responde `409` `refresh_conflict` de forma sostenida a R0
- **WHEN** un login guarda L1 mientras el último reintento con R0 está en vuelo, y ese reintento recibe `409`
- **THEN** la sesión guardada SHALL seguir siendo la de L1

#### Scenario: Comparar y escribir no se intercala con otra escritura

- **GIVEN** un refresh que presentó R0 y recibe `200` con R1
- **WHEN** un login intenta guardar L1 entre la lectura del token almacenado y la escritura del refresh
- **THEN** la escritura del login SHALL esperar a que termine la sección crítica del refresh
- **AND** la sesión guardada al final SHALL ser la de L1

#### Scenario: Un refresh colgado no bloquea el logout

- **GIVEN** un refresh en vuelo cuya respuesta no llega
- **WHEN** el usuario cierra sesión
- **THEN** el logout SHALL terminar y borrar la sesión sin esperar a ese refresh
