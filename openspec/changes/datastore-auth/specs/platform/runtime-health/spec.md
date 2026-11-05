## ADDED Requirements

### Requirement: El arranque de producción exige credenciales en las URIs de los almacenes

Con `NODE_ENV=production`, `api` y `worker` SHALL terminar con código distinto de cero antes de escuchar si `MONGO_URI`
no lleva usuario y contraseña o si `REDIS_URL` no lleva contraseña. El error SHALL nombrar la variable y el motivo, y NO
SHALL contener la URI ni ninguna de sus partes. El arranque NO SHALL comparar las contraseñas con valores de relleno: eso
lo hace la revisión del fichero de entorno antes del `up`. Fuera de producción esas URIs MAY ir sin credenciales.

#### Scenario: URI de Mongo sin credenciales en producción

- **GIVEN** `NODE_ENV=production` y una `MONGO_URI` sin usuario ni contraseña
- **WHEN** se arranca `api`
- **THEN** el proceso SHALL terminar con código distinto de cero nombrando `MONGO_URI`
- **AND** la salida NO SHALL contener la URI

#### Scenario: URI de Redis sin contraseña en producción

- **GIVEN** `NODE_ENV=production` y una `REDIS_URL` sin contraseña
- **WHEN** se arranca `worker`
- **THEN** el proceso SHALL terminar con código distinto de cero nombrando `REDIS_URL`

#### Scenario: La configuración de la verificación en CI arranca

- **GIVEN** `NODE_ENV=production` y las URIs con las credenciales de relleno de la verificación en CI
- **WHEN** se valida la configuración de `api` y de `worker`
- **THEN** la validación SHALL pasar

#### Scenario: Desarrollo sin credenciales

- **GIVEN** `NODE_ENV=development` y URIs sin credenciales
- **WHEN** se valida la configuración
- **THEN** la validación SHALL pasar

### Requirement: Las credenciales de los almacenes no salen en los registros

Los registros de `api` y `worker` NO SHALL contener el valor de `MONGO_URI`, `REDIS_URL`, `REDIS_PASSWORD`,
`MONGO_ROOT_PASSWORD` ni `MONGO_APP_PASSWORD` cuando aparezcan como campos del objeto registrado. Un fallo de conexión
o de autenticación SHALL registrarse con el nombre del error y su código —de MongoDB, su `codeName`; de Redis, solo
`NOAUTH` o `WRONGPASS`—, que distingue una credencial rechazada de un servidor inalcanzable, y NO SHALL incluir el host,
la URI ni el resto del mensaje del driver.

#### Scenario: Objeto con la URI registrado

- **WHEN** se registra un objeto con `MONGO_URI` y `REDIS_URL` con credenciales
- **THEN** ninguno de los dos valores SHALL aparecer en la salida
- **AND** las dos claves SHALL aparecer redactadas

#### Scenario: Contraseña de Mongo rechazada al conectar

- **GIVEN** `api` arrancando con una `MONGO_URI` cuya contraseña MongoDB rechaza
- **WHEN** falla la conexión inicial
- **THEN** el aviso SHALL contener `AuthenticationFailed`
- **AND** NO SHALL contener la contraseña, el usuario ni el host

#### Scenario: Contraseña de Redis rechazada

- **GIVEN** un cliente Redis de `worker` cuya contraseña Redis rechaza con un mensaje que incluye otros datos
- **WHEN** se registra el fallo
- **THEN** el aviso SHALL contener `WRONGPASS`
- **AND** NO SHALL contener ningún otro texto del mensaje de Redis
