## 1. Docs / plan

- [ ] 1.1 [infra] Fila **28** `demo-seed` + nota **F3 cerrado / discovery post-v1** en design-v0.2 §6 y design.md; verify: `rg`.
- [ ] 1.2 [infra] ADR-042 (CLI canónico, profile, credenciales fijas, allowlist URI, no Meili directo); verify: archivo.
- [ ] 1.3 [infra] RUNBOOK / `docs/demo.md`: arranque profiles, flags, credenciales D2, checklist tour con skips (#47 / CV); verify: markdown.

## 2. Seed CLI

- [ ] 2.1 [backend] Target `api:seed-demo` + guards D4 (ALLOW_DEMO_SEED, no prod, allowlist Mongo host); verify: tests de rechazo.
- [ ] 2.2 [backend] Dataset D3 idempotente (claves D2; closed+stale+salary+link cerrado); verify: segunda corrida sin duplicar.
- [ ] 2.3 [backend] Search solo vía backfill/outbox existente (no SDK Meili); verify: test o assert de no-llamada + backfill.

## 3. Compose

- [ ] 3.1 [infra] Meilisearch `profiles: ['search', 'demo']` (sin segundo sembrador); verify: `docker compose --profile demo config`.

## 4. Verify

- [ ] 4.1 [infra] Seed local + checklist browser documentado; lint/typecheck afectados en verde.
