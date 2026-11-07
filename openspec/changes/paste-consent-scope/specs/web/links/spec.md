## ADDED Requirements

### Requirement: Aviso de adónde va lo pegado

El diálogo de «Pegar la descripción» SHALL decir, antes de enviar y sin que la persona tenga que hacer nada:

- que lo pegado puede leerlo un proveedor de IA externo;
- que antes se le quitan los datos de contacto detectados;
- que **el resto se envía tal cual y puede identificar a personas**;
- que solo se usan proveedores que dicen no guardarlo, y que eso no puede comprobarse;
- y SHALL pedir que no se peguen datos personales ajenos a la oferta.

El texto en español SHALL ser «Puede leerlo un proveedor de IA externo. Antes le quitamos los datos de contacto que
detectamos; el resto se envía tal cual y puede identificar a personas. Solo usamos proveedores que dicen no guardarlo,
aunque no podemos comprobarlo. No pegues datos personales ajenos a la oferta.», y en inglés «An external AI provider may
read it. We first remove the contact details we detect; the rest is sent as-is and may identify people. We only use
providers that say they don't keep it, though we can't verify that. Don't paste personal details unrelated to the job
post.». Si el texto cambia, la frase de que el resto se envía tal cual NO SHALL quitarse. El aviso NO SHALL ser un
permiso ni ofrecer una acción. NO SHALL afirmar ni sugerir que lo enviado va anónimo, anonimizado o no identificable, y
NO SHALL enumerar los tipos de dato que se sustituyen. La comprobación automatizada de textos de privacidad SHALL
cubrirlo en los dos idiomas y fallar nombrando el idioma si promete anonimato, si nombra un tipo de dato o si le falta la
frase de que el resto se envía tal cual.

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

#### Scenario: El aviso calla que el resto se envía tal cual

- **GIVEN** una versión del aviso, en español o en inglés, sin la frase de que el resto se envía tal cual y puede
  identificar a personas
- **WHEN** se ejecuta la comprobación automatizada de textos de privacidad
- **THEN** SHALL fallar nombrando el aviso y el idioma

#### Scenario: Aviso en inglés

- **GIVEN** la interfaz en inglés
- **WHEN** se abre «Pegar la descripción»
- **THEN** el aviso SHALL mostrarse traducido
