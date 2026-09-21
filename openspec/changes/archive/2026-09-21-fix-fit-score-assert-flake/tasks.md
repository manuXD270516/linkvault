## 1. Assert

- [x] 1.1 [api] En `applications.controller.spec.ts`, escenario «El análisis nuevo sale básico…»: quitar `JSON.stringify(…).not.toContain('41'|'78')`; dejar `fitScoreDegraded` y `not.toHaveProperty('fitScore')`. Verificar con `pnpm nx run api:test -- applications.controller.spec`.
