## Context

`groups` dejó la propiedad del grupo **solo** en la membresía (`group_members.role`, sin `ownerId` en `groups`), el
owner sin forma de irse salvo borrando, `GroupsFacade` (`isMember`, `membershipOf`, `memberIdsOf`, `getGroupsOf`) como
única entrada de otros módulos y `GroupDeletionHooks` para la cascada del borrado (ADR-021 §6). `POST /api/groups/join`
no cuenta nada: con 30⁸ ≈ 6,6e11 códigos el acierto por fuerza bruta no es realista, pero desde `job-links` un código da
acceso a ofertas de terceros y desde aquí también a quién postula a qué.

`job-links`, `link-enrichment` y `paste-job-description` dejaron el permiso de lectura de un link en
`links/application/link-access.ts` (`requireReadableLink`: lista privada o grupo del que se es miembro, `link_not_found`
uniforme), la lista privada en `user_links` (ADR-021 §5), `links` **sin exportar nada**, el contador por ventana fija
como infraestructura de plataforma (`apps/api/src/infrastructure/limits/`, `FIXED_WINDOW_COUNTER` con `consume`,
`reset` y `giveBack`, que devuelve `null` si Redis no responde para que quien llama elija su política), y el canal SSE
con su canal de Redis `events:link.enriched`. La agrupación de IP para los límites (`ipLimitGroup`, IPv6 por /64) vive
todavía en `auth/domain/client-ip.ts`. En el SPA hay rutas con `loadComponent`, `LinksStore` (`@ngrx/signals`),
`LinkList`/`LinkCard` compartidas por el detalle del grupo y `/mis-links`, y `@angular/cdk` instalado. `EventEmitter2`
no está instalado.

Motivación y alcance: proposal.md; comportamiento: las specs.

### Decisiones humanas previas (2026-09-19)

1. **Transiciones**: se puede avanzar saltando etapas ("Postulé" desde la tarjeta lleva directo a `applied`), retroceder
   para corregir un error, pasar a un cierre (`rejected`/`withdrawn`/`expired`) desde cualquier estado activo y reabrir
   uno cerrado. Cada cambio emite un `ApplicationEvent` y queda en el historial. `stageLabel` libre solo en `in_process`.
2. **Alcance de `visibility = group`**: un único interruptor por postulación. La ven los miembros de cada grupo de la
   persona en el que esa oferta está compartida, en la tarjeta de ese grupo. Nada de listas de grupos en la postulación.
3. **Qué ven los demás**: nombre (avatar) y estado canónico. Ni `stageLabel`, ni notas, ni historial.
4. **Nacimiento**: guardar un link **no** crea postulación. Nace con el primer gesto de seguimiento ("Me interesa",
   "Postulé" o moverla en el tablero). El tablero muestra solo lo que se sigue.

## Goals / Non-Goals

**Goals:**
- Que el owner pueda irse sin destruir el grupo, y que esa sea la salida que la UI propone antes que borrar.
- Que adivinar códigos de invitación cueste intentos contados, sin castigar a quien pega bien su código.
- Que una persona sepa en qué punto está de cada oferta que sigue, con un historial fiel y sin que dos pestañas se pisen.
- Que el grupo vea quién más está detrás de una vacante, solo si esa persona quiere y solo su estado canónico.
- Que ninguna operación de grupo (salir, expulsar, quitar un link, borrar) destruya la postulación privada de nadie.

**Non-Goals:**
- Notificaciones de cualquier tipo, y la alerta de postulación estancada: solo se modela `ApplicationStale.v1` (F2).
- Calcular `fitScore` (`cv-match-suggestions`).
- Avisar en vivo de un cambio de estado compartido (D8).
- Comentarios de grupo (`group-comments`), invitaciones nominales, transferir y salir en un solo gesto.
- Guardar una copia privada de la descripción de la oferta (ver Open Questions).
- `GET /api/links/:id`, que ADR-022 dejó en herencia: este change no lo necesita (D5) y pasa a `public-preview-share`.

## Decisions

### D1 — Transferencia de propiedad (primera tarea)

**Contrato.** `POST /api/groups/:id/owner` con `{ userId }` (`transferOwnershipRequestSchema` en `libs/shared`).
Responde `200` con `GroupDetail` visto por quien pide, que ya es `member`: sin `inviteCode`, por el mismo
`toGroupDetail(..., { includeInviteCode })` de `groups` D2. Errores, en este orden: `group_not_found` (404, no es miembro
o `:id` mal formado), `forbidden` (403, no es owner), `already_owner` (409, se nombra a sí mismo, código nuevo),
`member_not_found` (404, el elegido no es miembro o su id está mal formado).

**Dominio.** `membership.ts` gana `canTransferOwnership(role)` y la regla "el destino es otro miembro"; el comentario
que dice "no existe la transferencia de propiedad" se corrige, igual que el de `owner_cannot_leave` en `libs/shared`.

**Atomicidad.** `GroupRepository.transferOwnership(groupId, fromUserId, toUserId)` en una transacción con dos
actualizaciones **condicionadas por rol**, en este orden:
1. `updateOne({ groupId, userId: from, role: 'owner' }, { role: 'member' })`; si no modifica nada → `NotOwner` (403).
2. `updateOne({ groupId, userId: to, role: 'member' }, { role: 'owner' })`; si no modifica nada → `MemberNotFound`
   (404), y la transacción se deshace entera.

`joinedAt` no se toca. El orden importa por la garantía de base de datos que se añade: un **índice único parcial**
`{ groupId: 1 }` con `partialFilterExpression: { role: 'owner' }` en `group_members`. Mongo comprueba la unicidad por
sentencia, también dentro de una transacción, así que promover antes de degradar chocaría con el propio índice. Con el
índice, "exactamente un owner" deja de depender de que cada camino de escritura futuro lo recuerde.

**Carreras.** Dos transferencias simultáneas del mismo owner (dos pestañas, destinos distintos): la segunda choca por
conflicto de escritura, `withTransaction` la reintenta y su paso 1 ya no encuentra `role: 'owner'` → `403`. La salida o
expulsión simultánea del elegido tiene un hueco hoy: `removeMember` borra por `(groupId, userId)` **sin mirar el rol**,
así que un `leave` que leyó "member" antes de que se confirmara la transferencia borraría la membresía owner recién
creada. Por eso `removeMember` pasa a borrar con `{ groupId, userId, role: 'member' }` y, si no borra nada, relee: si
ahora es owner → `OwnerCannotLeave` (409); si no existe → como hoy. Con eso el grupo nunca se queda sin owner.

**UI.** En la lista de miembros, para el owner, "Nombrar owner" en cada miembro, con la confirmación de la spec. Al
terminar, el detalle se recarga ya como miembro (sin código, con "Salir"). El owner ve "Para salir, nombra owner a otro
miembro" donde el miembro ve "Salir" (o "Eres el único miembro: para irte, borra el grupo"), y la confirmación de borrado
con más de un miembro termina con "Si solo quieres irte, nombra owner a otro miembro y sal del grupo.".

**Alternativas descartadas:**
- **`ownerId` en `groups`**: dos fuentes de verdad que `groups` D1 eliminó a propósito.
- **Transferir y salir en un solo gesto**: el manifiesto pide dos pasos, y un gesto combinado equivocado no se puede
  deshacer (el ex-owner ya no está). La UI ofrece "Salir" justo después, que es un clic.
- **Promoción automática del miembro más antiguo cuando el owner sale**: decide por otros quién administra su grupo.
- **Solo la transacción, sin índice parcial**: la invariante quedaría en manos de cada escritura futura.

### D2 — Límite de intentos del join

- **Umbrales**: ventana fija de **15 min** (la de `auth`); **10** códigos incorrectos por usuario y **50** por IP (IPv6
  por /64). Quien pega mal su código se equivoca dos o tres veces; 10 es holgado. 50 por IP es el de login de `auth`,
  pensado para aulas y oficinas detrás de un NAT.
- **Qué cuenta**: solo `invalid_invite_code` (desconocido o mal formado). Se consume en **los dos** contadores **antes**
  de resolver el código (ADR-020 §5: consumir después dejaría pasar N peticiones concurrentes) y se **devuelve**
  (`giveBack`) a los dos en cualquier otro resultado: unión, ya miembro, `group_full`, `too_many_groups`. Un `400` del
  pipe (código vacío) no llega a contar.
- **Un código válido no pone a cero nada**, a diferencia del login correcto de `auth`: quien tiene un grupo propio podría
  intercalar su propio código entre cada intento y reiniciar el contador para siempre.
- **Superado**: `429 too_many_attempts` con `Retry-After` = el mayor de los dos contadores, sin resolver el código.
- **Falla abierto**, como `auth`: con Redis caído se procesa sin límite y se avisa una vez por racha, sin código ni
  usuario. El coste de adivinar sigue siendo del orden de 1e11 intentos; negar la entrada a un grupo por un Redis
  lento sería peor.
- **Dónde**: puerto `JOIN_ATTEMPT_LIMITER` en `groups/application/ports` (`consume(userId, ip)`, `giveBack(userId, ip)`)
  y adaptador `CounterJoinAttemptLimiter` en `groups/infrastructure` sobre `FIXED_WINDOW_COUNTER`, con claves
  `groups:join:user:<userId>` y `groups:join:ip:<ipGroup>`. `ipLimitGroup` se mueve de `auth/domain` a
  `apps/api/src/infrastructure/limits/client-ip.ts` —infraestructura de plataforma, como el contador—, y `auth` lo
  importa de ahí; `groups` no puede importar `auth` (ADR-020 §6). El controlador pasa `request.ip`, como `auth`.

**Alternativas descartadas:** contar todo intento (el owner que pega su propio código, o quien reintenta tras
`group_full`, acabaría bloqueado); poner a cero con un acierto (el bypass de arriba); fallar cerrado; reutilizar el
`ATTEMPT_LIMITER` de `auth` (cruza módulos).

### D3 — Módulo `applications` y sus fronteras

```
apps/api/src/modules/applications/
├── domain/          application.ts (agregado y reglas), application-status.ts (estados, transiciones, appliedAt),
│                    stage-label.ts, application-event.ts, identifier.ts, errors.ts
├── application/     ports: APPLICATION_REPOSITORY, APPLICATION_LINKS, APPLICATION_GROUPS,
│                    APPLICATION_USER_DIRECTORY, APPLICATIONS_CLOCK
│                    track-link, change-status, update-application, list-my-applications, get-timeline,
│                    list-group-trackers, application.mapper.ts, testing/ (repos en memoria, dobles)
├── infrastructure/  mongo-application.repository.ts, application.schemas.ts, links-facade-application-links.ts,
│                    groups-facade-application-groups.ts, users-facade-application-directory.ts, system-clock.ts
└── presentation/    applications.controller.ts, group-applications.controller.ts, applications.module.ts
```

- `domain/` es puro: sin `@nestjs/*`, `mongoose`, `bullmq` ni otros módulos (lint existente).
- **Dependencias**: `applications` → `links`, `groups`, `users`, siempre por sus fachadas y detrás de puertos propios.
  Nadie depende de `applications`.
- **`links` exporta por primera vez**: `LinksFacade` (`links/application/links.facade.ts`, permitido por la regla de
  `platform/workspace`) con `canRead(userId, linkId)` —que reutiliza `requireReadableLink`—, `cardsOf(linkIds)` (una
  consulta `$in` sobre `job_links` con proyección) y `linkIdsSharedIn(groupId, linkIds)` (una consulta sobre
  `group_links` por el índice único `(groupId, linkId)`). `LinksModule` la exporta.
- **Una sola instancia de `LinksModule`**: `AppModule` lo construye con `LinksModule.register(aiModule)` (ADR-023 §1).
  Si `ApplicationsModule` importara la clase `LinksModule` a secas, Nest crearía una segunda instancia sin `RUN_TASK` y
  la app no arrancaría. Por eso `AppModule` construye el módulo dinámico una vez y se lo pasa a
  `ApplicationsModule.register(linksModule)`, el mismo patrón con el que hoy pasa `aiModule` a `LinksModule`.
  `GroupsModule` gana `LimitsModule` para el límite del join (D2).
- **Sin bus de eventos de dominio**: el historial (`application_events`) se escribe en la misma transacción que el
  cambio, y en este change nadie más escucha un cambio de estado (D8). Instalar `EventEmitter2` para no tener
  suscriptores sería dependencia sin uso; entrará el día que haya un consumidor in-process.
- **Sin outbox**: este change no encola nada (ADR-009 solo aplica a lo que encola). `ApplicationStale.v1` no tiene
  productor (D9).
- **Sin hook de borrado de grupo**: `applications` no guarda nada que cuelgue de un grupo (D7), así que no se registra
  en `GroupDeletionHooks`.

### D4 — Modelo, estados y transiciones

**Colecciones.**
- `applications { _id, userId, linkId, status, stageLabel?, visibility, notes, appliedAt?, fitScore?, version,
  createdAt, updatedAt }`. Índices: único `{ userId: 1, linkId: 1 }`; `{ userId: 1, updatedAt: -1, _id: -1 }` para el
  tablero; `{ linkId: 1, visibility: 1, userId: 1 }` para los estados compartidos (D7).
- `application_events { _id, applicationId, userId, from?, to, fromStageLabel?, stageLabel?, at }`. Índice
  `{ applicationId: 1, at: 1, _id: 1 }`. `userId` se duplica para que el historial se pueda filtrar por dueño sin
  leer la postulación. El `note` por evento de docs/design.md **no** entra: las notas son de la postulación, una sola, y
  el historial es de estados.

**Valores.** Los estados de ADR-004 en minúsculas y `snake_case`, la convención de los valores de la API (`pending`,
`robots_disallowed`): `saved`, `interested`, `applied`, `in_process`, `offer`, `accepted`, `rejected`, `withdrawn`,
`expired`. `APPLICATION_STATUSES`, `CLOSED_STATUSES` y sus schemas viven en `libs/shared`; el dominio los repite y un
test comprueba que coinciden (el patrón de `GROUP_ROLES`).

**Transiciones.** Con la decisión humana 1, desde cualquier estado se puede ir a cualquier otro: avanzar (con saltos),
retroceder, cerrar y reabrir. La consecuencia se deja escrita: la máquina de estados **no rechaza pares**; lo que
valida el dominio es que el estado sea canónico, que la etapa solo acompañe a `in_process`, que un cambio sin diferencia
no escriba, y la versión. Pasar de un cierre a otro (`rejected` → `withdrawn`) se permite: es corregir un error, la
misma regla que retroceder. `accepted` no es un cierre: es el final feliz del camino y se puede mover como los demás.
Cada evento guarda origen y destino; el tipo de gesto ("avanzó", "corrigió", "cerró", "reabrió") se deriva al pintar,
no se guarda, para que no haya dos verdades.

**Etapa.** 1–60 caracteres tras `trim`; solo con `in_process` (refinamiento zod en el contrato → `400 validation_error`
nombrando `stageLabel`, y el dominio lo reaplica). Cambiarla sin cambiar de estado es un cambio con evento y versión.
Salir de `in_process` la borra de la postulación y la deja en `fromStageLabel` del evento de salida.

**`appliedAt`.** Se fija al entrar en `applied`/`in_process`/`offer`/`accepted` desde `saved`, `interested` o la
creación; se conserva al moverse entre esos estados o al cerrar; se borra al volver a `saved` o `interested` (deshacer
un "Postulé" por error). Es lo que dirá "Postulaste hace N días" y lo que leerá `ApplicationStale`.

**Notas.** Hasta 2000 caracteres, privadas, sin evento.

### D5 — Nacimiento y regla de acceso

- `POST /api/applications { linkId, status, stageLabel? }`. Admite cualquier estado canónico: la UI usa `interested` y
  `applied`, pero alguien que ya tuvo una entrevista antes de conocer LinkVault no tiene por qué recorrer el camino.
- **Solo se sigue lo que se ve**: `APPLICATION_LINKS.canRead(userId, linkId)` (sobre `LinksFacade`); si no, `404
  link_not_found`, el mismo cuerpo que da `links` para un link ajeno, inexistente o mal formado. Guardar un link no crea
  nada (decisión humana 4).
- **Después, la postulación es de su dueño, vea o no el link.** Cambiar de estado, editar notas, compartir y leer el
  historial solo exigen ser el dueño (`application_not_found` uniforme en otro caso). El tablero pinta la ficha del link
  con `cardsOf`, sin contexto de grupo. Así, que el owner borre el grupo donde estaba la oferta —el caso que el
  manifiesto quiere evitar— no le quita a nadie su proceso ni la forma de abrir la oferta. La ficha no revela nada
  privado: un preview no tiene datos privados (ADR-022 §9) y esa persona ya lo vio.
- **Ya la seguía**: `201 { application, created: false }` con la postulación intacta, el patrón de `shared:
  'already_there'` de `links`. El SPA pinta el estado real con "Ya la seguías" sin una segunda petición.
- **Por qué no `GET /api/links/:id`** (heredado de ADR-022): el tablero trae las fichas dentro de su propio listado y el
  panel trabaja sobre lo que ya tiene. Lo escribirá quien lo necesite (`public-preview-share`).

**Alternativas descartadas:** crear la postulación al guardar (decisión humana 4; llenaría el tablero de lo que solo se
guardó); exigir acceso vigente para operar (dejaría a la persona sin su historial justo cuando el grupo desaparece);
`409` cuando ya existe (obligaría al SPA a pedirla aparte).

### D6 — Unicidad `(userId, linkId)` y dos pestañas

- **Alta**: transacción con el insert de la postulación y el de su primer evento. Un `11000` sobre `(userId, linkId)`
  deja la transacción abortada y no es un `TransientTransactionError`, así que se hace lo de ADR-021 §1: fuera de la
  transacción, releer la existente y responder `created: false`. Resultado: dos pestañas que pulsan a la vez producen
  una postulación y **un** evento de creación.
- **Cambio de estado**: el SPA manda la `version` que pintó. La escritura es
  `updateOne({ _id, userId, version }, { $set: …, $inc: { version: 1 } })` más el insert del evento, en una transacción.
  Si no modifica nada, se relee: si la postulación es de otro o no existe → `404 application_not_found`; si la versión
  cambió → `409 application_conflict`. El SPA vuelve a pedir la lista y lo explica (spec `web/applications`). Es el
  mismo patrón que `previewVersion` (ADR-022 §1).
- **Mismo estado y misma etapa**: `200` sin escribir, así un doble clic no deja dos eventos.
- **Notas y visibilidad**: última escritura gana, **sin** tocar `version`. Si subieran la versión, activar "compartir" en
  una pestaña haría fallar con `409` un arrastre en la otra, sin que haya ningún conflicto real sobre el estado.

**Alternativa descartada:** última escritura gana también en el estado. El historial seguiría siendo fiel (cada evento
guarda el origen real), pero una pestaña vieja podría devolver en silencio una oferta de `offer` a `applied`.

### D7 — Visibilidad derivada y el endpoint de los avatares

**Derivada en cada lectura.** Una postulación aparece en la tarjeta del link L en el grupo G si y solo si:
`visibility = 'group'`, su dueño es miembro **actual** de G y L está compartido **ahora** en G. Nada se escribe al
salir, al ser expulsado, al quitar el link ni al borrar el grupo: deja de cumplirse la condición y deja de verse; se
revierte y vuelve a verse. La postulación privada (estado, etapa, notas, historial y la propia preferencia de compartir)
no se toca nunca.

**`GET /api/groups/:id/applications?linkIds=a,b,…`** (1 a 50, el tamaño máximo de página de links), en
`GroupApplicationsController` bajo `groups/:id/applications`, como `GroupLinksController` de `links`. Plan de consultas,
**fijo** —cinco, pida 2 links o 50—:
1. `APPLICATION_GROUPS.isMember(groupId, userId)` → si no, `404 group_not_found`.
2. `APPLICATION_LINKS.linkIdsSharedIn(groupId, linkIds)` → descarta los que no están en G (y los mal formados).
3. `APPLICATION_GROUPS.memberIdsOf(groupId)`.
4. `applications.find({ linkId: { $in }, visibility: 'group', userId: { $in: miembros } })` con proyección
   `{ linkId, userId, status, updatedAt }`, por el índice `{ linkId, visibility, userId }`.
5. `APPLICATION_USER_DIRECTORY.displayNamesOf(userIds)` (sobre `UsersFacade.getDisplayNames`).

Respuesta `{ items: [{ linkId, trackers: [{ userId, displayName, status }] }] }`, `trackers` del cambio más reciente
al más antiguo. Un test de integración cuenta las consultas con 2 y con 50 links y exige el mismo número. El SPA la pide
una vez por página cargada de links y otra al recuperar el foco (D8).

**Alternativas descartadas:**
- **Meter los avatares en `GET /api/groups/:id/links`**: haría depender `links` de `applications`, que ya depende de
  `links` para la regla de acceso; ciclo.
- **Guardar en la postulación los grupos donde se ve**: lo prohíbe la decisión humana 2, y además quedaría desfasado con
  cada alta, salida o link quitado.
- **Hooks que pasen a `private` al salir o al borrar**: pierden la preferencia de la persona, no hay hook de salida ni
  de expulsión (solo de borrado), y escribirían en `applications` desde la transacción de otro módulo.
- **Una petición por tarjeta**: el N+1 que el endpoint existe para evitar.

### D8 — Aviso en vivo: se difiere

El cambio de un estado compartido **no** se publica por el canal de Redis de `platform/realtime` en este change. Motivos:
- **Poco valor por evento**: un proceso cambia de estado cada varios días; ver el avatar de Ana moverse en vivo no cambia
  ninguna decisión de quien mira. Lo que sí importa —verlo al abrir el grupo o al volver a la pestaña— se cubre con la
  recarga por página y por foco (spec `web/applications`).
- **Coste real**: el canal actual solo sabe de `link.enriched`; esto pediría un evento nuevo en `libs/shared`, un
  publicador, un segundo reparto que calcule los destinatarios (miembros de cada grupo del dueño donde está el link) y
  un contrato de mensaje SSE, con su superficie de privacidad: cada reparto nuevo es un sitio más donde podría escaparse
  una etapa o una nota.
- **Sin deuda escondida**: la verdad está en Mongo y el SPA la relee; añadir el aviso después no cambia ningún contrato
  de este change.

Se reevalúa cuando haya notificaciones (F2) o si `group-comments` monta un reparto por grupo que se pueda reutilizar.

### D9 — `fitScore` reservado y `ApplicationStale.v1` modelado

- `fitScore?: number` (0–100) existe en el tipo de dominio y en el schema de Mongoose, **no** en el contrato de la API
  ni en ningún `$set`. Un test sobre el documento guardado y la respuesta lo comprueba. Lo escribirá
  `cv-match-suggestions`.
- `libs/shared/src/events/application-stale.event.ts`: `APPLICATION_STALE_EVENT_TYPE = 'ApplicationStale.v1'`,
  `APPLICATION_STALE_AFTER_DAYS = 10` y el schema `{ applicationId, userId, linkId, status, lastChangedAt,
  staleAfterDays }`, versionado en el `type` como `LinkEnriched.v1`. Sin canal, sin productor, sin consumidor: el
  change F2 que lo produzca decidirá si viaja por el outbox o por un cron del worker.

### D10 — Contratos en `libs/shared`

`libs/shared/src/schemas/application.schema.ts`: `applicationStatusSchema`, `APPLICATION_STATUSES`,
`CLOSED_STATUSES`, `applicationVisibilitySchema`, `stageLabelSchema`, `applicationNotesSchema`,
`trackLinkRequestSchema`, `trackLinkResponseSchema`, `changeApplicationStatusRequestSchema` (con `version` y el
refinamiento de la etapa), `updateApplicationRequestSchema` (`notes?`, `visibility?`, al menos uno),
`applicationLinkCardSchema`, `applicationSchema`, `applicationListQuerySchema` (`linkIds?`),
`applicationEventSchema`, `groupTrackersQuerySchema` y `groupTrackersResponseSchema`. En `group.schema.ts`,
`transferOwnershipRequestSchema`. `apiErrorCodeSchema` suma `already_owner` (409), `application_not_found` (404) y
`application_conflict` (409), con sus entradas en `API_ERROR_STATUS`/`API_ERROR_MESSAGES` en la misma tarea (son
`Record<ApiErrorCode, …>`). `linkIds` viaja como lista separada por comas en la query y el schema la parte, deduplica y
acota a 50.

El contrato se fija **antes** que backend y frontend (grupo 2 de tareas) para que puedan avanzar en paralelo.

### D11 — Frontend

- **Ruta**: `/postulaciones` con `loadChildren: () => import('./features/applications/applications.routes')`, el primer
  feature con su propio archivo de rutas (hoy todas usan `loadComponent`), porque es un feature con página y panel
  que crecerá. Enlace "Postulaciones" en la barra del `Shell`.
- **Estado**: `core/applications/applications.api.ts` y `ApplicationsStore` (`@ngrx/signals`, `providedIn: 'root'`), que
  guarda las postulaciones propias por `linkId` y los estados compartidos por `groupId` + `linkId`. El tablero, la
  tarjeta de link y el panel leen del mismo store, así que "Postulé" en una tarjeta mueve la oferta en el tablero sin
  recargar.
- **Tablero**: `features/applications/applications-board.page.ts` con `@angular/cdk/drag-drop` y, para teclado y
  lectores de pantalla, el menú "Mover a…" en cada tarjeta. "Guardadas" solo se muestra si tiene algo (quien sigue
  algo casi siempre empieza en "Me interesa"). "Cerradas" agrupa los tres cierres con su etiqueta; soltar ahí abre un
  menú de tres opciones. Soltar en "En proceso" abre un diálogo con la etapa opcional. La tarjeta se mueve cuando la API
  confirma.
- **Panel**: `application-detail.dialog.ts` (Material, lateral) con la oferta, el estado, la etapa, el historial, las
  notas y el interruptor de compartir con su explicación.
- **Tarjeta de link**: `LinkList` recibe del store el estado propio y los estados compartidos de sus links y se los pasa
  a `LinkCard`, que gana los gestos "Me interesa"/"Postulé", el chip del estado propio con enlace al tablero y la fila de
  avatares (iniciales con color derivado del `userId`; no hay fotos de perfil). La página del grupo pide estados propios
  y compartidos una vez por página cargada y los compartidos otra vez al recuperar el foco; `/mis-links` solo los
  propios.
- **Grupos**: "Nombrar owner" en la lista de miembros, textos del owner y de la confirmación de borrado, y el mensaje del
  `429` del join (spec `web/groups`).
- **i18n**: ids `applications.*` para lo nuevo, nombres de estado en un solo mapa (`application-status.labels.ts`), ES
  como fuente y `messages.en.xlf` completo: Guardada/Saved, Me interesa/Interested, Postulé/Applied, En proceso/In
  progress, Oferta/Offer, Aceptada/Accepted, Rechazada/Rejected, Retirada/Withdrawn, Expirada/Expired.

### D12 — Pruebas

- Dominio y casos de uso: unitarios con repositorios en memoria (`applications/application/testing/`), reloj fijo y
  dobles de las fachadas; en `groups`, el repositorio en memoria gana `transferOwnership` con la misma semántica
  condicionada, y el limitador del join su doble en memoria.
- Integración con `createApp` + `inject` sobre `mongodb-memory-server` en replica set: transferencia (incluidas las dos
  carreras de la spec, con peticiones realmente concurrentes), índice parcial, límite del join con el doble RESP del
  contador y con el contador caído, cada endpoint de postulaciones y el recuento fijo de consultas de D7.
- Web: TestBed con `HttpTestingController` para store, tablero, panel, tarjeta y detalle de grupo.
- E2E Playwright en `apps/web-e2e`: transferir y salir; seguir desde el grupo, mover en el tablero, compartir y ver el
  avatar desde un segundo usuario.

## Risks / Trade-offs

- **`GET /api/applications` no pagina.** Un tablero necesita todas las columnas a la vez y una persona sigue decenas de
  procesos, no miles. Si una cuenta supera unos cientos, habrá que paginar por columna (Open Questions).
- **Quien pierde acceso sigue viendo la ficha de la oferta que seguía.** Aceptado (D5): ya la vio, el preview no tiene
  datos privados, y lo contrario le borraría el proceso justo cuando el grupo desaparece.
- **Los avatares no se mueven en vivo** (D8): se actualizan al abrir el grupo, al cargar más y al volver a la pestaña.
- **Compartir revela a todo el grupo que esa persona busca empleo en esa empresa.** Es exactamente lo que el interruptor
  pide, es opt-in y la explicación junto al interruptor lo dice.
- **Límite por IP sin `trustProxy`**: detrás de un proxy todas las peticiones comparten IP, como en `auth`; `deploy-prod`
  ya hereda configurarlo.
- **Bloqueo de 15 min de quien falla 10 códigos**: aceptado; el mensaje dice que espere, no que su cuenta esté bloqueada.
- **El índice parcial no se construye si ya hubiera un grupo con dos owners.** No debería existir (invariante con test
  desde `groups`), pero un fallo de construcción de índice de Mongoose no detiene el arranque; ver Migration Plan.

## Migration Plan

Colecciones nuevas, sin datos previos. El índice único parcial de `group_members` se construye al arrancar `api`
(`autoIndex` de Mongoose). Antes de desplegar: comprobar con la consulta del RUNBOOK que ningún grupo tiene más de una
membresía `owner` (agregación por `groupId` con `role: 'owner'` y `count > 1`) y, tras arrancar, que el índice existe
(`getIndexes()`). No hay nada que rellenar en los datos existentes.

## Open Questions

- **Dejar de seguir una oferta.** Hoy un "Me interesa" pulsado por error solo se puede cerrar como `withdrawn`, y queda
  en "Cerradas". Recomendación: añadir `DELETE /api/applications/:id` (borra la postulación y su historial) con la
  acción "Dejar de seguir" en el panel; son dos tareas pequeñas, pero es comportamiento nuevo que no está decidido.
- **Copia privada de la descripción** (ADR-023 dejó la pregunta "a `applications-tracking` o a `cv`"). Recomendación:
  diferirla a `cv-upload-extract`/`cv-match-suggestions`, donde el texto de la vacante hace falta para el análisis y
  el tratamiento como dato personal ya está definido; aquí no aporta al seguimiento.
- **Tope de postulaciones por persona.** Recomendación: ninguno por ahora (cada una exige ver el link, y los links ya
  tienen sus límites); medir y paginar el tablero si alguna cuenta pasa de 300.
