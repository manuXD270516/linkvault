## Context

`auth-users` dejó la plantilla que sigue este change: módulos en `apps/api/src/modules/<m>/{domain,application,
infrastructure,presentation}`, guard global (`@Public()` para lo abierto), `@CurrentUser()` en
`presentation/http/auth-context/`, pipe zod y filtro que traduce errores de dominio con `code` a HTTP, contratos zod en
`libs/shared`, y en el SPA `SessionStore`, interceptor con refresh compartido, guards y rutas en español. `users` expone
`UsersFacade`; `groups` necesita nombres visibles de usuario y nada más. Motivación y alcance: proposal.md; comportamiento:
las specs. Decisiones humanas previas: código reutilizable y rotable, owner que borra y expulsa (sin transferencia), 50
miembros por grupo y 20 grupos por usuario, lista de miembros visible para cualquier miembro.

## Goals / Non-Goals

**Goals:**
- Tercer módulo de `api` siguiendo la plantilla, sin tocar `auth` y tocando `users` solo para exponer nombres.
- Que `job-links` encuentre resuelta la pertenencia (`GroupsFacade`) y no tenga que abrir `groups`.
- Que el SPA tenga por fin una pantalla de inicio con contenido y un enlace de invitación que funcione.

**Non-Goals:**
- Links, comentarios, estado de postulación y página pública: sus changes.
- Transferencia de propiedad, invitaciones nominales, expulsión con motivo o historial de miembros.
- Notificaciones (unirse, salir, expulsión) y digest del grupo.
- Búsqueda o directorio de grupos: solo se entra con el código.
- Límite de intentos sobre `POST /groups/join`: se anota como deuda de `job-links`, cuando el código dé acceso a
  contenido de terceros (hoy solo revela nombres y exige sesión).

## Decisions

### D1 — Módulo `groups` y datos

```
apps/api/src/modules/groups/
├── domain/          group.ts (nombre, invariantes), invite-code.ts (alfabeto, formato, normalización),
│                    membership.ts (roles y reglas), limits.ts, errors.ts
├── application/     ports (GROUP_REPOSITORY, GROUP_MEMBER_DIRECTORY, INVITE_CODE_GENERATOR, GROUPS_CLOCK),
│                    create-group, list-my-groups, get-group, rename-group, delete-group, rotate-invite-code,
│                    join-by-code, list-members, leave-group, remove-member, groups.facade.ts, testing/ (dobles)
├── infrastructure/  mongo-group.repository.ts, group.schemas.ts, random-invite-code-generator.ts,
│                    users-facade-member-directory.ts, system-clock.ts
└── presentation/    groups.controller.ts, groups.module.ts
```

Colecciones:

- `groups { _id, name, createdAt, updatedAt, inviteCode (único) }`. **No hay `ownerId`**: la propiedad vive solo en la
  membresía con `role: 'owner'`, así que no puede haber dos fuentes de verdad divergentes. Un test de invariante comprueba
  que cada grupo tiene exactamente una membresía `owner` y que `remove-member` nunca la borra.
- `group_members { groupId, userId, role, joinedAt }` con índice único `(groupId, userId)`, `(userId, joinedAt)` para la
  lista del usuario y `(groupId, joinedAt)` para la del grupo.

`memberCount` se obtiene con **una sola agregación** (`$match` con `$in` de los ids y `$group` por `groupId`), no con un
`countDocuments` por grupo: es el patrón que heredará `job-links` para contar links. `slug` y
`settings.defaultVisibility` de design.md no entran: los piden `public-preview-share` y `job-links` (anotado en el
manifiesto junto al backfill de `slug`).

### D2 — Pertenencia y privacidad

Todo caso de uso que recibe `groupId` empieza resolviendo la membresía del usuario (`findMembership(groupId, userId)`):

- sin membresía → `GroupNotFound` (404 `group_not_found`), el mismo error que un grupo inexistente y que un `:id` con
  formato inválido, así que no se pueden distinguir entre sí;
- con membresía `member` donde hace falta `owner` → `Forbidden` (403 `forbidden`), porque el usuario ya sabe que el grupo
  existe.

`inviteCode` solo se incluye cuando el rol resuelto es `owner` y el endpoint lo devuelve: el mapeo vive en un único
`toGroupDetail(group, role, memberCount, { includeInviteCode })`, y `join-by-code` no lo usa: devuelve
`toGroupSummary(group, role, memberCount, joinedAt)`, la misma forma que la lista, nunca el código, así que ningún endpoint puede filtrarlo por descuido. Los identificadores (`:id`, `:userId`) se comprueban con el predicado
`domain/identifier.ts` (`isGroupId`, `isUserId`: hexadecimal de 24 caracteres), que usan tanto el adaptador de Mongo (como
`MongoUserRepository`) como los dobles en memoria: un valor con otro formato devuelve `null`/`false` y termina en el 404
uniforme, nunca en un `CastError` 500.

### D3 — Código de invitación

8 caracteres del alfabeto `23456789ABCDEFGHJKMNPQRSTVWXYZ` (30 símbolos: base32 de Crockford sin `0`, `1`, `I`, `L`,
`O` ni `U`), generados con `randomInt` de `node:crypto`: 30⁸ ≈ 6,6e11 combinaciones. El puerto `INVITE_CODE_GENERATOR`
permite fijarlo en tests.

- **Unicidad:** índice único. El **reintento vive en el repositorio** (`create` y `rotateInviteCode`): si Mongo devuelve
  11000 sobre `inviteCode`, pide otro código al generador, hasta 5 veces; si persiste, error 500. El generador sigue
  siendo puro y no consulta Mongo (nada de check-then-insert).
- **Entrada:** `trim` y mayúsculas. La validación de longitud y alfabeto es del **dominio**, no del schema de la petición:
  `joinGroupRequestSchema.code` solo exige cadena no vacía de hasta 64 caracteres (cordura), y un código mal formado
  produce `InvalidInviteCode` → 404 con el mismo cuerpo que uno desconocido. Así el caso más común (un código pegado de
  WhatsApp con un carácter raro) no cae en el 400 genérico del pipe, que el SPA no sabría explicar.

### D4 — Límites

`MAX_MEMBERS_PER_GROUP = 50` y `MAX_GROUPS_PER_USER = 20` en `domain/limits.ts`. Se comprueban contando antes de escribir;
como no hay transacción entre la cuenta y el alta, la carrera se cierra con el índice único de `(groupId, userId)`
(membresía duplicada) y se acepta que un grupo pueda terminar con 51 miembros si dos uniones coinciden: es un límite
antiabuso, no una invariante de negocio (Risks). Las membresías huérfanas (grupo borrado) no cuentan para el límite del
usuario.

### D5 — Unirse es idempotente

`join-by-code` resuelve el grupo por código, luego la membresía: si ya existe, devuelve el grupo con el rol actual sin
escribir (así el owner que pega su propio código recibe `owner`, incluso si está en el tope de 20 grupos). Si no existe,
comprueba los dos límites y crea la membresía `member`; un duplicado por carrera (11000) se trata como "ya era miembro" y
devuelve `200`. La respuesta de unión nunca lleva `inviteCode`.

### D6 — Escrituras atómicas y membresías huérfanas

- **Crear grupo**: documento del grupo y membresía `owner` en una transacción (`withTransaction`, como
  `MongoSessionRepository`), para que no exista nunca un grupo sin owner con código válido.
- **Borrar grupo**: membresías y grupo en una transacción.
- **Huérfanas**: un `join` concurrente a un borrado puede dejar una membresía sin grupo. `list-my-groups` las descarta
  (la agregación las omite) y el conteo de grupos del usuario para el límite usa esa misma consulta, así que tampoco
  cuentan; `leave-group` y `remove-member` operan sobre la membresía sin exigir que el grupo exista, de modo que la plaza
  siempre se puede liberar aunque la UI ya no las muestre.

### D7 — Nombres de los miembros y entrada de otros módulos

`groups` no lee la colección `users`: el puerto `GROUP_MEMBER_DIRECTORY` (`displayNamesOf(userIds): Map<string,string>`)
lo implementa un adaptador sobre `UsersFacade`, que gana `getDisplayNames(userIds)` (una consulta con `$in`, proyección
solo de `displayName`; `UserRepository` y su doble en memoria ganan el método correspondiente). Un id sin nombre se
resuelve como "Usuario" en el mapeo, de forma defensiva y sin test dedicado (hoy no existe borrado de cuenta).

En sentido contrario, `groups` expone `GroupsFacade` (`isMember(groupId, userId)`, `getGroupsOf(userId)`) como **única
entrada** para el resto de la API; es lo que consumirá `job-links`. `GroupsModule` exporta solo ese facade e importa
`UsersModule`.

### D8 — Límites de import entre módulos (lint)

Hoy la regla por módulo solo cubre `**/domain/**`. Se extiende a `application/**` e `infrastructure/**`, que no pueden importar de otro
módulo salvo su facade (`**/<otro>/application/*.facade`), sus errores de dominio (`**/<otro>/domain/errors`) y sus dobles
de test (`**/<otro>/application/testing/**`, que ya usan specs como `users-facade-user-accounts.spec.ts`). `domain/**`
conserva la prohibición absoluta de ADR-020 §6: ninguna de esas tres excepciones le aplica. `presentation/**` queda
fuera de la regla salvo para importar el módulo Nest de otro (`**/presentation/*.module`), que es como `auth.module.ts`
importa hoy `UsersModule` y como `GroupsModule` importará ambos. Filas nuevas en `tools/workspace-rules` y delta MODIFIED de `platform/workspace`.

### D9 — Contratos y errores

`libs/shared/src/schemas/group.schema.ts`: `groupNameSchema` (1–60 tras `trim`), `inviteCodeSchema` (normaliza a
mayúsculas; el formato estricto lo valida el dominio), `createGroupRequestSchema`, `renameGroupRequestSchema`,
`joinGroupRequestSchema`, `groupSummarySchema`, `groupDetailSchema` (con `inviteCode` opcional), `inviteCodeResponseSchema`
(`{ inviteCode }`), `groupMemberSchema`, `groupRoleSchema` (`owner`|`member`). `apiErrorCodeSchema` suma
`group_not_found`, `member_not_found`, `forbidden`, `invalid_invite_code`, `group_full`, `too_many_groups` y
`owner_cannot_leave`; en la misma tarea se añaden sus entradas a `API_ERROR_STATUS` y `API_ERROR_MESSAGES` de
`apps/api/src/presentation/http/api-error.ts`, porque son `Record<ApiErrorCode, …>` y si no el typecheck queda rojo.

El filtro global **mantiene el patrón actual** de importar los errores de dominio por módulo y añadir sus `instanceof`
(siete más); la base común de error de dominio que anotó `auth-users` se deja para cuando un cuarto módulo la justifique,
para no tocar `auth` y `users` en este change.

### D10 — SPA

- `core/groups/groups.api.ts` con las llamadas y `GroupsStore` (`@ngrx/signals`); la lista se recarga al entrar en
  `/grupos` y tras crear, unirse, salir, expulsar o borrar; un `404` del detalle quita ese grupo del store.
- `core/navigation/home-route.ts` exporta `HOME_ROUTE = '/grupos'`, usada por `authGuard`, `guestGuard`, `safeReturnUrl`
  y las rutas, para que "inicio" tenga una sola definición.
- `features/groups/groups-list.page.ts` (`/grupos`): línea de propósito, tarjetas con nombre, rol y número de miembros,
  estado vacío con los dos botones y diálogos de Material para crear y unirse.
- `features/groups/join-group.page.ts` (`/unirse`): lee `codigo` de la query, abre el formulario con el código escrito y
  reutiliza el mismo caso de uso que el diálogo; como cualquier ruta autenticada, `returnUrl` la recupera tras el login.
- `features/groups/group-detail.page.ts` (`/grupos/:id`): nombre, miembros con fecha de alta, aviso de que los links
  llegan en un change posterior y, para el owner, el código con su advertencia, copiar la invitación completa
  (`navigator.clipboard` con respaldo de selección), renombrar, regenerar, expulsar y borrar; para el miembro, salir. Las
  acciones destructivas usan un diálogo de confirmación compartido, y la de borrar dice a cuántos miembros afecta. Tras
  expulsar se ofrece regenerar el código.
- `/` redirige a `HOME_ROUTE`; desaparecen `features/home/**` y su texto i18n.
- Mensajes de error por código, en el mismo estilo que `auth-users`.

### D11 — Tests

- Dominio y casos de uso: unitarios con repositorio y directorio en memoria y reloj fijo.
- Endpoints: integración con `createApp` + `inject` sobre `mongodb-memory-server`, autenticando con el firmador de la app
  (como `users.controller.spec.ts`), con `it(...)` con el nombre del escenario.
- Web: TestBed con `HttpTestingController` para store, páginas y diálogos.
- Smoke: recorrido de navegador en `apps/web-e2e` (crear grupo, copiar código, unirse con un segundo usuario, expulsar,
  salir y borrar). El permiso de portapapeles de Chromium se concede en el contexto; si diera guerra, se verifica el
  respaldo de selección.

## Risks / Trade-offs

- **Carrera en los límites** → un grupo puede superar 50 miembros por un instante si dos uniones concurrentes coinciden;
  aceptado (límite antiabuso). El índice único sí impide membresías duplicadas.
- **Código de 8 caracteres sin caducidad** → quien lo tenga entra mientras no se regenere; el owner lo ve con una
  advertencia explícita y puede rotarlo, y tras expulsar se le propone. Adivinarlo exige ~6,6e11 intentos autenticados.
- **Sin límite de intentos en `join`** → sin coste de acierto realista hoy; queda anotado como deuda de `job-links`.
- **Borrado real del grupo** → no hay papelera; hoy no cuelga nada del grupo y la confirmación dice a cuántos afecta.
- **Sin transferencia de propiedad** → el owner que quiere irse debe borrar el grupo; anotado en el manifiesto antes de
  `applications-tracking`.
- **El código en una URL** (`/unirse?codigo=`) → queda en el historial y podría llegar a `Referer` o a los logs de acceso;
  la página lo borra de la URL en cuanto lo lee, pero antes del login viaja además en el `returnUrl` de `/login` y
  `/registro`; la advertencia del owner cubre también el enlace y `deploy-prod` hereda no registrar query strings del SPA,
  incluidas esas dos rutas (anotado en el manifiesto).
- **Nombres visibles a cualquier miembro** → es el objetivo del grupo; el email nunca se expone y la spec de
  `users/profile` se actualiza para decirlo.

## Migration Plan

Colecciones nuevas, sin datos previos. El cambio visible para quien ya tenía sesión es que `/` pasa a ser `/grupos`.

## Open Questions

- Qué ocurre con `group_links` cuando se borra un grupo: lo decide `job-links`, que es quien los crea.
