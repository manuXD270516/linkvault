## ADDED Requirements

### Requirement: Registro de entradas pendientes de fixture

En modo replay y solo durante los tests, una entrada sin fixture SHALL anotarse en un registro con la tarea, el idioma
de salida, la entrada y la clave que identifica su fixture, además de fallar como ya hace. El registro SHALL poder
escribirse desde varios procesos de test a la vez sin perder anotaciones, y al consumirse SHALL producir una sola
entrada por clave, de modo que grabar los fixtures sea una sola pasada. Un test que espera a
propósito la ausencia de fixture SHALL poder quedar fuera del registro. Fuera de los tests NO SHALL escribirse nada.

#### Scenario: Entrada anotada

- **GIVEN** un test en replay con una entrada sin fixture
- **WHEN** se ejecuta
- **THEN** el test SHALL fallar como hasta ahora
- **AND** el registro SHALL contener esa tarea, su idioma, su entrada y la clave de su fixture

#### Scenario: La misma entrada dos veces

- **GIVEN** dos archivos de test que corren a la vez
- **WHEN** ambos piden la misma entrada sin fixture
- **THEN** al consumirse el registro SHALL producirse una sola entrada para esa clave

#### Scenario: Test que espera la ausencia

- **GIVEN** un test que comprueba el error de fixture ausente
- **WHEN** se ejecuta
- **THEN** su entrada NO SHALL anotarse en el registro

#### Scenario: Fuera de los tests

- **GIVEN** la aplicación corriendo fuera de los tests
- **WHEN** ocurre una entrada sin fixture
- **THEN** NO SHALL escribirse ningún registro
