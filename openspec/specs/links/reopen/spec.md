# links/reopen Specification

## Purpose

Permite a quien puede ver un JobLink deshacer un cierre de frescura (falso positivo) y
volver a tratar la vacante como abierta en listados, SSE y búsqueda.

## Requirements

### Requirement: Reabrir vacante cerrada

`POST /api/links/:id/reopen` autenticado SHALL requerir que el usuario pueda leer el link
(misma regla que editar preview). Si el link está cerrado, SHALL:

1. limpiar `closedAt` y `closedReason`;
2. opcionalmente actualizar `expiresAt` según el body (`YYYY-MM-DD` o `null`, mismo contrato
   que preview; procedencia manual si cambia);
3. setear `lastFreshnessCheckAt` a ahora;
4. responder `200` con el summary **sin** `closedAt`;
5. publicar el summary por SSE **después** del write;
6. encolar SearchUpsert vía el mismo mecanismo outbox que PATCH preview, con fingerprint
   de reopen distinto; el documento `job_preview` SHALL llevar `closedAt: null` cuando el
   link ya no está cerrado (clear de merge Meili; `openOnly` → `closedAt IS NULL`).

Body opcional: `{ expiresAt: string | null }` (`YYYY-MM-DD` o `null`).

Si el link **ya estaba abierto**, SHALL responder `200` idempotente **sin mutar**.

Validación de caducidad (abajo) SHALL aplicarse **solo** cuando el link tenía `closedAt`.

Si `closedReason` es `calendar` **o** la `expiresAt` resultante (día UTC) está en el pasado,
y el body no aporta `expiresAt` futura ni `null`, SHALL responder `400` nombrando
`expiresAt`.

Link ilegible / id inválido: `404` `link_not_found`.
NO SHALL reabrir automáticamente applications en estado `expired`.

#### Scenario: Reopen recheck

- **GIVEN** un link cerrado con `closedReason=recheck` y `expiresAt` futuro o null
- **WHEN** Ana (quien puede verlo) llama reopen sin body
- **THEN** `200` y el summary NO SHALL incluir `closedAt`
- **AND** un listener SSE SHALL poder recibir summary abierto tras el write

#### Scenario: Calendar exige expiresAt

- **GIVEN** un link cerrado con `closedReason=calendar` y `expiresAt` pasado
- **WHEN** Ana llama reopen sin corregir `expiresAt`
- **THEN** SHALL responder `400` nombrando `expiresAt`
- **AND** `closedAt` SHALL permanecer

#### Scenario: Calendar con expiresAt futuro

- **GIVEN** el mismo link calendar
- **WHEN** Ana llama reopen con `expiresAt` = mañana `YYYY-MM-DD`
- **THEN** `200`, sin `closedAt`, y `expiresAt` actualizado

#### Scenario: Idempotente abierto

- **GIVEN** un link sin `closedAt` (aunque `expiresAt` esté pasado)
- **WHEN** Ana llama reopen
- **THEN** `200` sin mutar el documento

#### Scenario: No legible

- **GIVEN** un link que Ana no puede ver
- **WHEN** llama reopen
- **THEN** `404` `link_not_found`

#### Scenario: Apps expired no se reabren

- **GIVEN** una application `expired` del link
- **WHEN** reopen exitoso
- **THEN** esa application SHALL seguir `expired`

#### Scenario: openOnly tras reopen

- **GIVEN** el índice tenía el `job_preview` con `closedAt` ISO
- **WHEN** reopen encola upsert y el worker indexa
- **THEN** una búsqueda con `openOnly=true` SHALL poder incluir ese link
- **AND** el documento Meili SHALL tener `closedAt: null`
