## Why

LinkVault ya junta las ofertas que circulan por WhatsApp, las lee y deja completarlas pegando su texto. Falta la otra
mitad del problema que motivó el producto: **saber en qué proceso está cada quien**. Hoy una persona no puede apuntar
que postuló, que la llamaron o que la rechazaron, y el grupo no puede ver quién más está detrás de una oferta. Este es
el change que convierte el repositorio de links en un tracker de postulaciones (docs/design.md, módulo
`applications`; design-v0.2 §5.3 y §6, orden 8).

La transferencia de propiedad de un grupo y el límite de intentos de `POST /api/groups/join`, que el primer borrador
arrastraba como deudas de `groups`, se entregan antes en su propio change, `groups-ownership-join-limit` (decisión
humana del 2026-09-19). Este change no depende de ellos funcionalmente: las postulaciones sobreviven al borrado de un
grupo y a cualquier salida o expulsión, porque su visibilidad en el grupo se deriva en cada lectura (ADR-024). Sí
comparten archivos, así que su apply empieza cuando aquel esté fusionado (ver Impact).

## What Changes

- **Postulación por persona y oferta** (`Application`, única por `(userId, linkId)`): nace con el primer gesto de
  seguimiento —"Me interesa" o "Postulé" desde la tarjeta—, nunca al guardar un link, y solo sobre una oferta que la
  persona puede ver. Entrar en un estado de postulada sin fecha pregunta "¿Cuándo postulaste?", con "Hoy" como
  respuesta principal.
- **Estados canónicos de ADR-004 con transiciones libres** (ADR-024 sustituye sus "terminales"): saltos hacia delante,
  retrocesos para corregir, cierre desde cualquier estado y reapertura; `stageLabel` libre solo en "En proceso". Cada
  cambio queda en el historial (`ApplicationEvent`) y se protege contra dos pestañas con una versión; un cambio sin
  diferencia no escribe ni da conflicto.
- **Dejar de seguir**: `DELETE /api/applications/:id` borra la postulación y todo su historial; deja de verse en el
  tablero y en los grupos.
- **Privada por defecto, un interruptor para compartir** (ADR-015): quien lo activa aparece, con su nombre y su estado
  canónico, en la tarjeta de esa oferta de cada grupo suyo donde esté compartida, también en los grupos donde la oferta
  llegue después y ante quien entre después; el texto junto al interruptor lo dice. Tras "Me interesa" o "Postulé" en
  un grupo, un aviso que dice ese alcance ofrece "Compartir" en un clic, y "Deshacer" justo después. Nada más sale:
  ni etapa, ni notas, ni historial. La visibilidad se
  **deriva** en cada lectura, así que salir de un grupo, ser expulsado, quitar la oferta del grupo o borrarlo la
  retiran al instante sin tocar la postulación privada.
- **Reservado y modelado, sin uso**: `fitScore?` en el modelo (lo escribirá `cv-match-suggestions`) y el evento de
  integración `ApplicationStale.v1` en `libs/shared/events`, sin productor ni notificación (F2).
- **Frontend**: tablero `/postulaciones` (ruta lazy) con una columna por estado activo y "Cerradas" para los cierres,
  mover por arrastre o por menú, historial, notas, compartir y "Dejar de seguir" en un panel, gestos "Me
  interesa"/"Postulé" y el estado propio en cada tarjeta, y los avatares de quienes comparten su estado en la tarjeta de
  grupo. Textos en ES y EN, con gestos en primera persona y nombres de estado neutros.

## Capabilities

### New Capabilities
- `applications/tracking`: nacimiento, unicidad, estados y transiciones, etapa libre, fecha de postulación, historial,
  notas, concurrencia, dejar de seguir y acceso de la postulación propia; `fitScore` reservado y
  `ApplicationStale.v1` modelado.
- `applications/group-visibility`: el interruptor de compartir, qué ve el grupo, la consulta de estados compartidos de
  una página de tarjetas sin N+1 y la visibilidad derivada al salir, ser expulsado, quitar la oferta o borrar el grupo.
- `web/applications`: el tablero, el panel de detalle, los gestos de seguimiento en la tarjeta, la invitación a
  compartir y los avatares del grupo.

### Modified Capabilities
- `groups/group-management`: nuevo requisito "El borrado no alcanza a las postulaciones".
- `links/sharing`: nuevo requisito "Links disponibles para otros módulos" (la fachada que usa `applications`).

## Impact

- **Código**: módulo nuevo `apps/api/src/modules/applications/` (clean architecture, puertos por token);
  `apps/api/src/modules/links/` (primera fachada exportada, `LinksFacade`); `api-exception.filter.ts` (ramas de
  `applications`); `libs/shared/src/` (contratos de postulaciones, códigos de error y `ApplicationStale.v1`);
  `apps/web/src/app/features/applications/`, `core/applications/`, `features/groups/` y `features/links/`.
- **API**: `POST /api/applications`, `GET /api/applications`, `PATCH /api/applications/:id/status`,
  `PATCH /api/applications/:id`, `DELETE /api/applications/:id`, `GET /api/applications/:id/events` y
  `GET /api/groups/:id/applications`.
- **Datos**: colecciones `applications` (único `(userId, linkId)`) y `application_events`. Nada pasa por el outbox:
  este change no encola nada (ADR-009).
- **Tiempo real**: el cambio de estado compartido **no** se publica por el canal de `platform/realtime` en este change
  (ADR-024 §9).
- **ADRs**: implementa ADR-002, ADR-004 y ADR-015; **ADR-024** registra las decisiones no triviales y sustituye en
  parte ADR-004; respeta ADR-009 (sin encolado), ADR-020 §6 (límites entre módulos) y ADR-021 §5 (lista privada), del
  que se aparta en la cascada del borrado de grupo con motivo escrito en ADR-024 §6.
- **Depende de**: `groups-ownership-join-limit`. Ninguna tarea necesita su comportamiento, pero los dos tocan
  `apiErrorCodeSchema`, `api-exception.filter.ts` y `messages.*.xlf`: el apply de este change **empieza después de
  fusionar** `groups-ownership-join-limit` en `main`, y la rama se rebasa sobre `main` antes de tocar esos tres
  archivos (tarea 1.1).
- **Fuera de alcance**: notificaciones y la alerta de postulación estancada (solo se modela el evento), el cálculo de
  `fitScore`, comentarios de grupo, el filtro "Sin seguir" y los gestos por lotes, corregir la fecha de una postulación
  que ya la tiene, y cualquier dato de la postulación que no sea el estado canónico visible para el grupo.
