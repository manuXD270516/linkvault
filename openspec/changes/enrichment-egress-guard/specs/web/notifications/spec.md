## MODIFIED Requirements

### Requirement: Suscripción push opcional

El SPA SHALL registrar un Service Worker en el scope de la aplicación, poder solicitar permiso de notificaciones,
obtener la clave pública VAPID de la API y registrar o eliminar la suscripción por endpoint. Si el navegador no soporta
push, faltan claves VAPID (`503`) o el usuario niega el permiso, el resto de preferencias email SHALL seguir
funcionando. Si la API rechaza el alta con `400` y código `validation_error`, el SPA SHALL cancelar la suscripción del
navegador —la recién creada o la que ya existía— y NO SHALL mostrar push como activado; si esa cancelación falla, el
fallo SHALL ignorarse y el resultado SHALL seguir siendo el fallo original del alta, con push sin activar. Ante otros
fallos del alta SHALL conservarla.

#### Scenario: Permiso denegado

- **GIVEN** el navegador deniega el permiso de notificaciones
- **WHEN** Ana intenta activar push
- **THEN** la UI SHALL informar del fallo de forma no bloqueante
- **AND** las preferencias de email SHALL permanecer editables

#### Scenario: Service Worker presente

- **GIVEN** Ana en un navegador con soporte push
- **WHEN** activa las notificaciones push con éxito
- **THEN** SHALL existir un Service Worker controlando el scope de la app
- **AND** la suscripción SHALL haberse enviado a la API

#### Scenario: La API rechaza el endpoint del navegador

- **GIVEN** Ana en un navegador cuyo servicio push no está en la lista de servicios conocidos
- **WHEN** activa las notificaciones push y la API responde `400` con código `validation_error`
- **THEN** la suscripción del navegador SHALL cancelarse, sea la recién creada o la que ya existía
- **AND** la UI NO SHALL mostrar push como activado
- **AND** la UI SHALL informar del fallo de forma no bloqueante, con el texto de fallo existente
- **AND** las preferencias de email SHALL permanecer editables

#### Scenario: La cancelación de la suscripción del navegador falla

- **GIVEN** la API rechazó el alta con `400` y código `validation_error`
- **WHEN** la cancelación de la suscripción del navegador también falla
- **THEN** el resultado SHALL ser el fallo original del alta
- **AND** la UI NO SHALL mostrar push como activado

#### Scenario: Un fallo pasajero no cancela la suscripción

- **GIVEN** Ana en un navegador con soporte push
- **WHEN** activa las notificaciones push y el alta falla sin conexión o con un error del servidor
- **THEN** la suscripción del navegador NO SHALL cancelarse
- **AND** la UI SHALL informar del fallo de forma no bloqueante
