> **Cómo leer este fichero.** Cada tarea cabe en **menos de una hora**, lleva su etiqueta y dice **qué se ejecuta** para
> darla por cerrada. Un **guardia** (algo que se ejecuta cada vez: la selección de lotes del runner, la comprobación de
> cobertura, el guardia de los helpers `local-only`, el lint) se rompe a mano, se ve fallar y se restaura (ADR-048 §7).
> Como en `e2e-suite`: para contar líneas se usa `node`, no `grep -c`; `nx` no se canaliza por una tubería (salida a un
> fichero del scratchpad); el `.env` local, si una tarea lo edita, se copia antes y se restaura comprobando con `node`
> que queda idéntico byte a byte; y las anulaciones del runner son flags. Los nombres entre comillas son los títulos de
> los tests que se crean. «Admitir» sigue «Cómo admitir una prueba» de `apps/web-e2e/README.md` (con la CPU cargada,
> una invocación por proyecto y perfil, pila nueva, cinco de cinco y ningún `429` de registro en `stack-logs/api.log`).

## 0. Antes de aplicar

- [ ] 0.1 [infra] Q1-Q4 respondidas por el owner y anotadas con fecha en ADR-067 («Respuesta del owner (Qn),
  AAAA-MM-DD: …», una línea cada una) y en `design.md` §Open Questions. Con Q1, la fila de `docs/design-v0.2.md` §6 en
  el sitio que diga el owner. Verificar: `node -e` que cuenta en `docs/adr/ADR-067.md` las líneas que empiezan por
  «Respuesta del owner (Q» devuelve `4` (antes, `0`); `grep -n "e2e-suite-lot-2" docs/design-v0.2.md` da la fila de §6.
- [ ] 0.2 [infra] Debate critic/business/reflect cerrado sin P0/V0 abiertos y aprobación humana registrada. Verificar:
  `design.md` §Debate lleva la tabla de la última iteración y la fecha de la aprobación.
- [ ] 0.3 [infra] Precondiciones: 35c archivado y `e2e-suite` archivado. Copiar los dos requirements que este delta
  modifica de `openspec/specs/platform/e2e-suite/spec.md` y compararlos con los del delta sin las líneas añadidas aquí;
  si el archivo cambió algo, el MODIFIED se rehace sobre el texto archivado antes de seguir. Verificar:
  `ls openspec/changes/archive | grep -E "e2e-suite$|verify-reusable-workflow$"` da dos líneas; `node -e` que compara
  los dos bloques imprime `iguales` (o el diff, que se resuelve en esta tarea).
- [ ] 0.4 [infra] Estado de las ramas que tocan la suite, anotado en esta tarea: `paste-fallback-honest`
  (`@paste-actions`), `web-shell-capabilities` (`critical-path.spec.ts`, título de `search.spec.ts`,
  `support/shell-nav.ts`), `web-error-copy-coverage` (H3 y la fila del manifiesto) y `chore/e2e-dispatch-admission`
  (entradas de `e2e.yml`). Para cada una: en `main` o no. Verificar: `git log --oneline main -- <fichero>` por cada
  fichero citado; la anotación dice qué entra en el inventario de la 5.3 y si se hace la 6.3.

## 1. Lo admitido es cualquier lote (design D1)

- [ ] 1.1 [frontend] `scripts/lib/args.ts`: `playwrightGrepArgs` acepta condiciones de expresión además de etiquetas
  literales (que se siguen escapando); `e2e-stack.ts` usa `ADMITTED = '@lot[1-9][0-9]*(?![0-9A-Za-z_-])'` en `local` y
  `ADMITTED` + `@remote-safe` en `remote`. Casos en `args.spec.ts`: «local grep admits every lot tag», «a test without
  lot tag is not selected», «caller grep narrows the admitted set», «caller grep cannot widen to non-admitted», «remote
  grep requires a lot tag and remote-safe» y «@lot10 is a lot tag, @lot1x is not». Verificar: `pnpm nx run
  web-e2e:test --skip-nx-cache` en verde. Falsación: dejar `LOCAL_TAGS = ['@lot1']` y ver caer «local grep admits every
  lot tag»; quitar el lookahead final y ver caer «@lot1x is not»; restaurar.
- [ ] 1.2 [frontend] Depende de 1.1. Comprobación real de la selección: una prueba temporal `@lot2` vacía en un
  fichero de prueba. Verificar: `pnpm nx run web-e2e:e2e-stack -- --list` (que el runner pasa a Playwright) lista el
  camino crítico y la temporal, y `-- --list --grep @critical-path` solo el primero; borrar la temporal y repetir: no
  aparece. La salida de las tres corridas, en el scratchpad.

## 2. Helpers `local-only` y su guardia (design D5)

- [ ] 2.1 [frontend] `scripts/lib/local-only.ts`: `assertLocalOnly(operation, { tags, profile })` y
  `mailLinkPath(link, appOrigin)` (devuelve ruta y consulta de un enlace del correo; lanza si su origen no es el de la
  aplicación). Casos en `scripts/lib/local-only.spec.ts`: «remote-safe test cannot use mongo», «remote-safe test cannot
  read mailpit», «remote profile cannot use redis-docker», «a local test without remote-safe may use every operation»,
  «the error names the operation» y «mail link outside the app origin is rejected». Verificar: `pnpm nx run
  web-e2e:test --skip-nx-cache`. Falsación: comprobar solo el perfil (no las etiquetas) y ver caer los dos primeros;
  comparar el origen del enlace por prefijo de texto y ver caer el último con `http://localhost:4300.evil`; restaurar.
- [ ] 2.2 [frontend] Depende de 2.1. `src/support/local-only/index.ts`: `test = base.extend<{ localOnly }>` (fixture de
  ámbito de prueba) con `mongo()` (perezoso, `MONGO_URI` obligatoria, cierre en el *teardown*), `resetRegisterLimit()`
  (`docker exec <COMPOSE_PROJECT_NAME o linkvault>-redis-1 …`, que lanza si `docker` falla) y `mailpit.latest({ to,
  subject })` (`fetch` a `E2E_MAILPIT_URL`, con `expect.poll`); cada método llama primero a `assertLocalOnly`. El runner
  pasa `E2E_MAILPIT_URL` al perfil `local` (no al `remote`). Verificar: `pnpm nx run web-e2e:typecheck` y `web-e2e:lint`
  en verde; `node -e` que lee `stack-logs/runner.log` de una corrida muestra `E2E_MAILPIT_URL` en el entorno del perfil
  `local` y no en el del ensayo.
- [ ] 2.3 [frontend] `eslint.config.mjs`: en `src/**` salvo `src/support/local-only/**`, `no-restricted-imports` de
  `mongodb`, `child_process`, `node:child_process` e `ioredis`; en todo `src/**`, un selector de `no-restricted-syntax`
  para literales y plantillas con `localhost`, `127.0.0.1` o `[::1]`. Verificar: tras las tareas 3.x, `pnpm nx run
  web-e2e:lint` en verde. Falsación: añadir `import { MongoClient } from 'mongodb'` a `home.spec.ts` y ver el error con
  fichero y línea; añadir `const x = 'http://localhost:4200'` y ver el suyo; poner el literal en un comentario y ver que
  no falla; restaurar.
- [ ] 2.4 [frontend] Depende de 2.2. Falsación del guardia en Playwright: una prueba temporal `@lot9 @remote-safe` que
  llama a `localOnly.mongo()` y otra que llama a `localOnly.mailpit.latest(…)`. Verificar: `pnpm nx run
  web-e2e:e2e-stack -- --grep @lot9` falla en las dos con `local-only helper "mongo"` y `"mailpit"` en el informe, y
  `stack-logs` no muestra ninguna conexión nueva a Mongo de Playwright; quitar `@remote-safe` a la de Mongo y ver que
  pasa. Borrar las dos y comprobar con `git status` que no queda nada.

## 3. Limpieza de los specs no admitidos (design D6)

- [ ] 3.1 [frontend] Línea base **antes** de limpiar: pila del runner con `--keep-stack`; Playwright directo sobre
  `home`, `groups`, `public-share`, `links`, `match` y `freshness` con el entorno efectivo de esa pila (como la 5.4 de
  `e2e-suite`), sin `docker` del desarrollo en el `PATH`. Verificar: resultado por prueba anotado en esta tarea (pasa /
  falla y el primer error), con los informes en el scratchpad; `--down` al terminar y el bloque libre.
- [ ] 3.2 [frontend] `home.spec.ts` y `groups.spec.ts`: el origen sale de `baseURL` vía `resolveProfile`; fuera
  `APP_ORIGIN`. Verificar: `node -e` que busca `localhost` en los dos ficheros devuelve `0`; `web-e2e:lint` y
  `web-e2e:typecheck` en verde.
- [ ] 3.3 [frontend] `public-share.spec.ts`: el origen de `/p/:slug` sale de `PUBLIC_PAGE_BASE_URL` (obligatoria; error
  con su nombre si falta); fuera `LINKVAULT_API_ORIGIN`. Verificar: `node -e` sin `localhost` ni
  `LINKVAULT_API_ORIGIN` en el fichero; lint y typecheck en verde.
- [ ] 3.4 [frontend] Depende de 2.2. `links.spec.ts`, `match.spec.ts` y `freshness.spec.ts`: sus escrituras en Mongo
  por `localOnly.mongo()`; `test` importado de `./support/local-only`. Verificar: `node -e` sin `MongoClient` ni
  `mongodb://` en `src/` salvo `src/support/local-only/`; lint (con la 2.3) y typecheck en verde.
- [ ] 3.5 [frontend] Depende de 2.2. Los trece `beforeAll(resetRegisterLimit)` pasan a `beforeEach(({ localOnly }) =>
  localOnly.resetRegisterLimit())`; se borra `src/support/register-limit.ts`. Verificar: `node -e` sin
  `register-limit` en `src/`; lint y typecheck en verde. Falsación: con la pila del runner levantada y `docker` fuera del
  `PATH`, una prueba que llama al vaciado falla con `redis-docker` y el nombre del contenedor (antes pasaba en
  silencio); restaurar el `PATH`.
- [ ] 3.6 [frontend] Depende de 3.1-3.5. La misma corrida de la 3.1 **después** de limpiar, sobre una pila nueva.
  Verificar: por prueba, el mismo resultado o mejor que en la 3.1, anotado al lado; un resultado peor se arregla en
  esta tarea o vuelve al design. `git diff --stat` solo muestra los ficheros de 3.2-3.5.

## 4. Lote 2: cuenta y salida, y H11 (design D7, D9)

- [ ] 4.1 [infra] H11: `AI_VAULT_KEY` en `e2e.env` (32 bytes en base64 de un texto que dice que es de relleno), con
  comentario. Verificar: pila del runner con `--keep-stack` y `byok.spec.ts` con Playwright directo: el `PUT
  /api/users/me/ai-keys/<vendor>` no responde `503` (informe en el scratchpad). Falsación: quitar la línea, repetir y
  ver el `503 vault_unavailable`; restaurar. Además, `pnpm nx run web-e2e:e2e-stack` en verde con la clave (el camino
  crítico no cambia).
- [ ] 4.2 [frontend] Depende de 2.2. `git mv src/auth.spec.ts src/account.spec.ts`; prueba «account: sign up, verify
  email, profile, privacy, recover password and delete» con `@lot2 @account`, pasos 1-3 de D7 (registro, sesión
  restaurada y token fuera del almacenamiento, verificación por Mailpit con el enlace usado rechazado). Verificar:
  `pnpm nx run web-e2e:e2e-stack -- --grep @account --project=chromium` en verde hasta el paso 3.
- [ ] 4.3 [frontend] Depende de 4.2. Pasos 4 y 5 (nombre, contraseña errónea y correcta, privacidad desde el perfil).
  Verificar: la misma orden en verde.
- [ ] 4.4 [frontend] Depende de 4.3. Paso 6 (segundo contexto con sesión, recuperación por Mailpit, entrada con la
  nueva, el segundo contexto acaba en `/login` al recargar). Verificar: la misma orden en verde. Falsación: entrar en
  el segundo contexto **después** de la recuperación (en vez de antes) y ver caer la afirmación de que acaba en
  `/login`, porque esa sesión ya es nueva; restaurar.
- [ ] 4.5 [frontend] Depende de 4.4. Paso 7 (borrado y credenciales rechazadas). Verificar: la misma orden en verde y
  `stack-logs/api.log` con un solo `POST /api/auth/register` de esta prueba. Falsación: saltarse el clic de
  «Borrar cuenta» y ver caer la afirmación de credenciales rechazadas; afirmar «Email verificado» en el paso 3 sin
  abrir el enlace y ver caer la prueba; restaurar.
- [ ] 4.6 [frontend] (Si Q3 = (a).) `src/privacy.spec.ts`, «privacy notice is public and reachable by direct URL», con
  `@lot2 @privacy @remote-safe`, sin sesión. Verificar: `e2e-stack -- --grep @privacy` y `e2e-stack -- --rehearse-remote
  --skip-local --grep @privacy` en verde.
- [ ] 4.6b [frontend] (Si Q2 = (a).) `testMatch` del proyecto `mobile`: el camino crítico, `account.spec.ts` y
  `privacy.spec.ts`. Verificar: `e2e-stack -- --list --project=mobile` lista los tres y ninguno más.
- [ ] 4.7 [frontend] Depende de 4.5. Cotejo antes de borrar: cada `expect` de `auth-email-recovery.spec.ts` y
  `deploy-prod.spec.ts` (y de `auth.spec.ts` en `main`) tiene su equivalente en `account.spec.ts` o `privacy.spec.ts`;
  tabla «aserción antigua → paso nuevo» en esta tarea. Borrar los dos ficheros. Verificar: la tabla no deja ninguna
  aserción sin destino; `pnpm nx run web-e2e:lint` y `typecheck` en verde.
- [ ] 4.8 [infra] Presupuesto (design D8): la tabla «Presupuesto de intentos de registro» del README, por etiqueta, y
  las órdenes de «Cómo admitir una prueba» con su `--grep`. Verificar: `pnpm nx run web-e2e:e2e-stack` normal en verde
  y `node -e` sobre `stack-logs/api.log` cuenta los `POST /api/auth/register`: 7 (u 8 con `--rehearse-remote`), o la
  cifra de la tabla si Q2 o la 0.4 cambian las filas.
- [ ] 4.9 [frontend] Admisión con carga (`--repeat-each=5`, CPU cargada, pila nueva por invocación): `@account` en
  `chromium` y, si Q2 = (a), en `mobile`; `@privacy` en `local` y en el ensayo, por proyecto, si Q3 = (a). Verificar:
  cinco de cinco en cada invocación, ningún `429`, anotado en «Admisiones» del README con fecha, commit y minutos.
- [ ] 4.10 [frontend] Readmisión del camino crítico con su filtro: las cuatro invocaciones con `--grep
  @critical-path`. Verificar: cinco de cinco y 10 registros por invocación local, anotado en «Admisiones». (La de
  `@paste-actions`, si está en `main`, igual con su filtro.)

## 5. Mapa de cobertura e inventario (design D2, D3, D4, D10)

- [ ] 5.1 [frontend] `scripts/lib/coverage.ts`: `parseCatalog`, `evaluateCoverage` y el vocabulario de `depends`.
  Casos en `scripts/lib/coverage.spec.ts`: «missing catalog number is named», «title mismatch names number and both
  titles», «cited test that does not exist is named», «covered entry citing a non-admitted test fails», «planned entry
  with tests fails», «admitted test cited by no entry fails», «test missing from inventory is named», «inventory state
  contradicting the lot tag fails», «two lot tags on one test fail», «unknown depends value fails» y «only the Recorrido
  headings count as catalog numbers» (con los `### 1.`-`### 6.` de «Preparar el entorno local» y la tabla de control).
  Verificar: `pnpm nx run web-e2e:test --skip-nx-cache` en verde. Falsación: contar todos los encabezados numerados y
  ver caer el último; comparar solo números y no títulos y ver caer el segundo; restaurar.
- [ ] 5.2 [frontend] Depende de 5.1. `scripts/check-coverage.ts`: `playwright test --list --reporter=json` con la lista
  blanca y `E2E_BASE_URL=http://coverage.invalid`; imprime cuántos números, pruebas y admitidas miró. Verificar: `node
  --import tsx apps/web-e2e/scripts/check-coverage.ts` imprime las cifras; durante la corrida no aparece ningún puerto
  nuevo en escucha (`Get-NetTCPConnection` / `ss -ltn` antes y después) ni ningún `nx serve web`.
- [ ] 5.3 [frontend] Depende de 5.2 y de la 0.4. `catalog-coverage.json` con el contenido de D10 rehecho contra el
  `main` del día (incluidas las pruebas de las ramas ya fusionadas) y el inventario de todas las pruebas. Verificar: la
  orden de la 5.2 sale con `0`; las cifras impresas coinciden con `--list` (pruebas) y con los 46 números del catálogo.
- [ ] 5.4 [infra] Depende de 5.3. `tools/repo-checks/project.json`: target `check-catalog-coverage` (`cache: true`,
  `inputs` de D3 uno a uno) en el `dependsOn` del agregador. Verificar: `bash infra/ci/repo-checks.sh` en verde y su
  línea final cuenta una comprobación más. Falsación: sacar el target del `dependsOn` y ver que el agregador falla
  nombrándolo; restaurar.
- [ ] 5.5 [infra] Depende de 5.4. Falsaciones de la comprobación por `repo-checks` (cada una se restaura):
  (a) añadir al catálogo un `#### 47. Prueba` y ver el rojo con `47`, **en la segunda corrida seguida** del mismo
  checkout (sin `[local cache]` en la salida); (b) cambiar el título de la entrada 12 del mapa y ver número y los dos
  títulos; (c) cambiar una letra del título del camino crítico en su spec y ver el rojo del mapa y del inventario;
  (d) quitar `@lot2` a `account.spec.ts` y ver «covered entry citing a non-admitted test» y el estado del inventario;
  (e) añadir una prueba temporal `@lot2` sin entrada y ver «admitted test cited by no entry». Verificar: la salida de
  cada una, en el scratchpad.

## 6. Documentación

- [ ] 6.1 [infra] `apps/web-e2e/README.md`: «lo reproducible es lo de cualquier lote», «Cómo admitir una prueba» con
  el paso nuevo (entrada en `catalog-coverage.json`) y el número de lote (design D1), los helpers `local-only`, el
  presupuesto (4.8) y el camino antiguo sin `register-limit.ts`. Verificar: `node -e` sin `register-limit` ni
  «`@lot1` en este change» en el README; `bash infra/ci/repo-checks.sh` en verde (registro de afirmaciones).
- [ ] 6.2 [infra] `docs/guia-de-uso/README.md`, bajo H11: «**Corregido por el change `e2e-suite-lot-2`:** …»; ADR-067
  con las respuestas de la 0.1. Verificar: `grep -n "e2e-suite-lot-2" docs/guia-de-uso/README.md` da la línea bajo H11.
- [ ] 6.3 [infra] (Si la 0.4 dice que `chore/e2e-dispatch-admission` está en `main`.) `e2e.yml`: el guardia de
  entradas pasa a «`repeat_each > 1` exige `grep` y `project` distinto de `all`», y las descripciones de `grep` dicen
  «se suma a la selección de pruebas admitidas». Verificar: `actionlint` (o `pnpm exec` del que use el repo) en verde;
  una corrida a mano con `repeat_each=2` y sin `grep` falla en el primer paso sin instalar nada; con `grep=@account`,
  `project=chromium` y `repeat_each=2` pasa (minutos anotados).

## 7. Cierre

- [ ] 7.1 [infra] `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde, con la salida volcada a un fichero
  del scratchpad. Verificar: sin fallos en el fichero.
- [ ] 7.2 [infra] Corrida completa: `pnpm nx run web-e2e:e2e-stack -- --rehearse-remote` en verde en local, y una de
  `e2e.yml` (`target: local`, `rehearse_remote: true`) si el umbral de minutos lo permite (ADR-053 §1.2). Verificar:
  verde en los dos; los informes muestran las pruebas de los lotes 1 y 2 y ninguna sin lote.
- [ ] 7.3 [infra] `node …/openspec.js validate e2e-suite-lot-2 --strict --no-interactive`, `validate --all --strict
  --no-interactive` y `bash infra/ci/repo-checks.sh` en verde.
- [ ] 7.4 [infra] PR con la ventana que decida el owner, CI en verde sobre su cabeza (con `messages.xlf` al día si
  `main` lo cambió, ADR-050 §5), fusión a mano con merge commit; después `/opsx:archive` (la capacidad base existe por
  la 0.3). Verificar: `openspec/specs/platform/e2e-suite/spec.md` contiene los cuatro requirements nuevos y los dos
  modificados; `ls openspec/changes/archive | grep e2e-suite-lot-2` da una línea.
