## ADDED Requirements

### Requirement: Indicador de oferta cerrada

Cuando un link trae cierre (`closedAt` / `closedReason`), la tarjeta y el detalle en listas de grupo
y lista privada SHALL mostrar un indicador claro de que la oferta cerró, distinguible del estado de
enriquecimiento (`failed` / “sin vista previa”). El copy SHALL estar en i18n ES/EN. NO SHALL
ocultarse el preview existente solo por estar cerrada.

#### Scenario: Badge en tarjeta

- **GIVEN** un miembro viendo un link cerrado con título enriquecido
- **WHEN** mira la tarjeta
- **THEN** SHALL ver el indicador de oferta cerrada junto al título
- **AND** SHALL seguir viendo título y empresa

#### Scenario: i18n

- **WHEN** se comprueba `messages.en.xlf` tras extraer mensajes de este indicador
- **THEN** cada unidad nueva SHALL tener `target`
