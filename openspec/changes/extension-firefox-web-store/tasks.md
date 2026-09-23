## 1. Plan / ADR

- [x] 1.1 Fila **33** `extension-firefox-web-store` en design-v0.2 §6 + openspec-changes.yaml
- [x] 1.2 ADR-047 (CORS chrome+moz + FF packaging) + enmienda nota ADR-038; enlace §6

## 2. API CORS [backend]

- [x] 2.1 Validar solo esquemas `chrome-extension:` / `moz-extension:` en boot; tests preflight moz + rechazo https; `.env.example` + RUNBOOK (unpacked + UUID ambos browsers)

## 3. Extension build [frontend/devops]

- [x] 3.1 Wrapper `browserApi`; manifest Firefox (gecko id, min 121); outDir `dist/apps/extension-firefox`; target `build-firefox`
- [x] 3.2 `extension:lint-firefox` (contrato FF ≥ 121) en verify; typecheck/build chrome+firefox
- [x] 3.3 RUNBOOK checklist CWS + AMO (manual; URL prod; listing live fuera del DoD)

## 4. Verify

- [x] 4.1 lint/typecheck/test affected en verde
- [x] 4.2 Smoke: build-firefox + lint-firefox; CORS moz test pasa
