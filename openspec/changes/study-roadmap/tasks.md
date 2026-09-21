## 1. Contrato y catálogo

- [ ] 1.1 [ai] Schemas Roadmap/input `build-roadmap` + post-proceso `verified` en shared; tests.
- [ ] 1.2 [ai] `resources.seed.json` (~30–50 skills) + `searchCatalog`; tests hit/miss.
- [ ] 1.3 [backend] Colección `roadmaps` (unique analysisId, status generating|ready|failed); claim insert; tests carrera.
- [ ] 1.4 [backend] Evento `RoadmapRequested.v1` + ruta outbox `jobId=roadmap:{analysisId}`.

## 2. IA y casos de uso

- [ ] 2.1 [ai] Prompt `build-roadmap.v1` + tarea no cacheable + fixtures/eval mínimo; test salida inválida y «miente verified».
- [ ] 2.2 [backend] POST/GET `/api/analyses/:id/roadmap` (202/200, ownership, empty/degraded → error); GET `.md`.
- [ ] 2.3 [backend] Worker: claim → re-leer consent → `runTask` → ready/failed; cuota; sin LLM si duplicate claim.
- [ ] 2.4 [backend] Auto-outbox desde complete match no degradado con skills; no inline en analyze-match.
- [ ] 2.5 [backend] Cascada delete roadmap al borrar análisis/CV; test.

## 3. Frontend

- [ ] 3.1 [frontend] Ruta lazy roadmap + store (generating/ready/failed); i18n ES/EN.
- [ ] 3.2 [frontend] CTA desde match si hay missingSkills; sondeo GET; no CTA si vacío.
- [ ] 3.3 [frontend] Vista por semanas + badge verified; export MD; tests.

## 4. Cierre

- [ ] 4.1 [infra] `AI_QUOTAS` build-roadmap + seed/RUNBOOK.
- [ ] 4.2 [infra] `pnpm nx affected -t lint,typecheck,test --base=main` y `openspec validate --all`.
