## Why

Tras CV, match, roadmap y notificaciones, la persona ya tiene cientos de vacantes, notas, comentarios y CVs
dispersos entre grupos y lo privado, y **no puede encontrarlos** sin recorrer listas. `docs/design.md` F2 y ADR-006
reservaron Meilisearch para esa búsqueda; C18 / ADR-016 aplazaron embeddings al MVP. Es el momento de la **fila 18**
de `docs/design-v0.2.md` §6: búsqueda híbrida (full-text + semántica) sobre todo lo que la persona puede ver, con ACL
estricta, sin adelantar discovery F3 ni la extensión de navegador.

## What Changes

- **Meilisearch** como motor primario de búsqueda (no índice de texto de Mongo como primario), levantado en
  docker-compose bajo el **perfil `search`** (mismo patrón que `ai-local`).
- **Indexación** asíncrona vía outbox → BullMQ (ADR-009) de: previews de JobLink (title/company/description/skills/
  location/modality/salary), applications (status/stageLabel/notes), comentarios de grupo, notas de group-link, texto
  y skills extraídos del CV (solo dueño) y roadmaps (solo dueño).
- **ACL en consulta**: los resultados SOLO incluyen documentos que la persona autenticada puede ver (privado propio +
  contenido de grupos donde es miembro). CV y roadmaps nunca cruzan de dueño.
- **Embeddings reintroducidos** (`EmbeddingProvider` en `libs/ai`): enmienda a ADR-016 vía **ADR-036**; mock
  determinista + proveedores locales/remotos; PII y ledger alineados a ADR-014.
- **Búsqueda híbrida**: full-text Meilisearch + vector/semántica (fusión documentada en `design.md`).
- **API HTTP** de búsqueda autenticada (query, filtros, ranking) y **SPA** de búsqueda.
- **Cascada de borrado de cuenta**: con `FEATURE_SEARCH=true`, purge Meilisearch (delete-by-filter) **antes** del
  `204`; si Meili falla → `503 search_purge_failed`; con flag false se omite.
- **ADR-036** (Accepted) y fila 18 en design-v0.2 §6; entrada app embeddings = `embedTexts`.

**Fuera de alcance (explícito):**

- Digest semanal B10 (sigue diferido; depende de notificaciones pero no de search).
- **Discovery F3** (buscar vacantes en bolsas externas).
- Extensión de navegador F3.
- Caché semántico de respuestas IA (C18 lo menciona junto a embeddings; queda para un change posterior si hace falta).
- Índice de texto de Mongo (ni como primario ni como fallback). Si Meili cae, la query responde `503` sin otro motor.

## Capabilities

### New Capabilities

- `search/indexing`: contrato de qué se indexa, esquema de documentos Meili, eventos outbox → workers de indexación /
  borrado, idempotencia y backfill.
- `search/query`: API de búsqueda híbrida, filtros, ACL, ranking/fusión y degradación si falta Meili o embeddings.
- `ai/embeddings`: puerto `EmbeddingProvider`, entrada vía **`embedTexts`** (no `runTask`), mock, PII, ledger y cadena
  `AI_EMBED_CHAIN` (V0: mock / ollama; remoto opcional).
- `web/search`: pantalla SPA de búsqueda (ruta lazy, i18n ES/EN, resultados tipados, filtros `docType`/`groupId`; sin
  toggle de modo ni modality/status en V0).

### Modified Capabilities

- `platform/local-environment`: Meilisearch bajo perfil `search`; variables `MEILI_*` / feature flag en `.env.example`;
  no arranca en el compose por defecto.
- `platform/outbox`: tipos de evento de indexación/borrado de búsqueda con cola(s) propia(s), schema y `jobId`
  determinista.
- `users/account-deletion`: la cascada SHALL purgar documentos Meilisearch del usuario (y los que dependan de grupos
  borrados en la misma cascada).

## Impact

- **Infra**: servicio `meilisearch` en `docker-compose.yml` (profile `search`); posiblemente mención en compose prod /
  RUNBOOK (arranque opcional).
- **Código (en apply, no en este planning)**: módulo Nest `search` (api + worker), cliente Meili en infrastructure,
  `EmbeddingProvider` + mock en `libs/ai`, eventos en `libs/shared`, SPA feature `search`.
- **ADRs**: ADR-006 (cumple Meili F2); ADR-009 (outbox de index); ADR-014 (providers/PII/ledger); **ADR-016 enmendado por
  ADR-036** (embeddings permitidos para search F2).
- **Agentes**: devops, backend-dev, frontend-dev, ai-engineer.
- **Dependencias de producto**: asume auth, groups, links, enrichment, applications, comments, CV, roadmap y borrado de
  cuenta ya en main; no bloquea ni implementa B10 / discovery / extension.
