## Why

B9 normalizó modalidad y salario en el preview; `search` indexa `modality`, `salaryText` y
`status` (searchable), pero la API/SPA V0 solo filtran `docType`/`groupId`. En LatAm la gente
filtra por remoto/híbrido, moneda (BOB/USD) y estado del proceso: sin eso `/buscar` no cumple
“encontrar lo útil”.

## What Changes

- **Meili:** `modality`, `status` y `salaryCurrency` pasan a **filterable** (api + worker).
- **API** `GET /api/search`: params `modality`, `applicationStatus` (→ filtro Meili `status`),
  `salaryCurrency` (pass-through) en AND con ACL/`docType`/`groupId`.
- **Indexación:** `job_preview.salaryCurrency` desde `salary.currency`; backfill.
- **SPA `/buscar`:** controles i18n + UX que evita AND vacío entre tipos (D3b).
- **Fila 20** en `docs/design-v0.2.md` §6 + `openspec-changes.yaml`.

**Fuera de alcance:**

- Digest B10; discovery F3; extensión; toggle de modo; filtro “solo abiertas” (`closedAt`);
  rango salarial; normalización `Bs→BOB`.

## Capabilities

### New Capabilities

_(ninguna — amplía search existente)_

### Modified Capabilities

- `search/query`: filtros LatAm + mapeo `applicationStatus`→`status` + empty_query con filtros.
- `search/indexing`: filterable modality/status/salaryCurrency; campo salaryCurrency + backfill.
- `web/search`: UI filtros + D3b; MODIFY la prohibición V0 de modality/status.

## Impact

- **Código:** shared schemas; Meili settings api/worker; loader; search usecase; SPA + i18n.
- **ADRs:** ninguno nuevo; fila §6.
- **Agentes:** backend-dev, frontend-dev.
- **Dependencias:** `search` + enrichment (modality/salary) en main.
