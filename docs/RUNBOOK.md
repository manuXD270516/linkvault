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
| 3 | `ai-eval-harness` | §4.11. Corredor, métricas y línea base con 5 casos sintéticos (`placeholder`) de `classify-skills`; el golden real de `extract-job` (`/lv:golden 20`) llega con `link-enrichment` (ADR-019). |
| 4 | `auth-users` | ADR-012. Incluir `aiConsent`, `outputLanguage`. |
| 5 | `groups` | Invitación por código; roles owner/member. `/` pasa a ser la lista de grupos con estado vacío (sustituye el saludo de `auth-users`). |
| 6 | `job-links` | ADR-008, 009. Canonicalizadores para LinkedIn, Computrabajo, Indeed, Trabajopolis, Get on Board. Import desde texto (B1). "Ya está en Grupo X" (B6). |
| 7 | `link-enrichment` | ADR-003, 010. Cola por dominio. `extract-job` vía `runTask`. SSE. |
| 8 | `applications-tracking` | ADR-004, 015. Kanban + timeline. |
| 9 | `group-comments` | Planos, sin hilos. |
| 10 | `public-preview-share` | ADR-013. |
| 11 | `cv-upload-extract` | MinIO, pdf-parse, mammoth. |
| 12 | `cv-match-suggestions` | §4.8 y 4.12. Evaluator-optimizer acotado, `evidence` obligatoria, `ai_feedback`. Controles de IA del perfil diferidos desde `auth-users`: consentimiento con texto honesto, `consentedAt` y versión del texto, "Idioma de los análisis de IA" y redacción del nombre. |
| 13 | `study-roadmap` | Catálogo curado `resources.seed.json` primero. |
| 14 | `ai-byok` | libsodium vault. |
| 15 | `deploy-prod` | compose prod + Traefik + docs de alternativas. Heredado de `auth-users` (ADR-020): `trustProxy`, reseteo manual de contraseña por operador documentado, aviso de privacidad y borrado de cuenta. |
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
  > Nota: el registro automático de fixtures pendientes desde los tests llega con `link-enrichment`. Hasta entonces, cuando un test falle con `FixtureMissing` de una clave que no sale de un golden, el fixture se escribe a mano con `"source": "handwritten"`. `AI_MOCK_MODE=record` sigue rechazándose al arrancar e indica usar `nx run ai:record-fixtures`.

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
- Revisar las vacantes reales del golden set de `extract-job` (`/lv:golden 20`, en `link-enrichment`); el golden de `classify-skills` es sintético (`placeholder`).
- Grabar fixtures del mock con un proveedor real (`pnpm nx run ai:record-fixtures`, ADR-019) y evaluar con `pnpm nx run ai:eval` (en mock/replay contra la línea base; con `--provider=ollama` para medir un modelo real).
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
| Grabar fixtures del mock | `/lv:fixtures` — graba con `nx run ai:record-fixtures` (Ollama/OpenRouter) los casos del golden que faltan, revisa y comprueba replay con `nx run ai:eval` | `FIXTURES: OK (N)` |
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
