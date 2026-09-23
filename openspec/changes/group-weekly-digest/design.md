## Context

B10 diferido hasta F2. Mailer + prefs + ledger existen (ADR-034/035). ADR-035 §1 decía “Digest fuera”;
este change lo introduce como **email de retención por grupo**. Relación real: colección
`group_links` con `sharedAt` (re-share no mueve `sharedAt`).

## Goals / Non-Goals

**Goals:**
- Email semanal por miembro×grupo con links nuevos (`group_links.sharedAt` en ventana).
- Opt-out; link a preferencias en el pie del email; `emailVerified`; vacío → no enviar.
- Idempotente por semana ISO + groupId + userId vía ledger existente.
- Flag `FEATURE_GROUP_DIGEST`.

**Non-Goals:**
- Push; digests diarios; IA; status changes en el mail; un mail multi-grupo consolidado (V1);
  opt-out por grupo (V1); horario por usuario (V2).

## Decisions

### D1 — Ventana = semana ISO anterior (cerrada)

Cron: **lunes** (default `0 14 * * 1` UTC, env `GROUP_DIGEST_CRON`).

Para el run del lunes que abre la semana ISO **W**:
- `weekKey` = **W−1** (año-semana ISO de la semana recién cerrada).
- Ventana = `[startUTC(W−1), startUTC(W))` (no rolling 7d desde “ahora”).
- Query: `group_links` donde `groupId=G` y `sharedAt ∈ ventana` (índice existente).
  **No** usar `JobLink.createdAt` / `savedAt`.

Si cero filas → no email y **no** escribir ledger “skipped-empty”.

### D2 — Destinatarios

Por cada grupo: cada miembro con `emailVerified=true` y `group_weekly_digest` no opt-out
(default ON). `notifyOwnActions` **no** aplica al digest.

Un email por `(userId, groupId, weekKey)`.

### D3 — Idempotencia (ledger existente)

Reusar `notification_deliveries`:
- `type = group_weekly_digest`
- `aggregateKey = ${weekKey}:${groupId}`
- `userId`, `channel = email`

Re-run de W−1 no reenvía si ya `completed`. Fallos liberan/reintentan como fan-out actual.
**No** marcar vacío como completed.

### D4 — Pipeline worker + single-flight

1. Job raíz BullMQ `digest:week:{weekKey}` con `jobId` fijo (un solo worker gana).
2. Paginar groupIds (puerto listado); por grupo query `sharedAt` en ventana.
3. Por miembro elegible: claim ledger → render → Mailer → complete.
4. Rate-limit envíos acorde al Mailer.

Sin outbox en api (no hay HTTP trigger).

### D5 — Preferencias + UI + pie del email

Tipo `group_weekly_digest` / campo API `groupWeeklyDigest`. SPA: switch.
**D5b (business V0):** el email SHALL incluir enlace a la pantalla de preferencias de
notificaciones de la SPA (opt-out sin depender solo de recordar la UI).

### D6 — Feature flag

`FEATURE_GROUP_DIGEST` en config worker (zod). false → no registrar cron / no-op.

### D7 — ADR / plan

Enmendar ADR-035: digest email de grupo OK; push de digest sigue fuera. Fila **21**.

### D8 — Contenido

Asunto: “Resumen semanal · {groupName}”. Hasta **10** títulos (más reciente `sharedAt` primero);
“y K más”; CTA “Ver grupo”; pie con link a preferencias. **Strip** de `note`/comentarios.
Locale: `outputLanguage` o ES. **Solo canal email** (excepción al SHALL dual email+push de
dispatch para este tipo).

## Risks / Trade-offs

- N grupos → N emails (V1 consolidar si hay quejas).
- UTC fijo.
- Mismo link ya avisado por `group_new_link` puede reaparecer en digest (retención intencional).

## Migration Plan

Flag off → deploy → on antes del lunes. Rollback: flag off.

## Open Questions

Ninguna bloqueante.
