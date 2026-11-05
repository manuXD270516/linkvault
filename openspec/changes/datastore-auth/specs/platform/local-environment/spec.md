## ADDED Requirements

### Requirement: La infraestructura local solo escucha en el propio equipo

Cada puerto que `docker-compose.yml` publica en el host SHALL atarse a `127.0.0.1`, de modo que MongoDB, Redis, el
almacén de objetos, Mailpit y los servicios de perfil solo sean alcanzables desde el propio equipo. Los procesos del
host SHALL seguir llegando por `localhost` con las URIs de `.env.example`. Una comprobación del repositorio SHALL fallar
nombrando el servicio cuyo puerto publicado no lleve ese prefijo.

#### Scenario: Puertos atados al equipo

- **WHEN** se resuelve la configuración de `docker-compose.yml` con todos sus perfiles
- **THEN** cada puerto publicado SHALL tener `127.0.0.1` como dirección del host

#### Scenario: Un puerto publicado en todas las interfaces

- **GIVEN** `docker-compose.yml` con un servicio que publica un puerto sin dirección del host
- **WHEN** corre la comprobación del repositorio
- **THEN** SHALL fallar nombrando ese servicio

#### Scenario: Las apps del host siguen conectando

- **GIVEN** la infraestructura saludable y un `.env` copiado de `.env.example`
- **WHEN** se arrancan `api` y `worker` en el host
- **THEN** `GET /health` de ambos SHALL responder con `mongo` y `redis` en `up`

### Requirement: El runner de la suite e2e conserva las credenciales de una URI

Al aplicar un bloque de puertos, el runner de `e2e-stack` SHALL reescribir solo el puerto de `MONGO_URI`, `REDIS_URL` y
las demás URIs del bloque, conservando intactos el usuario y la contraseña si los hay. Una URI sin puerto SHALL quedar
igual.

#### Scenario: URI con credenciales

- **GIVEN** `MONGO_URI` y `REDIS_URL` con usuario y contraseña
- **WHEN** el runner aplica un bloque de puertos distinto del de por defecto
- **THEN** cada URI SHALL llevar el puerto del bloque
- **AND** el usuario y la contraseña SHALL ser los mismos de antes

#### Scenario: URI sin puerto

- **GIVEN** una URI del bloque sin puerto explícito
- **WHEN** el runner aplica un bloque de puertos
- **THEN** la URI SHALL quedar igual
