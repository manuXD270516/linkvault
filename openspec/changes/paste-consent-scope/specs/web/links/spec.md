## ADDED Requirements

### Requirement: Aviso de adónde va lo pegado

El diálogo de «Pegar la descripción» SHALL decir, antes de enviar y sin que la persona tenga que hacer nada, que lo
pegado puede leerlo un proveedor de IA externo, que antes se le quitan los datos de contacto detectados, que se le pide
al proveedor que no lo guarde y que eso no puede comprobarse, y SHALL pedir que no se peguen datos personales ajenos a la
oferta. El texto en español SHALL ser «Puede leerla un proveedor de IA externo. Antes le quitamos los datos de contacto
que detectamos y le pedimos que no la guarde, pero no podemos comprobarlo. No pegues datos personales que no sean parte
de la oferta», y SHALL tener traducción al inglés. El aviso NO SHALL ser un permiso ni ofrecer una acción. NO SHALL
afirmar ni sugerir que lo enviado va anónimo, anonimizado o no identificable, y NO SHALL enumerar los tipos de dato que
se sustituyen; la comprobación automatizada de textos de privacidad SHALL cubrirlo en los dos idiomas y fallar nombrando
el idioma si lo hace.

#### Scenario: El aviso se ve antes de enviar

- **GIVEN** un link que alguien puede ver
- **WHEN** abre «Pegar la descripción»
- **THEN** el diálogo SHALL mostrar el aviso de que puede leerlo un proveedor de IA externo
- **AND** el aviso NO SHALL llevar ninguna casilla ni botón propio

#### Scenario: El aviso promete anonimato

- **GIVEN** una versión del aviso que dice que lo pegado se envía de forma anónima
- **WHEN** se ejecuta la comprobación automatizada de textos de privacidad
- **THEN** SHALL fallar nombrando el aviso y el idioma

#### Scenario: El aviso enumera lo que se sustituye

- **GIVEN** una traducción inglesa del aviso que nombra uno de los tipos de dato que la redacción sustituye
- **WHEN** se ejecuta la comprobación automatizada de textos de privacidad
- **THEN** SHALL fallar nombrando el aviso, el idioma y el tipo

#### Scenario: Aviso en inglés

- **GIVEN** la interfaz en inglés
- **WHEN** se abre «Pegar la descripción»
- **THEN** el aviso SHALL mostrarse traducido
