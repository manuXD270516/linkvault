## ADDED Requirements

### Requirement: Señales de plan para otros módulos

La entrada única del módulo de links para otros módulos SHALL ofrecer, para un usuario y una lista de links, en un
número fijo de consultas que no depende de cuántos links se pidan, por cada link existente: su identificador,
`displayUrl`, título y empresa si los tiene, si está cerrado (`closedAt` presente), su `preview.expiresAt` si lo tiene,
y cuántas personas **distintas de ese usuario** marcaron «conozco a alguien» en ese link dentro de los grupos de los que
el usuario es miembro, contando una vez a quien lo marcó en varios, junto con el grupo del usuario con más marcas
(desempate por identificador ascendente). SHALL procesar como mucho 200 links por llamada. NO SHALL devolver
identificadores ni nombres de quienes marcaron. Un identificador mal formado o inexistente SHALL no aportar nada, sin
error.

#### Scenario: Conteo entre grupos sin repetir ni contarse

- **GIVEN** Ana miembro de G1 y G2, un link L en los dos, con Bob marcado en G1 y G2, Carla en G2 y Ana en G1
- **WHEN** otro módulo pide las señales de L para Ana
- **THEN** el conteo SHALL ser 2 y el grupo SHALL ser G2
- **AND** la respuesta NO SHALL contener el identificador de Bob ni de Carla

#### Scenario: Grupos ajenos no cuentan

- **GIVEN** un link L en G3, del que Ana no es miembro, con Bob marcado
- **WHEN** otro módulo pide las señales de L para Ana
- **THEN** el conteo SHALL ser 0 y no SHALL haber grupo

#### Scenario: Frescura

- **GIVEN** un link abierto con `expiresAt` `2026-12-01`, otro con `closedAt` y un identificador `no-es-un-id`
- **WHEN** otro módulo pide sus señales
- **THEN** el primero SHALL venir abierto con `expiresAt` `2026-12-01`, el segundo cerrado, y nada para el tercero

#### Scenario: Consultas fijas

- **GIVEN** 3 links y después 150 links
- **WHEN** otro módulo pide sus señales
- **THEN** el número de consultas a los repositorios de links y de pertenencia SHALL ser el mismo en las dos llamadas
