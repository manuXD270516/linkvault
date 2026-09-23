## Why

El hábito real es abrir la vacante en LinkedIn/Computrabajo/Indeed y querer guardarla sin
copiar/pegar la URL a la SPA (G5 / F3 `extension`). Tras cerrar F2 (search + notificaciones +
B10/B11), el siguiente valor de adopción es **guardar con un click desde la pestaña**.

## What Changes

- **Extensión Chromium MV3** (Chrome/Edge): popup mínimo para autenticarse, ver la URL de la
  pestaña activa y guardar en lista privada o en un grupo del que el usuario es miembro.
- **Auth para cliente extensión:** login/refresh sin depender de la cookie httpOnly del SPA
  (`Path=/api/auth`); tokens en almacenamiento de la extensión + `Authorization: Bearer`.
- **Reuso de `POST /api/links`** (mismo contrato `{ url, groupId?, note? }`); sin scraper de
  contenido de la página en v1.
- **CORS** acotado a orígenes `chrome-extension://<id>` allowlisted por env.
- Fila **24** en `docs/design-v0.2.md` §6 + entrada en `openspec-changes.yaml`.
- ADR corto de auth/CORS de extensión (enmienda ADR-012 si el debate lo exige).

**Fuera de alcance:**

- Firefox / Safari; tienda Chrome Web Store publicación automatizada.
- Content script que lea DOM / autofill de `JobPreview` (enrichment sigue por URL).
- Device-code OAuth, API keys de larga duración, SSO.
- `discovery` / analytics (F3 hermanos).
- Notificaciones push desde la extensión.

## Capabilities

### New Capabilities

- `extension/save-link`: comportamiento de la extensión (popup, permisos, guardar URL activa,
  selector de grupo, estados de éxito/error/ya-en-grupo).
- `auth/extension-sessions`: login/refresh/logout para cliente extensión (tokens en body o
  header, sin cookie httpOnly del SPA); revocación alineada a familia de sesiones.

### Modified Capabilities

- `auth/sessions`: rutas públicas + lista exhaustiva incluyen `extension/login|refresh|logout`;
  rechazo de refresh `client=extension` en el path cookie web.
- `auth/credentials`: límite de intentos compartido con `POST /api/auth/extension/login`.
- `links/sharing`: el mismo `POST /api/links` es el contrato de la extensión (sin campos nuevos).
- `platform/local-environment`: CORS allowlist / extension id + carga unpacked en dev.

## Impact

- **Código:** nuevo paquete/app `apps/extension` (o `apps/browser-extension`); API auth
  (endpoints o modo cliente); CORS en Fastify; tests de auth extensión; docs fila 24.
- **ADRs:** ADR-038 (o enmienda ADR-012) auth + CORS extensión.
- **Agentes:** backend-dev, frontend-dev (popup), devops (env/docs).
- **Dependencias:** `auth-users`, `job-links` / `links/sharing` en main.
