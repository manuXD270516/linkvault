## MODIFIED Requirements

### Requirement: Alta de suscripción

`POST /api/notifications/push-subscriptions` autenticado SHALL aceptar el payload estándar de suscripción del navegador
(endpoint URL + claves `p256dh` y `auth`), validarlo y persistirlo asociado al usuario. Responderá `201` (alta) o `200`
(idempotente si el mismo endpoint ya existía para ese usuario). Sin sesión → `401`. El endpoint SHALL ser una URL
`https`, sin credenciales y sin puerto distinto del 443, cuyo host sea uno de los servicios push conocidos de la lista
compartida de `@linkvault/shared` (coincidencia exacta del host o sufijo precedido de punto); cualquier otro endpoint
SHALL responder `400` con código `validation_error` nombrando `endpoint`, sin persistir nada. La lista SHALL cambiar
solo con un cambio de código revisado, no por configuración.

#### Scenario: Primera suscripción

- **GIVEN** Ana autenticada
- **WHEN** registra una suscripción válida de un servicio push conocido
- **THEN** la respuesta SHALL ser `201`
- **AND** un aviso posterior elegible SHALL poder usar ese endpoint

#### Scenario: Mismo endpoint otra vez

- **GIVEN** Ana ya registró el endpoint E
- **WHEN** vuelve a registrar E
- **THEN** la respuesta SHALL ser `200`
- **AND** NO SHALL duplicarse la fila lógica de suscripción para E

#### Scenario: Endpoint fuera de los servicios push conocidos

- **GIVEN** Ana autenticada
- **WHEN** registra una suscripción cuyo endpoint apunta a un host que no es un servicio push conocido
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `endpoint`
- **AND** NO SHALL persistirse ninguna suscripción

#### Scenario: Endpoint sin TLS o con otro puerto

- **WHEN** Ana registra una suscripción con el host de un servicio push conocido pero con esquema `http` o con un
  puerto distinto del 443
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `endpoint`

#### Scenario: Sufijo que no respeta el límite de etiqueta

- **WHEN** Ana registra un endpoint cuyo host termina con el texto de un servicio conocido pero sin el punto que separa
  las etiquetas
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `endpoint`

### Requirement: Envío con VAPID

El worker SHALL enviar web push solo con las claves VAPID de configuración (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`). Un endpoint que responda `410`/`404` SHALL provocar el borrado de esa suscripción. Antes de enviar, el
worker SHALL comprobar el endpoint con la misma lista de servicios push conocidos que el alta; uno que no la cumpla
—guardado antes de esta regla— SHALL borrarse sin abrir ninguna conexión y sin reintento, y el registro NO SHALL
incluir el endpoint. Los logs NO SHALL registrar las claves VAPID privadas ni el `auth` de la suscripción.

#### Scenario: Endpoint muerto

- **GIVEN** una suscripción cuyo endpoint responde `410 Gone` al push
- **WHEN** el worker intenta entregar
- **THEN** esa suscripción SHALL eliminarse
- **AND** el job de ese canal MAY completarse sin reintento infinito

#### Scenario: Suscripción antigua fuera de la lista

- **GIVEN** una suscripción guardada antes de esta regla con un endpoint que no es un servicio push conocido
- **WHEN** el worker va a entregarle un aviso
- **THEN** NO SHALL abrirse ninguna conexión hacia ese endpoint
- **AND** la suscripción SHALL eliminarse
- **AND** el registro NO SHALL contener el endpoint
