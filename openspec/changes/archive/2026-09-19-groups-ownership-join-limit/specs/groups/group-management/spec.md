## MODIFIED Requirements

### Requirement: Borrado por el owner

`DELETE /api/groups/:id` SHALL borrar el grupo, todas sus membresías y todas sus relaciones con links
(`GroupLink`) de forma atómica y responder `204` solo si quien
pide es el `owner`; un miembro que no es owner SHALL recibir `403`. Que quien pide es el `owner` SHALL comprobarse en la
misma escritura atómica que borra: si deja de serlo antes de que el borrado se confirme —por ejemplo, porque transfirió
la propiedad desde otra pestaña—, SHALL responder `403` con código `forbidden` y NO SHALL borrarse nada. Los `JobLink` compartidos en él NO SHALL borrarse: siguen disponibles en otros grupos y en las listas privadas. Tras el
borrado, el grupo SHALL responder `404` a todos sus antiguos miembros y su código de invitación NO SHALL servir.

#### Scenario: El owner borra el grupo

- **GIVEN** un grupo con dos miembros
- **WHEN** el owner lo borra
- **THEN** la respuesta SHALL ser `204`
- **AND** el grupo NO SHALL aparecer en la lista de ninguno de los dos
- **AND** unirse con su código SHALL responder `404`

#### Scenario: Un miembro no puede borrar

- **GIVEN** un miembro que no es owner
- **WHEN** intenta borrar el grupo
- **THEN** la respuesta SHALL ser `403` con código `forbidden`
- **AND** el grupo SHALL seguir existiendo

#### Scenario: El borrado no destruye las vacantes

- **GIVEN** un grupo con un link que también está en otro grupo del mismo usuario
- **WHEN** el owner borra el primer grupo
- **THEN** las relaciones de ese grupo con sus links NO SHALL existir
- **AND** el link SHALL seguir apareciendo en el otro grupo

#### Scenario: Borrar mientras se transfiere

- **GIVEN** un grupo con el owner Ana y el miembro Beto
- **WHEN** llegan a la vez la transferencia de Ana a Beto y el borrado del grupo pedido por Ana
- **THEN** al terminar las dos, el grupo SHALL estar borrado o existir con Beto como único owner
- **AND** NO SHALL ocurrir que las dos respuestas sean `2xx`
