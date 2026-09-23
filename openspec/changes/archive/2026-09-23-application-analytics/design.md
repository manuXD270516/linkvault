## Context

Ver proposal.md. Reflect iter1: grupo OUT; dwell diferido V2; buckets alineados a ADR-024.

## Goals / Non-Goals

**Goals:** funnel personal on-read; conteos + stale accionable; SPA; fila 25; ADR-039.

**Non-Goals:** grupo; dwell; discovery; dual-write de métricas; cambiar ApplicationStale detector.

## Decisions

### D1 — Solo personal

Sin endpoints ni SPA de analytics de grupo en este change.

### D2 — Buckets (ADR-024)

Reusar `CLOSED_STATUSES` = `rejected | withdrawn | expired` y `isClosedStatus`.

| Campo | Fórmula |
|---|---|
| `byStatus` | conteo por cada status del enum |
| `closedCount` | suma de statuses en `CLOSED_STATUSES` |
| `acceptedCount` | status === `accepted` |
| `openCount` | total − closedCount − acceptedCount |

**Prohibido** llamar a `accepted` “cerrado” o reusar `isClosedStatus` para openCount.

### D3 — Stale

- Umbral: **10 días** (= `APPLICATION_STALE_AFTER_DAYS` / ApplicationStale).
- Elegibilidad analytics: no closed **y** `status !== 'accepted'` (intencional: distinto del
  detector de email que aún puede considerar `accepted` — documentado en ADR-039).
- Cap: **máx. 20** ítems, los de `statusChangedAt` más antiguos primero (más estancados).
- Shape: `{ applicationId, linkId, status, statusChangedAt }` (dueño = self; OK exponer id).

### D4 — API / empty

`GET /api/applications/analytics` → `200` siempre para el dueño; ceros + `stale: []` si vacío.
Sin dwell en el schema de este change.

### D5 — SPA

Ruta `/aplicaciones/insights` (o equivalente i18n). Conteos + lista stale → navegación al
board/detalle existente. Empty state honesto.

### D6 — Plan

Fila **25**. **ADR-039**.

## Risks / Trade-offs

- [Dashboard vacío] → empty state + CTA registrar.
- [Stale ≠ emails B4 en `accepted`] → ADR-039 explícito; no cambiar detector en este change.
- [Muchas apps] → cap 20 stale; agregación byStatus en una query acotada al userId.

## Migration Plan

Deploy. Rollback: ocultar ruta. Sin migración.

## Open Questions

Ninguna.
