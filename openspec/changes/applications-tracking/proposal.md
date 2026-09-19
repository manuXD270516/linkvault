## Why

LinkVault ya junta las ofertas que circulan por WhatsApp, las lee y deja completarlas pegando su texto. Falta la otra
mitad del problema que motivó el producto: **saber en qué proceso está cada quien**. Hoy una persona no puede apuntar
que postuló, que la llamaron o que la rechazaron, y el grupo no puede ver quién más está detrás de una oferta. Este es
el change que convierte el repositorio de links en un tracker de postulaciones (docs/design.md, módulo
`applications`; design-v0.2 §5.3 y §6, orden 8).

Arrastra además dos deudas que se vuelven urgentes justo aquí:

- **El owner de un grupo no puede irse sin destruirlo.** No puede salir ni ser expulsado, y su única salida es borrar el
  grupo, que ya se lleva las ofertas que los demás compartieron allí (quien solo las guardó en ese grupo las pierde,
  porque compartir no crea entrada privada, ADR-021 §5). Con postulaciones compartidas, borraría además lo que los
  demás cuentan de sus procesos en esas tarjetas.
- **`POST /api/groups/join` no cuenta los intentos fallidos.** Desde `job-links` el código de invitación da acceso a
  ofertas de terceros, y desde este change también a quién postula a qué.

## What Changes

- **Transferir la propiedad de un grupo (primero de todo)**: el owner nombra owner a otro miembro y pasa a ser
  `member`, en una sola escritura atómica que mantiene la membresía `owner` única; después puede salir como cualquiera.
  La confirmación de borrado del grupo sugiere esta salida.
- **Límite de intentos al unirse con un código**: los códigos incorrectos se cuentan por usuario y por IP con el mismo
  contador por ventana fija que `auth` (Redis), y al superarse responden `429 too_many_attempts` con `Retry-After`. Un
  código válido no gasta intentos ni pone el contador a cero.
- **Postulación por persona y oferta** (`Application`, única por `(userId, linkId)`): nace con el primer gesto de
  seguimiento —"Me interesa" o "Postulé" desde la tarjeta—, nunca al guardar un link, y solo sobre una oferta que la
  persona puede ver.
- **Estados canónicos de ADR-004** con saltos hacia delante, retrocesos para corregir, cierre desde cualquier estado y
  reapertura; `stageLabel` libre solo en "En proceso". Cada cambio queda en el historial (`ApplicationEvent`) y se
  protege contra dos pestañas con una versión.
- **Privada por defecto, un interruptor para compartir** (ADR-015): quien lo activa aparece, con su nombre y su estado
  canónico, en la tarjeta de esa oferta de cada grupo suyo donde esté compartida. Nada más sale: ni etapa, ni notas, ni
  historial. La visibilidad se **deriva** en cada lectura, así que salir de un grupo, ser expulsado, quitar la oferta del
  grupo o borrarlo la retiran al instante sin tocar la postulación privada.
- **Reservado y modelado, sin uso**: `fitScore?` en el modelo (lo escribirá `cv-match-suggestions`) y el evento de
  integración `ApplicationStale.v1` en `libs/shared/events`, sin productor ni notificación (F2).
- **Frontend**: tablero `/postulaciones` (ruta lazy) con una columna por estado y "Cerradas" para los finales, mover por
  arrastre o por menú, historial y notas en un panel, gestos "Me interesa"/"Postulé" y el estado propio en cada tarjeta,
  y los avatares de quienes comparten su estado en la tarjeta de grupo. Textos en ES y EN.

## Capabilities

### New Capabilities
- `applications/tracking`: nacimiento, unicidad, estados y transiciones, etapa libre, historial, notas, concurrencia y
  acceso de la postulación propia; `fitScore` reservado y `ApplicationStale.v1` modelado.
- `applications/group-visibility`: el interruptor de compartir, qué ve el grupo, la consulta de estados compartidos de
  una página de tarjetas sin N+1 y la visibilidad derivada al salir, ser expulsado, quitar la oferta o borrar el grupo.
- `web/applications`: el tablero, el panel de historial, los gestos de seguimiento en la tarjeta y los avatares del grupo.

### Modified Capabilities
- `groups/membership`: nuevos requisitos "Transferir la propiedad" y "Límite de intentos al unirse"; "Salir de un
  grupo" gana el escenario del antiguo owner que sale tras transferir.
- `groups/group-management`: "Borrado por el owner" deja escrito que no borra ninguna postulación.
- `links/sharing`: nuevo requisito "Links disponibles para otros módulos" (la fachada que usa `applications`).
- `web/groups`: el detalle ofrece "Nombrar owner" y explica al owner cómo salir; la confirmación de borrado sugiere
  transferir; unirse explica el `429`.

## Impact

- **Código**: módulo nuevo `apps/api/src/modules/applications/` (clean architecture, puertos por token);
  `apps/api/src/modules/groups/` (caso de uso de transferencia, índice parcial de owner único, límite del join);
  `apps/api/src/modules/links/` (primera fachada exportada, `LinksFacade`); `apps/api/src/infrastructure/limits/`
  (la agrupación de IP deja de ser privada de `auth`); `libs/shared/src/` (contratos de postulaciones, códigos de error y
  `ApplicationStale.v1`); `apps/web/src/app/features/applications/`, `features/groups/` y `features/links/`.
- **API**: `POST /api/groups/:id/owner`; `POST /api/groups/join` puede responder `429`; `POST /api/applications`,
  `GET /api/applications`, `PATCH /api/applications/:id/status`, `PATCH /api/applications/:id`,
  `GET /api/applications/:id/events` y `GET /api/groups/:id/applications`.
- **Datos**: colecciones `applications` (único `(userId, linkId)`) y `application_events`; índice único parcial de un
  solo owner por grupo en `group_members`. Nada pasa por el outbox: este change no encola nada (ADR-009).
- **Tiempo real**: el cambio de estado compartido **no** se publica por el canal de `platform/realtime` en este change
  (design D8).
- **ADRs**: implementa ADR-002, ADR-004 y ADR-015; respeta ADR-009 (sin encolado, sin outbox), ADR-020 §5–6 (límite
  que falla abierto, límites entre módulos) y ADR-021 §5–6 (lista privada, cascada del borrado). Las decisiones no
  triviales se registrarán en **ADR-024** tras el debate critic/business.
- **Fuera de alcance**: notificaciones y la alerta de postulación estancada (solo se modela el evento), el cálculo de
  `fitScore`, comentarios de grupo, invitaciones nominales, y cualquier dato de la postulación que no sea el estado
  canónico visible para el grupo.
