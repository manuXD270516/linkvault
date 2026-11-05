## ADDED Requirements

### Requirement: Toma única de una entrega vencida

Cuando una entrega del registro de idempotencia está `claimed` y su lease venció, retomarla SHALL ser una operación
condicionada a que siga siendo la misma toma vencida que se leyó. Si dos workers intentan retomarla a la vez, SHALL
retomarla exactamente uno; el otro SHALL tratarla como en vuelo o como terminada, según el estado que lea después, y NO
SHALL enviar.

#### Scenario: Dos workers retoman la misma entrega vencida

- **GIVEN** una entrega email de Ana para el hecho H en `claimed` desde hace 6 minutos, con un lease de 5 minutos
- **WHEN** dos workers la intentan retomar a la vez
- **THEN** exactamente uno SHALL obtener `claimed`
- **AND** el otro SHALL obtener `in_flight` o `already_done`
- **AND** Ana SHALL recibir como máximo un email por H

#### Scenario: Retoma sin competencia

- **GIVEN** una entrega en `claimed` con el lease vencido y ningún otro worker
- **WHEN** un worker la intenta retomar
- **THEN** SHALL obtener `claimed`
