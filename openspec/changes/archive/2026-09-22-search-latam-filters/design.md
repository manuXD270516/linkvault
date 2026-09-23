## Context

`search` (fila 18) indexa `modality`, `salaryText` y `status` como **searchable**, no filterable.
`searchQueryParamsSchema` y la SPA solo exponen `docType`/`groupId`. Spec `web/search` V0
prohibía modality/status. B9r es el resto de B9. Ver proposal.md. Freshness ya aporta `closedAt`
(filtro “abiertas” fuera de este change).

## Goals / Non-Goals

**Goals:**
- Filtrar búsqueda por modalidad, estado de postulación y moneda de salario útil en LatAm.
- Misma ACL; AND con filtros existentes; i18n ES/EN.
- Hacer filterable lo necesario en Meili; añadir `salaryCurrency` + backfill.

**Non-Goals:**
- Toggle mode; filtro `closedAt`/solo abiertas; digest; discovery; rango salarial min/max; rediseño de ranking.

## Decisions

### D1 — Params API

```
modality?: remote|hybrid|onsite|unknown   // → Meili filter: modality = "…"
applicationStatus?: APPLICATION_STATUSES  // → Meili filter: status = "…"  (campo índice, no renombrar doc)
salaryCurrency?: string                   // → Meili filter: salaryCurrency = "…"  (pass-through; ver D2)
```

Combinación AND con ACL + `docType` + `groupId`. Valores de `modality` / `applicationStatus` fuera
del enum → `400 validation_error` nombrando el campo. `salaryCurrency`: string no vacío acotado
(longitud); no enum inventado — el valor debe coincidir con lo indexado desde `salary.currency`.

**Mapeo explícito:** el query param se llama `applicationStatus` (evita colisión semántica); el
filtro Meili usa el atributo de documento `status`.

### D2 — Salario: moneda estructurada (pass-through)

Añadir en `job_preview`:

- `salaryCurrency?: string` — copia de `preview.salary.currency` cuando es string no vacío.
- Si `salary` ausente o `currency` null/vacío → **omitir** el campo (no indexar `"null"`).

UI V0: opciones **cualquiera**, **BOB**, **USD** (corpus real LatAm/BO; no “Bs”). Otras monedas
quedan V1. Sin rango min/max en este change.

`salaryText` se mantiene searchable. Backfill vía path de search existente.

*Descartado:* substring sobre `salaryText`; normalización `Bs→BOB` (el preview ya guarda lo que hay);
rango completo.

### D3 — SPA + UX de filtros cruzados (business V0)

Controles en `/buscar` (selects): modalidad, estado de postulación, moneda (BOB/USD/cualquiera).

**Compatibilidad de tipos (D3b):** mecánica única — al activar un filtro LatAm, la UI **fuerza**
`docType` y limpia el otro eje:

- `modality` o `salaryCurrency` activos → `docType=job_preview` y `applicationStatus` = cualquiera.
- `applicationStatus` activo → `docType=application` y modality/currency = cualquiera.

No se listan resultados sin `q` (sigue `empty_query`). Sin toggle de modo.

### D4 — Meili filterable (critic P0)

Mover/añadir a `filterableAttributes` en **api y worker** (misma lista):

- `modality`, `status` (ya presentes en docs searchable)
- `salaryCurrency` (nuevo)

Task de paridad: actualizar ambos clientes; test/assert settings.

### D5 — Plan

Fila **20** `search-latam-filters` en design-v0.2 §6; `openspec-changes.yaml`. Sin ADR nuevo.

### D6 — Deploy

Deploy settings Meili → backfill `salaryCurrency` en `job_preview` → SPA. Params nuevos opcionales
(rollback: SPA deja de enviarlos).

## Risks / Trade-offs

- Docs sin `salaryCurrency` quedan fuera al filtrar por moneda hasta backfill.
- Monedas distintas de BOB/USD no aparecen en el select V0 (pass-through API sigue admitiendo otras).
- `modality=unknown` es valor filtrable legítimo (preview lo usa).

## Migration Plan

Ver D6. Criterio “currency útil”: no exponer el select de moneda en smoke/prod checklist hasta
backfill de previews con salario, o documentar que resultados pueden ser incompletos pre-backfill.

## Open Questions

Ninguna bloqueante tras reflect iter 1.
