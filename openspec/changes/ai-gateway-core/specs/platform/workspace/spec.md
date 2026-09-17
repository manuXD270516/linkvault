## MODIFIED Requirements

### Requirement: Contratos del módulo de IA disponibles como tipos

`libs/ai` SHALL exponer los contratos de ADR-014 como tipos TypeScript: las capacidades de un proveedor, la forma de una
petición y de un resultado de completado, la definición de una tarea de IA y los errores tipados del módulo. `domain` SHALL
contener solo contratos y reglas puras; proveedores, adaptadores de persistencia y `runTask` SHALL vivir en `application` o
`infrastructure`; las definiciones de tareas en `tasks`; y la composición del módulo NestJS en `ai.module.ts`. Ningún
archivo de `domain` SHALL importar de `application`, `infrastructure`, `tasks` ni `ai.module.ts`.

#### Scenario: Los contratos compilan y son importables

- **WHEN** `apps/worker` importa los tipos públicos de `libs/ai` por su alias del workspace
- **THEN** el typecheck SHALL pasar sin errores

#### Scenario: El árbol de carpetas refleja el ADR-014

- **WHEN** se inspecciona la raíz de fuentes de `libs/ai`
- **THEN** SHALL existir `domain/ports`, `application`, `infrastructure/providers`, `infrastructure/prompts`,
  `infrastructure/fixtures` y `evals`
