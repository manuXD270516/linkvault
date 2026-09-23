## Why

LatAm ya filtra por `salaryCurrency` (B9r) pero no por **rango** numérico. El preview ya
guarda `salary.min`/`max`; sin filtro de rango el usuario no puede acotar vacantes a su
banda salarial en `/buscar`.

## What Changes

- Indexar en Meili atributos numéricos filterables `salaryMin` / `salaryMax` desde
  `preview.salary.min` / `.max` (solo `job_preview`; omitir si null).
- API `GET /api/search`: params opcionales `minSalary` / `maxSalary` (números ≥ 0) que
  filtran en Meili; reutilizar `salaryCurrency` existente.
- SPA `/buscar`: inputs de rango (min/max) + D3b con `job_preview` como modality/currency/openOnly.
- Fila **26** en design-v0.2 §6 + openspec-changes.yaml.
- Backfill/reindex de search para rellenar los nuevos attrs.

**Fuera de alcance:**

- Filtro por `period` (hour/month/year) o normalización a una unidad.
- Inferir min/max desde `salaryText` libre.
- Discovery; cambiar ranking; currency nuevas más allá de BOB/USD UI.

## Capabilities

### New Capabilities

- (ninguna path nueva; deltas sobre search existentes)

### Modified Capabilities

- `search/indexing`: attrs `salaryMin`/`salaryMax` filterable + backfill.
- `search/query`: params `minSalary`/`maxSalary` + filtros Meili.
- `web/search`: UI rango + D3b.

## Impact

- **Código:** shared search schemas; Meili settings api/worker; loaders; SPA search page/store.
- **ADRs:** nota corta o ADR-040 si debate lo pide (semántica min/max overlap).
- **Agentes:** backend-dev, frontend-dev, devops (env/docs si hace falta).
- **Dependencias:** `search`, `search-latam-filters` en main.
