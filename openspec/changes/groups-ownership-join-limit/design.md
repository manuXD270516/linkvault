## Context

`groups` dejó la propiedad del grupo **solo** en la membresía (`group_members.role`, sin `ownerId` en `groups`), el
owner sin forma de irse salvo borrando, `GroupsFacade` como única entrada de otros módulos y `GroupDeletionHooks` para la
cascada del borrado (ADR-021 §6), que `MongoGroupRepository.deleteGroup` ejecuta dentro de su transacción. El borrado,
la salida y la expulsión escriben hoy **sin mirar el rol**: `deleteGroup(groupId)` borra por `_id` (el caso de uso
comprobó antes que quien pide es owner) y `removeMember` borra por `(groupId, userId)`. La detección de claves
duplicadas (`duplicateKeyFields`) mira los **campos** del índice que falló, no su nombre: `addMember` interpreta un
`11000` con `groupId` como "ya era miembro".

`POST /api/groups/join` no cuenta nada: con 30⁸ ≈ 6,6e11 códigos el acierto por fuerza bruta no es realista, pero desde
`job-links` un código da acceso a ofertas de terceros y con `applications-tracking` dará acceso a los estados que cada
quien comparta. El contador por ventana fija ya es infraestructura de plataforma (`apps/api/src/infrastructure/limits/`,
`FIXED_WINDOW_COUNTER` con `consume`, `reset` y `giveBack`, que devuelve `null` si Redis no responde para que quien llama
elija su política). La agrupación de IP para los límites (`ipLimitGroup`, IPv6 por /64) vive todavía en
`auth/domain/client-ip.ts`. El filtro `api-exception.filter.ts` traduce `GroupsError` con un `instanceof` y tiene ramas
propias, antes que las genéricas, para los errores que llevan `Retry-After` (`TooManyLinkAttempts`).

Motivación y alcance: proposal.md; comportamiento: las specs.

### Decisiones humanas previas (2026-09-19)

1. **Change propio y antes que `applications-tracking`.** La transferencia de propiedad y el límite de intentos del
   join, que el primer borrador de `applications-tracking` llevaba como primeras tareas, salen a este change. El
   argumento de urgencia que los ataba a postulaciones no se sostenía: las postulaciones sobreviven al borrado del
   grupo (ADR-024 §5–6). Lo que sí se sostiene es la deuda de `groups` y que el código ya abre links de terceros.
2. **El límite del join se mantiene** aunque business propuso quitarlo: lo exige el manifiesto y el código de
   invitación ya abre links y, después, estados de terceros.

## Goals / Non-Goals

**Goals:**
- Que el propietario pueda irse sin destruir el grupo, y que esa sea la salida que la UI propone antes que borrar.
- Que el grupo tenga exactamente un propietario en todo momento, también ante carreras entre transferir, salir,
  expulsar y borrar.
- Que adivinar códigos de invitación cueste intentos contados, sin castigar a quien pega bien su código.

**Non-Goals:**
- Transferir y salir en un solo gesto; promoción automática del miembro más antiguo cuando el propietario sale.
- Invitaciones nominales o códigos con caducidad.
- Configurar `trustProxy` (lo hereda `deploy-prod`).
- Cualquier cosa de postulaciones (`applications-tracking`).

## Decisions

### D1 — Transferencia de propiedad

**Contrato.** `POST /api/groups/:id/owner` con `{ userId }` (`transferOwnershipRequestSchema` en `libs/shared`).
Responde `200` con `GroupDetail` visto por quien pide, que ya es `member`: sin `inviteCode`, por el mismo
`toGroupDetail(..., { includeInviteCode })` de `groups` D2. Errores, en este orden: `group_not_found` (404, no es miembro
o `:id` mal formado), `forbidden` (403, no es owner), `already_owner` (409, se nombra a sí mismo, código nuevo),
`member_not_found` (404, el elegido no es miembro o su id está mal formado).

**Dominio.** `membership.ts` gana `canTransferOwnership(role)` y la regla "el destino es otro miembro"; el comentario
que dice "no existe la transferencia de propiedad" se corrige, igual que el de `owner_cannot_leave` en `libs/shared`.

**Atomicidad.** `GroupRepository.transferOwnership(groupId, fromUserId, toUserId)` devuelve
`'transferred' | 'not_owner' | 'target_not_member'` y ejecuta, en una transacción, dos actualizaciones **condicionadas
por rol** en este orden:
1. `updateOne({ groupId, userId: from, role: 'owner' }, { role: 'member' })`; si no modifica nada → `not_owner` (403).
2. `updateOne({ groupId, userId: to, role: 'member' }, { role: 'owner' })`; si no modifica nada → `target_not_member`
   (404), y la transacción se deshace entera.

`joinedAt` no se toca. El orden importa por la garantía de base de datos que se añade: un **índice único parcial**
`{ groupId: 1 }` con `partialFilterExpression: { role: 'owner' }` y **nombre explícito `one_owner_per_group`**. Mongo
comprueba la unicidad por sentencia, también dentro de una transacción, así que promover antes de degradar chocaría con
el propio índice. Con el índice, "exactamente un owner" deja de depender de que cada camino de escritura futuro lo
recuerde.

**Duplicados por nombre de índice (critic 9).** El índice parcial tiene los mismos campos (`groupId`) que el único
`(groupId, userId)`, así que `duplicateKeyFields(error).includes('groupId')` —lo que hoy usa `addMember` para decir "ya
era miembro"— confundiría una violación de `one_owner_per_group` con una unión repetida. `duplicateKeyFields` se
sustituye por `duplicateKeyIndex(error)`, que devuelve el **nombre** del índice que falló. El índice nuevo se llama
`one_owner_per_group`; los dos existentes conservan su nombre por defecto (`groupId_1_userId_1` e `inviteCode_1`), que
pasan a constantes en `group.schemas.ts` para no renombrar índices ya construidos. `addMember` solo relee ante
`groupId_1_userId_1`, y `create`/`rotateInviteCode` solo reintentan ante `inviteCode_1`; una violación de
`one_owner_per_group` es un fallo de programación y sube como `500`. Un test de integración lee `getIndexes()` y
comprueba que los tres nombres existen, para que un cambio de definición que altere un nombre por defecto no rompa la
detección en silencio.

**Carreras.**
- **Dos transferencias a la vez** del mismo owner (dos pestañas, destinos distintos): la segunda choca por conflicto de
  escritura, `withTransaction` la reintenta y su paso 1 ya no encuentra `role: 'owner'` → `403`.
- **Salida o expulsión del elegido mientras se transfiere (critic 10).** `removeMember(groupId, userId)` borra con
  `{ groupId, userId, role: 'member' }` y devuelve `'removed' | 'now_owner' | 'not_member'`: si no borra nada, relee y
  distingue "ahora es owner" de "no existe". `LeaveGroup` traduce `now_owner` a `409 owner_cannot_leave` (quien se iba
  acaba de recibir la propiedad) y `RemoveMember` (expulsar) a `403 forbidden` (quien expulsaba ya no es owner: acaba de
  ceder la propiedad a ese mismo miembro). `not_member` sigue como hoy. Una prueba **determinista a nivel de
  repositorio** fija el caso sin depender de la concurrencia: se promueve al miembro con el repositorio y después se le
  pide `removeMember`, que debe devolver `now_owner` sin borrar nada; la prueba por HTTP con peticiones concurrentes
  queda además como escenario de la spec.
- **Borrar mientras se transfiere (critic 8).** `deleteGroup(groupId, ownerId)` empieza, dentro de su transacción, con
  `members.deleteOne({ groupId, userId: ownerId, role: 'owner' })`; si no borra nada devuelve `not_owner` y la
  transacción aborta sin tocar nada más (→ `403 forbidden`). Después borra el grupo, el resto de membresías y ejecuta los
  hooks, como hoy. Así el borrado exige ser propietario **en el momento de escribir**, no en el de leer: un propietario
  que transfirió en otra pestaña no puede borrar el grupo del nuevo. El puerto pasa a devolver
  `'deleted' | 'not_found' | 'not_owner'`.

**Alternativas descartadas:**
- **`ownerId` en `groups`**: dos fuentes de verdad que `groups` D1 eliminó a propósito.
- **Transferir y salir en un solo gesto**: el manifiesto pide dos pasos, y un gesto combinado equivocado no se puede
  deshacer (el ex-propietario ya no está). La UI ofrece "Salir" justo después, que es un clic.
- **Promoción automática del miembro más antiguo cuando el owner sale**: decide por otros quién administra su grupo.
- **Solo la transacción, sin índice parcial**: la invariante quedaría en manos de cada escritura futura.
- **Distinguir duplicados por campos (`keyPattern`)**: los dos índices sobre `groupId` son indistinguibles así.
- **Comprobar el rol solo en el caso de uso antes de borrar**: deja la ventana entre la lectura y la escritura.

### D2 — Límite de intentos del join

- **Umbrales**: ventana fija de **15 min** (la de `auth`); **10** códigos incorrectos por usuario y **50** por IP (IPv6
  por /64). Quien pega mal su código se equivoca dos o tres veces; 10 es holgado. 50 por IP es el de login de `auth`,
  pensado para aulas y oficinas detrás de un NAT.
- **Qué cuenta**: solo `invalid_invite_code` (desconocido o mal formado). Se consume en **los dos** contadores **antes**
  de resolver el código (ADR-020 §5: consumir después dejaría pasar N peticiones concurrentes). Un `400` del pipe
  (código vacío) no llega a contar.
- **Devolución con `try/finally` (critic 11).** `consume(userId, ip)` devuelve un `JoinAttempt` que dice en qué
  contadores se consumió de verdad (el contador devuelve `null` si Redis no respondió). `JoinByCode` resuelve el código
  dentro de un `try` y, en el `finally`, llama a `giveBack(attempt)` **salvo** que el resultado haya sido
  `InvalidInviteCode`; así se devuelve el intento también si la unión lanza (`group_full`, `too_many_groups`, un error
  de Mongo), no solo en los resultados previstos. `giveBack` solo actúa sobre los contadores cuyo `consume` no fue
  `null`: devolver en un contador que no contó lo dejaría por debajo de lo real. Un intento rechazado con `429` no
  entra en el `try` y no se devuelve, como en `auth`: en una ventana fija no alarga el bloqueo.
- **Un código válido no pone a cero nada**, a diferencia del login correcto de `auth`: quien tiene un grupo propio podría
  intercalar su propio código entre cada intento y reiniciar el contador para siempre.
- **Superado**: `429 too_many_attempts` con `Retry-After` = el mayor de los dos contadores, sin resolver el código.
- **Error de dominio y filtro (critic 7).** `TooManyJoinAttempts(retryAfterSeconds)` vive en `groups/domain/errors`.
  `api-exception.filter.ts` le da su propia rama, **antes** de la de `GroupsError` y junto a `TooManyLinkAttempts`, para
  que el `429` lleve `Retry-After`; sin ella, el `instanceof GroupsError` lo traduciría sin cabecera.
- **Falla abierto**, como `auth`: con Redis caído se procesa sin límite y se avisa una vez por racha, sin código ni
  usuario. El coste de adivinar sigue siendo del orden de 1e11 intentos; negar la entrada a un grupo por un Redis
  lento sería peor.
- **Dónde**: puerto `JOIN_ATTEMPT_LIMITER` en `groups/application/ports` (`consume(userId, ip)`, `giveBack(attempt)`)
  y adaptador `CounterJoinAttemptLimiter` en `groups/infrastructure` sobre `FIXED_WINDOW_COUNTER`, con claves
  `groups:join:user:<userId>` y `groups:join:ip:<ipGroup>`. `ipLimitGroup` se mueve de `auth/domain` a
  `apps/api/src/infrastructure/limits/client-ip.ts` —infraestructura de plataforma, como el contador—, y `auth` lo
  importa de ahí; `groups` no puede importar `auth` (ADR-020 §6). `GroupsModule` importa `LimitsModule`. El controlador
  pasa `request.ip`, como `auth`.

**Alternativas descartadas:** contar todo intento (el propietario que pega su propio código, o quien reintenta tras
`group_full`, acabaría bloqueado); poner a cero con un acierto (el bypass de arriba); fallar cerrado; reutilizar el
`ATTEMPT_LIMITER` de `auth` (cruza módulos); devolver el intento solo en los resultados previstos (una excepción
inesperada se lo quedaría); quitar el límite (business 6: lo exige el manifiesto).

### D3 — Frontend y textos

- En la lista de miembros, para el propietario, "Nombrar propietario" en cada miembro, con la confirmación de la spec.
  Al terminar, el detalle se recarga ya como miembro (sin código, con "Salir").
- El propietario ve "Para salir, nombra propietario a otro miembro" donde el miembro ve "Salir" (o "Eres el único
  miembro: para irte, borra el grupo"), y la confirmación de borrado con más de un miembro termina con "Si solo quieres
  irte, nombra propietario a otro miembro y sal del grupo.".
- El `429` del join muestra "Demasiados códigos incorrectos. Espera unos minutos y vuelve a probar", conservando el
  código.
- **Vocabulario (business 8)**: en español siempre "propietario" —la etiqueta del rol ya dice "Propietario"—; en inglés
  "owner" ("Make owner", "To leave, make another member the owner", "If you only want to leave, make another member the
  owner and leave the group."). `owner` sigue siendo el valor de `role` en la API.

### D4 — Pruebas

- Unitarios de dominio y casos de uso sobre el repositorio en memoria, que gana `transferOwnership`, `removeMember` y
  `deleteGroup` con la misma semántica condicionada por rol, y un doble en memoria del limitador del join.
- Integración con `createApp` + `inject` sobre `mongodb-memory-server` en replica set: el índice parcial con su nombre,
  la detección por nombre de índice, la prueba determinista de `now_owner`, las escrituras condicionadas, los escenarios
  funcionales de la transferencia y, en tareas aparte, los de concurrencia con peticiones realmente simultáneas; el
  límite del join con el doble RESP del contador y con el contador caído, y el `Retry-After` del filtro.
- Web: TestBed con `HttpTestingController` para el detalle del grupo y la pantalla de unirse.
- E2E Playwright en `apps/web-e2e`: el propietario nombra propietario a otro, sale, y el grupo sigue con sus links.

## Risks / Trade-offs

- **Límite por IP sin `trustProxy`**: detrás de un proxy todas las peticiones comparten IP, como en `auth`;
  `deploy-prod` ya hereda configurarlo.
- **Bloqueo de 15 min de quien falla 10 códigos**: aceptado; el mensaje dice que espere, no que su cuenta esté bloqueada.
- **El índice parcial no se construye si ya hubiera un grupo con dos owners.** No debería existir (invariante con test
  desde `groups`), pero un fallo de construcción de índice de Mongoose no detiene el arranque; ver Migration Plan.
- **Transferir no se puede deshacer por quien transfirió**: la confirmación lo dice; el nuevo propietario puede
  devolverla.

## Migration Plan

Sin datos nuevos que rellenar. Antes de desplegar, con la consulta del RUNBOOK: comprobar que ningún grupo tiene más de
una membresía `owner` (agregación por `groupId` con `role: 'owner'` y `count > 1`). El índice parcial se construye al
arrancar `api` (`autoIndex` de Mongoose). Tras arrancar, `getIndexes()` de `group_members` debe mostrar
`one_owner_per_group` junto a `groupId_1_userId_1`, y el de `groups`, `inviteCode_1`.

## Open Questions

Ninguna. Las decisiones no triviales (índice parcial con nombre, escrituras condicionadas por rol, qué cuenta en el
límite del join, por qué un acierto no reinicia y la devolución en `finally`) se registrarán en **ADR-025** al cerrar el
debate critic/business de este change.

## Debate (iteración 1)

Hallazgos del debate de `applications-tracking` que pasan a este change por la decisión humana 1.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| critic 7 | El `429` del join no tenía error de dominio ni rama en el filtro: saldría sin `Retry-After` | Aceptado: `TooManyJoinAttempts` en `groups/domain/errors` y rama antes de `GroupsError` (D2) | El `instanceof GroupsError` lo traduciría sin cabecera |
| critic 8 | Borrar y transferir a la vez podía borrar el grupo del nuevo propietario | Aceptado: `deleteGroup` borra primero la membresía `owner` de quien pide o aborta con `not_owner` (D1) | El rol se comprueba al escribir, no al leer |
| critic 9 | El índice parcial comparte campos con el único `(groupId, userId)` y `addMember` los confundiría | Aceptado: nombres explícitos y detección por nombre de índice (D1) | Los campos no distinguen los dos índices |
| critic 10 | `removeMember` no distinguía "ahora es owner" y la carrera no tenía prueba reproducible | Aceptado: resultado `removed \| now_owner \| not_member` y prueba determinista de repositorio (D1) | Una prueba de carrera sola es intermitente |
| critic 11 | El intento se devolvía solo en los resultados previstos y también en contadores que no contaron | Aceptado: `try/finally` salvo `InvalidInviteCode`, y `giveBack` solo donde `consume` no fue `null` (D2) | Ni perder intentos por una excepción ni restar lo que no se sumó |
| critic 15 | Tareas de más de una hora (1.6 y 1.7 del borrador) | Aceptado: 1.6 partida en funcional y concurrencia, 1.7 en transferir y textos (tareas 3.3–3.4 y 5.1–5.2) | Tareas verificables en menos de una hora |
| critic 16 | El change mezclaba dos entregas | Aceptado por la decisión humana 1: este change | Se revisa, se prueba y se revierte por separado |
| business 6 | Quitar el límite del join por coste frente al riesgo | Adaptado: se mantiene, pero en este change (decisión humana 2) | Lo exige el manifiesto y el código ya abre datos de terceros |
| business 8 | "Owner" en la UI en español | Aceptado: "propietario" en ES, "owner" en EN (D3) | La etiqueta del rol ya dice "Propietario" |
