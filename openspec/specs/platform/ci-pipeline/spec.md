# platform/ci-pipeline Specification

## Purpose

Asegura que cada push y cada pull request verifique de forma automática el lint, los tipos, los tests y la coherencia
de las specs, de modo que ninguna de las reglas duras del proyecto dependa de que alguien se acuerde de correrlas.

## Requirements

### Requirement: Etapas de verificación

La integración continua SHALL ejecutarse en cada push a `main` y en cada pull request, y SHALL correr, en este orden:
lint, validación de las specs de OpenSpec, typecheck, tests y build. El fallo de cualquier etapa SHALL marcar la
ejecución como fallida y NO SHALL ejecutar las etapas posteriores.

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

### Requirement: Herramientas con versión fijada

El pipeline SHALL obtener las versiones de Node, pnpm y del CLI de OpenSpec desde archivos versionados del repositorio,
y NO SHALL depender de herramientas instaladas globalmente en el runner.

#### Scenario: Runner limpio

- **WHEN** se ejecuta el pipeline en un runner recién aprovisionado
- **THEN** SHALL usar la versión de Node, pnpm y OpenSpec declarada en el repositorio

### Requirement: La IA fijada en mock durante los tests

La etapa de tests SHALL ejecutarse con `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` definidos en el entorno del proceso de test,
aunque existan otras variables de IA en el entorno del runner.

#### Scenario: Variables de la cadena de IA

- **WHEN** un test lee el entorno durante la etapa de tests
- **THEN** `AI_CHAIN` SHALL valer `mock`
- **AND** `AI_MOCK_MODE` SHALL valer `replay`

### Requirement: Tests de integración sin servicios externos

Los tests que necesiten MongoDB SHALL levantar una instancia efímera en replica set de un nodo, de la misma versión mayor
que la infraestructura local, sin depender de servicios declarados en el runner.

#### Scenario: Transacción en el test de integración

- **GIVEN** un test que abre una transacción multi-documento
- **WHEN** se ejecuta en CI
- **THEN** SHALL pasar

#### Scenario: Runner sin servicios declarados

- **WHEN** se ejecuta el pipeline en un runner sin MongoDB ni Redis
- **THEN** la etapa de tests SHALL completarse

### Requirement: Verificación acotada por afectación

El pipeline SHALL limitar lint, typecheck, tests y build a los proyectos afectados respecto de la base del cambio. Un
cambio en la configuración compartida del workspace (`nx.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.nvmrc`,
`package.json` raíz o `pnpm-lock.yaml`) SHALL afectar a todos los proyectos.

#### Scenario: Cambio acotado a un proyecto

- **GIVEN** un cambio que solo modifica archivos de `apps/web`
- **WHEN** se calculan los proyectos afectados
- **THEN** la lista SHALL incluir `web`
- **AND** NO SHALL incluir `api` ni `worker`

#### Scenario: Cambio en configuración compartida

- **GIVEN** un cambio que modifica `eslint.config.mjs`
- **WHEN** se calculan los proyectos afectados
- **THEN** la lista SHALL incluir todos los proyectos
