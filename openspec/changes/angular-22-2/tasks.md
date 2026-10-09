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

- [ ] 2.1 [frontend] `pnpm nx affected -t lint,typecheck,test,i18n-check,build --base=origin/main` en verde.
- [ ] 2.2 [frontend] `pnpm nx run web-e2e:e2e-stack` (critical-path `@lot1`) en verde en un bloque de puertos propio,
  sin tocar el proyecto Compose `linkvault` ni los puertos 3000/3001/4200/9000/27017/6379.
- [ ] 2.3 [infra] `pnpm exec openspec validate --all --no-interactive` en verde; PR abierto con el check de `ci` verde.
