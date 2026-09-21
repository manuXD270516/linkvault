## Why

Tras el análisis de encaje, la persona ve qué le falta pero no un plan concreto para cerrar esos huecos. Este change convierte `missingSkills` del informe en un **roadmap de estudio** anclado primero al catálogo curado del repo (G3 / legal) y solo completa con el LLM lo que el catálogo no cubre, marcando honestamente qué no está verificado.

## What Changes

- Catálogo curado `resources.seed.json` (por skill) + `searchCatalog(skill)` antes del modelo.
- Tarea `build-roadmap` vía `runTask`: prioriza `missingSkills`, recursos de catálogo con `verified: true`, huecos LLM con `verified: false` (post-proceso obliga la marca; el modelo no puede mentir `verified`).
- Colección `roadmaps` con claim `generating` → `ready`/`failed` (índice único por `analysisId`).
- Disparo: **POST** del dueño **y** auto-encola vía outbox al completar match no degradado con `missingSkills` útiles; idempotencia **200** si ya existe (sin regenerar).
- HTTP: `POST/GET /api/analyses/:analysisId/roadmap`, export `GET …/roadmap.md`.
- SPA: CTA desde match → ruta lazy; estados `generating`/`ready`/`failed`; distinción visual verified; export Markdown.
- **No** búsqueda web, regenerar, compartir en grupo, ni reabrir diffs del CV.

## Capabilities

### New Capabilities

- `cv/roadmap`: generar (claim), leer, exportar; ownership e idempotencia.
- `web/roadmap`: CTA, sondeo de estado, vista por semanas, export.

### Modified Capabilities

- `ai/task-execution`: tarea `build-roadmap` (no cacheable); post-proceso `verified`.
- `cv/match`: tras `done` no degradado con skills útiles → outbox `RoadmapRequested.v1` (no LLM inline en el consumer de match).

## Impact

- `libs/ai`, `libs/shared`, `apps/worker`, `apps/api`, `apps/web`.
- ADR-014; outbox ADR-009; consume `missingSkills` de match (ADR-029).
- Cascada: borrar análisis/CV borra su roadmap.
