## ADDED Requirements

### Requirement: Despublicar al borrar la cuenta

Al ejecutarse el borrado de cuenta (`users/account-deletion`), la cascada SHALL hacer unset / quitar `publicShare` de
todas las relaciones `group_links` (o equivalente) que esa persona haya publicado, en la misma unidad de commit que el
resto de la cascada. Tras el éxito, las URLs públicas anteriores de esos `slug` SHALL responder como no disponibles
(`404`), igual que un despublicado explícito.

#### Scenario: Lo publicado deja de ser público

- **GIVEN** Ana publicó un link en un grupo y obtiene un `slug` público
- **WHEN** Ana borra su cuenta con éxito
- **THEN** esa relación NO SHALL conservar `publicShare`
- **AND** `GET` de la página pública con ese `slug` SHALL responder `404`

#### Scenario: Publicaciones de otras personas intactas

- **GIVEN** Luis publicó otro link en el mismo grupo
- **WHEN** Ana borra su cuenta
- **THEN** el enlace público de Luis SHALL seguir disponible
- **AND** solo las publicaciones de Ana SHALL haberse despublicado
