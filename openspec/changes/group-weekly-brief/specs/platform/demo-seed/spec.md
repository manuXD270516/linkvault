## ADDED Requirements

### Requirement: El grupo demo alimenta la semana del grupo

El seed demo SHALL fijar, por el mismo camino de edición de preview que el resto del dataset, habilidades en tres
links del grupo demo: el link abierto con salario (Docker, TypeScript, NestJS), el de la postulación quieta (Docker,
Kotlin) y el que vence pronto (Docker, TypeScript, SQL). Con eso y el link que vence en 3 días, la semana del grupo demo
calculada por el worker el día de la corrida SHALL tener al menos tres viñetas: `closing_soon`,
`skill_demand:docker` con `count` 3 y `skill_demand:typescript` con `count` 2. Una segunda corrida NO SHALL duplicar
habilidades.

#### Scenario: El grupo demo tiene semana

- **GIVEN** Mongo local sin datos demo y guards OK
- **WHEN** se ejecuta `api:seed-demo` y después el worker calcula la semana en curso
- **THEN** el documento del grupo demo SHALL tener las viñetas `closing_soon`, `skill_demand:docker` y
  `skill_demand:typescript`, en ese orden

#### Scenario: Segunda corrida sin duplicados

- **GIVEN** el seed ya aplicado
- **WHEN** se vuelve a ejecutar `api:seed-demo`
- **THEN** cada uno de los tres links SHALL tener sus habilidades una sola vez
