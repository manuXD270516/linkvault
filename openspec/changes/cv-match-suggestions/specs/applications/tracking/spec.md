## MODIFIED Requirements

### Requirement: Puntuación de encaje reservada

La postulación SHALL tener un campo opcional `fitScore` (entero de 0 a 100) que refleja el **`score` del último análisis
de encaje** —el más reciente por fecha de finalización— de esa persona sobre ese link, y un campo `fitScoreDegraded`
(booleano) que dice si ese número viene de un análisis degradado. `fitScore` SHALL derivarse siempre del análisis: la
postulación NO SHALL tener una puntuación propia que se edite a mano ni por ninguna otra operación.

- **Sin ningún análisis** de esa persona sobre ese link, la postulación SHALL quedar **sin `fitScore`** y sin
  `fitScoreDegraded`. La ausencia SHALL representarse como campo ausente o nulo, **nunca como `0`**: "todavía no lo
  analizaste" y "no encajas nada" no pueden verse igual.
- **Un análisis degradado también puntúa**, y lo dice: su `score` SHALL rellenar `fitScore` con `fitScoreDegraded`
  `true`. Quien recibe la puntuación SHALL poder distinguir siempre las dos procedencias, y ninguna respuesta SHALL
  entregar `fitScore` sin `fitScoreDegraded`.
- **Rehacer el análisis SHALL sustituir la puntuación** por la del análisis nuevo, aunque sea más baja o aunque pase de
  completa a degradada. `fitScore` sigue al último análisis, no al mejor.
- **Seguir una oferta ya analizada** SHALL crear la postulación con la puntuación del último análisis que ya existía, sin
  pedir uno nuevo. Si deja de quedar ningún análisis de esa persona sobre ese link, la postulación SHALL quedar otra vez
  sin `fitScore` ni `fitScoreDegraded`.
- **Actualizar la puntuación NO es un cambio de estado**: NO SHALL subir `version`, NO SHALL tocar `statusChangedAt` y
  NO SHALL escribir ningún evento de historial, de modo que un análisis que termina mientras alguien tiene la pantalla
  abierta nunca SHALL provocar un `409 application_conflict`.
- La postulación SHALL llevar **solo el número y su procedencia**: NO SHALL incluir el informe, sus `suggestions`, sus
  `matchedSkills` ni `missingSkills`, ningún fragmento del CV ni ningún dato del proveedor que lo produjo.

Toda respuesta de la API que devuelva una postulación SHALL incluir `fitScore` y `fitScoreDegraded` cuando los haya,
junto a los demás campos de la postulación.

#### Scenario: La puntuación aparece tras el análisis

- **GIVEN** una postulación de Ana sobre una oferta, sin puntuación
- **WHEN** termina un análisis de encaje de Ana sobre esa oferta con `score` 78 y sin degradación
- **THEN** su postulación SHALL tener `fitScore` 78 y `fitScoreDegraded` `false`

#### Scenario: La respuesta no lleva la puntuación

- **GIVEN** una postulación de alguien que nunca analizó esa oferta
- **WHEN** se convierte a su representación en la API
- **THEN** la representación NO SHALL contener `fitScore` ni `fitScoreDegraded`
- **AND** NO SHALL contener `fitScore` con valor `0`

#### Scenario: Un análisis básico puntúa y lo dice

- **GIVEN** Ana sin consentimiento para proveedores externos y con el proveedor local caído
- **WHEN** termina un análisis degradado con `score` 41 sobre una oferta que sigue
- **THEN** su postulación SHALL tener `fitScore` 41 y `fitScoreDegraded` `true`

#### Scenario: Rehacer el análisis manda

- **GIVEN** una postulación con `fitScore` 78 procedente de un análisis completo
- **WHEN** Ana vuelve a analizar esa oferta y el análisis nuevo devuelve `score` 63
- **THEN** su postulación SHALL tener `fitScore` 63

#### Scenario: Seguir una oferta ya analizada

- **GIVEN** Ana con un análisis terminado sobre una oferta que todavía no sigue
- **WHEN** pide seguirla con `status` `interested`
- **THEN** la respuesta SHALL ser `201` con el `fitScore` de ese análisis

#### Scenario: La puntuación no pisa a las pestañas abiertas

- **GIVEN** una postulación en `interested` con `version` 1 abierta en una pestaña
- **WHEN** termina un análisis de esa oferta y después su dueña la pasa a `applied` con `version` 1
- **THEN** el cambio de estado SHALL responder `200` con `version` 2
- **AND** el historial SHALL tener un único evento nuevo, el del cambio de estado

#### Scenario: La postulación no lleva el informe

- **GIVEN** un análisis terminado con `score`, `matchedSkills`, `missingSkills` y sugerencias
- **WHEN** se consulta la postulación de esa oferta
- **THEN** la respuesta SHALL contener `fitScore` y `fitScoreDegraded`
- **AND** NO SHALL contener ninguna sugerencia, ninguna lista de skills ni ningún fragmento del CV
