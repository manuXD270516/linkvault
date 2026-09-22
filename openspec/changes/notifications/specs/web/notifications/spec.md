## Purpose

Pantallas y flujos del SPA para gestionar preferencias de notificación y la suscripción Web Push, en español e inglés.

## ADDED Requirements

### Requirement: Preferencias en el perfil

El SPA SHALL ofrecer una sección (ruta o bloque en `/perfil`) donde la persona autenticada vea y cambie los tres tipos
de aviso, el interruptor “avisarme también de mis propias acciones” y, de forma opcional, el grupo concreto al que
acotar avisos de estado (`applicationStatusGroupId`), persistiendo vía la API de preferencias. Los textos SHALL estar en
i18n ES/EN.

#### Scenario: Desactivar nuevo link

- **GIVEN** Ana en la sección de notificaciones
- **WHEN** desactiva “nuevo link en el grupo” y guarda
- **THEN** la UI SHALL reflejar el estado desactivado
- **AND** la API SHALL haber recibido el PATCH correspondiente

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
