## ADDED Requirements

### Requirement: Calidad del bucle de encaje

El eval de `match-cv` SHALL poder medir la correlación entre el `score` del informe y etiquetas humanas de 1 a 5, y el coste por vuelta del bucle de juez. Una vuelta de más SHALL verse en el reporte como coste, no solo como latencia. El reporte con el proveedor mock SHALL seguir siendo el que corre en CI.

#### Scenario: El coste de la segunda vuelta se ve

- **GIVEN** un caso del golden que usa dos vueltas de juez
- **WHEN** se corre el eval
- **THEN** el reporte SHALL distinguir el coste de cada vuelta

#### Scenario: CI no llama a un proveedor de pago

- **WHEN** el eval corre en CI
- **THEN** SHALL usar el mock en replay
- **AND** NO SHALL requerir una clave de proveedor externo
