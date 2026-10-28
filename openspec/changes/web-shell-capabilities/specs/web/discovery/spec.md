## ADDED Requirements

### Requirement: Descubrir no activado en este entorno

Con la capacidad `discovery` en `false`, `/descubrir` SHALL cargar sin redirigir y, en lugar de la búsqueda, el
selector de bolsa y el de destino, SHALL mostrar con `role="status"` «Descubrir vacantes no está activado en este
entorno. Puedes guardar una oferta pegando su enlace en Solo para mí o en un grupo.» y un enlace «Ver Solo para mí» a
`/mis-links`. En ese estado NO SHALL llamar a la API de Descubrir. Mientras las capacidades no hayan llegado o si su
petición falló, la página SHALL comportarse como sin este requirement, incluido el vacío honesto ante
`503 discovery_disabled`.

#### Scenario: Enlace directo con Descubrir apagado

- **GIVEN** Ana autenticada y la capacidad `discovery` en `false`
- **WHEN** abre `/descubrir`
- **THEN** SHALL seguir en `/descubrir` y ver el aviso de que Descubrir no está activado en este entorno
- **AND** SHALL ver el enlace «Ver Solo para mí» a `/mis-links`
- **AND** NO SHALL ver el campo de búsqueda ni el selector de bolsa
- **AND** el SPA NO SHALL haber pedido `GET /api/discovery/search`

#### Scenario: Descubrir activo

- **GIVEN** la capacidad `discovery` en `true`
- **WHEN** Ana abre `/descubrir`
- **THEN** SHALL ver la búsqueda, el selector de bolsa y el de destino como hasta ahora

#### Scenario: Textos en inglés

- **GIVEN** la interfaz en inglés y la capacidad `discovery` en `false`
- **WHEN** Ana abre `/descubrir`
- **THEN** el aviso y el enlace SHALL estar en inglés
