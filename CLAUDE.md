# LinkVault — reglas para Claude Code

## Contexto obligatorio
Antes de cualquier tarea lee, en este orden: `docs/design-v0.2.md` (decisiones vigentes), `docs/design.md` (base),
`docs/adr/` (ADR-001..016). Si un ADR contradice a design.md, gana el ADR. Si algo no está decidido, pregunta antes de asumir.

## Flujo de trabajo (Spec-Driven con OpenSpec)
- NUNCA edites `apps/**` o `libs/**` sin un change activo en `openspec/changes/<nombre>/` (el hook lo bloquea).
- Orden por change: `/opsx:new` → `/opsx:ff` → **debate critic/business/reflect** → aprobación humana → `/opsx:apply` → `/opsx:verify` → PR → `/opsx:archive`.
- Antes de `/opsx:apply` de cualquier change con `design.md`: convoca a los subagentes `critic` y `business`, actúa como `reflect`,
  itera hasta que no quede ningún P0/V0 abierto y registra decisiones no triviales en `docs/adr/ADR-XXX.md`.
- Secuencia de changes: ver `docs/design-v0.2.md` §6. No adelantes features de una fase posterior.

## Arquitectura (resumen; detalle en docs)
- Monorepo **Nx** con pnpm. `apps/api` (NestJS, Fastify), `apps/worker` (NestJS standalone + BullMQ), `apps/web` (Angular 22),
  `libs/shared` (zod schemas, enums, eventos de integración), `libs/ai` (módulo IA).
- Monolito modular: un módulo NestJS por bounded context (`auth`, `groups`, `links`, `enrichment`, `applications`, `cv`, `ai`).
- Clean architecture por módulo: `domain/ application/ infrastructure/ presentation/`.
  - `domain/` no importa `@nestjs/*`, `mongoose`, `bullmq` ni otros módulos.
  - Casos de uso dependen de interfaces (ports) inyectadas por tokens: `{ provide: X_REPOSITORY, useClass: MongoXRepository }`.
  - Entre módulos: eventos de dominio (EventEmitter2 in-process) y eventos de integración versionados en `libs/shared/events` vía BullMQ.
- Persistencia: MongoDB (replica set de 1 nodo, siempre), Redis (BullMQ, caché), MinIO (CVs). Outbox pattern para todo lo que encola (ADR-009).
- Dedupe de links: `platform:externalJobId` con fallback `urlHash` (ADR-008). Procedencia por campo en `JobPreview` (ADR-010).
- Auth: access token en memoria, refresh en cookie httpOnly con rotación, Argon2id (ADR-012).

## Módulo IA (`libs/ai`) — reglas duras
- Único punto de entrada: `runTask(task, input, ctx)`. Prohibido importar SDKs de proveedores fuera de `libs/ai/infrastructure/providers` (lint `no-restricted-imports`).
- Cada proveedor declara `capabilities`; el routing filtra por capacidades, consentimiento, cuota y circuit breaker (ADR-014).
- Salidas estructuradas: `temperature 0`, zod, un repair prompt, luego siguiente proveedor, luego degradación honesta (`RuleBasedMatcher`).
- Mock determinista con modos `replay` (CI) y `synth` (dev); fixtures reales con `nx run ai:record-fixtures` (ADR-019). `synth` prohibido en producción. Clave según ADR-018 §3.
- Cambiar prompt, modelo o fixtures del golden = `nx run ai:eval --provider=mock --update-baseline` en el mismo commit.
- Prompts en `libs/ai/infrastructure/prompts/<task>.vN.md` (front-matter + Mustache). Cambiar prompt = nueva versión + fixtures + corrida del eval harness.
- Proveedores `external` reciben el input pasado por `PiiRedactor`. Nunca persistir prompts renderizados ni loguear claves.
- En tests y CI: `AI_CHAIN=mock`, `AI_MOCK_MODE=replay`.

## Calidad
- Tests con Vitest. Cada caso de uso con test unitario (repositorios en memoria). Integración con `mongodb-memory-server` (replset) o testcontainers.
- `pnpm nx affected -t lint,typecheck,test` debe pasar antes de dar por terminada una tarea. Sin `any`. Sin `console.log` (usar pino).
- Commits convencionales: `feat(links):`, `fix(ai):`, `spec:`, `chore:`. Un change ≈ un PR.

## Frontend
- Angular 22 standalone, signals, zoneless, `@ngrx/signals`, rutas lazy por feature, Angular Material + Tailwind, i18n ES/EN (ES por defecto).

## Seguridad y legal
- Extractores: respetar `robots.txt`, cola por dominio, `User-Agent` identificable. Headless solo con `FEATURE_HEADLESS_EXTRACTION=true`.
- Nunca loguear tokens, claves BYOK ni texto de CV.

## Idioma
- Código, identificadores y commits en inglés. Documentación, specs de OpenSpec y comentarios de dominio en español.
