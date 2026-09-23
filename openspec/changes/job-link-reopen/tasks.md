## 1. Docs

- [ ] 1.1 [infra] Fila **27** `job-link-reopen` en design-v0.2 §6 + openspec-changes.yaml; verify: `rg`.
- [ ] 1.2 [infra] ADR-041 (reopen, date-only expiresAt, `closedAt: null` en Meili, race in-flight, no bulk apps) + nota ADR-037 + delta indexing abierto⇒null; verify: archivos.

## 2. Backend

- [ ] 2.1 [backend] Schema body `{ expiresAt?: YYYY-MM-DD | null }` + shared; verify: zod.
- [ ] 2.2 [backend] `POST /api/links/:id/reopen`: ACL legible, unset closed*, lastFreshnessCheckAt, procedencia manual expiresAt, SSE post-write, SearchFacade/outbox fingerprint reopen, loader `closedAt: null`, 400 calendar; verify: tests + openOnly hit.
- [ ] 2.3 [backend] Idempotente abierto sin mutar; apps expired intactas; verify: tests.

## 3. Frontend

- [ ] 3.1 [frontend] Acción reopen + date picker si 400 + i18n + copy apps; verify: harness.

## 4. Verify

- [ ] 4.1 [infra] `pnpm nx run-many "-t=lint,typecheck,test" "-p=shared,api,web" --parallel=3` en verde.
