# web/notifications Specification

## Purpose

Pantallas y flujos del SPA para gestionar preferencias de notificación y la suscripción Web Push, en español e inglés.

## Requirements

### Requirement: Preferencias en el perfil

El SPA SHALL ofrecer una sección (ruta o bloque en `/perfil`) donde la persona autenticada vea y
cambie los tipos de aviso (`group_new_link`, `application_status_group`, `application_stale`,
**`group_weekly_digest`**), el interruptor “avisarme también de mis propias acciones” y, de forma
opcional, el grupo concreto al que acotar avisos de estado (`applicationStatusGroupId`),
persistiendo vía la API de preferencias. Los textos SHALL estar en i18n ES/EN. El pie del email de
digest SHALL enlazar a esta UI.

#### Scenario: Desactivar nuevo link

- **GIVEN** Ana en la sección de notificaciones
- **WHEN** desactiva “nuevo link en el grupo” y guarda
- **THEN** la UI SHALL reflejar el estado desactivado
- **AND** la API SHALL haber recibido el PATCH correspondiente

#### Scenario: Desactivar digest semanal

- **GIVEN** Ana en la pantalla de preferencias de notificaciones
- **WHEN** desactiva el digest semanal del grupo
- **THEN** la petición SHALL enviar `groupWeeklyDigest` `false`
- **AND** la UI SHALL reflejar el estado tras `200`

#### Scenario: Enlace desde el email de digest

- **GIVEN** el copy del digest semanal
- **WHEN** Ana sigue el enlace de preferencias del pie
- **THEN** SHALL poder abrir la UI de preferencias de notificación (ruta autenticada documentada)

#### Scenario: Acotar grupo de estado

- **GIVEN** Ana miembro de varios grupos
- **WHEN** elige un grupo concreto como alcance de avisos de estado y guarda
- **THEN** la preferencia `applicationStatusGroupId` SHALL persistirse

### Requirement: Suscripción push opcional

El SPA SHALL registrar un Service Worker en el scope de la aplicación, poder solicitar permiso de notificaciones,
obtener la clave pública VAPID de la API y registrar o eliminar la suscripción por endpoint. Si el navegador no soporta
push, faltan claves VAPID (`503`) o el usuario niega el permiso, el resto de preferencias email SHALL seguir
funcionando.

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
