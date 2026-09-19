## Why

`groups` dejó dos deudas que `job-links` volvió más caras y que, por decisión humana del 2026-09-19 tras el debate de
`applications-tracking`, se entregan en un change propio **antes** de ese:

- **El owner de un grupo no puede irse sin destruirlo.** No puede salir ni ser expulsado, y su única salida es borrar el
  grupo, que se lleva las ofertas que los demás compartieron allí: quien solo las guardó en ese grupo las pierde, porque
  compartir no crea entrada privada (ADR-021 §5). Quien creó el grupo para su curso o su oficina queda atado a él para
  siempre, o lo borra y se lo quita a todos.
- **`POST /api/groups/join` no cuenta los intentos fallidos.** Desde `job-links` el código de invitación da acceso a
  ofertas que compartieron terceros, y con `applications-tracking` dará acceso también a los estados que cada quien
  decida compartir. El manifiesto exige ese límite desde `groups`, y ya no hay motivo para seguir aplazándolo.

## What Changes

- **Transferir la propiedad de un grupo**: el owner nombra propietario a otro miembro y pasa a ser `member`, en una sola
  escritura atómica que mantiene la membresía `owner` única, garantizada además por un índice único parcial con nombre
  propio; después puede salir como cualquiera. Borrar, salir y expulsar pasan a condicionar su escritura al rol, para
  que ninguna carrera con una transferencia deje un grupo sin propietario o borre uno que ya cambió de manos.
- **Límite de intentos al unirse con un código**: los códigos incorrectos se cuentan por usuario (10) y por IP (100) en
  ventanas de 15 minutos, con el mismo contador por ventana fija que `auth` (Redis); primero el del usuario, de modo que
  quien ya está bloqueado no gasta los intentos de su IP. Al superarse responden `429 too_many_attempts` con
  `Retry-After`. Un código válido no gasta intentos ni pone el contador a cero.
- **Frontend**: "Nombrar propietario" sobre cada miembro, textos del propietario que explican cómo salir, la
  confirmación de borrado que empieza sugiriendo transferir, y un mensaje del `429` que dice cuántos minutos esperar.
  En español siempre "propietario"; en inglés, "owner".

## Capabilities

### New Capabilities
Ninguna.

### Modified Capabilities
- `groups/membership`: nuevos requisitos "Transferir la propiedad" y "Límite de intentos al unirse"; "Salir de un
  grupo" gana el escenario del antiguo propietario que sale tras transferir, y "Expulsar a un miembro", el de quien
  acaba de recibir la propiedad.
- `groups/group-management`: "Borrado por el owner" comprueba el rol en la misma escritura que borra, con un escenario
  de carrera contra la transferencia.
- `web/groups`: el detalle ofrece "Nombrar propietario" y explica al propietario cómo salir; la confirmación de borrado
  sugiere transferir; unirse explica el `429`.

## Impact

- **Código**: `apps/api/src/modules/groups/` (caso de uso de transferencia, índice parcial `one_owner_per_group`,
  escrituras condicionadas por rol, límite del join y el error `TooManyJoinAttempts`);
  `apps/api/src/presentation/http/api-exception.filter.ts` (rama del `429` con `Retry-After`);
  `apps/api/src/infrastructure/limits/` (la agrupación de IP deja de ser privada de `auth`); `libs/shared/src/`
  (`transferOwnershipRequestSchema` y el código `already_owner`); `apps/web/src/app/features/groups/`.
- **API**: `POST /api/groups/:id/owner`; `POST /api/groups/join` puede responder `429`; `DELETE /api/groups/:id` y
  `DELETE /api/groups/:id/members/:userId` pueden responder `403` si quien pide dejó de ser propietario mientras tanto.
- **Datos**: índice único parcial `one_owner_per_group` en `group_members`. Claves nuevas de Redis
  `groups:join:user:*` y `groups:join:ip:*`. Nada pasa por el outbox.
- **Specs y ADRs**: completa los roles de la spec `groups/membership` (un único owner por grupo, que ahora puede
  cambiar de manos); respeta ADR-020 §5–6 (límite que falla abierto, sin cruzar módulos) y ADR-021 §6 (el borrado sigue
  ejecutando sus hooks en la misma transacción). Las decisiones no triviales están en **ADR-025**.
- **Arranque**: `api` espera a que se construyan los índices de `group_members` y registra un `error` si el índice
  parcial no se puede crear.
- **Fuera de alcance**: transferir y salir en un solo gesto, promoción automática al salir el propietario,
  invitaciones nominales, extraer el código de un mensaje de invitación pegado entero, y todo lo de postulaciones
  (`applications-tracking`, que se entrega después).
