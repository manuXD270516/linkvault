## MODIFIED Requirements

### Requirement: Etapas de verificación

La integración continua SHALL ejecutarse en cada push a `main` y en cada pull request, y SHALL correr, en este orden:
lint, validación de las specs de OpenSpec, typecheck, tests, comprobación del catálogo de traducciones del SPA (solo cuando
`web` está afectado), evaluación de IA en replay (solo cuando `ai` está afectado) y build. El fallo de cualquier etapa SHALL
marcar la ejecución como fallida y NO SHALL ejecutar las etapas posteriores.

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

#### Scenario: Catálogo de traducciones atrasado detiene el pipeline

- **GIVEN** un pull request que añade un texto marcado para i18n en una plantilla de `apps/web` sin regenerar el catálogo
  fuente
- **WHEN** se ejecuta el pipeline
- **THEN** SHALL fallar en la comprobación del catálogo de traducciones
- **AND** NO SHALL ejecutar la evaluación de IA ni el build

#### Scenario: Cambio que no afecta a web

- **GIVEN** un cambio que solo modifica `apps/api`
- **WHEN** se ejecuta el pipeline
- **THEN** la comprobación del catálogo de traducciones NO SHALL ejecutarse


## ADDED Requirements

### Requirement: El CD verifica con las mismas etapas que la integración continua

La verificación previa a cualquier despliegue (el CD a staging y el CD a producción) SHALL ejecutar todas las etapas de
«Etapas de verificación», en su orden, incluida la comprobación del catálogo de traducciones del SPA, de modo que ningún
despliegue se salte una etapa que la integración continua sí exige. Donde otro requirement de esta spec enumere las etapas
de esa verificación, esta regla SHALL prevalecer sobre la enumeración. El CD a staging SHALL acotar las etapas por
afectación igual que la integración continua. El CD a producción SHALL ejecutarlas sobre todo el workspace, conforme a
«CD a producción por tag semver».

#### Scenario: Catálogo de traducciones atrasado no despliega staging

- **GIVEN** un push a `main` que afecta a `web` con el catálogo fuente atrasado respecto a las fuentes
- **WHEN** termina el workflow de CD a staging
- **THEN** su verificación SHALL fallar en la comprobación del catálogo de traducciones
- **AND** NO SHALL construirse, publicarse ni desplegarse el artefacto

#### Scenario: Catálogo de traducciones atrasado no despliega producción

- **GIVEN** un tag `v*` cuyo commit tiene el catálogo fuente atrasado respecto a las fuentes, aunque ese commit no toque
  `apps/web`
- **WHEN** termina el workflow de CD a producción
- **THEN** su verificación SHALL fallar en la comprobación del catálogo de traducciones
- **AND** NO SHALL desplegarse a producción
