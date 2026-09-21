## Purpose

Pantalla del plan de estudio: CTA desde el match, sondeo del estado, vista por semanas y export Markdown.

## ADDED Requirements

### Requirement: CTA y estados

Tras un match `done` no degradado con `missingSkills`, el SPA SHALL ofrecer CTA hacia el roadmap. La vista SHALL soportar `generating` (esperar/sondear), `ready` (ítems) y `failed` (mensaje honesto, sin inventar plan). Sin skills faltantes, NO SHALL mostrar CTA vacío.

#### Scenario: Ve el plan

- **GIVEN** roadmap `ready`
- **WHEN** Ana abre la vista
- **THEN** ve ítems con skill y recursos
- **AND** un recurso no verificado se distingue de uno verificado

#### Scenario: Todavía genera

- **GIVEN** `generating`
- **WHEN** abre la vista
- **THEN** ve estado de espera
- **AND** NO muestra un plan vacío como si estuviera listo

### Requirement: Export desde la UI

SHALL existir acción de exportar que descarga el Markdown del servidor (`roadmap.md`), no un prompt en el cliente.

#### Scenario: Descarga

- **GIVEN** vista con roadmap `ready`
- **WHEN** exporta
- **THEN** obtiene el Markdown del API
