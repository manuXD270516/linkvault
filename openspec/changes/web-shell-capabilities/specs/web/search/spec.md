## MODIFIED Requirements

### Requirement: Ruta lazy de búsqueda

El SPA SHALL exponer una ruta autenticada de búsqueda (p. ej. `/buscar` en ES), cargada de forma lazy, enlazada desde la
navegación principal cuando la persona tiene sesión **y** el despliegue declara la búsqueda activa (capacidad
`search`, spec `web/shell`). La ruta SHALL seguir existiendo aunque la búsqueda esté apagada, para atender los enlaces
directos. Sin sesión, la ruta SHALL redirigir al login como el resto de features privadas.

#### Scenario: Entrar a buscar con sesión

- **GIVEN** Ana autenticada en un despliegue con la búsqueda activa
- **WHEN** navega a la ruta de búsqueda
- **THEN** SHALL ver el campo de consulta y poder enviar una búsqueda
- **AND** el chunk de la feature NO SHALL cargarse en el bundle inicial obligatorio de login

#### Scenario: Sin entrada en la barra con la búsqueda apagada

- **GIVEN** Ana autenticada y la capacidad `search` en `false`
- **WHEN** mira la navegación principal
- **THEN** NO SHALL ver la entrada «Buscar»

## ADDED Requirements

### Requirement: Búsqueda no activada en este entorno

Con la capacidad `search` en `false`, la página de búsqueda SHALL cargar sin redirigir y, en lugar del formulario,
SHALL mostrar con `role="status"` «La búsqueda no está activada en este entorno.» y un enlace «Ver Solo para mí» a
`/mis-links`. En ese estado NO SHALL llamar a la API de búsqueda. Mientras las capacidades no hayan llegado o si su
petición falló, la página SHALL comportarse como sin este requirement, y un `503` de la API SHALL seguir mostrando el
aviso de que la búsqueda no está disponible en este momento.

#### Scenario: Enlace directo con la búsqueda apagada

- **GIVEN** Ana autenticada y la capacidad `search` en `false`
- **WHEN** abre `/buscar` desde un enlace guardado
- **THEN** SHALL seguir en `/buscar` y ver «La búsqueda no está activada en este entorno.»
- **AND** SHALL ver el enlace «Ver Solo para mí» a `/mis-links`
- **AND** NO SHALL ver el campo de consulta
- **AND** el SPA NO SHALL haber pedido `GET /api/search`

#### Scenario: Capacidades caídas

- **GIVEN** la petición de capacidades falló
- **WHEN** Ana abre `/buscar`
- **THEN** SHALL ver el campo de consulta
- **AND** si la API responde `503 search_unavailable`, SHALL ver el aviso de que la búsqueda no está disponible en este momento

#### Scenario: Textos en inglés

- **GIVEN** la interfaz en inglés y la capacidad `search` en `false`
- **WHEN** Ana abre la ruta de búsqueda
- **THEN** el aviso y el enlace SHALL estar en inglés
