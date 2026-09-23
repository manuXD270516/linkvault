## MODIFIED Requirements

### Requirement: Filtros LatAm en UI

Además de los filtros LatAm vigentes, la UI de búsqueda SHALL ofrecer un control **“Solo
abiertas”** (`openOnly`) con i18n ES/EN. Default: desactivado (no envía filtro de cierre).
Cuando el usuario lo activa, la UI SHALL forzar `docType=job_preview` y limpiar
`applicationStatus`. Cuando activa `applicationStatus`, SHALL limpiar `openOnly`. NO SHALL
mezclar `openOnly=true` con `applicationStatus` en la petición. Empty query sigue sin listar
el índice.

#### Scenario: Solo abiertas en la petición

- **GIVEN** Ana activa “Solo abiertas”
- **WHEN** envía una búsqueda con texto no vacío
- **THEN** la petición SHALL incluir `openOnly=true` y `docType=job_preview`
- **AND** NO SHALL incluir `applicationStatus`

#### Scenario: Desactivado no envía openOnly true

- **GIVEN** Ana deja “Solo abiertas” desactivado
- **WHEN** busca con texto
- **THEN** la petición NO SHALL enviar `openOnly=true`
