## Why

`auth-users` dejó la verificación de email y la recuperación de contraseña fuera de alcance (ADR-020): sin ellas, quien
olvida la contraseña depende del reseteo manual del RUNBOOK y nadie puede demostrar que controla el email de la cuenta.
Con el producto ya en camino a producción (`deploy-prod`), hace falta el correo transaccional mínimo —verificar y
restablecer— antes de notificaciones de grupo o digests (G4/B10, diferidos).

## What Changes

- **Puerto Mailer** en dominio/aplicación (extensible a notificaciones futuras) con adaptadores **Resend** (prod) y
  **Mailpit** (local vía SMTP en docker-compose); en tests, captura de mensajes/enlaces sin red.
- **Verificación de email**: tras el registro se envía un enlace de un solo uso; el login de cuentas no verificadas
  **sigue permitido** y el SPA muestra un aviso hasta verificar; reenvío **solo autenticado** (200 genérico; sin resend
  público por email en V0).
- **Recuperación de contraseña**: flujo olvidé → enlace de un solo uso (TTL **1 h**) → nueva contraseña; al usarlo se
  **revocan todas las sesiones primero** y luego se cambia el hash (mismo orden que change-password, ADR-012/020).
- **Anti-enumeración**: `forgot-password` responde siempre **200** genérico; resend autenticado también 200 genérico
  (salvo 401/429).
- **Perfil**: campo `emailVerified` expuesto en `GET /api/users/me` (y en la sesión iniciada); no editable por PATCH.
- **SPA**: páginas de olvidé / restablecer / verificar; banner de email no verificado; i18n ES/EN.
- **Config y docs**: variables placeholder (`MAIL_*`, `RESEND_API_KEY`, From) en `.env.example`; RUNBOOK con DNS
  (SPF/DKIM) — el change **no** queda bloqueado por DNS real.
- **ADR-034** documenta las decisiones de este change; referencia ADR-012 y ADR-020.

## Capabilities

### New Capabilities
- `auth/email-verification`: emisión, consumo y reenvío del token de verificación; login permitido sin verificar.
- `auth/password-recovery`: forgot-password y reset con enlace de un solo uso, TTL 1 h y revocación de sesiones.
- `platform/email`: puerto Mailer, adaptadores Resend/Mailpit/captura, plantillas ES/EN, config From/DNS documentada.
- `web/email-auth`: páginas SPA de verificación y recuperación, captura del token en la URL y mensajes de resultado.

### Modified Capabilities
- `auth/credentials`: el registro dispara el correo de verificación; el RUNBOOK de reseteo manual pasa a ser fallback.
- `auth/sessions`: rutas públicas nuevas (forgot, reset, verify-email); resend **no** es público.
- `users/profile`: `emailVerified` en el perfil; cuentas previas se tratan como verificadas.
- `users/account-deletion`: la cascada elimina tokens de email pendientes del usuario.
- `web/auth`: banner hasta verificar; enlace a recuperar; rutas de invitado ampliadas.
- `platform/local-environment`: Mailpit en el compose por defecto; variables de correo en `.env.example`.

## Impact

- **Código**: módulo `auth` (casos de uso verify/reset, tokens hasheados); puerto Mailer (p. ej. en `auth` o librería
  compartida de infra); adaptadores Resend/SMTP/Mailpit; plantillas de correo; `users` (`emailVerified`); SPA
  (`features/auth`); schemas en `libs/shared`.
- **API**: `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `POST /api/auth/verify-email` (públicos);
  `POST /api/auth/verify-email/resend` (autenticado); registro y login sin romper contratos existentes salvo campos
  nuevos en el perfil de sesión.
- **Datos**: colección de tokens de email (solo hash); campo `emailVerified` en `users`; índices TTL.
- **Infra**: servicio Mailpit en `docker-compose.yml`; UI típica en `:8025`.
- **Config**: `MAIL_PROVIDER`, `MAIL_FROM`, `RESEND_API_KEY`, SMTP hacia Mailpit en local; enlaces con `WEB_BASE_URL`.
- **ADRs**: crea ADR-034; concreta huecos de ADR-012/020 sobre email.
- **Fuera de alcance**: digest semanal / notificaciones de grupo (G4/B10); OAuth; 2FA; cambio de email; marketing;
  DNS real en el proveedor (solo documentación).
