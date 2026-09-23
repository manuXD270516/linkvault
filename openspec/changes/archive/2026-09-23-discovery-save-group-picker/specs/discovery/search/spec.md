## MODIFIED Requirements

### Requirement: Guardar desde discovery reusa links

El cliente SHALL guardar un hit vía `POST /api/links` con la `url` del hit y,
opcionalmente, `groupId` del destino elegido en la UI. El servidor de discovery
NO SHALL exponer un endpoint de save propio.

#### Scenario: Save privado

- **GIVEN** un hit con URL válida y destino privado
- **WHEN** el cliente guarda
- **THEN** SHALL crearse o deduplicarse el JobLink por el camino existente de
  save **sin** `groupId`

#### Scenario: Save a grupo

- **GIVEN** un hit con URL válida y un `groupId` de membresía del usuario
- **WHEN** el cliente guarda con ese `groupId`
- **THEN** SHALL aplicarse el camino existente de save a grupo (share /
  already_there según reglas de links)
