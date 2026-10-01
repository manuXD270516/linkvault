## MODIFIED Requirements

### Requirement: Liveness

`api` y `worker` SHALL exponer `GET /health/live` sin autenticación y fuera de cualquier prefijo de rutas. SHALL responder
200 en menos de un segundo mientras el proceso esté vivo, independientemente del estado de sus dependencias, con el
nombre del servicio y su versión.

`api` y `worker` SHALL escuchar en todas las interfaces de red de su proceso, no solo en loopback: dentro de un
contenedor, otro contenedor de la misma red SHALL alcanzarlos por el nombre del servicio y su puerto. Una comprobación
de salud hecha desde dentro del propio contenedor NO SHALL considerarse suficiente para afirmarlo (hallazgo del smoke
local de `object-store`, decisión del usuario del 2026-09-28).

#### Scenario: Proceso vivo

- **WHEN** se hace `GET /health/live`
- **THEN** SHALL responder 200 en menos de un segundo
- **AND** el cuerpo SHALL incluir el nombre del servicio y su versión

#### Scenario: Sin autenticación

- **GIVEN** una petición sin credenciales
- **WHEN** hace `GET /health/live` o `GET /health`
- **THEN** NO SHALL responder 401 ni 403

#### Scenario: La api responde a otro contenedor de la misma red

- **GIVEN** `api` en ejecución en un contenedor de una red de Docker, con MongoDB y Redis accesibles
- **WHEN** otro contenedor de esa red hace `GET /health` contra el nombre del servicio `api` y su puerto
- **THEN** SHALL responder 200, igual que desde dentro del contenedor de `api`
- **AND** NO SHALL rechazar la conexión

#### Scenario: El worker responde a otro contenedor de la misma red

- **GIVEN** `worker` en ejecución en un contenedor de una red de Docker, con MongoDB y Redis accesibles
- **WHEN** otro contenedor de esa red hace `GET /health` contra el nombre del servicio `worker` y su puerto de salud
- **THEN** SHALL responder 200, igual que desde dentro del contenedor de `worker`
- **AND** NO SHALL rechazar la conexión
