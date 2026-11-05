## Context

Motivación en `proposal.md` §Why; decisiones de fondo en **ADR-067** (propuesto). Este change es el **lote 2** que
`e2e-suite` dejó anotado (design D9 y D14 de ese change, R-18 y B-V1-7 de su debate, C13 de su iteración 1) y que
ADR-053 §4 y §7 aplazaron. Estado de partida:

- **Lo reproducible es lo etiquetado `@lot1`.** El runner (`apps/web-e2e/scripts/e2e-stack.ts`) fija
  `LOCAL_TAGS = ['@lot1']` y `REMOTE_TAGS = ['@lot1', '@remote-safe']`, y `playwrightGrepArgs` combina esas etiquetas
  con el `--grep` de quien ejecuta (todas a la vez, con lookaheads). En `main` hay **una** prueba admitida, el camino
  crítico (`critical-path.spec.ts`, proyectos `chromium` y `mobile`).
- **Otras ramas añaden pruebas `@lot1`** fuera de la serie de lotes: `paste-fallback-honest` admite
  «paste error actions fit and keep their order at 360 px» en `links.spec.ts` (`@lot1 @paste-actions`, solo
  `chromium`, **registra una cuenta**); `web-shell-capabilities` cambia `critical-path.spec.ts` (navegación por el
  shell), el título de la prueba de `search.spec.ts` y añade `support/shell-nav.ts`. Cuando este change se aplique,
  todas estarán en `main` o seguirán en su rama: el inventario y el mapa se escriben **contra el `main` de ese día**
  (tarea 0.4).
- **Los specs no admitidos** dependen del entorno (guía de uso H14-H17; design D1 de `e2e-suite`): `home.spec.ts` y
  `groups.spec.ts` llevan `http://localhost:4200`; `public-share.spec.ts` usa `LINKVAULT_API_ORIGIN ??
  'http://localhost:3000'` para `/p/:slug`; `links`, `match` y `freshness` abren `MongoClient` con `MONGO_URI ??
  'mongodb://localhost:27017/…'`; y `register-limit.ts`, que importan **trece** specs en `beforeAll`, hace
  `docker exec linkvault-redis-1` y **se traga el error** si `docker` falla.
- **El presupuesto de registros es de 10 intentos cada 15 minutos por IP**, constante en el código
  (`REGISTRATIONS_PER_IP = 10`, `apps/api/src/modules/auth/domain/attempt-limits.ts`): no hay variable para subirlo en
  la suite. La admisión del camino crítico ya gasta exactamente 10 por proyecto (design D5 de `e2e-suite`).
- **El catálogo** (`docs/catalogo-de-uso.md`) numera el recorrido con encabezados `#### <n>. <título>` del 1 al 46 bajo
  `## Recorrido`; **la sección «Preparar el entorno local» reutiliza los números 1 a 6** con `### `, y al final hay una
  «Tabla de control» que repite los números. La comprobación no puede contar números a ciegas.
- **`repo-checks` no es «lo que no cachea».** El agregador `repo-checks:check` lleva `cache: false`, pero cada
  comprobación es un target `check-<nombre>` **cacheable con `inputs` explícitos** (regla 1 de
  `tools/repo-checks/project.json`). La disyuntiva de C13 («`inputs` con el catálogo o vivir en `repo-checks`») es
  falsa: en los dos sitios la comprobación necesita declarar el catálogo en sus `inputs`. Lo que sí da `repo-checks`
  es ejecutarse **siempre** en `ci.yml` (paso incondicional), sin depender de que `nx affected` alcance un fichero que no
  pertenece a ningún proyecto.
- **`e2e.env` no tiene `AI_VAULT_KEY`** (H11): guardar una clave propia responde `503 vault_unavailable` y
  `byok.spec.ts` falla. En producción la clave es obligatoria (RUNBOOK). `infra/ci/verify.env` ya lleva una de relleno.
- **`chore/e2e-dispatch-admission`** (rama local, sin subir) añade a `e2e.yml` las entradas `project`, `grep`,
  `repeat_each`, `skip_local` y `cpu_load` (solo `target: local`), con un guardia que rechaza `project=all` con
  `repeat_each > 2`, calculado para el `@lot1` de hoy.
- **H3** (texto genérico al guardar una clave sin bóveda) lo absorbió `web-error-copy-coverage` (Q2 = (a) de ese
  change, 2026-10-29); su rama deja el bloque de este change solo con H11. Aquí no se toca.

## Goals / Non-Goals

**Goals:**

- Que «admitida» signifique lo mismo en el runner, en el mapa y en el README: **una etiqueta `@lot<N>`**.
- El **mapa de cobertura** y el **inventario**, con una comprobación que no pueda quedarse verde por caché.
- Los **helpers `local-only`** con su guardia `@remote-safe` en cualquier perfil, y el lint que impide saltárselos.
- La **limpieza** de orígenes y accesos a Mongo de los specs no admitidos, sin admitirlos.
- El **lote 2**: cuenta y salida (catálogo 2 y 4 con Mailpit, 5, 6 y 44), admitido con carga.
- **H11**: la bóveda configurada en la suite.

**Non-Goals:**

- Admitir los specs limpiados: su admisión es de su lote (D14 de `e2e-suite`, lotes 3 a 7).
- H3 (lo corrige `web-error-copy-coverage`), H7 (change con datos reales de 35b), H8 y H12 (fixtures), H9, H10 y
  H15-H17 (sus lotes; quedan anotados en el inventario) — Q4.
- Subir el límite de registros por IP ni vaciarlo entre pruebas admitidas (D8).
- Ejecutar la suite remota tras cada despliegue (Q4 de `e2e-suite`) o cambiar sus disparadores (Q2 de `e2e-suite`).
- Tocar `ci.yml`, `cd-staging.yml` o `cd-prod.yml`: la comprobación entra por `repo-checks`, que ya invocan.

## Decisions

### D1. Admitida = una etiqueta `@lot<N>`; el runner ejecuta todos los lotes

- **Regla:** una prueba está admitida si lleva **exactamente una** etiqueta que casa con `^@lot[1-9][0-9]*$`. El
  número registra **en qué lote se admitió**, no a qué lote del plan pertenece su funcionalidad (eso lo dice el mapa,
  D2): la prueba de `paste-fallback-honest` es `@lot1` aunque su funcionalidad (catálogo 15) sea del lote 3. Un change
  que no es de la serie y admite una prueba usa el número del **último lote archivado** en ese momento.
- **Runner:** `LOCAL_TAGS`/`REMOTE_TAGS` pasan de etiquetas literales a condiciones: `ADMITTED = '@lot[1-9][0-9]*(?![0-9A-Za-z_-])'`
  y, en `remote`, además `@remote-safe`. `playwrightGrepArgs` acepta condiciones ya escritas como expresión (las
  literales se siguen escapando) y las combina con el `--grep` de quien ejecuta, igual que hoy: el filtro **acota**,
  nunca amplía.
- **Proyecto `mobile`:** su `testMatch` pasa de un fichero a una lista: el camino crítico y, si Q2 = sí, el recorrido
  de cuenta (D7) y la privacidad (D7).
- *Descartado:* una etiqueta `@admitted` aparte del lote. Dos etiquetas que dicen lo mismo divergen, y el mapa ya
  necesita el lote. *Descartado:* acumular etiquetas (`@lot1 @lot2`): la comprobación rechaza más de una (D3).

### D2. Mapa e inventario en un solo fichero, `apps/web-e2e/catalog-coverage.json`

Un fichero con dos claves, para que una sola comprobación vea las dos caras (qué cubre cada número y qué hay en cada
fichero):

```jsonc
{
  "catalog": {
    "8": {
      "title": "Invitar y unirse con un código",
      "status": "partial",            // covered | partial | planned | undecided
      "lot": 1,                         // lote que lo cubre (covered/partial) o previsto (planned); ausente en undecided
      "tests": ["critical-path.spec.ts › critical path: sign up, group, link, application, CV and match"],
      "pending": "unirse escribiendo el código y regenerarlo",   // solo partial
      "pendingLot": 3                    // solo partial; null si está por decidir
    },
    "13": { "title": "Lectura automática de la oferta y avisos en vivo", "status": "undecided",
            "reason": "depende de la red y de bolsas reales" }
  },
  "inventory": {
    "links.spec.ts": [
      { "test": "links flow: save, open, import a chat, remove and the private list",
        "state": "not-admitted", "plannedLot": 3,
        "depends": ["mongo", "real-domain", "screenshots"] },
      { "test": "paste error actions fit and keep their order at 360 px", "state": "admitted", "lot": 1 }
    ]
  }
}
```

- **Identidad de una prueba:** `<fichero relativo a src> › <títulos de describe y de la prueba, unidos por ' › '>`,
  la ruta de títulos de Playwright sin proyecto. Un proyecto más (`mobile`) no duplica la prueba.
- **`depends`** es descriptivo, de un vocabulario cerrado (`mongo`, `redis-docker`, `mailpit`, `hard-coded-origin`,
  `real-domain`, `fixed-wait`, `conditional-skip`, `feature-flag`, `vault`, `vapid`, `screenshots`,
  `order-dependent`): recoge H9, H10, H14-H17 donde aplican. La comprobación valida el vocabulario, no la verdad de
  cada dependencia.
- **`state`:** `admitted` (con `lot` = el de su etiqueta), `not-admitted` (con `plannedLot` o `reason`) o
  `informative` (con `reason`: evidencia de otro change que no aspira a admitirse, como `share-notice-time.spec.ts`).
- *Descartado:* el inventario como tabla del README. Nadie lo comprobaría y envejecería en el primer change que añada
  una prueba. *Descartado:* dos ficheros: dos comprobaciones, dos `inputs` y el riesgo de que uno se cachee sin el otro.

### D3. La comprobación vive en la suite y se ejecuta desde `repo-checks`, con el catálogo en sus `inputs`

- **Lógica** en `apps/web-e2e/scripts/lib/coverage.ts`: funciones puras `parseCatalog(markdown)` (solo los `#### <n>.
  <título>` entre `## Recorrido` y el siguiente `## `), `evaluateCoverage(catalog, map, tests)` que devuelve la lista
  de problemas, cada uno con el número o la prueba que nombra. Con Vitest en `scripts/lib/coverage.spec.ts` (lo recoge
  `web-e2e:test`).
- **Orden** `apps/web-e2e/scripts/check-coverage.ts` (`node --import tsx`, como el runner): obtiene las pruebas (D4),
  lee el catálogo y el mapa, imprime qué miró (números, pruebas, admitidas) y sale con ≠0 nombrando cada problema.
- **Invocación** desde un target nuevo, `repo-checks:check-catalog-coverage`, cacheable con `inputs` **explícitos**:
  `{workspaceRoot}/docs/catalogo-de-uso.md`, `{workspaceRoot}/apps/web-e2e/catalog-coverage.json`,
  `{workspaceRoot}/apps/web-e2e/src/**/*`, `{workspaceRoot}/apps/web-e2e/playwright.config.mts`,
  `{workspaceRoot}/apps/web-e2e/scripts/check-coverage.ts`, `{workspaceRoot}/apps/web-e2e/scripts/lib/coverage.ts` y
  `{workspaceRoot}/apps/web-e2e/scripts/tsconfig.json`; añadido al `dependsOn` del agregador (si no, el guardia del
  agregador lo rechaza). Así corre **siempre** en `ci.yml` (paso «Repo checks», incondicional), y en local un cambio
  solo del catálogo cambia el hash y la vuelve a ejecutar.
- **Reglas** (cada una nombra lo que falla): número sin entrada o entrada sin número; título distinto (detecta una
  renumeración); prueba citada inexistente; entrada `covered`/`partial` sin pruebas o con una no admitida; entrada
  `planned`/`undecided` con pruebas; prueba admitida sin ninguna entrada que la cite; prueba sin inventario o inventario
  de una prueba inexistente; `state` que no coincide con la etiqueta (o `lot` distinto del de la etiqueta); una prueba
  con más de una etiqueta de lote; `depends` fuera del vocabulario.
- **Corrige la premisa de C13** (iteración 1 de `e2e-suite`): `repo-checks` también cachea por comprobación; lo que
  aporta es la ejecución incondicional. Queda en ADR-067 §2.
- *Descartado:* target propio de `web-e2e` dentro de `nx affected -t test`. `docs/catalogo-de-uso.md` no pertenece a
  ningún proyecto, y que un cambio solo de ese fichero marque `web-e2e` como afectado dependería de cómo Nx 23 cruza
  `inputs` con ficheros sin dueño: una suposición que este change no necesita hacer. *Descartado:* script `.mjs` dentro
  de `tools/repo-checks/src`: la lógica no tendría Vitest y duplicaría los tipos de la suite.

### D4. La lista de pruebas sale de Playwright, no de leer los ficheros

`check-coverage.ts` lanza `playwright test -c apps/web-e2e/playwright.config.mts --list --reporter=json` con un entorno
mínimo (la lista blanca del runner) y `E2E_BASE_URL=http://coverage.invalid`, para que la configuración **no declare
`webServer`** y nada intente arrancar ni reutilizar un servidor. Del JSON toma, por prueba, fichero, ruta de títulos y
etiquetas (las de `tag`, las de `describe` y las escritas en el título), y deduplica por proyecto.

- `--list` carga los ficheros de prueba (sus `import` y su código de primer nivel), no ejecuta ninguna prueba ni hook.
  La tarea 5.2 comprueba que no abre ningún puerto ni conexión.
- *Descartado:* leer los ficheros con el compilador de TypeScript. Habría que reimplementar cómo Playwright hereda
  etiquetas de `describe`, las que van en el título y los `test.describe.serial`; la comprobación acertaría mientras
  nadie usara una forma nueva.

### D5. Helpers `local-only`: un fixture de prueba con guardia, y el lint que impide rodearlo

- **Dónde:** `apps/web-e2e/src/support/local-only/` exporta `test` (extendido con `test.extend`) y `expect`. El fixture
  `localOnly`, **de ámbito de prueba**, ofrece:
  - `mongo()` → la base de datos de `MONGO_URI` (obligatoria, sin valor por defecto); conexión perezosa, cerrada al
    terminar la prueba;
  - `resetRegisterLimit()` → `docker exec <COMPOSE_PROJECT_NAME>-redis-1 …` (el contenedor del proyecto de compose de la
    corrida; sin variable, solo en el camino antiguo, `linkvault`); **falla** si `docker` falla, en vez de tragarse el
    error;
  - `mailpit.latest({ to, subject })` → el último mensaje para esa dirección y asunto, con sus enlaces, desde
    `E2E_MAILPIT_URL`, una variable nueva **del runner hacia Playwright** (como `E2E_BASE_URL`) calculada del bloque
    efectivo. Se espera con `expect.poll` (aserción con techo), nunca con una espera fija.
- **Guardia:** cada método llama primero a `assertLocalOnly(operation, { tags, profile })`, función pura en
  `scripts/lib/local-only.ts` (con Vitest), que lanza `local-only helper "<operation>" …` si las etiquetas de la prueba
  en curso (`testInfo.tags`) incluyen `@remote-safe`, **en cualquier perfil**, o si `E2E_PROFILE` es `remote`. Las
  operaciones se nombran `mongo`, `redis-docker` y `mailpit`. La comprobación ocurre **antes** de abrir nada.
- **Por qué un fixture:** Playwright no deja usar un fixture de ámbito de prueba en `beforeAll`/`afterAll`, así que
  el guardia siempre ve las etiquetas de **una** prueba: no hay forma de llamar al helper desde un sitio donde la
  prueba en curso sea ambigua. Los trece `beforeAll(resetRegisterLimit)` pasan a
  `beforeEach(({ localOnly }) => localOnly.resetRegisterLimit())`.
- **Lint** (`apps/web-e2e/eslint.config.mjs`, bloque de `src/**`, salvo `src/support/local-only/**`):
  `no-restricted-imports` de `mongodb`, `node:child_process`/`child_process` e `ioredis`; y un selector de
  `no-restricted-syntax` que rechaza literales y plantillas con `localhost`, `127.0.0.1` o `[::1]` en todo `src/**`
  (los helpers no los necesitan: sus direcciones llegan por variable). Los comentarios no cuentan.
- *Descartado:* funciones sueltas con `test.info()`. En un `beforeAll` hay `testInfo`, pero no el de una prueba, y el
  guardia podría no ver la etiqueta. *Descartado:* conectar a Redis con un cliente en lugar de `docker exec`: el
  alcance pide el proyecto de compose por variable y no añade una dependencia al proyecto.

### D6. Limpieza de los specs no admitidos: se arreglan sus supuestos, no se admiten

- `home.spec.ts` y `groups.spec.ts`: el origen sale de `baseURL` (`resolveProfile`), sin literal (H14).
- `public-share.spec.ts`: `/p/:slug` lo sirve la API fuera de `/api`; su origen sale de `PUBLIC_PAGE_BASE_URL` (en
  `e2e.env`, recalculada por el runner), obligatoria y sin valor por defecto. `LINKVAULT_API_ORIGIN` desaparece. Sus
  dos `waitForTimeout` siguen con su excepción de línea (lote 6).
- `links.spec.ts`, `match.spec.ts` y `freshness.spec.ts`: sus escrituras en Mongo pasan a `localOnly.mongo()`.
- `register-limit.ts` desaparece de `support/`; su lógica vive en el fixture (D5).
- **Verificación sin regresión, no en verde:** estos specs no están admitidos y algunos fallan hoy por razones ajenas
  (flags, VAPID, H15). Se ejecutan **antes y después** de la limpieza sobre la misma pila del runner (`--keep-stack`,
  Playwright directo sobre cada fichero con el entorno efectivo de esa pila, como la 5.4 de `e2e-suite`), y el
  resultado por prueba tiene que ser el mismo o mejor; uno peor se arregla o vuelve al design.
- **Lo que no se toca:** las URLs de `linkedin.com` (H17; los canonicalizadores dependen de ellas), las capturas en
  `reports/smoke/` (H16) y el orden de `match.spec.ts` (H15). Van al inventario (`real-domain`, `screenshots`,
  `order-dependent`) y a su lote.

### D7. El lote 2: un recorrido de cuenta, que absorbe tres specs, y la privacidad apta para remoto

- **`account.spec.ts`** (nace con `git mv` de `auth.spec.ts`), una prueba con `test.step` por paso, etiquetas
  `@lot2 @account`, perfil `local` solo (registra y lee correo), **una** alta:

  | # | Paso | Catálogo |
  |---|---|---|
  | 1 | Registro → `/grupos` con el aviso de email sin verificar | 1 |
  | 2 | Recarga: la sesión se restaura por la cookie; el token de acceso no está en `localStorage`, `sessionStorage` ni IndexedDB | 3 |
  | 3 | «Reenviar correo» → `localOnly.mailpit.latest` «Verifica tu email en LinkVault» → enlace (origen = el de la app) → «Email verificado», aviso fuera; el mismo enlace otra vez → «Este enlace no es válido o ha caducado.» | 2 |
  | 4 | Perfil: «Guardar nombre» → «Nombre guardado»; contraseña actual errónea → su error; correcta → «Contraseña cambiada…» | 5 |
  | 5 | «aviso de privacidad» desde `/perfil` → «Aviso de privacidad» con «Tu CV», «IA, OpenRouter y tus claves (BYOK)» y «Borrar tu cuenta» | 6 |
  | 6 | Segundo contexto con sesión; en el primero, «Cerrar sesión» → «Olvidé mi contraseña» → «Enviar instrucciones» → correo «Restablece tu contraseña de LinkVault» → «Guardar contraseña» → «Tu contraseña se ha actualizado…»; entrar con la nueva; el segundo contexto, al recargar, acaba en `/login` | 3, 4 |
  | 7 | «Zona de peligro» → «Borrar mi cuenta» → contraseña → «Borrar cuenta» → `/login`; entrar con esas credenciales → «Email o contraseña incorrectos» | 44 |

  Absorbe todo lo que afirman `auth.spec.ts` (incluido lo del token y `returnUrl`), `auth-email-recovery.spec.ts` y
  `deploy-prod.spec.ts`, que **se borran**: dos copias no reproducibles de lo mismo envejecen distinto. Los textos se
  toman de la interfaz vigente el día de aplicar (los de arriba son los del catálogo).
- **`privacy.spec.ts`**, `@lot2 @privacy @remote-safe` (si Q3 = sí): `/privacidad` **sin sesión**, por URL directa, con
  sus tres secciones. Sin alta ni operación local, así que vale en `remote`: contra staging prueba que nginx sirve el
  SPA en una ruta profunda pública (un riesgo que ADR-053 §Riesgos deja para staging) sin gastar cupo de IA.
- **Proyectos:** `chromium` y, si Q2 = sí, `mobile` (D1).
- **Admisión** (D12 de `e2e-suite`): `--repeat-each=5` con la CPU cargada, una invocación del runner por proyecto y
  perfil, **acotada por etiqueta** (`--grep @account`, `--grep @privacy`) para no gastar el presupuesto de las demás
  (D8). La privacidad, también en el ensayo (`--rehearse-remote --skip-local`).

### D8. Presupuesto de registros: se reparte por etiqueta, no se vacía

Corrida normal (`e2e-stack`, perfil `local`), con `paste-fallback-honest` en `main` y Q2 = sí:

| Prueba | `chromium` | `mobile` |
|---|---|---|
| Camino crítico (A y B) | 2 | 2 |
| `@paste-actions` | 1 | — |
| `@account` | 1 | 1 |
| `@privacy` | 0 | 0 |
| **Total** | **4** | **3** |

7 por corrida (8 con `--rehearse-remote`, por la siembra), bajo el límite de 10. Pero **la admisión del camino crítico
sin filtro dejaría de caber**: en `chromium`, 5 repeticiones × (2 + 1 + 1) = 20. Por eso:

- Las órdenes de «Cómo admitir una prueba» del README llevan **siempre** `--grep <etiqueta propia>`
  (`@critical-path`, `@paste-actions`, `@account`, `@privacy`), y la tabla del presupuesto se rehace por etiqueta.
- Si `chore/e2e-dispatch-admission` está en `main`, su guardia (`project=all` con `repeat_each > 2`) pasa a
  «`repeat_each > 1` exige `grep` y un proyecto», que es la forma de una admisión.
- *Descartado:* vaciar el contador desde las pruebas admitidas que no son aptas para remoto. Haría depender de
  qué prueba corrió antes si otra recibe un `429`, y el camino crítico —apto para remoto— no puede usar el helper.
  *Descartado:* un límite configurable en la API para la suite: cambia el producto para acomodar la prueba. **Riesgo
  anotado para el lote 3**, que añade pruebas con dos personas: tendrá que decidir un vaciado entre ficheros desde el
  runner, en `local`, o repartir más.

### D9. H11: la bóveda, configurada con un valor de relleno

`e2e.env` gana `AI_VAULT_KEY` con 32 bytes en base64 de un texto que dice que no es un secreto (como el de
`infra/ci/verify.env`), en la sección de IA y con su comentario. Con eso guardar una clave propia responde como en
producción. Se verifica con `byok.spec.ts` sobre la pila del runner (`--keep-stack`): el `PUT` de la clave no devuelve
`503` y la rama que hoy se salta se ejecuta. `byok.spec.ts` sigue sin admitir (lote 5). En
`docs/guia-de-uso/README.md`, bajo H11, la línea «**Corregido por el change `e2e-suite-lot-2`:** …».

### D10. Contenido inicial del mapa (contra el `main` de hoy; la 0.4 lo rehace con el del día de aplicar)

| Estado | Números |
|---|---|
| `covered`, lote 1 | 1, 3, 7, 10, 14, 24, 29, 31 (camino crítico) |
| `covered`, lote 2 | 2, 4, 5, 6, 44 (`@account`; el 6 también `@privacy`); 1 y 3 añaden `@account` a sus pruebas |
| `partial`, lote 1 | 8 (falta escribir el código y regenerarlo → 3), 26 (falta el tablero completo → 4); 15 (falta todo salvo las acciones del error de pegado → 3), solo si `@paste-actions` está en `main` |
| `planned` | 9, 11, 12, 15 (si no), 16, 17, 18, 19, 22 → 3; 25, 27, 28 → 4; 30, 32, 33, 34 → 5; 20, 21 → 6; 35, 37, 38, 39 → 7 |
| `undecided` | 13 (red), 23 y 41 (crons), 36 y 46 (CLI), 40 (push), 42 y 43 (extensión), 45 (salud) |

Inventario: una entrada por prueba de cada fichero; `plannedLot` según la columna «Parte de» de D14 de `e2e-suite`
(`groups`, `links`, `comments` → 3; `applications` → 4; `cv`, `match`, `byok` → 5; `public-share` → 6; `search`,
`notifications` → 7); `home.spec.ts` y `freshness.spec.ts` con `reason` («sin lote en el plan»);
`share-notice-time.spec.ts`, `informative`.

### D11. Orden, precedencia y archivo

- **Precedencia:** este change es posterior a la fila 35 (Q3 de `e2e-suite`: la excepción de ADR-053 cubre solo el
  lote 1). No pide excepción. Su **fila en `docs/design-v0.2.md` §6** la asigna el owner (Q1).
- **Precondiciones de `/opsx:apply`:** 35c archivado (la fila 35 cerrada) y `e2e-suite` **archivado**: los dos
  MODIFIED de este delta copian el texto de `openspec/specs/platform/e2e-suite/spec.md`, que solo existe tras ese
  archivo, y la 0.3 compara los dos textos antes de aplicar. `openspec validate` no lo comprueba; `openspec archive`
  sí.
- **Ramas en curso:** `paste-fallback-honest`, `web-shell-capabilities`, `web-error-copy-coverage` y
  `chore/e2e-dispatch-admission`. La 0.4 anota el estado de cada una el día de aplicar; lo que esté en `main` entra en
  el inventario y el mapa, y lo que no, lo añade **el change que llegue segundo** (la comprobación lo exige: una prueba
  nueva sin inventario es rojo).
- **Manifiesto:** la fila `e2e-suite-lot-2` de `openspec-changes.yaml` no se edita aquí: la rama de
  `web-error-copy-coverage` ya reescribe su párrafo de H3/H11, y dos ediciones del mismo párrafo chocarían. Al
  integrar vale la de esa rama.
- **Un PR.** Nada de este change despliega comportamiento nuevo del producto (solo `apps/web-e2e`, `e2e.env`,
  `tools/repo-checks/project.json`, documentación y, si procede, `e2e.yml`); la ventana de fusión la decide el owner
  como en cualquier PR.

## Casos de prueba

Derivados de los escenarios del delta; los nombres son los títulos que se crean.

| Escenario | Prueba |
|---|---|
| Una prueba del segundo lote entra en la corrida | Vitest `args.spec.ts`: «local grep admits every lot tag»; corrida: `--list` muestra `@lot1` y `@lot2` |
| Una prueba sin lote no entra | `args.spec.ts`: «a test without lot tag is not selected» |
| El filtro de quien ejecuta acota | `args.spec.ts`: «caller grep narrows the admitted set», «caller grep cannot widen to non-admitted» |
| Una prueba del segundo lote no apta para remoto | `args.spec.ts`: «remote grep requires a lot tag and remote-safe» |
| Número del catálogo sin entrada | `coverage.spec.ts`: «missing catalog number is named» |
| Catálogo renumerado | `coverage.spec.ts`: «title mismatch names number and both titles» |
| El mapa cita una prueba inexistente | `coverage.spec.ts`: «cited test that does not exist is named» |
| Cobertura con una prueba no admitida | `coverage.spec.ts`: «covered entry citing a non-admitted test fails» |
| Prueba admitida fuera del mapa | `coverage.spec.ts`: «admitted test cited by no entry fails» |
| Cambio solo del catálogo | falsación de la 5.5 (dos corridas de `repo-checks:check-catalog-coverage`, la segunda sin `[local cache]`) |
| Prueba nueva sin inventario | `coverage.spec.ts`: «test missing from inventory is named» |
| Estado que no coincide con la etiqueta | `coverage.spec.ts`: «inventory state contradicting the lot tag fails» |
| (regla extra) | `coverage.spec.ts`: «only the Recorrido headings count as catalog numbers», «two lot tags on one test fail», «unknown depends value fails» |
| Verificación del email / Recuperación / Borrado | `account.spec.ts`: «account: sign up, verify email, profile, privacy, recover password and delete» (pasos 3, 6 y 7) |
| Enlace del correo hacia otro origen | Vitest `local-only.spec.ts`: «mail link outside the app origin is rejected» (la extracción del enlace es pura) |
| Guardar una clave propia en la pila de la suite | verificación de la 4.1 con `byok.spec.ts` sobre la pila del runner |
| Prueba apta para remoto que escribe en la base de datos / lee el correo | `local-only.spec.ts`: «remote-safe test cannot use mongo», «remote-safe test cannot read mailpit»; falsación 2.4 en Playwright |
| Ayudante local con el perfil remoto | `local-only.spec.ts`: «remote profile cannot use redis-docker» |
| Acceso directo a la base de datos fuera de los ayudantes / Origen escrito a mano | falsaciones de lint de la 2.3 |

## Risks / Trade-offs

- [Cada change que añade una prueba e2e tiene que tocar `catalog-coverage.json`] → es el objetivo (la cobertura se
  declara); el mensaje de la comprobación dice qué añadir. Coste: un conflicto de fusión más en ese fichero entre
  ramas paralelas, que se resuelve uniendo las dos entradas.
- [`playwright test --list` ejecuta el código de primer nivel de cada spec] → hoy solo lee fixtures y constantes; un
  spec que conectara a algo al cargarse lo haría también en `repo-checks`. El lint de D5 lo impide para Mongo, Redis y
  `docker`; la 5.2 lo mide.
- [`repo-checks` corre también en `cd-staging` y `cd-prod`] → un mapa roto en `main` pararía el CD. Solo llega a
  `main` con `ci.yml` en rojo en su PR (corre la misma comprobación), así que no añade un camino nuevo de rojo.
- [El presupuesto de registros queda a 3 de su límite en una corrida normal] → D8; el `429` del producto sale
  nombrado en el informe, y el lote 3 hereda la decisión.
- [Borrar `auth`, `auth-email-recovery` y `deploy-prod`] → todo lo que afirman pasa a `account.spec.ts` (la 4.7
  lo coteja línea a línea antes de borrar); `git log --follow` conserva la historia de `auth.spec.ts`.
- [El fixture cambia `beforeAll` por `beforeEach` en trece specs] → en los de varias pruebas vacía el contador más
  veces, que solo da margen; no cambia lo que afirman (D6, verificación antes/después).
- [El texto de la interfaz cambia entre hoy y el día de aplicar] → los textos se toman del código vigente al aplicar
  (D7); el catálogo puede ir por detrás.

## Migration Plan

Aditivo salvo los tres specs absorbidos y `register-limit.ts`. Vuelta atrás: revertir el PR restaura los specs, el
helper y el `@lot1` literal del runner; `repo-checks` pierde su target y su `dependsOn` en el mismo revert. Sin datos
ni secretos.

## Open Questions

- **Q1 — Fila en `docs/design-v0.2.md` §6** **[bloqueante para `/opsx:apply`]**. El change no tiene fila; la Q3 de
  `e2e-suite` lo dejó para después de la fila 35. Opciones: (a) fila 37, tras `golden-sets-reales` (36), desplazando a
  la candidata `web-english-locale`; (b) **∥ 36**, en paralelo a `golden-sets-reales`, tras archivar 35c; (c) entre 35c
  y 36, retrasando la 36. **Recomendación: (b).** La 36 espera a que el uso consentido de 35b produzca casos reales,
  y este change no comparte ficheros con ella (`libs/ai` frente a `apps/web-e2e` y `tools/repo-checks`); ocupa esa
  espera sin retrasarla.
- **Q2 — El lote 2 también en el móvil emulado** **[no bloqueante]**. (a) **sí**, `account.spec.ts` y
  `privacy.spec.ts` en `chromium` y `mobile`; (b) solo `chromium`. **Recomendación: (a).** Las personas invitadas
  usan el móvil (B-V0-2 de `e2e-suite`), recuperar la contraseña es lo primero que harán desde él, y el presupuesto lo
  admite (D8). Si (b), salen la 4.6b y la fila `mobile` de la 4.9.
- **Q3 — La privacidad, apta para remoto y contra staging** **[no bloqueante]**. (a) **sí**, `privacy.spec.ts` con
  `@remote-safe`, que entra en cada `e2e-remote` contra staging; (b) solo `local`. **Recomendación: (a):** sin alta ni
  cupo de IA, y prueba en staging el fallback del SPA de nginx en una ruta profunda pública. Si (b), sale la
  admisión del ensayo de la 4.9 y la etiqueta `@remote-safe`.
- **Q4 — Los hallazgos H8-H10, H12 y H15-H17** **[no bloqueante]**. `usage-guide-fixes` los dejó «en `e2e-suite-lot-2`
  o un change de fixtures». (a) **aquí solo H14** (orígenes, D6) **y H11** (D9); H8 y H12 a un change de fixtures de
  replay; H9, H10 y H15-H17 a su lote, anotados en `depends` del inventario; (b) además H16 aquí (las capturas a
  `dist/`). **Recomendación: (a):** H16 toca todos los specs no admitidos para un efecto que solo ve quien usa el camino
  antiguo, y su lote los reescribe de todos modos.

## Debate

Pendiente: lo orquesta la sesión principal (`/lv:debate`) con `critic` y `business`. Puntos que conviene que miren:
la forma del mapa e inventario (D2), la corrección de la premisa de C13 (D3), el fixture frente a funciones sueltas
(D5), borrar los tres specs absorbidos (D7) y el presupuesto de registros (D8).
