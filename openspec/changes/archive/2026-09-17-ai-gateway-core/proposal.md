## Why

`libs/ai` hoy solo contiene contratos como tipos: ningún change posterior puede usar modelos de lenguaje. `link-enrichment`
necesita `extract-job`, `cv-match-suggestions` necesita `match-cv` y `study-roadmap` necesita `build-roadmap`, y los tres
dependen de la misma pieza: un único punto de entrada que elija proveedor, valide la salida, proteja datos personales,
contabilice el uso y no rompa el producto cuando no hay IA disponible. Construirlo ahora, con proveedores gratuitos y un mock
determinista, permite que esos changes se desarrollen y prueben en CI sin red ni costo (ADR-005, ADR-014, ADR-018).

## What Changes

- **`runTask(task, input, ctx)`** como única forma de invocar modelos (design-v0.2 §4.3): valida el input, calcula la clave
  determinista con el idioma de salida, consulta la caché, construye la cadena de proveedores, redacta PII en tareas con datos
  personales enviadas a proveedores externos, renderiza el prompt, completa, valida la salida y registra el uso.
- **`StructuredOutputPipeline`**: parse tolerante, validación zod, **una** reparación por proveedor, siguiente proveedor y
  **resultado degradado tipado** cuando la cadena se agota. `degrade(input)` opcional por tarea.
- **`RoutingPolicy`** pura: capacidades, consentimiento, circuitos abiertos; orden BYOK → coste → local antes que externo →
  contexto → orden de `AI_CHAIN`.
- **Modo "sin IA" explícito** (`AI_CHAIN=none`) y **mock prohibido en producción**.
- **Proveedores**: `MockDeterministicProvider` en modos `replay` y `synth` (muestra determinista por tarea), `OllamaProvider`
  y `OpenRouterProvider` (solo modelos `:free`). Sin proveedores de pago ni BYOK.
- **`PromptRegistry`** (§4.6): `infrastructure/prompts/<task>.vN.md` con front-matter y Mustache.
- **`AiUsageLedger` en MongoDB**, no bloqueante, con `outcome` `success | schema_error | provider_error | quota | degraded`.
- **Cuotas** diarias por usuario y tarea desde configuración, contadas sobre el ledger y abiertas ante fallo.
- **Circuit breaker** por proveedor en memoria de cada proceso (5 fallos en 60 s, half-open a los 30 s).
- **Caché en Redis** compartida entre procesos, desactivada cuando la cadena incluye `mock`.
- **`PiiRedactor`** para tareas `personal`: email, teléfono (BO, internacional y LatAm) y URL, nombre opcional, con
  reinyección en la salida.
- **Sensibilidad de datos por tarea** (`personal` por defecto, `public` para tareas sobre contenido público).
- **Tarea de ejemplo `classify-skills`** con prompt `v1`, muestra para `synth` y fixtures de replay.
- **`AiModule`** de NestJS en `libs/ai`, cableado en `apps/worker`, con configuración validada antes de crear Nest y variables
  nuevas en `.env.example` (que pasa a `AI_MOCK_MODE=synth` para desarrollo).

No hay cambios *BREAKING* en comportamiento existente.

## Capabilities

### New Capabilities
- `ai/task-execution`: punto de entrada único, salida estructurada con reparación, clave determinista, caché, degradación
  tipada y prompts versionados.
- `ai/provider-routing`: cadena configurable (incluido "sin IA"), capacidades, consentimiento, orden, timeouts, circuit
  breaker y proveedores Ollama y OpenRouter.
- `ai/deterministic-mock`: mock determinista en modos `replay` y `synth`, prohibido en producción.
- `ai/usage-accounting`: ledger de uso por intento, coste estimado y cuotas por usuario y tarea.
- `ai/data-protection`: sensibilidad de datos por tarea, redacción de PII para proveedores externos, sin persistir prompts ni
  registrar secretos.

### Modified Capabilities
- `platform/workspace`: el requisito "Contratos del módulo de IA disponibles como tipos" prohíbe que `libs/ai` contenga
  proveedores y `runTask`; este change lo sustituye por la ubicación por capas de contratos, implementaciones, tareas y módulo.

## Impact

- **Código**: `libs/ai` (domain, application, infrastructure, tasks, prompts, fixtures, `ai.module.ts`); `apps/worker`
  importa `AiModule`; los schemas de configuración de api y worker aceptan `AI_CHAIN=none`.
- **Configuración**: `.env.example` con `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_MAX_CONTEXT_TOKENS`, `OLLAMA_TIMEOUT_MS`,
  `OPENROUTER_BASE_URL`, `OPENROUTER_API_KEY` (vacía), `OPENROUTER_MODEL`, `OPENROUTER_TIMEOUT_MS`,
  `AI_CACHE_TTL_SECONDS`, `AI_QUOTAS` (vacía), `AI_FIXTURES_DIR`, `AI_PROMPTS_DIR`; `AI_MOCK_MODE=synth`.
- **Persistencia**: colección `ai_usage` en MongoDB; claves `ai:cache:v1:*` en Redis.
- **Tests**: `libs/ai` pasa a usar el preset con Mongo en memoria y SWC; el doble RESP de `tools/testing` gana `GET`, `SET`
  y `DEL`.
- **Dependencias externas nuevas**: `mustache` y `yaml`. Ollama y OpenRouter por HTTP, sin SDK.
- **ADRs**: implementa **ADR-005** (puerto `LlmProvider` con adaptadores, seleccionados con `AI_CHAIN`), **ADR-014** y respeta
  **ADR-016** (sin embeddings ni streaming estructurado) y **ADR-017**; crea **ADR-018** (decisiones de este change).
- **Diferido**: modo `record` y su punto de entrada (`ai-eval-harness`); detectores de dirección y documento de identidad
  (`cv-match-suggestions`); ambos anotados en `openspec-changes.yaml`.
- **Fuera de alcance**: eval harness, `RuleBasedMatcher`, evaluator-optimizer, BYOK, Anthropic/OpenAI, colección `ai_quotas`
  por plan, endpoints HTTP de IA y las tareas `extract-job`, `match-cv`, `critique-suggestions` y `build-roadmap`.
