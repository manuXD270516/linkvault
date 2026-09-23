## 1. Plan / ADR

- [x] 1.1 Fila **32** en `docs/design-v0.2.md` §6 + `openspec-changes.yaml`
- [x] 1.2 `docs/adr/ADR-046.md` (enmienda ADR-040 §4) y enlace en §6

## 2. Parser [shared]

- [x] 2.1 Implementar `parseSalaryText` + tests fixtures LatAm (rango, único, Bs/USD, period, negativos sin ancla)
- [x] 2.2 Export desde `@linkvault/shared`; verificar typecheck shared

## 3. Enrichment + index [backend]

- [x] 3.1 Integrar parse post-chain: solo ambos extremos null; no-op si source manual/pasted; source auto + extractor `parse-salary-text`; verificar unit enrichment
- [x] 3.2 Backfill **two-step**: (1) CLI parse→Mongo `$set` salary; (2) `api:backfill-search` outbox — **sin** write Meili directo; verificar salaryMin/Max tras upsert
- [x] 3.3 RUNBOOK: documentar los 2 comandos del backfill

## 4. Verify

- [x] 4.1 `pnpm nx affected -t lint,typecheck,test` en verde
- [x] 4.2 Smoke: preview con solo salaryText/summary → tras enrich/backfill aparece en filtro minSalary
