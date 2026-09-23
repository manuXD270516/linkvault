## Why

El tracker ya registra estados, pero el usuario no ve un resumen accionable: cómo se reparte
el embudo y qué está parado ≥10 días (F3 `analytics`). Tras §6 (hasta extensión), el valor es
**insights de lectura** sobre datos existentes — sin discovery.

## What Changes

- **Funnel personal (MVP):** `GET /api/applications/analytics` + SPA insights con:
  - conteos por `status`;
  - `openCount` / `closedCount` / `acceptedCount` (vocabulario ADR-024 / `CLOSED_STATUSES`);
  - lista corta de estancadas (máx. 20) con umbral 10 días (`APPLICATION_STALE_AFTER_DAYS`) y
    elegibilidad `!isClosedStatus && status !== 'accepted'`.
- Fila **25** en `docs/design-v0.2.md` §6 + `openspec-changes.yaml`.
- **ADR-039:** on-read, buckets, stale.

**Fuera de alcance (este change):**

- Funnel / analytics de **grupo** (change propio si hay demanda).
- **Dwell** / tiempo medio en etapa (`application_events`) — V2 diferido.
- Discovery, export, time-series, charts pesados, métricas por `stageLabel`, escribir fitScore.

## Capabilities

### New Capabilities

- `applications/analytics`: API funnel personal (conteos + stale).
- `web/analytics`: SPA insights personal (i18n, empty state, navegación a estancadas).

### Modified Capabilities

- (ninguno)

## Impact

- **Código:** applications query, shared schemas, SPA route insights.
- **ADRs:** ADR-039.
- **Agentes:** backend-dev, frontend-dev.
- **Dependencias:** applications-tracking; umbral stale alineado a notificaciones (solo días).
