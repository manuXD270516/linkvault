## 1. Docs / plan

- [ ] 1.1 [infra] Fila **28** `job-discovery` + design.md F3 ya no diferido; openspec-changes.yaml; verify: `rg`.
- [ ] 1.2 [infra] ADR-043 (adapters API, boards v1, flag, no headless); verify: archivo.
- [ ] 1.3 [infra] RUNBOOK + `.env.example` FEATURE_DISCOVERY / DISCOVERY_CHAIN; verify: markdown.

## 2. Shared + domain

- [ ] 2.1 [backend] Schemas zod DiscoveryHit / query / response en shared; verify: tests.
- [ ] 2.2 [backend] Platform `remoteok` + canonicalizer si hace falta; verify: tests canonicalize.
- [ ] 2.3 [backend] Port DiscoveryBoardAdapter + mock adapter; verify: unit.

## 3. API

- [ ] 3.1 [backend] Adapters getonboard (`/api/v0/search/jobs`) + remoteok (cache Redis + egress); verify: nock/fixtures.
- [ ] 3.2 [backend] SearchDiscovery + GET search (page/pageSize/401/503/429) + rate-limit user; verify: tests.
- [ ] 3.3 [backend] Degraded parcial en `board=all`; verify: test.
- [ ] 3.4 [backend] URLs canónicas round-trip canonicalize; verify: tests.

## 4. Frontend

- [ ] 4.1 [frontend] Rutas `/descubrir`, nav, search+guardar privado+feedback+i18n+degraded+copy cobertura; verify: harness.

## 5. Verify

- [ ] 5.1 [infra] `pnpm nx run-many "-t=lint,typecheck,test" "-p=shared,api,web" --parallel=3` en verde.
