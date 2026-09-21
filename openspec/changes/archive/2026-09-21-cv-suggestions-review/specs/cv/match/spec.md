## ADDED Requirements

### Requirement: Bucle de juez acotado

Tras el primer informe, el análisis SHALL poder pedir **como máximo una** crítica y, si procede, **como máximo una** revisión del informe. SHALL parar sin revisión cuando el score del juez sea mayor o igual que 0.8. SHALL parar sin más revisiones cuando el `score` entero del informe nuevo no supere al anterior en al menos 1 punto. SHALL guardar el informe de mayor `score` (empate: el de mayor `judgeScore`) junto con el `judgeScore` y el `judgeModel` de esa misma iteración. El juez SHALL recibir la oferta y un informe **sin** `cvFragment` ni `before`; los textos `after` SHALL llevar marcadores, sin PII reinyectada.

#### Scenario: Se para al llegar al umbral

- **GIVEN** un primer informe y un juez que lo puntúa 0.8 o más
- **WHEN** termina esa crítica
- **THEN** NO SHALL pedirse una revisión del informe
- **AND** el análisis SHALL guardar ese informe con su `judgeScore` y su `judgeModel`

#### Scenario: Se guarda el mejor, no el último

- **GIVEN** un informe con score 70 y una revisión que baja a 60
- **WHEN** termina el bucle
- **THEN** el informe guardado SHALL ser el de score 70
- **AND** su `judgeScore` SHALL ser el de la iteración del 70

#### Scenario: El juez no ve fragmentos del CV

- **GIVEN** un informe cuya evidencia incluye un `cvFragment` con un email real
- **WHEN** se llama a `critique-suggestions`
- **THEN** el input del juez NO SHALL contener ese email ni el `cvFragment`
- **AND** los `after` que reciba SHALL seguir llevando marcadores si los había

### Requirement: El juez no repite al generador si hay elección

Si hay al menos dos proveedores elegibles, el juez SHALL usar un proveedor o un modelo distinto del que generó el informe. Si solo hay uno, SHALL usar ese mismo. Si el juez no responde, el análisis SHALL poder terminar `done` con el informe del generador y sin `judgeScore`.

#### Scenario: Dos proveedores

- **GIVEN** Ollama y OpenRouter elegibles, y un informe generado por uno de ellos
- **WHEN** se pide la crítica
- **THEN** el juez SHALL ser el otro

#### Scenario: El juez no está

- **GIVEN** un informe de generador válido y un juez que no responde
- **WHEN** termina el análisis
- **THEN** SHALL quedar `done` con ese informe
- **AND** NO SHALL tener `judgeScore`

### Requirement: Pasos del bucle de juez

El conjunto cerrado de pasos del análisis SHALL incluir `critiquing-suggestions` y `revising-suggestions`. Un análisis en crítica SHALL reportar `critiquing-suggestions`; uno en revisión del informe, `revising-suggestions`. Esos pasos SHALL poder publicarse por el canal de eventos y devolverse al consultar el análisis, con la misma regla de no retroceso que el resto.

#### Scenario: La espera nombra la crítica

- **GIVEN** un análisis que entra a la crítica
- **WHEN** se consulta su paso o llega `analysis.step`
- **THEN** el paso SHALL ser `critiquing-suggestions`

## MODIFIED Requirements

### Requirement: Un análisis pedido, una sola ejecución

Un análisis pedido SHALL **ejecutarse una sola vez** como trabajo de la cola. El trabajo NO SHALL reintentarse a ciegas: un análisis que no se puede completar degrada o termina en fallo, y nunca vuelve a empezar por su cuenta porque el trabajo se entregó otra vez.

Dentro de esa única ejecución el generador MAY enviar el CV ya redactado hasta **dos** veces (informe inicial y como máximo una revisión). El juez NO SHALL contar como envío del CV. Entregar el mismo trabajo otra vez cuando el análisis ya está resuelto NO SHALL producir ningún envío nuevo.

La cuota de **análisis** (ventana por persona) SHALL contar **uno** si el informe final no está degradado, con independencia de cuántas llamadas a `runTask` hubo dentro. Cada llamada a `runTask` SÍ cuenta en el ledger por tarea. Si a mitad del bucle se agota la cuota de una tarea, el análisis SHALL guardar el mejor informe ya obtenido y NO SHALL quedarse en `running`.

- Al empezar cada entrega, la ejecución SHALL **releer el estado guardado del análisis** y SHALL abandonar sin hacer nada si ya está resuelto —`done` o `failed`—, si su plazo ya venció o **si el análisis ya no existe** porque se borró el CV con el que se hizo.
- Un análisis cuyo trabajo no vuelve NO SHALL quedarse en `running` para siempre: SHALL terminar en `failed` con código `internal_error`, y su salida SHALL ser pedir un análisis nuevo, no repetir el mismo.

#### Scenario: El mismo trabajo entregado tres veces

- **GIVEN** un análisis de Ana ya resuelto en `done`
- **WHEN** su trabajo se entrega dos veces más
- **THEN** ningún proveedor SHALL recibir una petición nueva
- **AND** el análisis guardado NO SHALL cambiar

#### Scenario: Un fallo no multiplica los envíos

- **GIVEN** un análisis que sale hacia un proveedor externo y cuya ejecución termina mal
- **WHEN** se cuenta cuántas veces salió el CV hacia ese proveedor
- **THEN** SHALL haber salido solo dentro de esa ejecución, como máximo dos veces
- **AND** el análisis SHALL haber degradado o terminado en `failed`, nunca vuelto a empezar por otra entrega del trabajo

#### Scenario: Las revisiones no pasan de dos envíos del CV

- **GIVEN** un análisis que entra al bucle de juez y sale hacia un proveedor externo
- **WHEN** se cuenta cuántas veces salió el CV hacia un proveedor externo en esa ejecución
- **THEN** SHALL haber salido como máximo dos veces
- **AND** el juez NO SHALL haber recibido el texto del CV ni PII reinyectada

#### Scenario: El trabajo que no vuelve

- **GIVEN** un análisis en `running` cuyo trabajo se perdió
- **WHEN** vence su plazo
- **THEN** SHALL leerse `failed` con código `internal_error`
- **AND** NO SHALL quedarse en `running`
