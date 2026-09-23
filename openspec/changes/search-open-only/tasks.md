## 1. Docs

- [ ] 1.1 [infra] Fila **22** `search-open-only` en `docs/design-v0.2.md` §6 + `openspec-changes.yaml`; verify: `rg "search-open-only" docs/design-v0.2.md openspec-changes.yaml`.

## 2. Shared + API

- [ ] 2.1 [backend] `openOnly` vía `z.enum(['true','false']).transform(...)` (nunca coerce.boolean); verify: `true`/`false`/`maybe`/ausente.
- [ ] 2.2 [backend] AND `closedAt IS NULL` cuando openOnly; fake Meili entiende IS NULL; empty_query intacto; verify: abierto vs cerrado + empty_query.

## 3. Frontend

- [ ] 3.1 [frontend] Toggle + D3b bidireccional (openOnly↔applicationStatus) + i18n; verify: harness `openOnly=true` + status limpia openOnly.

## 4. Verify

- [ ] 4.1 [infra] `pnpm nx run-many "-t=lint,typecheck,test" "-p=shared,api,web" --parallel=3` en verde.
