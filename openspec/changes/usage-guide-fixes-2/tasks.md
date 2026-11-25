## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. En las de código, el test que reproduce el defecto se escribe **primero** y se
ve caer sobre el código sin arreglar; la salida de ese fallo se anota en el «Estado» de la tarea.

- [ ] 0.1 [infra] Q1 respondida por el owner y anotada con fecha en `design.md` y en una línea de `docs/adr/ADR-055.md`
  §1 que empieza por «Respuesta del owner (Q1 de usage-guide-fixes-2), AAAA-MM-DD:». Con la respuesta, fila **40** en
  `docs/design-v0.2.md` §6 para `usage-guide-fixes-2` (Q2; fuera de `openspec-changes.yaml` salvo que el owner diga lo
  contrario). Si Q1 = (b), el change no pasa de aquí hasta archivar la 35c; si Q1 = (c), se aplican solo los grupos 1,
  4 y la parte de M01 del grupo 5. Verificar: `grep -c "Respuesta del owner (Q1 de usage-guide-fixes-2), 20" docs/adr/ADR-055.md`
  devuelve `1` (antes de anotarla devuelve `0`), y `grep -n "usage-guide-fixes-2" docs/design-v0.2.md` muestra la fila.
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. Verificar:
  `design.md` lleva la sección del debate de la última iteración con «Convergencia: SI» y la fecha de la aprobación.

## 1. H1 — el diálogo de encaje llega a «Necesitas un CV guardado» (design D1, D2)

- [ ] 1.1 [frontend] **Rechazos por código (D1).** Primero, en `apps/web/src/app/features/match/match.dialog.spec.ts`,
  cambiar a `409` los `apiError('job_not_ready' | 'no_cv' | 'cv_not_ready' | 'cv_not_readable', 422)` de los casos
  existentes («Sin CV», «El CV se está leyendo», «El CV no se pudo leer» y el de `job_not_ready`) y añadir «Lo que
  manda es el código» (`no_cv` con `422`) y «Un fallo nuestro sigue siendo un fallo nuestro» (`500` → `match-server-error`).
  Correrlos sobre el código sin arreglar y anotar cuáles caen (se esperan los cuatro de `409`: hoy muestran «No pudimos
  analizar ahora.»). Después, `hasApiCode(failure, code)` en `apps/web/src/app/core/api/api-error.ts` y `matchProblem`
  usándolo para los cuatro códigos; `isApiFailure` no cambia. Casos en `core/api/api-error.spec.ts` (nuevo): «hasApiCode
  matches by code whatever the status» y «hasApiCode is false for offline and unknown failures». Verificar:
  `pnpm nx run web:test --include="**/match.dialog.spec.ts" --skip-nx-cache` y el mismo con `**/api-error.spec.ts`, en
  verde. Falsación: volver a `isApiFailure(failure, 422, 'no_cv')` en `matchProblem` y ver caer el caso `no_cv` con
  `409`; restaurar.
- [ ] 1.2 [frontend] **Sin CV desde que se abre (D2).** Primero, en `match.dialog.spec.ts`, los casos «Sin CV al
  abrir: estado no_cv sin Analizar» (`flushOpen` con la lista de CV vacía: `match-no-cv` y `match-upload-cv` visibles,
  ningún `match-analyze`, `http.expectNone({ method: 'POST', url: MATCH_URL })`), «Sin CV gana al permiso desconocido»
  (perfil sin cargar o con `consentLoadStatus` `failed`: se ve `match-no-cv` y no `match-consent-unknown`), «Subir mi CV
  lleva a /mi-cv y cierra con change-cv» desde ese estado, y «La API dice que no hay CV» (el `GET` de la lista de CV
  responde `500`, «Analizar» sigue disponible y un `409 no_cv` lleva a `match-no-cv`). Verlos caer sobre el código de
  1.1 (los tres primeros) y anotarlo. Después, en `match.dialog.ts`, la condición `cvs.loaded() && cvs.items().length === 0`
  al principio de `phase` devuelve `'no_cv'`. Verificar: el spec del diálogo entero en verde. Falsación: quitar esa
  condición y ver caer «Sin CV al abrir: estado no_cv sin Analizar» y «Sin CV gana al permiso desconocido»; moverla
  detrás de las fases del permiso y ver caer solo la segunda; restaurar.

## 2. H2 — verificar el email quita el aviso sin recargar (design D3)

- [ ] 2.1 [frontend] **Esperar a la restauración.** Primero, en `apps/web/src/app/features/auth/verify-email.page.spec.ts`,
  el caso «La verificación responde antes que la restauración de la sesión»: store sin `clear()` (estado `unknown`) y
  `SessionRestore` sustituido por uno con promesa controlable; responde el `POST /api/auth/verify-email`, después se
  resuelve la restauración con `setSession` de un perfil con `emailVerified` `false`; se espera un `GET /api/users/me`
  **posterior** a la restauración, que responde `emailVerified` `true`, y al final `store.needsEmailVerification()` es
  `false` y se ve «Ir a la aplicación». Añadir «Sin sesión tras la restauración: ir a iniciar sesión y sin pedir el
  perfil» (la restauración termina en `anonymous`; `http.expectNone` del perfil). Verlo caer sobre el código actual
  (no hay `GET` del perfil) y anotarlo. Después, `verify()` espera `Promise.all` del `POST` y de
  `inject(SessionRestore).restore()` antes de mirar `isAuthenticated()`. Verificar: `pnpm nx run web:test
  --include="**/verify-email.page.spec.ts" --skip-nx-cache` en verde, con los casos existentes intactos. Falsación:
  quitar `restore()` del `Promise.all` y ver caer el caso nuevo; restaurar.
- [ ] 2.2 [frontend] **El perfil falla después de verificar.** Primero, el caso «El perfil falla después de verificar»
  en el mismo spec: con sesión, `POST` con éxito y `GET /api/users/me` con `500`; se espera «Email verificado»,
  `store.user()?.emailVerified === true`, `store.needsEmailVerification()` en `false` y ningún `[role="alert"]`. Verlo
  caer (hoy pasa a la fase `error`) y anotarlo. Después, el fallo de `getProfile` se captura aparte y hace
  `session.setUser({ ...user, emailVerified: true })`; el `catch` de la verificación no cambia. Verificar: el spec
  entero en verde, incluidos «Enlace inválido» y el de error genérico de la verificación. Falsación: dejar que el fallo
  del perfil llegue al `catch` común y ver caer el caso nuevo; restaurar.

## 3. H3 — los avisos de la contraseña no se superponen (design D4)

- [ ] 3.1 [frontend] **Cada intento borra el anterior.** Primero, en `apps/web/src/app/features/profile/profile.page.spec.ts`,
  «a client-invalid attempt clears the previous API error» (`401 invalid_credentials` → se ve «La contraseña actual no
  es correcta»; luego nueva `corta` y enviar: ese texto ya no está, se ve el error de longitud y
  `http.expectNone` de `POST /api/auth/password`), «a new attempt clears the previous success» (tras «Contraseña
  cambiada…», enviar con la actual vacía: el éxito ya no está) y «editing a field does not clear the API error». Ver
  caer los dos primeros y anotarlo. Después, en `changePassword()`, `passwordFailure.set(null)` y
  `passwordChanged.set(false)` antes de la comprobación de validez. Verificar: `pnpm nx run web:test
  --include="**/profile.page.spec.ts" --skip-nx-cache` en verde. Falsación: devolver los dos `set` a después del
  `return` del formulario inválido y ver caer los dos primeros; restaurar.
- [ ] 3.2 [frontend] **Subíndice dinámico.** Primero, en el mismo spec, con `MatFormFieldModule` e `MatInputModule`
  reales, «both password fields use a dynamic subscript»: el subíndice de los dos `mat-form-field` de contraseña lleva
  `mat-mdc-form-field-subscript-dynamic-size` (sustituto aceptado de la geometría, como en `usage-guide-fixes` D10).
  Verlo caer y anotarlo. Después, `subscriptSizing="dynamic"` en los dos `mat-form-field` de contraseña de
  `profile.page.html`. Verificar: el spec entero en verde. Falsación: quitar el atributo de «Nueva contraseña» y ver
  caer el caso; restaurar.

## 4. Catálogo y comprobación global

- [ ] 4.1 [frontend] `pnpm nx run web:extract-i18n` (las plantillas tocadas mueven números de línea; ningún texto cambia)
  y commit de `apps/web/src/locale/messages.xlf` tal como sale; `messages.en.xlf` no se toca (ADR-050). Verificar:
  `git diff --stat apps/web/src/locale/messages.en.xlf` vacío, `git diff apps/web/src/locale/messages.xlf` solo cambia
  `linenumber`, y `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde.

## 5. Guía de uso (design D6)

- [ ] 5.1 [frontend] `tools/guia-de-uso/capture.mts`: en M01, el diálogo de Beto debe abrir ya con `match-no-cv`, sin
  `match-analyze` (una sola captura `encaje-sin-cv`; desaparece `encaje-sin-cv-analizar` y el `throw` del hallazgo); en
  F03, tras el intento con la nueva `corta`, `expect(page.getByText('La contraseña actual no es correcta')).toHaveCount(0)`.
  `meta.mts`: «Esperado» y «Prueba automatizada» de M01 y F03 con los casos nuevos de 1.2 y 3.1; V03 con el de 2.1.
  Verificar: `pnpm exec tsc --noEmit --strict --skipLibCheck --module nodenext --moduleResolution nodenext --target
  es2022 tools/guia-de-uso/capture.mts` sin errores nuevos respecto de `main` (el directorio no tiene `tsconfig`
  propio); y
  `grep -n "encaje-sin-cv-analizar" tools/guia-de-uso/capture.mts` sin resultados.
- [ ] 5.2 [frontend] `tools/guia-de-uso/build-guide.mts` y, a mano y con el mismo texto, `docs/guia-de-uso/README.md`:
  H1, H2 y H3 salen de «Hallazgos» y pasan a una línea «Corregido por `usage-guide-fixes-2`, pendiente de comprobar en
  la próxima pasada: M01, V03 y F03»; la fila de M01 de la tabla y su ficha dicen «Corregido (pendiente de pasada)» en
  vez de **FALLO**, sin cambiar lo «Visto» de la corrida del 2026-11-25; el resumen lo dice. Si la Q3 se responde
  «repetir ahora», esta tarea se sustituye por la corrida completa del README de `tools/guia-de-uso/` y su
  `build-guide.mts`. Verificar: `grep -n "H1\.\|H2\.\|H3\." docs/guia-de-uso/README.md` ya no los lista bajo
  «Hallazgos»; `grep -c "usage-guide-fixes-2" docs/guia-de-uso/README.md tools/guia-de-uso/build-guide.mts` es mayor
  que `0` en los dos; `pnpm exec prettier --check docs/guia-de-uso tools/guia-de-uso` en verde.
