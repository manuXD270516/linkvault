## Why

El Mailer de ADR-034 ya cubre verify/reset, pero el producto aún no avisa cuando alguien guarda un link en el grupo,
cambia un estado compartido o deja una postulación estancada (`ApplicationStale.v1` modelado sin productor). Sin un
canal de notificaciones, B4 y G4 siguen bloqueados y el tracker no cumple el rol de asistente.

## What Changes

- **Módulo de notificaciones** (bounded context) que despacha avisos por **email** (puerto Mailer existente) y
  **web push** (VAPID), con preferencias **opt-out por tipo** (ON por defecto si `emailVerified`; push requiere
  suscripción).
- **Tres disparadores V0:**
  1. **Nuevo link en grupo** → todos los miembros del grupo (**incluido** quien lo guardó), salvo preferencia
     configurable “no avisarme de mis propias acciones”.
  2. **Cambio de estado canónico** de postulación con `visibility=group` → miembros del grupo (unión por defecto;
     acotable por `groupId` de UI o preferencia); sin `stageLabel` en el aviso.
  3. **Postulación estancada** (B4, 10 días sin cambio de estado) → **solo el dueño**.
- **Entrega:** hechos HTTP → **outbox** (api) → BullMQ → **worker**; stale → claim + cola en worker (**sin** outbox).
  Fallos de canal no revierten el hecho. Ledger de entrega anti-duplicados.
- **Preferencias** por usuario y tipo + `notifyOwnActions` (default **true**) + `applicationStatusGroupId` opcional.
  API autenticada + UI en perfil.
- **Web push:** Service Worker, suscripción, VAPID; sin marketing ni digests.
- **ADR-035** documenta canales, fan-out, stale y preferencias.
- Fila **17** en `docs/design-v0.2.md` §6.

**Fuera de alcance:** digest semanal (B10); email marketing; SMS; notificaciones in-app tipo feed/campana con
historial; OTel; HTML enriquecido en plantillas (sigue texto plano); aviso de postulación **privada** a terceros.

## Capabilities

### New Capabilities
- `notifications/dispatch`: fan-out, jobs de entrega, consumers en worker, plantillas de aviso, idempotencia.
- `notifications/preferences`: opt-out por tipo, `notifyOwnActions`, defaults ON tras email verificado.
- `notifications/web-push`: VAPID, alta/baja de suscripción, envío push desde el worker.
- `notifications/stale-applications`: productor periódico/cron de `ApplicationStale.v1` y aviso al dueño.
- `web/notifications`: UI de preferencias, permiso/suscripción push, i18n ES/EN.

### Modified Capabilities
- `platform/email`: nuevos `templateId` de producto (`group-new-link`, `application-status`, `application-stale`).
- `platform/outbox`: rutas/cola(s) de notificación y `jobId` deterministas.
- `applications/tracking`: el productor de stale deja de ser “solo modelado”; cambios de estado visibles al grupo
  encolan fan-out.
- `applications/group-visibility`: solo se notifica estado al grupo si `visibility=group`.
- `links/sharing`: guardar/asociar link a un grupo con relación nueva encola el fan-out `group_new_link`.
- `users/account-deletion`: borra preferencias y suscripciones push en la cascada.
- `users/profile`: enlace o sección de notificaciones (sin meter preferencias en PATCH de perfil genérico).
- `platform/local-environment`: variables VAPID / push en `.env.example`; Mailpit ya cubre email.
- `web/auth`: enlace desde perfil/sesión a preferencias.

## Impact

- **Código:** nuevo módulo Nest `notifications` (api + worker consumers); extensión de Mailer/plantillas; eventos en
  `libs/shared`; SPA perfil/preferencias; posible lib web-push.
- **API:** `GET/PATCH /api/notifications/preferences`; `POST/DELETE /api/notifications/push-subscriptions`; sin
  endpoints públicos de envío.
- **Datos:** preferencias por usuario; suscripciones push; quizá log mínimo de entregas (sin cuerpo de email).
- **Worker:** consumer(s) `notify:*`; job/cron de detección de postulaciones estancadas.
- **Config:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; reusa `MAIL_*` / `WEB_BASE_URL`.
- **ADRs:** ADR-035 (nuevo); hereda ADR-009 (outbox), ADR-024 (`ApplicationStale` / `statusChangedAt`), ADR-034 (Mailer).
- **Fuera:** B10 digest; marketing; feed in-app persistente; push a postulaciones privadas ajenas.
