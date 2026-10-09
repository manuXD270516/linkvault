## Why

El 2026-10-09 el repositorio pasó a público y, al activar Dependabot, apareció la alerta #1 (severidad alta):
`@angular/router` >=22.0.0 <22.2.0 permite un DoS en **SSR** con parámetros matriz numéricos. `apps/web` es una SPA
servida como estáticos (`@angular/build:application` sin `server`/`ssr`), así que el riesgo real es bajo; pero la
alerta abierta en un repo público es ruido permanente y la versión parcheada es una menor sin rupturas.

## What Changes

- Subir **todos** los paquetes `@angular/*`, `@angular-devkit/*` y `@schematics/angular`, incluidos `@angular/cdk` y
  `@angular/material`, de `~22.1.x` al mismo rango `~22.2.1`, y regenerar `pnpm-lock.yaml` con `pnpm install`.
  Resuelven al parche más reciente de cada familia que ya cumple `minimumReleaseAge` de pnpm: framework 22.2.1
  (22.2.2 salió el 2026-10-08 y pnpm pedía añadirlo a `minimumReleaseAgeExclude`, que no se toca), CLI y
  componentes 22.2.2. En `main` ya convivían parches distintos por familia (framework 22.1.6, CLI 22.1.8).
- Ejecutar las migraciones que declaren los paquetes para 22.2 (`nx migrate --run-migrations` o `ng update`), si las
  hay; si no las hay, queda dicho en `tasks.md`.
- No se toca Nx (23.2.1 admite `@angular/*` `>= 20 < 23`), ni `angular-eslint`, ni `@ngrx/signals` (`^22.0.0`).
- Requirement nuevo en `platform/workspace`: los paquetes del framework web van en la misma minor, con un parche
  por familia de publicación, sin excepciones de `minimumReleaseAge` y no por debajo de una versión con
  vulnerabilidades altas conocidas.

## Capabilities

### New Capabilities
Ninguna.

### Modified Capabilities
- `platform/workspace`: requirement nuevo "Paquetes del framework web alineados y parcheados".

## Impact

- **Código**: `package.json` y `pnpm-lock.yaml`; `apps/web` solo si una migración lo toca. Sin cambios funcionales.
- **Verificación**: `pnpm nx affected -t lint,typecheck,test,i18n-check,build` y `pnpm nx run web-e2e:e2e-stack`
  (critical-path `@lot1`) en verde, el e2e en su propio bloque de puertos sin tocar el proyecto Compose `linkvault`.
- **Seguridad**: cierra la alerta Dependabot #1 al fusionar.
- **ADRs**: coherente con ADR-007 (Angular 22 standalone, zoneless); sin decisión nueva, no crea ADR.
