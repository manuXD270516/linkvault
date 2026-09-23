## Why

Freshness (G2) marca vacantes cerradas con `closedAt` en Meili; LatAm filters (B9r) lo dejó
fuera a propósito. Sin un filtro “solo abiertas”, `/buscar` mezcla ofertas muertas y diluye el
valor de frescura + filtros LatAm.

## What Changes

- **API** `GET /api/search`: query param booleano `openOnly` (o nombre acordado en design) que,
  cuando es true, AND-filtra documentos **sin** `closedAt` (abiertos). Combina con ACL y filtros
  existentes; vacío `q` sigue `400`.
- **SPA `/buscar`**: control “Solo abiertas” (default off o on — design); D3b: implica
  `docType=job_preview` (misma lógica que modality/currency).
- **Índice:** reutilizar `closedAt` ya filterable (api+worker); sin backfill nuevo si freshness
  ya indexa el campo.
- Fila **22** en `docs/design-v0.2.md` §6 + `openspec-changes.yaml`.

**Fuera de alcance:** B11 know-someone; discovery; rango salarial; toggle de modo search;
  listar índice sin `q`.

## Capabilities

### New Capabilities

_(ninguna)_

### Modified Capabilities

- `search/query`: param `openOnly` + escenarios.
- `web/search`: UI del filtro + D3b con openOnly.

## Impact

- **Código:** shared search schema; acl/filter builder; SPA search store/page + i18n.
- **ADRs:** ninguno nuevo previsto.
- **Agentes:** backend-dev, frontend-dev.
- **Dependencias:** `job-link-freshness` + `search-latam-filters` en main.
