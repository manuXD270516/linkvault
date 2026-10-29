## Why

El componente común de errores del SPA (`apps/web/src/app/shared/ui/request-error.ts:42-50`) solo distingue «sin
conexión» y `429 too_many_attempts`. Todo lo demás —un `503` pasajero, un `502` del proxy durante un despliegue, un
`500` de verdad o un código que el SPA nunca previó— dice lo mismo: «Algo salió mal. Inténtalo de nuevo». Lo usan 42
pantallas y diálogos (31 ficheros; el relevamiento de producto del 2026-10-28 hablaba de unas 44).

De los 48 códigos de `apiErrorCodeSchema` (`libs/shared/src/schemas/auth.schema.ts:114-216`), 37 aparecen en algún
fichero del SPA y 11 en ninguno. Entre ellos, `vault_unavailable` (guardar una clave BYOK sin bóveda: H3 de la guía
de uso), `consent_text_outdated` (el permiso de IA cambió tras un despliegue) y `member_not_found` /
`owner_cannot_leave` (carreras entre dos sesiones): en los cuatro, «inténtalo de nuevo» lleva a repetir algo que
vuelve a fallar. `internal_error` solo se trata en el diálogo de encaje, y como estado de un análisis, no como
respuesta HTTP.

Para la medición de 35b esto importa: en la conversación del día 14, «me salió "Algo salió mal"» no distingue un
despliegue en curso de un fallo del producto, y no hay nada que la persona pueda copiar para que el autor lo encuentre.
Y nada impide que el próximo código —`paste-fallback-honest` ya propone tres— caiga en el genérico sin que nadie lo
decida.

## What Changes

- **Mensajes comunes por clase de fallo.** `lv-request-error` resuelve primero por código (texto común propio, sea cual
  sea el estado) y después por estado: `502`/`503`/`504` sin código o con un código `fallback` → «LinkVault no está
  disponible en este momento. Inténtalo en unos minutos»; el resto, también un `5xx` con un código que traduce otra
  pantalla → «Algo salió mal. Inténtalo de nuevo» (texto e id `@@error.unknown` sin cambio). `/notificaciones` deja de
  pintar el componente común debajo de su aviso de push no disponible.
- **Referencia técnica** «Si lo reportas, menciona: 500 · internal_error» bajo esos dos mensajes, fuera del
  `role="alert"`, para que quien reporta pueda copiarla.
- **Textos comunes nuevos** para `member_not_found`, `owner_cannot_leave`, `consent_text_outdated` y
  `vault_unavailable` (este último cierra H3 si el owner lo asigna aquí, Q2).
- **Guardia de cobertura.** Tabla `API_ERROR_COPY` (`apps/web/src/app/shared/ui/api-error-copy.ts`) con una decisión
  por código —`common`, `local` (con los ficheros que lo traducen), `fallback` o `unreachable` (con motivo)—, tipada
  como `Record<ApiErrorCode, …>`: un código nuevo sin decisión rompe `web:typecheck` y `web:test`. Sirve igual si los
  códigos de otros changes llegan antes o después. Comprobar en `web:i18n-check` que cada entrada `local` se cumple
  queda para después de 35c.
- **i18n ES/EN** según ADR-050.
- **Requirements:** capacidad nueva `web/request-errors`; MODIFIED de «Registro y login» de `web/auth` (sus viñetas de
  errores comunes); ADDED «Bóveda de claves no disponible» en `web/byok`.

**Fuera:** textos de motivos de enriquecimiento (`EnrichmentFailureReason`, p. ej. `unsafe_destination` de
`enrichment-egress-guard`; Q3), los textos propios de `paste-fallback-honest` y los de «no incluida en esta versión» de
`web-shell-capabilities` (cada uno los define su change; este solo exige que sus códigos tengan entrada), H11
(`AI_VAULT_KEY` en `e2e.env` y `byok.spec.ts`, sigue en `e2e-suite-lot-2`), y cualquier cambio en la API, workflows,
composes o `infra/ci/`; la comprobación automática de las entradas `local` (después de 35c), y el texto del aviso
de invitación de 35b (se le recomienda «si ves un código bajo el error, manda una captura»).

## Capabilities

### New Capabilities

- `web/request-errors`: mensajes comunes de fallo, referencia técnica, textos comunes por código y la regla de que
  cada código de la API tiene una decisión de texto.

### Modified Capabilities

- `web/auth`: «Registro y login» delega sus errores comunes en `web/request-errors` y gana el caso de servicio no
  disponible.
- `web/byok`: «Bóveda de claves no disponible» (H3).

## Impact

- **Código:** `apps/web/src/app/shared/ui/request-error.ts` (+ spec nuevo), `api-error-copy.ts` (+ spec),
  `features/notifications/notifications.page.html` (+ spec), specs de `profile.page` y `group-detail.page`,
  `messages.xlf` (extracción) y `messages.en.xlf`.
- **API, `libs/shared`, `libs/ai`:** sin cambios.
- **ADR:** ADR-062 (Propuesto): la regla de cobertura y la excepción pedida. Anotación de una línea en ADR-050.
- **Encaje:** pide una excepción a la precedencia de la fila 35 (Q1, bloqueante para `/opsx:apply`), con las tres
  clases de fusión, la confirmación fechada del owner y la repetición de la 9.4 de `e2e-suite` sobre el último commit
  desplegado; si no se concede, va después de 35c.
- **Coordinación:** el change que se fusione segundo entre este y `paste-fallback-honest` añade las entradas de
  `ai_consent_required`, `ai_capacity_exhausted` y `extraction_disabled` (el guardia lo obliga).
