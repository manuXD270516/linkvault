## Context

Ver proposal.md. Reflect: `expiresAt` date-only; search escribe `closedAt: null` al reopen
(clear Meili merge); outbox como preview; `lastFreshnessCheckAt` al reopen.

## Goals / Non-Goals

**Goals:** reopen limpia marcador + SSE + search; calendar/`expiresAt` date-only; ACL
legible; SPA; fila 27; ADR-041.

**Non-Goals:** bulk apps; undo notify; discovery.

## Decisions

### D1 — Endpoint

`POST /api/links/:id/reopen`. Body opcional:
`{ expiresAt?: string | null }` donde string es **`YYYY-MM-DD`** (mismo contrato que
`preview.expiresAt`) o `null` para quitar caducidad.

Idempotente si ya abierto: `200` **sin mutar** (incluso si `expiresAt` pasado).

### D2 — Efectos (orden)

1. Validar ACL `requireReadableLink`.
2. Si cerrado: validar D3; txn Mongo `$unset closedAt/closedReason`, set `expiresAt` si body,
   set `lastFreshnessCheckAt = now` (retrasa elegibilidad de recheck).
3. Si body toca `expiresAt`: procedencia **manual** (mismo path que PATCH preview).
4. Announce SSE **después** del write (summary sin `closedAt`).
5. SearchUpsert vía **outbox/`SearchFacade`** como PATCH preview; fingerprint
   `job_preview:${id}:reopen:${iso}`. Loader: si Mongo no tiene `closedAt` → escribir
   **`closedAt: null`** (clear Meili merge, igual que salary ADR-040). Fake Meili: `IS NULL`
   trata `null` y `undefined` como ausente.

### D3 — Calendar / expiresAt

Validación **solo si había `closedAt`**. Si `closedReason === 'calendar'` **o**
`expiresAt` resultante (día UTC) &lt; hoy: exigir body `expiresAt` futuro o `null`; si no →
`400` nombrando `expiresAt`.

### D4 — Apps

No bulk reopen `expired`. Copy UI honesta.

### D5 — ACL / UI copy

Quien puede **ver/editar preview** (legible). Unificar wording SPA.

### D6 — Race recheck in-flight

Aceptado con mitigación: `lastFreshnessCheckAt = now` en reopen. Un job enrich ya en vuelo
**MAY** volver a cerrar; ADR-041 lo documenta. No bloquear MVP con claim cross-process.

### D7 — Plan

Fila **27**. **ADR-041**.

## Risks / Trade-offs

- [Job enrich in-flight] → D6 + copy.
- [Apps expired] → D4.

## Migration Plan

Deploy. Rollback: ocultar botón.

## Open Questions

Ninguna.
