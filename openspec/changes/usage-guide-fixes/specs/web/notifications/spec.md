## MODIFIED Requirements

### Requirement: Preferencias en el perfil

El SPA SHALL ofrecer una sección (ruta o bloque en `/perfil`) donde la persona autenticada vea y
cambie los tipos de aviso (`group_new_link`, `application_status_group`, `application_stale`,
**`group_weekly_digest`**), el interruptor “avisarme también de mis propias acciones” y, de forma
opcional, el grupo concreto al que acotar avisos de estado (`applicationStatusGroupId`),
persistiendo vía la API de preferencias. Los textos SHALL estar en i18n ES/EN. El pie del email de
digest SHALL enlazar a esta UI.

El subíndice del selector "Grupo para avisos de estado" —donde vive su ayuda, "Opcional. Si eliges un grupo, solo
avisamos cambios acotados a ese grupo…"— SHALL crecer con su contenido (`subscriptSizing="dynamic"` de Angular
Material), de modo que una ayuda de varias líneas empuje lo que viene detrás, como la confirmación "Preferencias
guardadas", en lugar de reservar un alto fijo que ese texto desborda.

El selector "Grupo para avisos de estado" SHALL mostrar siempre la opción elegida: cuando la preferencia no acota a
ningún grupo (`applicationStatusGroupId` `null`), SHALL verse "Todos mis grupos (unión del link)" en el campo, no un
campo vacío, y elegir esa opción SHALL guardar `applicationStatusGroupId` `null`.

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

#### Scenario: El subíndice del selector crece con su ayuda

- **GIVEN** Ana en la pantalla de preferencias de notificaciones
- **WHEN** se pinta el selector "Grupo para avisos de estado" con su ayuda
- **THEN** su subíndice SHALL tener alto dinámico (`subscriptSizing="dynamic"`), no el alto fijo por defecto

#### Scenario: La confirmación se sigue viendo

- **GIVEN** Ana en la pantalla de preferencias de notificaciones
- **WHEN** cambia una preferencia y pulsa "Guardar preferencias"
- **THEN** SHALL ver "Preferencias guardadas"

#### Scenario: Todos mis grupos se ve elegido

- **GIVEN** Ana con `applicationStatusGroupId` `null`
- **WHEN** abre la pantalla de preferencias de notificaciones
- **THEN** el selector "Grupo para avisos de estado" SHALL mostrar "Todos mis grupos (unión del link)"

#### Scenario: Volver a todos los grupos

- **GIVEN** Ana con un grupo concreto como alcance de avisos de estado
- **WHEN** elige "Todos mis grupos (unión del link)" y guarda
- **THEN** la petición SHALL enviar `applicationStatusGroupId` `null`

