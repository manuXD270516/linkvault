## 1. Docs

- [ ] 1.1 [infra] Fila **24** `browser-extension` en `docs/design-v0.2.md` §6 + entrada en `openspec-changes.yaml`; verify: `rg "browser-extension" docs/design-v0.2.md openspec-changes.yaml`.
- [ ] 1.2 [infra] `docs/adr/ADR-038.md` (`client` extension, refresh body, CSRF, rate-limit compartido, alcance CORS) + nota de enmienda en ADR-012; verify: archivo + link desde design.

## 2. Backend auth + CORS

- [ ] 2.1 [backend] Campo `client` en sesión (`web` default para legacy); rechazo cruzado web↔extension en ambos paths; revoke-all (password/reset) invalida refresh extensión; verify: tests sessions + credentials.
- [ ] 2.2 [backend] `POST /api/auth/extension/login|refresh|logout`: públicas + CSRF; login reusa limiter; sin Set-Cookie en éxito **ni** en errores de refresh/logout; logout `204` + body `{ refreshToken }`; verify: specs integración (401/403/409/429 + ausencia Set-Cookie).
- [ ] 2.3 [backend] CORS allowlist `EXTENSION_CORS_ORIGINS` + `.env.example`; verify: preflight allowlisted OK, otro origen sin ACAO.
- [ ] 2.4 [backend] Access extensión autentica `POST /api/links` y listado de grupos; verify: Bearer extensión → 201.

## 3. Extensión

- [ ] 3.1 [frontend] Scaffold Nx `apps/extension` MV3 (manifest, popup, SW, build); verify: `nx build extension` produce carpeta loadable.
- [ ] 3.2 [frontend] Popup: login/logout, `storage.local`, refresh single-flight + máx. 3 retries ante 409, CTA Guardar (privado default, grupo opcional), copy sin prometer preview, i18n ES/EN, header CSRF; verify: unit tests cliente.
- [ ] 3.3 [infra] RUNBOOK/README: unpacked + extension id → allowlist; verify: sección existe.

## 4. Verify

- [ ] 4.1 [infra] `pnpm nx run-many "-t=lint,typecheck,test" "-p=shared,api,extension" --parallel=3` (y `web` si tocó) en verde.
