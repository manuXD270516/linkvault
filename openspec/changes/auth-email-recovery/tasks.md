## 1. Infraestructura y configuración

- [x] 1.1 [infra] Añadir servicio Mailpit a `docker-compose.yml` (SMTP + UI, healthcheck, puertos configurables) y documentar el comando de arranque en README; verificar con `docker compose up -d --wait` que Mailpit queda healthy junto a mongo/redis/minio (smoke local; CI no depende de Mailpit).
- [x] 1.2 [infra] Variables `MAIL_*`, `RESEND_API_KEY`, TTL de tokens de verify/reset en `.env.example` y `apiConfigSchema` (smtp local por defecto; resend exige clave); verificar tests de config “Resend sin clave”, “ejemplo local arranca” y que `.env.example` no tiene clave real.
- [x] 1.3 [infra] Sección RUNBOOK: SPF/DKIM/DMARC + From placeholder + reseteo manual como fallback del flujo email; verificar que el RUNBOOK menciona `auth/password-recovery` como camino normal y DNS no bloquea local.
- [x] 1.4 [infra] Fila `auth-email-recovery` en `docs/design-v0.2.md` §6 (orden antes de `deploy-prod`) y ADR-034 alineado al design; verificar referencias cruzadas.

## 2. Puerto Mailer y plantillas

- [ ] 2.1 [backend] Puerto `Mailer` + tipos de plantilla `email-verification` / `password-reset` (locale, variables); verificar con test de contrato del puerto (mock) sin SDKs en application.
- [ ] 2.2 [backend] `CapturingMailer` para tests/CI (almacena to, templateId, locale, actionUrl); verificar que un envío queda consultable y no hace red.
- [ ] 2.3 [backend] `SmtpMailer` hacia Mailpit y cableado `MAIL_PROVIDER=smtp`; verificar que el adaptador SMTP se construye con host/puerto del env (smoke Mailpit solo local).
- [ ] 2.4 [backend] `ResendMailer` con `MAIL_PROVIDER=resend`; verificar unitario con HTTP mock (asunto/cuerpo plano, From, error de API) sin loguear la API key.
- [ ] 2.5 [backend] Plantillas ES/EN **solo texto plano** (sin HTML) para verify y reset; verificar snapshot o asserts de cadenas clave y que `actionUrl` usa `WEB_BASE_URL`.

## 3. Tokens y dominio auth

- [ ] 3.1 [backend] Colección/repositorio de `auth_email_tokens` (hash SHA-256, purpose, TTL, invalidar previos, un solo uso; consume en txn Mongo con el efecto de negocio); verificar integración Mongo: emit, consume, reuse → inválido, caducidad reset 1 h.
- [ ] 3.2 [backend] Límites Redis **solo** forgot/resend (3/email, 20/IP, fail-open); sin límite Redis en consume verify/reset; verificar unitarios de cupo, `Retry-After` y fallo abierto sin email en logs.
- [ ] 3.3 [backend] Añadir `revokeAllUserSessions(userId)` al puerto `SessionRepository` + implementación Mongo e in-memory; verificar que revoca todas las activas del usuario y no toca las de otros.

## 4. Perfil emailVerified

- [ ] 4.1 [backend] Campo `emailVerified` en entidad/schema users, default registro `false`, default lectura/migración cuentas previas `true`; **`UsersFacade`** expone lectura + `markEmailVerified` (auth no escribe `users` directo); verificar “Registro nuevo sin verificar”, “Cuentas previas siguen verificadas”.
- [ ] 4.2 [backend] Exponer `emailVerified` en `UserProfile` / sesión iniciada; PATCH rechaza el campo; verificar “Consulta correcta” y “No se puede marcar a mano” + schema zod en `libs/shared`.
- [ ] 4.3 [backend] Añadir `invalid_token` a `apiErrorCodeSchema` (+ status/mensajes en el filtro); verificar que el schema y el filtro aceptan el código en verify/reset.

## 5. Casos de uso verificación y recuperación

- [ ] 5.1 [backend] Tras `register`, emitir verify + enviar correo (fallo mail **o** fallo al persistir token → 201 + warning); verificar escenarios de registro con CapturingMailer y doble de repositorio que falla.
- [ ] 5.2 [backend] `verify-email` (consume token + `markEmailVerified` en **una txn** Mongo → 204 / `invalid_token`); verificar escenarios de `auth/email-verification`.
- [ ] 5.3 [backend] `verify-email/resend` **solo autenticado** (cuerpo vacío; ignora `email` ajeno; siempre 200 genérico salvo 401/429); verificar anti-abuso de email ajeno, “Límite de reenvíos” y 401 sin sesión.
- [ ] 5.4 [backend] `forgot-password` (siempre 200, token 1 h, envío); verificar cuenta existente / inexistente / 429 con CapturingMailer.
- [ ] 5.5 [backend] `reset-password`: política → **`revokeAllUserSessions` primero** → `setPasswordHash` → consumir token (txn) → `AttemptLimiter.reset(login-email)`; verificar “Reset correcto…”, “Orden revocar antes del hash”, “Reset limpia el límite de login…” y “Contraseña nueva inválida no consume el token”.

## 6. Presentación API y cascada

- [ ] 6.1 [backend] Endpoints en `AuthController` + CSRF; `@Public()` solo forgot/reset/verify-email (**no** resend); actualizar lista de rutas públicas; verificar escenarios de `auth/sessions` e integración HTTP.
- [ ] 6.2 [backend] Cascada de borrado elimina `auth_email_tokens` del userId en la misma txn; verificar escenario de cascada con tokens pendientes.
- [ ] 6.3 [backend] Redacción de logs: no token en claro ni cuerpos de correo; verificar test de redacción / filtro.

## 7. Frontend

- [ ] 7.1 [frontend] Modelo de sesión/perfil con `emailVerified`; banner de no verificado + acción resend autenticado (**sin** enlace de ayuda); verificar “Banner tras el registro”, “Reenviar desde el aviso”, “Aviso desaparece al verificar”.
- [ ] 7.2 [frontend] Páginas `/recuperar-contrasena`, `/restablecer-contrasena`, `/verificar-email` (guest, token en query → POST); verificar escenarios de `web/email-auth` con `HttpTestingController`.
- [ ] 7.3 [frontend] Enlace “Olvidé mi contraseña” en `/login` y guards/rutas de invitado ampliadas; verificar “Desde login se llega a recuperar” y “Recuperar contraseña sin sesión”.
- [ ] 7.4 [frontend] i18n ES/EN de banner + páginas email-auth; verificar “Traducciones de email-auth” / targets en `messages.en.xlf`.

## 8. Cierre

- [x] 8.1 [infra] Actualizar README (Mailpit local, CapturingMailer en CI, variables MAIL_*, flujos verify/reset) y referencia ADR-034; verificar que docs y `.env.example` coinciden con el schema.
- [ ] 8.2 [infra] `pnpm nx affected -t lint,typecheck,test` (y build si aplica) con `AI_CHAIN=mock AI_MOCK_MODE=replay` y `openspec validate auth-email-recovery`; verificar verde.
