## ADDED Requirements

### Requirement: Relación nueva en grupo notifica

Cuando `POST /api/links` o `POST /api/links/import` cree una **relación nueva** con un grupo (`shared` `created`), el
caso de uso SHALL escribir en la misma unidad de commit el evento outbox `GroupLinkAdded.v1`. Si el link ya estaba en
ese grupo (`already_there`) o se guarda solo en privado (sin `groupId`), NO SHALL encolarse ese fan-out. Cada relación
nueva del import MAY generar su propio evento (sin agregación V0).

#### Scenario: Primera vez en el grupo

- **GIVEN** un miembro guarda una URL que aún no estaba en su grupo
- **WHEN** la respuesta es `201` con `shared` `created`
- **THEN** SHALL existir evento de notificación pendiente en `outbox_events`

#### Scenario: Ya estaba en el grupo

- **GIVEN** el mismo miembro vuelve a guardar la misma vacante en el mismo grupo
- **WHEN** la respuesta indica `shared` `already_there`
- **THEN** NO SHALL encolarse un nuevo `group_new_link` por esa petición

#### Scenario: Solo privado

- **WHEN** un usuario guarda una URL sin `groupId`
- **THEN** NO SHALL encolarse `group_new_link`

#### Scenario: Import con varias relaciones nuevas

- **GIVEN** un import que crea tres relaciones nuevas en un grupo
- **WHEN** termina el import
- **THEN** SHALL existir un evento de notificación por cada relación nueva
