## MODIFIED Requirements

### Requirement: Pantalla de mi CV

`/mi-cv` SHALL ser una ruta con sesión, cargada de forma diferida, accesible desde la barra de navegación con el
nombre "Mi CV". SHALL mostrar los CV guardados y las acciones de subir, marcar, ver lo leído y eliminar. En la pantalla
SHALL decirse "CV guardado"; el número de versión NO SHALL usarse para identificarlos.

SHALL mostrar siempre, junto a la subida, la línea **"Tu CV solo lo ves tú y no sale de LinkVault sin tu permiso. En
Perfil decides si un proveedor de IA externo puede analizarlo: antes de enviárselo sustituimos tu email, tus teléfonos,
tu dirección, tu documento de identidad y las URL por marcadores, y también tu nombre, salvo que lo desactives
allí."**, donde "Perfil" SHALL ser un enlace a `/perfil`.

Esa enumeración SHALL decir **lo que el sistema hace hoy**: `redactName` nace activado, así que la línea NO SHALL
condicionar la sustitución del nombre a que alguien la active, y SHALL ser la misma, dato por dato, que la de `/perfil`
y la del resumen del diálogo de encaje. Una frase que promete de menos es tan falsa como una que promete de más, y
estaba justo en la línea que obligamos a re-versionar por prometer de más.

A esa línea base SHALL añadirse una frase de estado que diga **qué pasa hoy con el CV**, atada a la **vigencia** del
consentimiento —dado y sobre la versión vigente del texto— y **no a que el interruptor esté encendido**, con estos
tres estados y nunca dos a la vez:

- **sin permiso** (nunca dado, o retirado): **"Ahora mismo no has dado ese permiso, así que tu CV no sale de
  LinkVault."**;
- **permiso vigente** (dado sobre el texto vigente): **"Ahora mismo ese permiso está activo: al analizar una oferta,
  tu CV redactado sale de LinkVault hacia el proveedor externo."**;
- **permiso caducado** (dado sobre una versión anterior del texto): **"Diste este permiso, pero el texto cambió: ahora
  mismo tu CV no sale de LinkVault. Revísalo en Perfil."**

De los tres estados, los dos inofensivos dicen que el CV no sale de LinkVault; el vigente es el único con consecuencia
y por eso SHALL decirla, no limitarse a declarar el permiso activo: quien lo lea tiene que saber, sin abrir nada, que
su CV redactado sale hacia un tercero cada vez que analice una oferta.

Con el permiso caducado, la pantalla NO SHALL decir que el permiso está activo, porque un consentimiento sobre una
versión anterior no autoriza ningún envío y lo que `/mi-cv` y `/perfil` dicen del mismo permiso SHALL coincidir.
Mientras el SPA no conozca el estado del permiso —porque no lo ha cargado o porque su petición falló— SHALL mostrar
solo la línea base y NO SHALL afirmar que el permiso está activo, que está caducado ni que no lo está.

Ese texto NO SHALL prometer que se pedirá permiso en el momento del análisis —la autorización es una preferencia del
perfil, no una pregunta— ni SHALL nombrar ninguna pantalla o control que todavía no exista. Tampoco SHALL inventar
afirmaciones falsas: que el proveedor externo no conserve lo enviado, que lo enviado sea anónimo, ni que el análisis se
revise a mano. La línea corta NO SHALL inventar detalles de cifrado en reposo ni de retención/caducidad del archivo;
para almacenamiento y retención SHALL incluir un enlace a `/privacidad`, donde esos detalles MAY afirmarse cuando la
configuración de producción los tenga (ver `web/privacy` y `cv/documents`).

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

#### Scenario: Con el permiso vigente, la línea dice la consecuencia

- **GIVEN** Ana con el consentimiento dado sobre la versión vigente del texto
- **WHEN** abre `/mi-cv`
- **THEN** SHALL leer "Ahora mismo ese permiso está activo: al analizar una oferta, tu CV redactado sale de LinkVault
  hacia el proveedor externo."
- **AND** SHALL seguir viendo dónde cambiarlo

#### Scenario: La línea del nombre dice lo que el sistema hace

- **WHEN** Ana lee la línea de privacidad sin haber tocado nunca sus preferencias de IA
- **THEN** SHALL leer que su nombre se sustituye salvo que lo desactive en Perfil
- **AND** NO SHALL leer que su nombre solo se sustituye si lo activa allí

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

- **WHEN** se revisa el texto de la línea corta de privacidad en `/mi-cv`
- **THEN** NO SHALL decir que se pedirá permiso al analizar, que el proveedor externo no guarda nada ni que el envío es
  anónimo
- **AND** NO SHALL inventar en esa línea corta que el archivo está cifrado ni que caduca solo; esos detalles, cuando
  apliquen en prod, viven en `/privacidad`
- **AND** la pantalla SHALL ofrecer un enlace a `/privacidad` para almacenamiento y retención

#### Scenario: Enlace a /privacidad visible en /mi-cv

- **GIVEN** Ana en `/mi-cv`
- **WHEN** busca información de almacenamiento o retención del CV
- **THEN** SHALL ver un enlace visible a `/privacidad`
- **AND** al seguirlo SHALL llegar a `/privacidad`

#### Scenario: Ruta con sesión

- **GIVEN** una persona sin sesión
- **WHEN** abre `/mi-cv`
- **THEN** SHALL ir a `/login` y volver a `/mi-cv` tras entrar

#### Scenario: La lista no carga

- **GIVEN** la API devolviendo `500` al pedir la lista
- **WHEN** Ana abre `/mi-cv`
- **THEN** SHALL ver el error con "Reintentar"
- **AND** al pulsar "Reintentar" SHALL volver a pedirla
