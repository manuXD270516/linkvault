# links/freshness Specification

## Purpose

Mantiene frescas las vacantes ya enriquecidas: relee con cadencia semanal (o cierra por
`expiresAt`), marca el cierre con honestidad y no deja postulaciones abiertas sobre ofertas muertas.

## Requirements

### Requirement: Elegibilidad para re-check

Con `FEATURE_LINK_FRESHNESS=true`, el worker SHALL considerar elegibles los JobLink cuyo
`previewStatus` sea `enriched`, `partial` o `manual`, que **no** estén ya cerrados, y que cumplan
**al menos una** de:

1. **Cadencia:** la última revisión de frescura (o, si nunca, el último enriquecimiento /
   `previewRequestedAt`) tiene al menos el intervalo configurado (por defecto 7 días); o
2. **Calendario urgente:** `preview.expiresAt` (date) es **estrictamente anterior** al día UTC
   actual (entra aunque la cadencia aún no haya vencido).

Un link `pending` o `failed` NO SHALL entrar por frescura (siguen retry/backfill de enrichment).
Con el flag en `false`, el scheduler SHALL ser no-op.

#### Scenario: Link enriquecido viejo entra

- **GIVEN** `FEATURE_LINK_FRESHNESS=true` y un link `enriched` sin cierre cuya última revisión fue
  hace 8 días
- **WHEN** corre el detector de frescura
- **THEN** ese link SHALL quedar reclamado para re-check en esa pasada

#### Scenario: expiresAt pasado entra sin esperar la semana

- **GIVEN** un link `enriched` revisado hace 1 día con `expiresAt` ayer (UTC)
- **WHEN** corre el detector
- **THEN** ese link SHALL quedar reclamado
- **AND** SHALL cerrarse por calendario sin scrape

#### Scenario: Link recién enriquecido sin expiresAt pasado no entra

- **GIVEN** un link `enriched` revisado hace 1 día sin `expiresAt` pasado
- **WHEN** corre el detector
- **THEN** NO SHALL reclamarse para re-check

#### Scenario: Flag apagado

- **GIVEN** `FEATURE_LINK_FRESHNESS=false`
- **WHEN** corre el detector
- **THEN** NO SHALL reclamarse ningún link

### Requirement: Cascada pendiente sobre vacantes ya cerradas

El mismo detector SHALL reclamar, además de las abiertas elegibles, los JobLink que **ya** tienen
`closedAt` y aún tienen postulaciones abiertas **o** una postulación `visibility=group`
auto-expirada cuyo ASN de grupo **no** está confirmado (claim pendiente, lease vencido, o claim
liberado tras fallar `Queue.add`). Esa pasada SHALL ejecutar solo el efecto sobre postulaciones /
notify (sin scrape ni re-check). En cada tick, el detector SHALL priorizar estos links de cascada
dentro de `LINK_FRESHNESS_BATCH_LIMIT` antes de reclamar abiertas. Con el flag en `false`, tampoco
SHALL correr.

#### Scenario: Link cerrado con app abierta vuelve a reclamarse

- **GIVEN** un link con `closedAt` y Ana aún en `applied`
- **WHEN** corre el detector
- **THEN** ese link SHALL reclamarse en el selector de cascada
- **AND** Ana SHALL poder pasar a `expired` sin nueva descarga

#### Scenario: Claim ASN pendiente tras release

- **GIVEN** un link cerrado, Ana ya `expired` con `visibility=group`, y claim de notify liberado
  tras fallar `Queue.add`
- **WHEN** corre el detector
- **THEN** ese link SHALL reclamarse
- **AND** el ASN SHALL poder encolarse de nuevo

### Requirement: Límite por ejecución e idempotencia

Cada pasada del detector SHALL procesar como máximo `LINK_FRESHNESS_BATCH_LIMIT` links (valor
documentado, acotado). La reclamación SHALL usar lease/TTL (mismo espíritu que postulaciones
estancadas): si el encolado falla, la marca NO SHALL quedar dura. El `jobId` del re-check SHALL ser
determinista por `linkId` y ventana de cadencia, de modo que dos workers no dupliquen trabajo vivo.

#### Scenario: Tope de lote

- **GIVEN** 200 links elegibles y límite 50
- **WHEN** corre una pasada
- **THEN** SHALL reclamarse como máximo 50

#### Scenario: Reclamación con lease

- **GIVEN** un link reclamado cuyo job no llegó a encolarse
- **WHEN** vence el lease
- **THEN** el link SHALL volver a ser elegible

### Requirement: Caducidad por calendario

Si un link elegible (o uno que el detector inspecciona) tiene `preview.expiresAt` con día **estrictamente
anterior** al día UTC actual, el sistema SHALL marcar la vacante como cerrada con razón `calendar`
**sin** descargar la página. Ese cierre SHALL aplicar también a plataformas cuyo `robots.txt` prohíbe
la lectura automática.

#### Scenario: expiresAt pasado cierra sin scrape

- **GIVEN** un link `enriched` con `expiresAt` `2026-01-01` y hoy `2026-09-22`
- **WHEN** el detector lo considera
- **THEN** el link SHALL quedar cerrado con razón `calendar`
- **AND** NO SHALL encolarse descarga ni `extract-job`

#### Scenario: expiresAt futuro no basta

- **GIVEN** un link con `expiresAt` mañana
- **WHEN** el detector lo considera
- **THEN** NO SHALL cerrarse solo por calendario
- **AND** si cumple la cadencia, SHALL poder encolarse re-check de página

### Requirement: Re-check de página

Si no aplica cierre por calendario y la plataforma **permite** lectura (no `robots_disallowed` /
bloqueo conocido), el re-check SHALL pedir una nueva lectura con `jobId` determinista
`fresh:{linkId}:{bucket}` donde `bucket` es
`floor(númeroDeDíaUTC / LINK_FRESHNESS_INTERVAL_DAYS)`, y payload que incluya `previewVersion`
actual y `triggeredBy: freshness`, reutilizando el pipeline de enrichment. Tras un re-check
exitoso sin cierre, SHALL actualizarse la marca de última revisión de frescura.

#### Scenario: Vacante sigue viva y cambia un campo auto

- **GIVEN** un link `enriched` con `title` automático
- **WHEN** el re-check obtiene un título automático distinto y título/empresa siguen presentes
- **THEN** el preview SHALL actualizarse según las reglas de procedencia
- **AND** el link NO SHALL quedar cerrado
- **AND** SHALL quedar registrada la revisión

#### Scenario: Manual no se pisa en re-check

- **GIVEN** un link con `title` `manual`
- **WHEN** el re-check propone otro título
- **THEN** el `title` SHALL seguir siendo el manual
- **AND** los campos automáticos elegibles SHALL poder actualizarse

#### Scenario: Bolsa que prohíbe lectura

- **GIVEN** un link de plataforma con lectura prohibida y sin `expiresAt` pasado
- **WHEN** el detector lo considera
- **THEN** NO SHALL encolarse scrape
- **AND** NO SHALL marcarse cerrado solo por no poder leer
- **AND** SHALL poder aplazarse la próxima revisión de frescura (sin castigar con `failed`)

### Requirement: Cierre por relectura

Tras un re-check con `triggeredBy: freshness`, el sistema SHALL marcar la vacante cerrada con
razón `recheck` solo si la señal es inequívoca:

- motivo de descarga `not_found` (HTTP 404 o 410), **o**
- `isJobPosting: false` **y** la pasada **no** detectó JSON-LD `JobPosting`, habiendo tenido antes
  preview con datos (`enriched` / `partial` / `manual`).

NO SHALL cerrar por: `http_error` genérico, `429`, timeout, `robots_disallowed`, `blocked`,
degradación de IA, `no_data`, ni `isJobPosting: false` si hubo JSON-LD `JobPosting`. Un cierre por
relectura NO SHALL vaciar ni pisar campos `manual`/`pasted`, ni degradar a `failed` vacío un
preview con datos. Un enrich **sin** `triggeredBy: freshness` que reciba `not_found` conserva el
comportamiento de enrichment (`failed` / motivo), sin cerrar por frescura.

#### Scenario: not_found cierra sin borrar el preview

- **GIVEN** un link `enriched` con título y empresa
- **WHEN** el re-check de frescura obtiene motivo `not_found`
- **THEN** el link SHALL quedar cerrado con razón `recheck`
- **AND** el preview existente SHALL conservarse
- **AND** `previewStatus` NO SHALL pasar a `failed` vacío

#### Scenario: Ya no es vacante sin JobPosting

- **GIVEN** un link `enriched`
- **WHEN** el re-check descarga la página sin JSON-LD `JobPosting` y la IA responde
  `isJobPosting: false`
- **THEN** el link SHALL quedar cerrado con razón `recheck`
- **AND** NO SHALL guardarse un título inventado de esa página

#### Scenario: Login wall no cierra

- **GIVEN** un link `enriched`
- **WHEN** la página responde 200 con muro de login, la IA dice `isJobPosting: false`, pero hay
  JSON-LD `JobPosting`
- **THEN** el link NO SHALL cerrarse

#### Scenario: http_error no cierra

- **GIVEN** un link `enriched`
- **WHEN** el re-check obtiene `http_error` (p. ej. 500)
- **THEN** el link NO SHALL cerrarse
- **AND** la vacante SHALL seguir abierta

#### Scenario: 429 no cierra

- **GIVEN** un link `enriched`
- **WHEN** el re-check recibe `429`
- **THEN** el link NO SHALL cerrarse
- **AND** el motivo transitorio SHALL registrarse según enrichment
- **AND** la vacante SHALL seguir abierta

### Requirement: Marcador de vacante cerrada en el contrato

Todo JobLink cerrado SHALL exponer en las respuestas de listado/detalle al menos `closedAt`
(ISO datetime) y `closedReason` (`calendar` | `recheck`). Un link no cerrado NO SHALL llevar esos
campos (o SHALL llevarlos ausentes). Reabrir una vacante cerrada (si en el futuro se implementa)
queda fuera de este change: en V0 el cierre es terminal a nivel de link.

#### Scenario: Contrato con cierre

- **GIVEN** un link cerrado por calendario
- **WHEN** un miembro lo ve en la lista
- **THEN** la respuesta SHALL incluir `closedAt` y `closedReason` `calendar`

#### Scenario: Link abierto

- **GIVEN** un link `enriched` no cerrado
- **WHEN** se lista
- **THEN** la respuesta NO SHALL afirmar que está cerrado

### Requirement: Efecto sobre postulaciones al cerrar

Al cerrar una vacante —o al reentrar sobre un link **ya** con `closedAt` que aún tenga
postulaciones abiertas— el sistema SHALL pasar a `expired` las de ese `linkId` en estados abiertos
(`saved`, `interested`, `applied`, `in_process`, `offer`), cada una con **exactamente un** evento
de historial (origen → `expired`) en la misma escritura atómica que el cambio. Ya en `rejected` /
`withdrawn` / `expired` / `accepted` NO SHALL modificarse (sin segundo evento). Para
`visibility=group`, el fan-out ASN SHALL seguir el claim→`Queue.add`→confirm de
`notifications/dispatch` (no basta con “cambió en este paso”). NO SHALL existir canal dedicado
“vacante cerró”.

#### Scenario: Abiertas pasan a expired

- **GIVEN** Ana en `applied` y Luis en `interested` sobre el mismo link, y Marta en `rejected`
- **WHEN** el link se cierra
- **THEN** Ana y Luis SHALL quedar en `expired` con un evento nuevo cada uno
- **AND** Marta SHALL seguir en `rejected`

#### Scenario: Accepted no se toca

- **GIVEN** una postulación en `accepted` sobre el link
- **WHEN** el link se cierra
- **THEN** esa postulación SHALL seguir en `accepted`

#### Scenario: Reintento no duplica historial

- **GIVEN** Ana ya en `expired` tras un cierre previo del mismo link
- **WHEN** se vuelve a ejecutar el efecto de cierre
- **THEN** Ana SHALL seguir en `expired` sin un evento adicional

#### Scenario: Link ya cerrado con postulación aún abierta

- **GIVEN** un link con `closedAt` y Ana aún en `applied` (efecto interrumpido antes)
- **WHEN** se vuelve a ejecutar el efecto de cierre
- **THEN** Ana SHALL pasar a `expired` con un evento
- **AND** si `visibility=group`, el ASN SHALL quedar reclamable según `notifications/dispatch`

#### Scenario: Visibility group encola ASN desde worker

- **GIVEN** una postulación `visibility=group` en `in_process`
- **WHEN** el cierre la pasa a `expired`
- **THEN** SHALL reclamarse el fan-out y encolarse `ApplicationStatusNotify.v1` sin `outbox_events`
- **AND** `actorUserId` SHALL ser el dueño de esa postulación
- **AND** NO SHALL exigirse un template nuevo de “vacante cerró”

### Requirement: Aviso en vivo al cerrar

Tras cerrar una vacante (calendario o relectura), el sistema SHALL publicar por el canal de
enriquecimiento en vivo el summary actualizado del link, incluyendo `closedAt` y `closedReason`,
para que una lista abierta refresque la tarjeta sin recargar la página.

#### Scenario: Cierre por calendario refresca la lista

- **GIVEN** un miembro con la lista abierta y un link que cierra por `expiresAt`
- **WHEN** el detector cierra ese link
- **THEN** SHALL publicarse el aviso con `closedAt` / `closedReason` `calendar`
- **AND** la tarjeta SHALL poder mostrar el indicador de oferta cerrada sin reload
