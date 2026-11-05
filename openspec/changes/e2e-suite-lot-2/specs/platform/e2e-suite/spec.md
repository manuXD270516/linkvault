## ADDED Requirements

### Requirement: Lo admitido es lo de algún lote, y nada más

Una prueba SHALL contar como **admitida** en la suite reproducible si y solo si lleva **exactamente una** etiqueta de
lote (`@lot<N>`, con `N` entero positivo). El comando de la suite SHALL ejecutar, en el perfil `local`, **todas** las
pruebas admitidas, sea cual sea su lote, y en el perfil `remote` solo las admitidas que además son aptas para remoto.
Un filtro que pase quien ejecuta SHALL **acotar** esa selección, nunca ampliarla a pruebas no admitidas. Una prueba sin
etiqueta de lote NO SHALL ejecutarse con el comando de la suite, y su resultado en cualquier otro camino NO SHALL contar
como verificado.

#### Scenario: Una prueba del segundo lote entra en la corrida

- **GIVEN** una prueba etiquetada `@lot2` y otra etiquetada `@lot1`
- **WHEN** se ejecuta el comando de la suite con el perfil `local`
- **THEN** SHALL ejecutar las dos

#### Scenario: Una prueba sin lote no entra

- **GIVEN** una prueba del proyecto de la suite sin ninguna etiqueta de lote
- **WHEN** se ejecuta el comando de la suite
- **THEN** NO SHALL ejecutarla

#### Scenario: El filtro de quien ejecuta acota

- **GIVEN** pruebas admitidas de dos lotes y un filtro por la etiqueta propia de una de ellas
- **WHEN** se ejecuta el comando de la suite con ese filtro
- **THEN** SHALL ejecutar solo esa prueba
- **AND** un filtro que solo casa con pruebas no admitidas NO SHALL ejecutar ninguna

#### Scenario: Una prueba del segundo lote no apta para remoto

- **GIVEN** una prueba etiquetada `@lot2` que no está marcada como apta para remoto
- **WHEN** se ejecuta el perfil `remote`
- **THEN** NO SHALL ejecutarla

### Requirement: La cobertura se declara contra el catálogo

El repositorio SHALL mantener un **mapa de cobertura** con **una entrada por cada número** del recorrido de
`docs/catalogo-de-uso.md`, con el título de ese número, su estado (cubierto, cubierto en parte, previsto para un lote o
por decidir), el lote y, según el estado, las pruebas admitidas que lo cubren, lo que falta o el motivo. Una
**comprobación** que se ejecuta en cada corrida de la integración continua SHALL fallar, nombrando el número o la
prueba, si:

- falta en el mapa un número del catálogo, o el mapa tiene uno que el catálogo no tiene;
- el título de una entrada no coincide con el del catálogo para ese número;
- el mapa cita una prueba que no existe;
- una entrada cubierta, o cubierta en parte, cita una prueba que no está admitida, o no cita ninguna;
- una prueba admitida no está citada por ninguna entrada.

Un cambio que toque **solo** el catálogo, **solo** el mapa o **solo** una prueba SHALL volver a ejecutar la
comprobación: NO SHALL darse por buena con un resultado guardado de antes del cambio. La lista de pruebas y sus
etiquetas SHALL obtenerse del propio ejecutor de pruebas, no de una lectura del texto de los ficheros.

#### Scenario: Número del catálogo sin entrada

- **GIVEN** el catálogo con un número nuevo y el mapa sin entrada para él
- **WHEN** se ejecuta la comprobación
- **THEN** SHALL fallar nombrando ese número

#### Scenario: Catálogo renumerado

- **GIVEN** el catálogo con un número cuyo título cambió porque otra funcionalidad se insertó antes
- **WHEN** se ejecuta la comprobación
- **THEN** SHALL fallar nombrando el número, el título del mapa y el del catálogo

#### Scenario: El mapa cita una prueba inexistente

- **GIVEN** una entrada que cita una prueba cuyo título ya no existe en ese fichero
- **WHEN** se ejecuta la comprobación
- **THEN** SHALL fallar nombrando el fichero y el título citados

#### Scenario: Cobertura con una prueba no admitida

- **GIVEN** una entrada cubierta que cita una prueba sin etiqueta de lote
- **WHEN** se ejecuta la comprobación
- **THEN** SHALL fallar nombrando la entrada y la prueba

#### Scenario: Prueba admitida fuera del mapa

- **GIVEN** una prueba recién etiquetada con un lote que ninguna entrada cita
- **WHEN** se ejecuta la comprobación
- **THEN** SHALL fallar nombrando la prueba

#### Scenario: Cambio solo del catálogo

- **GIVEN** una comprobación que terminó en verde y un cambio posterior que solo añade un número al catálogo
- **WHEN** se vuelve a ejecutar la comprobación en el mismo checkout
- **THEN** SHALL ejecutarse de nuevo y fallar nombrando el número nuevo

### Requirement: La suite lleva el inventario de sus pruebas

El repositorio SHALL mantener, junto al mapa de cobertura, un **inventario** con **todas** las pruebas del proyecto de
la suite, por fichero, admitidas o no: su estado (admitida, con su lote; o no admitida, con el lote previsto o el
motivo) y las dependencias de entorno que le impiden ser reproducible. La comprobación del mapa SHALL fallar si una
prueba existe y no está en el inventario, si el inventario cita una prueba que no existe o si el estado de una prueba
en el inventario no coincide con su etiqueta de lote.

#### Scenario: Prueba nueva sin inventario

- **GIVEN** una prueba nueva, sin etiqueta de lote, que el inventario no recoge
- **WHEN** se ejecuta la comprobación
- **THEN** SHALL fallar nombrando el fichero y la prueba

#### Scenario: Estado que no coincide con la etiqueta

- **GIVEN** una prueba etiquetada `@lot2` que el inventario da como no admitida
- **WHEN** se ejecuta la comprobación
- **THEN** SHALL fallar nombrando la prueba y los dos estados

### Requirement: El segundo lote cubre la cuenta y la salida

El segundo lote SHALL admitir un **recorrido de cuenta** en el perfil `local` en el que una persona se registra,
mantiene la sesión al recargar sin que el token de acceso quede en el almacenamiento del navegador, verifica su email
con el enlace del correo que recibe, cambia su nombre y su contraseña, abre el aviso de privacidad desde su perfil,
recupera la contraseña con el enlace del correo —y la sesión que tenía abierta en otro navegador deja de valer—, y
borra su cuenta, tras lo cual esa cuenta ya no puede entrar.

- El correo SHALL leerse del Mailpit de la pila de la suite, y cada enlace SHALL apuntar al origen de la aplicación
  configurado para la corrida.
- Un enlace de verificación ya usado SHALL mostrar que no es válido.
- El recorrido SHALL registrar **una sola** cuenta por corrida y proyecto.
- El recorrido NO SHALL ser apto para remoto: registra una cuenta y lee correo.

#### Scenario: Verificación del email

- **GIVEN** una persona recién registrada en la pila de la suite
- **WHEN** pide reenviar el correo de verificación y abre el enlace del último correo que recibió
- **THEN** SHALL ver que su email quedó verificado y el aviso de email sin verificar SHALL desaparecer
- **AND** abrir otra vez el mismo enlace SHALL mostrar que no es válido o ha caducado

#### Scenario: Recuperación de la contraseña

- **GIVEN** una persona con sesión abierta en dos navegadores
- **WHEN** pide recuperar la contraseña desde el inicio de sesión y elige una nueva con el enlace del correo
- **THEN** SHALL poder entrar con la contraseña nueva
- **AND** la sesión del otro navegador SHALL dejar de valer

#### Scenario: Borrado de la cuenta

- **GIVEN** una persona con sesión y sin grupos con otros miembros
- **WHEN** borra su cuenta confirmando con su contraseña
- **THEN** SHALL volver al inicio de sesión
- **AND** entrar con esas credenciales SHALL fallar con el texto de credenciales incorrectas

#### Scenario: Enlace del correo hacia otro origen

- **GIVEN** un correo de la pila de la suite cuyo enlace apunta a un origen distinto del de la aplicación configurado
- **WHEN** el recorrido lee ese correo
- **THEN** SHALL fallar nombrando el origen del enlace y el esperado

## MODIFIED Requirements

### Requirement: El entorno de la suite es el versionado, no el del desarrollador

Las aplicaciones y la infraestructura que arranca el comando SHALL recibir **solo** un entorno **versionado en el
repositorio**, sin secretos, más una lista blanca de variables del sistema necesarias para ejecutar procesos. Ninguna
variable del `.env` de quien ejecuta que no esté en el entorno versionado SHALL llegar a esos procesos, y un cambio en
el `.env` local NO SHALL cambiar el resultado de la suite.

- La IA SHALL quedar en `AI_CHAIN=mock` con `AI_MOCK_MODE=replay` (y la cadena de embeddings en `mock`): una entrada sin
  fixture SHALL fallar, no inventar una salida.
- El correo SHALL salir por SMTP hacia el Mailpit del proyecto de compose de la suite, nunca hacia un proveedor real.
- Las funciones con flag SHALL quedar apagadas salvo las que necesite alguna prueba admitida, y el entorno SHALL
  declarar cuáles.
- La configuración que la aplicación **exige en producción** para una función que no tiene flag —la clave de la bóveda
  de claves propias— SHALL estar en el entorno versionado con un **valor de relleno** marcado como tal, de modo que esa
  función se comporte en la suite como en producción y no responda que no está disponible.
- Las anulaciones del propio comando (puertos del bloque, origen, resultado esperado del encaje, fallos provocados)
  SHALL darse como **argumentos**; el comando NO SHALL leerlas de su entorno, al que puede llegar el `.env`. Las
  credenciales de un destino remoto, que no pueden ir en argumentos, SHALL llegar por el entorno de la sesión, y el
  comando SHALL fallar sin ejecutar ninguna prueba si también están en alguno de los ficheros `.env` que se cargarían
  en su entorno.

#### Scenario: El desarrollador tiene la IA en synth

- **GIVEN** un `.env` local con `AI_MOCK_MODE=synth`
- **WHEN** se ejecuta el comando de la suite
- **THEN** `api` y `worker` SHALL arrancar con `AI_MOCK_MODE=replay`
- **AND** una tarea de IA con una entrada sin fixture SHALL terminar en fallo, no en una salida sintética

#### Scenario: Variable solo en el .env

- **GIVEN** un `.env` local con una variable que el entorno versionado no declara
- **WHEN** se ejecuta el comando de la suite
- **THEN** esa variable NO SHALL estar en el entorno de los procesos `api` ni `worker`
- **AND** cada variable del entorno versionado SHALL estar en ellos con su valor

#### Scenario: Puerto de la infraestructura en el .env

- **GIVEN** un `.env` local que cambia el puerto publicado de Mongo
- **WHEN** se ejecuta el comando de la suite
- **THEN** Mongo SHALL publicarse en el puerto del bloque de la suite, no en el del `.env`

#### Scenario: Anulación del comando en el .env

- **GIVEN** un `.env` local con una variable que nombra un puerto del bloque de la suite
- **WHEN** se ejecuta el comando de la suite sin argumentos
- **THEN** SHALL usar el bloque por defecto, como si la variable no existiera

#### Scenario: El correo no sale de la máquina

- **GIVEN** una prueba que provoca un correo
- **WHEN** se ejecuta con el comando de la suite
- **THEN** el correo SHALL aparecer en el Mailpit del proyecto de compose de la suite
- **AND** NO SHALL intentarse ningún envío a un proveedor real

#### Scenario: Guardar una clave propia en la pila de la suite

- **GIVEN** la pila que arranca el comando de la suite y una persona con sesión en su perfil
- **WHEN** guarda una clave de IA propia de un proveedor admitido
- **THEN** la API NO SHALL responder que la bóveda no está disponible
- **AND** el perfil SHALL mostrar ese proveedor como configurado

### Requirement: Cada destino se declara con un perfil que dice qué puede hacer la suite

La suite SHALL poder ejecutarse contra **cualquier origen** indicado por variable, con uno de dos perfiles:

- **`local`**: contra la pila que arranca el comando de la suite. Las pruebas MAY escribir precondiciones en la base de
  datos, leer el correo en Mailpit, vaciar contadores de la infraestructura y afirmar salidas concretas del mock de IA.
- **`remote`**: contra un origen que la suite no arranca ni controla. Solo SHALL ejecutar las pruebas marcadas como
  **aptas para remoto**, y esas pruebas NO SHALL escribir en la base de datos, leer correo, tocar la infraestructura
  ni afirmar una salida concreta de la IA. `remote` SHALL afirmar solo el desenlace que declara el destino.

Ningún origen SHALL estar escrito a mano dentro de una prueba: todos SHALL derivarse del origen configurado. En `remote`, el origen de la API SHALL derivarse del origen de la aplicación, y
un origen de API declarado distinto SHALL hacer fallar la corrida antes de ejecutar ninguna prueba.

Las operaciones que solo valen en `local` —leer o escribir la base de datos, tocar Redis o los contenedores y leer el
correo— SHALL hacerse **solo** a través de los ayudantes de la suite reservados a `local`, que toman las direcciones de
la pila de la corrida y nunca un valor escrito a mano. Una prueba apta para remoto que intente cualquiera de esas
operaciones SHALL fallar nombrando la operación, **en cualquier perfil**, también en `local` y en la integración
continua; y cualquier prueba que lo intente con el perfil `remote` SHALL fallar igual. El lint del proyecto de la suite
SHALL rechazar, fuera de esos ayudantes, el acceso directo a esas operaciones y los orígenes escritos a mano.

El perfil `remote` SHALL poder **ensayarse** contra la pila local que arranca el comando de la suite, **cuando se
pide** con una opción explícita, para ensayar un destino remoto antes de que exista. Sin esa opción, el comando NO SHALL
ejecutar el ensayo. En el ensayo, la IA SHALL tener configurado un proveedor externo **inalcanzable** y la cuenta
SHALL carecer de permiso de IA externa, de modo que el desenlace esperado sea el análisis degradado por falta de
permiso y cualquier llamada al proveedor lo cambie.

#### Scenario: Perfil remoto sin origen

- **GIVEN** el perfil `remote` sin origen configurado
- **WHEN** se ejecuta la suite
- **THEN** SHALL terminar con código distinto de cero diciendo que falta el origen
- **AND** NO SHALL ejecutar ninguna prueba

#### Scenario: Origen de la API distinto del de la aplicación

- **GIVEN** el perfil `remote` con un origen de aplicación y un origen de API declarado que no se deriva de él
- **WHEN** se ejecuta la suite
- **THEN** SHALL terminar con código distinto de cero nombrando los dos orígenes
- **AND** NO SHALL enviar credenciales a ninguno de ellos

#### Scenario: Ensayo del perfil remoto contra la pila local

- **GIVEN** la pila que arranca el comando de la suite y la opción de ensayo remoto
- **WHEN** se ejecuta el perfil `remote` contra su origen
- **THEN** SHALL ejecutar solo las pruebas aptas para remoto
- **AND** SHALL pasar sin escribir en la base de datos ni leer correo
- **AND** el análisis de encaje SHALL mostrarse degradado por falta de permiso, no por un error del proveedor

#### Scenario: Sin la opción de ensayo

- **GIVEN** el comando de la suite sin la opción de ensayo remoto
- **WHEN** termina la corrida
- **THEN** NO SHALL haberse ejecutado ninguna prueba con el perfil `remote`

#### Scenario: Prueba apta para remoto que escribe en la base de datos, en local

- **GIVEN** una prueba marcada como apta para remoto que usa el ayudante de la base de datos
- **WHEN** se ejecuta con el perfil `local`
- **THEN** SHALL fallar nombrando la operación de base de datos
- **AND** NO SHALL haber abierto ninguna conexión a la base de datos

#### Scenario: Prueba apta para remoto que lee el correo

- **GIVEN** una prueba marcada como apta para remoto que usa el ayudante del correo
- **WHEN** se ejecuta con cualquier perfil
- **THEN** SHALL fallar nombrando la operación de correo

#### Scenario: Ayudante local con el perfil remoto

- **GIVEN** una prueba no marcada como apta para remoto que usa el ayudante de Redis y que se lanza con el perfil
  `remote`
- **WHEN** llega a esa operación
- **THEN** SHALL fallar nombrando la operación y el perfil

#### Scenario: Acceso directo a la base de datos fuera de los ayudantes

- **GIVEN** una prueba del proyecto de la suite que importa el cliente de la base de datos directamente
- **WHEN** se ejecuta el lint de ese proyecto
- **THEN** SHALL fallar nombrando el fichero y la línea

#### Scenario: Origen escrito a mano

- **GIVEN** una prueba del proyecto de la suite con un origen de bucle local escrito en un literal
- **WHEN** se ejecuta el lint de ese proyecto
- **THEN** SHALL fallar nombrando el fichero y la línea
