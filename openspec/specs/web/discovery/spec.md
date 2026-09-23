# web/discovery Specification

## Purpose
Página autenticada para descubrir vacantes en bolsas y guardarlas en el vault sin salir
de la SPA.

## Requirements

### Requirement: Página /descubrir

La SPA SHALL exponer `/descubrir` (lazy, auth) con búsqueda, selector de board
(getonboard / remoteok / todas), lista de resultados y acción Guardar por hit (destino
**privado** en v1). Copy i18n ES/EN, incluida cobertura (“LinkedIn/Computrabajo no vía
discovery”). Si la API devuelve `degraded`, SHALL mostrarlo. Con `503` discovery_disabled,
SHALL empty honesto. Guardar SHALL usar el cliente de links (`POST /api/links`) y SHALL
mostrar confirmación de **creado**, **ya existía** o **error** (no silencioso).

#### Scenario: Buscar y guardar con feedback

- **GIVEN** Ana en `/descubrir` con discovery habilitado
- **WHEN** busca y pulsa Guardar en un hit
- **THEN** SHALL invocarse el save de links
- **AND** SHALL mostrarse feedback de creado o ya existía

#### Scenario: Degradación visible

- **GIVEN** la API incluye `degraded`
- **WHEN** Ana ve resultados
- **THEN** SHALL ver aviso de bolsa no disponible además de los hits
