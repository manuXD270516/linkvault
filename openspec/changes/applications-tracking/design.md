## Context

> **Ventana autónoma autorizada (2026-09-19, ~3 h de ausencia del autor).** Tras cerrar `groups-ownership-join-limit`
> (#18, #19), el autor autorizó avanzar este change sin él tanto como alcance el tiempo (apply, QA, smoke y PR), con
> merge squash solo con CI en verde y fusión manual (nunca `--auto`); decisiones no documentadas → opción recomendada
> con constancia aquí; cambio de alcance o irreversible → parar e informar. Smoke solo local con mock `synth`.

`groups` dejó `GroupsFacade` (`isMember`, `membershipOf`, `memberIdsOf`, `getGroupsOf`) como única entrada de otros
módulos y `GroupDeletionHooks` para la cascada del borrado (ADR-021 §6). `groups-ownership-join-limit`, que se entrega
antes que este change, añade la transferencia de propiedad y el límite del join; este change no usa nada de eso, pero
los dos tocan `apiErrorCodeSchema`, `api-exception.filter.ts` y `messages.*.xlf`. Por eso el apply de este change
empieza **después de fusionar** `groups-ownership-join-limit` en `main` y con la rama rebasada sobre `main` antes de
tocar esos archivos (tarea 1.1).

`job-links`, `link-enrichment` y `paste-job-description` dejaron el permiso de lectura de un link en
`links/application/link-access.ts` (`requireReadableLink`: lista privada o grupo del que se es miembro, `link_not_found`
uniforme), la lista privada en `user_links` (ADR-021 §5), `links` **sin exportar nada** y el canal SSE con su canal de
Redis `events:link.enriched`. En el SPA hay rutas con `loadComponent`, `SessionStore`, `LinksStore` (`@ngrx/signals`),
`LinkList`/`LinkCard` compartidas por el detalle del grupo y `/mis-links`, y `@angular/cdk` instalado. `EventEmitter2`
no está instalado. `api-exception.filter.ts` traduce los errores de cada módulo con un `instanceof` de su clase base y
ramas propias antes de ella para los que nombran un campo.

Motivación y alcance: proposal.md; comportamiento: las specs; decisiones no triviales: ADR-024.

### Decisiones humanas previas (2026-09-19)

1. **Transiciones**: se puede avanzar saltando etapas ("Postulé" desde la tarjeta lleva directo a `applied`), retroceder
   para corregir un error, pasar a un cierre (`rejected`/`withdrawn`/`expired`) desde cualquier estado activo y reabrir
   uno cerrado. Cada cambio emite un `ApplicationEvent` y queda en el historial. `stageLabel` libre solo en `in_process`.
2. **Alcance de `visibility = group`**: un único interruptor por postulación. La ven los miembros de cada grupo de la
   persona en el que esa oferta está compartida, en la tarjeta de ese grupo. Nada de listas de grupos en la postulación.
3. **Qué ven los demás**: nombre (avatar) y estado canónico. Ni `stageLabel`, ni notas, ni historial.
4. **Nacimiento**: guardar un link **no** crea postulación. Nace con el primer gesto de seguimiento ("Me interesa",
   "Postulé" o moverla en el tablero). El tablero muestra solo lo que se sigue.
5. **"Dejar de seguir" entra en este change**: `DELETE /api/applications/:id`, solo para la dueña, borra la postulación
   y todos sus eventos en una transacción; después deja de verse en el tablero y en los grupos. En la UI, "Dejar de
   seguir" en el panel de detalle, con confirmación.
6. **La transferencia de propiedad y el límite del join salen a `groups-ownership-join-limit`**, que se entrega antes.

## Goals / Non-Goals

**Goals:**
- Que una persona sepa en qué punto está de cada oferta que sigue, con un historial fiel y sin que dos pestañas se pisen.
- Que el grupo vea quién más está detrás de una vacante, solo si esa persona quiere, sabiendo a quién se lo enseña, y
  solo su estado canónico.
- Que compartir esté a un clic del gesto que lo hace útil, sin dejar de ser opt-in.
- Que ninguna operación de grupo (salir, expulsar, quitar un link, borrar) destruya la postulación privada de nadie, y
  que la persona pueda quitar del todo lo que siguió por error.

**Non-Goals:**
- Notificaciones de cualquier tipo, y la alerta de postulación estancada: solo se modela `ApplicationStale.v1` (F2).
- Calcular `fitScore` (`cv-match-suggestions`).
- Avisar en vivo de un cambio de estado compartido (D8).
- Comentarios de grupo (`group-comments`) e invitaciones nominales.
- Transferencia de propiedad y límite del join (`groups-ownership-join-limit`).
- El filtro "Sin seguir" en las listas de links y los gestos por lotes (business 11, diferido).
- Corregir la fecha de postulación de una postulación que ya la tiene.
- Guardar una copia privada de la descripción de la oferta (ver Open Questions).
- `GET /api/links/:id`, que ADR-022 dejó en herencia: este change no lo necesita (D4) y pasa a `public-preview-share`.

## Decisions

### D1 — Módulo `applications` y sus fronteras

```
apps/api/src/modules/applications/
├── domain/          application.ts (agregado y reglas), application-status.ts (estados y cierres), applied-at.ts,
│                    stage-label.ts, application-event.ts, identifier.ts, errors.ts
├── application/     ports: APPLICATION_REPOSITORY, APPLICATION_LINKS, APPLICATION_GROUPS,
│                    APPLICATION_USER_DIRECTORY, APPLICATIONS_CLOCK
│                    track-link, change-status, update-application, untrack-application, list-my-applications,
│                    get-timeline, list-group-trackers, application.mapper.ts, testing/ (repos en memoria, dobles)
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
- **Sin bus de eventos de dominio** (ADR-024 §2): el historial se escribe en la misma transacción que el cambio, y en
  este change nadie más escucha un cambio de estado.
- **Sin outbox**: este change no encola nada. `ApplicationStale.v1` no tiene productor (D9).
- **Sin hook de borrado de grupo** (ADR-024 §6): `applications` no guarda nada que cuelgue de un grupo (D6).

### D2 — Modelo, estados y transiciones

**Colecciones.**
- `applications { _id, userId, linkId, status, stageLabel?, visibility, notes, appliedAt?, statusChangedAt, fitScore?,
  version, createdAt, updatedAt }`. Índices: único `{ userId: 1, linkId: 1 }`; `{ userId: 1, updatedAt: -1, _id: -1 }`
  para el tablero; `{ linkId: 1, visibility: 1, userId: 1 }` para los estados compartidos (D6).
- `application_events { _id, applicationId, userId, from?, to, fromStageLabel?, stageLabel?, at }`. Índice
  `{ applicationId: 1, at: 1, _id: 1 }`. `userId` se duplica para filtrar el historial por dueño sin leer la
  postulación. El `note` por evento de docs/design.md **no** entra: las notas son de la postulación y el historial es de
  estados.

**Valores.** Los estados de ADR-004 en minúsculas y `snake_case`, la convención de los valores de la API: `saved`,
`interested`, `applied`, `in_process`, `offer`, `accepted`, `rejected`, `withdrawn`, `expired`. `APPLICATION_STATUSES`,
`CLOSED_STATUSES` y sus schemas viven en `libs/shared`; el dominio los repite y un test comprueba que coinciden (el
patrón de `GROUP_ROLES`). `saved` se conserva en el modelo porque es canónico, pero la UI no lo ofrece (D11, business 7).

**Transiciones** (ADR-024 §1). Desde cualquier estado se puede ir a cualquier otro. La máquina de estados **no rechaza
pares**; el dominio valida que el estado sea canónico, que la etapa solo acompañe a `in_process`, que un cambio sin
diferencia no escriba, y la versión (D5). `rejected` → `withdrawn` es corregir; `accepted` no es un cierre. Cada evento
guarda origen y destino; el tipo de gesto se deriva al pintar.

**Etapa.** 1–60 caracteres tras `trim`; con texto, solo con `in_process` (refinamiento zod → `400 validation_error`
nombrando `stageLabel`, y el dominio lo reaplica). En la petición, `stageLabel` **omitido** estando en `in_process` y
pidiendo `in_process` conserva la etapa; `null` explícito la borra; al entrar en `in_process` desde otro estado,
omitido o `null` significan sin etapa; `null` se admite con cualquier estado y equivale a "sin etapa". Cambiar la etapa
sin cambiar de estado es un cambio con evento y versión. Salir de `in_process` la borra de la postulación y la deja en
`fromStageLabel` del evento de salida.

**`statusChangedAt`** (critic 14). Se fija al crear y en cada cambio efectivo de estado o de etapa; editar notas o
visibilidad no lo toca. Ordena los avatares del grupo (D6) y es el `lastChangedAt` de `ApplicationStale.v1` (D9).
`updatedAt` sigue cambiando con todo y ordena el tablero.

**Notas.** Hasta 2000 caracteres, privadas, sin evento, última escritura gana (riesgo aceptado en ADR-024).

### D3 — `appliedAt`

Regla por **estado de destino**, sin mirar el origen (critic 2, ADR-024 §3), en `domain/applied-at.ts`:

| Destino | Sin `appliedAt` en la petición | Con `appliedAt` en la petición |
|---------|-------------------------------|--------------------------------|
| `applied`, `in_process`, `offer`, `accepted`, sin fecha previa | la hora del cambio | la enviada |
| `applied`, `in_process`, `offer`, `accepted`, con fecha previa | se conserva | se ignora y se conserva |
| `saved`, `interested` | se borra | `400` |
| `rejected`, `withdrawn`, `expired` | no se toca | `400` |

`appliedAt` es opcional en `POST /api/applications` y en `PATCH /status` con cualquiera de los cuatro estados de
postulada (critic 8, opción a; refinamiento zod → `400 validation_error` nombrando `appliedAt` con los demás). Si la
postulación ya tiene fecha, la enviada se ignora: corregirla sigue fuera de alcance. **Futura** es lo posterior a
`now + 24 h` según `APPLICATIONS_CLOCK` (critic 4): `InvalidAppliedAt` → `400 validation_error` nombrando `appliedAt`.
El margen existe porque el SPA manda otro día como ISO de la **medianoche local** y **omite** `appliedAt` cuando la
respuesta es "Hoy", así que manda el reloj del servidor; una zona horaria adelantada o un reloj de cliente que va por
delante no deben rechazar una fecha legítima. Pedir el mismo estado y etapa es "sin cambios" (D5) y tampoco toca la
fecha. El caso que motivó la regla por destino, "reabrir sin fecha" (una oferta que se cerró sin postular y se reabre
en "En proceso"), toma la del cambio o la enviada. Un test recorre la tabla con todos los pares origen → destino.

### D4 — Nacimiento, acceso y dejar de seguir

- `POST /api/applications { linkId, status, stageLabel?, appliedAt? }`. Admite cualquier estado canónico: la UI usa
  `interested` y `applied`, pero quien ya tuvo una entrevista antes de conocer LinkVault no tiene por qué recorrer el
  camino.
- **Solo se sigue lo que se ve**: `APPLICATION_LINKS.canRead(userId, linkId)`; si no, `404 link_not_found`, el mismo
  cuerpo que da `links` para un link ajeno, inexistente o mal formado. Guardar un link no crea nada.
- **Después, la postulación es de su dueño, vea o no el link** (ADR-024 §5). Cambiar de estado, editar notas,
  compartir, leer el historial y dejar de seguir solo exigen ser el dueño (`application_not_found` uniforme en otro
  caso). El tablero pinta la ficha del link con `cardsOf`, sin contexto de grupo.
- **Ya la seguía**: `201 { application, created: false }` con la postulación intacta. El SPA pinta el estado real con
  "Ya la seguías" sin una segunda petición.
- **Dejar de seguir** (decisión humana 5, ADR-024 §8): `DELETE /api/applications/:id` → `204`. Caso de uso
  `UntrackApplication`; el repositorio borra con `deleteOne({ _id, userId })` y `deleteMany({ applicationId })` en una
  transacción; si el primero no borra nada, `404 application_not_found` y no se toca ningún evento. Un `PATCH` que
  llegue después relee y no encuentra nada → `404`. Volver a seguir la oferta crea otra postulación, con `version` 1 y
  un historial nuevo. No hay borrado lógico.
- **Por qué no `GET /api/links/:id`** (heredado de ADR-022): el tablero trae las fichas dentro de su propio listado y el
  panel trabaja sobre lo que ya tiene.

**Alternativas descartadas:** crear la postulación al guardar (decisión humana 4); exigir acceso vigente para operar
(dejaría a la persona sin su historial justo cuando el grupo desaparece); `409` cuando ya existe (obligaría al SPA a
pedirla aparte); dejar de seguir como cierre `withdrawn` o como borrado lógico (ADR-024, alternativas).

### D5 — Unicidad `(userId, linkId)` y dos pestañas

- **Alta**: transacción con el insert de la postulación y el de su primer evento. Un `11000` sobre `(userId, linkId)`
  deja la transacción abortada y no es un `TransientTransactionError`, así que se hace lo de ADR-021 §1: fuera de la
  transacción, releer la existente y responder `created: false`. Dos pestañas que pulsan a la vez producen una
  postulación y **un** evento de creación. Si la relectura devuelve `null` —otra pestaña dejó de seguir entre el
  choque y la relectura— se **repite la transacción de alta una vez** (dos intentos en total, el bucle externo de
  ADR-021 §1); si el segundo intento vuelve a chocar y a no encontrar nada, sube como error (critic 1).
- **Cambio de estado**, en este orden:
  1. Leer la postulación por `{ _id, userId }`; si no existe → `404 application_not_found`.
  2. Calcular el estado y la etapa resultantes (D2). Si son **los mismos que tiene**, responder `200` con la postulación
     **sin escribir y sin mirar la `version`** (critic 3a): un doble clic desde una pestaña vieja no es un conflicto.
  3. En una transacción, `updateOne({ _id, userId, version }, { $set: …, $inc: { version: 1 } })` y, **solo si
     `modifiedCount === 1`**, el insert del evento, dentro de la misma transacción: nunca se escribe un evento de un
     cambio que no ocurrió. Si no modifica nada, se aborta y se relee: si ya no existe → `404`; si la versión cambió →
     `409 application_conflict`. El SPA vuelve a pedir la lista y lo explica.
- **Notas y visibilidad**: última escritura gana, **sin** tocar `version` ni `statusChangedAt`. Si subieran la versión,
  activar "compartir" en una pestaña haría fallar con `409` un arrastre en la otra, sin conflicto real sobre el estado.

**Alternativas descartadas:** última escritura gana también en el estado (una pestaña vieja podría devolver en silencio
una oferta de `offer` a `applied`); comprobar la versión antes que el "sin cambios" (el `409` del doble clic).

### D6 — Visibilidad derivada y el endpoint de los avatares

**Derivada en cada lectura** (ADR-024 §6). Una postulación aparece en la tarjeta del link L en el grupo G si y solo si:
`visibility = 'group'`, su dueño es miembro **actual** de G y L está compartido **ahora** en G. Nada se escribe al
salir, al ser expulsado, al quitar el link ni al borrar el grupo; la postulación privada no se toca nunca.

**`GET /api/groups/:id/applications?linkIds=a,b,…`** (1 a 50), en `GroupApplicationsController` bajo
`groups/:id/applications`, como `GroupLinksController` de `links`. Plan de lecturas **fijo** —cuatro, pida 2 links o
50— (critic 12), una por puerto, y cada adaptador hace una sola consulta:
1. `APPLICATION_GROUPS.memberIdsOf(groupId)`; si no incluye a quien pide → `404 group_not_found` (también para un `:id`
   mal formado o un grupo borrado, que devuelven la lista vacía).
2. `APPLICATION_LINKS.linkIdsSharedIn(groupId, linkIds)` → descarta los que no están en G (y los mal formados).
3. `applications.find({ linkId: { $in }, visibility: 'group', userId: { $in: miembros } })` con proyección
   `{ linkId, userId, status, statusChangedAt }`, por el índice `{ linkId, visibility, userId }`.
4. `APPLICATION_USER_DIRECTORY.displayNamesOf(userIds)` (sobre `UsersFacade.getDisplayNames`).

Respuesta `{ items: [{ linkId, trackers: [{ userId, displayName, status }] }] }`, `trackers` por `statusChangedAt`
descendente: editar una nota no reordena. **Cómo se comprueba** (business 8, iteración 2): un test unitario de
`ListGroupTrackers` cuenta las llamadas a los dobles de sus puertos (`memberIdsOf`, `linkIdsSharedIn`, `sharedOn` del
repositorio y `displayNamesOf`) con 2 y con 50 links y exige el mismo número: una a cada uno. Que cada adaptador haga una sola consulta lo cubren ya sus
tests de integración (`cardsOf`/`linkIdsIn` en la tarea 2.1, `sharedOn` con `explain` en la 4.5). Se descarta montar
la monitorización de comandos de Mongo en el harness de `api`: coste de infraestructura de pruebas para un número que
el test unitario ya fija.

**Alternativas descartadas:**
- **`isMember` y después `memberIdsOf`**: dos consultas donde basta una.
- **Meter los avatares en `GET /api/groups/:id/links`**: haría depender `links` de `applications`; ciclo.
- **Guardar en la postulación los grupos donde se ve**, o **hooks que pasen a `private`** al salir o al borrar: ver
  ADR-024 §6.
- **Una petición por tarjeta**: el N+1 que el endpoint existe para evitar.

### D7 — Compartir: consentimiento e invitación tras el gesto

- **Texto junto al interruptor** (critic 4 adaptado, business 2 de la iteración 2): "Compartir mi estado con mis
  grupos", con la explicación "Te verán los miembros de tus grupos donde esté esta oferta, ahora o más adelante,
  incluidos quienes se unan después. Verán tu nombre y tu estado, también cuando cambie (por ejemplo, «Rechazada»).
  Nunca la etapa, las notas ni el historial. Puedes dejar de compartir cuando quieras.". Es **el mismo texto** que
  muestra "Qué verán"; vive una sola vez en i18n. Se mantiene la decisión humana 2; el riesgo de inferencia queda en
  ADR-024 §7.
- **Invitación tras el gesto** (business 1 de la iteración 1; critic 3 y business 1 y 3 de la iteración 2): tras "Me
  interesa" o "Postulé" en una tarjeta **del detalle de un grupo**, si la postulación resultante es privada, un aviso
  (`MatSnackBar.openFromComponent`, porque lleva dos acciones) dice el alcance en una línea: tras "Postulé", "¿Que tus
  grupos vean que postulaste a esta oferta? También quien entre después."; tras "Me interesa", "¿Que tus grupos vean
  que te interesa esta oferta? También quien entre después.". Acciones: "Compartir" (→ `PATCH { visibility: 'group' }`)
  y "Qué verán", que abre el texto del interruptor en un diálogo. Compartir abre un segundo aviso, "Compartido ·
  Deshacer", cuyo "Deshacer" vuelve a `private`. Ambas acciones usan el `applicationId` **capturado en el gesto**, no
  el que haya en el store al pulsar; un `404 application_not_found` (se dejó de seguir en otra pestaña) se trata en
  silencio: se quita la entrada del store (D11) y no se muestra error. Si no se pulsa, la postulación sigue privada. En
  `/mis-links` no se ofrece; tampoco si ya estaba compartida ("Ya la seguías" con `visibility` `group`).
- **Accesibilidad del aviso** (business 4): se anuncia con `aria-live` (`politeness: 'polite'` del snackbar) y no se
  cierra antes de 10 s ni mientras el foco esté dentro; se cierra al perder el foco pasado ese mínimo.

### D8 — Aviso en vivo: se difiere

El cambio de un estado compartido **no** se publica por el canal de Redis de `platform/realtime` (ADR-024 §9): poco
valor por evento, coste real (evento nuevo, publicador, reparto por destinatarios, contrato SSE) y superficie de
privacidad; la verdad está en Mongo y el SPA la relee (D11). Se reevalúa con notificaciones (F2) o si `group-comments`
monta un reparto por grupo reutilizable.

### D9 — `fitScore` reservado y `ApplicationStale.v1` modelado

- `fitScore?: number` (0–100) existe en el tipo de dominio y en el schema de Mongoose, **no** en el contrato de la API
  ni en ningún `$set`. Un **test de mapeo** de `application.mapper.ts`, con un documento que sí lo trae, comprueba que
  la respuesta no lo incluye (business 10). Lo escribirá `cv-match-suggestions`.
- `libs/shared/src/events/application-stale.event.ts`: `APPLICATION_STALE_EVENT_TYPE = 'ApplicationStale.v1'`,
  `APPLICATION_STALE_AFTER_DAYS = 10` y el schema zod `{ applicationId, userId, linkId, status, lastChangedAt,
  staleAfterDays }`, con un **test de contrato**. `lastChangedAt` es `statusChangedAt`. Sin canal, sin productor, sin
  consumidor. Se quita el test "Nada lo publica" basado en imports del primer borrador (business 10): probaba la
  ausencia de código, no un comportamiento.

### D10 — Contratos en `libs/shared`

`libs/shared/src/schemas/application.schema.ts`: `applicationStatusSchema`, `APPLICATION_STATUSES`,
`CLOSED_STATUSES`, `applicationVisibilitySchema`, `stageLabelSchema`, `applicationNotesSchema`,
`trackLinkRequestSchema` (con `appliedAt?` solo con `applied`, `in_process`, `offer` o `accepted`),
`trackLinkResponseSchema`, `changeApplicationStatusRequestSchema` (con `version`, `stageLabel` texto, `null` u
omitido, y `appliedAt?` con los mismos cuatro estados), `updateApplicationRequestSchema` (`notes?`, `visibility?`, al
menos uno), `applicationLinkCardSchema`,
`applicationSchema` (con `statusChangedAt`, sin `fitScore`), `applicationListQuerySchema` (`linkIds?`),
`applicationEventSchema`, `groupTrackersQuerySchema` y `groupTrackersResponseSchema`. `apiErrorCodeSchema` suma
`application_not_found` (404) y `application_conflict` (409), con sus entradas en `API_ERROR_STATUS`/`API_ERROR_MESSAGES`
en la misma tarea. `linkIds` viaja como lista separada por comas en la query y el schema la parte, deduplica y acota a
50. El contrato se fija **antes** que backend y frontend (grupo 1 de tareas) para que puedan avanzar en paralelo.

**Filtro HTTP** (critic 2, iteración 2). `api-exception.filter.ts` gana dos ramas, en este orden y antes de las
genéricas: `InvalidAppliedAt` → `reply('validation_error', ['appliedAt'])` (el patrón de `InvalidGroupName`, que
nombra su campo), y `ApplicationsError`, la clase base de los errores del módulo, → `reply(exception.code)` con el
estado de `API_ERROR_STATUS`. `InvalidAppliedAt` no hereda el camino genérico porque tiene que nombrar el campo.

### D11 — Frontend

- **Ruta**: `/postulaciones` con `loadChildren: () => import('./features/applications/applications.routes')`, el primer
  feature con su propio archivo de rutas. Enlace "Postulaciones" en la barra del `Shell`.
- **Estado**: `core/applications/applications.api.ts` y `ApplicationsStore` (`@ngrx/signals`, `providedIn: 'root'`), que
  guarda las postulaciones propias por `linkId` y los estados compartidos por `groupId` + `linkId`. El tablero, la
  tarjeta de link y el panel leen del mismo store. **Sesión** (critic 5): el store se reinicia entero cuando cambia
  `SessionStore.user()?.id` (cierre de sesión, otra cuenta), y una carga por `linkIds` **sustituye** las entradas de
  esos ids —las que ya no vienen se quitan—, de modo que una oferta que se dejó de seguir en otra pestaña no reaparece.
  **Un `404 application_not_found`** en cualquier operación sobre una postulación propia (cambiar, anotar, compartir,
  deshacer, historial) quita esa entrada del store —y la propia de los estados compartidos— sin mostrar error: la
  tarjeta vuelve a ofrecer los gestos (critic 5, adaptado; en el servidor la carrera se acepta como riesgo).
- **Lo propio en los compartidos, sin otra petición** (critic 6): compartir, dejar de compartir y dejar de seguir
  actualizan en el store, con la respuesta de la API, la entrada de quien pide dentro de los estados compartidos de
  ese `linkId` en cada grupo cargado —se añade con su nombre y su estado, o se quita—, de modo que el avatar propio
  aparece o desaparece al momento sin volver a pedir `GET /api/groups/:id/applications`.
- **Dejar de seguir** (critic 7): `untrack` trata un `404` como éxito (ya no existía: el resultado es el pedido) y el
  botón queda deshabilitado mientras la petición está en curso, para que un doble clic no dispare dos borrados.
- **Peticiones por bloques** (critic 13): el estado propio y los compartidos se piden por bloques de hasta 50 links
  cargados: uno por página al pintarla; al volver a la pestaña, uno por cada bloque de hasta 50 de los links cargados
  (solo los compartidos, en el detalle del grupo); y al guardar o importar links, uno por los añadidos.
- **Tablero**: `features/applications/applications-board.page.ts` con `@angular/cdk/drag-drop` y, para teclado y
  lectores de pantalla, el menú "Mover a…" en cada tarjeta. Columnas (business 6, iteración 2): "Interés" (incluye lo
  que esté en `saved`), "Postuladas", "En proceso", "Con oferta", "Aceptadas" y "Cerradas", que agrupa los tres cierres
  con su etiqueta. "Mover a…" ofrece todos los estados salvo `saved`. Soltar en "Cerradas" abre un menú de tres
  opciones. Entrar en "Postuladas", "En proceso", "Con oferta" o "Aceptadas" **sin fecha previa** pregunta "¿Cuándo
  postulaste?" (critic 8); en "En proceso" la pregunta va **en el mismo diálogo** que la etapa opcional, y con fecha
  previa ese diálogo solo pide la etapa. La tarjeta se mueve cuando la API confirma y vuelve si falla o se cancela.
- **Diálogo de fecha** (business 5, critic 4; componente `applied-date-question` reutilizado por el tablero, la tarjeta
  y el diálogo de etapa): "Hoy" es el botón principal y tiene el foco; "Otro día" despliega un selector de fecha que no
  admite días futuros. Con "Hoy" el SPA **omite** `appliedAt` y el servidor usa la hora del cambio; con otro día manda
  la ISO de la medianoche local de ese día.
- **Panel**: `application-detail.dialog.ts` (Material, lateral) con la oferta, el estado, la etapa, el historial, las
  notas, el interruptor de compartir con el texto de D7 y "Dejar de seguir" con su confirmación (business 7):
  "Dejarás de seguir esta oferta: se borrarán tu estado, tus notas y tu historial de esta oferta. Tus grupos dejarán
  de verte en ella. No se puede deshacer.".
- **Tarjeta de link**: `LinkList` recibe del store el estado propio y los compartidos y se los pasa a `LinkCard`, que
  gana los gestos "Me interesa"/"Postulé", el chip del estado propio con enlace al tablero, el snackbar de D7 en el
  grupo y la fila de avatares (iniciales con color derivado del `userId`). `/mis-links` solo pide los propios.
- **Textos** (business 2 y 9): gestos en primera persona ("Me interesa", "Postulé"); nombres de estado neutros en un
  solo mapa (`application-status.labels.ts`): Guardada/Saved, Interés/Interested, Postulada/Applied, En proceso/In
  progress, Oferta/Offer, Aceptada/Accepted, Rechazada/Rejected, Retirada/Withdrawn, Expirada/Expired (los títulos de
  columna son aparte: Interés/Interested, Postuladas/Applied, En proceso/In progress, Con oferta/Offer,
  Aceptadas/Accepted, Cerradas/Closed). Etiqueta
  accesible del avatar: "Beto · postulación: Postulada". "Postulaste hoy / ayer / hace N días" con plural ICU. ES como
  fuente y `messages.en.xlf` completo ("I'm interested", "I applied").

### D12 — Pruebas

- Dominio y casos de uso: unitarios con repositorios en memoria (`applications/application/testing/`), reloj fijo y
  dobles de las fachadas; la tabla de `appliedAt` con todos los pares; el recuento fijo de lecturas de D6 contando
  llamadas a los dobles.
- Integración con `createApp` + `inject` sobre `mongodb-memory-server` en replica set: cada endpoint de postulaciones,
  el alta concurrente y el alta contra un borrado, el borrado transaccional, el evento solo con `modifiedCount === 1` y
  las dos ramas nuevas del filtro.
- Web: TestBed con `HttpTestingController` para store (cambio de usuario, `404` que quita la entrada, avatar propio sin
  petición), tablero, diálogo de fecha, panel, tarjeta, avisos y detalle de grupo.
- E2E Playwright en `apps/web-e2e`: seguir desde el grupo, mover en el tablero, compartir y ver el avatar desde un
  segundo usuario; dejar de seguir y que el avatar desaparezca.

## Risks / Trade-offs

- **`GET /api/applications` no pagina.** Un tablero necesita todas las columnas a la vez y una persona sigue decenas de
  procesos, no miles. Si una cuenta supera unos cientos, habrá que paginar por columna (Open Questions).
- **Quien pierde acceso sigue viendo la ficha de la oferta que seguía.** Aceptado (D4, ADR-024 §5).
- **Los avatares no se mueven en vivo** (D8): se actualizan al abrir el grupo, al cargar más y al volver a la pestaña.
- **Compartir revela a todo el grupo, también a quien entre después, que esa persona busca empleo en esa empresa.** Es
  opt-in, el texto junto al interruptor lo dice y el snackbar no comparte nada sin un clic (D7, ADR-024 §7).
- **Notas con última escritura gana** entre dos pestañas (ADR-024).
- **Carreras entre dejar de seguir y otra operación en otra pestaña** (critic 5, adaptado): el servidor no las ordena;
  lo que llega después de un borrado responde `404`, y un alta tras el borrado crea una postulación nueva. Aceptado: el
  SPA trata ese `404` como "ya no la sigues" (D11) y no hay estado intermedio que reparar.
- **La cascada al borrar la cuenta no existe todavía**: la hereda `deploy-prod` (ADR-024, riesgos aceptados).

## Migration Plan

Colecciones nuevas, sin datos previos; los índices se construyen al arrancar `api` (`autoIndex`). No hay nada que
rellenar en los datos existentes. Ningún índice de `groups` cambia en este change.

## Open Questions

- **Copia privada de la descripción** (ADR-023 dejó la pregunta "a `applications-tracking` o a `cv`"). Recomendación:
  diferirla a `cv-upload-extract`/`cv-match-suggestions`, donde el texto de la vacante hace falta para el análisis y
  el tratamiento como dato personal ya está definido; aquí no aporta al seguimiento.
- **Tope de postulaciones por persona.** Recomendación: ninguno por ahora (cada una exige ver el link, y los links ya
  tienen sus límites); medir y paginar el tablero si alguna cuenta pasa de 300.

## Debate (iteración 1)

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| critic 1 (P0) | Las transiciones libres contradicen los "terminales" de ADR-004 y el `PATCH` que "valida transición", sin ADR que lo sustituya | Aceptado: ADR-024 redactado ya y ADR-004 marcado como parcialmente sustituido | Un ADR vigente gana a design.md |
| critic 2 | `appliedAt` dependía del estado de origen; reabrir un cierre sin fecha la dejaba vacía | Aceptado: regla por estado de destino con tabla y escenario "Reabrir sin fecha" (D3) | Sin mirar el origen no hay huecos |
| critic 3 | El "sin cambios" con versión vieja daba `409`; omitir la etapa no tenía semántica | Aceptado: "sin cambios" antes que la versión; omitida se conserva y `null` la borra (D2, D5) | Un doble clic no es un conflicto |
| critic 4 | Compartir revela a quien entra después y en grupos a los que la oferta llega luego | Adaptado: se mantiene la decisión humana 2 con texto de consentimiento explícito; riesgo en ADR-024 §7 (D7) | El interruptor único es decisión humana; faltaba decirlo |
| critic 5 | `ApplicationsStore` sobrevivía a un cambio de usuario y no sustituía al cargar por `linkIds` | Aceptado: reinicio por `SessionStore.user()?.id` y sustitución por ids, con test (D11) | Datos de una sesión en otra |
| critic 7–11 | Error y filtro del `429`, borrar contra transferir, índice con nombre, `removeMember` y devolución del intento | Pasan a `groups-ownership-join-limit` (decisión humana 6) | Son de grupos |
| critic 12 | El recuento de consultas no tenía cómo medirse y el plan hacía una consulta de más | Aceptado: plan de 4 con `memberIdsOf` (D6); la monitorización de comandos se sustituyó en la iteración 2 (business 8) | Un escenario sin forma de medirlo no se verifica |
| critic 13 | Al volver a la pestaña no había tope por petición y los links recién guardados quedaban sin estado | Aceptado: bloques de hasta 50 y petición por los añadidos (D11) | El endpoint acepta 50; el resto quedaba mudo |
| critic 14 | `updatedAt` ordenaba avatares y alimentaría `ApplicationStale`, y cambia al editar una nota | Aceptado: `statusChangedAt` (D2) | Una nota no es avance del proceso |
| critic 15 | Tareas de más de 1 h (8.4; revisar 8.3, 8.6 y 7.8) | Aceptado: 8.4 en tres (arrastrar; menú y diálogos; conflicto y deshacer), 8.3 en dos (columnas; tarjeta), 8.6 en dos (gestos; peticiones por bloques) y 7.8 en dos (controlador; consultas fijas) | Tareas verificables en menos de una hora |
| critic 16 | El change mezclaba dos entregas | Aceptado por la decisión humana 6 | Se revisan y revierten por separado |
| critic 17 | Cascada al borrar la cuenta y notas con última escritura gana, sin registrar | Aceptado como deuda documentada en ADR-024 | Hoy no hay borrado de cuenta; lo hereda `deploy-prod` |
| business 1 (V0) | Con el interruptor escondido en el panel nadie comparte y el grupo no ve nada | Adaptado: aviso con "Compartir" tras el gesto en un grupo, no en `/mis-links`; su texto se cambió en la iteración 2 (D7) | Opt-in a un clic, en el momento en que tiene sentido |
| business 2 | Mezcla de primera persona y nombres de estado | Aceptado: gestos en primera persona, estados neutros, etiqueta "Beto · postulación: Postulada" (D11) | "Beto · Postulé" era falso desde fuera |
| business 3 | Un "Me interesa" por error solo se podía cerrar como `withdrawn` | Aceptado = decisión humana 5 (D4) | "Retirada" mentiría sobre el proceso |
| business 4 | "Postulé" hoy sobre algo de hace días falsea `appliedAt` | Aceptado: `appliedAt` opcional, nunca futura; "¿Cuándo postulaste?" con "Hoy" como respuesta principal (D3, D11) | La fecha alimenta "Postulaste hace…" y la alerta F2 |
| business 6 | Quitar el límite del join | Adaptado: se mantiene, en `groups-ownership-join-limit` | Lo exige el manifiesto |
| business 7 | La columna "Guardadas" confunde con guardar un link | Aceptado: `saved` sigue en el modelo, sin columna ni opción; se muestra en la columna de interés, "Interés" desde la iteración 2 (D2, D11) | ADR-004 lo mantiene; la UI no lo necesita |
| business 8 | "Owner" en la UI en español | Pasa a `groups-ownership-join-limit` | Los textos son de grupos |
| business 9 | "Postulaste hace 0 días" | Aceptado: plural ICU "hoy / ayer / hace N días" (D11) | Texto natural en ES y EN |
| business 10 | El test "Nada lo publica" por imports no prueba comportamiento | Aceptado: contrato zod con test para `ApplicationStale` y test de mapeo para `fitScore` (D9) | Se prueba lo que existe, no lo que falta |
| business 11 | Filtro "Sin seguir" y gestos por lotes | Diferido: Non-Goals | Sin demanda medida todavía |

## Debate (iteración 2)

Cerró con 0 P0 y 0 V0.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| critic 1 | Si tras el `11000` del alta la relectura da `null` (otra pestaña dejó de seguir), el alta fallaba; y no estaba escrito que el evento dependa de `modifiedCount` | Aceptado: se repite la transacción de alta una vez; el evento solo con `modifiedCount === 1` en la misma transacción (D5); escenario "Seguir mientras otra pestaña deja de seguir" | Un `500` por una carrera legítima; un evento sin cambio rompe el historial |
| critic 2 | `InvalidAppliedAt` y `ApplicationsError` no tenían rama en el filtro | Aceptado: dos ramas con sus tests, en una tarea antes de los controladores (D10) | Sin rama, salen como `500` o sin nombrar el campo |
| critic 3 + business 1 y 3 | El aviso no decía el alcance ni se podía deshacer; la acción podía apuntar a otra postulación | Aceptado: texto por gesto con "También quien entre después", "Compartir"/"Qué verán", "Compartido · Deshacer", `applicationId` capturado y `404` silencioso (D7) | Consentimiento informado y reversible en el mismo sitio |
| critic 4 | "Hoy" con la hora del cliente o una zona adelantada podía dar "fecha futura" | Aceptado: "Hoy" omite `appliedAt`, otro día viaja como medianoche local, el dominio rechaza solo lo posterior a `now + 24 h` (D3) | Que una fecha legítima nunca se rechace |
| critic 5 | Carreras entre dejar de seguir y otras operaciones de otra pestaña | Adaptado: riesgo aceptado en el servidor; en el SPA un `404 application_not_found` quita la entrada sin error (D11, Risks) | El `404` ya es el estado correcto |
| critic 6 | Compartir o dejar de seguir no se reflejaba en el avatar propio hasta recargar | Aceptado: el store actualiza la entrada propia de los compartidos sin otra petición (D11) | Ver al instante lo que se acaba de decidir |
| critic 7 | Doble clic o reintento en "Dejar de seguir" daba error | Aceptado: `404` como éxito y botón bloqueado en curso (D11) | Operación idempotente desde la UI |
| critic 8 | `appliedAt` solo con `applied` dejaba sin fecha a quien salta a "En proceso" o "Con oferta" | Opción (a): se admite con los cuatro estados de postulada si no hay fecha, preguntada en el mismo diálogo; con fecha previa se ignora (D3, D11, ADR-024 §3) | La fecha existe aunque se salte "Postulé"; corregirla sigue fuera |
| critic 9 | ADR-004 con dos líneas de estado | Aceptado: una sola, "Aceptado, parcialmente sustituido por ADR-024 (2026-09-19)" | Un ADR, un estado |
| critic 10 | Los dos changes tocan los mismos archivos compartidos | Aceptado: el apply empieza tras fusionar `groups-ownership-join-limit` y con rebase antes de tocar `apiErrorCodeSchema`, el filtro y `messages.*.xlf` (Context, tarea 1.1) | Evitar conflictos en archivos tipo `Record` y en el xlf |
| business 2 | El texto del interruptor no decía que se ve también el cambio a "Rechazada" ni que es reversible | Aceptado: texto nuevo, idéntico en "Qué verán" (D7, ADR-024 §7) | Lo incómodo de compartir es el mal resultado |
| business 4 | Un snackbar breve no se deja leer ni usar con lector de pantalla | Aceptado: `aria-live`, mínimo 10 s y no se cierra con el foco dentro (D7) | Accesibilidad de una decisión de privacidad |
| business 5 | El selector de fecha estorba al caso común | Aceptado: "Hoy" principal y con foco; "Otro día" despliega la fecha (D11) | Un clic o un Enter para el caso normal |
| business 6 | Columnas que mezclaban persona y género | Aceptado: "Interés", "Postuladas", "En proceso", "Con oferta", "Aceptadas", "Cerradas" (D11) | Títulos de columna coherentes |
| business 7 | La confirmación de dejar de seguir no decía que el borrado es de lo propio | Aceptado: "se borrarán tu estado, tus notas y tu historial de esta oferta" (D11) | Que no parezca que se borra la oferta del grupo |
| business 8 | Montar la monitorización de comandos de Mongo cuesta más que lo que prueba | Aceptado: se quitan esa tarea y la de consultas fijas por HTTP; test unitario de `ListGroupTrackers` que cuenta llamadas a los dobles con 2 y 50 links (D6) | El número de lecturas lo fija el caso de uso |

## Decisiones de implementación (backend, ventana autónoma del 2026-09-19)

Lo que el diseño no fijaba y se resolvió al implementar los grupos 1 a 5, con la opción más conservadora y coherente
con D1–D12. Ninguna cambia el alcance.

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | El agregado vive en `domain/application.entity.ts` (y no en `domain/application.ts`, como dibuja D1). | La regla de lint del dominio prohíbe cualquier import `./application` (capa de aplicación); el patrón ya preveía `./application.entity` para este módulo. |
| 2 | `applicationSchema` lleva siempre `link` (`applicationLinkCardSchema`): en el alta, en los dos `PATCH` y en el tablero. Se añaden `applicationListResponseSchema` (`{ items }`) y `applicationTimelineResponseSchema` (`{ items }`), y cada evento lleva su `id`. | Una sola forma de postulación para el `ApplicationsStore`, que sustituye la entrada con la respuesta. Cuesta una consulta `cardsOf([linkId])` por escritura. |
| 3 | Una ficha que falte (un `JobLink` nunca se borra, ADR-021) es un invariante roto: el tablero omite esa postulación y una respuesta individual sale como `500`. | No romper el tablero entero por un dato imposible, sin inventar una ficha. |
| 4 | `GET /api/groups/:id/applications` devuelve **todos** los links pedidos que están en el grupo, en el orden pedido, también con `trackers` vacío; a igual `statusChangedAt` desempata por `userId`; un tracker cuyo nombre no resuelve `users` se omite. | El SPA sustituye lo que tenía de esos links (D11) y un orden estable evita avatares que bailan. |
| 5 | `linkIds` en `GET /api/applications` es opcional, pero si viene exige de 1 a 50 tras deduplicar (vacío → `400` nombrando `linkIds`), con una cota de cordura de 4096 caracteres. Un id repetido cuenta una vez. | La misma regla que la consulta de un grupo; el SPA nunca pide una página vacía. |
| 6 | `PATCH /api/applications/:id` sin `notes` ni `visibility` responde `400 validation_error` **sin** campos. Las notas no se recortan con `trim`: se guardan como se escriben. | No hay un campo culpable; el texto de una nota es de la persona. |
| 7 | `appliedAt` admite ISO con `Z` o con desplazamiento. Una fecha futura (más de `now + 24 h`) es `400` también cuando se habría ignorado por haber fecha previa; pero un "sin cambios" responde `200` **antes** de mirar la fecha enviada. | Una fecha futura es una petición inválida en cualquier caso; la spec pide que un "sin cambios" no escriba "aunque traiga `appliedAt`". |
| 8 | En `ChangeApplicationStatus`, tras el "sin cambios", una `version` distinta de la leída da `409` antes de escribir; la escritura condicionada por la versión leída cubre la carrera entre la lectura y la escritura (relectura → `404` o `409`). | D5 con las dos comprobaciones: la de la petición y la de la carrera. |
| 9 | El filtro tiene una rama para `InvalidApplicationField` (base de `InvalidAppliedAt`, `InvalidStageLabel` e `InvalidNotes`, que nombran su campo) antes de la de `ApplicationsError`. Los `404` de link y de grupo son errores propios del módulo (`TrackedLinkNotFound` con `link_not_found`, `TrackersGroupNotFound` con `group_not_found`) con los mismos cuerpos que `links` y `groups`. | D10 pedía la rama de `InvalidAppliedAt`; la etapa y las notas son la misma defensa en profundidad y necesitan nombrar su campo igual. |
| 10 | `TrackLink` comprueba `canRead` antes de validar la fecha. | Un link ajeno da el mismo `404` diga lo que diga el resto del cuerpo. |
| 11 | `links` gana `JobLinkRepository.cardsOf` y `GroupLinkRepository.linkIdsIn`; `LinksFacade.linkIdsSharedIn` devuelve un `Set`. `duplicateKeyIs` se repite en la infraestructura de `applications`. | La fachada solo delega; importar la infraestructura de `groups` está prohibido por el lint entre módulos. |
| 12 | `MongoApplicationRepository` expone `findExisting` e `insertEvent` como `protected`. | Son las costuras con las que los tests de integración fuerzan "Seguir mientras otra pestaña deja de seguir" y "Cambio y evento, juntos o ninguno" sin tocar el código de producción. |
| 13 | La tarea 2.2 añade tres filas a `tools/workspace-rules/src/workspace-rules.spec.ts` (repositorio y schemas de `links` prohibidos, fachada permitida). | Lo pide la tarea; es la única ruta fuera de `apps/api` y `libs/shared` que toca el backend. |

## Decisiones de implementación (frontend, ventana autónoma del 2026-09-19)

Lo que D11 y la spec `web/applications` no fijaban y se resolvió al implementar el grupo 6, con la opción más
conservadora y coherente con D7 y D11. Ninguna cambia el alcance.

| # | Decisión | Motivo |
|---|----------|--------|
| F1 | `core/applications` solo importa tipos de `@linkvault/shared` y repite tres cotas: 50 `linkIds` por petición, 60 caracteres de etapa y 2000 de notas. | El patrón de `LinksApi`: los valores de `@linkvault/shared` arrastran zod y no deben entrar en el bundle inicial. |
| F2 | Una respuesta que llega después de que cambie el usuario de la sesión se descarta; al crearse, el store se apunta ya al usuario actual. | El reinicio por usuario (critic 5) no basta si una petición de la sesión anterior termina después. |
| F3 | Tras un `409 application_conflict`, el store vuelve a pedir el tablero entero si está cargado y, fuera de él, solo ese link (`linkIds=<id>`). | La spec pide "volver a pedir las postulaciones"; fuera del tablero basta con la tarjeta afectada. |
| F4 | El avatar propio se pone el primero al compartir o al cambiar de estado, y conserva su sitio si el estado no cambia; el orden exacto por `statusChangedAt` llega con la siguiente carga. | El store no conoce el `statusChangedAt` de los demás; un cambio propio es, por definición, el más reciente. |
| F5 | `LinkList` pide el estado de cada link una sola vez mientras la lista vive (página, "Ver más", links añadidos). Al volver a la pestaña solo se piden los compartidos del grupo (D11); el propio se renueva al volver a abrir la página. | Es la lectura literal de D11 ("solo los compartidos, en el detalle del grupo") y evita repetir lo ya pedido tras cada recarga de `LinksStore`. |
| F6 | En el diálogo de "En proceso" con la fecha, la etapa va primero y recibe el foco; Enter en ella responde "Hoy". En la pregunta a solas, "Hoy" recibe el foco con `autoFocus` por selector. | La etapa es lo primero que se escribe; Enter sigue significando "Hoy" en los dos diálogos, como pide "Hoy por defecto". |
| F7 | "Otro día" usa `<input type="date">` con `max` en el día local de hoy, un aviso "No puede ser un día futuro" y el botón "Usar ese día". | Sin `DateAdapter` de Material configurado en la app; el selector nativo ya impide elegir días futuros. |
| F8 | Soltar en "Cerradas" abre un diálogo breve, "¿Cómo se cerró?", con los tres cierres y "Cancelar". "Mover a…" oculta también el estado actual. | D11 dice "un menú de tres opciones"; el diálogo se puede cancelar y es accesible por teclado tras un arrastre. |
| F9 | El tablero mueve una tarjeta a la vez: mientras un cambio está en curso, el arrastre y "Mover a…" quedan deshabilitados. | Un segundo cambio usaría una `version` que el primero está a punto de cambiar. |
| F10 | El panel edita el estado con el mismo "Mover a…" y la etapa con "Cambiar la etapa" (volver a entrar en "En proceso" con otra etapa, que es un cambio con su evento, D2). Tras cada cambio relee el historial. Cada fila del historial es "Estado · etapa" con fecha y hora. | Reutiliza el flujo de preguntas del tablero sin un segundo formulario de estado. |
| F11 | Las notas se guardan con "Guardar la nota" y muestran "Nota guardada"; si falla, se explica y lo escrito se conserva. Si el interruptor de compartir falla, vuelve a su posición. | Spec "Nota que no se guardó"; el interruptor nunca debe decir algo que la postulación no es. |
| F12 | La tarjeta de la oferta muestra el estado propio como "Tu postulación: <estado>" (enlace a `/postulaciones`); "Ya la seguías" se mantiene hasta el siguiente gesto sobre esa tarjeta o hasta volver a abrir la lista. | El nombre del estado es neutro (business 2) y necesita decir de quién es. |
| F13 | Si el gesto responde "Ya la seguías" con la postulación privada, en un grupo también se invita a compartir, con el texto del gesto pulsado. | D7 solo excluye lo ya compartido. |
| F14 | El aviso de compartir no tiene duración propia: a los 10 s se cierra si el foco no está dentro; con el foco dentro (o con "Qué verán" abierto) espera a que salga. Un fallo que no sea `404` al compartir o deshacer se dice con un aviso de 10 s: "No se pudo cambiar lo que ven tus grupos. Inténtalo desde el tablero.". | Business 4; un fallo silencioso haría creer que se compartió (o que se deshizo). |
| F15 | Los avatares usan un tono derivado del `userId` (`hsl(h 55% 38%)`, iniciales en blanco); "+N" lleva en `title` las etiquetas de los ocultos. | Color estable por persona sin guardar nada. |
| F16 | En los tests de páginas, `verifyNoPendingRequests` responde vacío a las peticiones de estados de postulaciones que la lista hace sola, como ya hacía con el canal de eventos. | Son peticiones de fondo; los tests de postulaciones las responden de forma explícita antes. |
