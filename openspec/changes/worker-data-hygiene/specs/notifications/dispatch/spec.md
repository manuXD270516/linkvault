## ADDED Requirements

### Requirement: Una entrega en vuelo se reintenta al vencer su lease

Cuando un job de avisos (`notify-fanout` o el digest semanal de grupo) encuentra una entrega del registro de
idempotencia en `claimed` dentro de su lease, el worker NO SHALL terminar el job dando esa entrega por resuelta: SHALL
procesar el resto de entregas del job y SHALL aplazar el job hasta después de que venza ese lease, sin gastar un intento
de la cola. En la nueva ejecución, las entregas ya completadas NO SHALL reenviarse. El número de aplazamientos por job
SHALL estar acotado; al agotarlo, el worker SHALL registrar un aviso con la cola, el `jobId` y el número de entregas en
vuelo, sin destinatarios ni direcciones de correo, y terminar el job.

#### Scenario: El worker murió a mitad de una entrega

- **GIVEN** una entrega email de Ana para el hecho H en `claimed` desde hace 1 minuto, con un lease de 5 minutos, cuyo worker murió antes de completarla
- **WHEN** el job recuperado vuelve a ejecutarse y encuentra la entrega en vuelo
- **THEN** el job SHALL aplazarse hasta después de que venza el lease
- **AND** en la ejecución aplazada la entrega SHALL retomarse y Ana SHALL recibir un email por H

#### Scenario: Quien la tenía terminó entretanto

- **GIVEN** un job aplazado porque la entrega de Ana para H estaba en vuelo
- **WHEN** el otro proceso completa esa entrega antes de que el job vuelva a ejecutarse
- **THEN** en la ejecución aplazada NO SHALL enviarse otro email a Ana por H

#### Scenario: Tope de aplazamientos

- **GIVEN** un job que ya se aplazó el número máximo de veces y sigue encontrando una entrega en vuelo
- **WHEN** vuelve a ejecutarse
- **THEN** el job SHALL terminar sin aplazarse
- **AND** SHALL registrarse un aviso con la cola, el `jobId` y el número de entregas en vuelo, sin direcciones de correo ni `userId`

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
