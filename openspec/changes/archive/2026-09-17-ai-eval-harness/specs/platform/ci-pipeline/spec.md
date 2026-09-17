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

## MODIFIED Requirements

### Requirement: Etapas de verificación

La integración continua SHALL ejecutarse en cada push a `main` y en cada pull request, y SHALL correr, en este orden:
lint, validación de las specs de OpenSpec, typecheck, tests, evaluación de IA en replay (solo cuando `ai` está afectado) y
build. El fallo de cualquier etapa SHALL marcar la ejecución como fallida y NO SHALL ejecutar las etapas posteriores.

#### Scenario: Lint fallido detiene el pipeline

- **GIVEN** una rama con una violación de una regla de lint
- **WHEN** se ejecuta el pipeline
- **THEN** SHALL fallar en la etapa de lint
- **AND** NO SHALL ejecutar typecheck, tests ni build

#### Scenario: Spec inválida detiene el pipeline

- **GIVEN** un change cuya spec no cumple el formato de OpenSpec
- **WHEN** se ejecuta el pipeline
- **THEN** SHALL fallar en la validación de specs
- **AND** NO SHALL ejecutar typecheck, tests ni build
