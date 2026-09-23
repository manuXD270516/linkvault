## MODIFIED Requirements

### Requirement: Filtros LatAm en UI

La UI de búsqueda SHALL permitir filtrar por **tipo de documento** (`docType`), **grupo** propio
(`groupId`), **modalidad** (`modality`), **estado de postulación** (`applicationStatus`) y
**moneda de salario** (`salaryCurrency` con opciones V0: cualquiera / BOB / USD), con opción
“cualquiera” en cada uno. NO SHALL ofrecer selector de grupos ajenos. NO SHALL exponer toggle de
modo `hybrid|fulltext|semantic` (siempre hybrid por defecto). La query vacía NO SHALL disparar un
listado completo del índice (alineado al contrato de la API: `400 empty_query`), aunque haya
filtros LatAm seleccionados. Copy i18n ES/EN.

**Compatibilidad (D3b):** si el usuario activa `modality` o `salaryCurrency`, la UI SHALL forzar
`docType=job_preview` y limpiar `applicationStatus`. Si activa `applicationStatus`, SHALL forzar
`docType=application` y limpiar modality/currency. NO SHALL enviar a la API modality/currency
junto con `applicationStatus`.

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

#### Scenario: applicationStatus implica tipo application

- **GIVEN** Ana elige estado `applied`
- **WHEN** envía una búsqueda con texto no vacío
- **THEN** la petición SHALL incluir `applicationStatus=applied` y `docType=application`
- **AND** NO SHALL incluir `modality` ni `salaryCurrency`

#### Scenario: Sin toggle de modo

- **GIVEN** Ana en la pantalla de búsqueda
- **WHEN** inspecciona los controles de la feature
- **THEN** NO SHALL existir control de modo hybrid/fulltext/semantic
