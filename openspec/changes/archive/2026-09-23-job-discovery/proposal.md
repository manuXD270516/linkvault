## Why

El vault ya guarda y enriquece links, pero la persona aún depende de pegar URLs desde
fuera. F3 `discovery` (design.md) cierra el círculo: **buscar vacantes en bolsas
lícitas** y guardarlas en LinkVault con un clic, sin scraping agresivo ni headless.

## What Changes

- Módulo **discovery** (api): puerto `DiscoveryBoardAdapter`, routing por board,
  `GET /api/discovery/search` autenticado.
- Adapters v1 (**fase completa** de boards lícitos con API pública):
  - `getonboard` (API/JSON público)
  - `remoteok` (API JSON pública) + canonicalizer `remoteok` si hace falta
  - `mock` determinista para CI/tests
- SPA **`/descubrir`**: query, filtro por board, resultados, CTA Guardar **privado** →
  `POST /api/links` con feedback creado / ya existía / error (picker de grupo = V1).
- Cortesía: rate-limit por usuario/board; reuso de robots/host-turn **solo** si un
  adapter HTTP toca HTML (APIs JSON no scrapean).
- Flag **`FEATURE_DISCOVERY`** (default off en `.env.example`).
- Fila §6 + ADR-043; actualizar design.md (discovery deja de estar “diferido”).

**Fuera de alcance:**

- LinkedIn / Indeed / Computrabajo / Trabajopolis como fuentes de discovery
  (robots/`blocked` — ADR-022); UI puede listarlos como no disponibles.
- Headless Playwright para discovery.
- Auto-postulación, digest de bolsas, ranking ML.
- Cambiar enrichment salvo dedupe/canonicalizer de boards nuevos.

## Capabilities

### New Capabilities

- `discovery/search`: contrato API de búsqueda en bolsas + degradación honesta.
- `web/discovery`: SPA `/descubrir`.

### Modified Capabilities

- `platform/local-environment`: documentar `FEATURE_DISCOVERY`.
- `links/canonical`: platform `remoteok`.

## Impact

- **Código:** `apps/api` módulo discovery; `apps/web` feature discovery; shared schemas;
  optional worker solo si un adapter reusa cola de dominio.
- **ADR-043.** Agentes: backend-dev, frontend-dev, devops (flag/docs).
- **Deps:** job-links + link-enrichment en main; demo-seed/reopen opcionales.
