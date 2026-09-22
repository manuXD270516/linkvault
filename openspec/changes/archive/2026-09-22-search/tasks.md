## 1. Docs and ADR

- [x] 1.1 [infra] Confirmar `docs/adr/ADR-036.md` (Accepted) con entrada `embedTexts` (no `runTask`), enmienda corta en `docs/adr/ADR-014.md`, fila 18 en `docs/design-v0.2.md` §6 + entrada `search` en `openspec-changes.yaml`; verify: `rg "embedTexts|ADR-036|search" docs/adr/ADR-014.md docs/adr/ADR-036.md docs/design-v0.2.md openspec-changes.yaml CLAUDE.md` muestra dual entry LLM vs embed.
- [x] 1.2 [infra] Actualizar RUNBOOK/README con `docker compose --profile search up`, variables `MEILI_*` / `FEATURE_SEARCH`, y nota **Meili solo red interna** (no exponer a Internet); verify: `rg "profile search|MEILI_HOST|red interna|internal" docs/RUNBOOK.md README.md`.

## 2. Compose and env

- [x] 2.1 [infra] Añadir servicio Meilisearch al `docker-compose.yml` bajo profile `search` (healthcheck, volumen, puerto en red compose); verify: `docker compose --profile search config` lista el servicio y sin profile no aparece.
- [x] 2.2 [infra] Extender `.env.example` con `FEATURE_SEARCH`, `MEILI_HOST`, `MEILI_MASTER_KEY`, `MEILI_INDEX`, `AI_EMBED_CHAIN`, `AI_EMBED_MODEL`, `SEARCH_SEMANTIC_RATIO`, `SEARCH_BACKFILL_RATE`; verify: `rg "MEILI_|AI_EMBED_|FEATURE_SEARCH|SEARCH_BACKFILL" .env.example` cubre D11.

## 3. Embeddings (libs/ai)

- [x] 3.1 [ai] Añadir puerto `EmbeddingProvider` + tipos de capacidades/dimensión en `libs/ai/domain`; verify: test unitario de tipos o compile del port; `nx run ai:typecheck` OK.
- [x] 3.2 [ai] Implementar `MockEmbeddingProvider` determinista (replay/synth) y registrar en la cadena `AI_EMBED_CHAIN`; verify: test Vitest “mismo input → mismo vector”.
- [x] 3.3 [ai] Implementar adaptador Ollama embeddings bajo `infrastructure/providers`; OpenRouter (u otro remoto) **opcional** solo si se añade a `AI_EMBED_CHAIN` (V0 default: mock+ollama); verify: lint `no-restricted-imports` y test de adapter Ollama con HTTP mock.
- [x] 3.4 [ai] Exponer **`embedTexts`** (única puerta app de embeddings; **no** vía `runTask`) con PII `personal`, consentimiento del dueño en indexación, ledger y breaker; verify: tests de redacción a external, consent owner, ledger en fallo/éxito, y que search no importa SDKs.

## 4. Shared events and Meili client

- [x] 4.1 [backend] Declarar eventos `SearchUpsert.v1` / `SearchDelete.v1` (zod + `jobId` = content hash) en `libs/shared` y registrar cola `search-index` en el outbox catalog; verify: test del schema + typecheck shared.
- [x] 4.2 [backend] Cliente Meilisearch (infrastructure) create-index/settings + upsert/delete/delete-by-filter por primary key; verify: test de integración contra Meili en compose profile o testcontainer/skip documentado.

## 5. Indexer workers

- [x] 5.1 [backend] Consumer `search-index`: si `FEATURE_SEARCH=false` o Meili no configurado → ack no-op; else carga agregado, recalcula ACL (`groupIds`/`visibilityScope`) desde Mongo, embed opcional vía `embedTexts`, upsert/delete idempotente + `embedModelId`/`embeddingDim`; verify: tests repos in-memory + Meili fake.
- [x] 5.2 [backend] Emitters outbox **solo si `FEATURE_SEARCH=true`** desde: preview create/update, application, comment, note, cv, roadmap, **share GroupLink**, **unshare**, **delete GroupLink**, **GroupDeletionHooks** (sin llamar Meili en la txn). Checklist verify:
  - [x] mutación con flag on → fila Search* en `outbox_events`
  - [x] mutación con flag off → **0** filas Search* en outbox
  - [x] share → tras worker, miembro ve hit; unshare → hit desaparece
- [x] 5.3 [backend] Comando/job de backfill + re-embed (rate `SEARCH_BACKFILL_RATE`, default local conservador); verify: dry-run o test que encola N upserts desde fixtures Mongo sin saturar.

## 6. HTTP search API

- [x] 6.1 [backend] `GET /api/search` autenticado: ACL server-side con `visibilityScope` en rama grupo, `mode` opcional (default hybrid), filtros `docType`/`groupId`, `q` vacío → `400 empty_query`, `limit`>50 → clamp 50, `FEATURE_SEARCH=false` o Meili down → `503 search_unavailable`; verify: tests A/B + grupo cruzado (sin fugas).
- [x] 6.2 [backend] Degradación `degraded` cuando faltan embeddings; query embed vía `embedTexts` con sensibilidad `personal`; verify: test embed chain mock fallido → fulltext + flag.

## 7. Account deletion cascade

- [x] 7.1 [backend] Con `FEATURE_SEARCH=true`: delete-by-filter Meili **antes** del commit Mongo; Meili down → `503 search_purge_failed` y cuenta intacta (sin 204). Con flag false: skip Meili. Verify: (a) Meili down → Ana sigue en Mongo; (b) tras `204`, Luis **no** encuentra el comentario de Ana; (c) flag off no llama Meili.

## 8. Web SPA

- [x] 8.1 [frontend] Ruta lazy `/buscar`, nav, store/servicio HTTP search (siempre hybrid; **sin** query `mode` desde UI); verify: test de ruta/guard o harness mínimo.
- [x] 8.2 [frontend] UI resultados tipados, filtros **solo** `docType` + `groupId` (no modality/status, no toggle de modo), vacío/error/`degraded`, i18n ES/EN; verify: strings en `messages.*.xlf` y test de render básico.

## 9. Quality gate

- [x] 9.1 [infra] `pnpm nx affected -t lint,typecheck,test` en verde con `AI_CHAIN=mock`, `AI_EMBED_CHAIN=mock`; verify: comando exit 0 en la rama del change. Cubrir al menos la lista D12 (ACL, share/unshare, flag off outbox=0, purge pre-204, empty_query, clamp, embedTexts, degraded).
