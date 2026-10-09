## ADDED Requirements

### Requirement: Paquetes del framework web alineados y parcheados

Los paquetes `@angular/*`, `@angular-devkit/*` y `@schematics/angular` declarados en el `package.json` raíz SHALL
declararse con el mismo rango de minor y resolverse en `pnpm-lock.yaml` a la misma versión `major.minor`. Dentro de
cada familia de publicación SHALL resolverse a un único parche: framework (`@angular/core` y sus hermanos de
`angular/angular`), herramientas (`@angular/cli`, `@angular/build`, `@angular-devkit/*`, `@schematics/angular`) y
componentes (`@angular/cdk`, `@angular/material`). Ninguna versión resuelta SHALL estar en un rango afectado por una
vulnerabilidad de severidad alta o crítica publicada; en particular SHALL ser `>= 22.2.0` (alerta de `@angular/router`
para `>= 22.0.0 < 22.2.0`). La subida NO SHALL añadir excepciones a `minimumReleaseAge` de pnpm: se elige el parche
más reciente que ya cumpla la antigüedad mínima.

Las copias transitivas que traiga otra dependencia (p. ej. `@angular-devkit/core` vía `angular-eslint`) quedan fuera
de este requirement.

#### Scenario: Versiones resueltas en el lockfile

- **WHEN** se leen del importer raíz de `pnpm-lock.yaml` las versiones resueltas de los paquetes `@angular/*`,
  `@angular-devkit/*` y `@schematics/angular`
- **THEN** todas SHALL compartir `major.minor`
- **AND** dentro de cada familia de publicación SHALL coincidir el parche
- **AND** todas SHALL ser `>= 22.2.0`

#### Scenario: Subida parcial de un paquete

- **GIVEN** un cambio que sube `@angular/router` a una minor distinta de la de `@angular/core`
- **WHEN** se revisa el `pnpm-lock.yaml` del cambio
- **THEN** el cambio NO SHALL cumplir este requirement

#### Scenario: Parche demasiado reciente

- **GIVEN** que el último parche publicado aún no cumple `minimumReleaseAge`
- **WHEN** se sube el framework
- **THEN** SHALL usarse el parche anterior que sí la cumple, sin tocar `minimumReleaseAgeExclude`
