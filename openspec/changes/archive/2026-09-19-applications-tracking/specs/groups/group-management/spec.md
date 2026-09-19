## ADDED Requirements

### Requirement: El borrado no alcanza a las postulaciones

Borrar un grupo NO SHALL borrar ni cambiar ninguna postulación de sus miembros: cada persona SHALL conservar la suya con
su estado, su etapa, sus notas, su visibilidad y su historial. Las postulaciones compartidas SHALL dejar de verse en ese
grupo porque el grupo ya no existe, sin que el borrado escriba nada en ellas.

#### Scenario: El borrado no destruye las postulaciones

- **GIVEN** un miembro que sigue, con su estado compartido, un link que solo estaba en ese grupo
- **WHEN** el owner borra el grupo
- **THEN** la postulación de ese miembro SHALL seguir existiendo con el mismo estado, visibilidad e historial
