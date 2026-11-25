## ADDED Requirements

### Requirement: El borrado se lleva la semana del grupo

Borrar un grupo SHALL borrar todos sus documentos de `group_weekly_briefs`, en la misma transacción que borra el
grupo, sus membresías, sus relaciones con links y sus comentarios. Si ese borrado falla, NO SHALL borrarse nada. Los
documentos de otros grupos NO SHALL tocarse.

#### Scenario: Grupo borrado sin semanas huérfanas

- **GIVEN** un grupo con los documentos de su semana en curso y de la anterior
- **WHEN** el owner borra el grupo
- **THEN** NO SHALL quedar ningún documento de `group_weekly_briefs` de ese grupo

#### Scenario: Las semanas de otro grupo siguen

- **GIVEN** los grupos A y B con su semana guardada
- **WHEN** el owner de A borra A
- **THEN** el documento de la semana de B SHALL seguir intacto

#### Scenario: Si falla la limpieza no se borra nada

- **GIVEN** un grupo con su semana guardada y el borrado de sus semanas forzado a fallar
- **WHEN** el owner borra el grupo
- **THEN** la respuesta SHALL ser un error
- **AND** el grupo, sus miembros, sus links y su semana SHALL seguir existiendo
