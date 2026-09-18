## ADDED Requirements

### Requirement: Registro de entradas pendientes de fixture

En modo replay y solo durante los tests, una entrada sin fixture SHALL anotarse en un registro con la tarea, el idioma
de salida, la entrada y el directorio de fixtures que le corresponde, además de fallar como ya hace. El registro SHALL
deduplicar por clave y SHALL poder consumirse para grabar esos fixtures en una sola pasada. Un test que espera a
propósito la ausencia de fixture SHALL poder quedar fuera del registro. Fuera de los tests NO SHALL escribirse nada.

#### Scenario: Entrada anotada

- **GIVEN** un test en replay con una entrada sin fixture
- **WHEN** se ejecuta
- **THEN** el test SHALL fallar como hasta ahora
- **AND** el registro SHALL contener esa tarea, su idioma, su entrada y su directorio de fixtures

#### Scenario: La misma entrada dos veces

- **WHEN** dos tests piden la misma entrada sin fixture
- **THEN** el registro SHALL tener una sola anotación

#### Scenario: Test que espera la ausencia

- **GIVEN** un test que comprueba el error de fixture ausente
- **WHEN** se ejecuta
- **THEN** su entrada NO SHALL anotarse en el registro

#### Scenario: Fuera de los tests

- **GIVEN** la aplicación corriendo fuera de los tests
- **WHEN** ocurre una entrada sin fixture
- **THEN** NO SHALL escribirse ningún registro
