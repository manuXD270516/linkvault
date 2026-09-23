## ADDED Requirements

### Requirement: Aviso al cerrar una vacante

Cuando un JobLink queda cerrado (por calendario o por re-check de frescura), el sistema SHALL
publicar por el canal de eventos de enriquecimiento el summary del link con `closedAt` y
`closedReason`, de modo que un SPA suscrito actualice la tarjeta sin pedir de nuevo toda la lista.

#### Scenario: Cierre llega por el canal

- **GIVEN** un cliente suscrito al canal de enriquecimiento de un ámbito donde ve el link
- **WHEN** ese link se cierra
- **THEN** SHALL recibirse un aviso con el `linkId` y `closedAt` presente
