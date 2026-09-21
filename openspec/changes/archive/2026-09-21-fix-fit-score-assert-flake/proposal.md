## Why

El CI de `study-roadmap` (#32) falló en `applications.controller.spec.ts` con
`expected JSON not to contain '41'`. El body listado **sí** omitía `fitScore` y llevaba
`fitScoreDegraded: true`; el `'41'` venía de substrings en ObjectIds (`…4179…`), no del
score. El assert por `JSON.stringify` es flaky y deja `main` en rojo sin bug de producto.

## What Changes

- Sustituir `JSON.stringify(…).not.toContain('41'|'78')` por comprobaciones sobre el
  objeto: sin propiedad `fitScore`, y `fitScoreDegraded === true`.

## Non-goals

- No cambia derivación de `fitScore` ni specs de aplicaciones/match.
