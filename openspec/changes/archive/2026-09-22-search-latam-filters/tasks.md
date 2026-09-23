## 1. Docs

- [x] 1.1 [infra] Fila **20** `search-latam-filters` en `docs/design-v0.2.md` §6 + entrada en `openspec-changes.yaml`; verify: `rg "search-latam-filters" docs/design-v0.2.md openspec-changes.yaml`.

## 2. Shared + index

- [x] 2.1 [backend] Extender `searchQueryParamsSchema` con `modality` (jobModality), `applicationStatus` (APPLICATION_STATUSES), `salaryCurrency` (string 1–16 chars); verify: zod rejects invalid; comment mapeo applicationStatus→Meili status.

- [x] 2.2 [backend] FILTERABLE en **api y worker**: añadir `modality`, `status`, `salaryCurrency`; test/assert paridad de settings; verify: ambos clientes listan los tres.

- [x] 2.3 [backend] Loader `job_preview.salaryCurrency` desde `salary.currency` (omitir si null/vacío) + fingerprint/backfill; verify: test loader + escenario sin currency.

## 3. API

- [x] 3.1 [backend] Builder Meili AND (ACL + docType/groupId + modality + status←applicationStatus + salaryCurrency); empty `q` sigue `400`; verify: tests modality/status/currency + empty_query + ACL.

## 4. Frontend

- [x] 4.1 [frontend] Controles en `/buscar` (modality, applicationStatus, salaryCurrency BOB/USD) + i18n ES/EN + **D3b** (docType implícito / deshabilitar cruces); verify: harness envía params coherentes; `messages.en.xlf` targets.

- [x] 4.2 [frontend] Actualizar escenarios V0 que prohibían modality/status; smoke filtros; verify: test page.

## 5. Verify

- [x] 5.1 [infra] `pnpm nx run-many "-t=lint,typecheck,test" "-p=shared,api,worker,web" --parallel=3` en verde.
