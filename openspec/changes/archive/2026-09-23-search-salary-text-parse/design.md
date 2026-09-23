## Context

See `proposal.md`. ADR-040 dejó fuera parse de `salaryText`. Meili indexa
`salaryMin`/`salaryMax` solo desde `preview.salary.min/max` numéricos. JSON-LD /
LLM a menudo dejan `salary: null` o solo `currency`.

## Goals / Non-Goals

**Goals:** rellenar extremos numéricos de forma conservadora y reindexar; zero UI.

**Non-Goals:** normalizar a monthly en el filtro; LLM primario; nuevas monedas UI.

## Decisions

### D1 — Parser puro compartido

`parseSalaryText(input: string): ParsedSalary | null` en `libs/shared` (o
módulo links domain sin Nest). Determinista, sin I/O. Devuelve solo lo que el
texto soporta con confianza alta; si no, `null` (no inventar).

### D2 — Qué texto se parsea (prioridad)

**Enrich live (con página):** string `baseSalary` / blob salarial de JSON-LD en
esa pasada (hoy el extractor descarta strings: capturarlos aquí o en un
post-paso con acceso a `page`).

**Backfill offline:** solo `summary` (y anclas estrictas). **No** crear campo
`salaryText` libre en el modelo.

**Cuándo correr:** solo si **ambos** `salary.min` y `salary.max` son
null/ausentes (v1 estricto; completar un extremo diferido).

### D3 — Reglas mínimas v1

- Rangos `N - M`, `N–M`, `N a M`.
- Separadores: tabla fija en tests — `1,000` / `1.000` miles; ambiguo → null
  (nunca inventar).
- Un solo número → **`min=max=N`** (solape ADR-040).
- Currency: `USD`/`$` (con ancla salarial), `BOB`/`Bs`/`Bs.`.
- Period: mes→`month`, año→`year`, hora→`hour`; ambiguo → null; **sin**
  convertir montos.
- Anclas anti-FP: (palabra `sueldo|salario|remuneración|salary`) **o**
  (moneda **y** `/mes|mensual|monthly|…`). Negativos: años de experiencia,
  `Node $`, fechas.

### D4 — Procedencia y no-overwrite

- Source del campo `salary` tras parse: **`auto`** + `extractor: 'parse-salary-text'`
  (o id acordado). **Prohibido** inventar kind `derived`.
- Si `previewSources.salary` es `manual` **o** `pasted` → **no-op** total.
- Si `auto`/ausente y ambos extremos null → deep-fill solo nulls; no cambiar
  números ya presentes.

### D5 — Backfill two-step (sin dual-write Meili)

1. CLI/target: lee Mongo, parsea, `$set` preview.salary + sources `auto`,
   bump `previewVersion` si el path lo exige.
2. Luego `api:backfill-search --docType=job_preview` (outbox SearchUpsert).
   **Prohibido** escribir Meili desde el CLI de parse.
   Backfill **obligatorio** en el mismo ship (V0 negocio).

### D6 — Plan / ADR

Fila **32**. **ADR-046** enmienda ADR-040 §4.

## Risks / Trade-offs

- [Falsos positivos en description] → anclas obligatorias; tests negativos.
- [Miles vs decimales] → fixtures BO/US; fail → null.
- [min=max en sueldo único] → puede ser “desde N”; aceptable v1 + doc.

## Migration Plan

Deploy parser + enrichment; correr backfill; rollback = no backfill / flag off
opcional no requerida si parse es conservador.
