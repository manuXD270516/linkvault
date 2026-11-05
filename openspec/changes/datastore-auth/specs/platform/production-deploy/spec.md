## ADDED Requirements

### Requirement: Las aplicaciones entran a Mongo con un usuario de mínimo privilegio

`api` y `worker` SHALL conectarse a MongoDB con un usuario de aplicación cuyo único rol sea lectura y escritura sobre la
base de la aplicación. Las credenciales de la raíz NO SHALL estar en el entorno de `api` ni de `worker`; solo las tiene
el servicio `mongo`.

El healthcheck de `mongo` SHALL asegurar ese usuario de forma idempotente en cada evaluación: crearlo si falta,
dejarle exactamente ese rol y la contraseña del fichero de entorno, y dar sano solo después. Su salida NO SHALL
contener ningún valor de credencial.

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

#### Scenario: El healthcheck no muestra credenciales

- **GIVEN** un `mongo` cuyo usuario de aplicación tiene una contraseña distinta de la del fichero de entorno
- **WHEN** se evalúa el healthcheck y se lee su salida guardada por Docker
- **THEN** el usuario de aplicación SHALL autenticar con la contraseña del fichero de entorno
- **AND** la salida NO SHALL contener ninguna de las dos contraseñas

### Requirement: Las credenciales de los almacenes se generan y se guardan fuera del repositorio

Las contraseñas de Redis, de la raíz de MongoDB y del usuario de aplicación SHALL generarse con un generador
criptográfico, tener entre 32 y 128 caracteres del conjunto no reservado de las URI (letras, dígitos, `.`, `_`, `~` y
`-`) y vivir solo en el fichero de entorno del host y en su copia fuera del host. NO SHALL ser secretos del
repositorio en GitHub ni aparecer en ningún fichero versionado, salvo los valores de relleno de desarrollo, de la suite
e2e y de la verificación en CI, que SHALL ser reconocibles como tales.

El compose de producción NO SHALL dar valor por defecto a ninguna contraseña: cada variable cuyo nombre termine en
`_PASSWORD` SHALL usar la forma que aborta el `up` nombrándola, y una comprobación del repositorio SHALL fallar
nombrando la variable que no la use.

La revisión de un fichero de entorno de despliegue SHALL rechazar, sin imprimir ningún valor, una contraseña con otro
formato, igual a un valor de relleno versionado o repetida entre las tres.

#### Scenario: Una contraseña con valor por defecto en el compose de producción

- **GIVEN** el compose de producción con una variable `_PASSWORD` que tiene valor por defecto
- **WHEN** corre la comprobación del repositorio
- **THEN** SHALL fallar nombrando esa variable

#### Scenario: Un valor de desarrollo en el fichero de entorno del host

- **GIVEN** un fichero de entorno de despliegue cuya contraseña de Redis es la de relleno de desarrollo
- **WHEN** se revisa con la herramienta de revisión de ficheros de entorno
- **THEN** SHALL salir con código distinto de cero nombrando la comprobación
- **AND** su salida NO SHALL contener el valor

#### Scenario: Una contraseña que rompería la URI

- **GIVEN** un fichero de entorno de despliegue cuya contraseña del usuario de aplicación contiene `/`
- **WHEN** se revisa
- **THEN** SHALL fallar nombrando la comprobación de formato, sin imprimir el valor

### Requirement: Las credenciales de Mongo y Redis se rotan sin perder datos

Cada una de las tres credenciales SHALL tener un procedimiento de rotación escrito en el RUNBOOK y ensayado, que
conserve los datos y deje de aceptar el valor anterior:

- la del usuario de aplicación y la de Redis, editando el fichero de entorno y recreando los servicios afectados;
- la de la raíz de MongoDB, con un script versionado que lee la nueva sin eco, la aplica autenticándose con la actual y
  NO SHALL pasarla en los argumentos de ningún proceso.

#### Scenario: Rotar la contraseña del usuario de aplicación

- **GIVEN** la pila arriba con datos y una contraseña nueva en el fichero de entorno
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

#### Scenario: Rotar la raíz sin exponerla

- **GIVEN** la pila arriba y un muestreo de los argumentos de todos los procesos del host y del contenedor `mongo`
- **WHEN** se ejecuta el script de rotación de la raíz y después se recrea `mongo` con el fichero de entorno actualizado
- **THEN** `mongo` SHALL quedar sano
- **AND** ninguna muestra SHALL contener la contraseña nueva ni la anterior

### Requirement: Un despliegue existente adopta la autenticación sin perder datos

Un despliegue cuyo volumen de MongoDB ya tenga datos SHALL adoptar este change con un `up` normal, sin borrar el
volumen:

- con la raíz ya creada, el healthcheck SHALL crear el usuario de aplicación;
- sin ningún usuario, el healthcheck SHALL crear la raíz y el usuario de aplicación.

Si falta la contraseña del usuario de aplicación en el fichero de entorno, el `up` SHALL abortar nombrándola antes de
recrear ningún contenedor. Volver a la versión anterior del compose NO SHALL perder datos.

#### Scenario: Staging con la raíz de antes

- **GIVEN** un volumen con datos y la raíz, y `api` y `worker` conectados como raíz
- **WHEN** se despliega este change con la contraseña del usuario de aplicación en el fichero de entorno
- **THEN** `api` y `worker` SHALL quedar sanos conectados como el usuario de aplicación
- **AND** el número de documentos de cada colección SHALL ser el mismo que antes

#### Scenario: Falta la contraseña nueva

- **GIVEN** un fichero de entorno sin la contraseña del usuario de aplicación
- **WHEN** se ejecuta el `up` del compose de producción
- **THEN** SHALL abortar nombrando la variable
- **AND** los contenedores que estaban arriba SHALL seguir con el mismo identificador

#### Scenario: Vuelta atrás tras migrar

- **GIVEN** un volumen ya migrado
- **WHEN** se despliega la versión anterior del compose
- **THEN** `api` y `worker` SHALL quedar sanos
- **AND** el número de documentos de cada colección SHALL ser el mismo que antes

### Requirement: La verificación del artefacto comprueba las credenciales

La verificación de la pila entera en CI SHALL comprobar, sin imprimir ningún valor, que MongoDB y Redis rechazan una
conexión sin credenciales, que el usuario de aplicación escribe en su base y no puede administrar el servidor, y que la
raíz no está en el entorno de `api` ni de `worker`. Cualquiera de esas comprobaciones que falle SHALL hacer fallar la
verificación nombrándola.

#### Scenario: Redis sin contraseña en la pila verificada

- **GIVEN** una versión del compose de producción en la que Redis arranca sin contraseña
- **WHEN** corre la verificación del artefacto
- **THEN** SHALL fallar nombrando a Redis y la comprobación de la conexión sin credenciales
