## 0. Antes de aplicar

Cada tarea cabe en menos de una hora y **empieza por su test**, que tiene que fallar en `main` (bed83af6) por el bug
antes de tocar código; el estado de la tarea anota el fallo rojo observado. Títulos de test en inglés, salidos de los
escenarios de `specs/`. Rutas de `apps/api` relativas a `apps/api/src/modules/auth/`.

- [ ] 0.1 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos. Verificar: `design.md` lleva la última
  ronda con «Convergencia: SI», P0 0 y V0 0; las decisiones nuevas del debate quedan en ADR-072.
- [ ] 0.2 [infra] Q1 y Q5 respondidas por el owner y aprobación humana registrada con fecha y cita literal en
  `design.md` (alcance: apply en la rama, **no** la fusión) y, para Q1, en ADR-072 §Estado. Falsación: si Q1 quedó en
  (c), el change se cierra sin aplicar y ADR-072 pasa a «Rechazado».
- [ ] 0.3 [infra] Coherencia del plan. Verificar: fila 42 de `docs/design-v0.2.md` §6 como **Candidata**;
  `grep -c "session-refresh-abort" openspec-changes.yaml` = 0; `docs/adr/ADR-072.md` existe y ADR-020 lleva la
  anotación de una línea; `openspec validate session-refresh-abort --strict --no-interactive`, `openspec validate --all
  --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en verde.

## 1. API (design D2–D7)

- [ ] 1.1 [backend] Política de dominio. **Primero el test** en `domain/refresh-session.spec.ts`: «reissues a token
  rotated 2 seconds ago whose successor was never used» (en `main` devuelve `conflict`: rojo esperado), «returns
  conflict for a token rotated 2 seconds ago whose successor was used», «returns conflict after 3 reissues», «keeps the
  window anchored to the first rotation» (rotado hace 9 s y reemitido hace 1 s: a los 10 s de la rotación es `reuse`),
  «treats a token rotated 10 seconds ago as reuse even if its successor was never used» y «never reissues a superseded
  token». Después: `RefreshTokenState` con `advanced` y `reissueCount`, `REFRESH_REISSUE_LIMIT = 3` y el resultado
  `reissue` (con `now` y `successorExpiresAt`) en `decide`. Verificar: `pnpm nx run api:test` del fichero en verde; el
  test viejo «returns conflict for a token rotated 2 seconds ago» pasa a declarar `advanced: true`. Falsación: con `<=`
  en lugar de `<` en el tope, «returns conflict after 3 reissues» falla; restaurar.
- [ ] 1.2 [backend] Depende de 1.1. Esquema y puerto. **Primero el test** en
  `infrastructure/mongo-session.repository.spec.ts`: «reads a legacy refresh token without the new fields as not
  advanced with zero reissues» (inserta un documento crudo sin `parentHash`, `advancedAt` ni `reissueCount`).
  Después: los tres campos opcionales en `RefreshTokenDocument` y `refreshTokenSchema`, índice `{ parentHash: 1 }`,
  `StoredRefreshToken` con los campos y `RotationResult` `rotated` con `reissued: boolean`. Verificar: `api:test` del
  fichero y `api:typecheck` en verde; «Refresh token no guardado en claro» sigue en verde.
- [ ] 1.3 [backend] Depende de 1.2. Reemisión en `MongoSessionRepository.rotate`. **Primero el test** en
  `infrastructure/mongo-session.repository.rotation.spec.ts` (replset del preset): «Respuesta de rotación perdida»
  (rota R1, descarta el sucesor, avanza 2 s, rota R1 otra vez: en `main` da `conflict`, rojo esperado; tras el arreglo
  `rotated` con `reissued: true`, un tercer token en la colección con `parentHash` = hash de R1, `rotatedAt` de R1 sin
  cambios y sesión no revocada), «Respuesta perdida fuera de la ventana» y «Tope de reemisiones». Después: rama
  `reissue` con `updateOne` condicionado sobre el token presentado (`advancedAt` nulo o ausente, `reissueCount` ausente
  o menor que el tope, `$inc`), recomprobación de la sesión e inserción del hermano; `advanced` calculado con
  `advancedAt` y, si falta, con el `rotatedAt` del token de `replacedByHash` (D5). Verificar: el fichero en verde.
  Falsación: sin la condición de `reissueCount` en el `updateOne`, «Tope de reemisiones» falla; restaurar.
- [ ] 1.4 [backend] Depende de 1.3. Supersesión de hermanos (D3). **Primero el test** en el mismo fichero: «El hermano
  usado deja superados a los demás» (R1→R2, reemisión R3, rota R3; R2 a +1 s da `conflict` y a +11 s `reused` con la
  sesión revocada) y «Refresh concurrente» actualizado (R2 ya rotado: R1 da `conflict`, R3 rota). Después: en la rama
  `rotate`, hijo nuevo con `parentHash`; si el token presentado tiene padre (por `parentHash` o, legacy, por
  `replacedByHash`), `$set: { advancedAt: now }` sobre el padre y `updateMany` de hermanos sin rotar a `rotatedAt` y
  `advancedAt` = `now`. Verificar: el fichero en verde y «returns conflict inside the window even after the successor
  was used» sin cambios. Falsación: sin el `updateMany`, R2 da `rotated` en vez de `conflict`; restaurar.
- [ ] 1.5 [backend] Depende de 1.4. Padres legacy (D5). **Primero el test**: «does not reissue a legacy parent whose
  successor was already used» (padre y primer hijo insertados crudos sin campos nuevos, el hijo con `rotatedAt`; el
  padre a +2 s da `conflict`, no `rotated`) y «marks a legacy parent as advanced when its child rotates» (hijo sin
  `parentHash`; tras rotarlo, el padre tiene `advancedAt`). Verificar: en verde. Falsación: sin el fallback por
  `replacedByHash`, el primero da `rotated`; restaurar.
- [ ] 1.6 [backend] Depende de 1.4. Concurrencia (R2). **Primero el test**: «Tres refresh concurrentes con el mismo
  token» actualizado (tres `rotated`, tres hijos distintos, sesión no revocada; luego se rota uno y los otros dos dan
  `conflict`) y «Reemisión y uso de un hermano a la vez» repetido 20 veces con `Promise.all` (R1 a +2 s y R2 a la vez:
  R2 `rotated`; al terminar, solo el hijo de R2 da `rotated` en un refresh posterior; R1 y su hermano, si lo hubo, dan
  `conflict`). Verificar: en verde 3 corridas seguidas. Falsación: quitar el `$set` sobre el padre en la rama `rotate`
  hace fallar al menos una de las 20 iteraciones de la segunda; restaurar.
- [ ] 1.7 [backend] Depende de 1.2. Doble en memoria y caso de uso (D7). **Primero el test** en
  `application/refresh-session.usecase.spec.ts`: «Respuesta de rotación perdida» (rota, descarta, avanza 2 s, vuelve
  a refrescar con el token viejo: en `main` lanza `RefreshConflict`, rojo esperado) y «reports a reissue with userId
  and sessionId and without any token». Después: `InMemorySessionRepository.rotate` en `auth-test-doubles.ts` con las
  mismas reglas que Mongo (reemisión, supersesión, tope), `AuthSecurityLog.refreshTokenReissued`, su adaptador
  `nest-auth-security-log.ts` con nivel `info` (test en `nest-auth-security-log.spec.ts`: «logs a reissue at info
  level with ids only») y la llamada en `RefreshSession`. Verificar: los ficheros en verde. Falsación: si el aviso
  incluyera el token, el test de «without any token» falla.
- [ ] 1.8 [backend] Depende de 1.4 y 1.7. HTTP web. **Primero el test** en `presentation/auth.controller.refresh.spec.ts`
  (app completa, Mongo del preset): «Respuesta de rotación perdida» (registro → refresh con R1 → se ignora el
  `Set-Cookie` → reloj +2 s → refresh con R1 da `200` con `Set-Cookie` R3 ≠ R1, R2; en `main`, `409`), «Respuesta
  perdida fuera de la ventana» (+11 s: `401`, cookie borrada) y «Tres refresh concurrentes con el mismo token» y
  «Refresh concurrente» actualizados a los escenarios nuevos. Verificar: el fichero en verde; actualizar el comentario
  de `auth.controller.ts:111-114` para que no afirme que un `409` implica una cookie ya fijada.
- [ ] 1.9 [backend] Depende de 1.4. HTTP extensión. **Primero el test** en `presentation/extension-auth.controller.spec.ts`:
  «Respuesta perdida en la extensión» (en `main`, `409`) y «Rotación por cuerpo» actualizado (R1 rechazado una vez usado
  R2); ninguna respuesta lleva `Set-Cookie` de `lv_refresh`. Verificar: en verde.
- [ ] 1.10 [backend] Cierre de la API. Verificar: `pnpm nx affected -t lint,typecheck,test` en verde; `grep -rn
  "refreshToken\|tokenHash" apps/api/src/modules/auth/infrastructure/nest-auth-security-log.ts` no muestra campos nuevos
  en el aviso.

## 2. Regresión de navegador (design D8)

- [ ] 2.1 [frontend] **Primero el test** `apps/web-e2e/src/auth-refresh-abort.spec.ts`: «reload while the restore
  refresh is in flight keeps the session». Registra una cuenta, abre `/perfil`, instala `page.route` sobre
  `**/api/auth/refresh` que hace `route.fetch()` (la API rota) y retiene la respuesta tras una compuerta (promesa),
  recarga para disparar la restauración, espera a que `route.fetch()` resuelva, quita la ruta y vuelve a recargar sin
  abrir la compuerta (el navegador aborta la petición retenida, como en la guía); espera `/perfil` sin pasar por
  `/login` y exige 0 peticiones a `/api/auth/logout`. Sin `waitForTimeout`. En `main` (antes de 1.x) termina en `/login`: rojo
  esperado, anotado. Verificar: verde con la API de 1.x sobre la pila e2e (`pnpm nx run web-e2e:e2e-stack` filtrando por
  el título) y `pnpm nx run web-e2e:typecheck`. Falsación: con la reemisión desactivada (forzar `REFRESH_REISSUE_LIMIT = 0`
  en local, sin commitear) vuelve a terminar en `/login`; restaurar.

## 3. Cierre

- [ ] 3.1 [infra] Anotar en ADR-072 §Estado el PR y la fecha de fusión; actualizar la fila 42 de `docs/design-v0.2.md`
  §6 a «archivado» al archivar. Verificar: `openspec validate --all --strict --no-interactive` y `bash
  infra/ci/repo-checks.sh` en verde tras `/opsx:archive`.
