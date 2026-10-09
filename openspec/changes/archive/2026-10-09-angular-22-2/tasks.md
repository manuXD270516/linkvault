## 1. Subida

- [x] 1.1 [frontend] `package.json`: todos los `@angular/*`, `@angular-devkit/*` y `@schematics/angular` a `~22.2.1`;
  `pnpm install` y comprobar con `node` sobre `pnpm-lock.yaml` que todos resuelven a 22.2.x, un parche por familia.
  **Resultado:** framework (`core`, `common`, `compiler`, `compiler-cli`, `forms`, `language-service`, `localize`,
  `platform-browser`, `router`) 22.2.1; `cli`, `build`, `@angular-devkit/*`, `@schematics/angular`, `cdk` y
  `material` 22.2.2. `pnpm-workspace.yaml` sin cambios. Queda `@angular-devkit/core@22.1.8` transitivo vía
  `angular-eslint` (fuera del requirement).
- [x] 1.2 [frontend] Migraciones: revisar las que declaran los paquetes para 22.2 y aplicarlas con
  `nx migrate`/`ng update` si existen; si no, dejarlo anotado aquí. **Resultado:** ninguna. Las últimas de
  `@angular/core`, `@schematics/angular`, `@angular/cdk` y `@angular/material` son de 22.0.0.

## 2. Verificación

- [x] 2.1 [frontend] `pnpm nx affected -t lint,typecheck,test,i18n-check,build --base=origin/main` en verde.
  **Resultado (2026-10-09):** en el CI del PR #85 (run 37902866870) en verde: lint 11 proyectos, typecheck 10, test 10,
  i18n-check `web`, build 4. En local, en serie (`--parallel=1`), todo verde salvo `api:test`, que falla por
  `Hook timed out in 10000ms` en `beforeAll` de suites HTTP con Mongo en memoria; **la misma corrida con las
  dependencias de `main` (Angular 22.1.6) falla igual en las mismas suites**, así que es carga del equipo y no la
  subida (`api` no depende de ningún paquete cuyo lockfile cambie). `web:test` 1101/1101 dos veces seguidas.
- [x] 2.2 [frontend] `pnpm nx run web-e2e:e2e-stack` (critical-path `@lot1`) en verde en un bloque de puertos propio,
  sin tocar el proyecto Compose `linkvault` ni los puertos 3000/3001/4200/9000/27017/6379. **Resultado:** 2 passed
  sobre `main` con #85 fusionado (`6f970ca`), bloque por defecto del runner (api 3100, web 4300, mongo 27117, redis
  6479, almacén 9100), proyecto `linkvault-e2e-0ef8c240` desmontado con sus volúmenes al terminar.
- [x] 2.3 [infra] `pnpm exec openspec validate --all --no-interactive` en verde; PR abierto con el check de `ci` verde.
  **Resultado:** PR #85 con `lint, specs, typecheck, test, build` en verde, fusionado por el owner como `6f970ca`; la
  alerta Dependabot #1 (GHSA-ff3f-86qr-9cv3) pasó a `fixed` el 2026-10-09T08:15:24Z.
