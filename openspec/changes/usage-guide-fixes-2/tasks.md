## 0. Antes de aplicar

Cada tarea cabe en menos de una hora. En las de código, el test que reproduce el defecto se escribe **primero** y se
ve caer sobre el código sin arreglar; la salida de ese fallo se anota en el «Estado» de la tarea. Si el apply se
atrasa, el grupo 3 (H3) es el primer recorte (PO-4).

- [x] 0.1 [infra] Q1 respondida por el owner y anotada con fecha en `design.md` y en una línea de `docs/adr/ADR-055.md`
  §1 que empieza por «Respuesta del owner (Q1 de usage-guide-fixes-2), AAAA-MM-DD:». Con la respuesta, fila **40** en
  `docs/design-v0.2.md` §6 para `usage-guide-fixes-2`, fuera de `openspec-changes.yaml` (Q2), después de comprobar que
  ninguna rama abierta usa ya la 40: `for b in $(git for-each-ref --format='%(refname:short)' refs/heads refs/remotes);
  do git show "$b:docs/design-v0.2.md" 2>/dev/null | grep -q '^| 40 |' && echo "$b"; done` sin salida. Si Q1 = (b), el
  change no pasa de aquí hasta archivar la 35c. Si Q1 = (c), se quitan del change `specs/web/email-auth/` y
  `specs/web/auth/` y los grupos 2 y 3, y del grupo 5 solo queda lo de M01 (P2-8). Verificar:
  `grep -c "Respuesta del owner (Q1 de usage-guide-fixes-2), 20" docs/adr/ADR-055.md` devuelve `1` (antes de anotarla
  devuelve `0`), y `grep -n "usage-guide-fixes-2" docs/design-v0.2.md` muestra la fila 40.
  **Estado (2026-11-25):** Q1 = (a) anotada en design.md y en ADR-055 §1 (grep -c = 1, antes 0). Comprobación de ramas locales y remotas sin salida (nadie usa la fila 40 en origen); fila 40 en docs/design-v0.2.md §6, fuera de openspec-changes.yaml.
- [x] 0.2 [infra] Aprobación humana registrada. El debate cerró en la ronda 1 con «Convergencia: SI (2026-11-25, ronda
  1: 0 P0 / 0 V0)». Verificar: la línea «Aprobación humana:» de `design.md` lleva fecha en vez de «Pendiente».
  **Estado (2026-11-25):** Aprobación humana registrada en design.md con la cita literal «Aprobado ambos, avancemos»; alcance: apply en la rama y PR, fusión solo cuando el owner lo diga.

## 1. H1 — el diálogo de encaje llega a «Necesitas un CV guardado» (design D1, D2)

- [x] 1.1 [frontend] **Rechazos por código (D1).** Primero, en `apps/web/src/app/features/match/match.dialog.spec.ts`:
  - cambiar a `409` los `apiError(…, 422)` de `job_not_ready`, `cv_not_ready` y `cv_not_readable` de los casos
    existentes; el de `cv_not_ready` pasa a abrir con un CV con `extraction.status: 'pending'`, con `stopPolling` o
    fake timers para el sondeo del `CvStore` (P2-5);
  - reescribir el caso existente «Sin CV» como «La API dice que no hay CV» (`no_cv` con `409`) y añadir «Lo que manda
    es el código» (`no_cv` con `422`); los dos abren con el `GET` de la lista de CV respondiendo `500` o con un CV en
    la lista, para que «Analizar» exista también después de D2 (P1-1);
  - el `500` → «No pudimos analizar ahora.» lo cubre ya «Avería del servidor»; no se duplica (P2-5).

  Correrlos sobre el código sin arreglar y anotar cuáles caen (se esperan los de `409`: hoy muestran «No pudimos
  analizar ahora.»). Después, `isApiFailureCode(failure: RequestFailure | null, code: ApiErrorCode)` en
  `apps/web/src/app/core/api/api-error.ts` (P2-9) y `matchProblem` usándolo para los cuatro códigos; `isApiFailure` y
  `hasApiErrorCode` no cambian. Casos en `core/api/api-error.spec.ts` (nuevo): «isApiFailureCode matches by code
  whatever the status» y «isApiFailureCode is false for offline and unknown failures». Verificar:
  `pnpm nx run web:test --include="**/match.dialog.spec.ts" --skip-nx-cache` y el mismo con `**/api-error.spec.ts`,
  en verde. Falsación: volver a `isApiFailure(failure, 422, 'no_cv')` en `matchProblem` y ver caer «La API dice que no
  hay CV»; restaurar.
  **Estado (2026-11-25):** Antes del arreglo cayeron 4 casos (La oferta no se ha leído, La API dice que no hay CV, El CV se está leyendo, El CV no se pudo leer: 4 failed | 42 passed; hoy muestran «No pudimos analizar ahora.»); «Lo que manda es el código» (422) pasó antes porque 422 coincidía con el código viejo y queda como guardia. Con isApiFailureCode en matchProblem: match.dialog + api-error specs 48/48 en verde. Falsación: dejar no_cv comparando status 422 hace caer «La API dice que no hay CV» (1 failed | 45 passed); restaurado.
- [x] 1.2 [frontend] **Sin CV desde que se abre (D2).** Primero, en `match.dialog.spec.ts`:
  - «Sin CV al abrir» (`flushOpen` con la lista de CV vacía): `match-no-cv` y `match-upload-cv` visibles, ningún
    `match-analyze`, ningún `match-routing` (P2-4) y `http.expectNone({ method: 'POST', url: MATCH_URL })`;
  - «Sin CV gana al permiso desconocido»: `setSession`, después `reloadConsent()` con `500` en `/api/users/me` (deja
    `consentLoadStatus` en `failed`), y entonces abrir el diálogo con la lista vacía; se ve `match-no-cv` y no
    `match-consent-unknown` (P2-3);
  - «Subir mi CV lleva a /mi-cv y cierra con change-cv» desde ese estado;
  - «La lista se vacía con un informe en pantalla»: con un informe ya mostrado, la lista del `CvStore` pasa a vacía y
    el diálogo sigue en el informe (P1-3).

  Ver caer los tres primeros sobre el código de 1.1 y anotarlo. Después, en `match.dialog.ts`: antes de las fases del
  permiso, `cvs.isEmpty() && report() === null && failure() === null` devuelve `'no_cv'` (P1-3); en
  `match.dialog.html`, el bloque de `match-routing` no se pinta cuando `phase() === 'no_cv'` (P2-4). Verificar: el spec
  del diálogo entero en verde. Falsación: quitar la condición y ver caer «Sin CV al abrir» y «Sin CV gana al permiso
  desconocido»; moverla detrás de las fases del permiso y ver caer solo la segunda; quitar `report() === null` y ver
  caer «La lista se vacía con un informe en pantalla»; restaurar.
  **Estado (2026-11-25):** Antes de D2 cayeron «Sin CV al abrir», «Sin CV gana al permiso desconocido» y «Subir mi CV lleva a /mi-cv y cierra con change-cv» (3 failed | 47 passed); «La lista se vacía con un informe en pantalla» pasó antes (guardia). Con la fase local no_cv y match-routing oculto: spec del diálogo 50/50. Falsación: quitar la condición hace caer los tres primeros; moverla tras el permiso, solo «Sin CV gana al permiso desconocido»; quitar report() === null, solo «La lista se vacía con un informe en pantalla»; restaurado. Salidas en scratchpad apply-ugf2/1.*.txt.

## 2. H2 — verificar el email quita el aviso sin recargar (design D3)

- [x] 2.1 [frontend] **Esperar a la restauración.** Primero, en `apps/web/src/app/features/auth/verify-email.page.spec.ts`,
  un `describe` anidado con su propio `TestBed` (sin el `store.clear()` del `beforeEach` exterior, así que la sesión
  arranca en `unknown`) y `SessionRestore` sustituido por `{ provide: SessionRestore, useValue: { restore: () => … } }`
  con una promesa controlable (P2-2). Casos:
  - «La verificación responde antes que la restauración de la sesión»: responde el `POST /api/auth/verify-email`,
    después se resuelve la restauración con `setSession` de un perfil `emailVerified` `false`; se espera un
    `GET /api/users/me` **posterior** a la restauración que responde `emailVerified` `true`, y al final
    `store.needsEmailVerification()` es `false` y se ve «Ir a la aplicación»;
  - «Sin sesión tras la restauración: ir a iniciar sesión y sin pedir el perfil» (la restauración termina con
    `clear()`; `http.expectNone` del perfil);
  - «Enlace inválido mientras se restaura la sesión» (P2-1): el `POST` responde `400 invalid_token` antes de que se
    resuelva la restauración con sesión; mientras tanto la página sigue en «Comprobando el enlace…», y al final se ve
    el enlace no válido sin que se haya pintado nunca «Inicia sesión y usa el aviso…».

  Verlos caer sobre el código actual (el primero: no hay `GET` del perfil; el tercero: la pista de invitados se pinta)
  y anotarlo. Después, `verify()` espera con `Promise.allSettled` el `POST` y `inject(SessionRestore).restore()` antes
  de fijar cualquier fase y de mirar `isAuthenticated()`. Verificar: `pnpm nx run web:test
  --include="**/verify-email.page.spec.ts" --skip-nx-cache` en verde, con los casos existentes intactos. Falsación:
  quitar `restore()` de la espera y ver caer el primer y el tercer caso; restaurar.
  **Estado (2026-11-25):** Antes del arreglo cayeron «La verificación responde antes que la restauración de la sesión» (no había GET /api/users/me: «Expected one matching request … found none») y «Enlace inválido mientras se restaura la sesión» (la página ya pintaba el enlace no válido y la pista de invitados); «Sin sesión tras la restauración» pasó antes (guardia). Los tres van en un describe anidado que rehace el TestBed con SessionRestore por useValue. Con Promise.allSettled([verifyEmail, restore()]): spec 12/12. Falsación: sustituir restore() por Promise.resolve() hace caer el primero y el tercero (2 failed | 10 passed); restaurado.
- [x] 2.2 [frontend] **El perfil falla después de verificar (P1-2).** Primero, en el mismo spec:
  - «El perfil falla después de verificar»: con sesión, `POST` con éxito y `GET /api/users/me` con `500`; se espera
    «Email verificado», `store.user()?.emailVerified === true`, `store.needsEmailVerification()` en `false` y ningún
    `[role="alert"]`;
  - «el perfil responde 401 y el refresh falla: Email verificado, sin excepción»: `GET /api/users/me` con `401`, el
    refresh del interceptor con `401` (el interceptor hace `clear()`); se espera «Email verificado», `store.user()` en
    `null` y ninguna excepción sin capturar.

  Verlos caer (hoy pasan a la fase `error`) y anotarlo. Después, el fallo de `getProfile` se captura aparte: si
  `session.user()` no es `null`, `session.setUser({ ...user, emailVerified: true })`; si es `null`, solo la fase
  `success`. El tratamiento del fallo de la verificación no cambia. Verificar: el spec entero en verde, incluidos
  «Enlace inválido» y el de error genérico de la verificación, y `pnpm nx run web:typecheck`. Falsación: dejar que el
  fallo del perfil llegue al `catch` común y ver caer los dos casos; quitar la comprobación de `null` (con un cast) y
  ver caer el segundo; restaurar.
  **Estado (2026-11-25):** Antes cayeron «El perfil falla después de verificar» y «el perfil responde 401 y el refresh falla…» (no llegaban a «Email verificado»; fase error). Con refreshProfile() aparte (setUser solo si hay usuario): spec 12/12 y web:typecheck en verde. Falsación: dejar propagar el fallo del perfil hace caer los dos casos (2 failed | 10 passed); quitar la comprobación de null con cast hace caer solo el de 401 (1 failed | 11 passed); restaurado. En el de 401 se sustituye router.navigate por un mock para que el interceptor no saque la página de /verificar-email.

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

- [ ] 4.1 [frontend] `pnpm nx run web:extract-i18n`. Si sale diff en `apps/web/src/locale/messages.xlf`, debe ser solo
  de `linenumber` y se commitea tal como sale; si no sale diff, no hay commit (P2-6). `messages.en.xlf` no se toca
  (ADR-050). Verificar: `git diff --stat apps/web/src/locale/messages.en.xlf` vacío, `git diff
  apps/web/src/locale/messages.xlf` vacío o solo con `linenumber`, y `pnpm nx affected -t lint,typecheck,test,i18n-check`
  en verde.

## 5. Guía de uso (design D6)

- [ ] 5.1 [frontend] `tools/guia-de-uso/capture.mts`: en M01, el diálogo de Beto debe abrir ya con `match-no-cv`, sin
  `match-analyze` (una sola captura `encaje-sin-cv`; desaparecen `encaje-sin-cv-analizar` y el `throw` del hallazgo); en
  F03, tras el intento con la nueva `corta`, `expect(page.getByText('La contraseña actual no es correcta')).toHaveCount(0)`.
  `meta.mts`: «Esperado» y «Prueba automatizada» de M01 y F03 con los casos nuevos de 1.2 y 3.1; V03 con el de 2.1,
  que es la prueba de H2 (V03 en la guía es solo un indicio, P2-7). Verificar: `pnpm exec tsc --noEmit --strict
  --skipLibCheck --module nodenext --moduleResolution nodenext --target es2022 tools/guia-de-uso/capture.mts` sin
  errores nuevos respecto de `main` (el directorio no tiene `tsconfig` propio); y
  `grep -n "encaje-sin-cv-analizar" tools/guia-de-uso/capture.mts` sin resultados.
- [ ] 5.2 [frontend] `tools/guia-de-uso/build-guide.mts` y, a mano y con el mismo texto, `docs/guia-de-uso/README.md`:
  H1, H2 y H3 salen de «Hallazgos» y pasan a una línea «Corregido por `usage-guide-fixes-2`, pendiente de comprobar en
  la próxima pasada: M01, V03 y F03»; la fila de M01 de la tabla y su ficha dicen «Corregido (pendiente de pasada)» en
  vez de **FALLO**, sin cambiar lo «Visto» de la corrida del 2026-11-25; el resumen lo dice. Verificar:
  `grep -n "H1\.\|H2\.\|H3\." docs/guia-de-uso/README.md` ya no los lista bajo «Hallazgos»;
  `grep -c "usage-guide-fixes-2" docs/guia-de-uso/README.md tools/guia-de-uso/build-guide.mts` es mayor que `0` en los
  dos; `pnpm exec prettier --check docs/guia-de-uso tools/guia-de-uso` en verde.

## 6. Verificación manual del PR (design D5)

- [ ] 6.1 [frontend] Depende de 1-5. Sobre la pila e2e (`apps/web-e2e/scripts/e2e-stack.ts --keep-stack --list`) y con
  `--out=` a una carpeta temporal fuera del repo, **sin commitear capturas** ni `resultados.json`: corrida de
  `capture.mts` con las secciones de M01 y F03 (`--only=registro,verificacion,sesion,perfil,grupos,invitado,links,cv,encaje`
  o el subconjunto mínimo que deje en `.state.json` lo que esas secciones necesitan; el filtro es por sección, no por
  caso), y la sección `verificacion` (V03) repetida **5 veces** sobre pilas o cuentas nuevas. Anotar en el «Estado» los
  resultados de M01, F03 y las 5 de V03, borrar `tools/guia-de-uso/.state.json` y apagar la pila. Verificar:
  `git status --short docs/guia-de-uso tools/guia-de-uso` no muestra capturas ni `resultados.json` nuevos. El recorrido
  a mano en staging antes de invitar (registro → verificar → encaje sin CV → subir CV → encaje con el CV en lectura)
  queda **diferido a 35b**: se anota allí, no en este change.
