## 1. Docs

- [x] 1.1 [infra] Fila **23** `know-someone-flag` en design-v0.2 §6 + openspec-changes.yaml; verify: `rg "know-someone-flag"`.

## 2. Shared + backend

- [x] 2.1 [backend] `knowSomeoneStateSchema` + optional `knowSomeone` en summary; body `{ flagged }`; verify: zod.
- [x] 2.2 [backend] `$addToSet`/`$pull` atómicos; PUT + listado grupo siempre con knowSomeone; omit en lista privada; ACL 404s; verify: tests + concurrencia básica.
- [x] 2.3 [backend] Account-deletion `$pull` knowSomeoneUserIds; verify: cascade.spec.

## 3. Frontend

- [x] 3.1 [frontend] Control + badge en card de grupo; merge DTO slim; sin control en privada; i18n; verify: harness.

## 4. Verify

- [x] 4.1 [infra] `pnpm nx run-many "-t=lint,typecheck,test" "-p=shared,api,web" --parallel=3` en verde.
