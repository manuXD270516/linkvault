## ADDED Requirements

### Requirement: Descubrir no incluido en esta versión

Con la capacidad `discovery` en `false`, `/descubrir` SHALL cargar sin redirigir y, en lugar de la búsqueda, el
selector de bolsa y el de destino, SHALL mostrar con `role="status"` «Descubrir vacantes no está incluido en esta
versión de LinkVault. Puedes guardar una oferta pegando su enlace en Solo para mí o en un grupo.», un enlace «Ver Solo
para mí» a `/mis-links` y un enlace «Ir a mis grupos» a `/grupos`. En ese estado NO SHALL llamar a la API de
Descubrir. Mientras las capacidades no hayan llegado, la página SHALL mostrar un estado neutro, sin búsqueda, selectores
ni ningún control accionable. Si su petición falló, la página SHALL comportarse como sin este requirement, incluido el
vacío honesto ante `503 discovery_disabled`.

#### Scenario: Enlace directo con Descubrir apagado

- **GIVEN** Ana autenticada y la capacidad `discovery` en `false`
- **WHEN** abre `/descubrir`
- **THEN** SHALL seguir en `/descubrir` y ver el aviso de que Descubrir no está incluido en esta versión de LinkVault
- **AND** SHALL ver el enlace «Ver Solo para mí» a `/mis-links` y el enlace «Ir a mis grupos» a `/grupos`
- **AND** NO SHALL ver el campo de búsqueda ni el selector de bolsa
- **AND** el SPA NO SHALL haber pedido `GET /api/discovery/search`

#### Scenario: Capacidades aún sin respuesta

- **GIVEN** la petición de capacidades en curso
- **WHEN** Ana abre `/descubrir`
- **THEN** NO SHALL ver el campo de búsqueda, los selectores ni ningún botón o enlace de la página
- **AND** el SPA NO SHALL haber pedido `GET /api/discovery/search`

#### Scenario: Descubrir activo

- **GIVEN** la capacidad `discovery` en `true`
- **WHEN** Ana abre `/descubrir`
- **THEN** SHALL ver la búsqueda, el selector de bolsa y el de destino como hasta ahora

#### Scenario: Textos en inglés

- **GIVEN** la interfaz en inglés y la capacidad `discovery` en `false`
- **WHEN** Ana abre `/descubrir`
- **THEN** SHALL ver «Job discovery isn't available in this version of LinkVault.» y los dos enlaces en inglés
