## Purpose

Garantiza que las pruebas end-to-end de LinkVault se puedan ejecutar igual en cualquier máquina, en CI y contra un
entorno remoto, con un solo comando, sin depender de lo que cada cual tenga levantado y sin que una prueba que no puede
fallar se cuente como verde.

## ADDED Requirements

### Requirement: La suite se ejecuta con un solo comando local que apaga lo que arranca

El repositorio SHALL ofrecer **un único comando** que, sin pasos previos a mano salvo instalar dependencias y
navegadores, levante la infraestructura local, sirva `api`, `worker` y `web` desde el código del checkout, siembre lo
que la suite necesita, ejecute la suite y **apague todo lo que arrancó**: los procesos que lanzó, con sus procesos hijos,
y la infraestructura con sus volúmenes.

- La infraestructura SHALL levantarse con el **mismo comando** que `platform/local-environment` define para el arranque
  local, bajo un **nombre de proyecto de compose propio de la suite y distinto por checkout y bloque de puertos**, de
  modo que no comparta contenedores ni volúmenes con la pila de desarrollo ni con la suite de otro checkout.
- El apagado SHALL ocurrir **también** cuando la suite falla, cuando falla cualquier fase anterior y cuando la corrida
  se interrumpe (Ctrl+C o señal de terminación). NO SHALL terminar procesos que la corrida no lanzó.
- El código de salida SHALL ser distinto de cero si falla cualquier fase o cualquier prueba, y el mensaje SHALL nombrar
  la fase que falló (comprobación previa, infraestructura, arranque de una aplicación, siembra, suite o apagado).
- El mismo comando SHALL ser el que ejecuta CI; NO SHALL existir una segunda forma de montar la pila escrita solo para
  CI.

#### Scenario: Corrida completa en una máquina limpia

- **GIVEN** un checkout con dependencias y navegadores instalados, Docker en marcha y ninguna pila del proyecto levantada
- **WHEN** se ejecuta el comando de la suite
- **THEN** SHALL levantar la infraestructura, servir `api`, `worker` y `web`, ejecutar la suite y terminar
- **AND** al terminar NO SHALL quedar ningún contenedor ni volumen del proyecto de compose de la suite
- **AND** NO SHALL quedar vivo ningún proceso lanzado por la corrida
- **AND** todos los puertos del bloque de la suite SHALL estar libres

#### Scenario: Fallo de una prueba

- **GIVEN** una prueba de la suite que falla
- **WHEN** se ejecuta el comando de la suite
- **THEN** SHALL terminar con código distinto de cero
- **AND** SHALL apagar los procesos y la infraestructura igual que en una corrida en verde

#### Scenario: Interrupción a mitad de corrida

- **GIVEN** una corrida con la infraestructura y las aplicaciones ya arrancadas
- **WHEN** se interrumpe con Ctrl+C
- **THEN** SHALL apagar los procesos que lanzó y la infraestructura de su proyecto de compose antes de salir

#### Scenario: La pila de desarrollo no se toca

- **GIVEN** la pila de desarrollo del proyecto levantada con su nombre de compose habitual y el servidor de desarrollo
  de `web` en marcha
- **WHEN** se ejecuta el comando de la suite hasta el final
- **THEN** los contenedores y volúmenes de la pila de desarrollo SHALL seguir existiendo sin cambios
- **AND** el servidor de desarrollo de `web` SHALL seguir siendo el mismo proceso

### Requirement: La corrida nunca prueba procesos ajenos

La suite SHALL usar un **bloque de puertos propio**, distinto del de la pila de desarrollo y configurable, para la
infraestructura y para `api`, `worker` y `web`. Antes de arrancar nada, el comando SHALL comprobar que **todos** los
puertos del bloque están libres —nadie acepta conexiones en ellos, ni por IPv4 ni por IPv6 de bucle local, y se pueden
ocupar— y, si alguno no lo está, SHALL terminar **sin arrancar nada** y nombrando el puerto.

- La suite NO SHALL reutilizar un servidor que ya estuviera escuchando.
- Si en el mismo checkout hay un servidor de desarrollo de `api` o `worker` en marcha, que compila en los mismos
  ficheros de salida, el comando SHALL terminar sin arrancar nada nombrándolo. Un servidor de desarrollo de **otro**
  checkout NO SHALL detenerlo, aunque la ruta de ese checkout contenga la de este.
- Tras levantar la infraestructura, todo puerto publicado por su proyecto de compose SHALL estar dentro del bloque; si
  no, la corrida SHALL fallar nombrando el puerto y el servicio.
- Tras arrancar cada aplicación, **cada** proceso que escucha en su puerto, en cualquier interfaz, SHALL pertenecer a
  los procesos que lanzó la corrida; un proceso en escucha cuyo dueño no se puede determinar SHALL contar como ajeno.
  Si no, la corrida SHALL fallar nombrando el puerto y el proceso ajeno.
- Si un proceso lanzado por la corrida termina antes de tiempo o informa de que su puerto está en uso, la corrida SHALL
  fallar nombrándolo, aunque otro proceso responda en ese puerto.
- Una aplicación SHALL darse por arrancada solo cuando responde en su puerto del bloque: `api` y `worker` por su salud,
  que SHALL declarar mongo y redis en `up`; `web`, con el documento del SPA construido para producción.
- Tras el apagado, el comando SHALL volver a comprobar que el bloque quedó libre y SHALL fallar nombrando el puerto que
  siga ocupado.

#### Scenario: Puerto ocupado por otra sesión

- **GIVEN** otro proceso escuchando en el puerto de `api` del bloque de la suite
- **WHEN** se ejecuta el comando de la suite
- **THEN** SHALL terminar con código distinto de cero nombrando ese puerto
- **AND** NO SHALL haber levantado ningún contenedor ni proceso

#### Scenario: Puerto ocupado solo en la interfaz de bucle IPv4

- **GIVEN** otro proceso escuchando en el puerto de `api` del bloque solo en `127.0.0.1`
- **WHEN** se ejecuta el comando de la suite
- **THEN** SHALL terminar con código distinto de cero nombrando ese puerto, sin arrancar nada

#### Scenario: Otro proceso atiende el puerto de una aplicación lanzada

- **GIVEN** una corrida en la que, tras la comprobación previa, otro proceso pasa a atender el puerto de `worker`
- **WHEN** termina la fase de arranque de las aplicaciones
- **THEN** SHALL fallar nombrando el puerto de `worker`
- **AND** NO SHALL ejecutar ninguna prueba

#### Scenario: Servidor de desarrollo del mismo checkout

- **GIVEN** un servidor de desarrollo de `api` en marcha en el mismo checkout
- **WHEN** se ejecuta el comando de la suite
- **THEN** SHALL terminar con código distinto de cero nombrando ese proceso, sin arrancar nada

#### Scenario: Servidor de desarrollo de otro checkout anidado

- **GIVEN** un servidor de desarrollo de `api` en marcha en otro checkout cuya ruta está dentro de la de este
- **WHEN** se ejecuta el comando de la suite en este checkout
- **THEN** NO SHALL detenerse por ese proceso

#### Scenario: Un proceso arrancado muere al empezar

- **GIVEN** una configuración que hace que `worker` termine al arrancar
- **WHEN** se ejecuta el comando de la suite
- **THEN** SHALL fallar en la fase de arranque nombrando `worker`
- **AND** NO SHALL ejecutar ninguna prueba

### Requirement: Datos por prueba sobre una pila desechable

Cada corrida local SHALL partir de una infraestructura **sin datos previos** y destruirla al terminar. Cada prueba SHALL
crear los datos que necesita —cuentas, grupos, links, CV— con identificadores únicos por corrida, y NO SHALL depender de
datos que haya creado otra prueba ni del orden en que se ejecutan las pruebas. La demo de `api:seed-demo` NO SHALL ser
dato de la suite.

#### Scenario: Dos corridas seguidas

- **GIVEN** una corrida que terminó en verde
- **WHEN** se ejecuta otra vez el comando de la suite
- **THEN** la segunda corrida SHALL partir de una base de datos sin las cuentas, grupos ni links de la primera

#### Scenario: Una prueba sola

- **GIVEN** la suite con varias pruebas admitidas
- **WHEN** se ejecuta una sola de ellas con el comando de la suite
- **THEN** SHALL pasar igual que dentro de la corrida completa

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

### Requirement: Cada destino se declara con un perfil que dice qué puede hacer la suite

La suite SHALL poder ejecutarse contra **cualquier origen** indicado por variable, con uno de dos perfiles:

- **`local`**: contra la pila que arranca el comando de la suite. Las pruebas MAY escribir precondiciones en la base de
  datos, leer el correo en Mailpit, vaciar contadores de la infraestructura y afirmar salidas concretas del mock de IA.
- **`remote`**: contra un origen que la suite no arranca ni controla. Solo SHALL ejecutar las pruebas marcadas como
  **aptas para remoto**, y esas pruebas NO SHALL escribir en la base de datos, leer correo, tocar la infraestructura
  ni afirmar una salida concreta de la IA. `remote` SHALL afirmar solo el desenlace que declara el destino.

Ningún origen SHALL estar escrito a mano dentro de una prueba: todos SHALL derivarse del origen configurado. En `remote`, el origen de la API SHALL derivarse del origen de la aplicación, y
un origen de API declarado distinto SHALL hacer fallar la corrida antes de ejecutar ninguna prueba.

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

### Requirement: Las pruebas remotas no contaminan el destino ni consumen sus recursos

Contra un destino remoto compartido con personas reales, la suite:

- NO SHALL registrar cuentas: SHALL usar **cuentas de prueba declaradas**, cuyas credenciales llegan por variables de
  entorno y SHALL enviarse solo al origen declarado para ese destino. Ese guardia evita accidentes, no autoriza: no
  impide que quien tiene las credenciales las use en otro sitio.
- SHALL comprobar, **antes de modificar nada** en la cuenta —incluida la limpieza de corridas anteriores—, que cada
  cuenta de prueba tiene el **email sin verificar**, **sin permiso de IA externa** y una dirección con el **alias de
  prueba** declarado, y SHALL fallar sin tocar la cuenta si no es así: con el email verificado recibiría avisos por
  correo real, con el permiso enviaría el CV a un proveedor externo gastando la cuota compartida, y sin el alias podría
  ser la cuenta de una persona.
- SHALL crear sus grupos **sin visibilidad pública** por defecto.
- SHALL usar para los links **dominios reservados** que no pertenecen a nadie, de modo que el worker del destino no pida
  nada a una bolsa de empleo real.
- SHALL **borrar al terminar** lo que creó y el producto deja borrar a la cuenta (grupos, postulaciones, CV), también si
  una prueba falla, de modo que las cuentas de prueba no acumulen datos ni alcancen los límites del producto. Lo que
  **queda** tras la limpieza —el link deduplicado global en dominio reservado, su preview, el historial de sus cambios y
  los análisis de encaje de la cuenta— SHALL quedar fuera de la medición de uso del destino, que excluye por usuario a
  las cuentas de prueba.
- NO SHALL desactivar la validación de certificados TLS.

#### Scenario: Cuenta de prueba con el permiso de IA dado

- **GIVEN** una cuenta de prueba del destino remoto con el permiso de IA externa concedido y un grupo de una corrida
  anterior
- **WHEN** se ejecuta el perfil `remote`
- **THEN** la prueba SHALL fallar antes de subir ningún CV, nombrando el permiso
- **AND** el grupo de la corrida anterior SHALL seguir existiendo

#### Scenario: Cuenta sin el alias de prueba

- **GIVEN** unas credenciales cuya dirección no lleva el alias de prueba declarado
- **WHEN** se ejecuta el perfil `remote`
- **THEN** SHALL fallar nombrando el alias, sin modificar nada en esa cuenta

#### Scenario: Dos corridas remotas seguidas

- **GIVEN** una corrida del perfil `remote` que terminó, en verde o en rojo
- **WHEN** se ejecuta otra corrida contra el mismo destino con las mismas cuentas
- **THEN** SHALL empezar con las cuentas sin grupos, postulaciones ni CV de la corrida anterior

#### Scenario: Certificado no válido

- **GIVEN** un destino remoto que presenta un certificado no confiable
- **WHEN** se ejecuta el perfil `remote`
- **THEN** la corrida SHALL fallar por el certificado

### Requirement: El primer lote es el camino crítico, como un solo recorrido

El primer lote de la suite SHALL ser **un recorrido** en el que una persona se registra (o, en el perfil `remote`,
entra con su cuenta de prueba), crea un grupo, guarda en él el link de una oferta, completa la oferta a mano, registra
su postulación y la ve en el tablero, sube un CV y ve que se leyó, y pide el análisis de encaje de esa oferta; y en el
que, en el perfil `local`, una **segunda persona** abre **sin sesión** el enlace de invitación que copia la primera,
crea su cuenta desde el inicio de sesión, **se une al grupo** y hace lo mismo desde el paso de guardar el link.

- El recorrido SHALL ejecutarse en un navegador de **escritorio** y en uno **móvil emulado**, y SHALL admitirse en los
  dos.
- El recorrido SHALL ser apto para remoto y NO SHALL sembrar nada en la base de datos: cada paso SHALL hacerse por la
  interfaz, como lo haría una persona.
- El resultado del encaje SHALL afirmarse **exactamente** según lo que el destino declare: en local, el informe que
  produce el fixture de replay de la entrada del recorrido; en un destino con IA externa y la cuenta sin permiso de IA
  externa, el análisis degradado que dice que falta ese permiso.
- La entrada del recorrido que determina la clave de replay SHALL estar versionada junto a sus fixtures, y una prueba
  unitaria de la integración continua SHALL fallar si, con la definición actual de las tareas de IA, falta alguno de los
  fixtures que el recorrido pide.
- Los pasos y las personas que un perfil no ejecuta SHALL estar **declarados** por el perfil, y el recorrido SHALL
  fallar si el conjunto de pasos ejecutados no coincide con el declarado.

#### Scenario: Recorrido en local

- **GIVEN** el comando de la suite con el perfil `local`
- **WHEN** se ejecuta el recorrido del camino crítico
- **THEN** SHALL registrar una cuenta nueva y completar todos los pasos
- **AND** el informe de encaje SHALL mostrar el resultado del fixture de replay de su entrada

#### Scenario: Segunda persona se une con el enlace de invitación, sin sesión

- **GIVEN** el recorrido con el perfil `local` y el enlace de invitación copiado del grupo creado por la primera persona
- **WHEN** la segunda persona, sin sesión, abre ese enlace, crea su cuenta desde el inicio de sesión y confirma la unión
- **THEN** SHALL aterrizar en el detalle del grupo y figurar entre sus miembros
- **AND** SHALL completar los pasos de guardar el link, la oferta, la postulación, el CV y el encaje

#### Scenario: Recorrido en el móvil

- **GIVEN** el navegador móvil emulado
- **WHEN** se ejecuta el recorrido del camino crítico
- **THEN** SHALL completar los mismos pasos que en escritorio

#### Scenario: Recorrido con IA real y sin permiso

- **GIVEN** un destino remoto con proveedores de IA externos y la cuenta de prueba sin permiso de IA externa
- **WHEN** se ejecuta el recorrido del camino crítico
- **THEN** el análisis de encaje SHALL mostrarse degradado por falta del permiso
- **AND** NO SHALL llamarse a ningún proveedor externo

#### Scenario: Fixture del recorrido ausente

- **GIVEN** un cambio en una tarea de IA que cambia la clave de replay de la entrada del recorrido sin su fixture
- **WHEN** se ejecutan las pruebas unitarias en la integración continua
- **THEN** SHALL fallar nombrando la tarea y la clave

#### Scenario: Un paso declarado que no se ejecutó

- **GIVEN** un perfil que declara el paso de registro
- **WHEN** el recorrido termina sin haber ejecutado ese paso
- **THEN** la prueba SHALL fallar nombrando el paso

### Requirement: La suite es determinista y un intermitente es un fallo

- Ninguna prueba admitida SHALL sincronizarse con esperas de duración fija: SHALL esperar a eventos observables —una
  respuesta de red, una navegación terminada o un estado visible— preparados **antes** de la acción que los provoca.
  El lint del proyecto de la suite SHALL rechazar las esperas fijas, incluidos los temporizadores del entorno de
  ejecución.
- Una prueba que pasa solo al reintentarse SHALL contar como **fallo**.
- Una prueba SHALL admitirse en la suite solo después de pasar repetida varias veces seguidas, con la máquina cargada,
  en cada navegador y perfil en que se ejecuta.

#### Scenario: Espera fija en una prueba

- **GIVEN** una prueba del proyecto de la suite con una espera de duración fija
- **WHEN** se ejecuta el lint de ese proyecto
- **THEN** SHALL fallar nombrando el fichero y la línea

#### Scenario: Prueba intermitente en CI

- **GIVEN** una prueba que falla en el primer intento y pasa en el reintento
- **WHEN** termina la corrida de CI
- **THEN** la corrida SHALL terminar en rojo, informando de la prueba como intermitente

### Requirement: Una rama saltada no pasa en silencio

El lint del proyecto de la suite SHALL rechazar todo salto de prueba, también el condicional, salvo el que lleve una
excepción de línea con su motivo escrito. La prueba del camino crítico NO SHALL llevar ninguna excepción de ese tipo.

#### Scenario: Salto sin motivo

- **GIVEN** una prueba del proyecto de la suite con un salto sin excepción de línea
- **WHEN** se ejecuta el lint de ese proyecto
- **THEN** SHALL fallar nombrando el fichero y la línea

### Requirement: Cada corrida deja su diagnóstico

Cada corrida SHALL producir un informe HTML. Cada prueba que falle SHALL dejar su traza y su vídeo del primer intento.
Los tres SHALL poder abrirse sin la máquina que ejecutó la suite.

#### Scenario: Fallo con diagnóstico

- **GIVEN** una prueba que falla
- **WHEN** termina la corrida
- **THEN** el informe HTML SHALL enlazar la traza y el vídeo de ese fallo
