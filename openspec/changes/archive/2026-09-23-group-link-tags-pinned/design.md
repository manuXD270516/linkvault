## Context

See `proposal.md` — Why. Hoy `GroupLinkDocument` no persiste `tags`/`pinned`
(ADR-026 los deferió). Listado de grupo: orden `(sharedAt DESC, _id)`, cursor
opaco, índice `{ groupId, sharedAt, _id }`. Patrón cercano: know-someone
(`PUT` atómico, DTO slim, ACL miembro → 404).

## Goals / Non-Goals

**Goals:** persistencia + API + filtros de listado + SPA sin romper paginación
por cursor; límites claros de tags; respuesta slim en mutaciones.

**Non-Goals:** pin-to-top / nuevo sort; Meili; digest; publicShare; tags
privados; funnel/dwell; taxonomía IA.

## Decisions

### D1 — ACL: cualquier miembro (como know-someone)

Cualquier miembro del grupo puede `PUT` tags y pinned. No miembro / grupo
inválido → `404 group_not_found`. Relación ausente → `404 link_not_found`.
Sin `403` (no hay “solo sharedBy”).

**Alternativas:** (B) solo `sharedBy` + owner — rompe colaboración del grupo;
(C) solo owner — cuello de botella.

### D2 — `pinned` = flag + filtro, mismo orden

`pinned: boolean` (default false). Listado sigue `(sharedAt, _id)`. Query
opcional `?pinned=true|false`. SPA “solo fijados” = filtro server-side, no
reordenar en cliente sobre páginas parciales.

**Alternativa descartada:** pin-to-top → sort `(pinned, sharedAt, _id)` + cursor
e índice nuevos (coste medio; diferido).

### D3 — Tags: set replace + caps

- `PUT …/tags` body `{ tags: string[] }` **reemplaza** el array completo
  (`$set`), no merge parcial en v1.
- Normalización: trim, lowercase, colapsar espacios internos, dedupe
  preservando orden de primera aparición.
- Caps: máx **8** tags; tras normalizar cada tag MUST match
  `^[a-z0-9][a-z0-9\- ]{0,31}$`; strings vacíos tras trim se **descartan** antes
  de caps/dedupe; array vacío (o solo vacíos) = quitar todos.
- Filtro listado: `?tag=<one>` → `tags` contiene ese valor normalizado
  (`$all` de un elemento). Varios tags en un request = fuera v1.

### D4 — Endpoints y DTO slim

- `PUT /api/groups/:groupId/links/:linkId/pinned` `{ pinned: boolean }` →
  `{ pinned: boolean }`
- `PUT /api/groups/:groupId/links/:linkId/tags` `{ tags: string[] }` →
  `{ tags: string[] }`
- `GET …/links` incluye `tags` (default `[]`) y `pinned` (default `false`) en
  ítems de grupo; lista privada **no** los incluye.
- No devolver `JobLinkSummary` completo en PUT (evitar pisar note/comments en
  SPA; mismo patrón D2 know-someone).

### D5 — Query de listado de grupo (schema aparte)

`listLinksQuerySchema` privado **no** gana `pinned`/`tag`. Nuevo schema de
query de grupo (o extend solo en el controller de grupo). Parse de `pinned`:
`z.enum(['true','false']).transform(...)` — **prohibido** `z.coerce.boolean()`
(`"false"` → true). `tag` se normaliza igual que en PUT. `list` + `count` comparten
el mismo filter object.

### D6 — Índices y count

- Índice `{ groupId: 1, tags: 1, sharedAt: -1, _id: -1 }` **diferido** en ADR-044
  (collscan OK en grupos pequeños; crear si duele).
- `count` / `total` del listado SHALL usar el mismo match que la página
  (incl. `pinned` / `tag`).

### D7 — Sin fuga / sin outbox

Mutaciones tags/pinned = `$set` en `group_links` **sin** outbox ni SearchUpsert.
No mapear a `/p/:slug`, digest ni Meili (lista explícita en mappers, como note).

### D8 — Plan / ADR

- Fila **30** `group-link-tags-pinned` en `docs/design-v0.2.md` §6.
- **ADR-044**: ACL miembro, pin-flag, caps, query aparte, índice diferido,
  non-goals (Meili/digest/public/outbox). Ver `docs/adr/ADR-044.md`.

## Risks / Trade-offs

- [Pin sin pin-to-top] → UX “fijado” no flota; mitigación: filtro “solo fijados” + badge.
- [Tags libres] → ruido; mitigación: caps + normalización.
- [Filtro tag sin índice] → lento en grupos enormes; mitigación: índice si duele.
- [Edición cruzada] → último write gana en tags replace; aceptable v1.

## Migration Plan

Campos opcionales; docs antiguos → `tags=[]`, `pinned=false` en lectura.
Rollback: ignorar campos / feature flag no requerida.
