# LinkVault — Runbook de arranque en Claude Code

> Objetivo: en ~2 horas tener el repo con todo el contexto cargado, OpenSpec inicializado, los 8 agentes operativos y el primer change (`bootstrap-monorepo`) aplicado. Todo lo que Claude Code necesita saber ya está en `CLAUDE.md`, `docs/` y `docs/adr/`; tu trabajo es orquestar y aprobar.

---

## Paso 0 — Prerrequisitos (15 min)

```bash
node -v        # ≥ 22 LTS
corepack enable && corepack prepare pnpm@latest --activate
pnpm -v        # ≥ 9
docker --version && docker compose version
jq --version   # opcional; el hook funciona sin él
git --version
```

Claude Code y OpenSpec:
```bash
npm i -g @anthropic-ai/claude-code      # si no lo tienes; luego `claude` y autentícate
npm i -g @fission-ai/openspec@latest
openspec --version
```

Opcional para IA local gratuita:
```bash
# instala Ollama desde ollama.com y luego:
ollama pull qwen2.5:7b
```

---

## Paso 1 — Crear el repo y cargar el contexto (10 min)

```bash
mkdir linkvault && cd linkvault && git init -b main
# descomprime linkvault-starter.zip y copia TODO su contenido a la raíz (incluye .claude/ oculto)
cp -R /ruta/a/linkvault-starter/. .
chmod +x .claude/hooks/require-openspec-change.sh
cat > .gitignore <<'EOF'
node_modules/
dist/
.nx/
.env
.env.*
coverage/
*.log
.claude/settings.local.json
EOF
git add -A && git commit -m "chore: bootstrap context (design, ADRs, Claude Code agents/hooks)"
```

Qué acabas de cargar:

| Archivo | Para qué |
|---|---|
| `CLAUDE.md` | Reglas que Claude Code lee en cada sesión: flujo OpenSpec, arquitectura, módulo IA, calidad |
| `docs/design.md` | Diseño v0.1 (contexto, arquitectura, modelo de datos, despliegue) |
| `docs/design-v0.2.md` | Decisiones vigentes: debate Critic/Business, flujos, módulo IA §4, plan de 15 changes §6 |
| `docs/adr/ADR-001..016.md` | Decisiones atómicas que los agentes citan y respetan |
| `.claude/agents/*.md` | 8 subagentes: architect, backend-dev, frontend-dev, devops, ai-engineer, qa-reviewer, critic, business |
| `.claude/hooks/require-openspec-change.sh` | Bloquea edición de `apps/**` y `libs/**` sin change activo |
| `.claude/settings.json` | Permisos y hooks (PreToolUse + Stop → `openspec validate`) |

---

## Paso 2 — Inicializar OpenSpec (5 min)

```bash
openspec init
# → selecciona "Claude Code" como herramienta. Crea openspec/ (specs/, changes/, project.md) y los comandos /opsx:*
```

Rellena `openspec/project.md` con este bloque (Claude Code lo lee al crear proposals):
```markdown
# LinkVault
Repositorio colaborativo de vacantes: cuentas personales, grupos, links compartidos con preview enriquecido,
tracking de postulación por usuario, y análisis de CV + roadmap con IA.

## Stack
Nx monorepo · NestJS 11 (Fastify) api + worker (BullMQ) · Angular 22 · MongoDB (replset) · Redis · MinIO · Vitest · Docker.

## Convenciones
Ver CLAUDE.md. Decisiones vigentes en docs/design-v0.2.md y docs/adr/. Specs en español; código en inglés.
Cada Requirement de spec debe tener al menos un Scenario y cada Scenario un test.
```

```bash
git add -A && git commit -m "spec: init openspec"
```

---

## Paso 3 — Primera sesión: verificar que Claude Code "entendió" (15 min)

```bash
claude
```
Dentro de Claude Code:

1. `/agents` → confirma que aparecen los 8 agentes del proyecto.
2. `/hooks` → confirma el PreToolUse y el Stop.
3. Pega este prompt (no produce código, solo valida contexto):

```
Lee CLAUDE.md, docs/design-v0.2.md, docs/design.md y todos los docs/adr/. Luego respóndeme en español, sin escribir código:
1) Resume en 10 líneas la arquitectura y el flujo de trabajo que vas a seguir.
2) Lista los 15 changes de docs/design-v0.2.md §6 en orden con su agente principal.
3) Enumera las 6 reglas duras del módulo IA.
4) Dime qué decisiones te parecen ambiguas o incompletas para implementar el change 1 (bootstrap-monorepo).
No inventes decisiones: si algo no está en los docs, dilo.
```

Si el punto 4 devuelve ambigüedades reales, resuélvelas ahora: edita `docs/design-v0.2.md` o crea `docs/adr/ADR-017.md`. Commitea.

---

## Paso 4 — Change 1: `bootstrap-monorepo` (60–90 min, la mayor parte esperando)

### 4.1 Crear el change y sus artefactos
```
/opsx:new bootstrap-monorepo
```
```
/opsx:ff
```
`ff` (fast-forward) genera `openspec/changes/bootstrap-monorepo/{proposal.md, design.md, tasks.md, specs/**}`.
Antes, dale este contexto en el mismo mensaje del `/opsx:ff` o justo después:

```
Para bootstrap-monorepo, el proposal debe referenciar ADR-001, 006, 007, 009, 011 y 014. Alcance exacto:
- Nx workspace con pnpm: apps/api (Nest + Fastify), apps/worker (Nest standalone), apps/web (Angular 22 standalone, zoneless), libs/shared, libs/ai (vacía salvo estructura de carpetas y ports).
- ESLint con regla no-restricted-imports para @anthropic-ai/sdk, openai, ollama, @openrouter/* fuera de libs/ai/infrastructure/providers, y regla de capas (domain no importa @nestjs, mongoose, bullmq).
- Vitest configurado en los 5 proyectos con un test trivial cada uno.
- docker-compose.yml: mongo 7 como replica set rs0 (inicializado por su healthcheck, ver ADR-017), redis 7, minio, ollama bajo profile ai-local. .env.example con las variables de docs/design.md §7.8.
- GitHub Actions: lint → openspec validate --all → nx affected test (AI_CHAIN=mock) → build.
- README con comandos: pnpm install, docker compose up -d, pnpm nx serve api|worker|web.
NADA de features de negocio. Los health checks /health en api y worker son el único endpoint.
```

### 4.2 Debate Critic / Business / Reflect (el ciclo que definimos)
```
Convoca a los subagentes critic y business sobre openspec/changes/bootstrap-monorepo/ (proposal, design, tasks, specs).
Que cada uno entregue su tabla y cierre con "P0 abiertos: N" / "V0 abiertos: N".
Luego actúa como reflect: cruza ambas tablas, decide aceptado/adaptado/diferido/rechazado con una línea de motivo,
actualiza design.md y tasks.md, y repite el ciclo hasta que ambos reporten 0 abiertos. Máximo 3 iteraciones.
Si una decisión cambia un ADR o crea uno nuevo, escribe docs/adr/ADR-0XX.md. Termina con la tabla final y la declaración de convergencia.
```

### 4.3 Tu revisión humana (no la saltes)
Abre y lee: `proposal.md` (¿alcance correcto?), `design.md` (¿respeta ADRs?), `tasks.md` (¿tareas pequeñas, etiquetadas [infra]/[backend]/[frontend]/[ai]?), `specs/` (¿cada Requirement tiene Scenario?).
Cuando estés conforme:
```bash
git add -A && git commit -m "spec(bootstrap-monorepo): proposal, design, tasks approved"
```

### 4.4 Implementar
```
/opsx:apply
```
Sugerencia de reparto en el mismo mensaje:
```
Ejecuta tasks.md delegando: tareas [infra] al subagente devops, [backend] a backend-dev, [frontend] a frontend-dev, [ai] a ai-engineer.
Trabaja tarea por tarea, marca cada una en tasks.md al terminar, y al final corre pnpm nx run-many -t lint,typecheck,test.
Si una tarea no puede completarse sin decidir algo que no está en los docs, detente y pregúntame.
```
Mientras corre: acepta los permisos que pida de forma razonable (los `Bash(pnpm *)` ya están permitidos). Si se atasca > 10 min en un mismo error, `Esc` y pídele que explique el bloqueo antes de seguir.

### 4.5 Verificar, revisar, archivar
```
/opsx:verify
```
```
Convoca a qa-reviewer sobre el change bootstrap-monorepo. Que entregue la tabla criterio/estado/evidencia/acción.
Corrige lo que marque como fallido y vuelve a correr qa-reviewer hasta que todo esté en verde.
```
Luego tú, fuera de Claude Code:
```bash
docker compose up -d
pnpm install
pnpm nx run-many -t lint,typecheck,test
pnpm nx serve api   # http://localhost:3000/health
pnpm nx serve web   # http://localhost:4200
```
Si todo levanta:
```
/opsx:archive
```
```bash
git add -A && git commit -m "feat: bootstrap Nx monorepo (api, worker, web, shared, ai)"
```

---

## Paso 5 — El bucle para los changes 2..15

Para cada change de `docs/design-v0.2.md` §6, exactamente el mismo ciclo:

```
/clear                                   ← empieza cada change con contexto limpio
/opsx:new <nombre-del-change>
/opsx:ff  + párrafo de alcance (copia la fila de §6 y los ADRs implicados)
[debate critic/business/reflect]         ← prompt de 4.2
[tu revisión + commit spec(...)]
/opsx:apply + reparto por agentes        ← prompt de 4.4
/opsx:verify
[qa-reviewer hasta verde]
[prueba manual: docker compose up + nx serve]
/opsx:archive + commit feat(...)
```

Orden y notas específicas:

| # | Change | Nota para el prompt de alcance |
|---|---|---|
| 2 | `ai-gateway-core` | Pega literal docs/design-v0.2.md §4.1–4.6, 4.9, 4.10 y la spec de §4.13. Pide primero `MockDeterministicProvider` en modo `synth` y `replay`, luego Ollama, luego OpenRouter. Sin proveedores de pago aún. |
| 3 | `ai-eval-harness` | §4.11. Corredor, métricas y línea base con 5 casos sintéticos (`placeholder`) de `classify-skills`; el golden de `extract-job` que dejó `link-enrichment` también es sintético, y el real (`/lv:golden 20`) sigue pendiente (ADR-019). |
| 4 | `auth-users` | ADR-012. Incluir `aiConsent`, `outputLanguage`. |
| 5 | `groups` | Invitación por código; roles owner/member. `/` pasa a ser la lista de grupos con estado vacío (sustituye el saludo de `auth-users`). |
| 6 | `job-links` | ADR-008, 009. Canonicalizadores para LinkedIn, Computrabajo, Indeed, Trabajopolis, Get on Board. Import desde texto (B1). "Ya está en Grupo X" (B6). |
| 7 | `link-enrichment` | ADR-003, 010 y **ADR-022** (cierra las decisiones del change). Un host a la vez con mutex en Redis, `extract-job` vía `runTask`, SSE, backfill por el outbox. Cómo operarlo: Paso 6 bis. |
| 7b | `groups-ownership-join-limit` | Fuera de §6, antes de `applications-tracking`: transferencia de propiedad del grupo y límite de intentos del join (**ADR-025**). Cómo operarlo: Paso 6 quater. |
| 8 | `applications-tracking` | ADR-004, 015 y **ADR-024** (transiciones libres, visibilidad derivada, "Dejar de seguir"). Kanban + timeline. Cómo operarlo: Paso 6 quinquies. |
| 9 | `group-comments` | Planos, sin hilos. |
| 10 | `public-preview-share` | ADR-013. |
| 11 | `cv-upload-extract` | MinIO, pdf-parse, mammoth. |
| 12 | `cv-match-suggestions` | §4.7 y 4.12 (el bucle de juez §4.8 va en `cv-suggestions-review`). `match-cv`, `ai_analyses`, `fitScore` derivado, consentimiento con versión `2026-09-21`, sin SSE de progreso. Cómo operarlo: Paso 6 nonies. ADR-029/030. |
| 13 | `study-roadmap` | Catálogo curado `resources.seed.json` primero. Cómo operarlo: Paso 6 decies. |
| 14 | `ai-byok` | Vault libsodium + claves por persona (Anthropic/OpenAI/OpenRouter). Cómo operarlo: Paso 6 undecies. ADR-032. |
| 15 | `auth-email-recovery` | Mailer (Resend/Mailpit/captura), verify + reset, `emailVerified`; **ADR-034**. DNS SPF/DKIM: Paso 6 terdecies. |
| 16 | `deploy-prod` | compose prod + Traefik + GHCR CD (ADR-033). Camino canónico: [`infra/README.md`](../infra/README.md). Operación: **Paso 6 duodecies** (reseteo password Argon2id como **fallback** si falla el email — Paso 6 terdecies; GC huérfanos, un owner, relay único, ack BullMQ si user gone). |

**Paralelizar front y back (changes 4–8):** en `/opsx:apply` pide:
```
Crea un equipo: backend-dev implementa las tareas [backend] y frontend-dev las [frontend] en paralelo.
Antes de que arranquen, fija el contrato en libs/shared (schemas zod + endpoints) y no lo cambien sin avisarme.
```

---

## Paso 6 — Higiene de sesión que evita problemas

- **Un change por sesión.** `/clear` al empezar; `/compact` si la conversación pasa de ~40 turnos.
- **Plan mode** (`Shift+Tab` dos veces) para cualquier prompt de diseño o refactor: Claude propone, tú apruebas, luego ejecuta.
- **Retomar:** `claude --continue` reanuda la última sesión; `claude --resume` elige una.
- **No edites `CLAUDE.md` a mano en caliente:** pídele a Claude Code `# <regla nueva>` (la tecla `#` agrega a CLAUDE.md) para que quede consistente.
- **Cuando el hook bloquee una edición**, es correcto: crea el change o marca la tarea dentro del change activo.
- **Fixtures del mock:** la grabación es un comando (ADR-019). Para los casos del golden de una tarea evaluable, `pnpm nx run ai:record-fixtures --task=<t> --upstream=ollama --ollama-url=http://localhost:11434 --timeout-ms=300000` graba los que falten (OpenRouter solo con `--upstream=openrouter --allow-external`); revisa el JSON y comprueba replay con `pnpm nx run ai:eval --task=<t> --provider=mock`. Si cambian las métricas, `--update-baseline` en el mismo commit que los fixtures.
- **Feedback → candidatos (B14):** `pnpm nx run ai:export-feedback-candidates --from-json=<dump.json>` o con `MONGO_URI` / `--mongo-uri` lee la colección `ai_feedback` y escribe `libs/ai/src/evals/match-cv/candidates.jsonl` (o `--out=`). **No modifica** `golden.jsonl` de `match-cv` ni de `critique-suggestions`; la promoción al golden es manual tras revisión.
  > **Fixtures pendientes (desde `link-enrichment`): ya no se escriben a mano.** Cuando un test en replay pide una ejecución cuyo fixture no existe, `runTask` la anota en `tmp/ai-pending-fixtures.jsonl` (o donde diga `AI_PENDING_FIXTURES_FILE`) con la tarea, la versión del prompt, el idioma de salida y la clave que falta. Para grabarlas: `pnpm nx run ai:record-fixtures --from-pending --upstream=ollama --ollama-url=http://localhost:11434`, con `--task=<t>` para filtrar por tarea y `--pending-file=<archivo>` para leer otro registro (ese flag solo vale con `--from-pending`). El registro solo se escribe durante los tests, nunca en producción, y un test que espera la ausencia del fixture lo apaga con `AI_PENDING_FIXTURES=off`. Lo que no se puede grabar (tareas `personal`, que nunca llevan su entrada, o entradas obsoletas) se lista con su motivo y no hace fallar el comando. `AI_MOCK_MODE=record` sigue rechazándose al arrancar e indica usar `nx run ai:record-fixtures`.

## Paso 6 bis — Operar el enriquecimiento de links

Desde `link-enrichment`, `apps/worker` consume la cola `enrich-link` y escribe el preview de cada oferta. El detalle
está en el [README](../README.md#enriquecimiento-de-ofertas) y las decisiones en [ADR-022](adr/ADR-022.md); aquí solo lo
que hay que tener presente al operar y al probar a mano.

- **Variables nuevas, obligatorias.** El worker lee `ENRICH_FETCH_TIMEOUT_MS`, `ENRICH_MAX_BYTES`,
  `ENRICH_DOMAIN_DELAY_MS`, `ENRICH_DEADLINE_MS`, `ENRICH_ROBOTS_TTL_SECONDS`, `ENRICH_USER_AGENT`,
  `ENRICH_CONCURRENCY`, `ENRICH_MAX_DEFERRALS` y las `S3_*` del snapshot (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`,
  `S3_SECRET_KEY`, `S3_SNAPSHOTS_BUCKET`). **Un `.env` anterior a este change no las tiene y el worker no arranca**:
  cópialas de `.env.example` antes de levantarlo. `docker compose up -d --wait` crea el bucket de snapshots con su
  regla de expiración a 30 días.
- **Hay bolsas que no se pueden leer, y el producto lo dice.** Con la medición del 2026-09-17 (ADR-022), **LinkedIn** e
  **Indeed** prohíben la lectura en su `robots.txt` (`robots_disallowed`) y **Computrabajo** nos bloquea con `403`
  (`blocked`). No es un fallo del producto, no se reintenta, y la salida es completar el preview a mano. Al probar el
  enriquecimiento de punta a punta usa **Trabajopolis** (JSON-LD) o **Get on Board** (Open Graph), que sí se leen.
- **Reencolar lo que quedó sin leer:** `pnpm nx run api:backfill-enrichment --status=pending --limit=500` (y
  `--status=failed` para rescatar solo los motivos transitorios). Es manual a propósito: no corre al desplegar, porque
  un despliegue no es razón para volver a descargar páginas ajenas. Funciona con `OUTBOX_RELAY_ENABLED=false`: escribe
  en el outbox y el relay publica cuando vuelva.
- **El golden real de `extract-job` tiene fecha límite.** El snapshot de cada página vive **30 días**; pasados, hay que
  volver a descargarla. Si vas a correr `/lv:golden 20` con vacantes reales, hazlo dentro de esa ventana.

## Paso 6 ter — Operar el pegado de descripciones

Desde `paste-job-description`, una oferta que la bolsa no deja leer se completa **pegando su texto**
(`POST /api/links/:linkId/pasted`), y `api` lo lee con IA dentro de la misma petición. El detalle para quien usa el
producto, los códigos y la precedencia están en el [README](../README.md#pegar-la-descripción); las decisiones, en
[ADR-023](adr/ADR-023.md). Aquí, lo que hay que tener presente al operar y al probar a mano.

- **`api` ejecuta IA y tiene una variable nueva, obligatoria.** Valida al arrancar la configuración de IA con el mismo
  `parseAiConfig` que el worker (`AI_*`, `OLLAMA_*`, `OPENROUTER_*`) y además `PASTE_EXTRACTION_TIMEOUT_MS` (`20000`,
  de 1 000 a 120 000 ms). **Un `.env` anterior no la tiene y `api` no arranca**: copia de `.env.example`
  `PASTE_EXTRACTION_TIMEOUT_MS` y la sección `--- IA ---`. Un `api` compilado que no arranque desde la raíz necesita
  `AI_PROMPTS_DIR=dist/apps/api/assets/ai/prompts`; el build los copia y CI lo comprueba en el paso "Check prompt
  assets".
- **El texto pegado no se guarda en ningún sitio.** Ni en Mongo, ni en el outbox, ni en BullMQ, ni en la caché, ni en
  los logs, ni en el registro de fixtures pendientes. Al depurar no lo busques: no está, a propósito. El ledger
  `ai_usage` registra cada lectura (resultado, motivo, proveedor, latencia) sin su entrada.
- **Es un dato personal.** La tarea `extract-pasted-job` es `personal`: no va a un proveedor externo sin el
  consentimiento de quien pega. Con mock u Ollama no sale de la máquina. **Antes de añadir OpenRouter (u otro externo)
  a la cadena de `api`** hay que añadir el código `ai_consent_required` (ADR-023, riesgos aceptados): sin él, una
  cadena solo de externos respondería `503` "inténtalo en un rato" para siempre a quien no dio su consentimiento.
- **Límites.** 10 pegados por usuario cada 15 min (contador `links:paste:<userId>` en Redis, que falla cerrado con
  `503`), y un `503` de la IA devuelve el intento. Aparte, la cuota diaria de IA de `extract-pasted-job` en
  `AI_QUOTAS`, independiente de la de `extract-job`; vacía, no hay cuota.
- **Probar a mano.** En desarrollo, `.env.example` deja `AI_CHAIN=mock` con `AI_MOCK_MODE=synth`, que responde sin
  modelo. Para medir un modelo real: `AI_CHAIN=ollama` en tu `.env`, `pnpm nx serve api`, y súbele
  `PASTE_EXTRACTION_TIMEOUT_MS` si Ollama corre en CPU. El golden de la tarea se evalúa con
  `pnpm nx run ai:eval --task=extract-pasted-job --provider=mock`; cambiar su prompt exige `--update-baseline` en el
  mismo commit.
- **Rescate por historial** (worker). Si el `robots.txt` prohíbe la `displayUrl`, el worker prueba las demás URLs de
  `originalUrls` **del mismo host**, las más recientes primero y dentro del mismo turno, y lee la primera permitida;
  `displayUrl` no cambia. Se dispara **al volver a guardar la vacante con una URL nueva del mismo host** sobre un link
  en `failed` por `robots_disallowed`: ese guardado sube `previewVersion`, lo pasa a `pending` y escribe en el outbox.
  No hay backfill para los que ya están así, y `api:backfill-enrichment --status=failed` sigue sin tocarlos.

## Paso 6 quater — Operar la propiedad de los grupos y el límite del join

Desde `groups-ownership-join-limit`, el owner de un grupo puede nombrar propietario a otro miembro
(`POST /api/groups/:id/owner`) y `POST /api/groups/join` cuenta los códigos incorrectos. El detalle para quien usa el
producto está en el [README](../README.md#roles) (roles y transferencia) y en [Límites](../README.md#límites); las
decisiones, en [ADR-025](adr/ADR-025.md). Aquí, lo que hay que tener presente al operar y al probar a mano. Los comandos
usan el Mongo y el Redis del compose local; en otro entorno, cambia la URI o el host por los suyos.

**Transferencia y el índice `one_owner_per_group`.**

- **Qué garantiza cada pieza.** La transferencia degrada al owner y promueve al elegido en **una transacción** (por eso
  Mongo tiene que ser replica set, ADR-017): nunca queda un grupo sin owner. El índice único parcial
  `one_owner_per_group` de `group_members` (`{ groupId: 1 }` con `partialFilterExpression: { role: 'owner' }`) impide
  que haya dos. Sin variables nuevas y sin datos que rellenar.
- **Antes de desplegar**, comprueba que ningún grupo tiene más de una membresía `owner`, porque con duplicados el índice
  no se puede construir. Debe devolver `[]`:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.group_members.aggregate([{ $match: { role: "owner" } }, { $group: { _id: "$groupId", owners: { $push: { userId: "$userId", joinedAt: "$joinedAt" } }, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]).toArray()'
  ```

- **Al arrancar**, `api` construye los índices de `group_members` (`autoIndex` de Mongoose) y `GroupsModule` espera a
  que terminen **en segundo plano**: la espera **no bloquea el arranque** (ADR-025 §5), porque `api` arranca sin
  esperar a MongoDB. Si la construcción falla, `GroupsModule` registra un `error` en cuanto ocurre, sin ids de grupos
  ni de usuarios:

  ```text
  Could not build the index one_owner_per_group of group_members: MongoServerError 11000 DuplicateKey
  ```

  `api` sigue sirviendo y `/health` sigue en `200`: la transacción sigue impidiendo grupos sin owner, pero nada impide
  que haya dos hasta que el índice exista. El motivo `11000 DuplicateKey` son owners duplicados; cualquier otro (por
  ejemplo, Mongo cortado a mitad de la construcción) se resuelve reiniciando `api` con Mongo sano. Si `api` se apaga
  antes de terminar la construcción, no se registra nada.
- **Resolver los duplicados.** La consulta de arriba lista cada grupo con sus owners y su `joinedAt`. Decide quién se
  queda (por defecto, el de `joinedAt` más antiguo, que es quien creó el grupo) y degrada a los demás a `member`, grupo
  por grupo, sin borrar ninguna membresía:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.group_members.updateMany({ groupId: ObjectId("<groupId>"), role: "owner", userId: { $ne: ObjectId("<userId que se queda>") } }, { $set: { role: "member" } })'
  ```

  Repite la consulta hasta que devuelva `[]` y reinicia `api`, que vuelve a construir el índice al arrancar.
- **Después de desplegar (o de resolver)**, comprueba que el índice existe con su filtro parcial. Debe mostrar
  `unique: true`, `key: { groupId: 1 }` y `partialFilterExpression: { role: 'owner' }`; `[]` significa que no se ha
  construido (busca el `error` de arriba en el log de `api`):

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.group_members.getIndexes().filter((i) => i.name === "one_owner_per_group")'
  ```

- **Un `500` al escribir en `group_members` con `11000` sobre `{ groupId: 1 }`** es una violación de
  `one_owner_per_group`: un fallo de programación (ADR-025 §4), no un caso previsto. Toda escritura que cambie roles o
  borre membresías debe condicionarse al rol.

**Límite de intentos del join.**

- **Claves y umbrales.** El adaptador (`CounterJoinAttemptLimiter`, funciones `joinUserKey` y `joinIpKey`) escribe dos
  contadores de ventana fija de **15 min** en Redis:
  - `groups:join:user:<userId>`: **10** códigos incorrectos por usuario. `<userId>` es el `_id` hexadecimal del usuario.
  - `groups:join:ip:<grupo de IP>`: **100** por IP. El grupo es el de `ipLimitGroup`
    (`apps/api/src/infrastructure/limits/client-ip.ts`): una IPv4 tal cual (`203.0.113.7`), una IPv4 mapeada
    (`::ffff:203.0.113.7`) como esa IPv4, y una IPv6 por su prefijo /64 con los cuatro primeros grupos en minúscula, sin
    ceros a la izquierda y sin comprimir, seguidos de `::/64` (`2001:db8::1` → `2001:db8:0:0::/64`;
    `2001:0DB8:ABCD:0012::ff` → `2001:db8:abcd:12::/64`).

  El valor es el número de intentos contados en la ventana y el `TTL` lo que le queda. Al pasar del umbral responde
  `429 too_many_attempts` con `Retry-After`. Si Redis no responde, falla abierto y el contador avisa una vez por racha
  (`Attempt counter store unavailable`); el adaptador no registra nada.
- **Mirar un contador:**

  ```bash
  docker compose exec redis redis-cli get groups:join:user:<userId>
  docker compose exec redis redis-cli ttl groups:join:user:<userId>
  ```

- **Liberar a un usuario o una IP** antes de que pase la ventana. `DEL` devuelve `1` si había contador y `0` si no; la
  clave de una IPv6 va entre comillas:

  ```bash
  docker compose exec redis redis-cli del groups:join:user:<userId>
  docker compose exec redis redis-cli del groups:join:ip:203.0.113.7
  docker compose exec redis redis-cli del "groups:join:ip:2001:db8:abcd:12::/64"
  ```

  En local, para borrarlos todos: `docker compose exec redis sh -c "redis-cli --scan --pattern 'groups:join:*' | xargs -r redis-cli del"`.
  Nunca en un entorno compartido: ahí se borra solo la clave de quien se libera.
- **Localizar las cuentas que agotan una IP** (riesgo aceptado en ADR-025: con 10 cuentas se pueden gastar los 100
  intentos de una IP en cada ventana). Ni Redis ni Mongo guardan qué usuario usó qué IP, así que se cruzan dos fuentes:
  1. Los contadores de usuario con valores altos en la ventana actual (valor, segundos que le quedan y clave, de mayor a
     menor). Un usuario cuya ventana empezó hace `900 - TTL` segundos empezó a fallar entonces:

     ```bash
     docker compose exec redis sh -c "redis-cli --scan --pattern 'groups:join:user:*' | while read -r k; do echo \"\$(redis-cli get \"\$k\") \$(redis-cli ttl \"\$k\") \$k\"; done | sort -rn | awk '\$1 >= 5'"
     ```

  2. El log de peticiones de `api` (pino-http, una línea JSON por petición): las de `POST /api/groups/join` desde esa IP
     (`req.remoteAddress`; para una IPv6, las de su /64) con `res.statusCode` `404` (código incorrecto) o `429`. El log
     no lleva el usuario (la cabecera `Authorization` se redacta), así que el cruce es por la hora: los usuarios del
     paso 1 cuya ventana empezó cuando empezaron los fallos desde esa IP. Con `jq`, sobre el log guardado en un archivo:

     ```bash
     jq -c 'select(.req.method == "POST" and .req.url == "/api/groups/join" and (.req.remoteAddress == "203.0.113.7" or .req.remoteAddress == "::ffff:203.0.113.7")) | {time, status: .res.statusCode}' api.log
     ```

  Para ver de quién es un `<userId>`: `db.users.find({ _id: ObjectId("<userId>") }, { displayName: 1, createdAt: 1 })`.
  Hoy no hay forma de suspender una cuenta desde la API: la salida inmediata es liberar la IP con `DEL`, y si el abuso
  se repite, anótalo para `deploy-prod` (umbrales configurables por variable de entorno, mejora futura de ADR-025).
- **Sin `trustProxy`**, detrás de un proxy todas las peticiones llegan con la IP del proxy y el contador de IP es global:
  100 códigos incorrectos de cualquiera bloquean a todos. Configurarlo es requisito de salida a producción de
  `deploy-prod`. En local y en las pruebas no hay proxy.

## Paso 6 quinquies — Operar las postulaciones

Desde `applications-tracking`, cada persona sigue sus ofertas en `/postulaciones` (`/api/applications`) y puede
compartir su estado con sus grupos (`GET /api/groups/:id/applications`). El detalle para quien usa el producto, los
endpoints, sus códigos, qué ve el grupo y la regla de `appliedAt` están en el
[README](../README.md#postulaciones); las decisiones, en [ADR-024](adr/ADR-024.md). Aquí, lo que hay que tener presente
al operar y al probar a mano. Los comandos usan el Mongo del compose local; en otro entorno, cambia la URI por la suya.

- **Sin variables nuevas, sin datos que rellenar.** Hay dos colecciones nuevas, `applications` y `application_events`,
  que nacen vacías. `api` construye sus índices al arrancar (`autoIndex` de Mongoose). El alta, el cambio de estado y
  "Dejar de seguir" usan transacciones, así que Mongo tiene que ser replica set (ADR-017), como siempre.
- **Las notas y la etapa son privadas.** Al depurar, no las leas ni las copies a un ticket o a un log: proyecta solo los
  campos que necesites (ver más abajo). El grupo nunca las recibe. La API **sí puede devolver `fitScore` /
  `fitScoreDegraded`**: se **derivan al leer** del último análisis de encaje de quien pide (ADR-030 §5); **nunca se
  escriben** en `applications` y **el informe completo no viaja** con la postulación —solo la puntuación (o la marca
  de análisis básico). Cómo operarlo: [Paso 6 nonies](#paso-6-nonies--operar-los-análisis-de-encaje).
- **Comprobar los índices.** Debe listar, además de `_id_`, `userId_1_linkId_1` con `unique: true`,
  `userId_1_updatedAt_-1__id_-1` y `linkId_1_visibility_1_userId_1` en `applications`, y `applicationId_1_at_1__id_1`
  en `application_events`:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson({ applications: db.applications.getIndexes().map((i) => ({ name: i.name, key: i.key, unique: i.unique })), application_events: db.application_events.getIndexes().map((i) => ({ name: i.name, key: i.key })) })'
  ```

  `MongoServerError: ns does not exist` significa que `api` todavía no ha arrancado con este change contra esa base:
  arráncalo y repite. Si falta algún índice, busca el error en el log de `api` y reinícialo con Mongo sano. En una base vacía el único no puede
  fallar. Sin `userId_1_linkId_1`, dos altas simultáneas podrían crear dos postulaciones de la misma persona para la
  misma oferta.
- **Consultar las postulaciones de un usuario sin ver sus notas.** Primero su `_id`, por su email normalizado
  (minúsculas y sin espacios exteriores):

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.users.findOne({ email: "<email>" }, { _id: 1, displayName: 1 })'
  ```

  Después, sus postulaciones con una proyección **de inclusión**. Así no salen ni las notas ni la etapa, tampoco las que
  añada un change futuro. La segunda línea cuenta sus eventos de historial sin leerlos:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.applications.find({ userId: ObjectId("<userId>") }, { linkId: 1, status: 1, visibility: 1, appliedAt: 1, statusChangedAt: 1, version: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).toArray()'
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.application_events.countDocuments({ userId: ObjectId("<userId>") })'
  ```

  Que una postulación `group` se vea en un grupo depende también de que la persona sea miembro y de que el link esté
  compartido allí **ahora**. Se deriva al leer, así que no hay ningún campo que lo diga: mira `group_members` y
  `group_links`.
- **Si alguien pide que se borren sus datos, el camino primero es `DELETE /api/users/me`.** La operación del producto
  borra la cuenta con su cascada atómica, y las `applications` y los `application_events` de esa persona entran en
  ella (`apps/api/src/modules/users/infrastructure/mongo-account-deletion.cascade.ts`, probada en
  `account-deletion.cascade.spec.ts`). La persona la ejecuta desde su perfil; en una sola transacción y sin dejarse
  las demás colecciones.

  Lo de abajo **sustituye a `DELETE /api/users/me`** y solo para cuando esa operación no se puede usar: nadie puede
  entrar ya en la cuenta, o el borrado queda bloqueado por `409 sole_owner_with_members`. A mano se borra **menos** —
  solo lo que diga el comando — así que no se da una cuenta por borrada con esto. Va en una transacción, con el `_id`
  de la consulta anterior; `application_events` repite el `userId`, así que el filtro alcanza todo su historial:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'const s = db.getMongo().startSession(); s.withTransaction(() => { const d = s.getDatabase("linkvault"); const u = ObjectId("<userId>"); printjson({ events: d.application_events.deleteMany({ userId: u }).deletedCount, applications: d.applications.deleteMany({ userId: u }).deletedCount }); }); s.endSession()'
  ```

  Repite las dos consultas de arriba: deben devolver `[]` y `0`. Sus avatares ya dejan de verse en cuanto deja de ser
  miembro de un grupo (visibilidad derivada), pero sus datos privados siguen guardados hasta este borrado. Borrar su
  cuenta, sus membresías y sus links no entra en este comando: de eso se ocupa la cascada de `DELETE /api/users/me`.
- **Lo que se ve en el log y es normal:**
  - `409 application_conflict`: una pestaña vieja movió una tarjeta que otra ya había cambiado.
  - `404 application_not_found` tras un `DELETE`: se dejó de seguir en otra pestaña, y el SPA lo trata como "ya no la
    sigues".
- **Lo que no es normal: un `500` con `The link of an application has no card`.** Es un invariante roto, porque un
  `JobLink` nunca se borra (ADR-021): en ese caso el tablero omite la postulación en lugar de caerse. Localiza las
  huérfanas, sin notas:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.applications.aggregate([{ $lookup: { from: "job_links", localField: "linkId", foreignField: "_id", as: "link" } }, { $match: { link: { $size: 0 } } }, { $project: { userId: 1, linkId: 1, status: 1 } }]).toArray()'
  ```

## Paso 6 sexies — Operar los comentarios de grupo

Desde `group-comments`, cada link compartido en un grupo tiene su hilo de comentarios
(`/api/groups/:id/links/:linkId/comments`) y la nota de quien lo compartió. El detalle para quien usa el producto, los
endpoints, sus códigos y el aviso en vivo están en el [README](../README.md#comentarios-y-notas-en-los-grupos); las
decisiones, en [ADR-026](adr/ADR-026.md). Aquí, lo que hay que tener presente al operar y al probar a mano. Los comandos
usan el Mongo y el Redis del compose local; en otro entorno, cambia la URI o el host por los suyos.

- **Sin variables nuevas, sin datos que rellenar.** La colección `group_link_comments` nace vacía y `api` construye su
  índice al arrancar (`autoIndex` de Mongoose). `group_links` gana `note?`, `commentCount` y `commentsRevision`, que se
  leen como "sin nota", 0 y 0 mientras no existan: no hay backfill, los crea el primer comentario. Ningún índice de
  `group_links` cambia. Comentar, borrar un comentario, quitar un link y borrar un grupo usan transacciones, así que
  Mongo tiene que ser replica set (ADR-017), como siempre. Para volver a la versión anterior basta con desplegarla:
  ignora los campos y la colección.
- **El texto de un comentario y el de una nota no se leen al depurar.** No están en ningún log ni en el mensaje de
  Redis, y ahí deben seguir: no los copies a un ticket. Las consultas de abajo proyectan solo identificadores y
  recuentos.
- **Comprobar el índice.** Debe listar, además de `_id_`, `groupId_1_linkId_1_createdAt_-1__id_-1` en
  `group_link_comments`, y los tres de siempre en `group_links` (`groupId_1_linkId_1` con `unique: true`,
  `groupId_1_sharedAt_-1__id_-1` y `linkId_1`):

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson({ group_link_comments: db.group_link_comments.getIndexes().map((i) => ({ name: i.name, key: i.key })), group_links: db.group_links.getIndexes().map((i) => ({ name: i.name, unique: i.unique })) })'
  ```

  Con solo `_id_` en `group_link_comments`, `api` todavía no ha arrancado con este change contra esa base (o falló la
  construcción: busca el error en su log y reinícialo con Mongo sano). Sin ese índice, el hilo y el resumen de la
  tarjeta siguen respondiendo, pero recorren la colección entera. Que el hilo lo usa se ve con `explain`, que debe
  mostrar un `IXSCAN` con ese nombre y ningún `SORT`:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.group_link_comments.find({ groupId: ObjectId("<groupId>"), linkId: ObjectId("<linkId>") }).sort({ createdAt: -1, _id: -1 }).limit(20).explain().queryPlanner.winningPlan)'
  ```

- **Deriva de `commentCount`** (riesgo aceptado en ADR-026). `commentCount` lo mantiene `group_links` con `$inc` dentro
  de la transacción de cada alta y de cada borrado, así que solo se desvía si alguien toca la base a mano. `revision`
  **no se recalcula**: solo necesita crecer. Primero, **solo lectura**: cada relación cuyo contador no coincide con sus
  comentarios reales. Debe devolver `[]`:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.group_links.aggregate([{ $lookup: { from: "group_link_comments", localField: "linkId", foreignField: "linkId", let: { g: "$groupId" }, pipeline: [{ $match: { $expr: { $eq: ["$groupId", "$$g"] } } }, { $count: "n" }], as: "real" } }, { $project: { groupId: 1, linkId: 1, stored: { $ifNull: ["$commentCount", 0] }, real: { $ifNull: [{ $first: "$real.n" }, 0] } } }, { $match: { $expr: { $ne: ["$stored", "$real"] } } }]).toArray()'
  ```

  Y, también **solo lectura**, los comentarios que no tienen relación. Deben ser `[]` siempre: quitar un link o borrar
  un grupo se lleva sus comentarios en la misma transacción, y un huérfano reaparecería al volver a compartir el link:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.group_link_comments.aggregate([{ $group: { _id: { groupId: "$groupId", linkId: "$linkId" }, comments: { $sum: 1 } } }, { $lookup: { from: "group_links", localField: "_id.linkId", foreignField: "linkId", let: { g: "$_id.groupId" }, pipeline: [{ $match: { $expr: { $eq: ["$groupId", "$$g"] } } }, { $project: { _id: 1 } }], as: "relation" } }, { $match: { relation: { $size: 0 } } }, { $project: { _id: 0, groupId: "$_id.groupId", linkId: "$_id.linkId", comments: 1 } }]).toArray()'
  ```

- **Reparar la deriva.** Solo si la primera consulta devolvió algo. Recuenta y escribe **una transacción por relación
  desviada** (las demás no se tocan), con el `$inc` de `commentsRevision` que hace que las pantallas abiertas acepten el
  resumen corregido. La transacción es lo que evita pisar un comentario que entre a la vez: si choca, se reintenta.
  Imprime `<_id> <antes> -> <después>` de cada una:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'const s = db.getMongo().startSession(); const d = s.getDatabase(db.getName()); const drift = d.group_links.aggregate([{ $lookup: { from: "group_link_comments", localField: "linkId", foreignField: "linkId", let: { g: "$groupId" }, pipeline: [{ $match: { $expr: { $eq: ["$groupId", "$$g"] } } }, { $count: "n" }], as: "real" } }, { $project: { stored: { $ifNull: ["$commentCount", 0] }, real: { $ifNull: [{ $first: "$real.n" }, 0] } } }, { $match: { $expr: { $ne: ["$stored", "$real"] } } }]).toArray(); drift.forEach((r) => s.withTransaction(() => { const rel = d.group_links.findOne({ _id: r._id }, { groupId: 1, linkId: 1 }); if (rel === null) return; const real = d.group_link_comments.countDocuments({ groupId: rel.groupId, linkId: rel.linkId }); d.group_links.updateOne({ _id: r._id }, { $set: { commentCount: real }, $inc: { commentsRevision: 1 } }); print(`${r._id} ${r.stored} -> ${real}`); })); s.endSession(); print(`${drift.length} relations`)'
  ```

  Repite la consulta de deriva: debe devolver `[]`. Un huérfano de la segunda consulta se borra por su pareja
  `(groupId, linkId)`, y solo si la relación de verdad no existe (la comprobación va dentro de la transacción, así que
  no borra nada si alguien la vuelve a compartir en ese instante):

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'const s = db.getMongo().startSession(); const d = s.getDatabase(db.getName()); const pair = { groupId: ObjectId("<groupId>"), linkId: ObjectId("<linkId>") }; s.withTransaction(() => { if (d.group_links.countDocuments(pair) !== 0) { print("the relation exists: nothing deleted"); return; } print(d.group_link_comments.deleteMany(pair).deletedCount + " orphan comments deleted"); }); s.endSession()'
  ```

- **Borrar a mano los comentarios de una persona (camino excepcional).** `DELETE /api/users/me` ya borra los
  `group_link_comments` de quien borra su cuenta —ADR-026 decidió borrarlos, no anonimizarlos— y ajusta en la misma
  transacción el `commentCount` y el `commentsRevision` de cada `group_links` afectada. Esto de aquí **sustituye** a
  esa operación y solo para cuando no se puede usar (nadie entra ya en la cuenta, o sale
  `409 sole_owner_with_members`), o para borrar los comentarios de alguien que conserva su cuenta. Quien salió de un
  grupo tampoco puede borrar lo suyo sin volver a entrar, aunque el propietario del grupo sí puede. Primero su `_id`,
  por su email normalizado, y qué tiene escrito, sin leer ningún texto:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.users.findOne({ email: "<email>" }, { _id: 1, displayName: 1 })'
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.group_link_comments.aggregate([{ $match: { authorId: ObjectId("<userId>") } }, { $group: { _id: { groupId: "$groupId", linkId: "$linkId" }, comments: { $sum: 1 } } }]).toArray()'
  ```

  El borrado va **en una transacción**, y por cada link baja `commentCount` en lo que borró y sube `commentsRevision`:
  hacerlo con `deleteMany` a secas dejaría los contadores desviados. Imprime cuántos borró y en cuántos links:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'const s = db.getMongo().startSession(); const d = s.getDatabase(db.getName()); const u = ObjectId("<userId>"); s.withTransaction(() => { const pairs = d.group_link_comments.aggregate([{ $match: { authorId: u } }, { $group: { _id: { groupId: "$groupId", linkId: "$linkId" }, n: { $sum: 1 } } }]).toArray(); let total = 0; pairs.forEach((p) => { const n = d.group_link_comments.deleteMany({ groupId: p._id.groupId, linkId: p._id.linkId, authorId: u }).deletedCount; d.group_links.updateOne({ groupId: p._id.groupId, linkId: p._id.linkId }, { $inc: { commentCount: -n, commentsRevision: 1 } }); total += n; }); print(`${total} comments deleted in ${pairs.length} links`); }); s.endSession()'
  ```

  Sus **notas** son texto suyo igual que sus comentarios, y van aparte, porque viven en la relación que creó. No tocan
  ningún contador:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'print(db.group_links.updateMany({ sharedBy: ObjectId("<userId>"), note: { $exists: true } }, { $unset: { note: 1 } }).modifiedCount + " notes removed")'
  ```

  Repite las dos consultas de arriba (deben quedar en `[]`) y la de deriva. Un borrado a mano **no publica ningún
  aviso**: las pantallas abiertas se ponen al día al volver a la pestaña o al reabrir el hilo. Borrar su cuenta, sus
  membresías, sus links y sus postulaciones no entra en estos comandos: de eso se ocupa la cascada de
  `DELETE /api/users/me`.
- **Límite de comentarios.** `CounterLinkLimiter` escribe un contador de ventana fija de **15 min** en Redis,
  `links:comment:<userId>` (**30** comentarios por persona, en todos sus grupos; `<userId>` es el `_id` hexadecimal).
  El valor es lo contado en la ventana y el `TTL`, lo que le queda. Borrar no cuenta, y un comentario que no llega a
  guardarse devuelve su intento. Falla abierto: sin Redis se comenta igual.

  ```bash
  docker compose exec redis redis-cli get links:comment:<userId>
  docker compose exec redis redis-cli ttl links:comment:<userId>
  ```

  Liberar a una persona antes de que pase la ventana (`DEL` devuelve `1` si había contador y `0` si no):

  ```bash
  docker compose exec redis redis-cli del links:comment:<userId>
  ```

  Nunca borres el patrón entero en un entorno compartido. En local, para ver quién está cerca del tope (valor, segundos
  que le quedan y clave, de mayor a menor):

  ```bash
  docker compose exec redis sh -c "redis-cli --scan --pattern 'links:comment:*' | while read -r k; do echo \"\$(redis-cli get \"\$k\") \$(redis-cli ttl \"\$k\") \$k\"; done | sort -rn"
  ```

- **El canal en vivo.** `api` publica cada alta y cada borrado en `events:group-link.comments` y cada instancia lo
  reparte por SSE a los miembros actuales del grupo. Cuántas instancias están escuchando (debe ser una por `api` en
  marcha; `0` con `api` parado):

  ```bash
  docker compose exec redis redis-cli pubsub numsub events:group-link.comments
  ```

  Para verlo pasar, `docker compose exec redis redis-cli subscribe events:group-link.comments` (Ctrl+C para salir).
  **Cada mensaje lleva solo `{ groupId, linkId, commentId, change }`**: si alguna vez aparece ahí el texto de un
  comentario, es un fallo grave de privacidad, no una curiosidad. El texto solo sale por SSE, hacia los miembros de ese
  grupo. Un aviso perdido no rompe nada: no hay outbox a propósito, y la tarjeta se pone al día en la siguiente lectura.

## Paso 6 septies — Operar los enlaces públicos

Desde `public-preview-share`, un link compartido en un grupo puede tener un **enlace público**:
`<origen de la API>/p/<slug>`, una página HTML sin sesión que sirve la propia `api`, y
`GET /api/public/previews/:slug` para la vista `/oferta/:slug` del SPA. Qué se ve, quién lo enciende, los endpoints y los límites están en el
[README](../README.md#enlaces-públicos-de-una-oferta); las decisiones, en [ADR-027](adr/ADR-027.md). Aquí, lo que hay que
tener presente al operar. Los comandos usan el Mongo y el Redis del compose local; en otro entorno, cambia la URI o el
host por los suyos.

- **Dos variables nuevas y obligatorias**, `PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL` (absolutas, `http(s)`, sin barra
  final): un `.env` ya existente tiene que copiarlas de `.env.example` o **`api` no arranca**. En producción pueden
  apuntar al mismo origen. No entra ninguna variable de proxy: los límites de estas rutas no miran la IP y este change
  **no** activa `trustProxy` a propósito (lo decide `deploy-prod`).
- **Sin colección nueva y sin backfill.** `group_links` gana `publicShare?` y `groups`, `settings.defaultVisibility`;
  `api` construye el índice del slug al arrancar (`autoIndex` de Mongoose). Ningún link ya compartido se publica solo, y
  un grupo sin `settings` se lee `public`, lo que solo afecta a lo que se comparta **después**. Para volver a la versión
  anterior basta con desplegarla: ignora los campos, y las URLs `/p/<slug>` repartidas dejan de responder.
- **Un slug es una llave, trátalo como tal.** Quien lo tiene abre la página sin cuenta. No lo pegues en un ticket ni en
  un chat de soporte, y si se filtró uno que no debía, despublícalo (abajo): despublicar lo **quema**, y volver a
  publicar genera otro. `publicShare.publishedBy` es trazabilidad interna y no sale en ninguna respuesta.
- **Comprobar el índice.** `group_links` debe listar, además de `_id_`, los tres de siempre (`groupId_1_linkId_1` con
  `unique: true`, `groupId_1_sharedAt_-1__id_-1` y `linkId_1`) y el nuevo `public_share_slug`, **único y parcial**:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.group_links.getIndexes().map((i) => ({ name: i.name, key: i.key, unique: i.unique, partial: i.partialFilterExpression })))'
  ```

  Sin `public_share_slug`, `api` todavía no ha arrancado con este change contra esa base (o falló la construcción: busca
  el error en su log y reinícialo con Mongo sano). Mientras falte, la página sigue respondiendo pero recorre la
  colección entera **y nada garantiza que dos relaciones no acaben con el mismo slug**. Que la página lo usa se ve con
  `explain`, que debe mostrar un `IXSCAN` sobre `public_share_slug` con `isPartial: true`:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.group_links.find({ "publicShare.slug": "<slug>" }).explain().queryPlanner.winningPlan)'
  ```

- **Qué hay publicado ahora mismo** (solo lectura): cuántas relaciones tienen enlace público y cómo se reparten por
  grupo. Ninguna consulta de aquí lee el contenido de la oferta:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson({ published: db.group_links.countDocuments({ "publicShare.slug": { $exists: true } }), relations: db.group_links.countDocuments({}) })'
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.group_links.aggregate([{ $match: { "publicShare.slug": { $exists: true } } }, { $group: { _id: "$groupId", published: { $sum: 1 } } }, { $sort: { published: -1 } }]).toArray())'
  ```

- **Retirar con urgencia un enlace concreto.** Es lo que hay que hacer cuando alguien avisa de que una oferta publicada
  no debía serlo y no se puede esperar a que su dueño la apague desde el SPA. Primero, **solo lectura**, de qué relación
  es (por si hay que avisar a quien la compartió):

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.group_links.findOne({ "publicShare.slug": "<slug>" }, { groupId: 1, linkId: 1, sharedBy: 1, "publicShare.publishedBy": 1, "publicShare.publishedAt": 1 }))'
  ```

  Y después el `$unset`, que es exactamente lo que hace "Dejar de compartir" (`DELETE .../public`): una escritura, sin
  transacción y sin nada más que ajustar. Imprime `1` si lo retiró y `0` si ese slug ya no existía:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'print(db.group_links.updateOne({ "publicShare.slug": "<slug>" }, { $unset: { publicShare: 1 } }).modifiedCount + " public link burned")'
  ```

  Comprueba que la página ya no responde (debe dar `404 text/html`, nunca JSON), y recuerda que la caché de `60 s` del
  `200` puede tardar ese minuto en cualquier proxy que haya por delante:

  ```bash
  curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "http://localhost:3000/p/<slug>"
  ```

  El slug queda **quemado**: si el dueño vuelve a publicar, será otro. Un retirado a mano **no avisa a nadie**: las
  pantallas abiertas siguen mostrando la marca "Enlace público" hasta que recarguen la lista. Y lo que ya se pintó en un
  chat no se puede borrar: WhatsApp guarda su tarjeta días.

- **Despublicar un grupo entero.** No hay ninguna ruta que lo haga (queda fuera del alcance a propósito). Mira primero
  qué se va a retirar y después escríbelo:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.group_links.find({ groupId: ObjectId("<groupId>"), "publicShare.slug": { $exists: true } }, { _id: 0, linkId: 1, "publicShare.slug": 1, "publicShare.publishedAt": 1 }).toArray())'
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'print(db.group_links.updateMany({ groupId: ObjectId("<groupId>"), "publicShare.slug": { $exists: true } }, { $unset: { publicShare: 1 } }).modifiedCount + " public links burned")'
  ```

  Esto **no** cambia el ajuste del grupo: si `defaultVisibility` sigue en `public`, el siguiente link que entre nacerá
  publicado otra vez. Lo correcto es apagarlo antes con `PATCH /api/groups/:id/settings` (lo hace el owner desde
  `/grupos/:id`); a mano, y solo si no hay quien lo haga desde el producto:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.groups.findOne({ _id: ObjectId("<groupId>") }, { name: 1, "settings.defaultVisibility": 1 }))'
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'print(db.groups.updateOne({ _id: ObjectId("<groupId>") }, { $set: { "settings.defaultVisibility": "private" } }).modifiedCount + " group setting changed")'
  ```

- **Los enlaces que publicó una persona (camino excepcional).** `DELETE /api/users/me` ya despublica
  (`$unset publicShare`, ADR-027) lo que esa persona publicó, junto con sus `group_link_comments` (ADR-026) y sus
  postulaciones (ADR-024), todo en la misma transacción. Lo de aquí **sustituye** a esa operación y solo para cuando
  no se puede usar, o para despublicar lo de alguien que conserva su cuenta. Su `_id` sale por su email normalizado,
  como en el paso anterior:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.group_links.countDocuments({ "publicShare.publishedBy": ObjectId("<userId>") }))'
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'print(db.group_links.updateMany({ "publicShare.publishedBy": ObjectId("<userId>") }, { $unset: { publicShare: 1 } }).modifiedCount + " public links burned")'
  ```

- **Los tres contadores.** `CounterLinkLimiter` escribe ventanas fijas de **15 min** en Redis: `links:public-page`
  (**6000** peticiones a `/p/:slug`, todas juntas), `links:public-preview` (**6000** a
  `GET /api/public/previews/:slug`) y `links:public-page:<slug>` (**2000** de **ese** enlace). El valor es lo contado en
  la ventana y el `TTL`, lo que le queda. Ninguna clave depende de nada que envíe el cliente: no hay `trustProxy` ni
  falta.

  ```bash
  docker compose exec redis redis-cli get links:public-page
  docker compose exec redis redis-cli ttl links:public-page
  docker compose exec redis redis-cli get links:public-page:<slug>
  ```

  Liberar uno antes de que pase la ventana (`DEL` devuelve `1` si había contador y `0` si no). Es lo que hay que hacer
  si un bucle dejó la página en `429` y hace falta que las tarjetas vuelvan **ya**; tenlo en cuenta: si quien lo agotó
  sigue ahí, el contador se llena otra vez:

  ```bash
  docker compose exec redis redis-cli del links:public-page
  docker compose exec redis redis-cli del links:public-page:<slug>
  ```

  Nunca borres el patrón entero en un entorno compartido. En local, para ver cuáles están cerca del tope (valor,
  segundos que le quedan y clave, de mayor a menor):

  ```bash
  docker compose exec redis sh -c "redis-cli --scan --pattern 'links:public-*' | while read -r k; do echo \"\$(redis-cli get \"\$k\") \$(redis-cli ttl \"\$k\") \$k\"; done | sort -rn"
  ```

  Los dos globales son **independientes** y el del slug **devuelve** su intento al global cuando rechaza, así que un
  enlace castigado no gasta el tope de los demás. Los tres **fallan abiertos**: con Redis caído se sirve igual, porque
  lo que se permite de más son dos lecturas indexadas por petición.

- **Comprobar las dos URLs públicas de un entorno.** `PUBLIC_PAGE_BASE_URL` es el origen que sirve la página y el valor
  que va en `og:url`; `WEB_BASE_URL`, el del SPA, adonde salta el `<meta refresh>` y de donde cuelga la imagen fija de
  la tarjeta (`/assets/og-default.png`). Si están mal, la tarjeta del chat apunta a un sitio que no existe **aunque la
  página responda `200`**:

  ```bash
  curl -s "http://localhost:3000/p/<slug>" | grep -o '<meta property="og:\(url\|image\)" content="[^"]*"'
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4200/assets/og-default.png
  ```

  Las cabeceras de las tres respuestas (`200`, `404` y `429`) deben traer siempre `referrer-policy: no-referrer`,
  `x-content-type-options: nosniff`, la CSP con `default-src 'none'` y `content-type: text/html`. **Si alguna vez esa
  ruta responde `application/json`, es un fallo**: el controlador devuelve sus errores en HTML justamente para que el
  filtro global no intervenga.

  ```bash
  curl -s -D - -o /dev/null "http://localhost:3000/p/<slug>"
  ```

- **Lo que el log puede y no puede decir.** De las dos rutas públicas se registra `{ slug, status }` y nada más: sirve
  para contar páginas servidas y `404`, no para saber quién las abrió. Si aparece ahí una dirección de origen, un
  `User-Agent` o un referente, es un fallo de privacidad, no una curiosidad: el log automático de petición está apagado
  para `/p/*` y `/api/public/*`, y la línea propia se escribe fuera del logger de la petición.

## Paso 6 octies — Operar los CV

Desde `cv-upload-extract`, cada persona guarda hasta 5 CV: los **bytes** van al bucket de CV de MinIO y los metadatos y
el **texto extraído**, a `cv_documents`. Qué se guarda, quién lo ve, los endpoints, los estados y los límites están en el
[README](../README.md#mi-cv); las decisiones, en [ADR-028](adr/ADR-028.md). Aquí, lo que hay que tener presente al
operar. Los comandos usan el Mongo, el Redis y el MinIO del compose local; en otro entorno, cambia la URI o el host.

**Antes de tocar nada, la regla de este paso:** ni el texto de un CV, ni el nombre de su archivo, ni sus bytes salen de
aquí. Ninguna consulta de abajo los lee, y ninguna debería: no los pegues en un ticket ni en un chat de soporte. Si
necesitas saber "de quién es este CV", basta con su `userId`.

- **Variables nuevas y obligatorias.** `api` pasa a exigir las cinco `S3_*`, incluida `S3_BUCKET` (hasta ahora no la
  leía nadie), y `worker` añade `CV_EXTRACTION_TIMEOUT_MS` y `CV_EXTRACT_CONCURRENCY`. **Un `.env` anterior no las tiene
  y los procesos no arrancan**: cópialas de `.env.example`.
- **Los dos buckets, y que el de CV no sea público.** `docker compose up -d --wait` crea `snapshots` (con su regla de
  expiración a 30 días) y el de CV, **`cvs`** por defecto —no `cv`: S3 exige entre 3 y 63 caracteres—, privado, sin
  política anónima y **sin** regla de expiración. Las dos comprobaciones del healthcheck son independientes, así que un
  volumen que ya tenía el de snapshots crea igualmente el de CV:

  ```bash
  docker compose exec minio mc ls admin/
  docker compose exec minio mc anonymous get admin/cvs   # debe decir: Access permission ... is `private`
  docker compose exec minio mc ilm rule ls admin/cvs     # debe fallar con "lifecycle configuration does not exist"
  ```

  Si `mc anonymous get` dijera `download`, `public` o `upload`, **los CV de todo el mundo son alcanzables con la URL**:
  quítalo con `mc anonymous set none admin/cvs` y averigua quién lo puso. Y si el `ilm rule ls` listara una regla, algo
  le puso caducidad a un dato que no caduca solo.

- **Comprobar el almacén a mano.** Los tests de `api` hablan con un **doble** del almacén a propósito, así que lo único
  que prueba que MinIO responde con la configuración de este entorno es hacerlo. Sube, lista y borra un objeto de
  prueba bajo un prefijo inventado (nunca bajo el de una persona real):

  ```bash
  docker compose exec minio sh -c 'printf "%%PDF-prueba" > /tmp/cv-probe.bin && mc cp /tmp/cv-probe.bin admin/cvs/probe/0001'
  docker compose exec minio mc ls --recursive admin/cvs/probe/
  docker compose exec minio mc rm --recursive --force admin/cvs/probe/
  ```

  De punta a punta, lo que hay que ver tras subir un CV desde `/mi-cv` es un objeto con la clave `<userId>/<cvId>`, **sin
  el nombre del archivo y sin extensión**. Si alguna clave llevara un nombre dentro, es un fallo de privacidad.

- **Los índices.** `cv_documents` debe listar, además de `_id_`, `userId_1_version_1` (**único**),
  `userId_1_isDefault_1` (**único y parcial** sobre `isDefault: true`) y `userId_1_uploadedAt_-1`;
  `cv_version_counters` **solo** `_id_`:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.cv_documents.getIndexes().map((i) => ({ name: i.name, key: i.key, unique: i.unique, partial: i.partialFilterExpression })))'
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.cv_version_counters.getIndexes().map((i) => i.name))'
  ```

  Sin el parcial de `isDefault`, nada impide que una persona acabe con dos CV marcados; sin el de `version`, dos subidas
  simultáneas pueden repetir número. Si falta alguno, `api` no ha arrancado con este change contra esa base o falló la
  construcción: mira su log y reinícialo con Mongo sano.

- **`cv_version_counters`, la colección que sorprende.** Es un documento por persona (`_id` = `userId` en hexadecimal,
  `next` = **próxima** versión a entregar) y existe porque los números de versión **no se reutilizan**: con las versiones
  1, 2 y 3, borrar la 3 y calcular `max(version) + 1` volvería a dar 3, y "la v3" no puede querer decir dos cosas en la
  misma cuenta. Se sube con `$inc` dentro de la transacción del alta y **se borra con el último CV de esa persona**, así
  que un `next` alto junto a una persona sin CV es la señal de que algo no borró bien:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.cv_version_counters.aggregate([{ $lookup: { from: "cv_documents", let: { u: { $toObjectId: "$_id" } }, pipeline: [{ $match: { $expr: { $eq: ["$userId", "$$u"] } } }, { $count: "n" }], as: "cvs" } }, { $match: { cvs: { $size: 0 } } }]).toArray())'
  ```

  Un contador huérfano no rompe nada —la siguiente subida de esa persona seguiría numerando desde ahí— y borrarlo solo
  hace que su numeración vuelva a empezar en 1. No lo borres "por limpiar" si esa persona tiene CV.

- **Cómo va la lectura de los CV.** Reparto por estado y motivo, y los que llevan demasiado tiempo en `pending` (el
  síntoma de un worker parado, un relay apagado o una cola atascada). Ninguna de las dos lee el texto:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.cv_documents.aggregate([{ $group: { _id: { status: "$extraction.status", reason: "$extraction.failureReason" }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray())'
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.cv_documents.find({ "extraction.status": "pending", uploadedAt: { $lt: new Date(Date.now() - 600000) } }, { _id: 1, userId: 1, uploadedAt: 1 }).sort({ uploadedAt: 1 }).toArray())'
  ```

  Si hay `pending` viejos, mira si su evento sigue esperando en el outbox: `publishedAt: null` con `attempts` creciendo
  es el relay intentando publicar y fallando; `attempts: 0` con el relay apagado (`OUTBOX_RELAY_ENABLED=false`) es lo
  esperado, y se resuelve solo al encenderlo. **El motivo está en el log de `api`**: el primer fallo de cada evento se
  avisa con `warn` (identificador, tipo y motivo) y los reintentos siguientes van a `debug`, así que busca ese primer
  aviso y no la última vuelta.

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.outbox_events.find({ type: { $in: ["CvUploaded.v1", "CvDeleted.v1"] }, publishedAt: null, failedAt: null }, { type: 1, attempts: 1, createdAt: 1, nextAttemptAt: 1 }).sort({ createdAt: 1 }).toArray())'
  ```

  **No hay reencolado para los CV** (el `backfill-enrichment` es de links y no los toca): lo que la persona tiene en la
  mano es eliminar ese CV y volver a subirlo, que escribe un evento nuevo, y es justo lo que dice el aviso de "Sigue en
  proceso" de la pantalla.

- **Las dos colas.** `extract-cv` (lectura del archivo) y `delete-cv-file` (borrado del objeto), las dos de BullMQ con
  el prefijo `bull:`. Cuántos trabajos hay en cada estado:

  ```bash
  docker compose exec redis sh -c "for q in extract-cv delete-cv-file; do echo \"\$q wait=\$(redis-cli llen bull:\$q:wait) active=\$(redis-cli llen bull:\$q:active) delayed=\$(redis-cli zcard bull:\$q:delayed) failed=\$(redis-cli zcard bull:\$q:failed)\"; done"
  ```

  Vaciar una cola entera es **perder trabajos**, así que solo en local y sabiendo qué se pierde: vaciar `extract-cv`
  deja esos CV en `pending` para siempre (el remedio es que su dueño los borre y los vuelva a subir), y vaciar
  `delete-cv-file` deja **objetos huérfanos**, que es el barrido de más abajo.

  ```bash
  docker compose exec redis sh -c "redis-cli --scan --pattern 'bull:extract-cv:*' | xargs -r redis-cli del"
  docker compose exec redis sh -c "redis-cli --scan --pattern 'bull:delete-cv-file:*' | xargs -r redis-cli del"
  ```

- **Los tres contadores.** Ventanas fijas de **15 min** por persona: `cv:upload:<userId>` (**10** subidas),
  `cv:text-preview:<userId>` (**60** vistas previas) y `cv:reject:<userId>` (**30** archivos rechazados en la puerta,
  que se consume tanto en el `415` como en el `413` y **nunca se devuelve**). El valor es lo contado y el `TTL`, lo que
  le queda:

  ```bash
  docker compose exec redis redis-cli get cv:upload:<userId>
  docker compose exec redis redis-cli ttl cv:upload:<userId>
  docker compose exec redis sh -c "redis-cli --scan --pattern 'cv:*' | while read -r k; do echo \"\$(redis-cli get \"\$k\") \$(redis-cli ttl \"\$k\") \$k\"; done | sort -rn"
  ```

  Liberar uno antes de que pase la ventana (`DEL` devuelve `1` si había contador y `0` si no). Es lo que hay que hacer
  cuando alguien se quedó fuera por una ráfaga de pruebas y necesita subir su CV **ya**:

  ```bash
  docker compose exec redis redis-cli del cv:upload:<userId>
  docker compose exec redis redis-cli del cv:text-preview:<userId>
  docker compose exec redis redis-cli del cv:reject:<userId>
  ```

  Nunca borres el patrón entero en un entorno compartido. Los tres son **independientes** y los tres **fallan
  abiertos**: con Redis caído se sube y se mira igual, porque el tope duro no lo pone el contador sino el máximo de 5 CV
  por persona.

- **Objetos huérfanos: dos pasos, con revisión humana en medio.** Aparecen cuando una transacción del alta aborta
  después de subir el objeto, o cuando un `CvDeleted.v1` se agota a las 24 h. Son invisibles para la persona y para la
  API, y **no hay barrido automático a propósito**: un script que borra objetos comparándolos con la base es justo el
  que, mal escrito, borra los CV de todo el mundo.

  Paso 1, **solo lectura**: las claves del bucket menos las que `cv_documents` referencia.

  ```bash
  docker compose exec -T minio mc find admin/cvs --print "{}" | sed 's|^admin/cvs/||' | sort > /tmp/cv-objects.txt
  docker compose exec -T mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.cv_documents.distinct("fileKey").forEach((k) => print(k))' | sort > /tmp/cv-referenced.txt
  comm -23 /tmp/cv-objects.txt /tmp/cv-referenced.txt
  ```

  Paso 2, **después de mirar esa lista con ojos humanos**: si está vacía, no hay nada que hacer. Si no, comprueba que
  ninguna clave corresponde a un CV recién subido (una subida en curso todavía no tiene documento: espera unos segundos
  y repite el paso 1) y borra **una a una** las que sobran, nunca en bucle sobre el archivo entero:

  ```bash
  docker compose exec minio mc rm admin/cvs/<userId>/<cvId>
  ```

  El `-T` de `docker compose exec` no es decorativo: sin él la salida llega con retornos de carro y la comparación
  miente.

- **Borrar a mano todo lo de una persona (camino excepcional).** `DELETE /api/users/me` ya borra los `cv_documents`,
  su contador de versiones y los objetos bajo el prefijo `<userId>/` del bucket, dentro de la cascada de borrado de
  cuenta. Lo de aquí **sustituye** a esa operación y solo para cuando no se puede usar (nadie entra ya en la cuenta,
  o sale `409 sole_owner_with_members`). Primero, **solo lectura**, qué se va a borrar:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.cv_documents.find({ userId: ObjectId("<userId>") }, { _id: 1, fileKey: 1, version: 1, isDefault: 1, "extraction.status": 1 }).toArray())'
  docker compose exec minio mc ls --recursive admin/cvs/<userId>/
  ```

  Y después, **el objeto primero y el documento después**. Es el orden contrario al del alta, y por la misma razón: si
  algo se queda a medias, lo que sobra debe ser un objeto que ningún documento nombra —invisible— y no un CV que la
  persona sigue viendo en su lista y cuyo archivo ya no existe.

  ```bash
  docker compose exec minio mc rm --recursive --force admin/cvs/<userId>/
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'print(db.cv_documents.deleteMany({ userId: ObjectId("<userId>") }).deletedCount + " cv documents deleted"); print(db.cv_version_counters.deleteOne({ _id: "<userId>" }).deletedCount + " version counter deleted");'
  ```

  El `<userId>` va como `ObjectId(...)` en `cv_documents` y como **cadena hexadecimal** en `cv_version_counters`: es su
  `_id`. Un borrado a mano **no avisa a nadie** ni encola nada: no escribe `CvDeleted.v1`, así que el objeto tienes que
  borrarlo tú, que es lo que hace la primera línea.

- **Qué queda pendiente de `deploy-prod`** (ADR-028 y el `scope` del manifiesto), para no darlo por hecho aquí: el
  **cifrado en reposo** y la **política de retención** del bucket —desviación explícita de `docs/design.md` §8: en
  local el bucket guarda los archivos tal cual y nada caduca—, la **automatización del barrido** de huérfanos si
  alguna vez pesa, el **aviso de privacidad** que diga qué se guarda de un CV y por cuánto tiempo, y el **límite por
  IP y el tope de cuerpo en el proxy**, que es el único techo por cliente (los tres contadores cuentan por persona
  autenticada). Las dos colas nuevas también entran en lo que hay que vigilar.

  Lo que ya **no** está pendiente: el borrado de cuenta (objetos del bucket y contadores incluidos) lo entregó la
  propia fila 16 (`deploy-prod`) y hoy es `DELETE /api/users/me` con su cascada; ADR-028 §Riesgos aceptados lo
  listaba como deuda y lleva la nota fechada que lo corrige.

## Paso 6 nonies — Operar los análisis de encaje

Desde `cv-match-suggestions`, cada persona puede pedir un análisis de su CV contra una oferta
(`POST /api/links/:linkId/match`) y consultar el resultado (`GET /api/links/:linkId/match`). El progreso **no** llega
por SSE: el paso alcanzado se guarda en `ai_analyses` y el SPA lo **sondea** (ADR-030 §9). Decisiones:
[ADR-029](adr/ADR-029.md), [ADR-030](adr/ADR-030.md). Los comandos usan el compose local.

**Antes de tocar nada:** no leas ni copies el informe (`report`), los `cvFragment` de evidencia ni el texto del CV. Las
consultas de abajo proyectan solo metadatos.

- **Variables.** `api` y `worker` leen `MATCH_ANALYSIS_MAX_AGE_MS` (mismo valor en ambos), `MATCH_ANALYSIS_TIMEOUT_MS`,
  `MATCH_ANALYSES_PER_USER`, `MATCH_QUOTA_WINDOW_MS`; el worker además `MATCH_ANALYSIS_CONCURRENCY`. Relación de plazos
  (ADR-030 §7): `MAX_AGE` tiene que ser **mayor** que `TIMEOUT` contando entregas y margen —cada proceso lo comprueba al
  arrancar con `assertAnalysisDeadlines` y nombra las dos variables si falla. Valores recomendados en `.env.example`
  (`TIMEOUT=120000`, `MAX_AGE=240000`): ×2 respecto a cv-match-suggestions para absorber hasta ~3 llamadas IA del bucle
  de crítica (cv-suggestions-review / ADR-031); medir y ajustar con el eval. Un `.env` anterior con `60000`/`120000`
  sigue validando, pero puede cortar análisis con revisión. Copiar el bloque de `.env.example` si el arranque se queja.

- **La cola `analyze-match`.** Prefijo BullMQ `bull:`. Estado:

  ```bash
  docker compose exec redis sh -c "echo \"analyze-match wait=\$(redis-cli llen bull:analyze-match:wait) active=\$(redis-cli llen bull:analyze-match:active) delayed=\$(redis-cli zcard bull:analyze-match:delayed) failed=\$(redis-cli zcard bull:analyze-match:failed)\""
  ```

  Vaciarla solo en local (pierdes trabajos en curso; esos análisis quedan `running` hasta que el `GET` los lea
  vencidos):

  ```bash
  docker compose exec redis sh -c "redis-cli del bull:analyze-match:wait bull:analyze-match:active bull:analyze-match:delayed bull:analyze-match:failed"
  ```

  La cola va **sin reintento a ciegas** (`attempts: 1`): un reintento volvería a enviar el CV (ADR-030 §6).

- **La cuota se cuenta del historial; no hay contador que liberar** (ADR-030 §8). Ocupan sitio los análisis de la
  ventana (`MATCH_QUOTA_WINDOW_MS`) con informe **no degradado**, más los `running` que aún no vencieron. Un fallo
  interno, un vencimiento o un degradado **no** "devuelven" nada: no existe clave Redis ni campo a resetear. Para ver
  cuántos análisis tiene una persona (sin leer el informe):

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.ai_analyses.countDocuments({ userId: ObjectId("<userId>") })'
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'printjson(db.ai_analyses.find({ userId: ObjectId("<userId>") }, { linkId: 1, status: 1, step: 1, requestedAt: 1, finishedAt: 1, degradedReason: 1 }).sort({ requestedAt: -1 }).limit(20).toArray())'
  ```

- **Versión vigente del texto de consentimiento.** Constante compartida `AI_CONSENT_TEXT_VERSION` en
  `libs/shared` (`ai-consent-text.ts`): hoy **`2026-09-21`**. El perfil responde `aiConsent.currentTextVersion`; un
  permiso solo cuenta si `textVersion === currentTextVersion`. Comprobar sin leer el texto del CV:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.users.findOne({ email: "<email>" }, { "aiConsent.externalProviders": 1, "aiConsent.textVersion": 1, "aiConsent.consentedAt": 1 })'
  ```

- **Borrar `ai_analyses` al borrar una cuenta.** `DELETE /api/users/me` ya los borra dentro de la transacción de la
  cascada, junto con `roadmaps`, `ai_feedback` y `ai_usage`. El comando de abajo **sustituye** a esa operación y solo
  para cuando no se puede usar; entonces va en la misma transacción que el resto de datos de esa persona:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'const s = db.getMongo().startSession(); s.withTransaction(() => { const d = s.getDatabase("linkvault"); const u = ObjectId("<userId>"); printjson({ analyses: d.ai_analyses.deleteMany({ userId: u }).deletedCount }); }); s.endSession()'
  ```

  Borrar un CV ya cascada sus análisis en la misma transacción (ADR-030 §4); no hace falta un paso aparte por CV.

- **OpenRouter y modelos `:free` (ADR-029). Son dos casos distintos y ya no fallan igual.**

  - **Cadena de plataforma (`OPENROUTER_MODEL`).** Aquí el mecanismo **sigue siendo el breaker**: si ese modelo deja
    de servir o deja de aceptar `data_collection: "deny"`, el proveedor falla en caliente, el circuit breaker abre y
    la degradación puede quedar **permanente y silenciosa** mientras `/perfil` sigue afirmando que el CV va a
    OpenRouter. Se ve en el log de `api`/`worker` (fallos del proveedor `openrouter` y apertura del breaker) y en los
    análisis que salen degradados. Cambio: otro modelo `:free` que acepte `deny`, reiniciar `api`/`worker`, y
    verificar con la pasada de la [tarea 17.8](#pasada-manual-openrouter-tarea-178) (modelo confirmado:
    `cohere/north-mini-code:free`).
  - **BYOK de OpenRouter (`BYOK_OPENROUTER_MODEL`). Aquí ya no hay breaker que abrir.** Sin modelo utilizable
    —variable ausente o vacía **y** sin valor por defecto del código que la sustituya— `ByokProviderFactory` **no
    construye** ese proveedor: no entra en el universo de la ejecución, no se enruta para nadie y no sale ninguna
    petición hacia OpenRouter por esa vía. El estado se ve **al arrancar**, en el aviso que escriben `api` y `worker`
    nombrando la variable (`formatAiConfigWarnings`), no en un degradado tardío. Los vendors `anthropic` y `openai`
    siguen su propia configuración y no se ven afectados. Si el modelo configurado **sí** existe pero deja de servir
    en caliente, ese caso vuelve a ser un fallo de proveedor como el de la plataforma.

### Pasada manual OpenRouter (tarea 17.8) — hecha

**Fecha:** `2026-09-21T03:29:43.798Z`  
**Modelo fijado:** `cohere/north-mini-code:free` (en `.env.example` y `.env` local, y desde 2026-09-24 también en
`BYOK_OPENROUTER_MODEL`: ver «Resultado por candidato» más abajo).

**Comprobado:**

1. CV de prueba **anonimizado** (datos inventados) con consentimiento `externalProviders: true` y `redactName`.
2. Ejecución real de `match-cv` vía `OpenRouterProvider` (`AI_CHAIN=openrouter`).
3. Cuerpo enviado: marcadores `[EMAIL_]`, `[PHONE_]`, `[ADDRESS_]`, `[ID_]`, `[NAME_]` presentes; **0** valores
   originales filtrados.
4. `provider.data_collection: "deny"` aceptado (HTTP 200). Lo manda
   `libs/ai/src/infrastructure/providers/openrouter.provider.ts` (ADR-018 §12).
5. `match-cv` resolvió `status: success` con `providerId: openrouter`.

**Resumen sin PII:** `reports/smoke/cv-match-suggestions/openrouter-17.8-result.json` (gitignored).

**Síntoma si el modelo configurado deja de aceptar `deny`:** OpenRouter responde `404` con
`"No endpoints found matching your data policy (Free model training)"` → el proveedor falla → el breaker abre →
degradación permanente y silenciosa mientras `/perfil` sigue diciendo que el CV va a OpenRouter. Mitigación: otro
`:free` que acepte `deny`, reiniciar `api`/`worker`, repetir esta pasada. **Esto describe la cadena de plataforma
(`OPENROUTER_MODEL`).** Para el BYOK sin modelo utilizable el desenlace es otro —vendor inenrutable con aviso al
arrancar, sin breaker— y está arriba, en «OpenRouter y modelos `:free`».

**Resultado por candidato de la pasada (2026-09-21; anotado entero el 2026-09-24).** La lectura a medias de este
apartado —quedarse en los descartes y concluir «ninguno cumple»— es lo que llevó a proponer vaciar la variable; el
candidato que **sí** cumple está en la primera fila y lleva anotado desde el principio:

| Candidato | Disponible | `data_collection: deny` | Desenlace |
|---|---|---|---|
| `cohere/north-mini-code:free` | **sí** (HTTP 200) | **aceptado** (HTTP 200) | **Elegido.** Es el valor por defecto de `OPENROUTER_MODEL` y, desde 2026-09-24, también de `BYOK_OPENROUTER_MODEL` |
| `meta-llama/llama-3.3-70b-instruct:free` | **no** (`404`) | no llega a probarse | Descartado: el modelo ya no existe. Era el valor por defecto de `BYOK_OPENROUTER_MODEL` hasta 2026-09-24 |
| `:free` populares de Qwen / Gemma | rate-limit upstream | no llega a probarse | Descartados por indisponibilidad en la pasada, no por política |
| Nemotron, Liquid (`:free`) | sí | **no**: sin endpoint compatible con la política de datos | Descartados: aceptan la petición pero sin `deny` |

Las **dos** condiciones son necesarias (ADR-048 §6): disponible **y** terminado en `:free`, que es lo único con lo que
OpenRouter fuerza `data_collection: deny` (ADR-032 §4). Un modelo verificado que no sea `:free` haría viajar el texto
del CV sin la política, en silencio, que es peor que el modelo muerto al que sustituye.

## Paso 6 decies — Operar el roadmap de estudio

Desde `study-roadmap`, tras un análisis de encaje `done` no degradado con `missingSkills`, se puede pedir un plan de
estudio. El catálogo curado vive en `libs/ai/src/infrastructure/catalog/resources.seed.json` (hits → `verified: true`).

- **Endpoints.** `POST/GET /api/analyses/:analysisId/roadmap` (claim `generating` → `ready`/`failed`; ownership);
  export `GET /api/analyses/:analysisId/roadmap.md` (solo si `ready`).
- **Auto-enqueue.** Al completar un match no degradado con skills faltantes, el outbox encola `RoadmapRequested.v1`
  (`jobId=roadmap:{analysisId}`) en la misma unidad de commit; el consumer de `analyze-match` **no** llama a
  `build-roadmap`.
- **Cuota.** `build-roadmap=10` en `AI_QUOTAS` (ledger diario por usuario), independiente de `match-cv`. La auto y el
  POST respetan la misma cuota; vacía = sin límite.

## Paso 6 undecies — Operar BYOK (claves de la persona)

Desde `ai-byok`, quien ya paga Anthropic, OpenAI u OpenRouter puede guardar **su** clave en `/perfil` y el routing
prioriza `byok:<userId>:<vendor>` antes de la cadena de plataforma. Decisiones en ADR-032; aquí solo operación.

- **`AI_VAULT_KEY` (obligatoria en producción).** 32 bytes aleatorios en base64; la leen `api` y `worker` al arrancar
  (`parseAiConfig`). Sin ella válida en prod el proceso no arranca. Fuera de prod, sin vault el `PUT` de claves responde
  `503 vault_unavailable`. Generar y fijar (mismo valor en ambos procesos):

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```

  Copia el resultado a `AI_VAULT_KEY` en el secreto del despliegue (nunca en git ni en logs). Reinicia `api` y `worker`.

- **Rotación de la vault key.** No hay re-encrypt: las filas cifradas con la clave anterior quedan ilegibles. Procedimiento:
  1. Avisa a quien tenga claves (o borra todas las filas de `user_ai_keys` si el entorno es controlado).
  2. Genera una clave nueva, sustituye `AI_VAULT_KEY`, reinicia `api`/`worker`.
  3. Cada persona **revoca** (DELETE) y **vuelve a pegar** su clave en `/perfil`.

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'db.user_ai_keys.countDocuments({})'
  ```

- **Modelos y plazos.** Fijos por env (`BYOK_ANTHROPIC_MODEL`, `BYOK_OPENAI_MODEL`, `BYOK_OPENROUTER_MODEL` y
  `BYOK_*_TIMEOUT_MS`); sin picker. OpenRouter BYOK: si el modelo termina en `:free` se fuerza `data_collection: deny`;
  si no, no se fuerza deny. No listes BYOK en `AI_CHAIN`.

- **Privacidad.** La clave en claro solo vive en memoria al cifrar (PUT) o al construir el provider de esa ejecución.
  Logs: redactor de api/worker cubre `apiKey`, `authorization`, `AI_VAULT_KEY`, `ciphertext`, `vaultKey`. Respuestas HTTP
  de gestión: solo `vendor`, `keyHint`, `updatedAt`. Con consentimiento externo apagado, las claves pueden seguir
  guardadas pero **no se usan**. Al borrar la cuenta se borran las filas de `user_ai_keys` en la misma transacción.

- **Circuit breaker por `byok:<userId>:<vendor>`.** Cada proveedor BYOK tiene su propio breaker (id con userId y vendor).
  Fallos de la clave de Ana no abren el de Beto ni el de OpenRouter de plataforma. Si el breaker de una persona abre,
  solo ella degrada o cae a la cadena de plataforma (si aún tiene cuota); tras ~30 s el breaker permite reintentar.
  No hay reset manual por clave Redis: esperar o reiniciar el proceso.

- **Cuota de plataforma.** Los `success` con proveedor `byok:*` **no** cuentan en el ledger de cuota de plataforma.
  Con cuota de plataforma agotada la cadena efectiva puede ser solo BYOK; sin BYOK elegible, degradación honesta.

## Paso 6 terdecies — Correo transaccional (verify + reset / ADR-034)

Desde `auth-email-recovery`, `api` envía correo de verificación y de recuperación de contraseña vía el puerto Mailer
([ADR-034](adr/ADR-034.md)). Comportamiento normativo: specs `platform/email`, `auth/email-verification`,
`auth/password-recovery`. Aquí solo operación y DNS.

### Camino normal vs fallback de operador

- **Camino normal (producto):** forgot → email con enlace → SPA `/restablecer-contrasena` → `POST /api/auth/reset-password`
  (spec `auth/password-recovery`). Verificación: banner + resend autenticado, o enlace del correo a
  `/verificar-email`.
- **Fallback de operador:** el [reseteo manual Argon2id](#reseteo-manual-de-contraseña-operador) del Paso 6 duodecies
  sigue disponible si el proveedor de correo está caído, la persona no tiene acceso al buzón, o hace falta desbloquear
  sin esperar al email. No sustituye al flujo email en condiciones normales.

### Local: Mailpit (sin DNS)

`docker compose up -d --wait` levanta Mailpit junto a mongo/redis/minio. Con `.env` de `.env.example`
(`MAIL_PROVIDER=smtp`, `MAIL_SMTP_HOST=localhost`, `MAIL_SMTP_PORT=1025`):

- SMTP: `localhost:1025` (o `MAILPIT_SMTP_PORT` / `MAIL_SMTP_PORT` si los cambiaste).
- UI de captura: http://localhost:8025 (o el puerto de `MAILPIT_UI_PORT`).

**No hace falta SPF/DKIM/DMARC en local.** Sin registros DNS el change se valida y se fusiona igual; solo afecta a
staging/prod con Resend.

Tests y CI usan `MAIL_PROVIDER=capture` (`CapturingMailer`); el pipeline **no** depende de Mailpit.

### Staging/prod: Resend + DNS del From

Variables (ver `.env.example` y, cuando exista, `apiConfigSchema`):

| Variable | Rol |
|---|---|
| `MAIL_PROVIDER=resend` | Adaptador HTTP Resend |
| `MAIL_FROM` | Remitente visible, p. ej. `LinkVault <noreply@tu-dominio>` (placeholder en `.env.example`: `noreply@example.com`) |
| `RESEND_API_KEY` | Obligatoria con `resend`; vacía en local |
| `WEB_BASE_URL` | Base de los enlaces del SPA en el correo |

**Antes de confiar en la entrega en un dominio real**, publica en el DNS del dominio del From (panel del registrador o
del DNS que use Resend):

1. **SPF** — registro TXT en el apex (o el host que indique Resend) que autorice a Resend a enviar por ese dominio.
   Usa el `include:` documentado por Resend para tu dominio verificado; no copies un SPF de otro proveedor a ciegas.
2. **DKIM** — los CNAME (o TXT) que Resend muestra al verificar el dominio; sin ellos muchos receptores marcan spam o
   rechazan.
3. **DMARC** (recomendado): TXT en `_dmarc.<dominio>`, p. ej. empezar en monitor
   `v=DMARC1; p=none; rua=mailto:dmarc@tu-dominio` y endurecer (`quarantine` / `reject`) cuando SPF+DKIM estén
   alineados.

Sin SPF/DKIM el proveedor puede rechazar el envío o degradar la reputación; **eso no bloquea** el desarrollo local ni
el merge del change. Checklist de deploy: dominio verificado en Resend + registros publicados + `MAIL_FROM` alineado
al dominio.

### Tokens y TTLs (referencia ops)

- Verify: `AUTH_VERIFY_TOKEN_TTL_HOURS` (default 24).
- Reset: `AUTH_RESET_TOKEN_TTL_SECONDS=3600` (1 h de producto).
- En Mongo solo el hash del token; el valor en claro solo viaja en el email y en la query del SPA.

### Web Push VAPID (notifications / ADR-035)

El canal web push usa un par de claves VAPID documentado en `.env.example`:

| Variable | Rol |
|---|---|
| `VAPID_PUBLIC_KEY` | Clave pública (SPA / `GET` vapid; también firma en el worker) |
| `VAPID_PRIVATE_KEY` | Clave privada (solo servidor; nunca en el SPA ni en git) |
| `VAPID_SUBJECT` | Contacto VAPID: `mailto:` o URL (p. ej. `mailto:ops@tu-dominio`) |

**Generar un par** (local o staging; no reutilizar el de prod en otro entorno):

```bash
npx web-push generate-vapid-keys
```

Copia `Public Key` → `VAPID_PUBLIC_KEY` y `Private Key` → `VAPID_PRIVATE_KEY`. En local, un par de desarrollo
es suficiente: api/worker no deben fallar el arranque solo por usar claves de prueba; el email de producto sigue
comprobándose en Mailpit. Sin claves usables en un entorno, el push falla en soft (email sigue; ver ADR-035).

Nunca versionar la privada real. Rotación: generar un par nuevo, desplegar env, y pedir a las personas que vuelvan a
suscribirse (los endpoints firmados con el par anterior dejan de ser válidos).

### Digest semanal de grupo (B10 / ADR-035 enmienda)

Variables (`.env.example`): `FEATURE_GROUP_DIGEST`, `GROUP_DIGEST_CRON`.

- Con `FEATURE_GROUP_DIGEST=false` el worker no registra / no-op el job de digest.
- Cron default UTC `0 14 * * 1` (lunes 14:00): procesa la semana ISO **W−1** (`group_links.sharedAt`).
- Opt-out: preferencia `groupWeeklyDigest`. Solo email (no push). Comprobar en Mailpit en local.

---

## Paso 6 quattuordecies — Meilisearch (perfil `search` / ADR-006 F2)

Búsqueda híbrida (change `search`, ADR-036). Meilisearch **no** arranca con el compose por defecto.

```bash
docker compose --profile search up -d --wait
# equivalente para demo (mismo Meili): docker compose --profile demo up -d --wait
```

Variables (ver `.env.example`): `FEATURE_SEARCH`, `MEILI_HOST`, `MEILI_MASTER_KEY`, `MEILI_INDEX`,
`AI_EMBED_CHAIN`, `AI_EMBED_MODEL`, `SEARCH_SEMANTIC_RATIO`, `SEARCH_BACKFILL_RATE`.

- Local / host (`nx serve`): `MEILI_HOST=http://localhost:7700` (puerto `MEILI_PORT`, default 7700).
- Contenedor en la red compose: `MEILI_HOST=http://meilisearch:7700`.
- Con `FEATURE_SEARCH=false`, api/worker arrancan sin exigir Meili.

### Demo seed (demo-seed / ADR-042)

Datos fijos para tour en browser. Detalle y checklist: [`docs/demo.md`](demo.md).

```bash
docker compose --profile demo up -d --wait
ALLOW_DEMO_SEED=true pnpm nx run api:seed-demo
```

Guards: no `NODE_ENV=production`; host Mongo en allowlist local; el seed **no** llama a Meili
(reutiliza backfill/outbox). Credenciales Ana/Bob en `docs/demo.md`.

### Rango salarial (search-salary-range / ADR-040)

Tras desplegar settings filterable (`salaryMin`/`salaryMax`) en **api y worker**, reindexar
previews existentes:

```bash
pnpm nx run api:backfill-search -- --docType=job_preview --limit=500
# opcional: --dry-run
```

Sin backfill, el filtro de rango solo ve docs reindexados tras el deploy. También se rellenan
`salaryMin`/`salaryMax` en el próximo upsert natural (edición/enrich).

### Texto salarial → extremos (search-salary-text-parse / ADR-046)

Backfill **two-step** (sin dual-write Meili). Paso 1 solo Mongo; paso 2 reusa el outbox:

```bash
# 1) Parse determinista de summary → preview.salary (+ source auto / parse-salary-text)
pnpm nx run api:backfill-salary-parse -- --limit=500
# opcional: --dry-run

# 2) Reindex Meili vía SearchUpsert (misma semántica ADR-040)
pnpm nx run api:backfill-search -- --docType=job_preview --limit=500
```

El CLI de parse **no** escribe Meili. Enrich live también aplica el parse post-cadena cuando
ambos extremos faltan y el source no es `manual`/`pasted`.

**Red interna (prod):** Meilisearch MUST quedar en red interna (VPC / red `internal` de compose). No exponer el
puerto ni la master key a Internet; solo api/worker en la misma red privada deben alcanzarlo. En local el puerto se
publica solo para desarrollo en el host.

---

### Frescura de vacantes (job-link-freshness / ADR-037)

Variables (ver `.env.example`): `FEATURE_LINK_FRESHNESS`, `LINK_FRESHNESS_INTERVAL_DAYS`,
`LINK_FRESHNESS_BATCH_LIMIT`.

- Con `FEATURE_LINK_FRESHNESS=false` el detector del worker es no-op (sin re-check ni auto-expire).
- Cada pasada prioriza la **cascada pendiente** (links ya cerrados con apps abiertas o ASN de grupo
  sin confirmar) y el resto del lote va a links abiertos elegibles (cadencia o `expiresAt` pasado).
- Cierre por calendario no scrapea; re-check usa `jobId` `fresh:{linkId}:{bucket}`.

---

## Paso 6 quindecies-bis — Discovery de bolsas (job-discovery / ADR-043)

Buscar vacantes en Get on Board (API pública) y Remote OK (dump cacheado); guardar con
`POST /api/links`. SPA: `/descubrir`.

```bash
# .env
FEATURE_DISCOVERY=true
DISCOVERY_CHAIN=live   # mock en CI / sin red
```

- Flag off → `GET /api/discovery/search` responde `503` `discovery_disabled`.
- Remote OK: cache Redis 15 min + limiter de egress; no martillar el dump.
- LinkedIn / Indeed / Computrabajo **no** son fuentes de discovery (ADR-022).

---

## Paso 6 quindecies — Extensión Chromium / Firefox (browser-extension / ADR-038 + ADR-047)

Guardar la URL de la pestaña activa sin scrapear el DOM (G5). Auth propia:
`POST /api/auth/extension/{login,refresh,logout}` (refresh en body; **no** cookie `lv_refresh`).

### Build Chromium (unpacked)

```bash
pnpm nx build extension
```

Salida: `dist/apps/extension/`.

1. Chrome/Edge → `chrome://extensions` → Modo desarrollador → **Load unpacked** → elegir
   `dist/apps/extension`.
2. Copia el **Extension ID** (p. ej. `abcdefghijklmnopqrstuvwxyz123456`).
3. En `.env` de la API (host):

```bash
EXTENSION_CORS_ORIGINS=chrome-extension://abcdefghijklmnopqrstuvwxyz123456
```

4. Reinicia `pnpm nx serve api`. Vacío = CORS off (default en `.env.example`).

### Build Firefox (temporary add-on)

Requiere Firefox ≥ 121.

```bash
pnpm nx run extension:build-firefox
pnpm nx run extension:lint-firefox   # contrato FF ≥ 121 (manifest + artefactos)
```

Salida: `dist/apps/extension-firefox/` (outDir **separado** del Chromium).

1. Firefox → `about:debugging` → This Firefox → **Load Temporary Add-on…** → elegir
   `dist/apps/extension-firefox/manifest.json`.
2. Abre el popup / Network y copia el header `Origin` (`moz-extension://<uuid>`). En
   temporary installs el UUID **cambia en cada carga** — vuelve a pegarlo en
   `EXTENSION_CORS_ORIGINS` tras recargar el add-on. Builds firmados AMO usan el
   `gecko.id` estable `linkvault@linkvault.app`.
3. Ejemplo `.env` (puedes CSV-combinar Chrome + Firefox):

```bash
EXTENSION_CORS_ORIGINS=chrome-extension://abcdefghijklmnopqrstuvwxyz123456,moz-extension://xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

4. Reinicia `pnpm nx serve api`. Orígenes con esquema distinto a `chrome-extension` /
   `moz-extension` hacen fallar el boot de la API.

Base URL del build: `EXTENSION_API_BASE_URL` (default `http://localhost:3000` en dev). El popup
envía `X-Requested-With: linkvault` en las rutas de auth extensión.

**Nota:** con `host_permissions` al origen API, el navegador puede omitir CORS; la allowlist
acota orígenes web. La defensa real es auth + rate-limit + `client=extension` (ADR-038).

### Checklist tiendas (manual — listing live fuera del DoD)

Builds de **tienda** (no local): setear `EXTENSION_API_BASE_URL` a la URL de producción
**antes** de construir; el `host_permissions` del manifest refleja ese origen.

**Chrome Web Store**

1. `EXTENSION_API_BASE_URL=https://<api-prod> pnpm nx build extension --configuration=production`
2. Zip del contenido de `dist/apps/extension/` (manifest en la raíz del zip).
3. Developer Dashboard → New item → subir zip; privacy / single purpose; capturas.
4. Sin secrets de publisher en el repo; sin publish desde CI en v1.

**Firefox AMO**

1. `EXTENSION_API_BASE_URL=https://<api-prod> pnpm nx run extension:build-firefox`
2. `pnpm nx run extension:lint-firefox` (debe pasar).
3. Zip de `dist/apps/extension-firefox/`; submit en AMO (gecko id
   `linkvault@linkvault.app`). Privacy policy + capturas. El validador online de
   AMO es la autoridad al publicar (el lint local no sustituye a AMO).
4. Listing aprobado **no** es requisito para cerrar el change; solo checklist + artefacto.

---

## Paso 6 duodecies — Operar producción (deploy-prod / ADR-033)

Camino canónico: `docker-compose.prod.yml` + Traefik + Let's Encrypt. Procedimiento de arranque, contrato de
variables, correo y buckets: [`infra/README.md`](../infra/README.md). Para levantar la pila entera en tu máquina
—lo mismo que verifica el CI— hay un procedimiento ejecutable en
[«Levantar la pila entera en tu máquina»](../infra/README.md#levantar-la-pila-entera-en-tu-máquina-lo-mismo-que-verifica-el-ci).

### Los dos workflows de CD, y cómo se lee cada resultado

Esto estaba sin documentar en ningún sitio, y no es una anécdota: `cd-staging` acumuló **21 ejecuciones y 21 fallos**
—desde el propio commit que lo creó— sin que nadie los mirara, porque el rojo era el estado esperado de un pipeline
que exigía secrets que no existían. Detrás de ese rojo se escondió un defecto real de build durante un mes
([ADR-048](adr/ADR-048.md)). `cd-prod` no se había ejecutado **nunca**.

| Workflow | Disparo | Qué hace |
|---|---|---|
| [`cd-staging`](../.github/workflows/cd-staging.yml) | push a `main`; `workflow_dispatch` con `dry_run` | verify por afectación → construir las tres imágenes **cargándolas** (sin publicar) → **verificar el artefacto** → publicar lo verificado en GHCR (`sha-<12>` siempre, `:staging` solo desde `main`) → si hay destino, ssh + `compose pull` + `up` + smoke interno |
| [`cd-prod`](../.github/workflows/cd-prod.yml) | tag `vX.Y.Z`; `workflow_dispatch` con `tag`/`dry_run`/`ref` | igual, con el verify sobre **todo el workspace** y los tags `vX.Y.Z` y `:latest` |

**La verificación del artefacto** es el paso que da sentido a todo lo demás: en el job `build, verify and publish
artifact`, el paso `Verify artifact (docker-compose.prod.yml stack in the runner)` levanta en el propio corredor la
pila de producción con las imágenes recién construidas y exige que `api`, `worker` y `web` arranquen y respondan. Que
el código compile no dice **nada** sobre si la imagen arranca, y hasta ADR-048 nada lo comprobaba. El mismo script se
ejecuta en local: `infra/ci/verify-artifact.sh`.

**Tres resultados, no dos** (ADR-048 §3, que enmienda ADR-033 D10). Se leen **sin abrir la ejecución**, en la lista de
checks del commit, por dos vías que dicen lo mismo: el **nombre del job de reporte** y el **estado de commit**
`cd-staging/artifact` (o `cd-prod/artifact`).

| Lo que ves en la lista de checks | Qué pasó | Qué hacer |
|---|---|---|
| `resultado: artefacto verificado — NO desplegado (sin destino de staging)`, en **verde** | el artefacto se construyó y arrancó; no hay servidor configurado | nada está roto. Es el estado normal hoy; para pasar a desplegado, mira abajo |
| `resultado: el artefacto NO pasó la verificación`, en **rojo**, con la descripción «El artefacto no se construyó o no arrancó…» | no construye, o construye y **no arranca** | abre la ejecución: el paso de verificación vuelca `docker compose ps` y los logs de `api`, `worker` y `web` |
| el mismo nombre, en **rojo**, con la descripción «No se pudo verificar el artefacto: el registro de terceros no sirvió sus imágenes…» | **no es nuestro**: el registro del que se bajan mongo/redis/minio no sirvió las imágenes y el artefacto no llegó a levantarse; nadie lo ha comprobado, ni para bien ni para mal | relanza la corrida; suele bastar. Si se repite, mira el estado del registro antes de tocar nada del repositorio |
| el mismo nombre, en **rojo**, con la descripción «La verificación del artefacto no pasó…» (sin causa) | la verificación no pasó y **la causa no llegó** al reporte: el job murió antes de clasificarla | abre la ejecución; aquí el reporte calla el motivo a propósito en vez de suponer el de siempre |
| `resultado: artefacto verificado y desplegado a staging`, en **verde** | había destino y el despliegue y su smoke terminaron bien | — |
| `resultado: artefacto verificado, despliegue a staging NO completado`, en **rojo** | había destino y el despliegue falló | ahí sí hay una avería de despliegue |
| `resultado: destino de staging indeterminado — no se desplegó`, en **rojo** | el `preflight` encontró **algunos** secrets y otros no | alguien sí quería desplegar: completa los que faltan (el preflight los nombra) |

Un artefacto roto es **fallo en los tres casos**, haya destino o no; y un dry-run **no** cuenta como despliegue. Lo que
ADR-048 revoca es comunicar la **ausencia de destino** como avería.

Las tres filas rojas comparten **nombre de job** y se distinguen por la **descripción del estado de commit**, que es lo
que va debajo en la misma lista. No es un descuido: el nombre de un job se fija a partir de los resultados de los jobs
de los que depende, y la causa del fallo no viaja por ahí. Un fallo del entorno **no es verde** —nadie ha verificado
nada—, pero tampoco es un defecto del repositorio, y por eso se dice distinto (ADR-048 §3, desenlace 4).

**Qué hay que configurar para pasar de «verificado» a «desplegado».** Los cuatro secrets del target, todos o ninguno
—`STAGING_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_COMPOSE_DIR` (y los `PROD_*` equivalentes)—, más, en
el host, el `docker-compose.prod.yml`, el directorio de `infra/` y un `.env.staging` / `.env.prod` que cumpla el
contrato de variables de [`infra/README.md`](../infra/README.md#variables-de-entorno-contrato-prod). Opcional:
`GHCR_READ_TOKEN` si las imágenes del registro son privadas. En producción, además, los `PROD_*` tienen que ser
legibles por el job `preflight`, que usa el entorno espejo `production-preflight`: si son secrets **del entorno
`production`**, hay que copiarlos también al espejo o el preflight dirá «sin destino» para siempre — que es
exactamente la mentira que este mecanismo existe para no contar.

Mientras el CD siga terminando en «verificado sin destino», el siguiente change es la **fila 35** (`staging-host`):
destino real y primeros usuarios que no sean el autor. Esa precedencia es el compromiso, y no una fecha (ADR-048,
Consecuencias).

### Reseteo manual de contraseña (operador)

**Fallback** cuando el flujo email de `auth/password-recovery` no es viable (Resend caído, buzón inaccesible,
incidente). En condiciones normales la persona usa forgot-password → enlace → reset. Para desbloquear a mano:

1. Genera un hash **Argon2id** con los mismos parámetros que la app (`memoryCost=19456`, `timeCost=2`, `parallelism=1`,
   algoritmo Argon2id — ADR-012 / `ARGON2_OPTIONS` en api):

   ```bash
   node -e "const {hash}=require('@node-rs/argon2'); hash(process.argv[1],{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1}).then(console.log)" 'NuevaClaveTemporal!'
   ```

2. Sustituye `passwordHash` en `users` y **revoca todas las sesiones** de esa persona (access + refresh dejan de valer):

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T mongo \
     mongosh "mongodb://mongo:27017/linkvault?replicaSet=rs0" --quiet --eval '
       const email = "<email>".toLowerCase();
       const passwordHash = "<pegado del paso 1>";
       const u = db.users.findOne({ email }, { _id: 1 });
       if (!u) { throw new Error("user not found"); }
       db.users.updateOne({ _id: u._id }, { $set: { passwordHash } });
       const now = new Date();
       print(db.auth_sessions.updateMany({ userId: u._id.toString(), revokedAt: null }, { $set: { revokedAt: now } }).modifiedCount + " sessions revoked");
     '
   ```

3. Comunica la contraseña temporal por un canal fuera de banda y pide cambio inmediato en `/perfil`.

### Un owner por grupo (antes del primer deploy con datos)

Misma consulta que el Paso 6 quater; con compose prod usa el servicio `mongo` de `docker-compose.prod.yml`. Si hay
duplicados, degrada a `member` los sobrantes **antes** de que el índice `one_owner_per_group` se cree en arranque.

### Relay del outbox: exactamente una api

`OUTBOX_RELAY_ENABLED=true` solo en el servicio `api` del compose prod. Checklist:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api \
  node -e "console.log('OUTBOX_RELAY_ENABLED='+(process.env.OUTBOX_RELAY_ENABLED||''))"
```

No hagas `--scale api=2` mientras esa variable siga en `true` en todas las réplicas (doble publicación a BullMQ).

### GC de objetos huérfanos (CV)

Sin job automático (ADR-033 D5). Procedimiento: Paso 6 octies (objetos huérfanos), adaptando el compose a
`docker-compose.prod.yml` y el alias MinIO del contenedor prod. Revisión humana entre listar y borrar.

### Jobs BullMQ tras borrado de cuenta (ack si user gone)

Si un job en vuelo lleva un `userId` cuya fila en `users` ya no existe (cuenta borrada), el consumer **debe hacer ack**
(completar sin reintentar). Reintentar indefinidamente no recupera datos. Colas típicas: `extract-cv`, `delete-cv-file`,
`analyze-match`, `build-roadmap`, enrich atribuido a persona. Si ves `failed` creciendo tras un borrado masivo, revisa
que el consumer de esa cola implemente el ack (cambio `deploy-prod` / ADR-033 D11); no reencoles a mano esos jobs.

### Smoke de readiness (nunca Traefik público)

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api \
  node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{const t=await r.text();console.log(t);const j=JSON.parse(t);if(!r.ok||j.status!=='up')process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})"
```

`GET https://$PUBLIC_HOST/health` **no** es smoke válido: Traefik no expone `/health*` ni `/metrics` al entrypoint
público (van a 404 del SPA o no enrutan a api).

## Paso 7 — Definition of Done (pégalo en cada PR)

- [ ] Change archivado; spec delta mergeada en `openspec/specs/`
- [ ] Cada Scenario de la spec tiene un test que lo referencia por nombre
- [ ] `pnpm nx affected -t lint,typecheck,test` en verde con `AI_CHAIN=mock AI_MOCK_MODE=replay`
- [ ] `docker compose up` levanta la feature end-to-end
- [ ] qa-reviewer en verde; decisiones no triviales en `docs/adr/`
- [ ] Sin SDKs de IA fuera de `libs/ai/infrastructure/providers`; sin PII en logs

## Paso 8 — Si algo falla

| Síntoma | Acción |
|---|---|
| `/opsx:*` no aparece | `openspec init` no eligió Claude Code → vuelve a correrlo o `openspec update` |
| Hook bloquea todo | Verifica que el script tenga `chmod +x`; prueba `echo '{"tool_input":{"file_path":"apps/x.ts"}}' \| bash .claude/hooks/require-openspec-change.sh` |
| Mongo: "Transaction numbers are only allowed on a replica set member" | El healthcheck de `mongo` no ha inicializado `rs0`: revisa su estado con `docker compose ps` o `docker inspect --format '{{json .State.Health}}' linkvault-mongo-1` (ver ADR-017) |
| `api` no arranca nombrando `AUTH_JWT_SECRET` u otra `AUTH_*` | Tu `.env` es anterior a `auth-users`: copia el bloque `AUTH_*` de `.env.example`. Con `NODE_ENV=production` el secreto de ejemplo se rechaza a propósito |
| El `worker` no arranca nombrando `ENRICH_*` o `S3_*` | Tu `.env` es anterior a `link-enrichment`: copia esos dos bloques de `.env.example`. Todas son obligatorias |
| Un link de LinkedIn, Indeed o Computrabajo se queda sin preview | Es el comportamiento correcto: esas bolsas nos prohíben (`robots_disallowed`) o nos bloquean (`blocked`) la lectura. No se reintenta; se completa **pegando su descripción** o a mano (ADR-022 §3, ADR-023). Para probar la lectura automática usa Get on Board: el smoke encontró que el CDN de Trabajopolis rechaza el cliente de Node. Si el `displayUrl` lleva un parámetro prohibido y existe la misma oferta sin él, guardar esa URL limpia dispara el rescate por historial (Paso 6 ter) |
| Los links se quedan en `pending` para siempre | Por orden: ¿está el worker levantado (`pnpm nx serve worker`)?; ¿`OUTBOX_RELAY_ENABLED=true` en `api`?; ¿hay jobs en la cola (`docker compose exec redis redis-cli keys 'bull:enrich-link:*'`)? Si el atasco ya existía, desatáscalo con `pnpm nx run api:backfill-enrichment --status=pending`, que sube `previewVersion` y cambia el `jobId` |
| `POST /api/links/:id/enrich` responde `409` o `429` | `409 enrichment_not_retryable`: el motivo del fallo no se reintenta (`robots_disallowed`, `blocked`, `not_a_job`). `429 too_many_attempts`: 3 relecturas por link cada 15 min, o el contador de Redis no respondió (ese límite falla cerrado a propósito) |
| `api` no arranca nombrando `PASTE_EXTRACTION_TIMEOUT_MS`, `AI_CHAIN`, `AI_MOCK_MODE`, `AI_QUOTAS` u otra `AI_*`/`OLLAMA_*`/`OPENROUTER_*` (`[api] Invalid configuration, check these environment variables: …`) | Desde `paste-job-description` `api` ejecuta IA y valida su configuración con el mismo `parseAiConfig` que el worker. Si falta `PASTE_EXTRACTION_TIMEOUT_MS`, tu `.env` es anterior: cópiala de `.env.example` junto con la sección `--- IA ---`. Si es `invalid`, el detalle dice por qué: `mock` con `NODE_ENV=production`, `AI_MOCK_MODE` distinto de `replay`/`synth` (`record` se graba con `nx run ai:record-fixtures`), `openrouter` sin `OPENROUTER_API_KEY` u `OPENROUTER_MODEL`, o una tarea desconocida en `AI_QUOTAS`. Si no arranca porque no encuentra un prompt, es un `api` compilado fuera de la raíz: necesita `AI_PROMPTS_DIR=dist/apps/api/assets/ai/prompts`, porque `AiModule` comprueba al iniciarse que existen los prompts de todas sus tareas |
| `POST /api/links/:id/pasted` responde `503 extraction_unavailable` siempre | Por orden: ¿`curl http://localhost:3000/health` da `200`? Con Redis caído el contador de pegados falla cerrado y responde `503` sin llamar a la IA. ¿`AI_CHAIN=none`? Entonces toda lectura degrada. ¿Ollama arriba y con el modelo? `curl http://localhost:11434/api/tags` debe listar `OLLAMA_MODEL` (si no, `ollama pull qwen2.5:7b`). ¿El plazo? Un modelo en CPU puede pasar de los 20 s de `PASTE_EXTRACTION_TIMEOUT_MS`: súbelo (hasta 120 000) y reinicia `api`; `OLLAMA_TIMEOUT_MS` también corta. ¿La cadena solo tiene `openrouter` y quien pega no dio su consentimiento? Responde `503` para siempre hasta que exista `ai_consent_required` (ADR-023). Tras varios fallos seguidos el circuit breaker del proceso deja de llamar a ese proveedor unos 30 s. El ledger dice qué pasó, sin el texto: `docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval "db.ai_usage.find({task:'extract-pasted-job'},{_id:0,outcome:1,reason:1,providerId:1,latencyMs:1,at:1}).sort({at:-1}).limit(5)"` (`degraded` con `no_providers`: ningún proveedor elegible; con `providers_failed`: fallaron o se agotó el plazo). Un `503` no gasta pegados |
| `POST /api/links/:id/pasted` responde `429` | Mira el código. `ai_quota_exceeded` ("vuelve mañana", `Retry-After` de 24 h): quien pega agotó su cuota diaria de `extract-pasted-job` en `AI_QUOTAS`, que cuenta sus lecturas con éxito de las últimas 24 h en `ai_usage` y es independiente de la de `extract-job`. En local, sube o quita esa entrada de `AI_QUOTAS` y reinicia `api`; en un entorno compartido se ajusta la cuota del entorno, nunca el ledger. `too_many_attempts` ("espera un poco"): más de 10 pegados en 15 min; en local, `docker compose exec redis redis-cli del links:paste:<userId>`. Nunca en un entorno compartido |
| El worker avisa de que no pudo guardar el snapshot | MinIO caído o sin bucket: `docker compose up -d --wait` lo crea con su regla de 30 días. El enriquecimiento no falla por eso; lo que se pierde es la copia para el golden real |
| `api` registra `Could not build the index one_owner_per_group of group_members: …` | Hay datos antiguos con dos owners en un grupo (`11000 DuplicateKey`) y el índice no existe; `api` sigue sirviendo. Lista los grupos afectados, degrada a `member` a los owners sobrantes, reinicia `api` y comprueba el índice con `getIndexes()` (Paso 6 quater). Otro motivo: reinicia `api` con Mongo sano |
| `POST /api/groups/join` responde `429` | Más de 10 códigos incorrectos del usuario o más de 100 desde su IP (IPv6 por /64) en 15 min; `Retry-After` dice cuánto falta. En local: `docker compose exec redis redis-cli del groups:join:user:<userId>` o `del groups:join:ip:<grupo de IP>`. Si una IP se agota una y otra vez, localiza las cuentas (Paso 6 quater). Si le pasa a todos a la vez detrás de un proxy, falta `trustProxy` |
| Login o registro responden `429` en pruebas locales o en `/lv:smoke` | Contadores de intentos de la ventana de 15 min en Redis. En local: `docker compose exec redis sh -c "redis-cli --scan --pattern 'auth:*' \| xargs -r redis-cli del"`. Nunca en un entorno compartido |
| `POST /api/auth/*` responde `403` o `415` | Falta `X-Requested-With: linkvault` o el cuerpo no es `application/json` (defensa CSRF, ADR-020) |
| La sesión no se restaura al recargar el SPA | Abre el SPA en `http://localhost:4200` (el proxy mantiene `/api` en el mismo origen); la cookie `lv_refresh` solo viaja a `/api/auth` |
| Claude Code ignora un ADR | Pídele explícitamente: "Relee docs/adr/ADR-0XX.md y explica cómo tu cambio lo cumple" |
| Contexto muy largo / respuestas erráticas | `/compact` o `/clear` + volver al Paso 3 (prompt de verificación de contexto) |

---

**Meta de las primeras 2 semanas:** changes 1–8 archivados → pegar un chat de WhatsApp en un grupo, ver previews enriquecidos, y mover postulaciones en el kanban, todo con `AI_CHAIN=mock` o `ollama`.

---

## Paso 9 — Atajos de automatización (incluidos en el kit)

Todo lo anterior sigue siendo válido; esto lo comprime.

### 9.1 `make setup` ≡ pasos 0–2
Verifica Node ≥ 22, pnpm, Docker; instala Claude Code y OpenSpec si faltan; `git init`; `openspec init`; rellena `openspec/project.md`; primer commit.

### 9.2 Comandos slash propios (`.claude/commands/lv/`)
| Comando | Reemplaza a |
|---|---|
| `/lv:context` | Prompt del paso 3 (además dice qué change sigue) |
| `/lv:new <change\|next>` | `/opsx:new` + `/opsx:ff` con el alcance y ADRs leídos de `openspec-changes.yaml` |
| `/lv:debate [change]` | Prompt de debate critic/business/reflect (4.2); termina con `CONVERGENCIA: SI/NO` |
| `/lv:apply [change]` | `/opsx:apply` con reparto por etiquetas (4.4) |
| `/lv:qa [change]` | `/opsx:verify` + qa-reviewer en bucle; termina con `QA: VERDE/ROJO` |
| `/lv:archive [change]` | Comprobaciones + `/opsx:archive` + mensaje de commit |
| `/lv:status` | Dónde estás |

Sesión interactiva típica por change: `/clear` → `/lv:new next` → (lees) → `/lv:debate` → (lees, commit) → `/lv:apply` → `/lv:qa` → (prueba manual) → `/lv:archive`.

### 9.3 `openspec-changes.yaml` — el manifiesto
Los 15 changes de §6, más los añadidos después (`auth-email-recovery`), con ADRs, agentes y párrafo de alcance. Es lo que `/lv:new` pasa a `/opsx:ff`; edítalo si recortas o reordenas alcance. Añadir un change = añadir una entrada.

### 9.4 `scripts/change.sh` — orquestador headless con puertas humanas
```bash
make next                                   # siguiente change pendiente, etapa por etapa
make change NAME=job-links                  # uno concreto
make change NAME=job-links ARGS="--from apply"   # reanudar desde una etapa: spec|debate|apply|qa|archive
make change NAME=groups ARGS="--yes"        # sin pausas (solo para changes pequeños que ya conoces)
make all-mvp                                # changes 1–8 encadenados, con puertas entre cada uno
```
Qué hace: corre `claude -p "/lv:<etapa>"` en modo `acceptEdits`, guarda cada salida en `.claude/logs/`, se detiene si el debate no imprime `CONVERGENCIA: SI` o si QA no imprime `QA: VERDE`, commitea la spec aprobada y el feat final, y te pregunta antes de cada salto. Las puertas están donde tú aportas valor: leer la spec, decidir tras el debate, probar a mano antes de archivar.

### 9.5 Lo que sigue siendo manual (a propósito)
- Leer `proposal.md`/`design.md` antes del debate y aprobar tras él.
- Revisar las vacantes reales del golden set de `extract-job` (`/lv:golden 20`); el golden que dejó `link-enrichment` es sintético (siete casos), igual que el de `classify-skills` (`placeholder`). **Los snapshots de las páginas caducan a los 30 días**: el golden real hay que grabarlo dentro de esa ventana o habrá que volver a descargarlas (ADR-022 §10).
- Grabar fixtures del mock con un proveedor real (`pnpm nx run ai:record-fixtures`, ADR-019) y evaluar con `pnpm nx run ai:eval` (en mock/replay contra la línea base; con `--provider=ollama` para medir un modelo real). Los que anotaron los tests se graban con `--from-pending` (ver Paso 6).
- `git push` y abrir el PR.

### 9.6 Notas
- Si tu versión de OpenSpec registra `/openspec:proposal|apply|archive` en vez de `/opsx:*`, cambia esos nombres dentro de `.claude/commands/lv/*.md` (una sola vez).
- `claude -p` respeta `CLAUDE.md`, agentes y hooks del proyecto; si un hook bloquea en headless, el log lo muestra y `change.sh` se detiene.
- Para depurar una etapa, ejecútala interactiva: `claude` → `/lv:apply job-links`.

---

## Paso 10 — Modo "solo prompts secuenciales"

Lo que en el Paso 9 seguía siendo manual ahora tiene comando:

| Antes manual | Ahora | Marcador de éxito |
|---|---|---|
| Leer y aprobar la spec | `/lv:review` — architect + qa-reviewer con checklist de 5 puntos; corrigen forma, reportan fondo | `SPEC: APROBADA` |
| Elegir vacantes reales del golden set | `/lv:golden 20` — busca en bolsas públicas (WebSearch/WebFetch), anonimiza, valida con el cargador del eval harness, crea 3 CVs sintéticos; exige la tarea registrada como evaluable | `GOLDEN: OK (N)` |
| Grabar fixtures del mock | `/lv:fixtures` — graba con `nx run ai:record-fixtures` (Ollama/OpenRouter) los casos del golden que faltan —y con `--from-pending`, los que anotaron los tests—, revisa y comprueba replay con `nx run ai:eval` | `FIXTURES: OK (N)` |
| Prueba manual (`docker compose up`, curl, UI) | `/lv:smoke` — levanta todo, ejecuta los flujos HTTP derivados de la spec, Playwright en la UI, reporte con capturas | `SMOKE: OK` |
| Rama, push, PR | `/lv:ship` — rama `change/<n>`, push, `gh pr create` con cuerpo desde la spec y DoD marcado | `SHIP: OK <url>` |
| Encadenar todo lo anterior | `/lv:run <change\|next> [--no-ship]` — las 9 etapas sin preguntar, se detiene en el primer marcador de fallo | `RUN: OK <change>` |

### 10.1 La secuencia completa de prompts (interactivo)
Tras `make setup` y `claude`:

```
/lv:context                      ← 1 vez; confirma que entendió y qué sigue
/lv:run bootstrap-monorepo
/lv:run ai-gateway-core
/lv:run ai-eval-harness
/lv:run auth-users
/lv:run groups
/lv:run job-links
/lv:run link-enrichment          ← incluye /lv:golden 20 tras registrar extract-job
/lv:run applications-tracking    ← aquí ya tienes el MVP demostrable
/lv:run group-comments
/lv:run public-preview-share
/lv:run cv-upload-extract
/lv:run cv-match-suggestions
/lv:run study-roadmap
/lv:run ai-byok
/lv:run auth-email-recovery      # §6 orden 15; ADR-034 (antes de deploy-prod)
/lv:run deploy-prod
```
O simplemente `/lv:run next` dieciséis veces: cada uno lee el manifiesto, salta lo archivado y toma el siguiente. Entre changes usa `/clear`.

Si un `/lv:run` termina en `RUN: FALLO <etapa>`, lee el motivo, corrige (o dime) y relanza la etapa suelta: `/lv:<etapa> <change>`, luego `/lv:run <change>` retoma desde ahí porque cada etapa es idempotente (las ya hechas se detectan por archivos/logs).

### 10.2 Lo mismo desde la terminal (headless)
```bash
make auto NAME=bootstrap-monorepo        # un change, sin puertas, todas las etapas
make mvp                                 # changes 1–8 en orden, se detiene en el primer fallo
make autopilot                           # los 15
make autopilot ARGS="--no-ship"          # sin push/PR
make run NAME=job-links ARGS="--from qa" # con puertas humanas, reanudando desde una etapa
```
Logs por etapa en `.claude/logs/`, reportes de smoke en `reports/smoke/<change>/`.

### 10.3 Lo único que sigue siendo tuyo
- `gh auth login` y tener el remoto `origin` creado (una vez).
- Credenciales opcionales en `.env`: `OPENROUTER_API_KEY` si no usas Ollama.
- Leer los PR que abre `/lv:ship` cuando quieras: el pipeline no hace merge salvo que actives auto-merge en GitHub.
- Decidir cuando un `RUN: FALLO` sea de fondo (un ADR contradicho, una decisión no tomada): ahí Claude Code se detiene y pregunta, por diseño.

### 10.4 Riesgos del modo automático y cómo están acotados
- **Sesgo de auto-aprobación** (`/lv:review` aprueba lo que el mismo modelo escribió): lo mitigan la checklist mecánica, el debate critic/business posterior y el smoke real; revisa al menos los PR de `job-links`, `link-enrichment` y `cv-match-suggestions`.
- **Golden set web**: `/lv:golden` solo toca páginas públicas y anonimiza; aun así revisa `golden.jsonl` antes de que salga del repo privado.
- **Costo**: todo corre con `AI_CHAIN=mock` salvo `/lv:fixtures` y `/lv:golden`; con Ollama el costo es cero.
