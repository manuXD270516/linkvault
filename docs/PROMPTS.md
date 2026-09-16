# LinkVault — Secuencia de prompts para Claude Code (UI de escritorio)

Cada bloque es **un mensaje** que pegas en el chat de Claude Code. El flujo SDD con OpenSpec (new → ff → review → debate → apply → verify → archive) ocurre dentro de cada comando; no tienes que nombrarlo. Espera al marcador final de cada prompt antes de pasar al siguiente.

## Preparación (una sola vez, 5 min)
1. Crea una carpeta vacía `linkvault`, descomprime el kit dentro (incluye `.claude/` y `.github/` ocultos).
2. En Claude Code UI: **Open folder → linkvault**.
3. Pega:

```
Ejecuta bash scripts/setup.sh y muéstrame la salida. Si openspec init pide elegir herramienta, elige Claude Code.
Luego verifica con /agents que existen los 8 agentes del proyecto y con /hooks que hay un PreToolUse y un Stop.
```
Marcador esperado: `✓ listo`.

4. Opcional, si tienes Ollama instalado (evita gastar API): `ollama pull qwen2.5:7b` en tu terminal. Si no, crea `.env` con `OPENROUTER_API_KEY=...`.
5. Si vas a publicar PRs: `gh auth login` en tu terminal y crea el remoto `origin`. Si no quieres PRs aún, añade `--no-ship` a cada `/lv:run`.

---

## Prompt 0 — Contexto
```
/lv:context
```
Lee la respuesta una vez. Si el punto 5 lista ambigüedades de fondo, resuélvelas con un mensaje corto ("Decide X así: ...") y pide que lo registre en `docs/adr/ADR-017.md`. Luego `/clear`.

## Prompts 1–15 — Un change por mensaje

Antes de cada uno: `/clear` (contexto limpio). El comando lee el manifiesto, salta lo archivado y ejecuta las 9 etapas sin preguntar.

| # | Prompt | Qué obtienes al terminar |
|---|---|---|
| 1 | `/lv:run bootstrap-monorepo` | Nx con api, worker, web, shared, ai; compose con Mongo rs0; CI; `/health` |
| 2 | `/lv:run ai-gateway-core` | `runTask`, mock 3 modos, Ollama, OpenRouter, ledger, PII redactor |
| 3 | `/lv:run ai-eval-harness` | golden set (busca vacantes reales y las anonimiza) + corredor de evals |
| 4 | `/lv:run auth-users` | registro/login con refresh cookie rotativa, perfil con consentimiento IA |
| 5 | `/lv:run groups` | grupos, código de invitación, roles |
| 6 | `/lv:run job-links` | guardar link, importar chat de WhatsApp, dedupe por plataforma, "ya está en Grupo X" |
| 7 | `/lv:run link-enrichment` | worker con cadena de extractores, preview con procedencia por campo, SSE |
| 8 | `/lv:run applications-tracking` | kanban, timeline, visibilidad privada por defecto — **MVP demostrable** |
| 9 | `/lv:run group-comments` | comentarios planos por link |
| 10 | `/lv:run public-preview-share` | `/p/:slug` con OG tags y CTA |
| 11 | `/lv:run cv-upload-extract` | subir CV, extracción de texto |
| 12 | `/lv:run cv-match-suggestions` | MatchReport con evidencia, evaluator-optimizer, badge de fit, feedback |
| 13 | `/lv:run study-roadmap` | roadmap con catálogo curado |
| 14 | `/lv:run ai-byok` | claves propias cifradas, proveedores frontera |
| 15 | `/lv:run deploy-prod` | compose prod + Traefik, CD, alternativas |

Marcador esperado en todos: `RUN: OK <change>`. Si no recuerdas cuál sigue: `/lv:run next`.

---

## Cuando un prompt termina en `RUN: FALLO <etapa> (motivo)`

Elige el mensaje según la etapa:

| Etapa | Mensaje a pegar |
|---|---|
| review / debate (fondo: ADR contradicho, decisión no tomada) | `Decide así: <tu decisión en una línea>. Regístralo como ADR nuevo y continúa con /lv:run <change>` |
| apply (se atascó en un error) | `Explica el bloqueo en 5 líneas sin tocar código. Luego propón 2 salidas.` → eliges → `Aplica la opción N y continúa con /lv:run <change>` |
| fixtures (sin proveedor) | `/lv:fixtures openrouter` (o arranca Ollama y `/lv:fixtures ollama`), luego `/lv:run <change>` |
| qa | `/lv:qa <change>` (repite el bucle), luego `/lv:run <change>` |
| smoke | `Lee reports/smoke/<change>/REPORT.md, corrige la causa raíz del paso fallido y vuelve a correr /lv:smoke <change>`, luego `/lv:run <change>` |
| ship | `gh auth status` en tu terminal; si el problema es remoto, `/lv:ship <change>`; si no quieres PR: `/lv:archive <change>` y sigue |

Cada etapa es idempotente: `/lv:run <change>` retoma desde la primera que falta.

---

## Prompts de control (cuando quieras)
```
/lv:status                       ← dónde estás, % de tareas, tests
```
```
Muéstrame reports/smoke/<change>/REPORT.md resumido en 8 líneas con las capturas.
```
```
Corre pnpm nx run-many -t serve --parallel=3 y dame las URLs para probarlo yo en el navegador. Cuando te diga "listo", apaga los procesos.
```
```
Compara el coste y la schema_validity_rate de ollama vs openrouter en el eval harness para extract-job y recomienda el AI_CHAIN de staging.
```

---

## Ajustes al kit sin salir de la UI
- Cambiar el alcance de un change: `Edita openspec-changes.yaml: en <change> añade/quita "..." y explica el impacto en ADRs.`
- Añadir una regla permanente: escribe `# <regla>` como mensaje (Claude Code la agrega a CLAUDE.md).
- Si los comandos `/opsx:*` no existen en tu instalación: `Reemplaza en .claude/commands/lv/*.md los comandos /opsx:* por los que registró openspec init en .claude/commands/` (una vez).

## Ritmo sugerido
- Sesión 1: preparación + prompts 0–1.
- Sesión 2: prompts 2–3 (el módulo IA; revisa el golden set antes de seguir).
- Sesiones 3–5: prompts 4–8 → demo del MVP con `AI_CHAIN=ollama`.
- Después: 9–15 a tu ritmo. Lee al menos los PR de 6, 7 y 12.
