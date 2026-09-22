## Context

Ver `proposal.md` (Why / What). El monorepo ya tiene Mongo + outbox + BullMQ, `libs/ai` con `runTask`/PII/ledger, CV,
roadmaps, comentarios y borrado de cuenta. ADR-006 reservó Meilisearch en F2; ADR-016 aplazó embeddings (C18). Este
change implementa búsqueda híbrida y **enmienda** ADR-016 con ADR-036. No toca discovery F3 ni extensión.

## Goals / Non-Goals

**Goals**

- Meilisearch como motor primario (perfil compose `search`).
- Índice de todo el contenido accesible por la persona, con ACL en query.
- Embeddings vía `EmbeddingProvider` en `libs/ai` + mock; híbrido full-text + vector.
- Sync at-least-once por outbox (ADR-009); purga en borrado de cuenta.
- API + SPA; ADR-036 + fila 18 en design-v0.2 §6.

**Non-Goals**

- B10 digest; discovery F3; browser extension; caché semántico de respuestas LLM.
- Mongo text index como primario.
- Streaming estructurado (sigue aplazado salvo lo ya decidido en otros changes).
- Multi-región / Meili en cluster HA en este change.
- Toggle de modo hybrid/fulltext/semantic en SPA V0; filtros UI de modality/status (API puede aceptar más en tests).
- OpenRouter embed como dependencia V0 (opcional detrás de `AI_EMBED_CHAIN`; V0 = mock + ollama).

## Decisions

### D1 — Meilisearch como único motor primario (perfil `search`) + FEATURE_SEARCH

Compose: servicio `meilisearch` bajo **profile `search`**, análogo a `ai-local`. No arranca en `docker compose up`
por defecto. Variables: `MEILI_HOST`, `MEILI_MASTER_KEY`, `FEATURE_SEARCH=true|false`.

**Comportamiento del flag (C3):**

| `FEATURE_SEARCH` | Emitters outbox Search* | Consumer `search-index` | `GET /api/search` |
|---|---|---|---|
| `true` + Meili OK | Escriben upsert/delete | Indexan | 200 / degradación documentada |
| `true` + Meili down | Escriben (outbox retiene) | Reintentan | `503 search_unavailable` |
| `false` | **NO** escriben SearchUpsert/Delete | Ack **no-op** si flag false **o** Meili no configurado | `503 search_unavailable` |

Meili es **solo red interna** (compose/network privada); no exponer master key ni puerto a Internet — RUNBOOK (C10).

**Alternativa descartada:** Atlas Search / índice de texto Mongo como primario — contradice la decisión humana y
ADR-006 F2.

### D2 — Un índice unificado `lv_content` con `docType`

Un solo índice Meilisearch `lv_content` con documentos discriminados por `docType`:
`job_preview | application | group_comment | group_link_note | cv | roadmap`.

Campos comunes (filterable/sortable): `id` (primary key string estable), `docType`, `ownerUserId`, `groupIds` (array),
`visibilityScope` (`owner` | `group` | `owner_and_groups`), `updatedAt`, `embeddingStatus`, `embedModelId`,
`embeddingDim` (C6).

Campos searchable por tipo (ejemplos):

| docType | searchable (aprox.) |
|---|---|
| job_preview | title, company, description, skills, location, modality, salaryText |
| application | status, stageLabel, notes, linkTitle? |
| group_comment | body |
| group_link_note | note |
| cv | text, skills |
| roadmap | title, stepsText / skills |

Displayed: ids de navegación (`linkId`, `groupId`, `applicationId`, `cvId`, `roadmapId`, …) + snippet fields.

**Alternativa descartada:** un índice por tipo — más ops y N consultas hybrid; ACL igual de compleja.

### D3 — Vectores **dentro de Meilisearch** (no store separado)

Cada documento lleva un `_vectors` / embedder field nativo de Meilisearch (hybrid search del producto). Dimensión fija
alineada al modelo (p. ej. 768 para `nomic-embed-text` u otro documentado en D5). La fusión hybrid la hace Meili
(`hybrid` query) con `semanticRatio` configurable por env (`SEARCH_SEMANTIC_RATIO`, default ~0.5).

**Justificación:** un solo servicio en el profile `search`; menos sync dual; ADR-006 ya eligió Meili. Un Qdrant/pgvector
añadiría compose, ACL duplicada y dual-write de vectores.

**Alternativa descartada:** store vectorial aparte — solo si el debate demuestra límites duros de Meili (dimensión,
filtro ACL + hybrid) que no quepan en V0.

### D4 — Sync por outbox + workers (no hooks síncronos a Meili)

En la txn del agregado: escribir evento `SearchUpsert.v1` / `SearchDelete.v1` (nombres finales en `libs/shared/events`)
con payload mínimo (`docType`, `aggregateId`, `reason`) **solo si `FEATURE_SEARCH=true`** (D1). Relay → cola
`search-index`. Worker:

1. Si `FEATURE_SEARCH=false` o Meili no configurado → **ack no-op**.
2. Carga el agregado desde Mongo (fuente de verdad).
3. Si no existe → delete en Meili (idempotente).
4. Si existe → construye documento + ACL fields **recalculando `groupIds` / `visibilityScope` desde Mongo** (no confiar
   en el payload del evento); pide embedding (D5); upsert Meili.

**Emitters obligatorios (C1)** — además de create/update de agregados indexables:

- share `GroupLink` (link entra a grupo → upsert preview/nota con nuevos `groupIds`);
- unshare (sale del grupo → upsert recalculado o delete del doc de grupo según tipo);
- delete `GroupLink`;
- hooks de borrado de grupo (`GroupDeletionHooks`).

Tras unshare, el hit de grupo **desaparece** para miembros; tras share, **aparece**. Verify en tasks 5.2.

**`jobId` (C9):** hash determinista del contenido indexable canónico (campos searchable + ACL materializados +
`docType` + `aggregateId`), p. ej. `search:{docType}:{aggregateId}:{contentHash}` — colapsa ráfagas con el mismo
contenido; cambio de texto/ACL → nuevo jobId. Consumer sigue idempotente por primary key Meili.

**Alternativa descartada:** llamar Meili en el request HTTP — dual-write y latencia/PII path en api.

### D5 — Embeddings: `embedTexts` (no `runTask`)

**Lock de entrada (C4):**

- `runTask(task, input, ctx)` = **solo** LLM / salidas estructuradas (prompts, repair, degradación RuleBasedMatcher).
- **`embedTexts(texts, ctx)`** = **única** entrada de aplicación para embeddings en `libs/ai` (indexación y query).
  Misma familia de guards: consentimiento, PII, cuotas, circuit breaker, ledger; cadena **`AI_EMBED_CHAIN`**
  (separada de `AI_CHAIN`).

Puerto `EmbeddingProvider` en `libs/ai/domain/ports`. SDKs solo en `infrastructure/providers`.

Cadena V0: `mock` (CI) → `ollama` (`nomic-embed-text` / `AI_EMBED_MODEL`). Adaptador OpenRouter **MAY** existir en el
change pero es **opcional** y solo si aparece en `AI_EMBED_CHAIN` (S14 / business: remoto diferible; V0 = mock+ollama).

**Consentimiento (C5):** embeds de indexación en background usan el **consentimiento del dueño del agregado**
(`ownerUserId`), no el del worker system. Query embed: sensibilidad **`personal`** (C11) — PII redactor si provider
`external`.

**Modelo / dim (C6):** documentos llevan `embedModelId` + `embeddingDim`; si cambia el modelo activo, job/comando de
**re-embed** (parte del backfill o task dedicada) regenera vectores; docs con dim distinta → `embeddingStatus` no
`ready` para hybrid hasta re-embed.

Mock: vector determinista por hash del input canónico; dimensión fija documentada.

Si embed falla: indexar sin vector (`embeddingStatus=failed|missing`); query hybrid degrada (spec).

### D6 — ACL en filtro Meili (server-side)

Al consultar, api construye filtro **solo en servidor** (C14 — `visibilityScope` en rama de grupo):

```
(ownerUserId = <me> AND visibilityScope IN [owner, owner_and_groups])
OR (
  groupIds IN [<mis groupIds>]
  AND visibilityScope IN [group, owner_and_groups]
  AND docType IN [job_preview, group_comment, group_link_note]
)
```

Más restricciones por tipo: `cv` y `roadmap` **solo** `ownerUserId = me` (aunque alguien meta groupIds a mano en el
doc, el filter de query lo impone). El cliente NO puede ampliar alcance.

Membership: leer grupos del usuario (caché corta Redis opcional; V0 puede ser Mongo).

### D7 — API y ranking (V0)

- Verbo: **`GET /api/search`** únicamente (C7).
- Query: `q`, `mode=hybrid|fulltext|semantic` (default `hybrid`; **API** lo mantiene para tests/debug), `docType`,
  `groupId`, `limit`, `offset`.
- `q` vacío o solo espacios → **`400` `empty_query`** (C7).
- `limit` > 50 → **clamp a 50** (no 400) (C7).
- Hybrid: Meili hybrid + `semanticRatio`; fulltext/semantic fuerzan un lado.
- Respuesta: `{ hits[], degraded?, degradeReason?, limit, offset, estimatedTotal? }`.
- `503 search_unavailable` si Meili down o `FEATURE_SEARCH=false`; **no** fingir primario con Mongo.

Filtros `modality` / `status` **fuera de V0 UI** (S12); la API V0 **no** los requiere (MAY ignorarlos si llegan).

### D8 — SPA `/buscar` (V0 UI)

Feature lazy, nav item, i18n ES/EN, aviso `degraded`, navegación a recursos existentes.

**V0 UI (business):**

- Modo **siempre hybrid** (default API); **NO** hay toggle de modo en la SPA (S13).
- Filtros UI: **`docType` + `groupId` únicamente** — no modality ni status (S12).

### D9 — Purga en borrado de cuenta / grupos (C2 / C2-ord)

Cuando **`FEATURE_SEARCH=true`**, el orden **MUST** ser:

1. **Health + purge Meili primero** (antes de abrir/commit la cascada Mongo destructiva): delete-by-filter
   `ownerUserId = <userId>` y, si la cascada va a borrar grupos, los `groupIds` afectados (calculados en lectura previa).
2. Si Meili es inalcanzable o el delete-by-filter falla → **`503` `search_purge_failed`**; **cuenta y datos Mongo
   intactos** (ningún commit de borrado); **NO** `204`.
3. Solo tras purge Meili OK → ejecutar la cascada Mongo (txn) y devolver `204`.
4. Outbox `SearchDelete` / consumers = red de seguridad para jobs en vuelo (ack si user/agregado gone), no sustituyen
   el purge pre-commit.

Cuando **`FEATURE_SEARCH=false`**: **omitir** purge Meili; cascada Mongo como hoy.

`GroupDeletionHooks` (borrar grupo, no cuenta): delete-by-filter del `groupId` **antes** de commit destructivo del
grupo cuando search esté on (misma familia).

Verify: purge falla → Ana sigue existiendo; tras `204`, Luis no encuentra el comentario de Ana (task 7.1).

### D10 — ADR-036 (outline)

Ver `docs/adr/ADR-036.md`. Enmienda ADR-016: embeddings **permitidos** para search F2 (y dejan la puerta a caché
semántico futuro sin implementarlo). Streaming estructurado sigue aplazado. Entrada app: `embedTexts` (no `runTask`).

### D11 — Env vars (resumen)

| Variable | Uso |
|---|---|
| `FEATURE_SEARCH` | habilita emitters + index consumer + rutas útiles; `false` → D1 |
| `MEILI_HOST` | URL Meili (interna) |
| `MEILI_MASTER_KEY` | auth Meili |
| `MEILI_INDEX` | default `lv_content` |
| `AI_EMBED_CHAIN` | V0: `mock` / `ollama`; remoto opcional |
| `AI_EMBED_MODEL` | modelo embedding |
| `SEARCH_SEMANTIC_RATIO` | 0..1 hybrid |
| `SEARCH_BACKFILL_RATE` | límite de rate del backfill (default conservador local) (C8) |

### D12 — Tests mínimos obligatorios (C12)

Al menos cubrir en apply:

1. ACL: Ana no ve comentario de grupo ajeno; CV ajeno nunca.
2. Share → hit aparece; unshare → hit desaparece (tras worker).
3. `FEATURE_SEARCH=false` → 0 filas Search* en outbox al mutar; query `503`.
4. Account delete + search on: purge Meili antes de 204; Luis no halla comentario de Ana; Meili down → 503
   `search_purge_failed`.
5. `q` vacío → 400; `limit=999` → clamp 50.
6. Embed vía `embedTexts` (no SDK en search); PII a external; ledger.
7. Degradación hybrid sin vectores → `degraded: true`.

## Risks / Trade-offs

| Riesgo | Mitigación |
|---|---|
| Índice desfasado tras fallo Meili | Outbox + reintentos + backfill documentado |
| Fuga ACL por mal filtro | Tests de autorización obligatorios; filtros solo server-side + visibilityScope |
| Costo/latencia de embed en index masivo | Batch embed; degradación sin vector; cuota ledger; rate backfill |
| Dimensión / modelo cambia | `embedModelId` + `embeddingDim` + re-embed |
| Master key / Meili expuesto | Solo red interna; RUNBOOK; no en repo |
| Profile olvidado en demos | README/RUNBOOK: `compose --profile search` |
| Purge Meili bloquea delete account | Aceptado: mejor 503 que 204 con residuo buscable |

## Migration Plan

1. Añadir Meili al compose (profile) + env example; RUNBOOK red interna.
2. Crear índice/settings (searchable/filterable/sortable + embedder).
3. `EmbeddingProvider` + `embedTexts` + mock (+ ollama; OpenRouter opcional); wire en worker.
4. Eventos outbox + consumer upsert/delete; emitters incl. share/unshare/group delete; flag gate.
5. API `GET /api/search` + tests ACL.
6. SPA `/buscar` (hybrid fixed; filtros docType/groupId).
7. Cascada borrado con purge Meili pre-204; backfill rate-limited; ADR-036 + fila 18; `nx affected`.

Rollback: `FEATURE_SEARCH=false`; índice descartable (Mongo sigue siendo fuente de verdad).

## Open Questions

Ninguna abierta tras debate reflect. Items previos (nombres de evento, `semanticRatio` default ~0.5, verbo GET,
`empty_query` 400, clamp 50, `embedTexts` vs `runTask`) quedan **cerrados** en D1–D12 / tabla reflect.

## Debate reflect (critic / business)

| Hallazgo | Origen | Decisión | Motivo |
|---|---|---|---|
| C1 ACL tras share/unshare | critic P0 | **aceptado** | Emitters share/unshare/delete GroupLink + group hooks; worker recalcula `groupIds` desde Mongo |
| C2 / C2-ord Meili purge vs commit Mongo | critic P0 | **aceptado (adaptado)** | Purge Meili **antes** del commit Mongo; fallo → 503 y cuenta intacta; solo entonces 204; flag false → skip |
| C3 FEATURE_SEARCH=false | critic P0 | **aceptado** | Emitters no escriben Search*; consumer ack no-op; query 503 |
| C4 embedTexts vs runTask | critic P0 | **aceptado** | `runTask` = LLM; `embedTexts` = única entrada embeddings (ADR-014/036 + CLAUDE) |
| C5 consent dueño en embed background | critic P1 | **aceptado** | Index embed usa consentimiento del `ownerUserId` |
| C6 dim + embedModelId + re-embed | critic P1 | **aceptado** | Campos en doc + job/backfill de re-embed |
| C7 GET + 400 empty_query + clamp 50 | critic P1 | **aceptado** | Verbo GET; vacío → 400; limit>50 → clamp |
| C8 backfill rate limit / default local | critic P1 | **aceptado** | `SEARCH_BACKFILL_RATE` + default conservador en local |
| C9 jobId = content hash | critic P1 | **aceptado** | `search:{docType}:{aggregateId}:{contentHash}` |
| C10 Meili solo interno RUNBOOK | critic P1 | **aceptado** | Documentar red interna; no exponer a Internet |
| C11 query embed como personal | critic P1 | **aceptado** | Sensibilidad `personal` en embed de `q` |
| C12 lista de tests | critic P1 | **aceptado** | D12 + verifies en tasks |
| C14 visibilityScope en rama grupo | critic P1 | **aceptado** | Filter grupo exige `visibilityScope IN [group, owner_and_groups]` |
| S12 filtros modality/status UI | business | **diferido (fuera V0 UI)** | SPA V0 solo docType + groupId |
| S13 mode toggle UI | business | **diferido (fuera V0 UI)** | SPA siempre hybrid; API conserva `mode` para tests |
| S14 OpenRouter embed remoto | business | **diferido** | MAY adapter opcional; V0 chain mock+ollama |
| S19–S23 | business | **rechazado** | Fuera de alcance / no aportan al problema V0 de “encontrar lo mío” |
