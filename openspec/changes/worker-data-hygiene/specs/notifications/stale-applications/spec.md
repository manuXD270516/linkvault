## ADDED Requirements

### Requirement: Las postulaciones ya avisadas no consumen el lote

El detector de stale SHALL elegir su lote solo entre las postulaciones elegibles que **no** tengan una marca de stale
confirmada para su `statusChangedAt` actual, de la más antigua a la más reciente por `statusChangedAt`. Ninguna cantidad
de postulaciones ya avisadas y todavía abiertas SHALL impedir que una postulación recién estancada se avise en la
siguiente pasada.

#### Scenario: Más avisadas que el tamaño del lote

- **GIVEN** 60 postulaciones abiertas, estancadas y ya avisadas, y una postulación P recién estancada sin avisar
- **WHEN** corre el detector con un lote de 50
- **THEN** P SHALL estar en el lote y su aviso SHALL encolarse

#### Scenario: Orden de antigüedad

- **GIVEN** 60 postulaciones estancadas sin avisar con distintos `statusChangedAt`
- **WHEN** corre el detector con un lote de 50
- **THEN** SHALL elegir las 50 de `statusChangedAt` más antiguo
