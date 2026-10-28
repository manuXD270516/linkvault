## Purpose

Permite que el SPA sepa, antes de que nadie lo intente, qué funciones opcionales tiene activas el despliegue
(búsqueda, Descubrir, push), para no ofrecer entradas que llevan a un error, sin exponer ninguna configuración sensible.

## ADDED Requirements

### Requirement: Capacidades del despliegue

La API SHALL exponer `GET /api/capabilities`, solo con sesión, que responda `200` con un objeto cuyas claves son
exactamente `search`, `discovery` y `push`, todas booleanas, validado con el contrato compartido de `libs/shared`.
Cada valor SHALL derivarse solo de la configuración del proceso, con una única función de derivación:

- `search` SHALL ser `true` solo si la búsqueda está activada por su bandera **y** el host de Meilisearch está
  configurado;
- `discovery` SHALL ser `true` solo si Descubrir está activado por su bandera;
- `push` SHALL ser `true` solo si la clave pública VAPID, la privada y el sujeto están configurados y no vacíos.

Una capacidad SHALL describir lo configurado, no la salud del servicio: una avería transitoria NO SHALL cambiar su
valor. Sin sesión la ruta SHALL responder `401` como el resto de rutas privadas.

#### Scenario: Despliegue con todo apagado

- **GIVEN** la API arrancada sin bandera de búsqueda, sin bandera de Descubrir y sin claves VAPID
- **WHEN** Ana, con sesión, pide `GET /api/capabilities`
- **THEN** la respuesta SHALL ser `200` con `{ "search": false, "discovery": false, "push": false }`

#### Scenario: Bandera de búsqueda sin host

- **GIVEN** la bandera de búsqueda activada y el host de Meilisearch vacío
- **WHEN** se derivan las capacidades
- **THEN** `search` SHALL ser `false`

#### Scenario: Búsqueda y Descubrir activos

- **GIVEN** la bandera de búsqueda activada con host de Meilisearch y la bandera de Descubrir activada
- **WHEN** Ana pide `GET /api/capabilities`
- **THEN** `search` y `discovery` SHALL ser `true`

#### Scenario: Push con la clave privada vacía

- **GIVEN** la clave pública VAPID y el sujeto configurados y la clave privada vacía
- **WHEN** se derivan las capacidades
- **THEN** `push` SHALL ser `false`

#### Scenario: Sin sesión

- **GIVEN** una petición sin access token
- **WHEN** pide `GET /api/capabilities`
- **THEN** la API SHALL responder `401`

### Requirement: Las capacidades no exponen configuración

La respuesta de `GET /api/capabilities` NO SHALL contener ninguna clave distinta de las del contrato ni ningún valor
que no sea booleano: ni hosts, ni claves, ni nombres de proveedores o modelos, ni versiones. La API SHALL construirla
con el contrato en modo estricto.

#### Scenario: Una clave de más hace fallar la prueba

- **GIVEN** una versión de la API que añade a la respuesta el host de Meilisearch
- **WHEN** se ejecuta la prueba del controlador
- **THEN** SHALL fallar nombrando la clave sobrante

#### Scenario: Cuerpo exacto

- **GIVEN** cualquier configuración válida
- **WHEN** Ana pide `GET /api/capabilities`
- **THEN** el cuerpo SHALL tener exactamente las claves `search`, `discovery` y `push`
- **AND** sus tres valores SHALL ser booleanos

### Requirement: Capacidades cacheables y contrato aditivo

La API SHALL calcular las capacidades una vez por proceso y servirlas con `Cache-Control: private, max-age=300`. El
cliente SHALL aceptar una respuesta con claves adicionales desconocidas sin fallar, de modo que añadir una capacidad
nueva no rompa un SPA ya cargado.

#### Scenario: Cabecera de caché

- **GIVEN** Ana con sesión
- **WHEN** pide `GET /api/capabilities`
- **THEN** la respuesta SHALL llevar `Cache-Control: private, max-age=300`

#### Scenario: Capacidad nueva desconocida para el cliente

- **GIVEN** una respuesta con `search`, `discovery`, `push` y una clave adicional `foo: true`
- **WHEN** el cliente la valida con el contrato compartido
- **THEN** la validación SHALL tener éxito con los tres valores conocidos
