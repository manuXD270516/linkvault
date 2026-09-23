## Context

`closedAt` es filterable en Meili (freshness). B9r diferió “solo abiertas”. Ver proposal.md.

## Goals / Non-Goals

**Goals:** filtrar búsqueda a vacantes abiertas (`closedAt` ausente/null); SPA + API; D3b con
`docType=job_preview`; ACL intacta; `empty_query` intacto.

**Non-Goals:** filtrar “solo cerradas” como producto (puede existir el inverso técnico); B11;
cambiar ranking; reindex masivo.

## Decisions

### D1 — Param API

`openOnly?: boolean` en el schema tipado del cliente. En querystring HTTP: solo
`openOnly=true` | `openOnly=false` (ausente = no filtrar). Parseo:

```ts
z.enum(['true', 'false']).transform((v) => v === 'true').optional()
```

**Prohibido** `z.coerce.boolean()` (la string `"false"` sería truthy).

Cuando `openOnly === true`, filtro Meili: **`closedAt IS NULL`** (cubre atributo omitido
por el loader; el loader **nunca** escribe `null`). Comentar en el builder.

Otros docTypes sin `closedAt` pasan el filtro; la SPA fuerza `job_preview` vía D3b.

### D2 — SPA + D3b bidireccional

Toggle “Solo abiertas” default **off**. Al activar: `docType=job_preview` y limpia
`applicationStatus`. Al activar `applicationStatus`: limpia `openOnly` (y modality/currency
como hoy). `run()` re-fuerza `job_preview` si `openOnly`. i18n ES/EN.

### D3 — Plan

Fila **22** `search-open-only`. Sin ADR nuevo.

### D4 — Tests

In-memory Meili: interpretar `closedAt IS NULL` como `doc.closedAt === undefined`.
Fixtures de cerrado con ISO string; abiertos **sin** la clave.

## Risks / Trade-offs

- Docs viejos sin `closedAt` indexado se tratan como abiertos (correcto post-freshness; si falta
  backfill, puede filtrar de más/menos — asumir freshness shipped).
- `openOnly` + `applicationStatus` sin D3b vaciaría resultados — mitigado por D3b.

## Migration Plan

Deploy; sin migración. Rollback: SPA deja de enviar param.

## Open Questions

Ninguna.
