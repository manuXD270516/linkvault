## Context

Ver proposal.md. Reflect: D1 fórmula Meili con parciales; parse tipo openOnly; MODIFIED
filtros estables.

## Goals / Non-Goals

**Goals:** rango salarial numérico + currency; index + API + SPA; D3b; backfill; fila 26;
ADR-040.

**Non-Goals:** period; parse salaryText; nuevas monedas UI.

## Decisions

### D1 — Semántica de overlap (Meili)

Filtros opcionales `minSalary=M` / `maxSalary=X` (lo que el usuario acepta). Docs **sin**
`salaryMin` ni `salaryMax` quedan fuera si hay cualquier filtro de rango.

**`minSalary=M`** (tope conocido ≥ M):

```
(salaryMax >= M) OR (salaryMax IS NULL AND salaryMin >= M)
```

**`maxSalary=X`** (piso conocido ≤ X):

```
(salaryMin <= X) OR (salaryMin IS NULL AND salaryMax <= X)
```

Ambos: AND. Fake Meili in-memory MUST evaluar estas comparaciones (no solo igualdad).

### D2 — Params API (parse)

Query params como string de dígitos (enteros ≥ 0). Vacío / ausente → no filtrar ese lado.
Negativo, no numérico, decimal → `400 validation_error` nombrando el campo.
**Prohibido** `z.coerce.number()` (la string `""` o basura se vuelve 0).
Si ambos presentes y `minSalary > maxSalary` → `400`.

### D3 — Index

`salary.min` → `salaryMin`, `salary.max` → `salaryMax` solo si number. Filterable en **api y
worker**. Backfill `job_preview` documentado en RUNBOOK.

### D4 — SPA + D3b

Inputs min/max; hint i18n “solo vacantes con salario numérico”. Al setear rango/currency/
modality/openOnly → `docType=job_preview`, limpia `applicationStatus`. Al setear
`applicationStatus` → limpia modality/currency/openOnly/**rango**. `run()` re-fuerza
`job_preview` si hay rango.

### D5 — Plan

Fila **26**. **ADR-040** (D1+D2).

## Risks / Trade-offs

- [Pocos previews con min/max] → hint UI; no bloquea.
- [Period mezclado] → fuera.

## Migration Plan

Settings dual → backfill → SPA. Checklist RUNBOOK.

## Open Questions

Ninguna.
