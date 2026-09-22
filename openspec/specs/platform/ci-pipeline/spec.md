# platform/ci-pipeline Specification

## Purpose

Asegura que cada push y cada pull request verifique de forma automática el lint, los tipos, los tests y la coherencia
de las specs, de modo que ninguna de las reglas duras del proyecto dependa de que alguien se acuerde de correrlas.

## Requirements

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

### Requirement: CD a staging en main

Tras un push o merge a `main`, el pipeline SHALL ejecutar la verificación existente (lint, specs, typecheck, tests, eval
cuando aplique, build) y, **solo si esa verificación pasa**, SHALL desplegar a **staging**. El fallo de cualquier etapa
de verificación NO SHALL disparar el despliegue a staging.

El despliegue a staging SHALL seguir el mecanismo cerrado: publicar imágenes en **GHCR**, luego actualizar el target
compose de staging (placeholders de host documentados) con **ssh + `docker compose pull` + `up`** (o equivalente
documentado con el mismo efecto), y ejecutar un smoke post-deploy de `GET /health` **contra el servicio `api` en la
red host/Docker** (no contra el origen HTTPS público de Traefik). El smoke SHALL exigir respuesta de readiness de Nest
(p. ej. checks de mongo/redis), no HTML del SPA. Un job que solo realiza dry-run **NO SHALL** satisfacer este
requirement.

#### Scenario: Merge a main verde despliega staging

- **GIVEN** un merge a `main` cuya verificación completa termina con éxito
- **WHEN** termina el workflow de CI/CD
- **THEN** SHALL haberse publicado imagen(es) en GHCR y actualizado el compose de staging
- **AND** el smoke post-deploy de `/health` SHALL haber corrido contra `api` en red interna/Docker
- **AND** el smoke NO SHALL haberse limitado a curl del entrypoint público Traefik
- **AND** el despliegue NO SHALL haberse iniciado antes de que verify terminara en éxito

#### Scenario: Verify fallido no despliega staging

- **GIVEN** un push a `main` cuya etapa de tests falla
- **WHEN** termina el workflow
- **THEN** NO SHALL desplegarse a staging
- **AND** NO SHALL contarse un dry-run como despliegue exitoso

### Requirement: CD a producción por tag semver

Al publicar un tag `v*` con forma semver (p. ej. `v1.2.3`), el pipeline SHALL ejecutar la verificación y, **solo si
pasa**, SHALL desplegar a **producción** con el mismo mecanismo (GHCR → compose pull+up del target prod → smoke
`/health` interno contra `api`, no Traefik público). Un tag que no cumpla el patrón documentado NO SHALL desplegar a
prod. El fallo de verify NO SHALL desplegar a producción. Dry-run **NO SHALL** satisfacer este requirement.

#### Scenario: Tag v* verde despliega prod

- **GIVEN** el tag `v1.0.0` publicado y la verificación en verde
- **WHEN** termina el workflow de release
- **THEN** SHALL haberse desplegado a producción vía GHCR + compose del target prod
- **AND** el smoke de `/health` SHALL haber corrido contra `api` en red interna/Docker

#### Scenario: Verify fallido no despliega prod

- **GIVEN** el tag `v1.0.1` y una etapa de verify fallida
- **WHEN** termina el workflow
- **THEN** NO SHALL desplegarse a producción

#### Scenario: Push a main no despliega prod

- **GIVEN** un merge a `main` en verde
- **WHEN** termina el CD de staging
- **THEN** NO SHALL haberse desplegado a producción por ese solo evento
- **AND** el despliegue a prod SHALL quedar reservado al tag `v*`
