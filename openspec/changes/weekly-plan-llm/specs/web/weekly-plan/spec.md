## ADDED Requirements

### Requirement: Aviso de selección con IA

Cuando la respuesta de `GET /api/applications/weekly-plan` (o de una decisión) trae `planner` `llm` y al menos una
acción, la tarjeta «Tu semana» SHALL mostrar debajo del título, en una sola línea de texto secundario, «Elegidas con IA
entre tus sugerencias de la semana.» (EN: «Chosen with AI from your suggestions for the week.»). Con `planner` `rules`, o
sin acciones, la línea NO SHALL mostrarse. Los motivos de cada acción SHALL seguir armándose en el SPA desde `reason`
con los mismos textos i18n (requirement «Motivos de las acciones»): el SPA NO SHALL mostrar texto redactado por un
modelo. El texto SHALL estar en el catálogo i18n en español e inglés con un id `@@applications.weeklyPlan.*`.

#### Scenario: Plan elegido con IA

- **GIVEN** Ana con un plan de tres acciones y `planner` `llm`
- **WHEN** abre `/postulaciones`
- **THEN** la tarjeta SHALL decir «Elegidas con IA entre tus sugerencias de la semana.»
- **AND** cada acción SHALL mostrar el mismo motivo que mostraría con `planner` `rules`

#### Scenario: Plan por reglas

- **GIVEN** Ana con un plan de tres acciones y `planner` `rules`
- **WHEN** abre `/postulaciones`
- **THEN** la tarjeta NO SHALL mostrar el aviso de selección con IA

#### Scenario: Aviso en inglés

- **GIVEN** la interfaz en inglés y un plan con `planner` `llm`
- **WHEN** Ana abre `/postulaciones`
- **THEN** la tarjeta SHALL decir «Chosen with AI from your suggestions for the week.»

#### Scenario: Sin acciones no hay aviso

- **GIVEN** un plan con `planner` `llm` y ninguna acción
- **WHEN** Ana abre `/postulaciones`
- **THEN** la tarjeta SHALL mostrar el estado vacío sin el aviso de selección con IA
