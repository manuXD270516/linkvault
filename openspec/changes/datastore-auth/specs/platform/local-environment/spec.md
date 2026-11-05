## ADDED Requirements

### Requirement: MongoDB y Redis piden credenciales también en local

La infraestructura local SHALL arrancar MongoDB con autenticación y el `keyFile` que exige el replica set, y Redis con
contraseña, con la misma forma que el compose de producción. MongoDB SHALL tener un usuario raíz y un usuario de
aplicación con lectura y escritura solo sobre la base de la aplicación, asegurados por su healthcheck
(`platform/production-deploy`, «Las aplicaciones entran a Mongo con un usuario de mínimo privilegio»).

- El comando único de «Infraestructura con un comando» SHALL seguir funcionando **sin `.env`**: las credenciales
  SHALL tener en `docker-compose.yml` valores por defecto de relleno, marcados en el propio fichero como solo de
  desarrollo.
- `.env.example` SHALL llevar `MONGO_URI` con el usuario de aplicación y `REDIS_URL` con la contraseña, con esos mismos
  valores de relleno.
- MongoDB y Redis NO SHALL aceptar ninguna operación sin credenciales, tampoco por los puertos publicados en el host.

#### Scenario: Arranque en limpio con credenciales de desarrollo

- **GIVEN** un equipo sin volúmenes previos del proyecto y sin `.env`
- **WHEN** se ejecuta el comando de arranque documentado
- **THEN** MongoDB y Redis SHALL quedar saludables
- **AND** el usuario de aplicación SHALL existir con un único rol de lectura y escritura sobre la base de la aplicación

#### Scenario: Conexión sin credenciales rechazada en local

- **GIVEN** la infraestructura local saludable
- **WHEN** un proceso del host se conecta por el puerto publicado de MongoDB o de Redis sin credenciales y pide leer
  datos
- **THEN** MongoDB SHALL responder con un error de autorización
- **AND** Redis SHALL responder que la conexión no está autenticada

#### Scenario: Las apps del host entran con las URIs del ejemplo

- **GIVEN** la infraestructura saludable y un `.env` copiado de `.env.example`
- **WHEN** se arrancan `api` y `worker` en el host
- **THEN** `GET /health` de ambos SHALL responder con `mongo` y `redis` en `up`
- **AND** una transacción multi-documento con esa `MONGO_URI` SHALL confirmarse

### Requirement: Un volumen local anterior a la autenticación conserva sus datos

Un volumen de MongoDB creado antes de la autenticación, con datos y sin usuarios, SHALL quedar con la raíz y el usuario
de aplicación al volver a ejecutar el comando de arranque, **sin borrar el volumen** ni ningún documento, y sin pasos
manuales dentro de MongoDB. Repetir el arranque NO SHALL cambiar nada más.

#### Scenario: Volumen con datos y sin usuarios

- **GIVEN** un volumen de MongoDB con documentos en la base de la aplicación, creado sin autenticación
- **WHEN** se ejecuta el comando de arranque con la versión de este change
- **THEN** MongoDB SHALL quedar saludable
- **AND** el número de documentos de cada colección SHALL ser el mismo que antes
- **AND** la raíz y el usuario de aplicación SHALL existir

#### Scenario: Volumen ya migrado

- **GIVEN** un volumen que ya tiene la raíz y el usuario de aplicación
- **WHEN** se ejecuta otra vez el comando de arranque
- **THEN** MongoDB SHALL quedar saludable sin crear ni cambiar ningún usuario

### Requirement: Las URIs con credenciales sirven a las herramientas locales

Toda herramienta del repositorio que lea o reescriba `MONGO_URI` o `REDIS_URL` SHALL aceptar una URI con usuario y
contraseña y SHALL conservarlos intactos. En particular, el runner de `e2e-stack` SHALL reescribir solo el puerto, y el
guardia de la semilla de demostración SHALL juzgar el host, no la parte de usuario.

#### Scenario: Bloque de puertos con URI con credenciales

- **GIVEN** `MONGO_URI` y `REDIS_URL` con usuario y contraseña en el entorno de la suite e2e
- **WHEN** el runner aplica un bloque de puertos distinto del de por defecto
- **THEN** cada URI SHALL llevar el puerto del bloque
- **AND** el usuario y la contraseña SHALL ser los mismos de antes

#### Scenario: Semilla de demostración con credenciales en la URI

- **GIVEN** una `MONGO_URI` con usuario y contraseña cuyo host es `localhost`
- **WHEN** se evalúan los guardias de la semilla de demostración
- **THEN** el host SHALL juzgarse como `localhost` y pasar la lista de permitidos
