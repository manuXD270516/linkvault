## ADDED Requirements

### Requirement: Pin y tags en card de grupo

En la vista de links de un **grupo**, cada card SHALL mostrar: (1) control para
fijar/desfijar; (2) chips de tags existentes; (3) forma de editar el conjunto de
tags (reemplazo completo vía API). La lista privada NO SHALL mostrar pin ni
tags. Copy i18n ES/EN. Tras PUT exitoso, la UI SHALL fusionar localmente solo
`{ pinned }` o `{ tags }` en el ítem (sin reemplazar toda la card ni perder
note/comments/knowSomeone/publicShare).

#### Scenario: Fijar desde la card

- **GIVEN** Ana en el detalle del grupo viendo un link no fijado
- **WHEN** activa fijar
- **THEN** la petición SHALL enviar `pinned=true`
- **AND** la UI SHALL reflejar el estado fijado

#### Scenario: Lista privada sin controles

- **GIVEN** Ana en su lista privada
- **WHEN** ve una card
- **THEN** NO SHALL existir control de pin ni editor de tags de grupo

### Requirement: Filtros de organización en listado de grupo

La vista de grupo SHALL ofrecer filtros “solo fijados” y por un tag, que
SHALL mapear a query params `pinned` / `tag` del listado API (no filtrar solo
en cliente sobre una página parcial). i18n ES/EN.

#### Scenario: Solo fijados

- **GIVEN** Ana en el detalle del grupo con varios links
- **WHEN** activa el filtro “solo fijados”
- **THEN** la UI SHALL pedir el listado con `pinned=true`
- **AND** SHALL mostrar solo los resultados de esa respuesta

#### Scenario: Reset de cursor al filtrar

- **GIVEN** Ana ya paginó (tiene `cursor`) en el listado del grupo
- **WHEN** cambia el filtro pinned o tag
- **THEN** la siguiente petición SHALL ir **sin** `cursor` (reinicia página)
