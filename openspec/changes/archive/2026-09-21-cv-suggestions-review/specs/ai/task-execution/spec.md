## ADDED Requirements

### Requirement: Crítica de sugerencias

El sistema SHALL poder ejecutar la tarea `critique-suggestions` por el mismo punto de entrada que el resto de tareas. Su salida SHALL ser un score entre 0 y 1 y una lista de issues. SHALL ser una tarea con datos personales a efectos de consentimiento y NO SHALL poder cachearse. El resultado SHALL validarse igual que el resto de salidas estructuradas: un intento de reparación y, si no valida, la tarea no entrega score.

#### Scenario: Salida que no valida

- **GIVEN** un modelo que responde algo que no es un score y una lista de issues
- **WHEN** se ejecuta `critique-suggestions`
- **THEN** NO SHALL devolverse un score inventado tras agotar la reparación
