## 1. Docs and ADR

- [ ] 1.1 [infra] `docs/adr/ADR-037.md` + enmienda ADR-035 (ASN worker auto-expire con claim→add→confirm como stale); fila **19** §6; `openspec-changes.yaml`; verify: `rg "job-link-freshness|ADR-037|not_found|statusGroupNotifyPending|auto-expire" docs/adr docs/design-v0.2.md openspec-changes.yaml`.

- [ ] 1.2 [infra] RUNBOOK knobs frescura; verify: `rg "FEATURE_LINK_FRESHNESS|LINK_FRESHNESS" docs/RUNBOOK.md`.

## 2. Shared contracts

- [ ] 2.1 [backend] Schemas link: `closedAt?`, `closedReason?`; `lastFreshnessCheckAt`; verify: zod + typecheck.

- [ ] 2.2 [backend] Motivo `not_found` en PageFetchResult + `lastEnrichmentError` y en `NON_RETRYABLE_ENRICHMENT_REASONS`; verify: 404/410→`not_found`, 500→`http_error`, `isRetryableEnrichmentReason('not_found')===false`.

## 3. Env and worker scheduler

- [ ] 3.1 [infra] `.env.example`: flag false, intervalo 7, batch limit; verify: local-environment.

- [ ] 3.2 [backend] Detector: selector 1 abierta (cadencia **OR** `expiresAt`); selector 2 cascada (`closedAt` + apps abiertas **o** group auto-expired sin ASN confirmado, incl. post-release); **priorizar** cascada en el batch; flag off no-op; verify: escenarios elegibilidad + cascada + “release no pierde elegibilidad”.

## 4. Cierre, re-check y fetcher

- [ ] 4.1 [backend] Cerrar vacante idempotente + SSE summary con `closedAt`; verify: calendario sin scrape + notifier.

- [ ] 4.2 [backend] Encolar `fresh:{linkId}:{bucket}` con `bucket=floor(utcDay/INTERVAL)`, `previewVersion`, `triggeredBy: freshness`; no-scrapeables aplazan; verify: test igualdad de bucket + jobId 3 segmentos.

- [ ] 4.3 [backend] Enrich freshness: `not_found` | (`isJobPosting false` sin JSON-LD JobPosting) → cerrar; http_error/429/login-wall+JobPosting no; primer enrich `not_found`→failed non-retryable; verify: tests.

## 5. Auto-expire + ASN claim + search

- [ ] 5.1 [backend] Puerto expire en worker: abiertas→`expired` idempotente; reentrada si link ya `closedAt` + app abierta; ASN claim→`Queue.add`→confirm (`actorUserId`=owner, sin outbox); add falla→release y reencolable; Search upsert app si flag; verify: Ana/Luis/Marta/accepted + “add falla → pending” + sin doble evento.

- [ ] 5.2 [backend] Wire cierre→puerto + Search upsert `job_preview.closedAt` si `FEATURE_SEARCH`; verify: cascada + fingerprint.

## 6. Frontend

- [ ] 6.1 [frontend] Badge “oferta cerrada”, i18n, preview visible, SSE refresca `closedAt`; verify: harness + xlf.

- [ ] 6.2 [frontend] Tipado `closedAt`/`closedReason`; verify: mapper/store.

## 7. Verify

- [ ] 7.1 [infra] `pnpm nx affected --base=main --head=HEAD --targets="lint,typecheck,test" --parallel=3` en verde.
