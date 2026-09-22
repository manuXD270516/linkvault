## Context

Auth y sesión ya existen según ADR-012/020: Argon2id, refresh rotativo, límites Redis fail-open, cambio de contraseña
que **revoca primero** las demás sesiones y **después** `setPasswordHash`. No hay infraestructura de correo.
`WEB_BASE_URL` ya es obligatoria (páginas públicas). Motivación: proposal.md. Comportamiento normativo: specs del
change. Decisiones no triviales: ADR-034.

## Goals / Non-Goals

**Goals:**
- Correo transaccional mínimo (verificar + restablecer) con un puerto Mailer reutilizable.
- Local y CI sin proveedor externo: Mailpit (smoke local) + `CapturingMailer` (CI/tests).
- Seguridad alineada con auth actual: tokens hasheados, anti-enumeración, rate limits, revocación de sesiones al reset
  en el mismo orden que change-password (revocar → hash).

**Non-Goals:**
- Producto de notificaciones/digest/grupo (G4/B10): el puerto puede crecer; este change solo envía verify+reset.
- Cola BullMQ dedicada al correo (envío síncrono o best-effort en el request es suficiente en MVP; si falla el envío,
  el caso de uso de negocio no se revierte salvo que el design de un endpoint concreto lo exija).
- Cambio de dirección de email, OAuth, 2FA, lista de dispositivos.
- Configurar SPF/DKIM reales en un DNS de producción (solo RUNBOOK + placeholders).
- HTML enriquecido en plantillas V0 (solo texto plano).
- Reenvío de verificación público por `{ email }` (quien cerró sesión vuelve a entrar y usa el banner).

## Decisions

### D1 — Puerto `Mailer` extensible, plantillas tipadas

Un puerto de aplicación `Mailer` con `send(message: { to, templateId, locale, variables })` (o equivalente). Las
plantillas de este change son solo `email-verification` y `password-reset`. El puerto **no** conoce Resend ni SMTP.
Ubicación: módulo de infraestructura compartida usado por `auth` (p. ej. `apps/api/src/infrastructure/mail/` o un
pequeño módulo Nest `MailModule` importado por `AuthModule`), sin que el dominio de `auth` importe SDKs.

*Alternativa descartada:* acoplar `Resend` directamente en los use cases (rompe el patrón de ports y complica tests).

*Interpretación de alcance:* el puerto admite más `templateId` en el futuro (digest, aviso de grupo); **no** se
especifican ni implementan esos productos aquí.

### D2 — Adaptadores: Resend (prod), Mailpit SMTP (local), captura (tests/CI)

| Entorno | Adaptador | Selección |
|---|---|---|
| producción / staging | `ResendMailer` (API HTTP) | `MAIL_PROVIDER=resend` + `RESEND_API_KEY` |
| local | `SmtpMailer` hacia Mailpit | `MAIL_PROVIDER=smtp` + host/puerto Mailpit |
| tests unitarios/integración / CI | `CapturingMailer` en memoria | DI de test / `MAIL_PROVIDER=capture` |

Mailpit entra en `docker-compose.yml` **sin perfil** (como mongo/redis/minio): SMTP `:1025`, UI `:8025`. Smoke manual
local: UI de Mailpit. CI y harness de integración: **solo** `CapturingMailer` (sin depender de Mailpit en el pipeline).

*Alternativa descartada:* Ethereal/Mailhog como servicio local (Mailpit es el elegido humano). SES/SendGrid en prod
(Resend es el elegido).

### D3 — Tokens de un solo uso, solo hash en Mongo

Colección `auth_email_tokens` (nombre orientativo):

```
{ tokenHash, userId, purpose: 'verify_email' | 'reset_password', expiresAt, usedAt?, createdAt }
```

- Token opaco: 32 bytes aleatorios, base64url; se persiste `sha256(token)` (mismo espíritu que refresh, ADR-020).
- Un solo uso: al consumir se marca `usedAt` (o se borra) **en la misma transacción Mongo** que el efecto de negocio
  (marcar `emailVerified` o aplicar el reset); reutilizar → `invalid_token`.
- Verify: TTL configurable, default **24 h** (`AUTH_VERIFY_TOKEN_TTL_HOURS`).
- Reset: TTL **1 h** fijo de producto (`AUTH_RESET_TOKEN_TTL_SECONDS=3600`).
- Al emitir un token nuevo del mismo `purpose` para el mismo usuario, invalidar los anteriores pendientes.
- Índice TTL sobre `expiresAt` para limpieza; la validez se comprueba en código.

El valor en claro solo viaja en el email y en la URL del SPA; nunca en logs ni respuestas JSON.

Si **falla la persistencia** del token tras el registro (igual que fallo de mail): el registro sigue `201` con sesión;
se registra aviso; el usuario puede reenviar autenticado.

### D4 — Enlaces con `WEB_BASE_URL`

Los correos construyen:

- verificación: `{WEB_BASE_URL}/verificar-email?token=...`
- reset: `{WEB_BASE_URL}/restablecer-contrasena?token=...`

`WEB_BASE_URL` ya existe y no se deduce del `Host`. El SPA lee el `token` de la query y llama a la API (POST JSON);
no se confía en un GET de la API con el token en la URL (evita filtrarlo a logs de proxy/referrer).

### D5 — Rate limits (misma familia que login)

Ventana fija 15 min en Redis, consumo **antes** de trabajo costoso, fail-open como ADR-020:

| Acción | Por email (HMAC) | Por IP |
|---|---|---|
| `forgot-password` | 3 | 20 |
| `verify-email/resend` (autenticado) | 3 (email de la sesión) | 20 |

**No** hay rate limit Redis en el **consumo** de token (`verify-email` / `reset-password`): el token es un secreto de un
uso con TTL corto; freír tokens inventados no revela estado útil más allá de `invalid_token`. Los límites de emisión
(forgot/resend) bastan contra spam de correo.

### D6 — Plantillas ES/EN en texto plano (V0)

Asunto + **texto plano** por plantilla e idioma. **Sin HTML enriquecido en V0.** Locale del correo: `outputLanguage`
del perfil si el usuario existe; si no (forgot genérico), `es` por defecto. Variables mínimas: `displayName`,
`actionUrl`, `expiresInHuman`. Sin PII extra en el asunto.

### D7 — `emailVerified` en UsersFacade; login permitido

- Campo booleano en `users`; registro nuevo → `false`; tras verify exitoso → `true`.
- **`UsersFacade` es el dueño** del campo: lectura en perfil/sesión, método de marcado verificado (p. ej.
  `markEmailVerified(userId)`), y default de lectura `true` para documentos antiguos sin el campo. Auth no escribe la
  colección `users` directamente.
- Documentos existentes sin el campo: migración / default de lectura → **`true`** (no expulsar cuentas ya usadas).
- Login y refresh **no** exigen `emailVerified`.
- `GET /users/me` y el perfil embebido en sesión iniciada incluyen `emailVerified`.
- PATCH no acepta `emailVerified`.

### D8 — Reset: revocar **todas** las sesiones **antes** del hash

Al aceptar un reset válido (política OK, token válido), en este **orden** (mismo espíritu que change-password,
ADR-020):

1. `SessionRepository.revokeAllUserSessions(userId)` — **nuevo** método del puerto; sin excepción de sesión (endpoint
   público; no hay `sid` de confianza).
2. `UserAccounts.setPasswordHash` / `UsersFacade.setPasswordHash` (fija `passwordChangedAt`).
3. Consumir/invalidar el token de reset (misma txn Mongo que el paso 2 cuando aplique; ver D14).
4. `AttemptLimiter.reset` de la clave `login-email` del usuario (igual que change-password), para no dejar bloqueado a
   quien agotó intentos de login antes del reset.

Si la revocación falla, la contraseña **no** cambia.

### D9 — Anti-enumeración en forgot; resend solo autenticado

- `POST /api/auth/forgot-password` `{ email }`: siempre `200` + mensaje genérico tras rate limit; si hay usuario, emite
  token y envía; si no, no-op (delay comparable razonable).
- `POST /api/auth/verify-email/resend`: **solo autenticado**, cuerpo vacío (o ignorado). Usa el `userId` de la sesión.
  Si el cuerpo trajera un `email` ajeno, **se ignora** (no se reenvía a terceros). Siempre `200` genérico salvo `401`/
  `429`. Si ya está verificado: no-op + `200`.
- **V0 no ofrece** resend público `{ email }`. Quien cerró sesión sin verificar vuelve a hacer login y usa el banner.
- Registro sigue respondiendo `409 email_taken` (enumeración ya aceptada en ADR-020).

### D10 — From, env y RUNBOOK DNS

Variables (nombres orientativos en `.env.example`):

- `MAIL_PROVIDER=smtp|resend|capture`
- `MAIL_FROM=LinkVault <noreply@example.com>` (placeholder)
- `RESEND_API_KEY=` (vacío en local)
- `MAIL_SMTP_HOST=localhost`, `MAIL_SMTP_PORT=1025` (Mailpit)

`docs/RUNBOOK.md`: sección SPF/DKIM/DMARC para el dominio From cuando se use Resend; el despliegue **no** espera DNS
verificado para merge del change. Arranque: en `MAIL_PROVIDER=resend` exigir clave; en smtp exigir host/puerto.

### D11 — Endpoints y CSRF

Todos bajo `POST /api/auth/*` con `X-Requested-With: linkvault` y JSON (ADR-020).

Rutas `@Public()`:

- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password` `{ token, newPassword }`
- `POST /api/auth/verify-email` `{ token }`

**No** pública: `POST /api/auth/verify-email/resend` — exige Bearer; cuerpo vacío; ver D9.

Registro: tras crear usuario y abrir sesión, dispara emisión de token + envío de verificación (fallo de mail **o** de
persistencia del token → log warning, registro igual `201`).

Códigos: `invalid_token` entra en `apiErrorCodeSchema` (+ mapa de status/mensajes) para verify/reset.

### D12 — Cascada de borrado

`users/account-deletion` elimina `auth_email_tokens` del `userId` en la misma txn.

### D13 — ADR-034 y plan de changes

Documenta D1–D14. Fila en `docs/design-v0.2.md` §6 para `auth-email-recovery` (antes de `deploy-prod` en el orden de
producto: correo mínimo antes de producción real).

### D14 — Consumo de token en una txn Mongo

`verify-email` y el tramo de datos de `reset-password` (marcar token usado + efecto en `users` / hash) SHALL ocurrir en
**una** transacción Mongo (replica set). La revocación de sesiones (paso 1 de D8) puede ir justo antes; si el hash/token
falla tras revocar, el usuario queda sin sesiones vivas pero con la contraseña anterior — mismo trade-off aceptable que
change-password (revocar antes de hash). No dual-write “token usado” vs “perfil verificado” en commits separados.

## Risks / Trade-offs

- **[Risk]** Resend caído tras registro → usuario sin correo. → Mitigation: banner + resend autenticado; registro no
  falla.
- **[Risk]** Enumeración por timing en forgot. → Mitigation: siempre 200; trabajo uniforme razonable; no promesa
  criptográfica de timing.
- **[Risk]** Enlace de reset filtrado en logs de email/proxy. → Mitigation: token de un uso + TTL corto; POST desde SPA
  sin poner el token en path de API; no loguear query del SPA en Traefik si aplica (heredado).
- **[Risk]** Abuso de envío (spam). → Mitigation: rate limits de emisión; un token activo por purpose.
- **[Risk]** Sesión cerrada antes de verificar sin resend público. → Mitigation: login permitido sin verificar + banner
  con resend (decisión de producto V0).
- **[Trade-off]** Sin cola: un Resend lento alarga el request de forgot. Aceptable en MVP; cola diferible.
- **[Trade-off]** Sin HTML en V0: clientes que solo renderizan HTML verán el texto plano; suficiente para transaccional.

## Migration Plan

1. Desplegar MailModule + campo `emailVerified` (default lectura `true` para docs antiguos; backfill opcional `$set`).
2. Activar envío en registro y flujos forgot/verify.
3. Documentar DNS; configurar Resend en staging/prod cuando el dominio esté listo.
4. Rollback: desactivar envío (`MAIL_PROVIDER=capture` o feature flag no requerida — si hace falta, no registrar
   listeners); el login sigue funcionando; tokens huérfanos caducan por TTL.

## Open Questions

Ninguna que afecte specs o tareas: las decisiones humanas están cerradas (proposal + este design + reflect).

## Reflect (debate iteración 1)

| Hallazgo | Origen | Decisión | Motivo |
| --- | --- | --- | --- |
| Reset: `setPasswordHash` antes de revocar (sesión zombie / orden distinto a change-password) | P0 critic | Aceptado | D8: `revokeAllUserSessions` → luego hash; puerto `SessionRepository` |
| Resend dual Public+auth contradice anti-enum y lista de rutas | P0 critic | Aceptado | D9/D11: resend **solo autenticado**; fuera de `@Public()`; sin `{ email }` público |
| `emailVerified` sin dueño de escritura claro (auth vs users) | P1 critic | Aceptado | D7: `UsersFacade` posee el campo y el marcado |
| `invalid_token` ausente de `apiErrorCodeSchema` | P1 critic | Aceptado | D11 + tarea explícita en shared |
| Rate limit de consumo verify/reset en D5 sin spec (o viceversa) | P1 critic | Aceptado (corte) | D5: **sin** límite de consumo; solo forgot/resend |
| Consume token y efecto de negocio en escrituras separadas | P1 critic | Aceptado | D14: una txn Mongo |
| Cascada sin `auth_email_tokens` | P1 critic | Aceptado | D12 + spec account-deletion |
| Resend autenticado que honrara `email` del body (abuso a terceros) | P1 critic | Aceptado | D9: ignora email ajeno; solo sesión |
| Fallo al persistir token tras register ≠ fallo de mail | P1 critic | Aceptado | D3/D11: igual que mail → `201` + warning |
| Reset no limpia limiter `login-email` | P1 critic | Aceptado | D8 paso 4; como change-password |
| ADR-034 incompleto vs decisiones del design | P1 critic | Aceptado | ADR-034 actualizado (orden reset, resend auth, plano, txn, …) |
| Falta fila en design-v0.2 §6 | P1 critic | Aceptado | Orden 15 `auth-email-recovery`; `deploy-prod` → 16 |
| HTML rico en plantillas V0 | V1 business | Aceptado (corte) | D6: solo texto plano |
| Enlace de ayuda en el banner | V1 business | Aceptado (corte) | Banner: texto + resend; sin help link |
| Mailpit en CI vs captura | V1 business | Aceptado | D2: Mailpit smoke local; `CapturingMailer` en CI |

ADRs: `docs/adr/ADR-034.md`.

**CONVERGENCIA: SI** (P0 abiertos: 0 · V0 abiertos: 0)
