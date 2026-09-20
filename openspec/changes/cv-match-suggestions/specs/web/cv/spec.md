## MODIFIED Requirements

### Requirement: Pantalla de mi CV

`/mi-cv` SHALL ser una ruta con sesión, cargada de forma diferida, accesible desde la barra de navegación con el
nombre "Mi CV". SHALL mostrar los CV guardados y las acciones de subir, marcar, ver lo leído y eliminar. En la pantalla
SHALL decirse "CV guardado"; el número de versión NO SHALL usarse para identificarlos.

SHALL mostrar siempre, junto a la subida, la línea **"Tu CV solo lo ves tú y no sale de LinkVault sin tu permiso. En
Perfil decides si un proveedor de IA externo puede analizarlo: antes de enviárselo sustituimos tu email, tus teléfonos,
tu dirección y tu documento de identidad por marcadores, y también tu nombre si lo activas allí."**, donde "Perfil"
SHALL ser un enlace a `/perfil`.

Cuando el SPA sepa que el permiso está activo, SHALL añadir la frase **"Ahora mismo ese permiso está activo."** Mientras
no conozca el estado del permiso —porque no lo ha cargado o porque su petición falló— SHALL mostrar solo la línea base y
NO SHALL afirmar que el permiso está activo ni que no lo está.

Ese texto NO SHALL prometer que se pedirá permiso en el momento del análisis —la autorización es una preferencia del
perfil, no una pregunta— ni SHALL nombrar ninguna pantalla o control que todavía no exista. Tampoco SHALL prometer nada
que LinkVault no entregue hoy: que el proveedor externo no conserve lo enviado, que lo enviado sea anónimo, que el
archivo esté cifrado en reposo, que se borre solo pasado un tiempo, ni que el análisis se revise a mano.

Sin ningún CV SHALL mostrar "Sube tu CV y LinkVault podrá comparar tus habilidades con cada vacante." junto al botón de
subir. Mientras se carga la lista SHALL mostrar un estado de carga, y si la petición falla, el error con "Reintentar".

#### Scenario: Entrar sin CV

- **GIVEN** Ana con sesión y sin ningún CV
- **WHEN** abre `/mi-cv`
- **THEN** SHALL ver el texto de bienvenida, la línea de privacidad y el botón de subir
- **AND** NO SHALL ver ninguna tarjeta de CV

#### Scenario: La promesa está donde se pide el dato

- **WHEN** Ana abre `/mi-cv`
- **THEN** la línea de privacidad SHALL verse sin desplazarse ni abrir nada

#### Scenario: La autorización tiene dónde darse

- **GIVEN** Ana en `/mi-cv`
- **WHEN** sigue el enlace "Perfil" de la línea de privacidad
- **THEN** SHALL llegar a `/perfil`, donde está el control del permiso

#### Scenario: Con el permiso activo, la línea lo dice

- **GIVEN** Ana con el consentimiento para proveedores externos activo
- **WHEN** abre `/mi-cv`
- **THEN** SHALL leer que ese permiso está activo
- **AND** SHALL seguir viendo dónde cambiarlo

#### Scenario: Sin conocer el permiso no se afirma nada

- **GIVEN** la API devolviendo `500` al pedir el perfil
- **WHEN** Ana abre `/mi-cv`
- **THEN** SHALL ver la línea base de privacidad
- **AND** NO SHALL leer que el permiso está activo ni que está desactivado

#### Scenario: La línea no promete lo que no hacemos

- **WHEN** se revisa el texto de la línea de privacidad
- **THEN** NO SHALL decir que se pedirá permiso al analizar, que el proveedor externo no guarda nada, que el envío es
  anónimo, que el archivo está cifrado ni que caduca solo

#### Scenario: Ruta con sesión

- **GIVEN** una persona sin sesión
- **WHEN** abre `/mi-cv`
- **THEN** SHALL ir a `/login` y volver a `/mi-cv` tras entrar

#### Scenario: La lista no carga

- **GIVEN** la API devolviendo `500` al pedir la lista
- **WHEN** Ana abre `/mi-cv`
- **THEN** SHALL ver el error con "Reintentar"
- **AND** al pulsar "Reintentar" SHALL volver a pedirla

### Requirement: Textos de mi CV en español e inglés

Todos los textos de esta pantalla —bienvenida, línea de privacidad, estados de la lectura, acciones, avisos,
confirmaciones y errores— SHALL estar marcados para traducción y traducidos al inglés, con el español como idioma por
defecto. La línea de privacidad SHALL traducirse **entera, con su enlace a `/perfil` dentro de la misma unidad**, y NO
SHALL componerse concatenando trozos ni insertando el enlace por fuera del texto traducido.

#### Scenario: Traducciones completas

- **WHEN** se revisan los textos de `/mi-cv`
- **THEN** cada uno SHALL tener su unidad de traducción con su versión en inglés

#### Scenario: El enlace viaja dentro del texto

- **WHEN** se revisa la unidad de traducción de la línea de privacidad
- **THEN** el enlace a `/perfil` SHALL formar parte de esa unidad
- **AND** la versión en inglés SHALL poder colocarlo en otra posición de la frase
