## ADDED Requirements

### Requirement: La cascada borra las decisiones del plan semanal

La cascada atómica del borrado de cuenta SHALL eliminar, en la misma unidad de commit que las postulaciones, todos los
documentos de `weekly_plan_decisions` con el `userId` de la persona borrada, y NO SHALL tocar los de otras personas.

#### Scenario: Decisiones eliminadas

- **GIVEN** Ana con decisiones del plan semanal en dos semanas y Bob con una decisión
- **WHEN** Ana borra la cuenta con contraseña correcta
- **THEN** NO SHALL quedar documentos de `weekly_plan_decisions` con el `userId` de Ana
- **AND** la decisión de Bob SHALL seguir existiendo

#### Scenario: Fallo a mitad conserva las decisiones

- **GIVEN** Ana con decisiones del plan semanal y una escritura de la cascada que falla dentro de la unidad de commit
- **WHEN** la API responde error
- **THEN** las decisiones de Ana SHALL seguir existiendo
