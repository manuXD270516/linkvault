## Why

El filtro de rango (fila 26 / ADR-040) ya está en `/buscar`, pero muchas vacantes
LatAm solo traen salario en texto libre (o `salary` con currency y sin
números). El usuario filtra y el índice no tiene `salaryMin`/`salaryMax` →
hits “invisibles”.

## What Changes

- Parser **determinista** de texto salarial → `salary.{min,max,currency?,period?}`
  cuando faltan extremos numéricos.
- Integración en enrichment (post-extract / merge) y backfill de previews
  existentes + reindex Meili (misma semántica ADR-040).
- Fixtures LatAm: Bs./BOB/USD, rangos, “mensual/año”, montos sucios.
- Plan §6 fila **32** + **ADR-046** (enmienda ADR-040 §4).

**Fuera de alcance:**

- Filtro por `period` o conversión hour↔month↔year en Meili.
- LLM como extractor primario de salario; UI nueva en SPA.
- Firefox/Web Store; funnel grupo; pin-to-top.

## Capabilities

### New Capabilities

- `links/salary-parse`: reglas de parseo y cuándo rellenar el preview.

### Modified Capabilities

- `search/indexing`: docs ganan `salaryMin`/`salaryMax` tras parse/backfill.
- `links/enrichment` (o merge): aplicar parse cuando proceda.

## Impact

- **Código:** shared parser + enrichment/worker + backfill; tests.
- **ADRs:** ADR-046.
- **Agentes:** backend-dev (worker/api), opcional shared.
- **Dependencias:** search-salary-range en main.
