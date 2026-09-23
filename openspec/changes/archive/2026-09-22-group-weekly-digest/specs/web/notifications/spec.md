## MODIFIED Requirements

### Requirement: Preferencias en la SPA

La UI de preferencias de notificación SHALL permitir opt-out de los tipos `group_new_link`,
`application_status_group`, `application_stale` y **`group_weekly_digest`**, editar
`notifyOwnActions`, y acotar `applicationStatusGroupId` a un grupo del que la persona es miembro
(o “todos”). Copy i18n ES/EN. Los cambios SHALL persistirse vía
`PATCH /api/notifications/preferences`.

#### Scenario: Desactivar digest semanal

- **GIVEN** Ana en la pantalla de preferencias de notificaciones
- **WHEN** desactiva el digest semanal del grupo
- **THEN** la petición SHALL enviar `groupWeeklyDigest` `false`
- **AND** la UI SHALL reflejar el estado tras `200`

#### Scenario: Enlace desde el email de digest

- **GIVEN** el copy del digest semanal
- **WHEN** Ana sigue el enlace de preferencias del pie
- **THEN** SHALL poder abrir la UI de preferencias de notificación (ruta autenticada documentada)
