## 0. Antes de aplicar

Cada tarea cabe en menos de una hora y **empieza por su test**, que tiene que fallar en `main` (bed83af6) por el bug
antes de tocar código; el estado de la tarea anota el fallo rojo observado. Títulos de test en inglés, salidos de los
escenarios de `specs/`. Rutas de `apps/api` relativas a `apps/api/src/modules/auth/` y de `apps/web` relativas a
`apps/web/src/app/core/auth/`. La ronda 1 del debate eliminó la tarea de respaldo legacy (H2) y partió la de
concurrencia (H3).

- [x] 0.1 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos. Verificar: `design.md` lleva «Debate (ronda
  1)» y «Convergencia: SI», P0 0 y V0 0; las decisiones nuevas están en ADR-072.
  Estado (2026-11-25): ronda 1 con 0 P0 y 1 V0 (B1) aceptado; «Convergencia: SI (2026-11-25, ronda 1: 0 P0 / 0 V0)».
- [ ] 0.2 [infra] Q1 y Q5 respondidas por el owner y aprobación humana registrada con fecha y cita literal en
  `design.md` («Aprobación humana») y, para Q1, en ADR-072 §Estado. El alcance aprobado tiene que decir si incluye
  **aplicar y fusionar antes de la primera invitación de 35b** (Q5) y en qué ventana de fusión; nunca altera la
  precedencia 35a→35b→35c. Falsación: si Q1 quedó en (c), el change se cierra sin aplicar y ADR-072 pasa a «Rechazado»;
  si Q5 quedó en (b), la fusión espera a 35c y la fila 42 lo dice.
- [ ] 0.3 [infra] Coherencia del plan. Verificar: fila 42 de `docs/design-v0.2.md` §6 como **Candidata**;
  `grep -c "session-refresh-abort" openspec-changes.yaml` = 0; `docs/adr/ADR-072.md` existe y ADR-020 lleva la
  anotación de una línea; `openspec validate session-refresh-abort --strict --no-interactive`, `openspec validate --all
  --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en verde.

## 1. API (design D2–D7)

- [ ] 1.1 [backend] Política de dominio. **Primero el test** en `domain/refresh-session.spec.ts`: «reissues a token
  rotated 2 seconds ago whose successor was never used» (en `main` devuelve `conflict`: rojo esperado), «returns
  conflict for a token rotated 2 seconds ago whose successor was used», «returns conflict after 3 reissues», «returns
  conflict for a token rotated before reissue existed» (`reissueCount` nulo), «keeps the window anchored to the first
  rotation» (rotado hace 9 s y reemitido hace 1 s: a los 10 s de la rotación es `reuse`), «treats a token rotated 10
  seconds ago as reuse even if its successor was never used» y «never reissues a superseded token». Después:
  `RefreshTokenState` con `advanced` y `reissueCount: number | null`, `REFRESH_REISSUE_LIMIT = 3` y el resultado
  `reissue` (con `now` y `successorExpiresAt`) en `decide`. Verificar: `pnpm nx run api:test` del fichero en verde; el
  test viejo «returns conflict for a token rotated 2 seconds ago» pasa a declarar `advanced: true`. Falsación: con `<=`
  en lugar de `<` en el tope, «returns conflict after 3 reissues» falla; restaurar.
- [ ] 1.2 [backend] Depende de 1.1. Esquema y puerto. **Primero el test** en
  `infrastructure/mongo-session.repository.spec.ts`: «reads a legacy refresh token without the new fields as not
  advanced with a null reissue count» (documento crudo sin `parentHash`, `advancedAt` ni `reissueCount`) y «a new
  rotation stores reissueCount 0 on the rotated token». Después: los tres campos opcionales en `RefreshTokenDocument` y
  `refreshTokenSchema` sin `default` para `reissueCount` (que el campo falte tiene que distinguirse de 0), índice
  `{ parentHash: 1 }`, `StoredRefreshToken` con los campos y `RotationResult` `rotated` con `reissued` y
  `reissueCount`. Verificar: `api:test` del fichero y `api:typecheck` en verde; «Refresh token no guardado en claro»
  sigue en verde. Falsación: con `default: 0` en el esquema, el primer test falla; restaurar.
- [ ] 1.3 [backend] Depende de 1.2. Reemisión en `MongoSessionRepository.rotate`. **Primero el test** en
  `infrastructure/mongo-session.repository.rotation.spec.ts` (replset del preset): «Respuesta de rotación perdida»
  (rota R1, descarta el sucesor, avanza 2 s, rota R1 otra vez: en `main` da `conflict`, rojo esperado; tras el arreglo
  `rotated` con `reissued: true`, un tercer token con `parentHash` = hash de R1, `rotatedAt` de R1 sin cambios y sesión
  no revocada), «Respuesta perdida fuera de la ventana», «Tope de reemisiones» y «Token rotado antes de la reemisión»
  (R1 rotado y luego `$unset` de `reissueCount`: `conflict`). Después: la rama `rotate` escribe `reissueCount: 0` en el
  token rotado y `parentHash` en el hijo; la rama `reissue` hace el `updateOne` condicionado de D3 (`advancedAt` nulo,
  `reissueCount` existente y menor que el tope, `$inc`), recomprueba la sesión e inserta el hermano. Verificar: el
  fichero en verde. Falsación: sin `$exists: true` en el filtro, «Token rotado antes de la reemisión» da `rotated`;
  restaurar.
- [ ] 1.4 [backend] Depende de 1.3. Supersesión de hermanos (D3). **Primero el test** en el mismo fichero: «El hermano
  usado deja superados a los demás» (R1→R2, reemisión R3, rota R3; R2 a +1 s da `conflict` y a +11 s `reused` con la
  sesión revocada) y «Refresh concurrente» actualizado (R2 ya rotado: R1 da `conflict`, R3 rota). Después: en la rama
  `rotate`, si el token presentado tiene `parentHash`, `$set: { advancedAt: now }` sobre el padre y `updateMany` de
  hermanos sin rotar a `rotatedAt` y `advancedAt` = `now`. Verificar: el fichero en verde y «returns conflict inside the
  window even after the successor was used» sin cambios. Falsación: sin el `updateMany`, R2 da `rotated` en vez de
  `conflict`; restaurar.
- [ ] 1.5 [backend] Depende de 1.4. Invariante de D3, orden «reemisión confirma primero» (H3). Punto de pausa inyectable
  **solo para tests** en `MongoSessionRepository` (parámetro opcional del constructor, por ejemplo
  `rotationProbe?: { afterRead(kind: 'rotate' | 'reissue'): Promise<void> }`, ausente en `auth.module.ts`). **Primero
  el test** «reissue commits first, then a sibling rotation supersedes the new sibling»: R1→R2 (sin usar), arranca la
  rotación de R2 y la pausa tras la lectura; con ella pausada corre y confirma la reemisión de R1 (R3); suelta la pausa.
  Exige: R2 `rotated`, R3 superado (`conflict` a +1 s) y una sola hoja utilizable (el hijo de R2). Verificar: en verde 3
  corridas seguidas; `grep -n "rotationProbe" apps/api/src/modules/auth/presentation/auth.module.ts` sin resultados.
  Falsación: quitar el `$set` sobre el padre hace que R3 quede utilizable; restaurar.
- [ ] 1.6 [backend] Depende de 1.5. Orden inverso y carrera complementaria. **Primero los tests**: «sibling rotation
  commits first, then the reissue gets conflict» (pausa la reemisión de R1 tras la lectura, confirma la rotación de R2,
  suelta: R1 `conflict`, sin hermano nuevo), «Tres refresh concurrentes con el mismo token» actualizado (tres
  `rotated`, tres hijos distintos, sesión no revocada; tras rotar uno, los otros dos dan `conflict`) y «Reemisión y uso
  de un hermano a la vez» repetido 20 veces con `Promise.all` como complemento. Verificar: en verde 3 corridas seguidas.
  Falsación: quitar `advancedAt: null` del filtro de la reemisión hace fallar el primero; restaurar.
- [ ] 1.7 [backend] Depende de 1.2. Doble en memoria, caso de uso y aviso (D7, H7). **Primero el test** en
  `application/refresh-session.usecase.spec.ts`: «Respuesta de rotación perdida» (rota, descarta, avanza 2 s, vuelve
  a refrescar con el token viejo: en `main` lanza `RefreshConflict`, rojo esperado) y «reports a reissue with userId,
  sessionId and reissueCount and without any token». Después: `InMemorySessionRepository.rotate` en
  `auth-test-doubles.ts` con las mismas reglas que Mongo (reemisión, supersesión, tope, contador ausente),
  `AuthSecurityLog.refreshTokenReissued`, `SecurityLogWriter.log`, el adaptador `nest-auth-security-log.ts` (`log` con
  `reissueCount` 1, `warn` desde 2) y la llamada en `RefreshSession`. Tests en `nest-auth-security-log.spec.ts`: «logs
  the first reissue at info level with ids only» y «warns from the second reissue». Comprobar que `info` llega a los logs
  de producción: test con `buildLoggerParams({ LOG_LEVEL: 'info' }, destino)` que captura la línea del contexto
  `AuthSecurity`, y `grep -n "LOG_LEVEL" docker-compose.prod.yml` muestra `info` por defecto. Falsación: si el aviso
  incluyera el token, «with ids only» falla; con `LOG_LEVEL: 'warn'` la línea de `info` no aparece (prueba de que el test
  mira el nivel).
- [ ] 1.8 [backend] Depende de 1.4 y 1.7. HTTP web. **Primero el test** en `presentation/auth.controller.refresh.spec.ts`
  (app completa, Mongo del preset): «Respuesta de rotación perdida» (registro → refresh con R1 → se ignora el
  `Set-Cookie` → reloj +2 s → refresh con R1 da `200` con `Set-Cookie` R3 ≠ R1, R2; en `main`, `409`), «Respuesta
  perdida fuera de la ventana» (+11 s: `401`, cookie borrada) y «Tres refresh concurrentes con el mismo token» y
  «Refresh concurrente» actualizados a los escenarios nuevos. Verificar: el fichero en verde; actualizar el comentario
  de `auth.controller.ts:111-114` para que no afirme que un `409` implica una cookie ya fijada.
- [ ] 1.9 [backend] Depende de 1.4. HTTP extensión. **Primero el test** en `presentation/extension-auth.controller.spec.ts`:
  «Respuesta perdida en la extensión» (en `main`, `409`) y «Rotación por cuerpo» actualizado (R1 rechazado una vez usado
  R2); ninguna respuesta lleva `Set-Cookie` de `lv_refresh`. Verificar: en verde.
- [ ] 1.10 [backend] Cierre de la API. Verificar: `pnpm nx affected -t lint,typecheck,test` en verde; el aviso de
  `nest-auth-security-log.ts` no interpola nada más que `userId`, `sessionId` y `reissueCount`.

## 2. SPA: restauración sin autoaborto (design D9)

- [ ] 2.1 [frontend] Petición desprendida. **Primero el test** en `session-restore.spec.ts` (nuevo, con
  `HttpTestingController` y temporizadores falsos): «keeps the restore request alive when the timeout fires» (al avanzar
  10 s, la restauración resuelve con la sesión `anonymous` y `testRequest.cancelled` es `false`; en `main` es `true`:
  rojo esperado) y «ignores a late 200 from a timed-out restore» (la respuesta a los 12 s no cambia el estado de la
  sesión, no reintenta ni llama a logout). Después: opción `detachOnAbort` en `AuthApi.refresh`: el aborto cancela la
  espera del lock y los reintentos pero no la petición enviada, y una respuesta posterior al aborto no llama a
  `setSession`; `SessionRestore` la usa. Verificar: `pnpm nx run web:test --include="**/session-restore.spec.ts"
  --skip-nx-cache` en verde y los tests de abort de `auth.api.refresh.spec.ts` siguen en verde (sin la opción, el
  comportamiento no cambia). Falsación: volver a pasar el `signal` a la petición hace fallar el primero; restaurar.
- [ ] 2.2 [frontend] Depende de 2.1. Login, registro y refresh esperan a la desprendida. **Primero el test** en
  `auth.api.spec.ts`: «Login tras una restauración agotada» (con una petición desprendida en vuelo, el `POST
  /api/auth/login` no sale hasta que esa responde), «cancels the detached restore request after 5 seconds before
  logging in» y lo mismo para registro y para un refresh nuevo. Verificar: en verde con `--skip-nx-cache`; `pnpm nx
  affected -t lint,typecheck,test,i18n-check` en verde (sin textos nuevos). Falsación: sin la espera, el login sale
  antes que la respuesta desprendida y el primer test falla; restaurar.

## 3. Regresión de navegador (design D8)

- [ ] 3.1 [frontend] **Primero el test** `apps/web-e2e/src/auth-refresh-abort.spec.ts`: «reload while the restore
  refresh is in flight keeps the session». Registra una cuenta, abre `/perfil`, instala `page.route` sobre
  `**/api/auth/refresh` que hace `route.fetch()` (la API rota) y retiene la respuesta tras una compuerta (promesa),
  recarga para disparar la restauración, espera a que `route.fetch()` resuelva, quita la ruta y vuelve a recargar sin
  abrir la compuerta (el navegador aborta la petición retenida, como en la guía); espera `/perfil` sin pasar por
  `/login` y exige 0 peticiones a `/api/auth/logout`. Sin `waitForTimeout`. En `main` (antes de 1.x) termina en `/login`:
  rojo esperado, anotado. Verificar: verde con la API de 1.x sobre la pila e2e (`pnpm nx run web-e2e:e2e-stack` filtrando
  por el título) y `pnpm nx run web-e2e:typecheck`. Falsación: con la reemisión desactivada (forzar
  `REFRESH_REISSUE_LIMIT = 0` en local, sin commitear) vuelve a terminar en `/login`; restaurar.

## 4. Medición en staging (diferida a 35b, design D7 y R4)

- [ ] 4.1 [infra] **Diferida a la ventana de medición de 35b; no se cierra en este PR ni edita el change
  `staging-host`.** Plan de medición, escrito antes de invitar: contar por persona (`userId` distinto) los avisos
  `refreshTokenReissued` y `refreshTokenReused` de los logs de staging durante 14 días, **excluyendo las cuentas E2E y
  de la guía**, sin copiar tokens ni otros datos. Umbral: si hay `refreshTokenReused` en **2 o más personas** distintas
  en 14 días, se reabre Q2. Verificar: el informe del día 14 de 35b trae la tabla (persona anonimizada, reemisiones,
  reusos) y la decisión sobre Q2; si la tarea no se pudo hacer, la fila 42 lo dice con su motivo.

## 5. Cierre

- [ ] 5.1 [infra] Anotar en ADR-072 §Estado el PR y la fecha de fusión; actualizar la fila 42 de `docs/design-v0.2.md`
  §6 a «archivado» al archivar, dejando la 4.1 explícita como diferida a 35b. Verificar: `openspec validate --all
  --strict --no-interactive` y `bash infra/ci/repo-checks.sh` en verde tras `/opsx:archive`.
