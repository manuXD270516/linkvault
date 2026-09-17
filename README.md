# LinkVault

Monorepo Nx (pnpm) con `api` (NestJS + Fastify), `worker` (NestJS + BullMQ), `web` (Angular 22 zoneless) y las
librerías `shared` y `ai`. En desarrollo, Docker solo levanta la infraestructura (MongoDB, Redis, MinIO) y las apps
corren en el host ([ADR-017](docs/adr/ADR-017.md)).

- Reglas del proyecto y flujo con Claude Code: [CLAUDE.md](CLAUDE.md)
- Flujo de trabajo por changes de OpenSpec: [docs/RUNBOOK.md](docs/RUNBOOK.md)
- Decisiones de arquitectura: [docs/adr/](docs/adr/)

## Prerrequisitos

- **Node.js** en la versión de [`.nvmrc`](.nvmrc) (línea 22 LTS), por ejemplo con `nvm use`.
- **pnpm** en la versión exacta del campo `packageManager` de [`package.json`](package.json) (`corepack enable` la
  activa).
- **Docker** con Docker Compose v2.
- **Windows**: el redistribuible de Visual C++ (x64), que necesita el binario de MongoDB que descargan los tests
  (`mongodb-memory-server`).

## Puesta en marcha

```bash
pnpm install
cp .env.example .env
docker compose up -d --wait        # mongo (replica set rs0), redis y minio, esperando a que estén sanos
```

Arranca cada app en su propia terminal:

```bash
pnpm nx serve api      # http://localhost:3000  (rutas de la API bajo /api)
pnpm nx serve worker   # http://localhost:3001  (solo rutas de salud)
pnpm nx serve web      # http://localhost:4200  (reenvía /api a la API: mismo origen)
```

Comprueba la salud (fuera del prefijo `/api`):

```bash
curl http://localhost:3000/health/live   # liveness: 200 si el proceso vive, sin consultar dependencias
curl http://localhost:3000/health        # readiness: 200 con Mongo y Redis arriba, 503 si alguno falla
curl http://localhost:3001/health        # lo mismo para el worker
```

Para bajar la infraestructura sin borrar datos: `docker compose down`.

### IA local con Ollama (opcional)

```bash
docker compose --profile ai-local up -d --wait   # añade ollama en http://localhost:11434
```

No descarga modelos. En desarrollo, `.env.example` usa el mock con `AI_CHAIN=mock` y `AI_MOCK_MODE=synth`; los tests y CI fuerzan `AI_CHAIN=mock` y `AI_MOCK_MODE=replay`. `AI_CHAIN=none` desactiva la IA (las tareas degradan).
Un worker compilado que no arranque desde la raíz del workspace necesita `AI_PROMPTS_DIR=dist/apps/worker/assets/ai/prompts` (o la ruta absoluta equivalente).

### MongoDB

MongoDB corre siempre como replica set de un nodo (`rs0`). Su healthcheck lo inicializa en el primer arranque, y el
contenedor no pasa a sano hasta que hay primario.

| Desde                              | URI                                                         |
| ---------------------------------- | ----------------------------------------------------------- |
| El host (apps con `nx serve`)      | `mongodb://localhost:27017/linkvault?directConnection=true` |
| Un contenedor de la red de compose | `mongodb://mongo:27017/linkvault?replicaSet=rs0`            |

Desde el host hace falta `directConnection=true`: el replica set anuncia `mongo:27017`, que el host no resuelve.

### Puertos ocupados por otro proyecto

Los puertos publicados en el host se configuran con `MONGO_PORT`, `REDIS_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT` y
`OLLAMA_PORT`. Docker Compose los lee del `.env`. Si otro proyecto ya usa el 6379, por ejemplo, pon en tu `.env`:

```dotenv
REDIS_PORT=6380
REDIS_URL=redis://localhost:6380
```

La URL de la app (`REDIS_URL`, `MONGO_URI`) debe apuntar al mismo puerto que publicas.

## Calidad

```bash
pnpm nx affected -t lint,typecheck,test        # solo lo afectado respecto de main
pnpm nx run-many -t lint,typecheck,test,build  # todo el workspace
pnpm exec openspec validate --all              # specs y changes de OpenSpec
```

Los tests usan un MongoDB efímero en replica set (`mongodb-memory-server`, sin Docker) y fijan la IA en mock. La
primera ejecución descarga el binario de MongoDB, unos 600 MB en Windows. CI (`.github/workflows/ci.yml`) ejecuta lint →
validación de OpenSpec → typecheck → test → build sobre los proyectos afectados.

## Estructura

| Ruta                    | Qué es                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/api`              | API HTTP (NestJS + Fastify). Rutas bajo `/api`; `/health` y `/health/live` fuera del prefijo.                |
| `apps/worker`           | Procesos en segundo plano (NestJS + BullMQ); solo expone salud en `WORKER_HEALTH_PORT`.                      |
| `apps/web`              | SPA Angular 22 standalone y zoneless, con Material, Tailwind e i18n ES/EN.                                   |
| `libs/shared`           | Contratos compartidos entre plataformas: schemas zod, enums y eventos de integración.                        |
| `libs/ai`               | Módulo de IA (ADR-014): ports, tareas y errores; los SDKs de proveedores solo en `infrastructure/providers`. |
| `tools/test-env`        | Preset de Vitest con las variables de IA en mock (todas las plataformas).                                    |
| `tools/testing`         | Preset de Vitest para Node con MongoDB efímero, doble de Redis y suite de contrato de salud.                 |
| `tools/workspace-rules` | Test tabular que comprueba las reglas de lint del workspace.                                                 |
| `openspec/`             | Specs y changes de OpenSpec.                                                                                 |
| `docs/`                 | Diseño, ADRs y runbook.                                                                                      |

Los límites entre proyectos (tags `scope:*`, `type:*`, `platform:*`), la capa de dominio, los SDKs de IA, `any` y
`console` se comprueban con lint (`eslint.config.mjs`).

## Problemas conocidos en Windows

- **`nx` colgado sin salida.** No canalices la salida de `nx` por un pipe (`pnpm nx ... | tail`). Si ese comando
  arranca el daemon de Nx, el daemon hereda el handle del pipe y quien lee nunca recibe EOF. Redirige la salida a un
  archivo (`pnpm nx run-many -t test > test.log 2>&1`) o desactiva el daemon (`NX_DAEMON=false`). Si el daemon queda
  deshabilitado ("Nx Daemon is going to be disabled until you run nx reset"), ejecuta `pnpm nx reset`.
- **Finales de línea.** El repo fuerza LF (`.gitattributes` con `* text=auto eol=lf`, Prettier con `endOfLine: lf`).
  Con `core.autocrlf=true` un script con CRLF falla con `bad interpreter`. Si ves CRLF en el disco, con el árbol
  limpio ejecuta `git add --renormalize .` (corrige el índice) y después `git checkout -- .` (reescribe los archivos).

## Salida a Turborepo

[ADR-011](docs/adr/ADR-011.md) eligió Nx con reservas y deja documentada la salida. Pasar a Turborepo supondría:

- un `package.json` con scripts por proyecto;
- un `turbo.json` con el pipeline `lint`, `typecheck`, `test` y `build`;
- sustituir `nx affected` por los filtros de Turborepo (`--filter=...[origin/main]`).

Se perderían los generadores oficiales de Nest y Angular, los targets inferidos por plugins y
`@nx/enforce-module-boundaries`, que habría que reemplazar por otra herramienta de límites (por ejemplo
`eslint-plugin-boundaries` o `dependency-cruiser`). La caché local de tareas tiene equivalente en Turborepo, y la
caché remota es opcional en ambos.
