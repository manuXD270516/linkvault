## 1. Docs / ADR

- [x] 1.1 [infra] Fila **21** `group-weekly-digest` en `docs/design-v0.2.md` §6 + entrada `openspec-changes.yaml`; verify: `rg "group-weekly-digest" docs/design-v0.2.md openspec-changes.yaml`.
- [x] 1.2 [infra] Enmendar `docs/adr/ADR-035.md` (digest email OK; push digest fuera) + `.env.example` / RUNBOOK (`FEATURE_GROUP_DIGEST`, `GROUP_DIGEST_CRON`); verify: párrafo ADR + vars.

## 2. Shared

- [x] 2.1 [backend] Extender `notificationTypeSchema` + prefs schemas/defaults/tests con `group_weekly_digest` / `groupWeeklyDigest`; verify: zod + defaults ON.

## 3. Backend

- [x] 3.1 [backend] Persistencia prefs + GET/PATCH aceptan `groupWeeklyDigest`; verify: tests API.
- [x] 3.2 [backend] Aggregator: `group_links.sharedAt` en ventana ISO W−1; tope 10; strip note; puerto list groups paginado; verify: vacío / >10 / sin note.
- [x] 3.3 [backend] Job raíz `digest:week:{weekKey}` single-flight + ledger `(type, aggregateKey=weekKey:groupId, userId, email)` + Mailer plantilla (CTA grupo + link prefs) + `FEATURE_GROUP_DIGEST` en worker-config; verify: flag off, no double-send, no ledger vacío.

## 4. Frontend

- [x] 4.1 [frontend] Toggle digest en UI prefs + i18n; verify: harness PATCH `groupWeeklyDigest`.

## 5. Verify

- [x] 5.1 [infra] `pnpm nx run-many "-t=lint,typecheck,test" "-p=shared,api,worker,web" --parallel=3` en verde.
