## 1. Docs

- [x] 1.1 [infra] Fila **25** `application-analytics` en design-v0.2 §6 + openspec-changes.yaml; verify: `rg "application-analytics"`.
- [x] 1.2 [infra] ADR-039 (buckets ADR-024, stale 10d + elegibilidad, cap 20, on-read; dwell/grupo diferidos); verify: archivo existe.

## 2. Backend

- [x] 2.1 [backend] Schemas shared del response analytics (sin dwell) + zod; verify: unit schema.
- [x] 2.2 [backend] `GET /api/applications/analytics` (byStatus, open/closed/accepted, stale 10d cap 20, empty 200); verify: tests incl. accepted≠closed y cap.

## 3. Frontend

- [x] 3.1 [frontend] Ruta insights personal + enlace descubrible desde aplicaciones + i18n + empty state + navegación a estancadas; verify: harness.

## 4. Verify

- [x] 4.1 [infra] `pnpm nx run-many "-t=lint,typecheck,test" "-p=shared,api,web" --parallel=3` en verde.
