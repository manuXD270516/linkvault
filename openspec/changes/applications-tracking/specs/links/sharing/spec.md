## ADDED Requirements

### Requirement: Links disponibles para otros módulos

El módulo de links SHALL exponer al resto de la API una única entrada que permita saber si una persona puede ver un link
(lo tiene en su lista privada o está compartido en un grupo del que es miembro), obtener en una sola consulta la ficha
de varios links por su identificador —identificador, `displayUrl`, plataforma, estado del preview, título y empresa—, y
saber cuáles de unos links están compartidos en un grupo, también en una sola consulta. Un identificador mal formado
SHALL tratarse como un link que no existe, sin error. Ningún archivo de dominio, aplicación o infraestructura de otro
módulo SHALL leer las colecciones de links, y el incumplimiento SHALL ser detectado por el lint.

#### Scenario: Otro módulo pregunta si alguien ve un link

- **GIVEN** un usuario con un link en su lista privada, otro compartido en un grupo suyo y otro solo en un grupo ajeno
- **WHEN** otro módulo pregunta si puede ver cada uno
- **THEN** la respuesta SHALL ser verdadera, verdadera y falsa respectivamente

#### Scenario: Fichas de varios links a la vez

- **GIVEN** tres links guardados, uno de ellos sin preview
- **WHEN** otro módulo pide sus fichas junto con un identificador `no-es-un-id`
- **THEN** SHALL recibir las tres fichas, la del link sin preview sin título ni empresa, y nada para el identificador mal
  formado

#### Scenario: Qué links están en un grupo

- **GIVEN** un grupo con los links L1 y L2
- **WHEN** otro módulo pregunta cuáles de L1, L2 y L3 están en ese grupo
- **THEN** la respuesta SHALL ser L1 y L2

#### Scenario: Acceso directo a las colecciones de links

- **GIVEN** un archivo de dominio, aplicación o infraestructura de otro módulo de `apps/api`
- **WHEN** importa el repositorio o los schemas de `links`
- **THEN** el lint SHALL fallar
