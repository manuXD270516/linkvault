## MODIFIED Requirements

### Requirement: Normalización de URL para identidad

Toda URL SHALL normalizarse **solo para calcular su identidad**: esquema y host en minúsculas, esquema `https` cuando el
original es `http`, sin `www.`, sin fragmento, sin barra final salvo en la raíz, sin parámetros de campaña (`utm_*`,
`gclid`, `fbclid`, `mc_cid`, `mc_eid`, `igshid`, `ref`, `trk`, `trkCampaign`) y con el resto de parámetros ordenados. La
URL normalizada NO SHALL usarse para abrir ni para descargar: para eso se usa la primera URL original guardada
(`displayUrl`), que es la que escribió una persona. Una URL que no es `http(s)` o que no tiene host SHALL rechazarse como
no reconocida. Una URL cuyo host sea un nombre sin punto (tras quitar el punto final), `localhost` o un subdominio de
`localhost`, o una dirección literal de un rango no público según la clasificación compartida de la spec
`links/egress-guard`, SHALL rechazarse también como no reconocida. Con `EGRESS_ALLOW_PRIVATE_TARGETS` encendida fuera de
producción, SHALL rechazarse solo lo que esa opción sigue prohibiendo. Esta comprobación SHALL ser sintáctica: al
guardar NO SHALL resolverse ningún nombre, y la decisión sobre adónde se conecta SHALL tomarla el filtro de salida del
worker.

#### Scenario: URL normalizada

- **WHEN** se guarda `HTTP://WWW.Example.com/Jobs/123/?utm_source=wa&ref=x#top`
- **THEN** la URL normalizada SHALL ser `https://example.com/Jobs/123`
- **AND** `displayUrl` SHALL ser la URL tal como se escribió

#### Scenario: Esquema no soportado

- **WHEN** se guarda `ftp://example.com/job` o `javascript:alert(1)`
- **THEN** la URL SHALL contarse como no reconocida y NO SHALL crearse ningún link

#### Scenario: Host que es una dirección interna literal

- **GIVEN** `EGRESS_ALLOW_PRIVATE_TARGETS` apagada
- **WHEN** se guarda una URL cuyo host es una dirección literal de un rango privado o de loopback
- **THEN** la respuesta SHALL ser `400` con código `invalid_url`
- **AND** NO SHALL crearse ningún link

#### Scenario: Host sin punto

- **WHEN** se guarda una URL cuyo host es un nombre de una sola etiqueta
- **THEN** la URL SHALL contarse como no reconocida y NO SHALL crearse ningún link

#### Scenario: Importación con una URL interna

- **GIVEN** un texto con una URL de una bolsa pública y otra cuyo host es `localhost`
- **WHEN** se importa
- **THEN** SHALL guardarse solo la de la bolsa pública
- **AND** la otra SHALL sumarse a las no reconocidas

#### Scenario: Al guardar no se resuelve el nombre

- **WHEN** se guarda una URL cuyo host es un nombre con punto
- **THEN** NO SHALL hacerse ninguna consulta DNS para aceptarla o rechazarla

#### Scenario: Servidor local en desarrollo

- **GIVEN** `NODE_ENV=development` y `EGRESS_ALLOW_PRIVATE_TARGETS=true`
- **WHEN** se guarda una URL cuyo host es `localhost` con un puerto
- **THEN** SHALL crearse el link
