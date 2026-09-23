## Context

Enrichment ya lee páginas, guarda `expiresAt` y mergea por procedencia (ADR-010); applications ya
tiene `expired` y transiciones libres (ADR-024); notifications ya fan-out de estado con
`visibility=group` y stale **sin** outbox en worker (ADR-035). G2 quedó fuera de
`link-enrichment`. Ver proposal.md.

**Reflect (iteración 1–3):** P0 `not_found` + ASN worker + claim; P0 selector cascada pendiente
(D3b); P1 calendario urgente, non-retryable, bucket, search `closedAt`, reentrada.

## Goals / Non-Goals

**Goals:**
- Detector en worker (cron/repeatable) con lease, batch limit y flag.
- Dos vías de cierre: calendario (`expiresAt`) y relectura inequívoca.
- Reuso del pipeline enrich; cierre no destruye preview útil.
- Auto-expire de postulaciones abiertas (no `accepted` / no cierres previos).
- Fan-out de estado de grupo al auto-expire (mismo tipo ASN, vía worker como stale).
- Señal en contrato + badge SPA + aviso realtime al cerrar.
- Search upsert cuando `FEATURE_SEARCH` (closedAt + status expired).

**Non-Goals:**
- Outbox desde worker; canal notify dedicado “vacante cerró”.
- Reabrir vacante a nivel link; scrapear bolsas prohibidas.
- B9r filtros search; B10 digest; cambiar golden extract-job en masa.
- Campo `actor` en historial HTTP de applications (V0 sin actor; ASN usa dueño).

## Decisions

### D1 — Cron en worker, sin outbox (patrón stale)

Repeatable BullMQ en `apps/worker` (como `ApplicationStale`). El worker **no** escribe
`outbox_events`. Cada tick tiene **dos** selectores (comparten `LINK_FRESHNESS_BATCH_LIMIT` o
cupos documentados en apply):

1. **Freshness abierta** (D3): links no cerrados elegibles → calendario / scrape / re-check.
2. **Cascada pendiente** (D3b): links ya con `closedAt` con apps abiertas **o** ASN de grupo aún
   no confirmado (claim vivo, lease vencido, o release tras add fallido — espejo stale) → **solo**
   `ExpireApplicationsForClosedLink` (sin scrape).

**Cupo:** cada tick **prioriza** el selector 2 (drena cascada primero) y el resto del
`LINK_FRESHNESS_BATCH_LIMIT` va al selector 1. Documentar en RUNBOOK.

*Descartado:* outbox desde api; un único selector que excluye cerrados (huérfanos ASN/expire).

### D2 — Campos `closedAt` + `closedReason` en JobLink

```
closedAt?: ISO datetime
closedReason?: 'calendar' | 'recheck'
```

No se añade `previewStatus: expired`. El cierre es ortogonal al estado de preview.

### D3 — Calendario primero, scrape después

Elegibilidad del detector (**OR**):
- cadencia: no cerrado y `lastFreshnessCheckAt` (o enrich) ≥ intervalo; **o**
- calendario urgente: no cerrado y `preview.expiresAt` (date) **<** hoy UTC (sin esperar la
  cadencia semanal).

Por link reclamado:
1. Si `expiresAt` < hoy UTC → cerrar `calendar`, D5/D8/D9, stop.
2. Si plataforma no scrapeable → aplazar `lastFreshnessCheckAt`, no cerrar, no fallar.
3. Else encolar re-check: `jobId` = `fresh:{linkId}:{bucket}` con
   `bucket = floor(utcDayNumber / LINK_FRESHNESS_INTERVAL_DAYS)` (entero; 3 segmentos BullMQ),
   payload `{ linkId, previewVersion, triggeredBy: 'freshness' }`. Cierre (D4) **solo** si
   `triggeredBy === 'freshness'`.

### D3b — Cascada pendiente (selector 2)

Elegibilidad: `closedAt` presente **y** (postulación abierta del link **o** postulación
`visibility=group` auto-expirada **sin** ASN confirmado — incluye claim liberado tras `Queue.add`
fallido, no solo docs de claim vivos). Acción: solo el puerto expire/ASN (D5), sin re-check.
Prioridad de cupo: ver D1.

### D4 — Señales de cierre por relectura (lista cerrada)

Fetcher: HTTP **404/410** → motivo `not_found` ≠ `http_error`. `not_found` ∈
`NON_RETRYABLE_ENRICHMENT_REASONS` (como `robots_disallowed` / `blocked` / `not_a_job`).

Cierra (solo freshness) si: `not_found`, **o** `isJobPosting === false` sin JSON-LD `JobPosting`
con preview previo con datos.

No cierra: `http_error`, 429, timeout, robots/blocked, degradación IA, `no_data`, ni
`isJobPosting: false` con JSON-LD JobPosting.

Al cerrar: conservar preview; no `failed` vacío; `closedAt`/`closedReason: recheck`; D5 + D8 + D9.

### D5 — Auto-expire + ASN con claim (patrón stale)

Puerto `ExpireApplicationsForClosedLink` en **worker** (repos + Queue/Search); freshness solo
inyecta el token (ADR-020).

**Reentrada:** si el link **ya** tiene `closedAt` pero quedan postulaciones abiertas (crash a
mitad), una pasada posterior del efecto **sí** las expira.

Por cada candidata abierta (`saved|interested|applied|in_process|offer`):
1. Transición atómica a `expired` + historial **solo si** aún abierta (idempotente).
2. Si `visibility=group`: **no** basta “cambió en este paso”. Tras expire (o si ya `expired` con
   notify pendiente), marcar claim/lease `statusGroupNotifyPending` (o equivalente) →
   `Queue.add(ApplicationStatusNotify.v1)` con `jobId` = `applicationStatusNotifyJobId(...)` →
   **confirm** al add OK. Si `Queue.add` falla → **release** del claim; la siguiente pasada
   reencola. `actorUserId` = dueño. Sin `outbox_events` (excepción ADR-035, junto a stale).
3. `FEATURE_SEARCH=true`: Search upsert `application` (status `expired`) y `job_preview` con
   campo indexado `closedAt` (ISO datetime; ausente si abierta); fingerprint incluye
   status/`closedAt`.

Historial HTTP V0: sin campo actor (from/to/at).

### D6 — Cadencia y knobs

- `FEATURE_LINK_FRESHNESS` default `false` en `.env.example`.
- `LINK_FRESHNESS_INTERVAL_DAYS=7`.
- `LINK_FRESHNESS_BATCH_LIMIT` (p. ej. 50).
- `lastFreshnessCheckAt` en JobLink.

### D7 — ADR-037

Marcador de cierre, `not_found`, señales D4, auto-expire + ASN worker (enmienda ADR-035), jobId
`fresh:…`, flag, search/SSE. Fila 19 design-v0.2 §6.

### D8 — Realtime al cerrar (P1#3)

Tras **cualquier** cierre (calendar o recheck), publicar por el canal Redis/SSE existente el summary
actualizado (mismo shape que `link.enriched`, incluyendo `closedAt`/`closedReason`), para que la
lista abierta refresque sin reload. Calendar (sin enrich) también publica.

### D9 — Search (P1#5)

Con `FEATURE_SEARCH=true`, el cierre y cada auto-expire SHALL dejar el índice eventualmente
consistente (job_preview con cierre; application con `expired`). Flag false → no-op search.

### D10 — SPA

Badge único “oferta cerrada” (no distinguir calendar/recheck en UI); i18n; preview visible; tipado
`closedAt`/`closedReason`.

## Risks / Trade-offs

- **Falsos positivos `isJobPosting: false`** → Mitigation: preview previo + ausencia JSON-LD
  JobPosting; fixture login-wall no cierra.
- **Carga a bolsas** → batch + 7d + cola por dominio; calendario evita scrape.
- **Accepted vs offer** → no tocar `accepted`; `offer` sí expira.
- **LinkedIn sin expiresAt** → no scrape; quedan abiertos (honestidad).
- **actorUserId = owner en ASN** → el dueño puede optarse con `notifyOwnActions=false`; el grupo
  sigue avisado. Trade-off aceptado vs inventar user sistema inválido en zod.

## Migration Plan

- Flag off → deploy → staging → prod.
- Links existentes: `closedAt` ausente = abierto.
- Rollback: flag `false`; cierres no se revierten solos.
- Fetcher: 404/410 pasan a `not_found` (cambio de contrato de motivo; primera lectura sigue
  `failed` con ese motivo, no cierra).

## Open Questions

Ninguna.
