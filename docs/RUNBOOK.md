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
| 12 | `cv-match-suggestions` | §4.8 y 4.12. Evaluator-optimizer acotado, `evidence` obligatoria, `ai_feedback`. Controles de IA del perfil diferidos desde `auth-users`: consentimiento con texto honesto, `consentedAt` y versión del texto, "Idioma de los análisis de IA" y redacción del nombre. |
| 13 | `study-roadmap` | Catálogo curado `resources.seed.json` primero. |
| 14 | `ai-byok` | libsodium vault. |
| 15 | `deploy-prod` | compose prod + Traefik + docs de alternativas. Heredado de `auth-users` (ADR-020): `trustProxy`, reseteo manual de contraseña por operador documentado, aviso de privacidad y borrado de cuenta. Heredado de `link-enrichment` (ADR-022): elegir proveedor de objetos (el cliente habla S3) y crear allí el bucket de snapshots con su expiración a 30 días, fijar las `ENRICH_*` por entorno y decidir dónde queda encendido el relay del outbox, que sigue siendo de una sola instancia. Heredado de `paste-job-description` (ADR-023): fijar `PASTE_EXTRACTION_TIMEOUT_MS` y la cuota de `extract-pasted-job` en `AI_QUOTAS` por entorno, y copiar los prompts también en la imagen de `api` (`AI_PROMPTS_DIR=dist/apps/api/assets/ai/prompts` si no arranca desde la raíz). Heredado de `groups-ownership-join-limit` (ADR-025): `trustProxy` también por el contador de IP del join, y la consulta de "un owner por grupo" antes del primer despliegue (Paso 6 quater). Heredado de `applications-tracking` (ADR-024): el borrado de cuenta tiene que borrar en cascada las `applications` y los `application_events` de esa persona; hasta entonces, a mano (Paso 6 quinquies). |
| 16 | `auth-email-recovery` | Fuera de §6: verificación de email y recuperación de contraseña, diferidas desde `auth-users` (ADR-020). Alcance y orden por decidir al crearlo. |

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
  campos que necesites (ver más abajo). El grupo nunca las recibe, y la API tampoco devuelve nunca `fitScore`.
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
- **La cascada al borrar una cuenta está pendiente, y la hereda `deploy-prod`** (ADR-024, riesgos aceptados). Hoy no
  existe el borrado de cuenta. Cuando exista, tendrá que borrar las `applications` y los `application_events` de esa
  persona. Mientras tanto, si alguien pide que se borren sus datos, se hace a mano, en una transacción, con el `_id` de
  la consulta anterior. `application_events` repite el `userId`, así que el filtro alcanza todo su historial:

  ```bash
  docker compose exec mongo mongosh "mongodb://localhost:27017/linkvault?directConnection=true" --quiet --eval 'const s = db.getMongo().startSession(); s.withTransaction(() => { const d = s.getDatabase("linkvault"); const u = ObjectId("<userId>"); printjson({ events: d.application_events.deleteMany({ userId: u }).deletedCount, applications: d.applications.deleteMany({ userId: u }).deletedCount }); }); s.endSession()'
  ```

  Repite las dos consultas de arriba: deben devolver `[]` y `0`. Sus avatares ya dejan de verse en cuanto deja de ser
  miembro de un grupo (visibilidad derivada), pero sus datos privados siguen guardados hasta este borrado. Borrar su
  cuenta, sus membresías y sus links no entra aquí: es el resto del borrado de cuenta de `deploy-prod`.
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

- **Borrar a mano los comentarios de una persona.** Hoy no existe el borrado de cuenta: `deploy-prod` hereda de ADR-026
  qué hace con los `group_link_comments` de quien borra su cuenta (borrarlos o anonimizarlos), y hasta entonces una
  petición de borrado se atiende a mano. Quien salió de un grupo tampoco puede borrar lo suyo sin volver a entrar,
  aunque el propietario del grupo sí puede. Primero su `_id`, por su email normalizado, y qué tiene escrito, sin leer
  ningún texto:

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
  membresías, sus links y sus postulaciones no entra aquí: es el resto del borrado de cuenta de `deploy-prod`.
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

- **Los enlaces que publicó una persona.** Hoy no existe el borrado de cuenta: `deploy-prod` hereda de ADR-027
  despublicar (`$unset publicShare`) lo que esa persona publicó, además de lo que decida sobre sus
  `group_link_comments` (ADR-026) y sus postulaciones (ADR-024). Hasta entonces, una petición de borrado se atiende a
  mano. Su `_id` sale por su email normalizado, como en el paso anterior:

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
/lv:run deploy-prod
/lv:run auth-email-recovery      ← fuera de §6; revisa su alcance antes (ver tabla del Paso 5)
```
O simplemente `/lv:run next` quince veces: cada uno lee el manifiesto, salta lo archivado y toma el siguiente. Entre changes usa `/clear`.

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
