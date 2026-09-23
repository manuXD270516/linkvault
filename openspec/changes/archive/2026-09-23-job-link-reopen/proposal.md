## Why

Freshness puede marcar una vacante como cerrada por falso positivo (`not_found` / calendario).
Hoy el cierre es **one-way**: no hay forma de reabrir el link, y el badge/search `openOnly`
lo ocultan aunque siga vigente. Eso quema confianza en el vault (G2 / ADR-037).

## What Changes

- **Reabrir vacante:** endpoint autenticado que limpia `closedAt`/`closedReason`, publica SSE
  summary abierto y reindexa search con `closedAt: null` (clear Meili merge).
- **Calendar trap:** si el cierre fue `calendar` (o `expiresAt` sigue en el pasado), el reopen
  SHALL exigir corregir `expiresAt` (body o vía preview en la misma operación) para no
  re-cerrar en el siguiente tick del detector.
- **ACL:** quien puede **ver** el link (misma regla que editar preview), no solo `createdBy`.
- SPA: acción “Reabrir / marcar abierta” en UI de link cerrado + i18n.
- Fila **27** + ADR-041 (enmienda ADR-037).

**Fuera de alcance:**

- Bulk reabrir applications `expired` (el dueño ya puede cambiar estado a mano; ADR-024).
- Deshacer ASN/notificaciones ya enviadas.
- Cambiar lógica del detector salvo respeto a recién reabiertos si el debate lo pide.
- Discovery.

## Capabilities

### New Capabilities

- `links/reopen`: dominio + API + reglas calendar/`expiresAt`.

### Modified Capabilities

- `links/freshness`: nota de reopen / no re-cierre inmediato si aplica.
- `web/links`: control UI reopen.
- `search/indexing`: abierto ⇒ `closedAt: null` (clear Meili); cerrado ⇒ ISO.

## Impact

- **Código:** links module (use case + controller), shared schemas, SPA link card/detail,
  search upsert on reopen.
- **ADRs:** ADR-041 enmienda ADR-037.
- **Agentes:** backend-dev, frontend-dev.
- **Dependencias:** `job-link-freshness` en main.
