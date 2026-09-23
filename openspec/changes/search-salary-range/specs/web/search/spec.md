## MODIFIED Requirements

### Requirement: Filtros LatAm en UI

La UI de búsqueda SHALL permitir filtrar por **tipo de documento** (`docType`), **grupo** propio
(`groupId`), **modalidad** (`modality`), **estado de postulación** (`applicationStatus`),
**moneda de salario** (`salaryCurrency` con opciones V0: cualquiera / BOB / USD), **rango de
salario** (`minSalary` / `maxSalary`, opcionales, números ≥ 0) y **solo
abiertas** (`openOnly`, default desactivado), con opción “cualquiera” donde aplique. NO SHALL
ofrecer selector de grupos ajenos. NO SHALL exponer toggle de modo `hybrid|fulltext|semantic`
(siempre hybrid por defecto). La query vacía NO SHALL disparar un listado completo del índice
(alineado al contrato de la API: `400 empty_query`), aunque haya filtros seleccionados. Copy i18n
ES/EN.

**Compatibilidad (D3b):** si el usuario activa `modality`, `salaryCurrency`, `minSalary`,
`maxSalary` u `openOnly`, la UI SHALL forzar `docType=job_preview` y limpiar
`applicationStatus`. Si activa `applicationStatus`, SHALL forzar `docType=application` y limpiar
modality/currency/`openOnly`/rango. NO SHALL enviar a la API modality/currency/
`openOnly=true`/rango junto con `applicationStatus`. Junto a los inputs de rango, la UI SHALL
mostrar un hint i18n de que el filtro solo aplica a vacantes con salario numérico.

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

#### Scenario: Rango salarial en la petición

- **GIVEN** Ana fija minSalary 3000 y maxSalary 8000
- **WHEN** envía una búsqueda con texto no vacío
- **THEN** la petición SHALL incluir `minSalary=3000`, `maxSalary=8000` y `docType=job_preview`
- **AND** NO SHALL incluir `applicationStatus`

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

- **GIVEN** Ana elige estado `applied` tras haber fijado rango o modalidad
- **WHEN** envía una búsqueda con texto no vacío
- **THEN** la petición SHALL incluir `applicationStatus=applied` y `docType=application`
- **AND** NO SHALL incluir `modality` ni `salaryCurrency` ni `openOnly=true` ni `minSalary` ni
  `maxSalary`

#### Scenario: Sin toggle de modo

- **GIVEN** Ana en la pantalla de búsqueda
- **WHEN** inspecciona los controles de la feature
- **THEN** NO SHALL existir control de modo hybrid/fulltext/semantic
