## ADDED Requirements

### Requirement: Motivo de destino no permitido

Cuando el filtro de salida (spec `links/egress-guard`) rechace la conexión de la página o de cualquiera de sus
redirecciones, la descarga SHALL terminar con el motivo `unsafe_destination`, de la lista cerrada de motivos del
enriquecimiento. Ese motivo SHALL ser **no reintentable**: `POST /api/links/:id/enrich` sobre un link `failed` por él
SHALL responder `409` sin pedir ninguna lectura. Un re-check de frescura que termine con ese motivo NO SHALL cerrar la
vacante. Un nombre que no resuelve SHALL seguir terminando en `http_error`, no en `unsafe_destination`. El registro del
worker SHALL anotar el rechazo con el `linkId`, la etapa (`page` o `robots`) y la categoría del rango, y NO SHALL
incluir la URL, el host ni la dirección resuelta.

#### Scenario: Página en una dirección interna

- **GIVEN** un link cuya `displayUrl` resuelve a una dirección privada
- **WHEN** se enriquece
- **THEN** el link SHALL quedar `failed` con el motivo `unsafe_destination`
- **AND** NO SHALL haberse abierto ninguna conexión hacia esa dirección

#### Scenario: Reintento de un destino no permitido

- **GIVEN** un link `failed` por `unsafe_destination`
- **WHEN** quien lo ve pide reintentar
- **THEN** la respuesta SHALL ser `409`
- **AND** NO SHALL pedirse ninguna lectura

#### Scenario: Frescura no cierra por destino no permitido

- **GIVEN** un link `enriched` con título y empresa
- **WHEN** su re-check de frescura termina con `unsafe_destination`
- **THEN** la vacante NO SHALL cerrarse
- **AND** su preview NO SHALL perder campos

#### Scenario: Nombre que no existe

- **GIVEN** un link cuyo host no resuelve
- **WHEN** se enriquece
- **THEN** el motivo SHALL ser `http_error`

#### Scenario: El registro no lleva la URL

- **GIVEN** un rechazo del filtro de salida durante un enriquecimiento
- **WHEN** se inspecciona el registro del worker
- **THEN** SHALL constar el `linkId`, la etapa y la categoría del rango
- **AND** NO SHALL aparecer la URL, el host ni la dirección resuelta

### Requirement: El robots.txt se pide con redirecciones contadas y tope de bytes

La petición del `robots.txt` SHALL seguir las redirecciones **a mano**, como mucho cinco saltos, pasando cada salto por
el filtro de salida antes de conectar; una redirección a otro host SHALL poder seguirse, porque así lo admite el
estándar del `robots.txt`, pero solo tras pasar el filtro. El cuerpo SHALL leerse por trozos y la lectura SHALL
abandonarse en cuanto supere el tope del `robots.txt`, sin haber cargado el resto en memoria. Un plazo único SHALL
cubrir la cadena entera de saltos. Más saltos de los permitidos, un destino rechazado por el filtro o un cuerpo que
supera el tope SHALL tratarse como `robots.txt` no disponible —sin reglas que aplicar—, sin abrir ninguna conexión hacia
un destino rechazado. La descarga de la página SHALL seguir pasando por su propio filtro.

#### Scenario: Redirección a un destino interno

- **GIVEN** un host cuyo `robots.txt` redirige a una dirección privada
- **WHEN** el worker pide ese `robots.txt`
- **THEN** NO SHALL abrirse ninguna conexión hacia la dirección privada
- **AND** el `robots.txt` SHALL tratarse como no disponible

#### Scenario: Demasiadas redirecciones

- **GIVEN** un `robots.txt` que encadena seis redirecciones
- **WHEN** el worker lo pide
- **THEN** NO SHALL pedirse el sexto destino
- **AND** el `robots.txt` SHALL tratarse como no disponible

#### Scenario: robots.txt demasiado grande

- **GIVEN** un `robots.txt` cuyo cuerpo supera el tope y no declara su longitud
- **WHEN** el worker lo pide
- **THEN** la lectura SHALL cortarse al superar el tope
- **AND** NO SHALL interpretarse ninguna regla de ese cuerpo

#### Scenario: Redirección legítima a otro host

- **GIVEN** un `robots.txt` que redirige una vez a otro host público que sirve reglas en texto plano
- **WHEN** el worker lo pide
- **THEN** SHALL aplicarse las reglas del destino de la redirección
