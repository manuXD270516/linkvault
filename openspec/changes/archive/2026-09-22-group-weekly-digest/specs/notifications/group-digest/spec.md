## ADDED Requirements

### Requirement: Digest semanal por grupo

Con `FEATURE_GROUP_DIGEST=true`, el worker SHALL ejecutar un job semanal (cron configurable;
default lunes UTC) que procese la **semana ISO recién cerrada** (`weekKey` = W−1). Por cada
grupo, SHALL consultar `group_links` con `sharedAt` en `[start(W−1), start(W))`. Si hay al menos
un link, SHALL enviar un **email** a cada miembro con `emailVerified=true` y sin opt-out del tipo
`group_weekly_digest` (default habilitado). NO SHALL enviarse por web push. NO SHALL incluirse
`note` de la relación, `stageLabel`, notas de postulación ni historial. Si no hay links en la
ventana, NO SHALL enviarse email y NO SHALL registrarse entrega “vacía” en el ledger.

#### Scenario: Grupo con links nuevos en la semana cerrada

- **GIVEN** `FEATURE_GROUP_DIGEST=true`, el grupo "Backend" con 3 `group_links.sharedAt` en W−1,
  y Ana miembro verificada sin opt-out
- **WHEN** corre el job de la semana W (cron del lunes)
- **THEN** Ana SHALL recibir un email cuyo cuerpo menciona al menos un título de esos links
- **AND** el email SHALL identificar el grupo
- **AND** el email SHALL incluir un enlace a preferencias de notificación

#### Scenario: Grupo sin actividad en W−1

- **GIVEN** un grupo sin `group_links` con `sharedAt` en W−1
- **WHEN** corre el job
- **THEN** NO SHALL enviarse email de digest a sus miembros por ese grupo
- **AND** NO SHALL crearse entrega completed vacía en el ledger

#### Scenario: Opt-out

- **GIVEN** Luis con `group_weekly_digest` en opt-out y un grupo con links en W−1
- **WHEN** corre el job
- **THEN** NO SHALL enviarse digest a Luis para ese grupo

#### Scenario: Email no verificado

- **GIVEN** Carla con `emailVerified` false y preferencias por defecto
- **WHEN** corre el job para un grupo con actividad en W−1
- **THEN** NO SHALL enviarse digest email a Carla

#### Scenario: Feature apagada

- **GIVEN** `FEATURE_GROUP_DIGEST=false`
- **WHEN** llegaría el horario del cron
- **THEN** NO SHALL enviarse ningún digest

### Requirement: Idempotencia semanal

Cada entrega SHALL usar el ledger de notificaciones con
`type=group_weekly_digest`, `aggregateKey={weekKey}:{groupId}`, `userId`, `channel=email`.
Un re-proceso de la misma `weekKey` NO SHALL enviar un segundo email si la entrega ya está
completada. El job raíz SHALL ser single-flight (`jobId` `digest:week:{weekKey}` o equivalente).

#### Scenario: Re-run misma weekKey

- **GIVEN** Ana ya recibió el digest del grupo G para `weekKey` W−1
- **WHEN** el job de esa weekKey se vuelve a ejecutar
- **THEN** NO SHALL enviarse otro email a Ana para G en esa weekKey

### Requirement: Contenido acotado y seguro

El email SHALL listar como máximo **10** títulos ordenados por `sharedAt` descendente y, si hay
más, indicar cuántos quedan. SHALL incluir CTA al grupo y enlace a preferencias. NO SHALL
incluir el campo `note` de `group_links` ni inventar vacantes fuera de la ventana.

#### Scenario: Más de 10 links

- **GIVEN** 15 `group_links` en la ventana
- **WHEN** se renderiza el digest de Ana
- **THEN** el cuerpo SHALL mostrar como máximo 10 títulos
- **AND** SHALL indicar que hay más

#### Scenario: Sin nota de relación

- **GIVEN** un `group_link` con `note` no vacía
- **WHEN** se renderiza el digest
- **THEN** el cuerpo del email NO SHALL contener esa nota
