## Purpose

Deja constancia de que una sugerencia del informe no convence, para revisarla antes de convertirla en caso del golden.

## ADDED Requirements

### Requirement: No me convence

Quien tiene un análisis propio con una sugerencia SHALL poder marcarla como «no me convence». El sistema SHALL guardar quién, qué análisis, el índice de la sugerencia en el informe final, un hash corto del `after`, y el momento. NO SHALL borrar ni reescribir esa sugerencia en el informe. Otra persona NO SHALL poder marcar las sugerencias de un análisis ajeno.

#### Scenario: Ana marca una sugerencia suya

- **GIVEN** un informe de Ana con al menos una sugerencia
- **WHEN** marca «no me convence» en la primera
- **THEN** SHALL quedar un feedback con el índice 0 y un hash del `after`
- **AND** la sugerencia SHALL seguir en el informe

#### Scenario: Beto no marca lo de Ana

- **GIVEN** el mismo informe, visible solo como análisis de Ana
- **WHEN** Beto intenta marcar «no me convence»
- **THEN** la respuesta SHALL ser que ese análisis no es suyo
- **AND** NO SHALL crearse feedback

### Requirement: El feedback no entra solo al golden

El sistema SHALL poder exportar los feedbacks a un archivo de candidatos. Ese archivo NO SHALL incorporarse al golden de ninguna tarea hasta que una persona lo revise y lo promueva a propósito.

#### Scenario: Exportar no entrena

- **GIVEN** feedbacks guardados
- **WHEN** se exportan a candidatos
- **THEN** el golden de `match-cv` y el de `critique-suggestions` NO SHALL cambiar por ese export
