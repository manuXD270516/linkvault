## Why

Las vacantes guardadas envejecen en silencio: el preview se congela en el primer enriquecimiento y
`expiresAt` ya se guarda pero nadie lo actúa. `docs/design.md` G2 pide re-check semanal y estado
`EXPIRED`; `link-enrichment` lo dejó fuera a propósito. Tras search (fila 18), el vault ya es
encontrable — falta que lo encontrado siga siendo **cierto**.

## What Changes

- **Re-check periódico** en el worker: relee vacantes ya enriquecidas (cadencia semanal por defecto),
  reutilizando el pipeline de enrich (robots, cola por dominio, merge por procedencia, `previewVersion`).
- **Caducidad por calendario**: si `preview.expiresAt` ya pasó, el sistema marca la vacante como
  cerrada **sin** scrapear (barato y lícito también en bolsas que prohíben lectura).
- **Caducidad por relectura**: el fetcher distingue `not_found` (HTTP 404/410) de `http_error`; el
  re-check cierra con `not_found` o con `isJobPosting: false` **sin** JSON-LD `JobPosting`, sin
  pisar `manual`.
- **Postulaciones → `expired`**: abiertas (no `accepted`/cierres previos) pasan a `expired` con
  historial atómico; ASN de grupo desde **worker** (`Queue.add`, patrón stale; `actorUserId` =
  dueño). Enmienda ADR-035.
- **Realtime + search**: al cerrar, SSE con summary (`closedAt`); Search upsert si `FEATURE_SEARCH`.
- **Señal en API/SPA**: badge “oferta cerrada” (razón solo en API).
- **Feature flag** `FEATURE_LINK_FRESHNESS` (apagado = sin cron ni auto-expire).
- **ADR-037** + enmienda ADR-035; **fila 19** en `docs/design-v0.2.md` §6; `openspec-changes.yaml`.

**Fuera de alcance (explícito):**

- Digest B10; filtros LatAm `/buscar` (B9r); discovery F3; extensión; canal notify dedicado
  “vacante cerró”; reabrir vacante a nivel link; scrape contra robots; campo `actor` en historial
  HTTP.

## Capabilities

### New Capabilities

- `links/freshness`: política de elegibilidad, cadencia, señales de cierre (calendario + relectura),
  marcador de vacante cerrada, job/cron del worker, límites por ejecución e idempotencia.

### Modified Capabilities

- `links/enrichment`: re-check reutiliza enrich; motivo `not_found` (404/410); cierre freshness ≠
  `failed` vacío; `triggeredBy` / jobId `fresh:…`.
- `applications/tracking`: auto-expire idempotente al cerrar vacante; historial without new actor field.
- `notifications/dispatch`: ASN desde worker al auto-expire (excepción outbox, como stale).
- `platform/realtime`: publicar summary al cerrar (calendar o recheck).
- `search/indexing`: upsert job_preview/application tras cierre/expire si `FEATURE_SEARCH`.
- `web/links`: badge “oferta cerrada” (i18n ES/EN).
- `platform/local-environment`: knobs de frescura en `.env.example`.

## Impact

- **Worker**: detector freshness + expire port + ASN Queue.add + Search + SSE publish.
- **Fetcher / shared**: motivo `not_found`; `closedAt`/`closedReason` en schemas.
- **SPA**: badge; tipado closed*.
- **ADRs**: ADR-037; enmienda ADR-035; ADR-010/024.
- **Agentes**: backend-dev, frontend-dev; devops (env).
