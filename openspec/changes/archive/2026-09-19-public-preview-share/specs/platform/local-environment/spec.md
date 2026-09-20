## MODIFIED Requirements

### Requirement: Web y API comparten origen en desarrollo

En desarrollo, las rutas de la API SHALL servirse bajo el prefijo `/api`, excepto `/health`, `/health/live` y la página
pública `/p/:slug`. El servidor de desarrollo de `web` SHALL reenviar a la API toda petición bajo `/api`, de modo que el
navegador vea un único origen.

La página pública de la API (`/p/:slug`) y la vista pública del SPA (`/oferta/:slug`) SHALL tener rutas distintas, para
que puedan servirse desde el mismo dominio sin que ninguna tape a la otra.

#### Scenario: Petición de la SPA a la API

- **GIVEN** `api` y `web` en ejecución en el host
- **WHEN** el navegador pide `/api/<ruta-inexistente>` al origen de `web`
- **THEN** la respuesta SHALL ser un 404 emitido por la API, no el HTML de la SPA

#### Scenario: Salud fuera del prefijo

- **WHEN** se hace `GET /health` contra el puerto de la API
- **THEN** SHALL responder sin necesidad del prefijo `/api`

#### Scenario: Página pública fuera del prefijo

- **WHEN** se hace `GET /p/<slug>` contra el puerto de la API
- **THEN** SHALL responder HTML sin necesidad del prefijo `/api`

#### Scenario: Las dos rutas públicas no chocan

- **GIVEN** `api` y `web` en ejecución
- **WHEN** se piden `/p/<slug>` a la API y `/oferta/<slug>` al origen de `web`
- **THEN** la primera SHALL responder el HTML de la API y la segunda el HTML de la SPA

### Requirement: Configuración por entorno documentada

El repositorio SHALL incluir `.env.example` con todas las variables que leen `api` y `worker`, con valores válidos para
el entorno local y seguros por defecto. La selección de proveedores de IA SHALL expresarse con `AI_CHAIN` y
`AI_MOCK_MODE`; la variable `AI_PROVIDER` NO SHALL usarse. Ningún secreto real SHALL estar versionado.

Las URLs públicas de la página (`PUBLIC_PAGE_BASE_URL`) y del SPA (`WEB_BASE_URL`) SHALL declararse como variables, con
los valores del entorno local, y NO SHALL deducirse de la cabecera `Host` de una petición.

#### Scenario: Valores por defecto seguros

- **WHEN** se inspecciona `.env.example`
- **THEN** `FEATURE_HEADLESS_EXTRACTION` SHALL valer `false`
- **AND** `AI_CHAIN` SHALL valer `mock`
- **AND** NO SHALL contener ninguna clave de API real ni la variable `AI_PROVIDER`

#### Scenario: URLs públicas declaradas

- **WHEN** se inspecciona `.env.example`
- **THEN** SHALL incluir `PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL` con las URLs del entorno local
- **AND** `api` SHALL negarse a arrancar si falta alguna de las dos
