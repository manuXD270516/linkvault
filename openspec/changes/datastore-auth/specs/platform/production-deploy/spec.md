## ADDED Requirements

### Requirement: Las aplicaciones entran a Mongo con un usuario de mínimo privilegio

`api` y `worker` SHALL conectarse a MongoDB con un usuario de aplicación cuyo único rol sea lectura y escritura sobre la
base de la aplicación. Las credenciales de la raíz NO SHALL estar en el entorno de `api` ni de `worker`, y la contraseña
del usuario de aplicación solo SHALL llegarles dentro de `MONGO_URI`.

El healthcheck de `mongo` SHALL, en este orden: comprobar que el servidor responde sin pedir privilegios, autenticarse
como raíz, asegurar el replica set, asegurar el usuario de aplicación (crearlo si falta, dejarle exactamente ese rol y,
comprobándolo en una conexión aparte, la contraseña del fichero de entorno) y dar sano solo con primario escribible. NO
SHALL crear la raíz. Ante un error que no sea de reintento SHALL dar no sano imprimiendo solo el código del error. Su
salida NO SHALL contener ningún valor de credencial.

#### Scenario: El usuario de aplicación escribe en su base

- **GIVEN** la pila arriba con el usuario de aplicación
- **WHEN** `api` crea un documento dentro de una transacción y crea un índice en una colección de la aplicación
- **THEN** las dos operaciones SHALL confirmarse

#### Scenario: El usuario de aplicación no administra el servidor

- **GIVEN** una conexión autenticada con el usuario de aplicación
- **WHEN** intenta crear un usuario, leer la base `admin` o escribir en otra base
- **THEN** MongoDB SHALL rechazar cada operación con un error de autorización

#### Scenario: La raíz no llega a las aplicaciones

- **WHEN** se resuelve la configuración del compose de producción
- **THEN** ninguna variable de la raíz de MongoDB SHALL figurar en el entorno de `api` ni de `worker`
- **AND** su `MONGO_URI` SHALL nombrar al usuario de aplicación

#### Scenario: El healthcheck impone la contraseña del fichero de entorno sin mostrarla

- **GIVEN** un `mongo` cuyo usuario de aplicación tiene una contraseña distinta de la del fichero de entorno
- **WHEN** se evalúa el healthcheck y se lee su salida guardada por Docker
- **THEN** el usuario de aplicación SHALL autenticar con la contraseña del fichero de entorno
- **AND** la salida NO SHALL contener ninguna de las dos contraseñas

#### Scenario: Latido sin cambios

- **GIVEN** un `mongo` sano con el usuario de aplicación ya asegurado
- **WHEN** se evalúa otra vez el healthcheck
- **THEN** la huella de los usuarios y sus credenciales SHALL ser la misma que antes

### Requirement: Las credenciales de los almacenes se generan y se guardan fuera del repositorio

Las contraseñas de la lista cerrada —la de Redis, la de la raíz de MongoDB y la del usuario de aplicación— SHALL
generarse con un generador criptográfico sin mostrarse, cumplir el formato apto para URI que fija la defensa en
profundidad de staging (32 a 128 caracteres de letras, dígitos, `.`, `_`, `~` y `-`) y vivir solo en el fichero de
entorno del host y en su copia fuera del host. NO SHALL ser secretos del repositorio en GitHub ni aparecer en ningún
fichero versionado, salvo los valores de relleno de la verificación en CI y de `.env.example`. La contraseña SMTP queda fuera de la lista
cerrada porque el modo relay la admite vacía.

En el compose de producción, toda referencia de Compose a una contraseña de la lista cerrada SHALL usar la forma que
aborta el `up` nombrándola, y cada una SHALL estar declarada en `.env.example` con un valor de relleno. Una comprobación del repositorio SHALL
fallar nombrando la variable que incumpla cualquiera de las dos reglas.

La revisión de un fichero de entorno de despliegue SHALL rechazar, sin imprimir ningún valor, una contraseña de la lista
cerrada con otro formato, igual a un valor de relleno versionado (también el que va dentro de una URI de ejemplo) o
repetida entre las tres.

#### Scenario: Una contraseña con valor por defecto en el compose de producción

- **GIVEN** el compose de producción con una referencia a una contraseña de la lista cerrada que tiene valor por
  defecto
- **WHEN** corre la comprobación del repositorio
- **THEN** SHALL fallar nombrando esa variable

#### Scenario: Una contraseña de la lista cerrada sin declarar en el ejemplo

- **GIVEN** el compose de producción usando una contraseña de la lista cerrada que `.env.example` no declara
- **WHEN** corre la comprobación del repositorio
- **THEN** SHALL fallar nombrando esa variable

#### Scenario: Un valor de relleno en el fichero de entorno del host

- **GIVEN** un fichero de entorno de despliegue cuya contraseña del usuario de aplicación es la de relleno de la
  verificación en CI
- **WHEN** se revisa con la herramienta de revisión de ficheros de entorno
- **THEN** SHALL salir con código distinto de cero nombrando la comprobación
- **AND** su salida NO SHALL contener el valor

#### Scenario: Una contraseña que rompería la URI

- **GIVEN** un fichero de entorno de despliegue cuya contraseña del usuario de aplicación contiene `/`
- **WHEN** se revisa
- **THEN** SHALL fallar nombrando `MONGO_APP_PASSWORD`, sin imprimir el valor

### Requirement: Las credenciales de Mongo y Redis se rotan sin perder datos

Cada una de las tres credenciales SHALL tener un procedimiento de rotación escrito en el RUNBOOK y ensayado, que
conserve los datos y deje de aceptar el valor anterior:

- la del usuario de aplicación y la de Redis, editando el fichero de entorno y su copia y recreando los servicios
  afectados;
- la de la raíz, en este orden: generar la nueva en un fichero temporal legible solo por su dueño; cambiarla
  autenticándose con la actual del entorno del contenedor y leyendo la nueva por la entrada estándar; y solo después
  escribirla en el fichero de entorno y en su copia, borrar el temporal y recrear `mongo`. Si el cambio falla, NO SHALL
  quedar nada cambiado; si el cambio se hizo, el temporal NO SHALL borrarse antes de que la nueva esté en el fichero de
  entorno y en su copia.

Ninguna orden de estos procedimientos SHALL llevar una contraseña en sus argumentos.

#### Scenario: Rotar la contraseña del usuario de aplicación

- **GIVEN** la pila arriba con datos y una contraseña nueva del usuario de aplicación en el fichero de entorno
- **WHEN** se recrean `mongo`, `api` y `worker`
- **THEN** `api` y `worker` SHALL quedar sanos
- **AND** el número de documentos de cada colección SHALL ser el mismo que antes
- **AND** la contraseña anterior NO SHALL autenticar

#### Scenario: Rotar la contraseña de Redis con un job pendiente

- **GIVEN** un job encolado y sin procesar, con el worker parado, y una contraseña nueva de Redis en el fichero de
  entorno
- **WHEN** se recrean `redis`, `api` y `worker`
- **THEN** el job SHALL procesarse
- **AND** la contraseña anterior NO SHALL autenticar

#### Scenario: Rotar la raíz

- **GIVEN** la pila arriba con datos
- **WHEN** se sigue el procedimiento de rotación de la raíz del RUNBOOK
- **THEN** después del cambio la contraseña nueva SHALL autenticar y la anterior NO SHALL autenticar
- **AND** después de recrear `mongo`, el servicio SHALL quedar sano con el mismo número de documentos en cada colección

#### Scenario: Falla el cambio de la raíz

- **GIVEN** una contraseña actual de la raíz incorrecta en el entorno del contenedor
- **WHEN** se ejecuta el paso de cambio del procedimiento
- **THEN** SHALL fallar sin cambiar la raíz
- **AND** la contraseña actual del volumen SHALL seguir autenticando

#### Scenario: El procedimiento de la raíz no pasa contraseñas por argumentos

- **WHEN** se revisan las órdenes de la sección de rotación de la raíz del RUNBOOK
- **THEN** ninguna SHALL llevar una contraseña o una expansión de una contraseña como argumento
- **AND** la contraseña nueva SHALL llegar al contenedor por la entrada estándar

### Requirement: Un despliegue existente adopta el usuario de aplicación sin perder datos

Un despliegue cuyo volumen de MongoDB ya tenga datos y la raíz SHALL adoptar este change con un `up` normal, sin borrar
el volumen: el healthcheck SHALL crear el usuario de aplicación y `api` y `worker` SHALL pasar a usarlo. Antes de
fusionar SHALL existir una copia del volumen guardada fuera del host. Un volumen con datos y **sin** usuarios NO SHALL
darse por sano ni modificarse solo: el healthcheck SHALL dar no sano con el código de fallo de autenticación, y el
README SHALL describir el procedimiento manual: volcar los datos de la pila anterior y restaurar solo la base de la
aplicación en un volumen nuevo, o borrar el volumen, que pierde los datos. Si falta la contraseña del usuario de aplicación en el fichero de
entorno, el `up` SHALL abortar nombrándola antes de recrear ningún contenedor. Volver a la versión anterior del compose
NO SHALL perder datos.

#### Scenario: Staging con la raíz de antes

- **GIVEN** un volumen con datos y la raíz, y `api` y `worker` conectados como raíz
- **WHEN** se despliega este change con la contraseña del usuario de aplicación en el fichero de entorno
- **THEN** `api` y `worker` SHALL quedar sanos conectados como el usuario de aplicación
- **AND** el número de documentos de cada colección SHALL ser el mismo que antes

#### Scenario: Volumen con datos y sin usuarios

- **GIVEN** un volumen con datos creado sin autenticación
- **WHEN** se levanta el compose de producción sobre él
- **THEN** el healthcheck de `mongo` SHALL dar no sano imprimiendo solo `AuthenticationFailed`
- **AND** el número de documentos de cada colección SHALL ser el mismo que antes

#### Scenario: Falta la contraseña nueva

- **GIVEN** un fichero de entorno sin la contraseña del usuario de aplicación
- **WHEN** se ejecuta el `up` del compose de producción
- **THEN** SHALL abortar nombrando la variable
- **AND** los contenedores que estaban arriba SHALL seguir con el mismo identificador

#### Scenario: Vuelta atrás tras migrar

- **GIVEN** un volumen ya migrado
- **WHEN** se despliega el compose del commit anterior
- **THEN** `api` y `worker` SHALL quedar sanos
- **AND** el número de documentos de cada colección SHALL ser el mismo que antes

### Requirement: Una sola comprobación de credenciales para CI y para el host

Una orden versionada, instalada en el host con cada despliegue y que recibe el compose y el fichero de entorno, SHALL
comprobar
Redis rechazan una conexión sin credenciales, que el usuario de aplicación escribe en su base —en una colección de control
que SHALL borrar entera al terminar— y no puede administrar el servidor, y que la raíz no está en el entorno de `api` ni de `worker`. La verificación de la pila entera en CI SHALL
ejecutarla, y cualquiera de sus comprobaciones que falle SHALL hacer fallar la verificación nombrándola.

#### Scenario: Redis sin contraseña en la pila verificada

- **GIVEN** una versión del compose de producción en la que Redis arranca sin contraseña
- **WHEN** corre la verificación del artefacto
- **THEN** SHALL fallar nombrando a Redis y la comprobación de la conexión sin credenciales

#### Scenario: La raíz en el entorno del worker

- **GIVEN** una versión del compose de producción que pasa la contraseña de la raíz a `worker`
- **WHEN** corre la orden de comprobación
- **THEN** SHALL fallar nombrando a `worker`, sin imprimir el valor
