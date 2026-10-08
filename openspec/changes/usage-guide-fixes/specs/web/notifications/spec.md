## MODIFIED Requirements

### Requirement: Preferencias en el perfil

El SPA SHALL ofrecer una sección (ruta o bloque en `/perfil`) donde la persona autenticada vea y
cambie los tipos de aviso (`group_new_link`, `application_status_group`, `application_stale`,
**`group_weekly_digest`**), el interruptor “avisarme también de mis propias acciones” y, de forma
opcional, el grupo concreto al que acotar avisos de estado (`applicationStatusGroupId`),
persistiendo vía la API de preferencias. Los textos SHALL estar en i18n ES/EN. El pie del email de
digest SHALL enlazar a esta UI.

Cada texto de la sección —en particular la ayuda del selector de grupo, "Opcional. Si eliges un grupo, solo avisamos
cambios acotados a ese grupo…", y la confirmación "Preferencias guardadas"— SHALL leerse entero y **sin superponerse**
a ningún otro, en escritorio (1280 px de ancho) y en móvil (412 px): un texto de ayuda de varias líneas SHALL empujar
lo que viene detrás, no quedar encima ni debajo.

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

#### Scenario: La confirmación no queda debajo de la ayuda

- **GIVEN** Ana en la pantalla de preferencias de notificaciones, en escritorio o en móvil
- **WHEN** cambia una preferencia y pulsa "Guardar preferencias"
- **THEN** SHALL ver "Preferencias guardadas"
- **AND** la caja de ese texto NO SHALL solaparse con la de la ayuda del selector "Grupo para avisos de estado"

