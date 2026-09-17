# platform/workspace Specification

## Purpose

Define la estructura del monorepo de LinkVault y los límites arquitectónicos que deben ser verificables de forma
automática, para que las reglas de clean architecture y el aislamiento del módulo de IA no dependan de la disciplina
de quien escribe el código.

## Requirements

### Requirement: Proyectos del workspace

El workspace SHALL contener los proyectos de producto `api`, `worker`, `web`, `shared` y `ai`. Los cinco SHALL exponer
los targets `lint`, `typecheck` y `test`, y los tres de `apps/` SHALL exponer además `build`. El workspace PUEDE contener
proyectos de soporte: los de utilidades de test llevan el tag `type:test-util` y los demás (reglas, e2e) `type:tooling`.
El código de producción de un proyecto de producto NO SHALL importar ninguno de los dos; los archivos de test de un
proyecto de producto PUEDEN importar `type:test-util`, y nunca `type:tooling`.

#### Scenario: Proyectos de producto y sus targets

- **WHEN** se inspecciona el grafo de proyectos del workspace
- **THEN** SHALL aparecer `api`, `worker`, `web`, `shared` y `ai`
- **AND** cada uno SHALL declarar `lint`, `typecheck` y `test`
- **AND** `api`, `worker` y `web` SHALL declarar además `build`

#### Scenario: Código de producción importa utilidades de test

- **GIVEN** un archivo de código de producción de `apps/api`
- **WHEN** importa código de un proyecto con tag `type:test-util` o `type:tooling`
- **THEN** el lint SHALL fallar por violación de límites de módulo

#### Scenario: Un test importa utilidades de test

- **GIVEN** un archivo de test de `apps/api`
- **WHEN** importa código de un proyecto con tag `type:test-util`
- **THEN** el lint SHALL pasar

### Requirement: Aislamiento de los SDKs de proveedores de IA

Ningún archivo fuera de `libs/ai/infrastructure/providers` SHALL importar un SDK de proveedor de modelos de lenguaje.
La lista prohibida SHALL ser cerrada e incluir al menos `@anthropic-ai/*`, `openai`, `openai/*`, `ollama`, `ollama/*`,
`openrouter` y `@openrouter/*`. El incumplimiento SHALL ser detectado por el lint.

#### Scenario: Import de un SDK fuera de la carpeta de proveedores

- **GIVEN** un archivo en `apps/worker`
- **WHEN** ese archivo importa `openai` o `@anthropic-ai/sdk`
- **THEN** el lint SHALL fallar con un error que nombre la ruta permitida

#### Scenario: Import de un SDK dentro de la carpeta de proveedores

- **GIVEN** un archivo dentro de `libs/ai/infrastructure/providers`
- **WHEN** ese archivo importa un SDK de proveedor
- **THEN** el lint SHALL pasar

#### Scenario: Violaciones superpuestas en el dominio de la librería de IA

- **GIVEN** un archivo en `libs/ai/domain/`
- **WHEN** importa a la vez `@nestjs/common` y `openai`
- **THEN** el lint SHALL reportar ambas violaciones, no solo una

### Requirement: Aislamiento de la capa de dominio

Ningún archivo bajo una carpeta `domain/` de cualquier proyecto SHALL importar paquetes de infraestructura. La lista
prohibida SHALL ser cerrada e incluir al menos `@nestjs/*`, `mongoose`, `mongodb`, `bullmq`, `ioredis`, `fastify`,
`@fastify/*`, `@aws-sdk/*`, `minio`, `pino` y `nestjs-pino`. Además, ningún archivo bajo
`apps/api/src/modules/<módulo>/domain/` SHALL importar código de otro módulo de `apps/api/src/modules/`. El incumplimiento
SHALL ser detectado por el lint.

#### Scenario: El dominio importa el framework

- **GIVEN** un archivo bajo una carpeta `domain/` de `apps/api`
- **WHEN** ese archivo importa `@nestjs/common`, `mongoose` o `bullmq`
- **THEN** el lint SHALL fallar

#### Scenario: La infraestructura importa el framework

- **GIVEN** un archivo bajo una carpeta `infrastructure/` del mismo módulo
- **WHEN** ese archivo importa `@nestjs/common`, `mongoose` o `bullmq`
- **THEN** el lint SHALL pasar

#### Scenario: El dominio importa otro módulo

- **GIVEN** un archivo bajo `apps/api/src/modules/auth/domain/`
- **WHEN** ese archivo importa un archivo de `apps/api/src/modules/users/`
- **THEN** el lint SHALL fallar

#### Scenario: El dominio importa su propio módulo

- **GIVEN** un archivo bajo `apps/api/src/modules/auth/domain/`
- **WHEN** ese archivo importa otro archivo de `apps/api/src/modules/auth/domain/`
- **THEN** el lint SHALL pasar

### Requirement: Dependencias permitidas entre proyectos

Las dependencias entre proyectos SHALL estar restringidas por tags. Ningún proyecto de `libs/` SHALL depender de un
proyecto de `apps/`. `shared` NO SHALL depender de ningún otro proyecto. `ai` SHALL depender únicamente de `shared`.
Un proyecto de plataforma navegador NO SHALL depender de un proyecto de plataforma Node: `web` es navegador, `ai`, `api`
y `worker` son Node, y `shared` es válido para ambas.

#### Scenario: Una librería importa una aplicación

- **GIVEN** un archivo de `libs/shared` o `libs/ai`
- **WHEN** importa código de `apps/api`, `apps/worker` o `apps/web`
- **THEN** el lint SHALL fallar por violación de límites de módulo

#### Scenario: shared importa ai

- **GIVEN** un archivo de `libs/shared`
- **WHEN** importa código de `libs/ai`
- **THEN** el lint SHALL fallar

#### Scenario: La web importa la librería de IA

- **GIVEN** un archivo de `apps/web`
- **WHEN** importa código de `libs/ai`
- **THEN** el lint SHALL fallar

### Requirement: Contratos del módulo de IA disponibles como tipos

`libs/ai` SHALL exponer los contratos de ADR-014 como tipos TypeScript: las capacidades de un proveedor, la forma de una
petición y de un resultado de completado, la definición de una tarea de IA y los errores tipados del módulo. `domain` SHALL
contener solo contratos y reglas puras; proveedores, adaptadores de persistencia y `runTask` SHALL vivir en `application` o
`infrastructure`; las definiciones de tareas en `tasks`; y la composición del módulo NestJS en `ai.module.ts`. Ningún
archivo de `domain` SHALL importar de `application`, `infrastructure`, `tasks` ni `ai.module.ts`.

#### Scenario: Los contratos compilan y son importables

- **WHEN** `apps/worker` importa los tipos públicos de `libs/ai` por su alias del workspace
- **THEN** el typecheck SHALL pasar sin errores

#### Scenario: El árbol de carpetas refleja el ADR-014

- **WHEN** se inspecciona la raíz de fuentes de `libs/ai`
- **THEN** SHALL existir `domain/ports`, `application`, `infrastructure/providers`, `infrastructure/prompts`,
  `infrastructure/fixtures` y `evals`

### Requirement: Prohibición de any y de console

El código de los proyectos de producto NO SHALL usar el tipo `any` explícito ni llamadas a `console`. El incumplimiento
SHALL ser detectado por el lint.

#### Scenario: Uso de any explícito

- **WHEN** un archivo de un proyecto de producto declara un tipo `any` explícito
- **THEN** el lint SHALL fallar

#### Scenario: Uso de console

- **WHEN** un archivo de un proyecto de producto llama a `console.log`
- **THEN** el lint SHALL fallar
