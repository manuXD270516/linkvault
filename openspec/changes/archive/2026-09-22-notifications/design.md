## Context

Mailer (ADR-034), outbox en **api** (ADR-009) y `ApplicationStale.v1` (ADR-024, contrato) ya existen. Motivación:
proposal.md. Specs del change. Decisiones humanas + reflect iteración 1 (critic/business).

## Goals / Non-Goals

**Goals:**
- Despacho asíncrono con **idempotencia de entrega propia** (no solo `jobId` BullMQ).
- Preferencias opt-out + `notifyOwnActions` + alcance opcional de estado a un `groupId`.
- Productor real de stale en worker + aviso al dueño.
- Cascada limpia prefs/subs; SW + VAPID operativos en web.

**Non-Goals:**
- Digest B10, marketing, SMS, feed in-app con historial.
- HTML enriquecido; OTel.
- Avisar a terceros por postulaciones privadas.
- Incluir `stageLabel`/notas/historial en payloads de aviso al grupo (ADR-024 §7).

## Decisions

### D1 — Módulo `notifications` (api + worker)

Bounded context Nest (clean architecture). API: preferencias, suscripciones, VAPID pública. Worker: consumer único de
fan-out + entregas + detector stale. Puertos `Mailer` y `WebPushSender`. Dominio sin Nest/mongoose/bullmq.

### D2 — Un pipeline de fan-out

Contrato congelado:
1. Hechos en **api** escriben **un** evento outbox por hecho:
   - `GroupLinkAdded.v1` `{ groupId, linkId, actorUserId }`
   - `ApplicationStatusNotify.v1` `{ applicationId, linkId, actorUserId, status, groupId? }` — solo si
     `visibility=group` y cambió el **status canónico** (no stage-only).
2. Worker consume el fan-out, resuelve destinatarios **ahora** (membership actual), y encola jobs de entrega por
   `(type, aggregateId, userId, channel)` con ledger de entrega.
3. Stale: ver D5 (sin outbox en worker).

*Descartado:* múltiples formas `NotifyUser` / pipelines paralelos; envío síncrono en HTTP.

### D3 — Preferencias

```
{ userId,
  groupNewLink, applicationStatusGroup, applicationStale,  // bool, default true
  notifyOwnActions,                                         // bool, default true
  applicationStatusGroupId,                                 // string | null — alcance fijo opcional
  updatedAt }
```

- `applicationStatusGroupId` null → unión de grupos del link (si el evento no trae `groupId`).
- Si el evento trae `groupId` (contexto UI de un grupo) → **gana el evento**.
- Si el evento no trae `groupId` y la pref tiene id → solo ese grupo.
- API dedicada GET/PATCH; no vía `PATCH /users/me`.

### D4 — Web push operativo

- Subs `{ userId, endpoint, p256dh, auth, createdAt }` único `(userId, endpoint)`.
- DELETE por **endpoint**.
- GET VAPID pública: `200` o `503` tipado si faltan claves (no 200 vacío).
- SPA registra **Service Worker** en scope de la app; itera endpoints en entrega; 410/404 borra solo ese endpoint.
- Fail-soft: sin VAPID, email sigue; warning en log.

### D5 — Stale en worker sin fingir outbox

El worker **no** escribe `outbox_events`. Detector (BullMQ repeatable):
1. Elegibles: `!isClosedStatus`, umbral 10d por `statusChangedAt`.
2. Encolar job de fan-out/entrega con `jobId`/clave idempotente **y** reclamar marca con **lease/TTL** reclamable si el
   add falla (no dejar marca dura sin job).
3. Ledger de entrega (D6) evita duplicados al dueño.

*Descartado:* outbox desde worker sin puerto compartido en este change.

### D6 — Idempotencia de entrega (P0)

Colección `notification_deliveries` (o equivalente) keyed por
`type + aggregateKey + userId + channel` (aggregateKey incluye p.ej. `linkId+groupId` o
`applicationId+statusChangedAt`). El consumer **inserta/claim** antes de enviar; éxito o fallo terminal marcado.
`jobId` BullMQ solo anti-dup en vuelo (`removeOnComplete` no basta — lección enrich-link).

### D7 — Privacidad de payload al grupo (P0 / ADR-024)

Plantillas email/push de `application_status_group` **NO SHALL** incluir `stageLabel`, notas ni historial. Solo datos
alineados a lo visible en grupo (nombre, estado canónico, enlace). Cambio **solo** de `stageLabel` **NO** encola
`application_status_group`.

### D8 — Alcance de grupo (cierra V0 business + humano)

1. Default: notificar **miembros del/los grupo(s)** (unión del link), dedupe `userId`.
2. Configuración: preferencia `applicationStatusGroupId` acota a un id (debe ser miembro; al despachar, intersección
   con grupos del link — si vacía, no avisar).
3. Contexto UI: `groupId?` en el cambio de estado / evento **override** de la pref; la api solo acepta si
   `link∈grupo` y actor es miembro.

### D9 — Import masivo

Cada relación nueva en `POST /api/links/import` encola el mismo `GroupLinkAdded.v1` (posible ráfaga). V0 acepta N
avisos; sin agregación. Documentar; rate limit de email del proveedor como red de seguridad.

### D10 — Locale

Consumer usa `outputLanguage` del destinatario (`es`|`en`) vía UsersFacade.

### D11 — ADR-035 + plan

ADR-035 registra D2–D8 y **enmienda** ADR-024 §2/§10 (stale deja de ser solo modelado; avisos de estado al grupo).
Fila 17 en `docs/design-v0.2.md` §6. Quitar mención `web/privacy` del proposal (sin delta).

## Risks / Trade-offs

- [Grupos grandes / import] → N mails; ledger + rate provider.
- [Push sin SW] → Mitigado D4 (SW obligatorio en tasks).
- [Membership al entregar] → Quién salió del grupo no recibe (expandir al procesar).
- [Worker sin outbox] → Stale usa Queue.add + claim; api sigue con outbox para hechos HTTP.

## Migration Plan

1. Deploy api (outbox events + prefs + push API) y worker (consumers + detector).
2. VAPID en staging/prod; SW en web.
3. Rollback: pausar queues/flags; hechos de negocio intactos.

## Reflect — iteración 1

| Ítem | Decisión | Motivo |
|---|---|---|
| Critic P0-1 stale/outbox worker | **Adaptado → D5** | Queue.add + claim; no fingir outbox en worker |
| Critic P0-2 jobId-only | **Aceptado → D6** | Ledger de entrega obligatorio |
| Critic P0-3 groupId sin contrato | **Adaptado → D3/D8** | Pref `applicationStatusGroupId` + `groupId?` en evento |
| Critic P0-4 stageLabel vs ADR-024 | **Aceptado → D7** | Solo status canónico; sin etapa en payload |
| Business V0 groupId configurable | **Aceptado → D8** | Unión default; config por pref; override UI |
| Critic P1 import / terminales / SW / locale | **Aceptado** | D9, D5, D4, D10 |

## Reflect — iteración 2

| Ítem | Decisión | Motivo |
|---|---|---|
| Critic P0 dispatch exige outbox para stale | **Aceptado** | Spec dispatch partida: HTTP→outbox; stale→D5 |
| Critic P0 groupId sin authz | **Aceptado** | Validar link∈grupo ∧ actor miembro; escenario negativo |
| Critic P1 ledger en cascada / lease stale / proposal / prefs membership | **Aceptado** | Specs + D5 lease actualizados |
| Business V0 | **0 abiertos** | Sin cambio; selector fijo se mantiene (humano pidió config) |
