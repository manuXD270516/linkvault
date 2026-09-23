# web/search Specification

## Purpose

Ofrece en la SPA una pantalla de búsqueda para encontrar vacantes, postulaciones, comentarios, notas, CVs y roadmaps
propios o de grupo, con resultados navegables y textos i18n ES/EN.

## Requirements

### Requirement: Ruta lazy de búsqueda

El SPA SHALL exponer una ruta autenticada de búsqueda (p. ej. `/buscar` en ES), cargada de forma lazy, enlazada desde la
navegación principal cuando la persona tiene sesión. Sin sesión, la ruta SHALL redirigir al login como el resto de
features privadas.

#### Scenario: Entrar a buscar con sesión

- **GIVEN** Ana autenticada
- **WHEN** navega a la ruta de búsqueda
- **THEN** SHALL ver el campo de consulta y poder enviar una búsqueda
- **AND** el chunk de la feature NO SHALL cargarse en el bundle inicial obligatorio de login

### Requirement: Resultados tipados y navegación

Cada hit SHALL mostrar al menos: tipo de documento (etiqueta i18n), título o extracto, y acción para abrir el recurso
correspondiente (detalle de link/grupo, postulación, CV, roadmap). Si la API marca `degraded`, la UI SHALL mostrar un
aviso breve no bloqueante. Estados vacíos y de error (`503`, red) SHALL tener copy honesto en ES y EN.

#### Scenario: Click en un hit de preview

- **GIVEN** un hit `job_preview` en los resultados
- **WHEN** Ana lo activa
- **THEN** SHALL navegar al contexto del link/grupo documentado
- **AND** NO SHALL perderse el tipo de documento en la etiqueta visible

#### Scenario: Aviso de degradación

- **GIVEN** la API responde con `degraded: true`
- **WHEN** se muestran resultados
- **THEN** SHALL verse un aviso de que la búsqueda semántica no está disponible
- **AND** los hits full-text SHALL seguir visibles si los hay

### Requirement: Filtros LatAm en UI

La UI de búsqueda SHALL permitir filtrar por **tipo de documento** (`docType`), **grupo** propio
(`groupId`), **modalidad** (`modality`), **estado de postulación** (`applicationStatus`),
**moneda de salario** (`salaryCurrency` con opciones V0: cualquiera / BOB / USD) y **solo
abiertas** (`openOnly`, default desactivado), con opción “cualquiera” donde aplique. NO SHALL
ofrecer selector de grupos ajenos. NO SHALL exponer toggle de modo `hybrid|fulltext|semantic`
(siempre hybrid por defecto). La query vacía NO SHALL disparar un listado completo del índice
(alineado al contrato de la API: `400 empty_query`), aunque haya filtros seleccionados. Copy i18n
ES/EN.

**Compatibilidad (D3b):** si el usuario activa `modality`, `salaryCurrency` u `openOnly`, la UI
SHALL forzar `docType=job_preview` y limpiar `applicationStatus`. Si activa `applicationStatus`,
SHALL forzar `docType=application` y limpiar modality/currency/`openOnly`. NO SHALL enviar a la
API modality/currency/`openOnly=true` junto con `applicationStatus`.

#### Scenario: Filtro por tipo

- **GIVEN** Ana en la pantalla de búsqueda
- **WHEN** limita a tipo `application` y busca un término
- **THEN** la petición a la API SHALL incluir ese filtro
- **AND** la UI NO SHALL mostrar hits de otros tipos si la API los omite

#### Scenario: Filtros LatAm en la petición

- **GIVEN** Ana elige modalidad `remote` y moneda `USD` (estado de postulación en “cualquiera”)
- **WHEN** envía una búsqueda con texto no vacío
- **THEN** la petición SHALL incluir `modality=remote`, `salaryCurrency=USD` y
  `docType=job_preview` (implícito o explícito)
- **AND** NO SHALL incluir `applicationStatus`
- **AND** NO SHALL existir control de modo hybrid/fulltext/semantic

#### Scenario: Solo abiertas en la petición

- **GIVEN** Ana activa “Solo abiertas”
- **WHEN** envía una búsqueda con texto no vacío
- **THEN** la petición SHALL incluir `openOnly=true` y `docType=job_preview`
- **AND** NO SHALL incluir `applicationStatus`

#### Scenario: Desactivado no envía openOnly true

- **GIVEN** Ana deja “Solo abiertas” desactivado
- **WHEN** busca con texto
- **THEN** la petición NO SHALL enviar `openOnly=true`

#### Scenario: applicationStatus implica tipo application

- **GIVEN** Ana elige estado `applied`
- **WHEN** envía una búsqueda con texto no vacío
- **THEN** la petición SHALL incluir `applicationStatus=applied` y `docType=application`
- **AND** NO SHALL incluir `modality` ni `salaryCurrency` ni `openOnly=true`

#### Scenario: Sin toggle de modo

- **GIVEN** Ana en la pantalla de búsqueda
- **WHEN** inspecciona los controles de la feature
- **THEN** NO SHALL existir control de modo hybrid/fulltext/semantic

### Requirement: i18n ES/EN

Etiquetas de tipos, placeholders, vacíos, errores y aviso de degradación SHALL existir en español (default) e inglés.

#### Scenario: Cambio de idioma

- **GIVEN** la UI en inglés
- **WHEN** Ana abre la búsqueda
- **THEN** las cadenas visibles de la feature SHALL estar en inglés

