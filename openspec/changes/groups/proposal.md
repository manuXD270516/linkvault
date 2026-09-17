## Why

`auth-users` dejó usuarios con sesión pero sin nada que compartir: hoy `/` solo saluda. El grupo es la unidad que da
sentido al producto (ADR-002: el `JobLink` es canónico y `GroupLink` lo relaciona con el grupo), así que `job-links` y
`applications-tracking` necesitan que exista un grupo al que importar links y en el que verse. Este change crea esa unidad
y la forma de entrar en ella: un código de invitación que se pasa por WhatsApp.

## What Changes

- **Grupos**: crear con nombre, renombrar, ver los propios con su rol y número de miembros, ver el detalle y borrarlos
  (solo el owner; hoy no cuelga nada de un grupo, así que el borrado es real).
- **Código de invitación**: uno por grupo, reutilizable y sin caducidad, visible solo para el owner, que puede
  regenerarlo; el anterior deja de funcionar.
- **Unirse por código**: `POST /groups/join` con el código; volver a unirse siendo miembro no falla ni duplica.
- **Roles `owner` y `member`**: el owner renombra, regenera el código, expulsa miembros y borra el grupo; un miembro solo
  puede salir. El owner no puede salir (transferir la propiedad queda fuera de alcance, anotado en el manifiesto).
- **Lista de miembros** para cualquier miembro del grupo: nombre visible, rol y fecha de alta; nunca el email.
- **Límites**: 50 miembros por grupo y 20 grupos por usuario, con errores propios.
- **Frontend**: `/grupos` como nueva pantalla de inicio con estado vacío ("crea un grupo o únete con un código"),
  `/grupos/:id` con miembros y el código para el owner, y unirse por código desde la lista o por el enlace de invitación
  `/unirse?codigo=<código>`. `/` redirige a `/grupos`.
- **Entrada única para otros módulos**: `GroupsFacade` (`isMember`, `getGroupsOf`), que consumirá `job-links`, y la regla
  de lint que impide leer las colecciones de un módulo desde otro.
- **Privacidad**: un usuario que no es miembro no puede distinguir un grupo que no existe de uno al que no pertenece.

## Capabilities

### New Capabilities
- `groups/group-management`: creación, renombrado, consulta y borrado de grupos, código de invitación y sus límites.
- `groups/membership`: unirse por código, roles `owner`/`member`, salir, expulsar y lista de miembros.
- `web/groups`: lista de grupos con estado vacío, detalle con miembros y código, alta y unión por código en el SPA.

### Modified Capabilities
- `web/auth`: la raíz deja de saludar y pasa a la lista de grupos ("Rutas autenticadas y de invitado", "Registro y login"
  y "Textos en español e inglés", que ya no nombra la pantalla de inicio).
- `users/profile`: el `displayName` de un usuario pasa a ser visible para los miembros de sus grupos; el email y el resto
  del perfil siguen siendo solo suyos.
- `platform/workspace`: "Aislamiento de la capa de dominio" pasa a cubrir también `application/` e `infrastructure/`, con
  el facade, los errores de dominio y los dobles de test como única entrada entre módulos.

## Impact

- **Código**: `apps/api/src/modules/groups/` (domain, application, infrastructure, presentation);
  `apps/web/src/app/features/groups/`; contratos zod en `libs/shared/src/schemas/group.schema.ts`.
- **API**: `POST /groups`, `GET /groups`, `GET /groups/:id`, `PATCH /groups/:id`, `DELETE /groups/:id`,
  `POST /groups/:id/invite-code`, `POST /groups/join`, `GET /groups/:id/members`, `DELETE /groups/:id/members/me`,
  `DELETE /groups/:id/members/:userId`. Todas exigen access token (guard global de `auth-users`).
- **Datos**: colecciones `groups` (índice único por código de invitación) y `group_members` (índice único
  `(groupId, userId)`).
- **Frontend**: rutas `/grupos`, `/grupos/:id` y `/unirse`; `/` redirige; `HOME_ROUTE` en `core/navigation`; desaparece
  `features/home/**`; textos ES/EN.
- **Plataforma**: `eslint.config.mjs` y `tools/workspace-rules` con la regla ampliada entre módulos; `UsersFacade` gana
  `getDisplayNames` (con su método en `UserRepository` y su doble); `api-error.ts` suma los 7 códigos nuevos.
- **ADRs**: implementa ADR-002 (grupo como contenedor, sin copiar links por usuario) y respeta ADR-012, ADR-017 y ADR-020
  (errores de dominio con `code`, guard global, módulos con dominio aislado).
- **Fuera de alcance**: links y `GroupLink` (`job-links`), comentarios (`group-comments`), compartir estado de
  postulación (`applications-tracking`), página pública (`public-preview-share`), transferencia de propiedad,
  invitaciones nominales por email y `settings.defaultVisibility` del grupo.
