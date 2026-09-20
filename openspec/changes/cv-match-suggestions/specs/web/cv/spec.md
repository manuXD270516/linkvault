## MODIFIED Requirements

### Requirement: Pantalla de mi CV

`/mi-cv` SHALL ser una ruta con sesión, cargada de forma diferida, accesible desde la barra de navegación con el
nombre "Mi CV". SHALL mostrar los CV guardados y las acciones de subir, marcar, ver lo leído y eliminar. En la pantalla
SHALL decirse "CV guardado"; el número de versión NO SHALL usarse para identificarlos.

SHALL mostrar siempre, junto a la subida, la línea **"Tu CV solo lo ves tú y no sale de LinkVault sin tu permiso. En
Perfil decides si un proveedor de IA externo puede analizarlo: antes de enviárselo sustituimos tu email, tus teléfonos,
tu dirección y tu documento de identidad por marcadores, y también tu nombre si lo activas allí."**, donde "Perfil"
SHALL ser un enlace a `/perfil`.

A esa línea base SHALL añadirse una frase de estado que diga **qué pasa hoy con el CV**, atada a la **vigencia** del
consentimiento —dado y sobre la versión vigente del texto— y **no a que el interruptor esté encendido**, con estos
tres estados y nunca dos a la vez:

- **sin permiso** (nunca dado, o retirado): **"Ahora mismo no has dado ese permiso, así que tu CV no sale de
  LinkVault."**;
- **permiso vigente** (dado sobre el texto vigente): **"Ahora mismo ese permiso está activo."**;
- **permiso caducado** (dado sobre una versión anterior del texto): **"Diste este permiso, pero el texto cambió: ahora
  mismo tu CV no sale de LinkVault. Revísalo en Perfil."**

Con el permiso caducado, la pantalla NO SHALL decir que el permiso está activo, porque un consentimiento sobre una
versión anterior no autoriza ningún envío y lo que `/mi-cv` y `/perfil` dicen del mismo permiso SHALL coincidir.
Mientras el SPA no conozca el estado del permiso —porque no lo ha cargado o porque su petición falló— SHALL mostrar
solo la línea base y NO SHALL afirmar que el permiso está activo, que está caducado ni que no lo está.

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

#### Scenario: Con el permiso vigente, la línea lo dice

- **GIVEN** Ana con el consentimiento dado sobre la versión vigente del texto
- **WHEN** abre `/mi-cv`
- **THEN** SHALL leer "Ahora mismo ese permiso está activo."
- **AND** SHALL seguir viendo dónde cambiarlo

#### Scenario: Sin permiso, la línea lo dice

- **GIVEN** Ana que nunca dio el permiso
- **WHEN** abre `/mi-cv`
- **THEN** SHALL leer "Ahora mismo no has dado ese permiso, así que tu CV no sale de LinkVault."

#### Scenario: Con el permiso caducado, las dos pantallas dicen lo mismo

- **GIVEN** Ana con el consentimiento dado sobre una versión anterior del texto
- **WHEN** abre `/mi-cv`
- **THEN** SHALL leer "Diste este permiso, pero el texto cambió: ahora mismo tu CV no sale de LinkVault. Revísalo en
  Perfil."
- **AND** NO SHALL leer que ese permiso está activo, igual que en `/perfil`

#### Scenario: Sin conocer el permiso no se afirma nada

- **GIVEN** la API devolviendo `500` al pedir el perfil
- **WHEN** Ana abre `/mi-cv`
- **THEN** SHALL ver la línea base de privacidad
- **AND** NO SHALL leer que el permiso está activo, que está caducado ni que no lo dio

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

### Requirement: Eliminar un CV desde el SPA

"Eliminar" SHALL pedir confirmación nombrando el archivo y avisando de que "el archivo se borra y no se puede
recuperar"; si es el marcado, SHALL añadir "Pasará a usarse tu CV más reciente". Confirmado, el CV SHALL desaparecer de
la lista sin recargar; cancelado, NO SHALL ocurrir nada.

Cuando ese CV tenga análisis de encaje hechos con él, la confirmación SHALL decir además que **también se borrarán**,
**diciendo cuántos**: "También se borrarán los N análisis de encaje que hiciste con este CV." Sin ningún análisis, esa
frase NO SHALL mostrarse. El recuento SHALL ser el de los análisis de quien borra sobre ese CV, y borrar un CV NO
SHALL anunciar los análisis de otro.

#### Scenario: Eliminar un CV

- **GIVEN** Ana con dos CV
- **WHEN** elimina el más antiguo y confirma
- **THEN** SHALL quedar una sola tarjeta en la lista

#### Scenario: Eliminar el marcado

- **GIVEN** Ana con dos CV y el más reciente marcado
- **WHEN** elimina el marcado
- **THEN** la confirmación SHALL avisar de que pasará a usarse su CV más reciente
- **AND** tras confirmar, el otro SHALL quedar marcado

#### Scenario: Borrar el CV se lleva sus análisis y lo dice

- **GIVEN** Ana con un CV y tres análisis de encaje hechos con él
- **WHEN** pulsa "Eliminar" en ese CV
- **THEN** la confirmación SHALL decir que también se borrarán los 3 análisis de encaje hechos con ese CV

#### Scenario: Un CV sin análisis no anuncia ninguno

- **GIVEN** Ana con un CV que nunca usó para analizar ninguna oferta
- **WHEN** pulsa "Eliminar" en ese CV
- **THEN** la confirmación NO SHALL mencionar ningún análisis de encaje

#### Scenario: Cancelar el borrado

- **WHEN** Ana abre la confirmación y cancela
- **THEN** la lista SHALL quedar igual y NO SHALL enviarse ninguna petición

### Requirement: Textos de mi CV en español e inglés

Todos los textos de esta pantalla —bienvenida, línea de privacidad con sus tres frases de estado, estados de la
lectura, acciones, avisos, confirmaciones y errores— SHALL estar marcados para traducción y traducidos al inglés, con
el español como idioma por defecto. La línea de privacidad SHALL traducirse **entera, con su enlace a `/perfil` dentro
de la misma unidad**, y NO SHALL componerse concatenando trozos ni insertando el enlace por fuera del texto traducido.

Cambiar el **contenido** de la línea de privacidad o de cualquiera de sus frases de estado SHALL obligar a un
**identificador de traducción nuevo**, de modo que la traducción vieja NO SHALL poder heredarse: reutilizar el
identificador dejaría vivo un `target` en inglés que promete lo que el español ya no promete.

SHALL existir además una comprobación automática, que forma parte de las que corren en cada cambio, de que **ni el
texto original ni ninguna de sus traducciones** afirman que ninguna IA lee el CV, que el CV no sale nunca de LinkVault
sin matices, ni ninguna otra promesa que este change ya no cumple.

#### Scenario: Traducciones completas

- **WHEN** se revisan los textos de `/mi-cv`
- **THEN** cada uno SHALL tener su unidad de traducción con su versión en inglés

#### Scenario: El enlace viaja dentro del texto

- **WHEN** se revisa la unidad de traducción de la línea de privacidad
- **THEN** el enlace a `/perfil` SHALL formar parte de esa unidad
- **AND** la versión en inglés SHALL poder colocarlo en otra posición de la frase

#### Scenario: Cambiar el texto obliga a un identificador nuevo

- **GIVEN** la línea de privacidad con su identificador de traducción actual
- **WHEN** se cambia su contenido
- **THEN** SHALL publicarse con un identificador nuevo
- **AND** la traducción anterior NO SHALL heredarse para el texto nuevo

#### Scenario: La promesa vieja no sobrevive en inglés

- **GIVEN** una traducción al inglés que dice que ninguna IA lee el CV
- **WHEN** corre la comprobación de los textos de `/mi-cv`
- **THEN** SHALL fallar nombrando esa unidad de traducción
- **AND** SHALL fallar igual si esa promesa está en el texto original
