## Context

`MatchReport.missingSkills` ya existe. G3 / design-v0.2 §4.7–§5.6 / ADR-014. Debate 2026-09-21 cerró P0 (HTTP, claim, outbox) y V0 (empty skills, 200, SHALL enqueue).

## Goals / Non-Goals

**Goals:** roadmap por análisis propio; catálogo primero; `verified` honesto; POST + auto-outbox; UI por semanas + export MD.

**Non-Goals:** búsqueda web; regenerar; compartir en grupo; checkboxes de progreso; LLM inline en el consumer de match; pasos nuevos en el conjunto cerrado del análisis de encaje.

## Decisions

### 1. Catálogo primero + post-proceso `verified`

`searchCatalog(skill)` sobre `resources.seed.json`. Tras `runTask` (o solo catálogo si cubre todo): todo recurso que no sea hit exacto del catálogo → forzar `verified: false`. Hits de catálogo → `verified: true`.

### 2. Disparo y HTTP

| Método | Ruta | Comportamiento |
| --- | --- | --- |
| `POST` | `/api/analyses/:analysisId/roadmap` | Dueño + análisis `done` no degradado + skills útiles. Claim `generating` o **200** si ya `ready`/`generating`/`failed` (MVP: failed también se devuelve sin re-LLM). Si claim gana → **202** `{ roadmapId, status:'generating' }` + outbox. |
| `GET` | `/api/analyses/:analysisId/roadmap` | Dueño; cuerpo con `status` + ítems si `ready`. |
| `GET` | `/api/analyses/:analysisId/roadmap.md` | Markdown del doc `ready`; 404 si no ready. |

Auto: al persistir match `done` no degradado con ≥1 `missingSkill`, misma tx/outbox `RoadmapRequested.v1` (`jobId` = `roadmap:{analysisId}`). Si `missingSkills` vacío → **no** encolar ni CTA.

### 3. Claim-before-run

`insertOne` `{ analysisId, userId, status:'generating' }` unique `analysisId`. Duplicate key → no `runTask`. Solo el winner ejecuta `build-roadmap` y pasa a `ready` o `failed`.

### 4. Outbox, no dual-write

Encolar roadmap **nunca** con EventEmitter suelto tras el `complete` del análisis: `RoadmapRequested.v1` en outbox (POST o auto). El consumer de match **no** llama al LLM de roadmap.

### 5. Consentimiento y cuota

Re-leer `aiConsent` al ejecutar el job. Cadena solo external sin consent → `failed` honesto, sin `ready`. Cuota `build-roadmap` ~10/día en `AI_QUOTAS`; auto respeta cuota.

### 6. Cascada

Hooks de borrado de análisis/CV eliminan `roadmaps` del `analysisId`.

### 7. Progreso

Estado solo en el recurso roadmap (`generating`/`ready`/`failed`). **No** añadir pasos al conjunto cerrado de match.

### 8. Seed

~30–50 skills del dominio match; criterio: hits de catálogo en skills frecuentes del golden.

## Risks / Trade-offs

- [Muchos `verified:false`] → ampliar seed (criterio V0).
- [Auto gasta cuota] → vacío no encola; failed visible; sin regenerate MVP.
- [§5.6 muestra LLM sync] → conceptual; implementación = outbox + claim (esta design).

## Migration Plan

Colección nueva. Sin migración.

## Reflect

| Hallazgo | Origen | Decisión |
| --- | --- | --- |
| HTTP / 409 ambiguo | P0 critic + V0 business | Contrato §2; solo 200/202; sin 409 |
| Carrera POST×auto | P0 critic | Claim-before-run §3 |
| Dual-write enqueue | P0 critic | Outbox `RoadmapRequested.v1` §4 |
| missingSkills vacío | V0 business | No encolar / sin CTA |
| MAY vs SHALL | P1/V0 | SHALL auto + POST |
| LLM miente verified | P1 | Post-proceso §1 |
| Cascada delete | P1 | §6 |
| Pasos match | P2 | §7 fuera del step set |

ADRs: 014 (runTask), 009 (outbox). Sin ADR nuevo.

**CONVERGENCIA: SI**
