## ADDED Requirements

### Requirement: Calidad de la selección del plan semanal

`plan-week` SHALL ser una tarea evaluable con golden set `libs/ai/src/evals/plan-week/golden.jsonl` de al menos 8 casos
**sintéticos** (todos con la etiqueta `synthetic`), cuyo `expected` (`{ mustInclude: string[] }`, de 0 a 3 ids del
input) diga qué candidatas tiene que elegir cualquier respuesta aceptable. Al menos un caso SHALL tener una candidata
que cierra hoy, al menos uno SHALL tener una candidata con varias señales a la vez (cierre cercano, encaje y «conozco
a alguien») que el orden de reglas no pone entre las 3 primeras, y al menos uno SHALL tener 9 candidatas. Además de las
métricas genéricas, el reporte SHALL incluir:

- `valid_pick_rate`, **bloqueante**: casos `success` cuya salida pasa el validador determinista compartido
  (`validateWeeklyPlanPicks`: 3 ids distintos del input) sobre casos ejecutados;
- `must_include_rate`, **bloqueante**: media, sobre los casos `success` con `mustInclude` no vacío, de la fracción de
  `mustInclude` presente en la salida;
- `rules_agreement`, **informativa**: media, sobre los casos `success`, de cuántas de las 3 elecciones están entre
  `c1`, `c2` y `c3` (el orden de reglas), dividido por 3.

La línea base SHALL grabarse en `replay` con el mismo commit que el golden, el prompt y los fixtures.

#### Scenario: Elección que ignora lo que cierra hoy

- **GIVEN** un caso cuyo `mustInclude` es `c3` y un fixture cuya salida elige `c1`, `c2` y `c4`
- **WHEN** se ejecuta el corredor con `--provider=mock`
- **THEN** `must_include_rate` SHALL ser menor que 1 para ese conjunto
- **AND** el corredor SHALL fallar contra una línea base que tenga `must_include_rate` 1

#### Scenario: Acuerdo total con las reglas

- **GIVEN** un conjunto en el que todas las salidas eligen `c1`, `c2` y `c3`
- **WHEN** se calculan las métricas
- **THEN** `rules_agreement` SHALL valer 1 y SHALL figurar como informativa

#### Scenario: Golden con un caso no sintético

- **GIVEN** un caso de `plan-week/golden.jsonl` sin la etiqueta `synthetic`
- **WHEN** se carga el golden
- **THEN** la carga SHALL fallar nombrando la línea del caso
