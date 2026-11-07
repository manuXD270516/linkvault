> **Cómo leer este fichero.** Cada tarea cabe en **menos de una hora**, lleva su etiqueta y dice **qué se ejecuta** para
> darla por cerrada. Un **guardia** (algo que se ejecuta cada vez: la selección de lotes, la comprobación de cobertura,
> el guardia `local-only`, el lint) se rompe a mano, se ve fallar **en un sitio dicho** y se restaura (ADR-048 §7).
> Como en `e2e-suite`: para contar líneas se usa `node`, no `grep -c`; `nx` no se canaliza por una tubería (salida a un
> fichero del scratchpad); el `.env` local, si una tarea lo edita, se copia antes y se restaura comprobando con `node`
> que queda idéntico byte a byte; y las anulaciones del runner son flags. Los nombres entre comillas son los títulos de
> los tests que se crean. «Admitir» sigue «Cómo admitir una prueba» de `apps/web-e2e/README.md` (CPU cargada, una
> invocación por proyecto, pila nueva, cinco de cinco y ningún `429` de registro en `stack-logs/api.log`).
>
> **Grupos:** 0 (antes de aplicar, 4 tareas), 1 (selección de lotes, 3), 2 (guardia, fixture y lint, 5 con la 2.3a y
> la 2.3b), 4 (lote 2 y H11, 11 con la 4.6b, 4.9a y 4.9b), 5 (mapa e inventario, 6), 6 (documentación, 2) y 7 (cierre,
> 4): **35 tareas**. El
> grupo 3 (limpieza de specs no admitidos) se retiró en la iteración 1 del debate (B1); la numeración no se rehace.

## 0. Antes de aplicar

- [ ] 0.1 [infra] Q1, Q2 y Q4 respondidas por el owner y anotadas con fecha en ADR-067 («Respuesta del owner (Qn),
  AAAA-MM-DD: …», una línea cada una) y en `design.md` §Open Questions. Con Q1, la fila de `docs/design-v0.2.md` §6 en
  el sitio que diga el owner. Verificar: `node -e` que cuenta en `docs/adr/ADR-067.md` las líneas que empiezan por
  «Respuesta del owner (Q» devuelve `3` (antes, `0`); `grep -n "e2e-suite-lot-2" docs/design-v0.2.md` da la fila de §6.
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. Verificar:
  `design.md` §Debate lleva la tabla de la última iteración y la fecha de la aprobación.
- [ ] 0.3 [infra] Precondiciones: 35c archivado y `e2e-suite` archivado. Comparar los **tres** requirements que este
  delta modifica («El entorno de la suite…», «Cada destino se declara…» y «El primer lote es el camino crítico…») con
  los de `openspec/specs/platform/e2e-suite/spec.md`, sin las líneas que añade este delta; si el archivo cambió algo, el
  MODIFIED se rehace sobre el texto archivado antes de seguir. Verificar: `ls openspec/changes/archive | grep -E
  "e2e-suite$|verify-reusable-workflow$"` da dos líneas; un `node -e` que compara los tres bloques imprime `iguales` (o
  el diff, que se resuelve en esta tarea).
- [ ] 0.4 [infra] Estado de las ramas que tocan la suite, anotado en esta tarea, en `main` o no:
  `paste-fallback-honest` (`@paste-actions` y su 5.6c, que pone `--grep @critical-path` en la readmisión del camino
  crítico), `web-shell-capabilities` (`critical-path.spec.ts`, título de `search.spec.ts`, el apoyo
  `support/shell-nav.ts`), `web-error-copy-coverage` (H3 y la fila del manifiesto) y `chore/e2e-dispatch-admission`
  (guardia de `c31ba3e`). Si `web-shell-capabilities` o `paste-fallback-honest` siguen abiertas, añadir a su grupo de
  cierre la línea «si `e2e-suite-lot-2` está en `main`: entrada en `catalog-coverage.json`» (C15). Verificar: `git log
  --oneline main -- <fichero>` por cada fichero citado; la anotación dice qué entra en el inventario de la 5.3; `git
  show <rama>:openspec/changes/<change>/tasks.md | grep -c catalog-coverage` ≥ 1 en cada rama abierta.

## 1. Lo admitido es cualquier lote (design D1)

- [ ] 1.1 [frontend] `scripts/lib/args.ts`: `ADMITTED` y `profileGrepConditions(profile)`; `playwrightGrepArgs` acepta
  condiciones ya escritas como expresión; `e2e-stack.ts` importa `profileGrepConditions` y deja de declarar
  `LOCAL_TAGS`/`REMOTE_TAGS`. Casos en `args.spec.ts`: «local grep admits every lot tag», «a test without lot tag is not
  selected», «caller grep narrows the admitted set», «caller grep cannot widen to non-admitted», «remote grep requires a
  lot tag and remote-safe» y «@lot10 is a lot tag, @lot1x is not». Verificar: `pnpm nx run web-e2e:test
  --skip-nx-cache` en verde; `node -e` sin `LOCAL_TAGS` ni `REMOTE_TAGS` en `e2e-stack.ts`. Falsación: que
  `profileGrepConditions('local')` devuelva `['@lot1']` y ver caer «local grep admits every lot tag»; quitar el lookahead
  de `ADMITTED` y ver caer «@lot1x is not»; restaurar.
- [ ] 1.2 [frontend] Depende de 1.1. Selección real, sin montar la pila (C18): **dos** pruebas temporales vacías, una
  `@lot2` y otra `@lot1` que no es el camino crítico (R2-9, escenario de C13), y Playwright directo, `playwright test -c
  apps/web-e2e/playwright.config.mts --list --grep "<grep de profileGrepConditions('local')>"` con
  `E2E_BASE_URL=http://coverage.invalid`. Verificar: lista el camino crítico y las dos temporales; con el `--grep`
  combinado con `@critical-path`, solo el primero; con el de `remote`, solo el camino crítico. Borrar las temporales;
  salidas en el scratchpad.
- [ ] 1.3 [frontend] Depende de 1.1. Ensayo sin pruebas aptas (C23, R2-4): antes de reiniciar `worker`, el runner lista con
  el `--grep` de `remote` y falla si la lista sale vacía (una lista sin resultados cuenta como vacía, con el código de
  salida que dé Playwright). Verificar: `pnpm nx run web-e2e:e2e-stack -- --rehearse-remote --skip-local --grep
  @account` (con la 4.2 hecha; si no, con una etiqueta inexistente) sale con ≠0 en la fase «suite» nombrando el filtro
  («el filtro @account no deja ninguna prueba apta para remoto») y `stack-logs/worker.log` **no** tiene la línea
  «ensayo: worker reiniciado». Falsación: quitar la comprobación; la misma orden falla igual, pero con «Playwright
  exited with code 1» y **después** de que `worker.log` registre «ensayo: worker reiniciado»; restaurar.
## 2. Guardia, fixture de Mailpit y lint (design D5)

- [ ] 2.1 [frontend] `scripts/lib/local-only.ts`: `assertLocalOnly`, `createMailpit({ baseUrl, fetch, guard })`,
  `pickLatest` y `mailLinkPath`. Casos en `scripts/lib/local-only.spec.ts`: «remote-safe test cannot read mailpit»,
  «remote-safe test cannot use mongo», «remote profile cannot use redis-docker», «remote profile cannot use mailpit»,
  «a local test without remote-safe may use every operation», «the error names the operation», «guard throws before
  the connector is invoked» (espía sobre `fetch` con cero llamadas), «missing E2E_MAILPIT_URL is named», «pickLatest
  ignores mail older than after», «pickLatest picks the newest for that address and subject» y «mail link outside the
  app origin is rejected». Verificar: `pnpm nx run web-e2e:test --skip-nx-cache`. Falsación: comprobar solo el perfil y
  ver caer los dos primeros; llamar a `fetch` antes del guardia y ver caer «guard throws before…» con una llamada en el
  espía; comparar el origen del enlace por prefijo de texto y ver caer el último con `http://localhost:4300.evil`;
  restaurar.
- [ ] 2.2 [frontend] Depende de 2.1. `src/support/local-only/index.ts`: `test = base.extend<{ localOnly }>` (ámbito de
  prueba) con `localOnly.mailpit`, que lee `E2E_MAILPIT_URL` dentro del fixture, nunca a nivel de módulo (C9). El
  runner pasa `E2E_MAILPIT_URL` al perfil `local` y no al `remote`, y la añade como `E2E_MAILPIT_URL=<url>` a la
  descripción del perfil `local` que escribe en `runner.log` (la del ensayo no la lleva, R2-8). Verificar:
  `web-e2e:typecheck` y `web-e2e:lint` en verde; un `node -e` sobre `stack-logs/runner.log` de una corrida con
  `--rehearse-remote` busca `E2E_MAILPIT_URL=` en las dos líneas «suite: playwright …»: está en la del perfil
  `local` y no en la del ensayo.
- [ ] 2.3a [frontend] `eslint.config.mjs`, bloque 1 de D5 (`src/**/*.ts`): esperas fijas, bucle local, acceso local (C7) y
  `no-restricted-imports` con el patrón `**/support/register-limit`. Verificar: con un bloque exento provisional que
  liste a mano los ficheros que hoy rompen las reglas (lo sustituye la 2.3b), `pnpm nx run web-e2e:lint` en verde.
  Falsaciones en `account.spec.ts` (o, antes de la 4.2, en `critical-path.spec.ts`), cada una con el error en esa
  línea, y restaurar:
  (a) `import { MongoClient } from 'mongodb'`: `no-restricted-imports`;
  (b) `const x = 'http://localhost:4300'`: selector de bucle local; el mismo literal en un comentario, sin error;
  (c) `await import('mongodb')`: selector de `ImportExpression` (C7);
  (d) `process.env['MONGO_URI']` y `process.env.E2E_MAILPIT_URL`: selector de entorno (C7).
- [ ] 2.3b [frontend] Depende de 2.3a. Bloques 2 y 3 de D5, después del 1 y sin `ignores`, con `no-restricted-imports:
  'off'` y la lista completa de `no-restricted-syntax`; `EXEMPT_FILES` = `src/<clave>` de los ficheros con alguna prueba
  `not-admitted` y de `exemptSupport`, con el JSON leído relativo a `import.meta.dirname` (R2-3). Hasta la 5.3, un
  `catalog-coverage.json` mínimo con esos ficheros y `"exemptSupport": { "support/register-limit.ts": … }` (R2-1)
  sustituye la lista provisional de la 2.3a. Verificar: `pnpm nx run web-e2e:lint` en verde, también lanzado desde
  `apps/web-e2e` como directorio de trabajo. Falsaciones, y restaurar:
  (e) el `import` de (a) en `home.spec.ts`, exento: sin error; al marcar su prueba `admitted` en el JSON, el error
  aparece;
  (f) un `setTimeout(…)` en `home.spec.ts` y otro en `local-only/index.ts`: error de esperas fijas en los dos (C8); y un
  `'http://localhost:8125'` en `local-only/index.ts`: error del selector de bucle local (H3);
  (g) `import { resetRegisterLimit } from './support/register-limit'` en `account.spec.ts` (o, antes de la 4.2, en
  `critical-path.spec.ts`): error del patrón
  `**/support/register-limit` (R2-1); y quitar `exemptSupport` del JSON: el error aparece en
  `support/register-limit.ts` por `node:child_process`.
- [ ] 2.4 [frontend] Depende de 2.2. Guardia en Playwright: una prueba temporal `@lot9 @remote-safe` que llama a
  `localOnly.mailpit.latest(…)`. Verificar: `pnpm nx run web-e2e:e2e-stack -- --grep @lot9 --project=chromium` falla
  en esa prueba con `local-only helper "mailpit"` en el informe; quitar `@remote-safe` y ver que la llamada llega a
  Mailpit (la prueba pasa o falla por no encontrar el correo, no por el guardia). Que no se hace ninguna petición lo
  prueba el espía de la 2.1 (R2-6). Borrar la prueba y comprobar con `git status` que no queda nada.
## 4. Lote 2: cuenta y salida, y H11 (design D7, D8, D9)

- [ ] 4.1 [infra] H11: `AI_VAULT_KEY` en `e2e.env` (32 bytes en base64 de un texto que dice que es de relleno), con
  comentario. Verificar: pila del runner con `--keep-stack` y `byok.spec.ts` con Playwright directo: el `PUT
  /api/users/me/ai-keys/<vendor>` no responde `503` (informe en el scratchpad). Falsación: quitar la línea, repetir y
  ver el `503 vault_unavailable` en ese `PUT`; restaurar. Además, `pnpm nx run web-e2e:e2e-stack` en verde con la clave.
- [ ] 4.2 [frontend] Depende de 2.2. `git mv src/auth.spec.ts src/account.spec.ts`; quitar el `beforeAll` con
  `resetRegisterLimit` y su `import`, que hereda de `auth.spec.ts` (R2-2); prueba «account: privacy, sign up, verify
  email, profile, recover password and delete» con `@lot2 @account`, pasos 0-3 de D7 (privacidad por URL directa sin
  sesión, registro, sesión restaurada y token fuera del almacenamiento, verificación por Mailpit con `after` y el
  enlace usado rechazado). Verificar: `node -e` sin `register-limit` en `account.spec.ts`; `pnpm nx run
  web-e2e:e2e-stack -- --grep @account --project=chromium` en verde hasta el paso 3.
- [ ] 4.3 [frontend] Depende de 4.2. Pasos 4 y 5 (nombre, contraseña errónea y correcta, privacidad desde el perfil).
  Verificar: la misma orden en verde.
- [ ] 4.4 [frontend] Depende de 4.3. Paso 6 (segundo contexto con sesión, recuperación por Mailpit, entrada con la
  nueva, el segundo contexto acaba en `/login` al recargar). Verificar: la misma orden en verde. Falsación: abrir la
  sesión del segundo contexto **después** de la recuperación; la prueba cae en la aserción `toHaveURL(/\/login/)` del
  segundo contexto en el paso 6, con su página en `/grupos`; restaurar.
- [ ] 4.5 [frontend] Depende de 4.4. Paso 7: borrado y, en un contexto nuevo (`browser.newContext()`, porque `/login`
  tiene `guestGuard`, R2-5), entrada con esas credenciales rechazada. Verificar: la misma orden en verde y
  `stack-logs/api.log` con un solo `POST /api/auth/register` de esta prueba. Falsación: quitar el clic de «Borrar
  cuenta» y la espera de `/login` que se arma con él; la prueba cae en el paso 7, en el contexto nuevo, en la aserción
  de «Email o contraseña incorrectos», con esa página en `/grupos` porque la entrada prosperó; restaurar.
- [ ] 4.6b [frontend] (Si Q2 = (a).) `testMatch` del proyecto `mobile`: el camino crítico y `account.spec.ts`.
  Verificar: `playwright test -c apps/web-e2e/playwright.config.mts --list --project=mobile` (con
  `E2E_BASE_URL=http://coverage.invalid`) lista las dos pruebas y ninguna más.
- [ ] 4.7 [frontend] Depende de 4.5. Cotejo antes de borrar: cada `expect` de `auth-email-recovery.spec.ts` y
  `deploy-prod.spec.ts` (y de `auth.spec.ts` en `main`) tiene su equivalente en `account.spec.ts`; tabla «aserción
  antigua → paso nuevo» en esta tarea. Borrar los dos ficheros. Verificar: la tabla no deja ninguna aserción sin
  destino; `web-e2e:lint` y `typecheck` en verde.
- [ ] 4.8 [infra] Presupuesto (design D8): la orden imprime registros usados y margen hasta 10, por proyecto y en la
  corrida entera, leyendo `stack-logs/api.log` (un `node -e` documentado en el README); las dos tablas de D8, la línea
  del `429` en un reintento (C22) y las órdenes de «Cómo admitir una prueba» con su `--grep`. Verificar: `pnpm nx run
  web-e2e:e2e-stack` normal en verde y el `node -e` imprime `chromium 4, mobile 3, total 7, margen 3` (o la cifra de la
  tabla si Q2 o la 0.4 cambian las filas).
- [ ] 4.9a [frontend] Admisión con carga de `@account` en `chromium`: `e2e-stack -- --project=chromium --grep @account
  --repeat-each=5`. Verificar: cinco de cinco, 5 registros y ningún `429`, anotado en «Admisiones» con fecha, commit y
  minutos.
- [ ] 4.9b [frontend] (Si Q2 = (a).) La misma admisión en `mobile`. Verificar: igual que la 4.9a.
- [ ] 4.10 [frontend] Confirmación de la readmisión del camino crítico con su filtro (la orden ya la corrige la 5.6c de
  `paste-fallback-honest`, C11; si no está en `main`, se corrige aquí): las cuatro invocaciones con `--grep
  @critical-path`. Verificar: cinco de cinco y 10 registros por invocación local, anotado en «Admisiones».

## 5. Mapa de cobertura e inventario (design D2, D3, D4, D10)

- [ ] 5.1 [frontend] `scripts/lib/coverage.ts`: `parseCatalog` y `evaluateCoverage`. Casos en
  `scripts/lib/coverage.spec.ts`: «catalog title without entry is named», «changed title names the missing and the extra
  entry», «renumbering alone changes nothing», «cited test that does not exist is named», «covered entry citing a
  non-admitted test fails», «planned entry with tests fails», «lot written on a covered entry fails», «admitted test
  cited by no entry fails», «test missing from inventory is named», «inventory state contradicting the lot tag fails»,
  «two lot tags on one test fail» y «only the Recorrido headings count» (con los `### 1.`-`### 6.` de «Preparar el
  entorno local» y la tabla de control). Verificar: `pnpm nx run web-e2e:test --skip-nx-cache`. Falsación: contar todos
  los encabezados numerados y ver caer el último; indexar por número y ver caer «renumbering alone changes nothing»;
  restaurar.
- [ ] 5.2 [frontend] Depende de 5.1. `scripts/check-coverage.ts`: Playwright `--list --reporter=json` con la lista
  blanca mínima, `E2E_BASE_URL=http://coverage.invalid` y `PLAYWRIGHT_JSON_OUTPUT_FILE` en un temporal propio que borra
  al salir; imprime cuántas funcionalidades, pruebas y admitidas miró. Verificar: `node --import tsx
  apps/web-e2e/scripts/check-coverage.ts` imprime las cifras con **solo** la lista blanca en el entorno (C9); durante la
  corrida no aparece ningún puerto nuevo en escucha (`Get-NetTCPConnection` / `ss -ltn` antes y después) y el temporal
  no queda. Falsación: leer `E2E_MAILPIT_URL` a nivel de módulo en `local-only/index.ts` y ver que `--list` falla al
  cargar `account.spec.ts`; restaurar.
- [ ] 5.3 [frontend] Depende de 5.2 y de la 0.4. `catalog-coverage.json` con el contenido de D10 rehecho contra el
  `main` del día y el inventario de todas las pruebas; sustituye al inventario mínimo de la 2.3b. Verificar: la orden de
  la 5.2 sale con `0`; las cifras coinciden con `--list` y con los 46 títulos del catálogo; `web-e2e:lint` sigue en
  verde (la exención sale del inventario real).
- [ ] 5.4 [infra] Depende de 5.3. `tools/repo-checks/project.json`: target `check-catalog-coverage` (`cache: true`,
  `inputs` de D3, con `externalDependencies` `@playwright/test`, `tsx` y `typescript`) en el `dependsOn` del agregador; cabecera de `infra/ci/repo-checks.sh`
  (C16). Verificar: `bash infra/ci/repo-checks.sh` en verde y su línea final cuenta una comprobación más. Falsación:
  sacar el target del `dependsOn` y ver que el agregador falla nombrándolo; restaurar.
- [ ] 5.5 [infra] Depende de 5.4. Falsaciones por `repo-checks`, cada una restaurada:
  (a) añadir al catálogo un `#### 47. Prueba` y ver el rojo con «Prueba» **en la segunda corrida seguida** del mismo
  checkout (sin `[local cache]` para `check-catalog-coverage`);
  (b) cambiar el título de «Importar un chat» en el catálogo y ver los dos títulos nombrados;
  (c) cambiar una letra del título del camino crítico en su spec y ver el rojo del mapa y del inventario;
  (d) quitar `@lot2` a `account.spec.ts` y ver «covered entry citing a non-admitted test» y el estado del inventario;
  (e) añadir una prueba temporal `@lot2` sin entrada y ver «admitted test cited by no entry»;
  (f) un comentario en `apps/web-e2e/scripts/lib/remote.ts`: la segunda corrida no sale de la caché (C3).
  Verificar: la salida de cada una, en el scratchpad.
- [ ] 5.6 [frontend] Depende de 5.4, 2.3b y 4.2 (H1). Apoyos exentos en la comprobación (R2-1): `evaluateCoverage`
  recibe además, por fichero de `src/`, sus `import` relativos (leídos con el compilador de TypeScript, solo los
  especificadores), **resueltos desde la carpeta del fichero que importa** a una ruta relativa a `src/` (H4), y falla
  si una clave de `exemptSupport` no existe o si la importa un fichero que no está exento. Casos en
  `coverage.spec.ts`: «exempt support that does not exist fails» y «exempt support imported by a non-exempt file
  fails», este con dos importadores no exentos: un spec con `./support/register-limit` y un fichero de `support/` con
  `./register-limit`. Verificar:
  `pnpm nx run web-e2e:test --skip-nx-cache` y `bash infra/ci/repo-checks.sh` en verde. Falsación: con la 2.3b
  hecha, desactivar en una línea el lint del patrón y añadir el `import` de (g) a `account.spec.ts`: la comprobación
  falla nombrando los dos ficheros; restaurar.

## 6. Documentación

- [ ] 6.1 [infra] `apps/web-e2e/README.md`: «lo reproducible es lo de cualquier lote», «Cómo admitir una prueba» con el
  paso nuevo (entrada en `catalog-coverage.json`) y el número de lote (D1), el fixture `local-only` y la exención por
  inventario, el presupuesto (4.8), y una línea en «El camino antiguo» (C21): `account.spec.ts` exige `E2E_MAILPIT_URL`,
  que solo pone el runner, y el fixture la nombra si falta. Si `chore/e2e-dispatch-admission` está en `main`, la
  descripción de la entrada `grep` dice «se suma a la selección de pruebas admitidas». Verificar: `node -e` sin «`@lot1`
  en este change» en el README; `bash infra/ci/repo-checks.sh` en verde (registro de afirmaciones).
- [ ] 6.2 [infra] `docs/guia-de-uso/README.md`: bajo H11, «**Corregido por el change `e2e-suite-lot-2`:** …»; y las
  referencias a `auth.spec.ts`, `auth-email-recovery.spec.ts` y `deploy-prod.spec.ts` (líneas «**Prueba:**» y tabla de
  specs) apuntan a `account.spec.ts` (C20). ADR-067 con las respuestas de la 0.1. Verificar: `node -e` sin esos tres
  nombres en la guía; `grep -n "e2e-suite-lot-2" docs/guia-de-uso/README.md` da la línea bajo H11.

## 7. Cierre

- [ ] 7.1 [infra] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde, con la salida volcada a un fichero
  del scratchpad. Verificar: sin fallos en el fichero.
- [ ] 7.2 [infra] Corrida completa: `pnpm nx run web-e2e:e2e-stack -- --rehearse-remote` en verde en local, y una de
  `e2e.yml` (`target: local`, `rehearse_remote: true`) si el umbral de minutos lo permite (ADR-053 §1.2). Verificar:
  verde en los dos; los informes muestran las pruebas admitidas de los lotes 1 y 2 (y `@paste-actions` si está en
  `main`) y ninguna sin lote; el ensayo, solo el camino crítico.
- [ ] 7.3 [infra] `node …/openspec.js validate e2e-suite-lot-2 --strict --no-interactive`, `validate --all --strict
  --no-interactive` y `bash infra/ci/repo-checks.sh` en verde.
- [ ] 7.4 [infra] PR con la ventana que decida el owner, CI en verde sobre su cabeza (con `messages.xlf` al día si
  `main` lo cambió, ADR-050 §5), fusión a mano con merge commit; después `/opsx:archive` (la capacidad base existe por
  la 0.3). Verificar: `openspec/specs/platform/e2e-suite/spec.md` contiene los cuatro requirements nuevos y los tres
  modificados; `ls openspec/changes/archive | grep e2e-suite-lot-2` da una línea.
