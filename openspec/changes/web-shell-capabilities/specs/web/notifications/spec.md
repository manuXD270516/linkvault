## MODIFIED Requirements

### Requirement: Suscripción push opcional

El SPA SHALL registrar un Service Worker en el scope de la aplicación, poder solicitar permiso de notificaciones,
obtener la clave pública VAPID de la API y registrar o eliminar la suscripción por endpoint. Si el navegador no soporta
push, faltan claves VAPID (`503`) o el usuario niega el permiso, el resto de preferencias email SHALL seguir
funcionando. Si el despliegue declara la capacidad `push` en `false`, «Activar push» SHALL mostrarse deshabilitado,
con el aviso «Las notificaciones push no están activadas en este entorno. Los avisos por email siguen activos.» en
`role="status"`, y el SPA NO SHALL pedir permiso al navegador ni la clave VAPID; si el dispositivo ya tiene una
suscripción, «Desactivar push» SHALL seguir funcionando. Mientras las capacidades no hayan llegado o si su petición
falló, la sección SHALL comportarse como si la capacidad no existiera.

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

#### Scenario: Push no activado en el despliegue

- **GIVEN** Ana en un navegador con soporte push, sin suscripción, y la capacidad `push` en `false`
- **WHEN** abre Notificaciones
- **THEN** «Activar push» SHALL estar deshabilitado
- **AND** SHALL ver el aviso de que el push no está activado en este entorno
- **AND** el SPA NO SHALL haber pedido la clave VAPID ni el permiso del navegador
- **AND** las preferencias de email SHALL permanecer editables

#### Scenario: Suscripción previa con push apagado

- **GIVEN** un dispositivo con suscripción push y la capacidad `push` en `false`
- **WHEN** Ana pulsa «Desactivar push»
- **THEN** el SPA SHALL eliminar la suscripción como hasta ahora
