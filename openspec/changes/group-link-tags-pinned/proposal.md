## Why

`design.md` modela `group_links.tags[]` y `pinned` desde el MVP, pero ADR-026 solo
entregó `note`/comentarios y dejó tags/pinned fuera. Con paste, extensión y discovery
el feed del grupo crece sin estructura: sin fijar ni etiquetar, el contexto humano
(B3) se ahoga en volumen.

## What Changes

- Campos `tags: string[]` y `pinned: boolean` en la relación grupo↔link.
- API autenticada (miembro del grupo): set/replace tags y pin/unpin atómicos;
  listado de grupo expone ambos campos y acepta filtros `pinned` / `tag`.
- SPA (vista de grupo): pin, chips de tags, filtro “solo fijados” y por tag.
- Plan §6 fila **30** en `docs/design-v0.2.md` + `openspec-changes.yaml` + **ADR-044**.

**Fuera de alcance:**

- Funnel de grupo / dwell (siguen ADR-039).
- Tags en links privados personales.
- Pin-to-top que reordene el cursor (v1 = flag + filtro, mismo orden `sharedAt`).
- Taxonomía global / sugerencias IA de tags.
- Indexación Meili / digest / `/p/:slug`.
- Más bolsas de discovery.

## Capabilities

### New Capabilities

- `groups/link-tags-pinned`: dominio, API, filtros de listado y límites de tags.

### Modified Capabilities

- `web/links`: UI de organización en cards de grupo (pin, chips, filtros).
- Resumen de link de grupo (`JobLinkSummary`): `tags` y `pinned` opcionales en
  contexto de grupo.

## Impact

- **Código:** shared zod; `GroupLink` persistencia + índices; use cases +
  controller; SPA grupo; cascada de borrado de relación (campos van con el doc).
- **ADRs:** [ADR-044](../../../docs/adr/ADR-044.md) — ACL miembro, pin como flag, caps,
  índice tag diferido, non-goals Meili/digest/public/outbox.
- **Agentes:** backend-dev, frontend-dev.
- **Dependencias:** groups + group-comments (+ know-someone) en main.
