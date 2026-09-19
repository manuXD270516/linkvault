## ADDED Requirements

### Requirement: El borrado se lleva los comentarios

Borrar un grupo SHALL borrar todos los comentarios escritos en él, en la misma transacción que borra el grupo, sus
membresías y sus relaciones con links. Si el borrado de los comentarios falla, NO SHALL borrarse nada. Los comentarios
del mismo link en otros grupos NO SHALL tocarse.

#### Scenario: Grupo borrado sin comentarios huérfanos

- **GIVEN** un grupo con dos links y cinco comentarios entre los dos
- **WHEN** el owner borra el grupo
- **THEN** NO SHALL quedar ningún comentario de ese grupo

#### Scenario: Los comentarios de otro grupo siguen

- **GIVEN** un link con comentarios en los grupos A y B
- **WHEN** el owner de A borra A
- **THEN** los comentarios de ese link en B SHALL seguir intactos

#### Scenario: Si falla la limpieza no se borra nada

- **GIVEN** un grupo con comentarios y el borrado de sus comentarios forzado a fallar
- **WHEN** el owner borra el grupo
- **THEN** la respuesta SHALL ser un error
- **AND** el grupo, sus miembros, sus links y sus comentarios SHALL seguir existiendo
