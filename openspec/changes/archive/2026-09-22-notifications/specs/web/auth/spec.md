## ADDED Requirements

### Requirement: Acceso a notificaciones desde la sesión autenticada

El shell autenticado (p. ej. perfil o menú de cuenta) SHALL enlazar a la sección de preferencias de notificación del
SPA. Quien no ha verificado el email SHALL poder abrir preferencias; el banner de verificación existente NO SHALL
bloquear esa navegación.

#### Scenario: Enlace visible

- **GIVEN** Ana autenticada en el SPA
- **WHEN** abre el área de cuenta/perfil
- **THEN** SHALL existir un enlace o entrada hacia preferencias de notificación
