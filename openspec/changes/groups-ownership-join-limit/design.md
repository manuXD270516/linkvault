## Context

> **Ventana autónoma autorizada (2026-09-19, ~3 h de ausencia del autor).** Autorizó ejecutar sin él el ciclo completo
> de este change (debate → apply → QA → smoke → PR → merge → archivo) y seguir con `applications-tracking` hasta donde
> llegue el tiempo. Los PRs de la ventana se fusionan con squash **solo con el CI en verde**, esperando a que termine y
> fusionando a mano (nunca `gh pr merge --auto`, que en este repo fusiona al instante). Ante una decisión no
> documentada se elige la opción recomendada y se deja constancia aquí o en el ADR. Si cambia el alcance o es
> irreversible, ese change se detiene y se deja informe. Smoke solo local, con `AI_CHAIN=mock` en modo `synth`.

`groups` dejó la propiedad del grupo **solo** en la membresía (`group_members.role`, sin `ownerId` en `groups`), el
owner sin forma de irse salvo borrando, `GroupsFacade` como única entrada de otros módulos y `GroupDeletionHooks` para la
cascada del borrado (ADR-021 §6), que `MongoGroupRepository.deleteGroup` ejecuta dentro de su transacción. El borrado,
la salida y la expulsión escriben hoy **sin mirar el rol**: `deleteGroup(groupId)` borra por `_id` (el caso de uso
comprobó antes que quien pide es owner) y `removeMember` borra por `(groupId, userId)`. La detección de claves
duplicadas (`duplicateKeyFields`) mira si el `keyPattern` del índice que falló **incluye** un campo: `addMember`
interpreta un `11000` que incluye `groupId` como "ya era miembro". Los índices se construyen con `autoIndex` y, fuera de
las pruebas (que llaman a `model.init()`), nadie espera a que terminen ni mira si fallaron.

`POST /api/groups/join` no cuenta nada: con 30⁸ ≈ 6,6e11 códigos el acierto por fuerza bruta no es realista, pero desde
`job-links` un código da acceso a ofertas de terceros y con `applications-tracking` dará acceso a los estados que cada
quien comparta. El contador por ventana fija ya es infraestructura de plataforma (`apps/api/src/infrastructure/limits/`,
`FIXED_WINDOW_COUNTER` con `consume`, `reset` y `giveBack`, que devuelve `null` si Redis no responde para que quien llama
elija su política, y avisa él mismo una vez por racha de fallos). La agrupación de IP para los límites (`ipLimitGroup`,
IPv6 por /64) vive todavía en `auth/domain/client-ip.ts`. El filtro `api-exception.filter.ts` traduce `GroupsError` con
un `instanceof` y tiene ramas propias para los errores que llevan `Retry-After` (`TooManyLinkAttempts`). En el SPA,
`RequestError` ya muestra los minutos de espera a partir de `Retry-After` (`retryAfterMinutes`, redondeando hacia
arriba).

Motivación y alcance: proposal.md; comportamiento: las specs; decisiones no triviales: ADR-025.

### Decisiones humanas previas (2026-09-19)

1. **Change propio y antes que `applications-tracking`.** La transferencia de propiedad y el límite de intentos del
   join, que el primer borrador de `applications-tracking` llevaba como primeras tareas, salen a este change. El
   argumento de urgencia que los ataba a postulaciones no se sostenía: las postulaciones sobreviven al borrado del
   grupo (lo decide el ADR de `applications-tracking`, que se escribe en su propia rama). Lo que sí se sostiene es la
   deuda de `groups` y que el código ya abre links de terceros.
2. **El límite del join se mantiene** aunque business propuso quitarlo: lo exige el manifiesto y el código de
   invitación ya abre links y, después, estados de terceros. Se mantienen también los dos contadores, por usuario y por
   IP (reflect, iteración 1 propia).

## Goals / Non-Goals

**Goals:**
- Que el propietario pueda irse sin destruir el grupo, y que esa sea la salida que la UI propone antes que borrar.
- Que el grupo tenga exactamente un propietario en todo momento, también ante carreras entre transferir, salir,
  expulsar y borrar.
- Que adivinar códigos de invitación cueste intentos contados, sin castigar a quien pega bien su código ni a quien
  comparte IP con un usuario bloqueado; si se agota la IP, se bloquea a todos durante la ventana (riesgo aceptado,
  ADR-025).

**Non-Goals:**
- Transferir y salir en un solo gesto; promoción automática del miembro más antiguo cuando el propietario sale.
- Invitaciones nominales o códigos con caducidad.
- Extraer el código de un mensaje pegado entero ("Únete a … (código ABCD2345)") en la pantalla de unirse (business 9,
  diferido).
- Texto de UI para `already_owner`: la UI nunca ofrece nombrarse a uno mismo (business 11).
- Configurar `trustProxy` (lo hereda `deploy-prod`).
- Cualquier cosa de postulaciones (`applications-tracking`).

## Decisions

### D1 — Transferencia de propiedad

**Contrato.** `POST /api/groups/:id/owner` con `{ userId }` (`transferOwnershipRequestSchema` en `libs/shared`).
Responde `200` con `GroupDetail` visto por quien pide, que ya es `member`: sin `inviteCode`, por el mismo
`toGroupDetail(..., { includeInviteCode })` de `groups` D2. Errores, en este orden: `group_not_found` (404, no es miembro
o `:id` mal formado), `forbidden` (403, no es owner), `already_owner` (409, se nombra a sí mismo, código nuevo, sin
texto de UI), `member_not_found` (404, el elegido no es miembro o su id está mal formado).

**Dominio.** `membership.ts` gana `canTransferOwnership(role)` y la regla "el destino es otro miembro"; el comentario
que dice "no existe la transferencia de propiedad" se corrige, igual que el de `owner_cannot_leave` en `libs/shared`.

**Atomicidad.** `GroupRepository.transferOwnership(groupId, fromUserId, toUserId)` devuelve
`'transferred' | 'not_owner' | 'target_not_member'` y ejecuta, en una transacción, dos actualizaciones **condicionadas
por rol** en este orden:
1. `updateOne({ groupId, userId: from, role: 'owner' }, { role: 'member' })`; si no modifica nada, la función de la
   transacción devuelve `not_owner` sin haber escrito nada (→ 403).
2. `updateOne({ groupId, userId: to, role: 'member' }, { role: 'owner' })`; si no modifica nada, **lanza el centinela
   `TargetNotMember`** dentro de la transacción para que `withTransaction` la aborte y deshaga el paso 1; fuera de
   `withTransaction` se captura y se traduce a `target_not_member` (→ 404). Devolver un valor en lugar de lanzar
   confirmaría la transacción con el grupo **sin owner** (critic 2).

`joinedAt` no se toca. **Dos garantías, cada una con su responsable**: el **índice único parcial** `{ groupId: 1 }` con
`partialFilterExpression: { role: 'owner' }` y nombre explícito `one_owner_per_group` asegura **como mucho** un owner
por grupo, también frente a caminos de escritura futuros; la **transacción** asegura **al menos** uno, porque degradar
y promover se confirman juntos o no se confirma ninguno. Mongo comprueba la unicidad por sentencia, también dentro de
una transacción, así que promover antes de degradar chocaría con el propio índice: por eso el orden.

**Duplicados por `keyPattern` completo (critic 9 de `applications-tracking`, critic 3).** El índice parcial y el único
`(groupId, userId)` comparten el campo `groupId`, así que la comprobación actual ("el `keyPattern` incluye `groupId`")
confundiría una violación de `one_owner_per_group` con una unión repetida. `duplicateKeyFields` se sustituye por
`duplicateKeyIs(error, pattern)`, que compara el `keyPattern` **completo** del error con constantes de
`group.schemas.ts`: `MEMBERSHIP_KEY = { groupId: 1, userId: 1 }`, `OWNER_KEY = { groupId: 1 }` e
`INVITE_KEY = { inviteCode: 1 }`, las mismas que se usan al declarar los índices. `addMember` solo relee ante
`MEMBERSHIP_KEY`, y `create`/`rotateInviteCode` solo reintentan ante `INVITE_KEY`; una violación de `OWNER_KEY` es un
fallo de programación y sube como `500`. No se parsea `errmsg`. El índice nuevo conserva el nombre
`one_owner_per_group` para que se reconozca en `getIndexes()` y en el RUNBOOK, y un test de integración comprueba con
`getIndexes()` que existe con su filtro parcial.

**Arranque (critic 15).** `GroupsModule` espera en `onModuleInit` a `GroupMember.init()` (la construcción de sus
índices) y, si falla —por ejemplo, porque ya hubiera un grupo con dos owners—, registra un `error` con el nombre del
índice y el motivo, sin datos de grupos ni usuarios. No detiene el arranque: sin el índice, la transacción sigue
evitando grupos sin owner y la API sigue sirviendo; el `error` es lo que hace visible el problema en vez de dejarlo en
silencio. El RUNBOOK dice cómo encontrar y resolver los duplicados.

**Carreras.**
- **Dos transferencias a la vez** del mismo owner (dos pestañas, destinos distintos): la segunda choca por conflicto de
  escritura, `withTransaction` la reintenta y su paso 1 ya no encuentra `role: 'owner'` → `403`.
- **Salida o expulsión del elegido mientras se transfiere (critic 10 de `applications-tracking`).**
  `removeMember(groupId, userId)` borra con `{ groupId, userId, role: 'member' }` y devuelve
  `'removed' | 'now_owner' | 'not_member'`: si no borra nada, relee y distingue "ahora es owner" de "no existe".
  `LeaveGroup` traduce `now_owner` a `409 owner_cannot_leave` (quien se iba acaba de recibir la propiedad) y
  `RemoveMember` (expulsar) a `403 forbidden` (quien expulsaba ya no es owner: acaba de ceder la propiedad a ese mismo
  miembro; C13 lo lleva a la spec de "Expulsar a un miembro"). `not_member` sigue como hoy. Las ramas se fijan con
  pruebas **deterministas**: en el repositorio, promoviendo al miembro y pidiendo `removeMember` (→ `now_owner` sin
  borrar nada); en los casos de uso, con el doble del repositorio devolviendo `now_owner` (→ `409` o `403`, critic 11).
- **Borrar mientras se transfiere (critic 8 de `applications-tracking`).** `deleteGroup(groupId, ownerId)` empieza,
  dentro de su transacción, con `members.deleteOne({ groupId, userId: ownerId, role: 'owner' })`; si no borra nada
  devuelve `not_owner` sin haber escrito nada (→ `403 forbidden`). Después borra el grupo, el resto de membresías y
  ejecuta los hooks, como hoy. Así el borrado exige ser propietario **en el momento de escribir**. El puerto pasa a
  devolver `'deleted' | 'not_found' | 'not_owner'`.
- **Pruebas de concurrencia (critic 12, business 10).** Las pruebas por HTTP con peticiones simultáneas se quedan, pero
  solo **afirman invariantes** (un único owner o grupo borrado, nunca dos `2xx` que se contradigan) con **N = 10**
  repeticiones fijas; qué rama gana depende del planificador y la cubren las pruebas deterministas.

**Alternativas descartadas:**
- **`ownerId` en `groups`**: dos fuentes de verdad que `groups` D1 eliminó a propósito.
- **Transferir y salir en un solo gesto**: el manifiesto pide dos pasos, y un gesto combinado equivocado no se puede
  deshacer (el ex-propietario ya no está). La UI ofrece "Salir" justo después, que es un clic.
- **Promoción automática del miembro más antiguo cuando el owner sale**: decide por otros quién administra su grupo.
- **Solo la transacción, sin índice parcial**: "como mucho uno" quedaría en manos de cada escritura futura.
- **Devolver `target_not_member` en el paso 2 en lugar de lanzar**: confirmaría el paso 1 y dejaría el grupo sin owner.
- **Detectar el duplicado con "el `keyPattern` incluye `groupId`"**: no distingue el índice parcial del de membresía.
- **Detectar el duplicado por el nombre del índice parseando `errmsg`**: depende del formato de un mensaje del servidor,
  que no es contrato; el `keyPattern` sí es un campo estructurado del error.
- **Detener el arranque si el índice no se construye**: dejaría la API caída por datos antiguos que la transacción ya
  mantiene coherentes.
- **Comprobar el rol solo en el caso de uso antes de borrar**: deja la ventana entre la lectura y la escritura.
- **Pruebas de concurrencia que exijan una rama concreta**: intermitentes por construcción.

### D2 — Límite de intentos del join

- **Umbrales**: ventana fija de **15 min** (la de `auth`); **10** códigos incorrectos por usuario y **100** por IP (IPv6
  por /64). Quien pega mal su código se equivoca dos o tres veces; 10 es holgado. 100 por IP (critic 1) deja sitio a un
  aula o una oficina detrás de un NAT aunque varias personas se equivoquen a la vez, y sigue frenando a quien rota
  cuentas desde una misma máquina.
- **Qué cuenta**: solo `invalid_invite_code` (desconocido o mal formado). Se consume **antes** de resolver el código
  (ADR-020 §5: consumir después dejaría pasar N peticiones concurrentes). Un `400` del pipe (código vacío) no llega a
  contar.
- **Orden de los contadores (critic 1, business 6).** Primero el del **usuario**; si rechaza, `429` **sin consultar ni
  gastar el de la IP**: un usuario bloqueado que insiste no agota la IP de sus compañeros. Si el del usuario deja pasar,
  se consume el de la IP; si este rechaza, se **devuelve** el intento al del usuario con `giveBack` y se responde
  `429`. Regla general: **el contador que no rechazó recupera su intento**; el que rechazó se queda con él, como en
  `auth` (en una ventana fija no alarga el bloqueo). `Retry-After` es el del contador que rechazó.
- **`consume` en secuencia, `giveBack` en paralelo (critic 9; critic 3 de la iteración 2).** Los dos `consume` van uno
  tras otro, no con `Promise.all`, porque el segundo depende de la respuesta del primero. Los dos `giveBack` del
  `finally` no dependen entre sí y van con `Promise.all`. Coste: hasta **4 idas y vueltas** a Redis por join (dos
  `consume` y dos `giveBack`); con Redis lento, cada una espera como mucho el `commandTimeout` de 200 ms del cliente, así
  que un join puede tardar **hasta unos 800 ms** más antes de fallar abierto.
- **Desfase bajo concurrencia (critic 2 de la iteración 2).** Entre el `consume` de la IP que rechaza y el `giveBack`
  al usuario hay una ventana: una petición simultánea del mismo usuario puede ver su contador un intento más alto y
  recibir un `429` transitorio aunque su bloqueo real sea de la IP. En un cambio de ventana, el `giveBack` puede caer ya
  en la ventana nueva, así que el desfase es como mucho **1 intento** por cambio de ventana. Aceptado: no deja pasar
  más intentos de los permitidos.
- **Devolución con `try/finally` (critic 11 de `applications-tracking`).** `consume(userId, ip)` devuelve un
  `JoinAttempt` que dice en qué contadores se consumió de verdad (el contador devuelve `null` si Redis no respondió).
  `JoinByCode` resuelve el código dentro de un `try` y, en el `finally`, llama a `giveBack(attempt)` **salvo** que el
  resultado haya sido `InvalidInviteCode`; así se devuelve el intento también si la unión lanza (`group_full`,
  `too_many_groups`, un error de Mongo), no solo en los resultados previstos. `giveBack` solo actúa sobre los contadores
  cuyo `consume` no fue `null`: devolver en un contador que no contó lo dejaría por debajo de lo real.
- **Un código válido no pone a cero nada**, a diferencia del login correcto de `auth`: quien tiene un grupo propio podría
  intercalar su propio código entre cada intento y reiniciar el contador para siempre.
- **Error de dominio y filtro (critic 7 de `applications-tracking`, critic 8).** `TooManyJoinAttempts(retryAfterSeconds)`
  vive en `groups/domain/errors`. `api-exception.filter.ts` le da su propia rama **justo antes** del
  `instanceof GroupsError` —del que hereda—, con `Retry-After`; sin ella, la rama de `GroupsError` lo traduciría sin
  cabecera.
- **Falla abierto**, como `auth`: con Redis caído se procesa sin límite. **El adaptador no registra nada** (critic 9):
  delega en el contador, que ya avisa como mucho una vez por racha de fallos del almacén, sin código ni usuario. El coste
  de adivinar sigue siendo del orden de 1e11 intentos; negar la entrada a un grupo por un Redis lento sería peor.
- **Dónde**: puerto `JOIN_ATTEMPT_LIMITER` en `groups/application/ports` (`consume(userId, ip)`, `giveBack(attempt)`)
  y adaptador `CounterJoinAttemptLimiter` en `groups/infrastructure` sobre `FIXED_WINDOW_COUNTER`, con claves
  `groups:join:user:<userId>` y `groups:join:ip:<ipGroup>`. `ipLimitGroup` se mueve de `auth/domain` a
  `apps/api/src/infrastructure/limits/client-ip.ts` —infraestructura de plataforma, como el contador—, y `auth` lo
  importa de ahí; `groups` no puede importar `auth` (ADR-020 §6). `GroupsModule` importa `LimitsModule`. El controlador
  pasa `request.ip`, como `auth`.

**Alternativas descartadas:** contar todo intento (el propietario que pega su propio código, o quien reintenta tras
`group_full`, acabaría bloqueado); poner a cero con un acierto (el bypass de arriba); fallar cerrado; reutilizar el
`ATTEMPT_LIMITER` de `auth` (cruza módulos); devolver el intento solo en los resultados previstos (una excepción
inesperada se lo quedaría); quitar el límite (business 6: lo exige el manifiesto); **solo el contador por usuario**
(el manifiesto pide los dos, y sin el de IP basta con abrir cuentas); **consumir los dos a la vez** (un usuario
bloqueado gastaría la IP de otros); **50 por IP** (con varias personas equivocándose detrás de un NAT, bloquearía a
quien pega bien su código).

### D3 — Frontend y textos

- En la lista de miembros, para el propietario, "Nombrar propietario" **sobre cada miembro que no sea él mismo**
  (critic 14), con la confirmación "«{nombre}» tendrá el rol de propietario de «{grupo}»: podrá renombrarlo, expulsar
  miembros y borrarlo. Tú seguirás como miembro y no podrás deshacerlo." (business 3). Al terminar, el detalle se
  recarga ya como miembro (sin código, con "Salir").
- El propietario ve "Para salir, nombra propietario a otro miembro" donde el miembro ve "Salir" (o "Eres el único
  miembro: para irte, borra el grupo"). La confirmación de borrado con más de un miembro **empieza** por "Si solo
  quieres irte, nombra propietario a otro miembro y sal del grupo." (business 7), antes de decir qué se borra.
- El `429` del join **reutiliza tal cual** los mensajes de `RequestError` (critic 10 y business 4 y 5 de la iteración
  1; critic 5 y business 3 de la iteración 2), los mismos del login y sin claves i18n nuevas: con `Retry-After`,
  `@@error.tooManyAttempts` "Demasiados intentos. Vuelve a intentarlo en N minutos" (minutos redondeados hacia arriba,
  plural ICU); sin cabecera, `@@error.tooManyAttemptsLater` "Demasiados intentos. Vuelve a intentarlo más tarde". El
  código escrito se conserva. El mensaje es neutro: no dice "tus intentos", porque el bloqueo puede venir de la IP
  compartida.
- **Vocabulario (business 8 de `applications-tracking`)**: en español siempre "propietario" —la etiqueta del rol ya dice
  "Propietario"—; en inglés "owner". `owner` sigue siendo el valor de `role` en la API.
- **Textos en inglés (business 12):**

  | ES | EN |
  |----|----|
  | Nombrar propietario | Make owner |
  | «{nombre}» tendrá el rol de propietario de «{grupo}»: podrá renombrarlo, expulsar miembros y borrarlo. Tú seguirás como miembro y no podrás deshacerlo. | "{name}" will be the owner of "{group}": they will be able to rename it, remove members and delete it. You will stay as a member and cannot undo this. |
  | Para salir, nombra propietario a otro miembro | To leave, make another member the owner |
  | Eres el único miembro: para irte, borra el grupo | You are the only member: to leave, delete the group |
  | Si solo quieres irte, nombra propietario a otro miembro y sal del grupo. | If you only want to leave, make another member the owner and leave the group. |
  | Demasiados intentos. Vuelve a intentarlo en N minutos (`@@error.tooManyAttempts`, ya existe) | Too many attempts. Try again in N minutes (ya traducido) |
  | Demasiados intentos. Vuelve a intentarlo más tarde (`@@error.tooManyAttemptsLater`, ya existe) | Too many attempts. Try again later (ya traducido) |

### D4 — Pruebas

- Unitarios de dominio y casos de uso sobre el repositorio en memoria, que gana `transferOwnership`, `removeMember` y
  `deleteGroup` con la misma semántica condicionada por rol, y un doble en memoria del limitador del join. Las ramas de
  carrera (`now_owner`, `not_owner`, `target_not_member`) se prueban aquí con el doble devolviendo cada resultado.
- Integración con `createApp` + `inject` sobre `mongodb-memory-server` en replica set: el índice parcial y su filtro en
  `getIndexes()`, la detección por `keyPattern` completo, el centinela que deshace el paso 1, la prueba determinista de
  `now_owner`, las escrituras condicionadas, el `error` de arranque si el índice no se construye, los escenarios
  funcionales de la transferencia y los de lectura posterior; en una tarea aparte, las invariantes de concurrencia con
  N = 10.
- Límite del join por HTTP con un **arnés propio** (critic 6): el contador sustituible por un doble controlable (que
  cuenta, rechaza o devuelve `null`) y la `remoteAddress` indicada **por petición**, con un valor por defecto distinto en
  cada test (critic 4 de la iteración 2): los contadores por IP de un test no se mezclan con los del siguiente, y un
  mismo test puede simular dos IPs.
- Web: TestBed con `HttpTestingController` para el detalle del grupo y la pantalla de unirse.
- E2E Playwright en `apps/web-e2e`: el propietario nombra propietario a otro, sale, y el grupo sigue con sus links.

## Risks / Trade-offs

- **Límite por IP sin `trustProxy`**: detrás de un proxy todas las peticiones comparten IP, y el contador de IP pasaría
  a ser global. En local y en pruebas no hay proxy; en `deploy-prod` es un **requisito de salida a producción**, no una
  mejora (business 5 de la iteración 2, ADR-025).
- **Agotar la IP a propósito (critic 1 de la iteración 2).** Una persona con 10 cuentas —ADR-020 permite 10 registros
  por IP— puede gastar los 100 intentos de su IP en cada ventana, una tras otra, y dejar sin poder unirse a todos los
  que comparten esa IP. Le cuesta 10 cuentas y 100 peticiones por ventana. Aceptado: el RUNBOOK dice cómo liberar la IP
  (`DEL groups:join:ip:<grupo de IP>`) y cómo localizar las cuentas que la agotan (tarea 6.2). Hacer configurables los
  umbrales por variable de entorno queda como mejora futura; este change no añade ninguna.
- **Desfase de un intento bajo concurrencia y latencia del join con Redis lento** (D2): aceptados.
- **Operaciones de propietario en otra pestaña mientras se transfiere (critic 7)**: expulsar, renombrar o regenerar el
  código comprueban el rol al leer, no al escribir. Si la misma persona transfiere en una pestaña y, a la vez, renombra
  o regenera en otra, la segunda puede aplicarse ya sin ser propietaria. Aceptado: es la misma persona, lo hace
  sobre un grupo que administraba un instante antes y no deja el grupo sin owner. Expulsar al **elegido** sí se
  protege (D1).
- **Bloqueo de 15 min de quien falla 10 códigos**: aceptado; el mensaje dice cuánto esperar, no que su cuenta esté
  bloqueada.
- **El índice parcial no se construye si ya hubiera un grupo con dos owners.** No debería existir (invariante con test
  desde `groups`); si pasa, se registra un `error` al arrancar (D1) y el RUNBOOK dice cómo resolverlo.
- **Transferir no se puede deshacer por quien transfirió**: la confirmación lo dice; el nuevo propietario puede
  devolverla.

## Migration Plan

Sin datos nuevos que rellenar. Antes de desplegar, con la consulta del RUNBOOK: comprobar que ningún grupo tiene más de
una membresía `owner` (agregación por `groupId` con `role: 'owner'` y `count > 1`). El índice parcial se construye al
arrancar `api` (`autoIndex` de Mongoose), y `GroupsModule` espera a `GroupMember.init()` y registra un `error` si falla.
Tras arrancar, `getIndexes()` de `group_members` debe mostrar `one_owner_per_group` con su `partialFilterExpression`.

## Open Questions

Ninguna. Las decisiones no triviales están en **ADR-025**.

## Debate (iteración 1)

Hallazgos del debate de `applications-tracking` que pasan a este change por la decisión humana 1.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| critic 7 | El `429` del join no tenía error de dominio ni rama en el filtro: saldría sin `Retry-After` | Aceptado: `TooManyJoinAttempts` en `groups/domain/errors` y rama antes de `GroupsError` (D2) | El `instanceof GroupsError` lo traduciría sin cabecera |
| critic 8 | Borrar y transferir a la vez podía borrar el grupo del nuevo propietario | Aceptado: `deleteGroup` borra primero la membresía `owner` de quien pide o aborta con `not_owner` (D1) | El rol se comprueba al escribir, no al leer |
| critic 9 | El índice parcial comparte campos con el único `(groupId, userId)` y `addMember` los confundiría | Aceptado; la forma de distinguirlos cambió en la iteración propia (critic 3) a `keyPattern` completo (D1) | Los campos sueltos no distinguen los dos índices |
| critic 10 | `removeMember` no distinguía "ahora es owner" y la carrera no tenía prueba reproducible | Aceptado: resultado `removed \| now_owner \| not_member` y prueba determinista de repositorio (D1) | Una prueba de carrera sola es intermitente |
| critic 11 | El intento se devolvía solo en los resultados previstos y también en contadores que no contaron | Aceptado: `try/finally` salvo `InvalidInviteCode`, y `giveBack` solo donde `consume` no fue `null` (D2) | Ni perder intentos por una excepción ni restar lo que no se sumó |
| critic 15 | Tareas de más de una hora (1.6 y 1.7 del borrador) | Aceptado: 1.6 partida en funcional y concurrencia, 1.7 en transferir y textos (tareas 3.3–3.4 y 5.1–5.2) | Tareas verificables en menos de una hora |
| critic 16 | El change mezclaba dos entregas | Aceptado por la decisión humana 1: este change | Se revisa, se prueba y se revierte por separado |
| business 6 | Quitar el límite del join por coste frente al riesgo | Adaptado: se mantiene, pero en este change (decisión humana 2) | Lo exige el manifiesto y el código ya abre datos de terceros |
| business 8 | "Owner" en la UI en español | Aceptado: "propietario" en ES, "owner" en EN (D3) | La etiqueta del rol ya dice "Propietario" |

## Debate (iteración 1, propio)

Critic abrió 1 P0 y business 0 V0. Las dudas menores se resolvieron con la opción recomendada, por la ventana autónoma.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| critic 1 (P0) + business 6 | Consumir los dos contadores a la vez deja que un usuario bloqueado agote la IP de sus compañeros; 50 por IP es poco detrás de un NAT | Adaptado: se mantienen los dos contadores; primero el del usuario, y si rechaza no se toca la IP; el que no rechazó recupera su intento; IP a 100 cada 15 min (D2) | El manifiesto pide los dos; el daño colateral era el problema, no el contador |
| critic 2 | Si el paso 2 devolvía `target_not_member`, la transacción confirmaba el paso 1 y el grupo quedaba sin owner | Aceptado: centinela `TargetNotMember` lanzado dentro y traducido fuera de `withTransaction`; la spec separa "como mucho uno" (índice) de "al menos uno" (transacción) (D1) | Solo una excepción aborta la transacción |
| critic 3 | Detectar por el nombre del índice obliga a parsear `errmsg` | Aceptado: `keyPattern` completo contra `MEMBERSHIP_KEY`, `OWNER_KEY` e `INVITE_KEY`; se mantienen el nombre y el test de `getIndexes()` (D1) | El `keyPattern` es un campo estructurado; el mensaje no es contrato |
| critic 4 | "Borrar mientras se transfiere" exigía ramas concretas | Aceptado: el escenario solo afirma invariantes | La rama ganadora depende del planificador |
| critic 5 | Cambiar las firmas del puerto rompía la suite hasta la tarea de Mongo | Aceptado: 2.1 adapta también `MongoGroupRepository` con el comportamiento actual | Suite en verde tarea a tarea |
| critic 6 | 4.5 mezclaba montar el arnés y probar ocho escenarios | Aceptado: 4.5a arnés (contador sustituible, `remoteAddress` por test) y 4.5b escenarios (D4) | Menos de una hora cada una |
| critic 7 | Expulsar, renombrar o regenerar en otra pestaña mientras se transfiere | Aceptado como riesgo (Risks, ADR-025) | Misma persona, sin grupo sin owner |
| critic 8 | La rama del filtro estaba "junto a `TooManyLinkAttempts`", que va después de `GroupsError` | Aceptado: justo antes de `instanceof GroupsError` (D2) | Si no, `GroupsError` la captura antes |
| critic 9 | El adaptador duplicaba el aviso del contador; `Promise.all` contradice el orden de C1 | Aceptado: el adaptador no registra y delega; consumos en secuencia; "como mucho un aviso por racha" en la spec (D2) | Un solo responsable del aviso |
| critic 10 + business 4 y 5 | "Demasiados códigos incorrectos" culpa a quien comparte IP y no dice cuánto esperar | Aceptado: mensaje neutro con los minutos de `Retry-After`, con `RequestError`; en la iteración 2 pasó a reutilizar sus textos tal cual (D3) | Mensaje cierto en los dos casos y accionable |
| critic 11 | "Salir justo después de recibir la propiedad" no se podía provocar por HTTP de forma fiable | Aceptado: se verifica en el caso de uso con el doble (`now_owner` → `409`), tarea 3.2 | Determinista |
| critic 12 + business 10 | Las pruebas de concurrencia repetidas "varias veces" eran lentas e intermitentes | Adaptado: la 3.4 se queda, con N = 10 fijo y solo invariantes; las ramas, en pruebas deterministas (D1, D4) | Cubren lo que las deterministas no pueden: la base de datos real |
| critic 13 | Expulsar al elegido en plena transferencia no estaba en la spec | Aceptado: "Expulsar a un miembro" pasa a MODIFIED con "Expulsar a quien acaba de recibir la propiedad" → `403` | Comportamiento nuevo, requisito nuevo |
| critic 14 | No decía sobre qué miembros aparece "Nombrar propietario" | Aceptado: sobre cada miembro salvo el propio propietario (D3) | Evita el camino a `already_owner` |
| critic 15 | Un índice que no se construye pasa en silencio | Aceptado: esperar `GroupMember.init()` al arrancar y registrar `error` si falla (D1, tarea 2.6) | Visible sin tumbar la API |
| critic 16 | Citaba ADR-002 (que trata de `JobLink` y `Application`) y ADR-024, que no existe en esta rama | Aceptado: se cita la spec `groups/membership` y "el ADR de `applications-tracking`" | Referencias que existen donde se leen |
| critic 17 | La 3.3 mezclaba la respuesta y lo que se ve después | Aceptado: 3.3b con los escenarios de lectura posterior | Menos de una hora cada una |
| business 3 | "pasará a ser propietario" sonaba a algo que ocurre después | Aceptado: "tendrá el rol de propietario" (D3) | Efecto inmediato |
| business 7 | La sugerencia de transferir quedaba al final del diálogo de borrado | Aceptado: va al principio (D3) | Se lee antes de decidir |
| business 8 | — | Sin cambios | — |
| business 9 | Extraer el código de un mensaje pegado | Diferido: Non-Goals | Sin demanda medida |
| business 11 | Texto de UI para `already_owner` | Se mantiene el código, sin texto de UI (Non-Goals) | La UI no ofrece ese camino (critic 14) |
| business 12 | Faltaban los textos en inglés | Aceptado: tabla en D3 | Traducción revisable antes del apply |

## Debate (iteración 2, propio)

Convergió con 0 P0 y 0 V0.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| critic 1 | Con 10 cuentas (el tope de registros por IP de ADR-020) se pueden agotar los 100 intentos de una IP en cada ventana, sin fin | Aceptado como riesgo (Risks, ADR-025); RUNBOOK con cómo liberar la IP y localizar las cuentas (6.1 partida en 6.1 y 6.2); umbrales por variable de entorno como mejora futura | Coste real para el atacante y salida operativa inmediata |
| critic 2 | El `giveBack` tras un rechazo de IP deja una ventana de desfase | Aceptado: anotado en D2 y ADR-025 §6 (bloqueo transitorio, como mucho 1 intento por cambio de ventana) | Nunca deja pasar de más |
| critic 3 | No estaba escrito el coste en latencia; los `giveBack` no dependen entre sí | Aceptado: 4 idas y vueltas, hasta ~800 ms con Redis lento; `giveBack` con `Promise.all`, `consume` en secuencia (D2, 4.3–4.4) | Coste visible y el mínimo posible |
| critic 4 | Una `remoteAddress` por test no permite simular dos IPs en el mismo test | Aceptado: por petición, con un valor por defecto distinto en cada test (D4, 4.5a) | Escenarios con dos IPs |
| critic 5 + business 3 | Un texto nuevo para el `429` duplicaba lo que ya dice `RequestError` | Resuelto con lo existente: `@@error.tooManyAttempts` y `@@error.tooManyAttemptsLater`, sin claves nuevas (D3, spec `web/groups`, 5.3) | Mismo mensaje neutro que el login, ya traducido |
| critic 6 | El objetivo prometía no castigar a quien comparte IP, y agotar la IP bloquea a todos | Aceptado: objetivo reescrito con el riesgo explícito (Goals) | No prometer lo que no se cumple |
| business 5 | `trustProxy` figuraba como mejora | Aceptado: requisito de salida a producción de `deploy-prod` (Risks, ADR-025) | Sin él, el contador de IP es global |

## Decisiones de implementación

Decisiones que el diseño no fijaba, tomadas durante el apply de backend en la ventana autónoma con la opción más
conservadora y coherente con D1, D2 y ADR-025.

- **`transferOwnershipRequestSchema` no valida el formato de `userId`** (1.1): solo exige una cadena no vacía. Un id mal
  formado tiene que responder `404 member_not_found` (spec), no el `400 validation_error` del pipe.
- **La regla "el destino es otro miembro" es `isOtherMember(from, to)`** en `membership.ts` (1.2). Los repositorios
  también la aplican: `transferOwnership(g, a, a)` devuelve `target_not_member` sin escribir. Sin esa guarda, en Mongo el
  paso 1 degradaría al owner y el paso 2 lo volvería a promover, confirmando una transacción sin efecto.
- **`deleteGroup` distingue `not_found` de `not_owner` releyendo el grupo** dentro de la transacción cuando la membresía
  `owner` de quien pide no se pudo borrar (2.5). Así un segundo borrado del mismo owner sigue respondiendo `404`, como
  antes, y no `403`. Una membresía `owner` huérfana (sin grupo), que no debería existir, se suelta y responde
  `not_found`, igual que cualquier huérfana (D6).
- **La espera a `GroupMember.init()` no retiene `onModuleInit`** (2.6): corre en segundo plano y se expone como
  `GroupsModule.indexesReady` para las pruebas. Mongoose no construye índices hasta que la conexión se abre, y
  bloquear el arranque rompía el requisito ya vigente de arrancar sin MongoDB ni Redis (`startup-without-dependencies`,
  `health-live`). El `error` se registra igual en cuanto la construcción falla; si la app se apaga antes, no se
  registra nada. El motivo es el nombre, el código y el `codeName` del error (`MongoServerError 11000 DuplicateKey`), sin
  su mensaje, que lleva el `groupId` duplicado.
