## ADDED Requirements

### Requirement: Evaluación de IA en replay

Cuando el proyecto `ai` está afectado, el pipeline SHALL ejecutar, después de los tests, la evaluación en replay de todas las
tareas evaluables comparada con sus líneas base, con el entorno de IA fijado en mock y sin contactar a ningún proveedor real, y
SHALL fallar si alguna evaluación termina con error.

#### Scenario: Pipeline sin regresión

- **GIVEN** un cambio que afecta a `ai` sin alterar resultados de replay
- **WHEN** se ejecuta el pipeline
- **THEN** la etapa de evaluación SHALL pasar

#### Scenario: Pipeline con regresión

- **GIVEN** un cambio que modifica `skills_recall` en replay respecto a la línea base
- **WHEN** se ejecuta el pipeline
- **THEN** la etapa de evaluación SHALL fallar nombrando la métrica

#### Scenario: Cambio que no afecta a ai

- **GIVEN** un cambio que solo modifica `apps/web`
- **WHEN** se ejecuta el pipeline
- **THEN** la etapa de evaluación NO SHALL ejecutarse
