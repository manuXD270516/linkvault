## Why

El repositorio solo contiene documentación, specs y automatización: no existe todavía ninguna base ejecutable
sobre la que construir los 14 changes siguientes. Sin el andamiaje del monorepo (proyectos, límites de capas
verificables, entorno local reproducible y CI), cada change posterior tendría que inventar su propia estructura
y las reglas duras de `CLAUDE.md` quedarían como texto no verificable. Este change crea ese cimiento y **nada más**:
sin features de negocio.

## What Changes

- **Workspace Nx + pnpm** (preset integrado, alias `@linkvault/*`) con cinco proyectos de producto: `apps/api` (NestJS 11
  sobre Fastify), `apps/worker` (NestJS con BullMQ cableado pero sin jobs), `apps/web` (Angular 22 standalone y zoneless),
  `libs/shared` y `libs/ai`; más proyectos de soporte en `tools/` (`test-env`, `testing`, `workspace-rules`) que no son dependencia
  de ningún proyecto de producto.
- **`libs/shared`**: carpetas de contratos (`schemas/`, `enums/`, `events/`), sin schemas de negocio.
- **`libs/ai`**: árbol de carpetas de ADR-014 y los **ports como tipos TypeScript** (`LlmProvider`, `ProviderCapabilities`,
  `CompletionRequest`, `CompletionResult`, `AiTask`, errores tipados). Sin proveedores ni `runTask`: eso es `ai-gateway-core`.
- **Límites verificables por lint** (ADR-017): tags de ámbito, tipo y plataforma con `@nx/enforce-module-boundaries`;
  lista cerrada de paquetes prohibidos en `domain/`; lista cerrada de SDKs de IA prohibidos fuera de
  `libs/ai/infrastructure/providers`; prohibición de `any` explícito y `console`. Un único test tabular cubre todas las reglas.
- **Vitest** en los cinco proyectos y un helper de `mongodb-memory-server` en replica set para tests de integración.
- **Entorno local de solo infraestructura**: `docker-compose.yml` con MongoDB 7 en replica set `rs0` de un nodo
  (inicializado por su propio healthcheck), Redis 7, MinIO y Ollama bajo el perfil `ai-local`. Las apps corren en el host
  con `nx serve`. `.env.example` completo.
- **Arranque robusto de `api` y `worker`**: configuración validada al arrancar, conexiones perezosas a Mongo y Redis,
  logs con `pino` y redacción de secretos.
- **Salud en dos niveles** en `api` y `worker`: `GET /health/live` (el proceso vive) y `GET /health` (readiness sobre Mongo
  y Redis). Son los únicos endpoints del change.
- **Mismo origen en desarrollo**: la API expone sus rutas bajo `/api` (salvo `/health*`) y `apps/web` redirige `/api`
  a la API mediante proxy de desarrollo.
- **Andamiaje de `apps/web`**: Angular Material, Tailwind y `@angular/localize` (ES por defecto, EN declarado) con una
  única ruta placeholder.
- **CI (GitHub Actions)**: lint → `openspec validate --all` → typecheck → test → build, por afectación, con
  `AI_CHAIN=mock` y `AI_MOCK_MODE=replay`, sin servicios en el runner.
- **README** con los comandos de desarrollo y la salida documentada a Turborepo que pide ADR-011.

No hay cambios *BREAKING*: no existe nada previo que romper.

## Capabilities

### New Capabilities
- `platform/workspace`: estructura del monorepo y límites arquitectónicos que el lint y el typecheck hacen cumplir.
- `platform/runtime-health`: arranque de `api` y `worker` con configuración validada, y su salud en dos niveles.
- `platform/local-environment`: infraestructura de desarrollo reproducible, Mongo siempre en replica set y mismo origen
  entre web y API.
- `platform/ci-pipeline`: verificación automática en cada push y PR, con specs validadas y la IA fijada en mock.

### Modified Capabilities
<!-- Ninguna: openspec/specs/ está vacío. -->

## Impact

- **Código nuevo**: `apps/api`, `apps/worker`, `apps/web`, `libs/shared`, `libs/ai` (solo tipos), `tools/test-env`, `tools/workspace-rules`,
  `tools/testing`, `.github/workflows/`.
- **Configuración**: `nx.json`, `pnpm-workspace.yaml`, `package.json` raíz, `tsconfig.base.json`, `eslint.config.mjs`,
  `.gitattributes`, `.nvmrc`, `docker-compose.yml`, `.env.example`, `apps/web/proxy.conf.json`.
- **ADRs**: materializa ADR-001, 006, 007, 009, 011 y 014; crea **ADR-017** (decisiones de plataforma de este change).
- **Dependencias externas nuevas**: Nx, NestJS 11 + Fastify + `@nestjs/terminus`, Mongoose, ioredis, BullMQ, zod,
  `nestjs-pino`, Angular 22 + Material + Tailwind, Vitest + `unplugin-swc`, `mongodb-memory-server`,
  `@fission-ai/openspec` (fijado). Ningún SDK de proveedor de IA.
- **Sustituciones respecto a `docs/design.md` (v0.1)**: `packages/shared` y `packages/ai-providers` pasan a `libs/shared` y
  `libs/ai`; `AI_PROVIDER` pasa a `AI_CHAIN` + `AI_MOCK_MODE`.
- **Diferido a otros changes**: Dockerfiles e imágenes endurecidas (`deploy-prod`); guard contra `AI_MOCK_MODE=synth` y
  modelo concreto de Ollama (`ai-gateway-core`); restricción de imports entre módulos de dominio (`auth-users`).
- **Fuera de alcance**: autenticación, grupos, links, enriquecimiento, CV, `runTask`, proveedores de IA reales,
  Meilisearch, `/metrics`, Traefik y despliegue.
