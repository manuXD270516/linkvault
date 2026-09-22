## ADDED Requirements

### Requirement: Enlace a preferencias de notificación

`GET /api/users/me` NO SHALL incrustar el mapa completo de preferencias de notificación como campos editables del
perfil genérico. El SPA SHALL descubrir la gestión de avisos por navegación a la sección/ruta de notificaciones (ver
`web/notifications`). Si el design expone un hint booleano mínimo en el perfil, NO SHALL ser escribible por
`PATCH /api/users/me`.

#### Scenario: PATCH de perfil no muda preferencias

- **WHEN** Ana envía `PATCH /api/users/me` con un campo de preferencia de notificación
- **THEN** la API SHALL rechazarlo (`400` validation) o ignorarlo sin persistir ese campo en el perfil
- **AND** las preferencias solo SHALL mutarse por `/api/notifications/preferences`
