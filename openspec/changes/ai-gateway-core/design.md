## Context

`libs/ai` contiene hoy el árbol de ADR-014 y los contratos de `domain/` (`LlmProvider`, `ProviderCapabilities`,
`CompletionRequest`, `CompletionResult`, `AiTask`, errores). No hay implementación, ni consumidores, ni usuarios: `auth-users`
llega después. Ver `proposal.md` (§Why) y `specs/ai/*/spec.md`.

Restricciones heredadas:

- **ADR-014 y design-v0.2 §4** fijan el flujo; **ADR-018** registra las decisiones de este change que se apartan de §4 o lo
  concretan. Este diseño las desarrolla sin repetir su justificación.
- **ADR-017 y `platform/workspace`**: `libs/ai` es `platform:node` y solo depende de `scope:shared`; `domain/` no importa
  frameworks ni otras capas; SDKs de proveedor solo en `infrastructure/providers`.
- **Decisiones humanas**: resultado degradado tipado con `degrade()` opcional; cuotas por configuración sobre el ledger; caché
  en Redis y breaker en memoria por proceso.
- **Tests**: `AI_CHAIN=mock`, `AI_MOCK_MODE=replay`, sin red ni servicios (`tools/testing`: Mongo en memoria, doble RESP).
- **Código existente a reutilizar como patrón**: el cliente Redis de salud y el reintento de Mongoose de `apps/worker`, y el
  parser de configuración con errores por nombre de variable.

## Goals / Non-Goals

**Goals:**

- Que `extract-job`, `match-cv` y `build-roadmap` solo tengan que declarar su `AiTask`, su prompt, su muestra de `synth` y sus
  fixtures.
- Que CI ejercite el pipeline completo sin red: reparación, fallback, degradación, caché, ledger, cuota, breaker y redacción.
- Que ninguna configuración válida en producción haga que una tarea lance excepción en lugar de degradar.

**Non-Goals:**

- Modo `record` y grabación real de fixtures (`ai-eval-harness`, ADR-018 §5).
- Detectores de dirección y documento de identidad (`cv-match-suggestions`, ADR-018 §13).
- Evaluación de calidad, evaluator-optimizer, `RuleBasedMatcher`, BYOK, endpoints HTTP de IA.
- Coordinación distribuida del breaker.

## Decisions

### D1 — Capas dentro de `libs/ai`

```
libs/ai/src/
├── domain/            contratos existentes + run-context, ai-result, routing-policy (pura), errors (+SynthUnsupported)
│   └── ports/         llm-provider, prompt-registry, usage-ledger, result-cache, quota-policy, circuit-breaker, clock, ai-logger
├── application/       run-task.usecase, structured-output.pipeline, pii-redactor, json-extraction, canonical-json,
│                      execution-key, task-registry
├── infrastructure/
│   ├── providers/     mock-deterministic, ollama, openrouter, provider-registry
│   ├── prompts/       classify-skills.v1.md
│   ├── fixtures/      classify-skills/<key>.json
│   ├── persistence/   mongo-usage-ledger (+ schema), redis-result-cache (+ client)
│   ├── resilience/    in-memory-circuit-breaker
│   ├── quota/         config-quota-policy
│   ├── prompt-registry/ file-prompt-registry
│   ├── logging/       nest-ai-logger
│   └── config/        ai-config.schema, parse-ai-config
├── tasks/             classify-skills.task
└── ai.module.ts       AiModule.forRootAsync
```

La regla de `platform/workspace` ("`domain` no importa de otras capas") se hace cumplir ampliando el bloque de lint de
dominio de ADR-017 con patrones anclados por segmento de ruta, `(^|/)(application|infrastructure|presentation|tasks)(/|$)`
y `ai\.module$`. Anclar es necesario porque el bloque aplica a todo `**/domain/**` y habrá un módulo `applications` con
imports legítimos como `./application.entity`. Filas en el test tabular: una positiva y una negativa con ese import.

### D2 — Contratos: resultado, contexto, tarea y capacidades

```ts
type AiResult<O> =
  | { status: 'success'; output: O; providerId: string; model: string; promptVersion: string; cached: boolean }
  | { status: 'degraded'; reason: 'no_providers' | 'providers_failed' | 'quota_exceeded'; output?: O };

interface RunContext {
  userId?: string;
  aiConsent: { externalProviders: boolean };   // obligatorio, sin valor por defecto
  outputLanguage?: 'es' | 'en';                // por defecto 'es'
  redactName?: boolean; personName?: string;
  signal?: AbortSignal;                        // plazo total
}
```

`AiTask` gana `dataSensitivity?: 'personal' | 'public'` (por defecto `personal`), `degrade?(input): O` y
`sample?(input, rng): O`. El registro valida `budget.maxAttempts ∈ {1, 2}`. `satisfies(caps, requires)`: cada booleano
requerido `true` exige `true`; `maxContextTokens` se compara con `>=`; costes y `external` requeridos se ignoran (son de
política, no de capacidad). Se propagan como excepción solo el input inválido (`ZodError`) y los **errores de
programación**, que heredan de `AiProgrammingError` en `domain/errors.ts`: `FixtureMissing`, `InvalidFixture`,
`MockMisuse`, `SynthUnsupported`, `InvalidPrompt` e `InvalidDegradeOutput`. Una clase base evita que `application` importe
de `infrastructure` y que cada error nuevo de este tipo obligue a tocar `runTask`. Antes de propagarlos se libera el
permiso de half-open si se había tomado (D10).

`RunTask` no comprueba que la tarea esté registrada: **registrar es responsabilidad de `AiModule`**, único punto que lo
construye, y es el registro el que valida `maxAttempts` y la existencia del prompt al arrancar. Un consumidor que construya
`RunTask` a mano asume esa validación.

`QuotaExceeded`, listado en design-v0.2 §4.1 y creado en `bootstrap-monorepo`, se retira: la cuota degrada con
`quota_exceeded` sin lanzar (ADR-018 §9) y ningún código lo usaba.

### D3 — Pipeline de salida estructurada

1. Extracción tolerante: contenido del primer bloque de código si existe; si no, primer objeto o array JSON balanceado,
   respetando strings y escapes.
2. `outputSchema.safeParse`.
3. Si falla y `maxAttempts = 2`: **una** petición de reparación con el mismo `system` y un único `user` compuesto por el
   mensaje original, la salida inválida y `z.prettifyError(error)`. No se añade un array de mensajes al contrato: ambos
   proveedores aceptan el mensaje compuesto y el mock no lo necesita (su clave no depende del prompt).
4. Si sigue inválida: `schema_error` y siguiente proveedor.

### D4 — Clave de ejecución

`application/execution-key.ts`:
`key = sha256(canonicalJSON([taskName, promptVersion, outputLanguage, parsedInput]))` (ADR-018 §3), sobre el input ya
parseado por zod. `canonicalJSON`: claves de objeto ordenadas por código de unidad, `undefined` omitido en objetos, `-0`
serializado como `0`, arrays en su orden, sin espacios. Un vector de referencia fijo en el test protege la compatibilidad de
fixtures. La misma clave identifica la caché, el mock y el `inputHash` del ledger. Viaja en
`CompletionRequest.trace = { taskName, promptVersion, key, input? }` (campo opcional nuevo del contrato), que los
proveedores reales ignoran. Se calcula antes de la redacción. `trace.input` (input parseado, sin redactar) lo necesita el mock
en modo synth y `runTask` solo lo rellena cuando el proveedor es `mock`: ninguna petición a un proveedor real lo contiene.
Los errores de programación del mock (`MockMisuse`, `InvalidFixture`) se propagan igual que `FixtureMissing`, cada uno con
su clase, como errores de programación (D2).

### D5 — Mock: replay y synth

- **replay**: lee `<AI_FIXTURES_DIR>/<task>/<key>.json` con forma `{ source, text, model, usage }` y devuelve `text` con
  latencia 0; si no existe lanza `FixtureMissing(key)`.
- **synth**: si no hay fixture, busca la tarea en `TaskRegistry` y llama a `task.sample(input, rng)` con un PRNG mulberry32
  sembrado con los 32 primeros bits de la clave; serializa la salida con `JSON.stringify`. Sin `sample` lanza
  `SynthUnsupported(taskName)`. Si hay fixture, synth lo usa (un fixture real prevalece sobre una muestra).
- Capacidades del mock: `jsonMode: true`, `toolUse: false`, contexto 1 000 000, `external: false`, coste 0.

### D6 — Proveedores reales por HTTP

Implementados con `fetch` nativo de Node 22, sin SDK (ADR-018 §12):

- **Ollama**: `POST {OLLAMA_URL}/api/chat` con `stream: false`, `format: "json"`,
  `options: { temperature, num_ctx: OLLAMA_MAX_CONTEXT_TOKENS, num_predict: maxTokens }`; salud en `GET /api/version`.
  Valores por defecto: `OLLAMA_URL=http://localhost:11434`, `OLLAMA_MODEL=qwen2.5:7b` (docs/design.md §7.8),
  `OLLAMA_MAX_CONTEXT_TOKENS=8192`, `OLLAMA_TIMEOUT_MS=60000`.
- **OpenRouter**: `POST {OPENROUTER_BASE_URL}/chat/completions` (por defecto `https://openrouter.ai/api/v1`) con
  `response_format: { type: "json_object" }` si `jsonMode`, `provider: { data_collection: "deny" }`, cabeceras
  `Authorization`, `HTTP-Referer` y `X-Title`. `OPENROUTER_MODEL` debe terminar en `:free` (coste 0).
  `OPENROUTER_MAX_CONTEXT_TOKENS=32000` y `OPENROUTER_TIMEOUT_MS=30000` por defecto. La URL base debe ser `https` salvo con
  `NODE_ENV=test`.
- Errores: `ProviderUnavailable(providerId, httpStatus?)`. Nunca se incluye el cuerpo de la respuesta, la petición ni
  cabeceras. `runTask` registra en `AiLogger.warn` el `providerId` y el `httpStatus` de cada `provider_error`, para
  distinguir una caída (5xx, timeout) de un rechazo por política de datos o modelo (404).
- Tests contra un servidor `node:http` local en puerto efímero, apuntando la URL base a él.

### D7 — Prompts y assets

`<task>.<version>.md`: front-matter YAML con `task` y `version` (validados contra la tarea; los schemas son del código, no
del front-matter) y dos secciones `# system` y `# user`. Se normaliza `\r\n` a `\n` al leer y `.gitattributes` ya fuerza LF
en `*.md`. Render con `Mustache.render(template, view, {}, { escape: (s) => s })` por llamada, sin modificar
`Mustache.escape` global. `view = { input, outputLanguage }`.

Rutas: `AI_PROMPTS_DIR` y `AI_FIXTURES_DIR` se resuelven contra `process.cwd()` si son relativas. En desarrollo y tests
(`cwd` = raíz del workspace) valen por defecto `libs/ai/src/infrastructure/prompts` y `.../fixtures`. El build del worker
copia los prompts a `dist/apps/worker/assets/ai/prompts` y un paso de CI tras `build` comprueba que existe
`classify-skills.v1.md`. `mustache` y `yaml` van en `dependencies` y `@types/mustache` en `devDependencies` (`mustache` no
publica tipos).

### D8 — Caché en Redis

Clave `ai:cache:v1:<key>`, valor `{ output, providerId, model, promptVersion }`, TTL `AI_CACHE_TTL_SECONDS` (por defecto
604 800). Si la configuración de `AI_CHAIN` incluye `mock`, `runTask` recibe un caché nulo y no lo lee ni escribe.
`libs/ai` crea su propio cliente ioredis desde `REDIS_URL` con el patrón del cliente de salud del worker: `lazyConnect`,
`enableOfflineQueue: false`, `maxRetriesPerRequest: 1`, `enableReadyCheck: false`, `commandTimeout: 500` (un Redis que
acepta la conexión y no responde no puede colgar `runTask`), `connect()` sin esperar en
`onModuleInit`, un único aviso por racha de fallos en el listener `error`, `disconnect()` al apagar. Cualquier error de
lectura o escritura cuenta como fallo de caché. El doble RESP de `tools/testing` añade `GET`, `SET` (`EX`, `PX`) y `DEL`.

La salida guardada está reinyectada y puede contener datos del propio input; la clave es el hash de ese input, así que solo
la recupera quien ya los tiene (riesgo aceptado).

### D9 — Ledger y cuotas

Colección `ai_usage`: `{ userId?, task, providerId|null, model|null, inputTokens, outputTokens, estCost, latencyMs,
outcome, reason?, promptVersion, key, at }`, índice `{ userId: 1, task: 1, at: -1 }`, modelo con `bufferCommands: false`
sobre la conexión Mongoose de la app (`getConnectionToken()`). Escritura con `void ledger.record(...)` y captura de errores
hacia `AiLogger`; `runTask` nunca espera la confirmación.

`AI_QUOTAS` (vacía por defecto) define límites diarios por tarea: `classify-skills=100,extract-job=200`.
`ConfigQuotaPolicy.allows(userId, task)` hace `countDocuments({ userId, task, outcome: 'success', at: { $gte: now-24h } })`
con `maxTimeMS: 300` **y** compite esa promesa contra un temporizador de aplicación de 300 ms: `maxTimeMS` solo acota la
ejecución en el servidor, no la espera de selección de servidor del driver (30 s por defecto) cuando Mongo cae después de
haber conectado. Si vence el temporizador o hay error, devuelve `true` y registra un `warn` (falla abierta). Se evalúa una vez antes de
la cadena. Cuota superada → un único registro `quota`, sin `degraded`.

### D10 — Circuit breaker y plazos

`InMemoryCircuitBreaker` por proveedor: ventana deslizante de marcas de error; `open` con 5 errores en 60 s;
`openIds()` devuelve la instantánea de circuitos abiertos **que aún no están listos para prueba**, que es lo que recibe la
política pura; `tryAcquire(id)` justo antes de `complete()` concede en half-open un único permiso atómico y lo rechaza si ya
hay una prueba en curso; `recordSuccess(id)` (cualquier respuesta, válida o no) cierra; `recordFailure(id)` (solo
`provider_error`) cuenta y reabre en half-open. Si un proveedor no se usa porque otro anterior resolvió, no se llama a
`tryAcquire`, así que el permiso sigue disponible. `Clock` es inyectable.

Plazos: por intento, `signal = AbortSignal.any([AbortSignal.timeout(providerTimeout), ctx.signal].filter(Boolean))`
(filtrar es obligatorio: `AbortSignal.any` lanza `TypeError` con `undefined`). La señal combinada se pasa en `req.signal`
para que `fetch` cierre el socket, y `runTask` compite `provider.complete(req)` contra una promesa que rechaza al abortarse,
así que el intento termina aunque el proveedor ignore la señal. Si abortó el timeout del proveedor: `provider_error` y
`recordFailure`. Si abortó `ctx.signal`: sin `provider_error` ni `recordFailure`, se llama a `breaker.release(id)` para
devolver un permiso de half-open ya concedido (sin él quedaría tomado para siempre y el proveedor no volvería en ese
proceso), se interrumpe la cadena y se devuelve un único `degraded` con `providers_failed`. `release` es el único método
que el puerto `CircuitBreaker` añade respecto a lo descrito arriba. En tests, los timeouts son de decenas de milisegundos con temporizadores reales.

### D11 — `PiiRedactor`

Solo para tareas `personal` y proveedores `external`. Detectores, en este orden y con marcadores estables por valor:

- **email**;
- **URL**: `https?://…`, dominios que empiezan por `www.`, y dominios sin esquema con TLD habitual en CVs y portafolios
  (`com`, `net`, `org`, `io`, `dev`, `app`, `me`, `co`, `ai`, `xyz` y los de país de LatAm `bo`, `ar`, `mx`, `cl`, `pe`,
  `uy`, `py`, `ec`, `ve`, `br`), con o sin ruta. La ampliación nació en QA porque `www.anaperez.dev` salía sin redactar.
  Nombres de tecnologías cuyo sufijo no es uno de esos TLD (`Node.js`, `Vue.js`) no casan. Los que sí terminan en uno de
  ellos se salvan con una **lista cerrada de nombres técnicos** que se compara con el host completo y sin distinguir
  mayúsculas, solo en la rama sin esquema ni `www.`: `asp.net`, `ado.net`, `vb.net`, `ml.net`, `json.net`, `rx.net`,
  `akka.net`, `socket.io`, `hangfire.io`. Un host sin puerto ni ruta cuyo TLD tiene mayúscula inicial y el resto en
  minúsculas, seguido de espacio y letra, se trata como fin de frase sin espacio (`NestJS.Me encargué`), no como dominio.
  Un TLD todo en mayúsculas (`ANAPEREZ.DEV ES MI SITIO`) sí se redacta, para que un CV escrito en mayúsculas no filtre el
  dominio.

  **Política de sobre-redacción aceptada.** Ante la duda se redacta: un falso positivo solo cuesta contexto al modelo (el
  valor se reinyecta en la salida), mientras que un falso negativo saca un dato personal del perímetro. Consecuencias
  conocidas: `github.com` sin perfil, nombres de archivo como `setup.py` y tecnologías con forma de dominio que no estén en
  la lista cerrada llegan como `[URL_n]` al proveedor externo. Para `classify-skills`, que el prompt instruye a no tratar
  los marcadores como skills, eso significa perder esas skills con proveedores externos; con proveedores locales (sin
  redacción) no ocurre. La lista cerrada se amplía cuando el eval harness mida skills perdidas;
- **teléfono**: móvil boliviano de 8 dígitos que empieza por 6 o 7 (opcionalmente con `+591`); cualquier número con `+`
  seguido de 7 a 14 dígitos con separadores; locales LatAm de 8 a 11 dígitos en 2 a 4 grupos separados por espacio, guion o
  punto, con un prefijo de área opcional entre paréntesis (`(011) 4123-4567`), que forma parte del teléfono redactado.
  Antes de este detector se enmascaran las exclusiones: fechas (`dd/mm/aaaa`, `aaaa-mm-dd`), años de 4 dígitos
  sueltos, rangos de años `(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}`, rangos mes.año `\d{2}[./]\d{4}\s*[-–]\s*\d{2}[./]\d{4}` y
  montos precedidos de moneda (`Bs`, `USD`, `$`);
- **nombre**, con `ctx.redactName` y `ctx.personName`, sin distinguir mayúsculas.

El mapa vive en un objeto local de la ejecución; la reinyección recorre los strings de la salida validada. Dirección y
documento de identidad se difieren (ADR-018 §13).

### D12 — `AiModule`, configuración y logging

`parseAiConfig(env)` en `libs/ai` devuelve la configuración o una lista de problemas
`{ variable, problem, detail? }`, donde `detail` solo puede llevar identificadores de `AI_CHAIN`, nunca valores de
credenciales. El schema de configuración del worker lo compone antes de crear Nest, y `env-parser` del worker gana `detail?`
para imprimirlo. Reglas: `AI_CHAIN` = `none` o lista de conocidos; credencial presente por proveedor externo listado;
`OPENROUTER_MODEL` termina en `:free`; `mock` en la cadena prohibido con `NODE_ENV=production`; `AI_MOCK_MODE` exigido y
validado (`replay` | `synth`) solo si `mock` está en la cadena, con `record` rechazado y el detalle "diferido a
ai-eval-harness"; formato de `AI_QUOTAS`. Los schemas de api y worker aceptan `none` en `AI_CHAIN` y dejan de exigir
`AI_MOCK_MODE` por sí mismos (la regla vive en `parseAiConfig`; api la aplicará cuando importe `AiModule`).

`AiModule.forRootAsync({ config })` registra tareas, prompts (fallando si falta alguno), proveedores de la cadena, caché
(o caché nula), ledger, cuota, breaker y `RunTask`, exportado con el token `RUN_TASK`.

`AiLogger` es un puerto (`debug`, `warn`) usado por `application`; `infrastructure/logging/nest-ai-logger` lo implementa con
`Logger` de `@nestjs/common`, que en el worker va a pino. Nunca recibe prompts, inputs, cuerpos HTTP ni credenciales. Los
tests capturan logs con un `AiLogger` en memoria. El logger del worker añade `*.headers.authorization` y
`*.headers.Authorization` a la redacción.

### D13 — Tarea `classify-skills`

Input `{ text: string (1..20000) }`. Output `{ skills: { name: string (1..60); category: 'language' | 'framework' | 'tool' |
'platform' | 'soft' | 'domain' | 'other' }[] }` con máximo 60 elementos. `dataSensitivity: 'personal'` (puede recibir texto
de un CV), `requires: { jsonMode: true, maxContextTokens: 8000 }`, `temperature: 0`, `budget: { maxTokens: 1024,
maxAttempts: 2 }`, sin `degrade`. `sample(input, rng)`: detecta en el texto términos de una lista corta embebida (TypeScript,
JavaScript, NestJS, Angular, MongoDB, Redis, Docker, Git, inglés…) con su categoría, conserva el orden de aparición y usa
`rng` solo para desempates; nunca inventa términos ausentes del input. Fixtures de replay escritos a mano para los inputs de
test con `"source": "handwritten"`.

### D14 — Tests de `libs/ai`

`libs/ai/vitest.config.mts` pasa a extender `@linkvault/testing/preset` (Mongo en memoria) y añade `unplugin-swc` como el
worker, porque el ledger y `AiModule` necesitan Mongo e inyección por constructor. Revierte de forma consciente la decisión
de `bootstrap-monorepo` 4.5 ("ai no arranca Mongo"): el coste es ~1 s más de arranque de tests de `ai`. Los tests puramente
unitarios siguen sin tocar Mongo.

## Risks / Trade-offs

- **Modelos gratuitos con JSON inválido o latencia alta** → una reparación, fallback, timeouts; se medirá en
  `ai-eval-harness`.
- **Límites de uso de OpenRouter `:free`** → un 429 cuenta como `provider_error` y alimenta el breaker.
- **Falsos negativos del `PiiRedactor`** en teléfonos con formatos raros → tabla de casos positivos y negativos por detector;
  se prioriza redactar de más. Dirección y documento quedan sin redactar hasta `cv-match-suggestions`, que es el primer
  change que envía CVs.
- **La caché guarda salidas con datos del propio input** → clave por hash del input y TTL; ver D8.
- **Breaker por proceso** → con N réplicas, hasta 5·N fallos antes de excluir un proveedor en todas; revisable en
  `deploy-prod`.
- **Cuota que falla abierta** → con Mongo caído, un usuario puede superar su límite; preferible a tumbar la IA.
- **Registros del ledger previos a la conexión**: con `bufferCommands: false`, los intentos hechos antes de que Mongoose
  conecte se pierden con error registrado → afecta solo a los primeros segundos tras arrancar; los tests esperan la conexión.
- **`data_collection: "deny"` reduce los modelos `:free` utilizables**: OpenRouter responde 404 si ningún endpoint del modelo
  cumple la política → el `warn` con `httpStatus` lo hace visible y el modelo por defecto debe elegirse compatible (ver
  Open Questions).
- **Assets de prompts no copiados** → comprobación en CI tras `build` (D7).
- **Fixtures escritos a mano** → prueban el pipeline, no la calidad; se regraban con `record` en `ai-eval-harness`.
- **`-0`, `undefined` y orden de arrays en `canonicalJSON`** → vector de referencia fijo en tests; cambiar la función
  invalida todos los fixtures y debe hacerse con nueva versión de clave (`ai:cache:v2`).

## Migration Plan

Sin migraciones de datos: `ai_usage` es nueva y su índice se crea al arrancar. Las variables nuevas tienen valores por
defecto seguros salvo las credenciales, exigidas solo si el proveedor está en `AI_CHAIN`. Reversión: `AI_CHAIN=none` (la IA
degrada) o quitar `AiModule` del worker.

## Open Questions

- Qué modelo `:free` concreto de OpenRouter queda como valor por defecto de `OPENROUTER_MODEL`. Condición: debe tener al
  menos un endpoint compatible con `data_collection: "deny"`, comprobado con una clave real. Es configuración; se fija al
  grabar los primeros fixtures reales en `ai-eval-harness` y no cambia specs ni tareas. Mientras tanto `.env.example` deja
  `OPENROUTER_MODEL` vacío y `openrouter` fuera de `AI_CHAIN`.
