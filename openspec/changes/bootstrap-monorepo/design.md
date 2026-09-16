## Context

El repositorio hoy solo tiene `docs/`, `openspec/` y `scripts/`. No hay `apps/` ni `libs/`, y `openspec/specs/` está vacío:
es un arranque en verde, sin migración ni compatibilidad hacia atrás que preservar. Ver `proposal.md` (§Why).

Restricciones que moldean el diseño:

- ADR-001 (monolito modular + worker), ADR-006 (Mongo/Redis/MinIO), ADR-007 (Angular 22 standalone zoneless), ADR-009
  (replica set en todos los entornos), ADR-011 (Nx), ADR-014 (SDKs de IA aislados por lint) y **ADR-017**, que registra
  las decisiones de plataforma tomadas en el debate de este change.
- `docs/design.md` (v0.1) queda superado en dos puntos: `packages/*` pasa a `libs/*`, y `AI_PROVIDER` pasa a
  `AI_CHAIN` + `AI_MOCK_MODE`.
- El flujo de desarrollo ya documentado en `docs/RUNBOOK.md` y en `/lv:smoke` es: `docker compose up -d --wait` para la
  infraestructura y `pnpm nx serve api|worker|web` en el host. El diseño se ajusta a ese flujo, no al revés.
- El equipo trabaja en Windows 11 con `core.autocrlf=true`; los finales de línea ya rompieron scripts en `2e26cac`.

Los requisitos observables están en `specs/platform/*/spec.md`; este documento no los repite.

## Goals / Non-Goals

**Goals:**

- Que las reglas duras de `CLAUDE.md` sean fallos de lint reproducibles, cubiertos por un test.
- Que la infraestructura local y los tests compartan versión mayor de Mongo y topología de replica set.
- Que `auth-users`, `groups` y `job-links` encuentren resueltos el arranque, la configuración, los logs, el mismo origen
  web/API y las transacciones de Mongo, sin tocar cimientos.
- Que `libs/ai` tenga su árbol y sus contratos, para que `ai-gateway-core` solo rellene implementaciones.

**Non-Goals:**

- Diseño interno de `runTask`, routing o pipeline estructurado (`ai-gateway-core`, ya resuelto en design-v0.2 §4).
- Imágenes de contenedor, compose de producción, Traefik, CD y `/metrics` (`deploy-prod`).
- Colecciones, índices o modelo de datos de negocio.
- Restricción de imports entre módulos de dominio: no hay dos módulos hasta `auth-users`, que la añade.

## Decisions

### D1 — Nx en preset integrado con generadores oficiales

Workspace integrado: paths en `tsconfig.base.json` con alias `@linkvault/shared` y `@linkvault/ai`, generadores
`@nx/nest` y `@nx/angular` con `--e2eTestRunner=none`. Alternativa descartada: el modo *TS solution* con project
references, porque no soporta proyectos Angular y no infiere `typecheck` para ellos. `typecheck` se declara de forma
explícita en los cinco proyectos como `tsc --noEmit` sobre su `tsconfig` de librería o app y su `tsconfig.spec.json`.
Alternativa a Nx descartada por ADR-011: pnpm workspaces sin grafo de tareas o Turborepo sin generadores; la salida a
Turborepo queda descrita en el README.

Los generadores de Nx colocan el código de cada librería bajo `src/`. Las rutas que usan `CLAUDE.md`, ADR-014 y las specs
(`libs/ai/infrastructure/providers`, `libs/ai/domain/ports`…) son relativas a la raíz de fuentes de la librería: en disco
son `libs/ai/src/infrastructure/providers`, `libs/ai/src/domain/ports`, etc. Las reglas de lint usan la ruta en disco.

`nx.json` declara `namedInputs.sharedGlobals` con `nx.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.nvmrc`,
`package.json` y `pnpm-lock.yaml`, de modo que un cambio en esos archivos afecte a todos los proyectos.

### D2 — Tags en tres ejes

Cada proyecto lleva `scope:*` (`api`, `worker`, `web`, `shared`, `ai`, `tooling`), `type:*` (`app`, `lib`, `test-util`,
`tooling`) y `platform:*` (`node`, `browser`, `any`). `tools/test-env` (`platform:any`) y `tools/testing` (`platform:node`) son
`type:test-util`; `tools/workspace-rules` es `type:tooling`. `@nx/enforce-module-boundaries` se configura en dos bloques
construidos desde **un único array de restricciones** definido una vez en `eslint.config.mjs`: el general, donde
`type:app` y `type:lib` no pueden depender de `type:test-util` ni de `type:tooling`; y uno para `**/*.spec.ts`,
`**/*.test.ts` y `**/vitest.config.*`, idéntico salvo que añade `type:test-util` a lo permitido. Si el bloque de tests
declarara solo la excepción, ESLint descartaría en los tests las restricciones de ámbito y plataforma (el mismo problema
de D3). Las restricciones de plataforma siguen aplicando a los tests: `web` no puede importar `tools/testing`. Restricciones comunes: `type:lib` no depende de `type:app`; `scope:shared` no depende de nada; `scope:ai` solo de
`scope:shared`; `platform:browser` solo de `platform:browser|any`. `web` es `browser`; `api`, `worker` y `ai` son `node`;
`shared` es `any`.

### D3 — Dos reglas distintas para capas y SDKs

ESLint no combina las opciones de una misma regla entre bloques de configuración: si dos bloques configuran
`no-restricted-imports` sobre el mismo archivo, gana el último y la otra lista se pierde en silencio. Por eso:

- **Capa de dominio** → `no-restricted-imports`, bloque con `files: ['**/domain/**/*.ts']`, lista cerrada de la spec.
- **SDKs de IA** → `@typescript-eslint/no-restricted-imports`, bloque con `files: ['**/*.ts']` e
  `ignores: ['libs/ai/src/infrastructure/providers/**']`, lista cerrada de la spec con patrones para subrutas.

`libs/ai/domain/x.ts` casa con ambos bloques y, al ser reglas distintas, reporta ambas violaciones. Hay una fila del test
para ese caso exacto.

### D4 — Un test tabular de reglas con `ESLint.lintText`

Las reglas se prueban desde `tools/workspace-rules` (`type:tooling`) instanciando `ESLint` con la configuración real del
repo y llamando a `lintText(code, { filePath })` con rutas virtuales (`apps/worker/src/x.ts`, `libs/ai/src/domain/x.ts`…).
Una tabla de casos `{ filePath, code, expectedRuleIds }` cubre todas las reglas de la spec de `workspace`. Alternativa
descartada: archivos de fixture en disco, que ensucian el `lint` y el `typecheck` del proyecto real e importan paquetes
no instalados.

Consecuencia asumida: el repo **no** activa reglas de ESLint con información de tipos. `lintText` sobre rutas virtuales
fallaría con "file not included in project". Si en el futuro se activan, `tools/workspace-rules` necesitará
`parserOptions.projectService.allowDefaultProject`.

### D5 — Vitest en todos los proyectos, con transformador explícito

- **Nest (`api`, `worker`)**: Vitest con `unplugin-swc` (`tsconfigFile: false`, `decoratorMetadata: true`) para emitir
  metadatos de decoradores. Verificado en la implementación: con Vite 8, Oxc también los emite si el tsconfig tiene
  `emitDecoratorMetadata: true`, así que swc no es imprescindible hoy; se mantiene porque garantiza los metadatos con
  independencia del tsconfig. El test de inyección falla si ambas vías están desactivadas.
- **Angular (`web`)**: builder `@angular/build:unit-test` con Vitest, que es el camino soportado por Angular para zoneless.
- **Librerías y tooling**: Vitest sin transformador adicional.

Alternativa descartada: Jest en backend, que es lo que proponen los generadores de Nest; supondría dos corredores en un
repo de una persona.

### D6 — MongoDB: replica set inicializado por su healthcheck

El servicio `mongo` arranca con `--replSet rs0 --bind_ip_all` y `hostname: mongo`. Su healthcheck ejecuta con `mongosh`
un script idempotente: intenta `rs.status()`; si falla con el código `NotYetInitialized` llama a `rs.initiate` con el
miembro `mongo:27017` (cualquier otro error se relanza); después termina con `quit(db.hello().isWritablePrimary ? 0 : 1)`.
Se usa `isWritablePrimary` y no `rs.status().ok`, que vale 1 antes de que haya primario, y se sale con código explícito
porque `mongosh --eval` devuelve 0 aunque la expresión sea falsa. `start_period` y reintentos cubren la elección.

`redis` usa `redis-cli ping` como healthcheck y `minio` usa `mc ready local`; la imagen de MinIO ya no incluye `curl`.

Alternativa descartada: contenedor `mongo-init` de un solo uso. Obliga a encadenar `depends_on` con condiciones que es
fácil escribir en círculo, y `docker compose up --wait` (el que usa `/lv:smoke`) trata de forma distinta a un contenedor
que termina. El healthcheck concentra inicialización y espera en un solo lugar.

**Acceso desde el host**: el replica set anuncia `mongo:27017`, que el host no resuelve. `.env.example` usa
`mongodb://localhost:27017/linkvault?directConnection=true`; con conexión directa el driver no descubre miembros y las
transacciones funcionan igual sobre el primario de un nodo. La URI con `replicaSet=rs0` y host `mongo` queda documentada
para cuando las apps corran en contenedores (`deploy-prod`).

### D7 — `mongodb-memory-server` como único Mongo de los tests

Las utilidades de test se reparten en dos proyectos para respetar las plataformas de D2 y no arrancar Mongo donde no se usa:

- `tools/test-env` (`platform:any`): preset de Vitest que solo fija `test.env` con `AI_CHAIN=mock` y
  `AI_MOCK_MODE=replay`, para que los tests cumplan CLAUDE.md en local sin `.env` (CI los define además). Lo extienden
  `shared` y `ai`.
- `tools/testing` (`platform:node`): extiende `tools/test-env` y lo extienden `api` y `worker`. Añade un `globalSetup` que arranca un `MongoMemoryReplSet` de un nodo por
proyecto y publica su URI en el entorno, y un helper para abrir sesiones y transacciones. La versión del binario se fija
con `MONGOMS_VERSION` exacta de la línea 7.0 en la configuración compartida de Vitest, no en cada test. En CI se cachea
el directorio de binarios con esa versión como clave. En Windows requiere el redistribuible de Visual C++, anotado en el
README. Alternativas descartadas en ADR-017: servicios del runner y testcontainers.

Para Redis no se usa un servidor real: los tests de salud necesitan una dependencia que esté arriba, caída o colgada a
voluntad. `tools/testing` ofrece un servidor TCP mínimo que responde `PING` en protocolo RESP, con esos tres modos. Es
determinista, no descarga binarios y basta para el único comando que este change envía a Redis.

### D8 — Arranque: configuración con zod y conexiones perezosas

Cada app valida `process.env` con un schema zod en su `infrastructure/config` antes de crear la aplicación Nest; si falla,
escribe los nombres de las variables inválidas con `process.stderr.write` (todavía no hay logger, y `console` está
prohibido por lint) y termina con código 1. Nunca escribe valores.

Mongoose se registra con `lazyConnection: true` y el `serverSelectionTimeoutMS` por defecto: el límite de 500 ms es del
indicador de salud (D9), no de la conexión, para no hacer fallar consultas de negocio futuras ante cortes breves. Sin
`lazyConnection`, `MongooseModule.forRoot` bloquea el arranque de Nest con reintentos y aborta, y no habría liveness.
`lazyConnection` solo evita el bloqueo: si la conexión inicial falla, Mongoose no vuelve a intentarla. Por eso, ante un
`error` previo al primer `connected`, se reintenta `connection.openUri(uri)` con backoff de tope 2 s. Así una app
arrancada antes que `docker compose up` recupera Mongo sin reiniciar, como exige la spec.

Redis usa **dos clientes con opciones distintas**:

- **Cliente de salud** (ioredis): `lazyConnect: true`, `enableOfflineQueue: false`, `maxRetriesPerRequest: 1` y
  `retryStrategy` con backoff de tope 2 s. En `onModuleInit` se llama a `connect()` sin esperar, capturando el error en
  el log; así el primer `GET /health` no se encuentra un stream sin abrir.
- **Conexión de BullMQ** (solo `worker`): `BullModule.forRoot` con `maxRetriesPerRequest: null`, que BullMQ exige para
  sus workers. No se registra ninguna cola ni `Worker`; queda lista para el primer job de `job-links`.

### D9 — Salud: `@nestjs/terminus`, dos rutas, indicadores con timeout

`/health/live` no consulta dependencias. `/health` usa `@nestjs/terminus` con dos indicadores propios en
`infrastructure/health` de cada app: cada uno ejecuta un `ping` con un `AbortSignal`/temporizador de 500 ms y convierte
cualquier excepción en `down`, sin propagar el mensaje del driver. El controlador adapta la salida de terminus al JSON
de la spec. La versión sale de `APP_VERSION`, inyectada por el build y con el valor de `package.json` como respaldo en
desarrollo. Ambas rutas se excluyen del prefijo global `/api`.

El `worker` se crea con `NestFactory.create(WorkerModule, new FastifyAdapter())` y escucha solo en `WORKER_HEALTH_PORT`;
no registra más controladores que los de salud. Los indicadores se duplican en `api` y `worker` a sabiendas: sacarlos a
una librería `platform:node` antes de tener un tercer consumidor es prematuro.

### D10 — Mismo origen en desarrollo

`api` llama a `setGlobalPrefix('api', { exclude: ['health', 'health/live'] })`. `apps/web/proxy.conf.json` reenvía
`/api` a `http://localhost:3000`, y el target `serve` de `web` lo referencia. Es lo que permite que la cookie de refresh
`httpOnly; SameSite=Lax` de ADR-012 funcione en `auth-users` sin CORS con credenciales.

### D11 — `pino` con rutas de redacción reales

`nestjs-pino` en ambas apps con `redact.paths`: `req.headers.authorization`, `req.headers.cookie`,
`res.headers["set-cookie"]`, y para `password`, `apiKey`, `accessToken` y `refreshToken` tres variantes cada uno: raíz
(`apiKey`), un nivel (`*.apiKey`) y dos niveles (`*.*.apiKey`). En pino `*.apiKey` no casa con la raíz, que es el caso
más común (`logger.info({ apiKey })`). pino no admite comodines recursivos, así que la profundidad cubierta se fija y se prueba.

### D12 — `apps/web` con Material, Tailwind e i18n

Se configuran ahora porque es andamiaje independiente de cualquier pantalla y evita tocar la base en `auth-users`.
Una ruta placeholder con carga diferida y un test de render. ES es el locale fuente; EN queda declarado en `angular.json`.

### D13 — Finales de línea

`.gitattributes` pasa a `* text=auto eol=lf`, con `*.png`, `*.jpg`, `*.ico`, `*.pdf` y `*.woff2` como `binary`, seguido
de `git add --renormalize .` y `git checkout -- .` en el mismo commit: el primero corrige el índice y el segundo reescribe
los archivos del disco, que en Windows seguirían con CRLF (`git reset --hard` está denegado en la configuración). Prettier conserva `endOfLine: "lf"`. Así Windows y CI ven los mismos bytes.

### D14 — CI

Un workflow con `actions/checkout` en `fetch-depth: 0`, `pnpm/action-setup` leyendo `packageManager`,
`actions/setup-node` leyendo `.nvmrc` con caché de pnpm, y `nrwl/nx-set-shas` para la base del cálculo de afectados.
Pasos: `nx affected -t lint` → `pnpm exec openspec validate --all` → `nx affected -t typecheck` → `nx affected -t test`
con `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` → `nx affected -t build`. `@fission-ai/openspec` se fija como devDependency.

## Risks / Trade-offs

- **`unplugin-swc` y los metadatos de decoradores** pueden dar problemas con alguna versión de Vitest → el test trivial de
  cada app Nest instancia un módulo con un proveedor inyectado; si falla se detecta en la tarea de configuración, no después.
- **El healthcheck que inicializa el replica set** hace algo más que comprobar → el script es idempotente y está probado
  por dos escenarios (volumen vacío y volumen existente); si falla, `up --wait` falla con el log del healthcheck visible.
- **`directConnection=true` oculta problemas de topología** que aparecerían con varios nodos → aceptable mientras todos los
  entornos sean de un nodo (ADR-009); `deploy-prod` usa la URI con `replicaSet`.
- **`mongodb-memory-server` descarga un binario** que puede fallar por red o por distro del runner → versión exacta, caché
  en CI y requisito de VC++ documentado para Windows.
- **Redacción de pino limitada a dos niveles de anidación** → el test cubre ambos niveles; un secreto más profundo es un
  error de diseño del log y debe aplanarse.
- **Nx puede resultar pesado** → aceptado con reserva en ADR-011; salida a Turborepo documentada.
- **Indicadores de salud duplicados** en dos apps → coste de mantenimiento pequeño y consciente; se extraen con el
  tercer consumidor.

## Migration Plan

No hay migración: arranque en verde. El change está desplegado cuando, desde un clon limpio, funcionan `pnpm install`,
`docker compose up -d --wait`, `pnpm nx run-many -t lint,typecheck,test,build` y `pnpm nx serve api|worker|web`.
Reversión: `git revert` del PR; no hay datos ni consumidores externos.

## Open Questions

- Qué modelo descarga Ollama en el perfil `ai-local`. No afecta a este change; se decide en `ai-gateway-core`.
