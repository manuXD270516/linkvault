## 1. Docs

- [x] 1.1 [infra] Fila **26** `search-salary-range` en design-v0.2 §6 + openspec-changes.yaml; verify: `rg "search-salary-range"`.
- [x] 1.2 [infra] ADR-040 (fórmula D1 parciales + parse D2) + RUNBOOK backfill job_preview salaryMin/Max; verify: archivos.

## 2. Shared + indexing + API

- [x] 2.1 [backend] Params `minSalary`/`maxSalary` (parse string dígitos, no coerce) + 400s; verify: zod + scenarios.
- [x] 2.2 [backend] Index `salaryMin`/`salaryMax` filterable api+worker (assert settings) + loader (null al limpiar) + backfill; verify: indexing + meili client specs.
- [x] 2.3 [backend] Builder Meili D1 + fake con comparaciones; escenarios positivos y negativos de parciales + empty_query; verify: query tests.

## 3. Frontend

- [x] 3.1 [frontend] Inputs rango + hint i18n + D3b completo (run/setApplicationStatus) ; verify: harness store.

## 4. Verify

- [x] 4.1 [infra] `pnpm nx run-many "-t=lint,typecheck,test" "-p=shared,api,worker,web" --parallel=3` en verde.
