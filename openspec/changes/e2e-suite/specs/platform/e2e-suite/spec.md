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
  local, bajo un **nombre de proyecto de compose propio de la suite**, de modo que no comparta contenedores ni volúmenes
  con la pila de desarrollo.
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

- **GIVEN** la pila de desarrollo del proyecto levantada con su nombre de compose habitual
- **WHEN** se ejecuta el comando de la suite hasta el final
- **THEN** los contenedores y volúmenes de la pila de desarrollo SHALL seguir existiendo sin cambios

### Requirement: La corrida nunca prueba procesos ajenos

La suite SHALL usar un **bloque de puertos propio**, distinto del de la pila de desarrollo y configurable, para la
infraestructura y para `api`, `worker` y `web`. Antes de arrancar nada, el comando SHALL comprobar que **todos** los
puertos del bloque están libres y, si alguno está ocupado, SHALL terminar **sin arrancar nada** y nombrando el puerto.

- La suite NO SHALL reutilizar un servidor que ya estuviera escuchando.
- Si un proceso lanzado por la corrida termina antes de tiempo o informa de que su puerto está en uso, la corrida SHALL
  fallar nombrándolo, aunque otro proceso responda en ese puerto.
- Una aplicación SHALL darse por arrancada solo cuando responde en su puerto del bloque: `api` y `worker` por su salud,
  que SHALL declarar mongo y redis en `up`; `web`, con el documento del SPA.

#### Scenario: Puerto ocupado por otra sesión

- **GIVEN** otro proceso escuchando en el puerto de `api` del bloque de la suite
- **WHEN** se ejecuta el comando de la suite
- **THEN** SHALL terminar con código distinto de cero nombrando ese puerto
- **AND** NO SHALL haber levantado ningún contenedor ni proceso

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

Las aplicaciones que arranca el comando SHALL recibir un entorno **versionado en el repositorio**, sin secretos, que
prevalece sobre el `.env` de quien ejecuta. Un cambio en el `.env` local NO SHALL cambiar el resultado de la suite.

- La IA SHALL quedar en `AI_CHAIN=mock` con `AI_MOCK_MODE=replay` (y la cadena de embeddings en `mock`): una entrada sin
  fixture SHALL fallar, no inventar una salida.
- El correo SHALL salir por SMTP hacia el Mailpit del proyecto de compose de la suite, nunca hacia un proveedor real.
- Las funciones con flag SHALL quedar apagadas salvo las que necesite alguna prueba admitida, y el entorno SHALL
  declarar cuáles.

#### Scenario: El desarrollador tiene la IA en synth

- **GIVEN** un `.env` local con `AI_MOCK_MODE=synth`
- **WHEN** se ejecuta el comando de la suite
- **THEN** `api` y `worker` SHALL arrancar con `AI_MOCK_MODE=replay`
- **AND** una tarea de IA con una entrada sin fixture SHALL terminar en fallo, no en una salida sintética

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
  **aptas para remoto**, y ninguna prueba SHALL poder escribir en la base de datos, leer correo, tocar la
  infraestructura ni afirmar una salida concreta de la IA.

Una prueba apta para remoto que intente cualquiera de esas operaciones SHALL **fallar** nombrando la operación, en
cualquier perfil. NO SHALL saltarse en silencio. Ningún origen SHALL estar escrito a mano dentro de una prueba: todos
SHALL derivarse del origen configurado.

El perfil `remote` SHALL poder ejecutarse **contra la pila local** que arranca el comando de la suite, para ensayar un
destino remoto antes de que exista.

#### Scenario: Prueba apta para remoto que escribe en la base de datos

- **GIVEN** una prueba marcada como apta para remoto que siembra una precondición en Mongo
- **WHEN** se ejecuta con el perfil `local`
- **THEN** SHALL fallar nombrando la escritura en la base de datos

#### Scenario: Perfil remoto sin origen

- **GIVEN** el perfil `remote` sin origen configurado
- **WHEN** se ejecuta la suite
- **THEN** SHALL terminar con código distinto de cero diciendo que falta el origen
- **AND** NO SHALL ejecutar ninguna prueba

#### Scenario: Ensayo del perfil remoto contra la pila local

- **GIVEN** la pila que arranca el comando de la suite
- **WHEN** se ejecuta el perfil `remote` contra su origen
- **THEN** SHALL ejecutar solo las pruebas aptas para remoto
- **AND** SHALL pasar sin escribir en la base de datos ni leer correo

### Requirement: Las pruebas remotas no contaminan el destino ni consumen sus recursos

Contra un destino remoto compartido con personas reales, la suite:

- NO SHALL registrar cuentas: SHALL usar **cuentas de prueba declaradas**, cuyas credenciales llegan por variables de
  entorno y SHALL enviarse solo al origen declarado para ese destino.
- SHALL comprobar, antes de actuar, que cada cuenta de prueba tiene el **email sin verificar** y **sin permiso de IA
  externa**, y SHALL fallar si no es así: con el email verificado recibiría avisos por correo real, y con el permiso
  enviaría el CV a un proveedor externo gastando la cuota compartida.
- SHALL usar para los links **dominios reservados** que no pertenecen a nadie, de modo que el worker del destino no pida
  nada a una bolsa de empleo real.
- SHALL **borrar al terminar** lo que creó (grupos, postulaciones, CV), también si una prueba falla, de modo que las
  cuentas de prueba no acumulen datos ni alcancen los límites del producto.
- NO SHALL desactivar la validación de certificados TLS.

#### Scenario: Cuenta de prueba con el permiso de IA dado

- **GIVEN** una cuenta de prueba del destino remoto con el permiso de IA externa concedido
- **WHEN** se ejecuta el perfil `remote`
- **THEN** la prueba SHALL fallar antes de subir ningún CV, nombrando el permiso

#### Scenario: Dos corridas remotas seguidas

- **GIVEN** una corrida del perfil `remote` que terminó, en verde o en rojo
- **WHEN** se ejecuta otra corrida contra el mismo destino con las mismas cuentas
- **THEN** SHALL empezar con las cuentas sin grupos, postulaciones ni CV de la corrida anterior

#### Scenario: Certificado no válido

- **GIVEN** un destino remoto que presenta un certificado no confiable
- **WHEN** se ejecuta el perfil `remote`
- **THEN** la corrida SHALL fallar por el certificado

### Requirement: El primer lote es el camino crítico, como un solo recorrido

El primer lote de la suite SHALL ser **un recorrido** de una persona que: se registra (o, en el perfil `remote`, entra
con su cuenta de prueba), crea un grupo, guarda en él el link de una oferta, completa la oferta a mano, registra su
postulación y la ve en el tablero, sube un CV y ve que se leyó, y pide el análisis de encaje de esa oferta.

- El recorrido SHALL ser apto para remoto y NO SHALL sembrar nada en la base de datos: cada paso SHALL hacerse por la
  interfaz, como lo haría una persona.
- El resultado del encaje SHALL afirmarse **exactamente** según lo que el destino declare: en local, el informe que
  produce el fixture de replay de la entrada del recorrido; en un destino con IA real y la cuenta sin permiso de IA
  externa, el análisis degradado que dice que falta ese permiso.
- Los pasos que un perfil no ejecuta SHALL estar **declarados** por el perfil, y el recorrido SHALL fallar si el
  conjunto de pasos ejecutados no coincide con el declarado.

#### Scenario: Recorrido en local

- **GIVEN** el comando de la suite con el perfil `local`
- **WHEN** se ejecuta el recorrido del camino crítico
- **THEN** SHALL registrar una cuenta nueva y completar todos los pasos
- **AND** el informe de encaje SHALL mostrar el resultado del fixture de replay de su entrada

#### Scenario: Recorrido con IA real y sin permiso

- **GIVEN** un destino remoto con proveedores de IA externos y la cuenta de prueba sin permiso de IA externa
- **WHEN** se ejecuta el recorrido del camino crítico
- **THEN** el análisis de encaje SHALL mostrarse degradado por falta del permiso
- **AND** NO SHALL llamarse a ningún proveedor externo

#### Scenario: Un paso declarado que no se ejecutó

- **GIVEN** un perfil que declara el paso de registro
- **WHEN** el recorrido termina sin haber ejecutado ese paso
- **THEN** la prueba SHALL fallar nombrando el paso

### Requirement: La suite es determinista y un intermitente es un fallo

- Ninguna prueba admitida SHALL sincronizarse con esperas de duración fija: SHALL esperar a eventos observables —una
  respuesta de red, una navegación terminada o un estado visible— preparados **antes** de la acción que los provoca.
  El lint del proyecto de la suite SHALL rechazar las esperas fijas.
- Una prueba que pasa solo al reintentarse SHALL contar como **fallo**.
- Una prueba SHALL admitirse en la suite solo después de pasar repetida varias veces seguidas, con la máquina cargada.

#### Scenario: Espera fija en una prueba

- **GIVEN** una prueba del proyecto de la suite con una espera de duración fija
- **WHEN** se ejecuta el lint de ese proyecto
- **THEN** SHALL fallar nombrando el fichero y la línea

#### Scenario: Prueba intermitente en CI

- **GIVEN** una prueba que falla en el primer intento y pasa en el reintento
- **WHEN** termina la corrida de CI
- **THEN** la corrida SHALL terminar en rojo, informando de la prueba como intermitente

### Requirement: Una rama saltada no pasa en silencio

Un salto de prueba SHALL llevar su motivo escrito en el informe. Una prueba del camino crítico que se salta SHALL hacer
fallar la corrida.

#### Scenario: Camino crítico saltado

- **GIVEN** una corrida en la que la prueba del camino crítico se salta
- **WHEN** termina la corrida
- **THEN** SHALL terminar con código distinto de cero nombrando la prueba saltada

### Requirement: Cada corrida deja su diagnóstico

Cada corrida SHALL producir un informe HTML. Cada prueba que falle SHALL dejar su traza y su vídeo del primer intento.
Los tres SHALL poder abrirse sin la máquina que ejecutó la suite.

#### Scenario: Fallo con diagnóstico

- **GIVEN** una prueba que falla
- **WHEN** termina la corrida
- **THEN** el informe HTML SHALL enlazar la traza y el vídeo de ese fallo

### Requirement: La cobertura se declara contra el catálogo de uso

El repositorio SHALL mantener un **mapa de cobertura** versionado que, para cada funcionalidad numerada de
`docs/catalogo-de-uso.md`, diga si está cubierta y por qué prueba, en qué lote está prevista o por qué no se cubre con
una prueba de navegador. Una comprobación que se ejecuta en CI SHALL fallar si falta alguna funcionalidad del catálogo,
si el mapa nombra una prueba que no existe o si una prueba admitida no figura en el mapa. Las pruebas que ejecuta el
comando de la suite SHALL ser exactamente las **admitidas** en el mapa.

#### Scenario: Funcionalidad nueva sin entrada en el mapa

- **GIVEN** el catálogo con una funcionalidad numerada que el mapa no menciona
- **WHEN** se ejecuta la comprobación del mapa
- **THEN** SHALL fallar nombrando el número de la funcionalidad

#### Scenario: El mapa cita una prueba borrada

- **GIVEN** una entrada del mapa que apunta a una prueba que ya no existe
- **WHEN** se ejecuta la comprobación del mapa
- **THEN** SHALL fallar nombrando la entrada y la prueba
