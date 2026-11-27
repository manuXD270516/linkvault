## MODIFIED Requirements

### Requirement: Detección de reuso

Si se presenta un refresh token ya rotado hace 10 segundos o más, la API SHALL tratarlo como reuso: SHALL revocar la sesión
completa, responder `401` con código `invalid_refresh`, borrar la cookie y registrar un aviso con el identificador de
usuario y de sesión, sin tokens.

Si se rotó hace menos de 10 segundos, la API NO SHALL revocar la sesión y SHALL distinguir dos casos:

- **Sucesor sin usar** (ni el sucesor ni ningún hermano suyo se presentó todavía en un refresh) y menos de 3 reemisiones
  previas de ese token: la respuesta de la rotación anterior se dio por perdida. La API SHALL emitir de forma atómica un
  refresh token nuevo de la misma sesión, distinto de los anteriores, y un access token nuevo, y responder `200` como una
  sesión iniciada, con la caducidad del refresh calculada como en una rotación. La ventana de 10 segundos SHALL seguir
  contando desde la primera rotación del token presentado. SHALL registrar un aviso (informativo en la primera reemisión, de advertencia desde la segunda) con el identificador de
  usuario, de sesión y el número de reemisión, sin tokens.
- **Sucesor ya usado, o tope de 3 reemisiones alcanzado**: SHALL responder `409` con código `refresh_conflict` sin
  `Set-Cookie` (peticiones concurrentes del mismo navegador, que comparte la cookie).

Cuando se rota uno de los refresh tokens emitidos a partir del mismo token, los demás que no se hayan usado SHALL quedar
superados en ese instante: presentarlos después SHALL responder `409` `refresh_conflict` dentro de los 10 segundos
siguientes y SHALL tratarse como reuso a partir de entonces. Un token superado NO SHALL reemitirse, ni tampoco un token
rotado antes de que la API incorporara la reemisión (sin contador de reemisiones): ese responde `409` como antes. La base de datos
SHALL seguir guardando solo hashes de los refresh tokens.

#### Scenario: Reuso revoca la sesión

- **GIVEN** R1 rotado a R2 hace más de 10 segundos
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `401` con código `invalid_refresh`
- **AND** un refresh posterior con R2 SHALL responder `401`

#### Scenario: Respuesta de rotación perdida

- **GIVEN** R1 rotado a R2 hace 2 segundos y R2 nunca presentado
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `200` con un access token y una cookie con un refresh token R3 distinto de R1 y de R2
- **AND** la sesión NO SHALL quedar revocada
- **AND** un refresh posterior con R3 SHALL responder `200`

#### Scenario: Respuesta perdida fuera de la ventana

- **GIVEN** R1 rotado a R2 hace más de 10 segundos y R2 nunca presentado
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `401` con código `invalid_refresh`
- **AND** la sesión SHALL quedar revocada

#### Scenario: Refresh concurrente

- **GIVEN** R1 rotado a R2 hace 2 segundos y R2 ya rotado a R3
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `409` con código `refresh_conflict` y sin `Set-Cookie`
- **AND** la sesión NO SHALL quedar revocada
- **AND** un refresh posterior con R3 SHALL responder `200`

#### Scenario: El hermano usado deja superados a los demás

- **GIVEN** R1 rotado a R2 y reemitido como R3, ninguno de los dos presentado todavía
- **WHEN** se llama a refresh con R3 y responde `200`
- **THEN** un refresh con R2 dentro de los 10 segundos siguientes SHALL responder `409` con código `refresh_conflict`
- **AND** un refresh con R2 pasados 10 segundos SHALL responder `401` y revocar la sesión

#### Scenario: Tope de reemisiones

- **GIVEN** R1 rotado y reemitido 3 veces en los últimos 10 segundos, sin que ninguno de sus sucesores se haya presentado
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `409` con código `refresh_conflict` y sin `Set-Cookie`
- **AND** la sesión NO SHALL quedar revocada

#### Scenario: Token rotado antes de la reemisión

- **GIVEN** R1 rotado a R2 hace 2 segundos por una versión de la API sin reemisión, y R2 nunca presentado
- **WHEN** se llama a refresh con R1
- **THEN** la respuesta SHALL ser `409` con código `refresh_conflict` y sin `Set-Cookie`

#### Scenario: Tres refresh concurrentes con el mismo token

- **GIVEN** una sesión con refresh token R1
- **WHEN** llegan tres refresh con R1 a la vez
- **THEN** las tres respuestas SHALL ser `200`, con tres refresh tokens distintos entre sí
- **AND** la sesión NO SHALL quedar revocada
- **AND** cuando se usa uno de ellos, refrescar con cualquiera de los otros dos dentro de los 10 segundos siguientes SHALL
  responder `409`

#### Scenario: Reemisión y uso de un hermano a la vez

- **GIVEN** R1 rotado a R2 hace 2 segundos y R2 sin usar
- **WHEN** llegan a la vez un refresh con R1 y otro con R2
- **THEN** la respuesta de R2 SHALL ser `200` con un refresh token R4
- **AND** la de R1 SHALL ser `409` o `200`
- **AND** tras las dos, R4 SHALL ser el único refresh token de la sesión que un refresh posterior acepte con `200`

#### Scenario: Reemisión sin token en claro

- **GIVEN** R1 rotado a R2 y reemitido como R3
- **WHEN** se lee la colección de refresh tokens
- **THEN** NO SHALL contener el valor de R1, R2 ni R3 en claro
