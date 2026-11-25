## ADDED Requirements

### Requirement: La cascada borra las elecciones del plan semanal con IA

La cascada atómica del borrado de cuenta SHALL eliminar, en la misma unidad de commit que las postulaciones, todos los
documentos de `weekly_plan_llm_picks` con el `userId` de la persona borrada, y NO SHALL tocar los de otras personas ni
`weekly_plan_llm_budget`, que no guarda datos de nadie.

#### Scenario: Elecciones eliminadas

- **GIVEN** Ana con documentos de `weekly_plan_llm_picks` en dos semanas y Bob con uno
- **WHEN** Ana borra la cuenta con contraseña correcta
- **THEN** NO SHALL quedar documentos de `weekly_plan_llm_picks` con el `userId` de Ana
- **AND** el documento de Bob y los de `weekly_plan_llm_budget` SHALL seguir existiendo

#### Scenario: Fallo a mitad conserva las elecciones

- **GIVEN** Ana con documentos de `weekly_plan_llm_picks` y una escritura de la cascada que falla dentro de la unidad de
  commit
- **WHEN** la API responde error
- **THEN** los documentos de Ana SHALL seguir existiendo
