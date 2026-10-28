## MODIFIED Requirements

### Requirement: Alta de suscripción

`POST /api/notifications/push-subscriptions` autenticado SHALL aceptar el payload estándar de suscripción del navegador
(endpoint URL + claves `p256dh` y `auth`), validarlo y persistirlo asociado al usuario. Responderá `201` (alta) o `200`
(idempotente si el mismo endpoint ya existía para ese usuario). Sin sesión → `401`. El endpoint SHALL ser una URL
`https`, sin credenciales y sin puerto distinto del 443, cuyo host sea uno de los servicios push conocidos de la lista
compartida de `@linkvault/shared` (coincidencia exacta del host o sufijo precedido de punto). Para que ningún
analizador de URLs pueda leerlo de otra manera, el texto recibido SHALL estar ya en su forma canónica (su
serialización WHATWG SHALL ser idéntica al texto), NO SHALL contener espacios, caracteres de control ni barra invertida,
y su host SHALL estar formado solo por letras ASCII, dígitos, guiones y puntos. Cualquier otro endpoint SHALL responder
`400` con código `validation_error` nombrando `endpoint`, sin persistir nada. La lista SHALL cambiar solo con un cambio
de código revisado, no por configuración.

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

#### Scenario: Endpoint que no está en forma canónica

- **WHEN** Ana registra un endpoint que el analizador WHATWG normalizaría, o que contiene espacios, caracteres de
  control, barra invertida o caracteres fuera de letras, dígitos, guiones y puntos en el host
- **THEN** la respuesta SHALL ser `400` con código `validation_error` nombrando `endpoint`
- **AND** NO SHALL persistirse ninguna suscripción

### Requirement: Envío con VAPID

El worker SHALL enviar web push solo con las claves VAPID de configuración (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`). Un endpoint que responda `410`/`404` SHALL provocar el borrado de esa suscripción. Antes de enviar, el
worker SHALL comprobar el endpoint con el mismo criterio y la misma lista de servicios push conocidos que el alta, y
SHALL exigir además que el host que obtiene el analizador de URLs que usa la librería de envío sea igual al host
WHATWG. Uno que no lo cumpla —guardado antes de esta regla— SHALL borrarse sin abrir ninguna conexión y sin reintento;
el registro de ese borrado SHALL incluir el host del endpoint, o una categoría fija si no se puede analizar, y NO SHALL
incluir el endpoint completo. Los logs NO SHALL registrar las claves VAPID privadas ni el `auth` de la suscripción.

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
- **AND** el registro SHALL contener el host del endpoint y NO SHALL contener el endpoint completo

#### Scenario: Los dos analizadores leen hosts distintos

- **GIVEN** una suscripción guardada cuyo endpoint el analizador de la librería de envío lee con un host distinto del
  que lee el analizador WHATWG
- **WHEN** el worker va a entregarle un aviso
- **THEN** NO SHALL abrirse ninguna conexión
- **AND** la suscripción SHALL eliminarse
