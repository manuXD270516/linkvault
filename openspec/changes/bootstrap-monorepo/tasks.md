## 1. Base del workspace

- [x] 1.1 [infra] Inicializar el workspace Nx integrado con pnpm (`nx.json`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json` en modo strict) (D1); verificar que `pnpm nx report` lista Nx y sus plugins.
- [x] 1.2 [infra] Fijar `.nvmrc` (Node 22 LTS), el campo `packageManager` con la versión exacta de pnpm y `@fission-ai/openspec` como devDependency fijada; verificar que `pnpm install` desde un clon limpio no emite avisos de versión y que `pnpm exec openspec --version` responde.
- [x] 1.3 [infra] Cambiar `.gitattributes` a `* text=auto eol=lf` con los binarios marcados, y ejecutar `git add --renormalize .` seguido de `git checkout -- .` (D13); verificar que `git ls-files --eol` muestra `i/lf w/lf` en todos los archivos de texto.
- [x] 1.4 [infra] Configurar `eslint.config.mjs` (sin reglas con información de tipos, D4) y Prettier base (`endOfLine: "lf"`), y declarar `namedInputs.sharedGlobals` en `nx.json` con rutas `{workspaceRoot}/` (D1); verificar que `pnpm nx run-many -t lint` pasa sobre el workspace vacío.

## 2. Infraestructura local

- [x] 2.1 [infra] Escribir el servicio `mongo` en `docker-compose.yml` con `--replSet rs0`, `hostname: mongo` y el healthcheck idempotente basado en `NotYetInitialized` e `isWritablePrimary` (D6); verificar con `docker compose up -d --wait mongo` sobre volumen vacío y repitiendo sobre el volumen existente, sin error en ninguno.
- [x] 2.2 [infra] Añadir `redis` (healthcheck `redis-cli ping`), `minio` (healthcheck `mc ready local`) y `ollama` bajo el perfil `ai-local` (D6); verificar que `docker compose up -d --wait` deja mongo, redis y minio saludables sin ollama, y que con `--profile ai-local` ollama responde en su puerto del host.

## 3. Proyectos y corredor de tests

- [x] 3.1 [backend] Generar `apps/api` con `@nx/nest`, adaptador Fastify, `--e2eTestRunner=none` y tags `scope:api type:app platform:node`; verificar que `pnpm nx build api` produce el bundle.
- [x] 3.2 [backend] Generar `apps/worker` con `@nx/nest`, `--e2eTestRunner=none` y tags `scope:worker type:app platform:node`; verificar que `pnpm nx build worker` produce el bundle.
- [x] 3.3 [infra] Configurar Vitest con `unplugin-swc` en `api` y `worker`, con un test que instancie un módulo Nest con un proveedor inyectado (D5); verificar que `pnpm nx run-many -t test -p api,worker` pasa.
- [x] 3.4 [frontend] Generar `apps/web` con `@nx/angular` standalone y zoneless, `--e2eTestRunner=none`, builder de tests `@angular/build:unit-test` y tags `scope:web type:app platform:browser` (D5); verificar que `pnpm nx build web` y `pnpm nx test web` pasan y que el bundle no incluye Zone.js.
- [x] 3.5 [backend] Generar `libs/shared` con alias `@linkvault/shared`, carpetas `schemas/`, `enums/`, `events/`, Vitest y tags `scope:shared type:lib platform:any`; verificar que `apps/api` importa un enum de prueba por el alias y que `pnpm nx build api` pasa.
- [x] 3.6 [ai] Generar `libs/ai` con alias `@linkvault/ai`, el árbol de ADR-014 bajo `src/` (con `.gitkeep` donde no haya archivos), Vitest y tags `scope:ai type:lib platform:node`; verificar que el árbol coincide con el escenario "El árbol de carpetas refleja el ADR-014".
- [x] 3.7 [infra] Declarar el target `typecheck` explícito en los cinco proyectos (D1); verificar con `pnpm nx show project <p> --json` que existe en los cinco y que `pnpm nx run-many -t typecheck` pasa.

## 4. Tooling de tests

- [x] 4.1 [infra] Generar `tools/test-env` con tags `scope:tooling type:test-util platform:any` y un preset de Vitest que solo fija `test.env` (`AI_CHAIN=mock`, `AI_MOCK_MODE=replay`), sin dependencias de Node (D7); verificar con un test propio que ve ambos valores.
- [x] 4.2 [infra] Generar `tools/testing` con tags `scope:tooling type:test-util platform:node`, un preset que extiende `tools/test-env` y añade el `globalSetup` con `MongoMemoryReplSet` de un nodo y `MONGOMS_VERSION` exacta de la línea 7.0 (D7); verificar con un test que abre una transacción multi-documento y confirma.
- [x] 4.3 [infra] Añadir a `tools/testing` un servidor TCP de prueba que responde `PING` en protocolo RESP, con modos `up`, `stop` y `hang` controlables desde el test (D7); verificar con un test que ioredis recibe `PONG` en `up`, falla en `stop` y no recibe respuesta en `hang`.
- [x] 4.4 [infra] Generar `tools/workspace-rules` con tags `scope:tooling type:tooling platform:node` y un test que instancie `ESLint` con la configuración real del repo (D4); verificar que `pnpm nx test workspace-rules` pasa.
- [x] 4.5 [infra] Hacer que `shared` y `ai` extiendan el preset de `tools/test-env`, y `api` y `worker` el de `tools/testing` (`web` usa el builder de Angular con su propia configuración y no lee variables de IA); verificar que `pnpm nx run-many -t test -p api,worker,shared,ai` sigue pasando y que los tests de `shared` y `ai` no arrancan Mongo.

## 5. Arranque de las apps backend

- [x] 5.1 [backend] Implementar la validación de configuración con zod en `infrastructure/config` de `api`, con salida de error por `process.stderr.write`, y escribir `.env.example` con todas las variables, `AI_CHAIN=mock`, `AI_MOCK_MODE=replay`, `FEATURE_HEADLESS_EXTRACTION=false` y la URI de Mongo con `directConnection=true` (D6, D8); verificar con un test que una variable ausente termina el proceso nombrándola sin su valor y que `.env.example` pasa la validación.
- [x] 5.2 [backend] Aplicar la misma validación de configuración a `worker`, incluida `WORKER_HEALTH_PORT`; verificar con el mismo par de tests en `worker`.
- [x] 5.3 [backend] Cablear `nestjs-pino` en `api` y `worker` con las rutas de redacción de D11; verificar con un test que registra una petición con `authorization` y `cookie`, un objeto con `apiKey` en la raíz, y otro con `refreshToken` a un nivel y `apiKey` a dos niveles, y comprueba que ningún valor aparece.
- [x] 5.4 [backend] Registrar Mongoose (`lazyConnection`, con reintento de `openUri` y backoff tope 2 s si la conexión inicial falla) y el cliente de salud de ioredis (`lazyConnect`, sin cola offline, `maxRetriesPerRequest: 1`, backoff tope 2 s, `connect()` sin esperar en `onModuleInit`) en `api` (D8); verificar con un test que la app arranca con ambas URIs apuntando a puertos cerrados.
- [x] 5.5 [backend] Crear `worker` con `NestFactory.create` y `FastifyAdapter` escuchando en `WORKER_HEALTH_PORT`, con las mismas conexiones que `api` más `BullModule.forRoot` (`maxRetriesPerRequest: null`) sin colas registradas (D8, D9); verificar con un test que el worker arranca con Mongo y Redis apagados.
- [x] 5.6 [backend] Aplicar `setGlobalPrefix('api', { exclude: ['health', 'health/live'] })` en `api` (D10); verificar con un test que `GET /api/<inexistente>` devuelve 404 JSON de Nest.

## 6. Salud

- [x] 6.1 [backend] Exponer `GET /health/live` en `api` y `worker` con `service` y `version` (desde `APP_VERSION` o `package.json`) (D9); verificar con un test por app que responde 200 en < 1 s con Mongo y Redis apagados y sin credenciales.
- [x] 6.2 [backend] Implementar los indicadores de Mongo y Redis con timeout de 500 ms en `infrastructure/health` de `api`, que devuelven `down` sin propagar el mensaje del driver (D9); verificar con tests unitarios de indicador para `up`, `down` y dependencia colgada.
- [x] 6.3 [backend] Exponer `GET /health` en `api` con terminus y un controlador que adapta su salida (incluida la excepción de 503) al JSON de la spec; verificar con la suite de integración (Mongo de `tools/testing` y doble de Redis) que cubre 200 con todo arriba y 503 con Redis en `stop`.
- [x] 6.4 [backend] Ampliar la suite de 6.3 con cuatro filas: dependencia en `hang` responde 503 en ≤ 1500 ms; URI con usuario y contraseña contra un puerto cerrado no expone URI, usuario, contraseña ni mensaje del driver; el doble de Redis pasando de `stop` a `up` lleva `GET /health` a 200 sin reiniciar la app; y la app arrancada antes que `MongoMemoryReplSet` pasa a 200 cuando Mongo aparece, sin reiniciar. Verificar que la suite pasa.
- [x] 6.5 [backend] Replicar indicadores y `GET /health` en `worker` con `service: "worker"`; verificar con la suite de 6.3–6.4 parametrizada contra el puerto del worker.

## 7. Frontend

- [x] 7.1 [frontend] Configurar Angular Material y Tailwind en `apps/web` (D12); verificar que `pnpm nx build web` pasa y que el CSS generado contiene una utilidad de Tailwind usada en el placeholder.
- [x] 7.2 [frontend] Configurar `@angular/localize` con ES como locale fuente y EN declarado; verificar que `pnpm nx build web` pasa sin errores de extracción.
- [x] 7.3 [frontend] Crear la ruta placeholder con carga diferida y su test de render; verificar que `pnpm nx test web` pasa.
- [x] 7.4 [frontend] Añadir `apps/web/proxy.conf.json` que reenvía `/api` a `http://localhost:3000` y referenciarlo en el target `serve` (D10); verificar con `api` y `web` en marcha que `GET http://localhost:4200/api/<inexistente>` devuelve el 404 JSON de la API.

## 8. Contratos de IA

- [x] 8.1 [ai] Escribir `libs/ai/src/domain/ports/llm-provider.port.ts` con `ProviderCapabilities`, `CompletionRequest`, `CompletionResult` y `LlmProvider` según design-v0.2 §4.2; verificar que `pnpm nx typecheck ai` pasa.
- [x] 8.2 [ai] Escribir `libs/ai/src/domain/task.ts` (`AiTask`) y `libs/ai/src/domain/errors.ts` (`SchemaViolation`, `ProviderUnavailable`, `QuotaExceeded`, `FixtureMissing`) y exportarlos desde `index.ts`; verificar que `apps/worker` los importa por `@linkvault/ai` y que `pnpm nx typecheck worker` pasa.

## 9. Límites arquitectónicos

- [x] 9.1 [infra] Configurar `@nx/enforce-module-boundaries` en dos bloques (general y archivos de test) construidos desde un único array de restricciones compartido (D2); verificar que `pnpm nx run-many -t lint` pasa en el estado actual, incluidos los tests que importan `tools/testing`.
- [x] 9.2 [infra] Añadir el bloque `no-restricted-imports` para `**/domain/**` con la lista cerrada de la spec (D3); verificar que `pnpm nx run-many -t lint` sigue pasando.
- [x] 9.3 [ai] Añadir el bloque `@typescript-eslint/no-restricted-imports` para SDKs de IA con la lista cerrada y la exclusión de `libs/ai/src/infrastructure/providers/**` (D3); verificar que `pnpm nx run-many -t lint` sigue pasando.
- [x] 9.4 [infra] Activar `@typescript-eslint/no-explicit-any` y `no-console` como error en proyectos de producto; verificar que `pnpm nx run-many -t lint` sigue pasando.
- [x] 9.5 [infra] Escribir en `tools/workspace-rules` el test tabular con `lintText` que cubre cada escenario de la spec `workspace`: código de producción importando `type:test-util` y `type:tooling` (falla), test importando `type:test-util` de su plataforma (pasa), test de `web` importando `tools/testing` (falla por plataforma), spec de `libs/shared` importando `@linkvault/ai` (falla), SDK fuera y dentro de providers, solapamiento en `libs/ai/src/domain`, dominio e infraestructura importando framework, lib→app, shared→ai, web→ai, `any` y `console` (D4); verificar que `pnpm nx test workspace-rules` pasa y que al desactivar cualquiera de las reglas su fila falla.

## 10. Integración continua

- [x] 10.1 [infra] Escribir `.github/workflows/ci.yml` con checkout `fetch-depth: 0`, pnpm desde `packageManager`, Node desde `.nvmrc`, `nrwl/nx-set-shas` y las etapas `affected lint` → `openspec validate --all` → `affected typecheck` → `affected test` → `affected build` (D14); verificar con `actionlint` que el workflow es válido.
- [x] 10.2 [ai] Definir `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` en el entorno de la etapa de tests del workflow y añadir en `tools/test-env` un test que compruebe que el proceso de test ve esos valores; verificar que el test pasa en local sin `.env` gracias al preset de 4.1.
- [x] 10.3 [infra] Cachear el store de pnpm y el directorio de binarios de `mongodb-memory-server` con `MONGOMS_VERSION` como clave; verificar en el workflow que la clave de caché incluye la versión.
- [x] 10.4 [infra] Verificar el cálculo de afectados sin commits de prueba: `pnpm nx show projects --affected --files=apps/web/src/main.ts` incluye `web` y excluye `api` y `worker`; `--files=eslint.config.mjs` incluye todos.

## 11. Documentación y cierre

- [ ] 11.1 [infra] Escribir `README.md` con prerrequisitos (Node, pnpm, Docker, VC++ en Windows), `docker compose up -d --wait`, `pnpm nx serve api|worker|web`, perfil `ai-local`, URI de Mongo desde host y desde contenedor, y un párrafo de salida a Turborepo (ADR-011); verificar siguiendo el README desde un clon limpio hasta `GET /health` 200 en `api` y `worker`.
- [ ] 11.2 [infra] Ejecutar `pnpm nx run-many -t lint,typecheck,test,build` y `pnpm exec openspec validate --all` sobre el workspace completo; verificar que todo pasa en verde antes de abrir el PR.
