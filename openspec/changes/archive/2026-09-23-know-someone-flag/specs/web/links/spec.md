## ADDED Requirements

### Requirement: Control know-someone en card de grupo

En la vista de links de un **grupo**, cada card SHALL mostrar un control para marcar/desmarcar
“conozco a alguien ahí” y, si `count > 0`, un indicador del conteo. La lista privada de links NO
SHALL mostrar el control. Copy i18n ES/EN. Al cambiar el control, la UI SHALL llamar al PUT de know-someone y **fusionar localmente**
`{ flaggedByMe, count }` en el ítem de la lista (sin reemplazar toda la card ni perder
note/comments/publicShare).

#### Scenario: Marcar desde la card

- **GIVEN** Ana en el detalle del grupo viendo un link
- **WHEN** activa “conozco a alguien ahí”
- **THEN** la petición SHALL enviar `flagged=true`
- **AND** la UI SHALL mostrar que ella lo marcó (y el conteo actualizado)

#### Scenario: Lista privada sin control

- **GIVEN** Ana en su lista privada de links
- **WHEN** ve una card
- **THEN** NO SHALL existir el control know-someone
