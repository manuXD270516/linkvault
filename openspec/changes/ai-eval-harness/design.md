## Context

`ai-gateway-core` dejó en `libs/ai` un `runTask` completo con mock (replay y synth), Ollama y OpenRouter por HTTP, ledger,
caché, cuotas, breaker y `PiiRedactor`, y una sola tarea: `classify-skills`. Sus fixtures de replay son tres archivos escritos a
mano usados por tests, `libs/ai/src/evals/` está vacío y `parseAiConfig` rechaza `AI_MOCK_MODE=record`. Ver `proposal.md`,
`specs/` y **ADR-019**, que registra las decisiones del debate.

Restricciones y hechos:

- **ADR-014/018/019**: `runTask` único; clave de ADR-018 §3; grabación como comando (ADR-019 §5).
- **Decisiones humanas**: harness genérico con `classify-skills`; validación real con Ollama local y `qwen2.5:7b`; CI falla ante
  regresión respecto a una línea base.
- **Entorno de desarrollo**: la app Ollama de escritorio escucha en `127.0.0.1:11434`; el contenedor del perfil `ai-local` se
  publica por defecto en el mismo puerto.
- **Ejecución**: el preset de Vitest fuerza mock/replay; `package.json` no declara `"type"`, así que un `.ts` ejecutado por
  `tsx` corre como CommonJS (sin `import.meta.dirname` ni top-level await); no hay `tsconfig.json` en la raíz; en Windows
  `spawn('tsx')` sin shell da `ENOENT`.
- **`/lv:run`** lanza hoy `/lv:golden 10` tras el apply de este change, y `/lv:golden` apunta a rutas y tareas que no existen.

## Goals / Non-Goals

**Goals:**

- Que `extract-job` y `match-cv` solo añadan tarea evaluable, golden set y línea base.
- Que CI detecte cualquier cambio de comportamiento del pipeline de IA sin red.
- Que los fixtures del golden sean salidas reales de un modelo y se regraben con un comando.

**Non-Goals:**

- Medir calidad real de modelos (golden sintético) o elegir modelo.
- Métricas de redacción (a `cv-match-suggestions`), golden real de `extract-job` y registro de pendientes desde los tests (a
  `link-enrichment`).
- Regrabar los fixtures escritos a mano de los tests existentes: son dobles de prueba deliberados.

## Decisions

### D1 — Estructura y límites

```
libs/ai/src/evals/
├── golden.schema.ts          línea del golden y cargador JSONL
├── evaluable-task.ts         contrato: tarea de IA + schema de `expected` + métricas de conjunto
├── evaluable-tasks.ts        registro (classify-skills)
├── metrics/                  genéricas, tipo (bloqueante o informativa), agregación
├── runner/                   composición de RunTask, dobles propios, ejecución, reporte, línea base
├── recording/                grabación de fixtures
├── cli/                      args.ts (parseo y códigos), eval.ts, record-fixtures.ts
└── classify-skills/          golden.jsonl, metrics.ts, baseline.json
```

Bloque de lint para `libs/ai/src/evals/**` con la regla **base** `no-restricted-imports`; la de typescript-eslint ya lleva la
lista de SDKs de IA y ESLint no combina opciones entre bloques (ADR-017). Prohíbe `@nestjs/*`, `mongoose`, `ioredis`,
cualquier especificador que resuelva a un `index` de `libs/ai` (`..`, `../..`, `./index`, `**/index`), `**/ai.module` y
`**/application/testing/**`. El corredor usa dobles propios de ledger, cuota y breaker en `runner/`.

Nota de implementación: además de lo anterior existen `cli/eval-command.ts` y `cli/record-fixtures-command.ts` (lógica
testable de cada comando; `eval.ts` y `record-fixtures.ts` solo la invocan y fijan `process.exitCode`), `metrics/metric.ts`
(contrato de métrica), `metrics/aggregate.ts` (agregación) y el helper de tests `metrics/test-cases.spec-helper.ts`, excluido
de la compilación de la librería.

### D2 — Ejecución con `node --import tsx`

Targets `nx:run-commands` en `libs/ai/project.json`, con `cwd` en la raíz del workspace y
`env: { TSX_TSCONFIG_PATH: "libs/ai/tsconfig.lib.json" }`:

- `eval` → `node --import tsx libs/ai/src/evals/cli/eval.ts`
- `eval-ci` → lo mismo con `--all --provider=mock`, `cache: false`
- `record-fixtures` → `node --import tsx libs/ai/src/evals/cli/record-fixtures.ts`

Los argumentos del usuario los añade Nx al final; si el comando incluyera `{args}` y llegara literal, se quita (lo comprueba la
tarea 1.2). Reglas del CLI: `main().catch(...)` con `process.exitCode`, sin top-level await, rutas desde `process.cwd()`,
salida por `process.stdout.write`/`process.stderr.write`. Flags `--evals-dir` (por defecto `libs/ai/src/evals`) y
`--reports-dir` (por defecto `reports/eval`) permiten tests con directorios temporales. Los tests de humo lanzan
`spawn(process.execPath, ['--import', pathToFileURL(require.resolve('tsx'))…, <cli>])` con `TSX_TSCONFIG_PATH` absoluto, lo
que evita el `ENOENT` de Windows y la resolución de `tsx` desde un cwd temporal. `tsx` entra como devDependency.

### D3 — Composición de `RunTask` para evaluar

Proveedores de `buildProviders` sobre `parseAiConfig({ ...process.env, NODE_ENV, AI_CHAIN: <proveedor>,
AI_MOCK_MODE: 'replay' si mock, OLLAMA_URL/OLLAMA_TIMEOUT_MS de los flags si se pasan })`, con `NODE_ENV` del entorno o
`development`; `NullResultCache`; ledger en memoria propio; cuota que siempre permite; breaker que nunca abre; `AiLogger` a
`stderr`. Contexto de cada caso: sin `userId`, `aiConsent.externalProviders: true` (solo alcanzable con `--allow-external`) y
`outputLanguage` del caso o `es`. Casos **en secuencia y en orden de archivo**. `runTask` llama a `ledger.record()` de forma
síncrona antes de resolver, así que al terminar cada `execute` el doble ya tiene todos los registros de la clave (un caso
degradado deja `provider_error` y `degraded`); el corredor suma tokens y coste de todos ellos. Latencia medida alrededor de cada
`execute`.

### D4 — Tarea evaluable y golden

```ts
interface EvaluableTask<I, O, E> {
  task: AiTask<I, O>;
  expectedSchema: ZodType<E>;
  metrics: readonly { name: string; direction: 'higher' | 'lower'; compute(cases: CaseResult<I, O, E>[]): number }[];
}
```

Las métricas reciben todos los casos: caben medias por caso y métricas de conjunto (la correlación de `match-cv`).

Línea del golden: `{ id, input, expected, tags, outputLanguage? }`. El cargador valida JSON por línea, `id` únicos, `input`
contra la tarea, `expected` contra `expectedSchema` y claves de ejecución distintas; los errores nombran línea e `id` y salen con
código 2. Los 5 casos de `classify-skills` son avisos sintéticos (3 ES, 2 EN; seniority y modalidad variados),
`tags: ["placeholder"]`, con contactos solo de valores reservados: emails `@example.com`, teléfonos `7000000x`, dominios
`.example`.

Nota de implementación: `EvaluableTask` admite además `caseColumns?`, columnas específicas de la tarea para la tabla por caso
del reporte (en `classify-skills`, skills faltantes y sobrantes), de modo que el reporte de D6 no conoce ninguna tarea.

### D5 — Métricas y línea base

Genéricas: `schema_validity_rate` = casos `success` / casos (bloqueante), `degraded_rate` (bloqueante), `latency_p50`
(informativa), `cost_per_run` (informativa: en replay vale 0). `classify-skills`: `skills_recall` y `skills_precision`
(bloqueantes), media de los casos `success`; un caso sin skills esperadas no aporta recall; normalización: minúsculas, espacios
colapsados, sin puntuación final.

`baseline.json`: `{ task, promptVersion, goldenSha256, metrics }` solo con métricas bloqueantes y claves ordenadas.
`goldenSha256` es el SHA-256 del JSON canónico (ADR-018 §3) de la lista de casos parseados, así que no depende de finales de
línea ni de espacios. Con `--provider=mock`, código 1 si no existe la línea base, si `promptVersion` o `goldenSha256` difieren,
si `schema_validity_rate < 1` o si una métrica bloqueante difiere en más de `1e-9`; los mensajes distinguen "empeoró", "mejoró",
"golden cambió", "prompt cambió" y "sin línea base", y todos incluyen
`nx run ai:eval --task=<t> --provider=mock --update-baseline`. `--update-baseline` reescribe y termina en 0.

Nota de implementación: también terminan con código 1 una métrica bloqueante nueva sin valor en la línea base
(`metric_added`), una métrica de la línea base que ya no se calcula (`metric_removed`) y un `baseline.json` ilegible
(`invalid`). `--update-baseline` solo se acepta con `--provider=mock`; con otro proveedor es error de uso (código 2).

### D6 — Reporte y códigos de salida

`reports/eval/<task>/<proveedor>.md` (ignorado por git): cabecera (tarea, prompt, proveedor, modelo, fecha, advertencia si
`placeholder`), tabla de métricas con tipo y valor de línea base en replay, tabla por caso (id, tags, estado, latencia, skills
faltantes y sobrantes). Sin inputs ni salidas completas.

Códigos: **0** éxito (con proveedores reales también si hay casos degradados); **1** regresión respecto a la línea base o
grabación incompleta; **2** uso o configuración (tarea desconocida, golden inválido, `--allow-external` ausente, configuración
de IA inválida, grabación con `NODE_ENV=production`); **3** error de programación (`AiProgrammingError`, incluido
`FixtureMissing`).

### D7 — Grabación como comando

`ai:record-fixtures --task --upstream [--overwrite] [--allow-external] [--ollama-url] [--timeout-ms] [--evals-dir]`: compone
`RunTask` como en D3 con `AI_CHAIN=<upstream>` y ejecuta los casos del golden. En `success` escribe
`<AI_FIXTURES_DIR>/<task>/<key>.json` con `{ source: "recorded:<upstream>:<model>", text: JSON.stringify(output), model, usage }`:
salida validada y reinyectada, tokens del ledger en memoria. La redacción para upstream externo y tarea `personal` la aplica
`runTask`. Fixture existente sin `--overwrite`: se omite sin contactar al proveedor. `NODE_ENV=production` o upstream externo
sin `--allow-external` → código 2 antes de contactar a nadie. `parseAiConfig` mantiene el rechazo de `AI_MOCK_MODE=record` con
el detalle "use nx run ai:record-fixtures".

Nota de implementación: un `success` cuyo `providerId` no es el upstream pedido no se graba y cuenta como caso no grabado
(código 1), para que un fixture nunca atribuya al upstream la salida de otro proveedor.

### D8 — Ollama local para grabar

Antes de descargar nada se consulta `GET http://127.0.0.1:11434/api/tags`. Si la app de escritorio ya tiene `qwen2.5:7b`,
**el humano elige** usarla (sin descarga, posiblemente con GPU) o el contenedor. Si se usa el contenedor, se levanta con
`OLLAMA_PORT=11435` y se descarga el modelo con `docker compose --profile ai-local exec ollama ollama pull qwen2.5:7b` (~4.7 GB)
**solo tras confirmación**. La grabación y la corrida de referencia usan `--ollama-url` explícito y `--timeout-ms 300000`, en
lugar de depender de `.env`. `.env.example` y el README documentan el puerto alternativo como caso general.

Las tareas que tocan el modelo (5.2 a 5.4) terminan el apply con el marcador `APPLY: PAUSA (modelo)` si no hay confirmación
humana en la conversación, en lugar de descargar o marcar sin hacer.

Resultado (tarea 5.2): la app de escritorio solo tenía `qwen2.5:3b`; el humano eligió descargar `qwen2.5:7b` en la app de
escritorio (`127.0.0.1:11434`, GPU), y `GET /api/tags` confirmó el modelo antes de grabar.

### D9 — Grabación del golden y contingencia

Se graban solo los fixtures del golden. Si un caso no produce salida válida, se reintenta hasta 2 veces; si persiste, se ajusta
el texto del caso sintético (es un placeholder) y se vuelve a grabar. La corrida de referencia contra Ollama no se versiona:
sus métricas se resumen en la descripción del PR (con la advertencia de golden placeholder) y la línea base se escribe después,
en replay, en el mismo commit que los fixtures.

### D10 — CI

Tras `Test`: step `pnpm nx affected -t eval-ci` con `env: { NODE_ENV: test, AI_CHAIN: mock, AI_MOCK_MODE: replay }`. Sin
artefacto: el fallo nombra la métrica y ambos valores y se reproduce en local en segundos. El step llega a CI cuando la línea
base ya existe (tarea 6.1 después de 5.4).

### D11 — Automatización y documentación

- `/lv:run`: se quita la invocación de `/lv:golden` asociada a este change; el disparo de `/lv:golden 20` pasa al alcance de
  `link-enrichment` (manifiesto), tras registrar `extract-job`.
- `/lv:golden`: rutas `libs/ai/src/evals/<task>/`, sin `--validate` inexistente, cantidad por defecto 20, exige tarea
  registrada.
- `/lv:fixtures`: graba con `nx run ai:record-fixtures` los casos del golden que falten; el registro automático de fixtures
  pendientes desde tests llega con `link-enrichment`. El paso de revisión comprueba que el fixture solo contiene valores del
  input (reinyectados), no datos personales inventados.
- CLAUDE.md (sección del módulo IA), RUNBOOK y `.env.example` sustituyen "modo `record`" por el comando y corrigen la promesa del
  modelo `:free` ("se fija cuando haya clave").

## Risks / Trade-offs

- **Golden sintético** → métricas de coherencia, no de calidad; advertencia en el reporte; golden real en `link-enrichment`.
- **Línea base estricta** → toda regrabación o cambio de prompt requiere `--update-baseline` en el mismo commit; es intencionado.
- **7B en CPU lento o sin salida válida** → timeout de 300 s por flag, reintentos y ajuste del caso sintético (D9).
- **Dos Ollama en el equipo** → consulta previa, elección humana y `--ollama-url` explícito en cada comando.
- **`tsx` en CommonJS** → reglas del CLI de D2 y tests de humo en proceso hijo.

## Migration Plan

Sin migraciones de datos. Orden: automatización (`/lv:run`, `/lv:golden`) → base → métricas → corredor → grabación → golden →
modelo y grabación (pausa humana) → línea base → CI → docs. Reversión: quitar el step y los targets; los fixtures grabados
siguen siendo válidos.

## Open Questions

- Modelo `:free` por defecto de OpenRouter: requiere una clave real; no cambia specs ni tareas.
