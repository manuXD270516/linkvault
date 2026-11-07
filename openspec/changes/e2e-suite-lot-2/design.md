## Context

Motivación en `proposal.md` §Why; decisiones de fondo en **ADR-067** (propuesto). Este change es el **lote 2** que
`e2e-suite` dejó anotado (design D9 y D14 de ese change, R-18 y B-V1-7 de su debate, C13 de su iteración 1) y que
ADR-053 §4 y §7 aplazaron. Estado de partida:

- **Lo reproducible es lo etiquetado `@lot1`.** El runner (`apps/web-e2e/scripts/e2e-stack.ts`) fija
  `LOCAL_TAGS = ['@lot1']` y `REMOTE_TAGS = ['@lot1', '@remote-safe']`, y `playwrightGrepArgs` (`scripts/lib/args.ts`)
  combina esas etiquetas con el `--grep` de quien ejecuta (todas a la vez, con lookaheads). En `main` hay **una**
  prueba admitida, el camino crítico (`critical-path.spec.ts`, proyectos `chromium` y `mobile`).
- **Otras ramas tocan la suite.** `paste-fallback-honest` admite «paste error actions fit and keep their order at 360
  px» en `links.spec.ts` (`@lot1 @paste-actions`, solo `chromium`, **registra una cuenta**), y su tarea 5.6c ya añade
  `--grep @critical-path` a la orden de readmisión del camino crítico con `--repeat-each=5`. `web-shell-capabilities`
  cambia `critical-path.spec.ts` (navegación por el shell) y el título de la prueba de `search.spec.ts`, y añade el
  módulo de apoyo `support/shell-nav.ts`, que **no es una prueba**: no tiene entrada en el inventario, pero entra en los
  `inputs` de la comprobación (D3). El inventario y el mapa se escriben **contra el `main` del día de aplicar** (0.4).
- **Los specs no admitidos** dependen del entorno (guía de uso H14-H17; design D1 de `e2e-suite`): `localhost` escrito
  en `home` y `groups`, `LINKVAULT_API_ORIGIN ?? 'http://localhost:3000'` en `public-share`, `MongoClient` directo en
  `links`, `match` y `freshness`, y `register-limit.ts` con `docker exec linkvault-redis-1`. **Este change no los toca**
  (B1 de la iteración 1): su limpieza va con el lote que los admita, y el lint los exime por el inventario (D5).
- **El presupuesto de registros es de 10 intentos cada 15 minutos por IP**, constante en el código
  (`REGISTRATIONS_PER_IP = 10`, `apps/api/src/modules/auth/domain/attempt-limits.ts`): no hay variable para subirlo en
  la suite. La admisión del camino crítico ya gasta exactamente 10 por proyecto (design D5 de `e2e-suite`).
- **El catálogo** (`docs/catalogo-de-uso.md`) titula el recorrido con encabezados `#### <n>. <título>` del 1 al 46 bajo
  `## Recorrido`; la sección «Preparar el entorno local» reutiliza los números 1 a 6 con `### `, y al final hay una
  «Tabla de control». La comprobación lee solo los `####` de `## Recorrido`.
- **`repo-checks` no es «lo que no cachea».** El agregador `repo-checks:check` lleva `cache: false`, pero cada
  comprobación es un target `check-<nombre>` **cacheable con `inputs` explícitos** (regla 1 de
  `tools/repo-checks/project.json`). La disyuntiva de C13 de `e2e-suite` es falsa; lo que da `repo-checks` es
  ejecutarse **siempre** en `ci.yml`.
- **`e2e.env` no tiene `AI_VAULT_KEY`** (H11). `infra/ci/verify.env` ya lleva una de relleno.
- **`chore/e2e-dispatch-admission`** (rama local, sin subir; cabeza `c31ba3e`) añade a `e2e.yml` las entradas
  `project`, `grep`, `repeat_each`, `skip_local` y `cpu_load` y ya **exige, con `repeat_each > 1`, un `project` concreto
  y un `grep`**: la forma de una admisión por etiqueta que este change necesita (D8).
- **H3** lo absorbió `web-error-copy-coverage` (Q2 = (a) de ese change, 2026-10-29). Aquí no se toca.

## Goals / Non-Goals

**Goals:**

- Que «admitida» signifique lo mismo en el runner, en el mapa y en el README: **una etiqueta `@lot<N>`**.
- El **mapa de cobertura** y el **inventario**, con una comprobación que no pueda quedarse verde por caché.
- El **guardia `local-only`** con su regla `@remote-safe` en cualquier perfil, el **fixture** que lo usa para Mailpit y
  el lint que impide rodearlo.
- El **lote 2**: cuenta y salida (catálogo 1-6 y 44, con Mailpit), admitido con carga.
- **H11**: la bóveda configurada en la suite.

**Non-Goals:**

- La limpieza de los specs no admitidos (orígenes de H14, Mongo, `register-limit.ts`) y los métodos `mongo()` y de
  vaciado del contador del fixture: llegan con el primer lote que admita `links`, `match` o `freshness` (B1).
- Admitir ningún spec existente salvo lo que absorbe el recorrido de cuenta.
- H3 (`web-error-copy-coverage`), H7 (change con datos reales de 35b), H8 y H12 (fixtures), H9, H10, H14 y H15-H17
  (sus lotes) — Q4.
- Subir el límite de registros por IP ni vaciarlo entre pruebas admitidas (D8).
- Ejecutar la suite remota tras cada despliegue (Q4 de `e2e-suite`) o cambiar sus disparadores (Q2 de `e2e-suite`).
- Tocar `ci.yml`, `cd-staging.yml` o `cd-prod.yml`: la comprobación entra por `repo-checks`, que ya invocan.

## Decisions

### D1. Admitida = una etiqueta `@lot<N>`; el runner ejecuta todos los lotes

- **Regla:** una prueba está admitida si lleva **exactamente una** etiqueta que casa con `^@lot[1-9][0-9]*$`. El
  número registra **en qué lote se admitió**, no a qué lote del plan pertenece su funcionalidad (eso lo dice el mapa,
  D2): la prueba de `paste-fallback-honest` es `@lot1` aunque su funcionalidad (catálogo 15) sea del lote 3. Un change
  que no es de la serie y admite una prueba usa el número del **último lote archivado** en ese momento.
- **Dónde vive:** en `scripts/lib/args.ts`, `ADMITTED = '@lot[1-9][0-9]*(?![0-9A-Za-z_-])'` y
  `profileGrepConditions(profile)`, que devuelve `[ADMITTED]` en `local` y `[ADMITTED, '@remote-safe']` en `remote`
  (C1). `e2e-stack.ts` la importa en vez de declarar `LOCAL_TAGS`/`REMOTE_TAGS`; `playwrightGrepArgs` acepta esas
  condiciones (ya escritas como expresión) y las combina con el `--grep` de quien ejecuta, igual que hoy: el filtro
  **acota**, nunca amplía. La 1.1 falsa rompiendo `profileGrepConditions`, no el runner.
- **Ensayo sin pruebas (C23):** con `--rehearse-remote`, el runner lista antes del ensayo (`--list` con el `--grep` de
  `remote`) y falla, sin reiniciar `worker`, si no queda ninguna prueba: «el filtro no deja ninguna prueba apta para
  remoto».
- **Proyecto `mobile`:** su `testMatch` pasa de un fichero a dos: el camino crítico y, si Q2 = (a), `account.spec.ts`.
- *Descartado:* una etiqueta `@admitted` aparte del lote. Dos etiquetas que dicen lo mismo divergen. *Descartado:*
  acumular etiquetas (`@lot1 @lot2`): la comprobación rechaza más de una (D3).

### D2. Mapa e inventario en un solo fichero, `apps/web-e2e/catalog-coverage.json`

Un fichero con dos claves, para que una sola comprobación vea las dos caras:

```jsonc
{
  "catalog": {
    // Clave = el título del `####` sin su número (B2). `number` es informativo: renumerar el catálogo no rompe nada.
    "Invitar y unirse con un código": {
      "number": 8,
      "status": "partial",               // covered | partial | planned | undecided
      "tests": ["critical-path.spec.ts › critical path: sign up, group, link, application, CV and match"],
      "pending": "unirse escribiendo el código y regenerarlo (lote 3)"   // solo partial
    },
    "Lectura automática de la oferta y avisos en vivo": {
      "number": 13, "status": "undecided", "reason": "depende de la red y de bolsas reales" },
    "Administrar el grupo": { "number": 9, "status": "planned", "lot": 3, "reason": "groups.spec.ts" }
  },
  "inventory": {
    "links.spec.ts": [
      { "test": "links flow: save, open, import a chat, remove and the private list",
        "state": "not-admitted", "lot": 3, "reason": "escribe en Mongo; URL de linkedin.com (H17)" },
      { "test": "paste error actions fit and keep their order at 360 px", "state": "admitted" }
    ]
  }
}
```

- **Identidad de una prueba:** `<fichero relativo a src> › <títulos de describe y de la prueba, unidos por ' › '>`,
  la ruta de títulos de Playwright sin proyecto. Un proyecto más (`mobile`) no duplica la prueba.
- **Lote:** en `covered` y `partial` **no se escribe**: es el menor lote de las pruebas citadas (C17). En `planned` y
  en `not-admitted`, `lot` es **opcional** (el previsto); en `undecided` y `informative`, no hay (B4). Lo descriptivo
  —dependencias de entorno, H9, H10, H14-H17— va en `reason` o `pending`, en texto (B4: fuera el vocabulario `depends`
  y `pendingLot`).
- **`state` del inventario:** `admitted` (su lote sale de su etiqueta), `not-admitted` (con `reason` y `lot` opcional)
  o `informative` (con `reason`: evidencia de otro change que no aspira a admitirse, como `share-notice-time.spec.ts`).
- *Descartado:* el inventario como tabla del README: nadie lo comprobaría. *Descartado:* dos ficheros: dos
  comprobaciones y el riesgo de que uno se cachee sin el otro. *Descartado:* indexar por número (versión anterior):
  una funcionalidad insertada en medio del catálogo obligaba a renumerar medio mapa sin que cambiara ninguna cobertura.

### D3. La comprobación vive en la suite y se ejecuta desde `repo-checks`, con todo lo que la alimenta en sus `inputs`

- **Lógica** en `apps/web-e2e/scripts/lib/coverage.ts`: `parseCatalog(markdown)` (solo los `#### <n>. <título>` entre
  `## Recorrido` y el siguiente `## `; devuelve títulos con su número) y `evaluateCoverage(catalog, map, tests)`, que
  devuelve la lista de problemas, cada uno con el título o la prueba que nombra. Vitest en `scripts/lib/coverage.spec.ts`.
- **Orden** `apps/web-e2e/scripts/check-coverage.ts` (`node --import tsx`, como el runner): obtiene las pruebas (D4),
  lee el catálogo y el mapa, imprime qué miró (funcionalidades, pruebas, admitidas) y sale con ≠0 nombrando cada
  problema.
- **Invocación** desde un target nuevo, `repo-checks:check-catalog-coverage`, cacheable con `inputs` explícitos (C3):
  - `{workspaceRoot}/docs/catalogo-de-uso.md`;
  - `{workspaceRoot}/apps/web-e2e/**/*`, salvo informes y salidas (`!{workspaceRoot}/apps/web-e2e/**/playwright-report/**`,
    `!{workspaceRoot}/apps/web-e2e/**/test-results/**`), que cubre el mapa, los specs, sus apoyos, el runner y su
    configuración;
  - `{workspaceRoot}/libs/shared/**/*` (los specs importan sus esquemas) y `{workspaceRoot}/tsconfig.base.json` (las
    rutas `@linkvault/*`);
  - `{ "externalDependencies": ["@playwright/test", "tsx"] }`;
  - y se añade al `dependsOn` del agregador (si no, el guardia del agregador lo rechaza).

  Corre **siempre** en `ci.yml` (paso «Repo checks», incondicional), y en local un cambio solo del catálogo o de un
  módulo de la suite cambia el hash y la vuelve a ejecutar.
- **Reglas** (cada una nombra lo que falla): título del catálogo sin entrada o entrada sin título en el catálogo; prueba
  citada inexistente; entrada `covered`/`partial` sin pruebas o con una no admitida; entrada `planned`/`undecided` con
  pruebas; `lot` escrito en una entrada `covered`/`partial`; prueba admitida sin ninguna entrada que la cite; prueba sin
  inventario o inventario de una prueba inexistente; `state` que no coincide con la etiqueta; una prueba con más de una
  etiqueta de lote.
- **Cabecera de `infra/ci/repo-checks.sh`** (C16): una línea que dice que `check-catalog-coverage` ejecuta la lógica de
  `apps/web-e2e` y lanza Playwright en modo lista, para que nadie lo busque en `tools/repo-checks/src`.
- **Corrige la premisa de C13** de `e2e-suite`: queda en ADR-067 §2.
- *Descartado:* target propio de `web-e2e` dentro de `nx affected -t test`: que un cambio solo de
  `docs/catalogo-de-uso.md`, que no pertenece a ningún proyecto, marque `web-e2e` como afectado dependería de cómo Nx
  cruza `inputs` con ficheros sin dueño. *Descartado:* un `.mjs` en `tools/repo-checks/src`: sin Vitest y con los tipos
  de la suite duplicados.

### D4. La lista de pruebas sale de Playwright en modo lista, sin montar nada

`check-coverage.ts` lanza `playwright test -c apps/web-e2e/playwright.config.mts --list --reporter=json`, con la
**lista blanca mínima** del runner (D6 de `e2e-suite`), `E2E_BASE_URL=http://coverage.invalid` —para que la
configuración no declare `webServer`— y `PLAYWRIGHT_JSON_OUTPUT_FILE` hacia un directorio temporal propio que borra al
terminar (C16), en vez de leer la salida estándar. Del JSON toma, por prueba, fichero, ruta de títulos y etiquetas (las
de `tag`, las de `describe` y las escritas en el título), y deduplica por proyecto.

- **Regla general (C9):** ningún spec **admitido**, ni ningún módulo de apoyo que importe, lee una variable
  **obligatoria** a nivel de módulo: las lee dentro de la prueba o del fixture. Así `--list` carga los ficheros con la
  lista blanca mínima sin fallar por una variable que solo pone el runner. La 5.2 lo comprueba corriendo con esa lista.
- `--list` no ejecuta ninguna prueba ni hook; la 5.2 comprueba que no abre ningún puerto.
- La misma vía sirve para la 1.2 (C18): `playwright test --list` con el `--grep` que calcula `profileGrepConditions`,
  sin pasar por `e2e-stack`.
- *Descartado:* leer los ficheros con el compilador de TypeScript: habría que reimplementar cómo Playwright hereda
  etiquetas de `describe` y las del título.

### D5. El guardia `local-only`, un fixture que nace solo con Mailpit, y el lint que impide rodearlo

- **Guardia** (`scripts/lib/local-only.ts`, puro, con Vitest): `assertLocalOnly(operation, { tags, profile })` lanza
  `local-only helper "<operation>" …` si las etiquetas de la prueba en curso incluyen `@remote-safe`, **en cualquier
  perfil**, o si el perfil es `remote`. Las tres operaciones —`mongo`, `redis-docker` y `mailpit`— están en su tipo y se
  prueban las tres en Vitest, aunque solo `mailpit` tenga hoy un método (B1).
- **Cliente de Mailpit con conector inyectable** (C6, C10), en el mismo módulo:
  `createMailpit({ baseUrl, fetch, guard })` con `latest({ to, subject, after })`, que llama primero al guardia y solo
  después a `fetch`; la selección del mensaje es una función pura, `pickLatest(messages, { to, subject, after })` (el
  último para esa dirección y asunto con fecha **posterior** a `after`, para no tomar el correo de una acción anterior);
  y `mailLinkPath(link, appOrigin)` devuelve ruta y consulta del enlace, y lanza si su origen no es el de la aplicación.
  La espera del correo es un `expect.poll` (aserción con techo), nunca una espera fija.
- **Fixture** (`src/support/local-only/index.ts`): `test = base.extend<{ localOnly }>`, **de ámbito de prueba**, con
  `localOnly.mailpit`, construido con el `fetch` global, las etiquetas de `testInfo` y `E2E_MAILPIT_URL` —variable nueva
  **del runner hacia Playwright** (como `E2E_BASE_URL`), calculada del bloque efectivo, solo en el perfil `local`—. Si
  falta la variable, el método falla **nombrándola** (C21). Un fixture de ámbito de prueba no se puede usar en
  `beforeAll`/`afterAll`, así que el guardia siempre ve las etiquetas de una sola prueba. `mongo()` y
  `resetRegisterLimit()` llegan con el lote que admita `links`, `match` o `freshness`, sobre el mismo guardia.
- **Exención por inventario (B1):** `eslint.config.mjs` lee `catalog-coverage.json` y calcula `EXEMPT_FILES` = los
  ficheros con **alguna** prueba `not-admitted`. No hay lista a mano: la comprobación de D3 hace que el inventario diga
  la verdad (un estado que no coincide con la etiqueta es rojo), y quitar la exención exige admitir o retirar las
  pruebas. El `lint` de `web-e2e` ya tiene el JSON entre sus `inputs` (está dentro del proyecto).
- **Composición de bloques de ESLint** (C8). ESLint no combina las opciones de `no-restricted-syntax` entre bloques: el
  último bloque que casa con un fichero gana entero. Por eso cada bloque lleva **su lista completa**:

  | Bloque (`files` / `ignores`) | `no-restricted-syntax` | `no-restricted-imports` |
  |---|---|---|
  | `src/**/*.ts` | base (SDKs de IA) + esperas fijas + bucle local + acceso local (C7) | `mongodb`, `child_process`, `node:child_process`, `ioredis` |
  | `src/support/local-only/**` | base + esperas fijas | — |
  | `EXEMPT_FILES` | base + esperas fijas | — |

  - **Bucle local:** literales y plantillas con `localhost`, `127.0.0.1` o `[::1]`.
  - **Acceso local (C7):** `ImportExpression` y `require(…)` de `mongodb`, `child_process`, `node:child_process` e
    `ioredis`; y `process.env.X` / `process.env['X']` con `E2E_MAILPIT_URL`, `MONGO_URI`, `REDIS_URL` y
    `COMPOSE_PROJECT_NAME`.
  - Las esperas fijas siguen en **los tres** bloques: la 2.3 lo falsa con un `setTimeout` en `home.spec.ts` (exento) y
    otro en `local-only/index.ts`.
- *Descartado:* funciones sueltas con `test.info()`: en un `beforeAll` hay `testInfo`, pero no el de una prueba.
  *Descartado:* una lista de exención escrita a mano en la configuración: se quedaría atrás del inventario.

### D6. (Retirada en la iteración 1: la limpieza de los specs no admitidos va a su lote, B1.)

### D7. El lote 2: un recorrido de cuenta que absorbe tres specs

`account.spec.ts` (nace con `git mv` de `auth.spec.ts`), una prueba con `test.step` por paso, etiquetas `@lot2
@account`, perfil `local` solo (registra y lee correo), **una** alta:

| # | Paso | Catálogo |
|---|---|---|
| 0 | `/privacidad` **sin sesión, por URL directa** → «Aviso de privacidad» con «Tu CV», «IA, OpenRouter y tus claves (BYOK)» y «Borrar tu cuenta», sin pasar por `/login` | 6 |
| 1 | Registro → `/grupos` con el aviso de email sin verificar | 1 |
| 2 | Recarga: la sesión se restaura por la cookie; el token de acceso no está en `localStorage`, `sessionStorage` ni IndexedDB | 3 |
| 3 | «Reenviar correo» → `localOnly.mailpit.latest({ after })` «Verifica tu email en LinkVault» → enlace (origen = el de la app) → «Email verificado», aviso fuera; el mismo enlace otra vez → «Este enlace no es válido o ha caducado.» | 2 |
| 4 | Perfil: «Guardar nombre» → «Nombre guardado»; contraseña actual errónea → su error; correcta → «Contraseña cambiada…» | 5 |
| 5 | «aviso de privacidad» desde `/perfil` → la misma página | 6 |
| 6 | Segundo contexto con sesión; en el primero, «Cerrar sesión» → «Olvidé mi contraseña» → «Enviar instrucciones» → correo «Restablece tu contraseña de LinkVault» → «Guardar contraseña» → «Tu contraseña se ha actualizado…»; entrar con la nueva; el segundo contexto, al recargar, acaba en `/login` | 3, 4 |
| 7 | «Zona de peligro» → «Borrar mi cuenta» → contraseña → «Borrar cuenta» → `/login`; entrar con esas credenciales → «Email o contraseña incorrectos» | 44 |

- Absorbe todo lo que afirman `auth.spec.ts` (incluido el token y `returnUrl`), `auth-email-recovery.spec.ts` y
  `deploy-prod.spec.ts`, que **se borran**: dos copias no reproducibles de lo mismo envejecen distinto. Los textos se
  toman de la interfaz vigente el día de aplicar.
- **La privacidad no es una prueba aparte apta para remoto (B3, Q3 retirada).** El paso 0 es suficiente para el
  catálogo 6 y la variante remota no añade cobertura: el camino crítico en `remote` ya entra en staging por rutas
  profundas del SPA, así que el fallback de nginx ya está probado allí. Una prueba más contra staging sería otra corrida
  que vigilar sin nada nuevo que encontrar.
- **Proyectos:** `chromium` y, si Q2 = (a), `mobile` (D1).
- **Admisión** (D12 de `e2e-suite`): `--repeat-each=5` con la CPU cargada, una invocación del runner por proyecto,
  **acotada** con `--grep @account` para no gastar el presupuesto de las demás (D8). No hay ensayo: no es apta para
  remoto.

### D8. Presupuesto de registros: se reparte por etiqueta, no se vacía

Corrida normal (`e2e-stack`, perfil `local`), con `paste-fallback-honest` en `main` y Q2 = (a):

| Prueba | `chromium` | `mobile` |
|---|---|---|
| Camino crítico (A y B) | 2 | 2 |
| `@paste-actions` | 1 | — |
| `@account` | 1 | 1 |
| **Total** | **4** | **3** |

7 por corrida (8 con `--rehearse-remote`, por la siembra): **margen de 3** (2 con el ensayo). Admisiones, una
invocación por proyecto con `--repeat-each=5`:

| Admisión | Registros | Margen |
|---|---|---|
| `--grep @critical-path`, `chromium` o `mobile` | 10 | 0 |
| `--grep @paste-actions`, `chromium` | 5 | 5 |
| `--grep @account`, `chromium` o `mobile` | 5 | 5 |
| Ensayo del camino crítico (`--rehearse-remote --skip-local`) | 1 | 9 |

- **Sin filtro, la admisión del camino crítico dejaría de caber**: en `chromium`, 5 × (2 + 1 + 1) = 20. Por eso las
  órdenes de «Cómo admitir una prueba» del README llevan **siempre** `--grep <etiqueta propia>`. La de readmisión del
  camino crítico ya la corrige la 5.6c de `paste-fallback-honest` (C11); aquí la 4.10 lo **confirma** y añade la de
  `@account`. El guardia de `e2e.yml` de `chore/e2e-dispatch-admission` (`c31ba3e`) ya exige `project` y `grep` con
  `repeat_each > 1` (C12).
- **La 4.8 imprime el margen** (registros usados y restantes hasta 10, por proyecto y en la corrida entera) a partir de
  `stack-logs/api.log`, y el README publica las dos tablas (B6).
- **Un `429` en un reintento de CI es consecuencia, no causa** (C22): el reintento de `retries: 1` vuelve a registrar,
  y si el primer intento falló por otra cosa, el `429` del segundo solo dice que el presupuesto no da para dos. Se lee
  el primer intento. Una línea en el README.
- *Descartado:* vaciar el contador desde las pruebas admitidas no aptas para remoto: haría depender de qué prueba
  corrió antes si otra recibe un `429`, y el camino crítico —apto para remoto— no puede usar el helper.
  *Descartado:* un límite configurable para la suite: cambia el producto para acomodar la prueba. **Riesgo para el
  lote 3**, que añade pruebas con dos personas: tendrá que decidir un vaciado entre ficheros desde el runner, en
  `local`, o repartir más.

### D9. H11: la bóveda, configurada con un valor de relleno

`e2e.env` gana `AI_VAULT_KEY` con 32 bytes en base64 de un texto que dice que no es un secreto (como el de
`infra/ci/verify.env`), en la sección de IA y con su comentario. Se verifica con `byok.spec.ts` sobre la pila del runner
(`--keep-stack`): el `PUT` de la clave no devuelve `503`. `byok.spec.ts` sigue sin admitir (lote 5). En
`docs/guia-de-uso/README.md`, bajo H11, «**Corregido por el change `e2e-suite-lot-2`:** …».

### D10. Contenido inicial del mapa (contra el `main` de hoy; la 0.4 lo rehace con el del día de aplicar)

Por número informativo:

| Estado | Números |
|---|---|
| `covered` por el lote 1 | 1, 3, 7, 10, 14, 24, 29, 31 (camino crítico; 1 y 3 citan también `@account`) |
| `covered` por el lote 2 | 2, 4, 5, 6, 44 (`@account`) |
| `partial` | 8 (falta escribir el código y regenerarlo, lote 3), 26 (falta el tablero completo, lote 4); 15 (falta todo salvo las acciones del error de pegado, lote 3), solo si `@paste-actions` está en `main` |
| `planned` | 9, 11, 12, 15 (si no), 16, 17, 18, 19, 22 → 3; 25, 27, 28 → 4; 30, 32, 33, 34 → 5; 20, 21 → 6; 35, 37, 38, 39 → 7 |
| `undecided` | 13 (red), 23 y 41 (crons), 36 y 46 (CLI), 40 (push), 42 y 43 (extensión), 45 (salud) |

Inventario: una entrada por prueba de cada fichero; `lot` previsto según la columna «Parte de» de D14 de `e2e-suite`
(`groups`, `links`, `comments` → 3; `applications` → 4; `cv`, `match`, `byok` → 5; `public-share` → 6; `search`,
`notifications` → 7); `home.spec.ts` y `freshness.spec.ts` sin `lot` y con `reason` («sin lote en el plan»);
`share-notice-time.spec.ts`, `informative`. Las dependencias de entorno de cada una (H9, H10, H14-H17), en `reason`.

### D11. Orden, precedencia y archivo

- **Precedencia:** este change es posterior a la fila 35 (Q3 de `e2e-suite`). No pide excepción. Su **fila en
  `docs/design-v0.2.md` §6** la asigna el owner (Q1).
- **Precondiciones de `/opsx:apply`:** 35c archivado y `e2e-suite` **archivado**, cuyo grupo 9 sigue bloqueado por
  35b (C24): los tres MODIFIED de este delta copian el texto de `openspec/specs/platform/e2e-suite/spec.md`, que solo
  existe tras ese archivo, y la 0.3 compara los tres bloques. `openspec validate` no lo comprueba; `openspec archive`
  sí.
- **Ramas en curso:**
  - `paste-fallback-honest`: su 5.6c ya pone `--grep @critical-path` en la readmisión del camino crítico (C11).
  - `chore/e2e-dispatch-admission` (`c31ba3e`): su guardia ya exige `project` y `grep` con `repeat_each > 1` (C12).
  - `web-shell-capabilities` y `web-error-copy-coverage`.
  La 0.4 anota el estado de cada una el día de aplicar; lo que esté en `main` entra en el inventario y el mapa. Y, si
  `web-shell-capabilities` o `paste-fallback-honest` siguen abiertas, deja en su grupo de cierre la línea «si
  `e2e-suite-lot-2` está en `main`: entrada en `catalog-coverage.json`» (C15): la comprobación lo exigiría de todos
  modos, pero así no les llega como sorpresa.
- **Manifiesto:** la fila `e2e-suite-lot-2` de `openspec-changes.yaml` no se edita aquí: la rama de
  `web-error-copy-coverage` ya reescribe su párrafo de H3/H11. Al integrar vale la de esa rama.
- **Un PR.** Nada de este change despliega comportamiento nuevo del producto (solo `apps/web-e2e`, `e2e.env`,
  `tools/repo-checks/project.json`, la cabecera de `repo-checks.sh` y documentación).

## Casos de prueba

Derivados de los escenarios del delta; los nombres son los títulos que se crean.

| Escenario | Prueba |
|---|---|
| Una prueba del segundo lote entra en la corrida | Vitest `args.spec.ts`: «local grep admits every lot tag»; 1.2 con `--list` |
| Una prueba sin lote no entra | `args.spec.ts`: «a test without lot tag is not selected» |
| El filtro de quien ejecuta acota | `args.spec.ts`: «caller grep narrows the admitted set», «caller grep cannot widen to non-admitted» |
| Una prueba del segundo lote no apta para remoto | `args.spec.ts`: «remote grep requires a lot tag and remote-safe» |
| Ensayo sin pruebas aptas para remoto | 1.3: `--rehearse-remote --skip-local --grep @account` falla antes del ensayo |
| Funcionalidad del catálogo sin entrada | `coverage.spec.ts`: «catalog title without entry is named» |
| Título cambiado | `coverage.spec.ts`: «changed title names the missing and the extra entry» |
| El mapa cita una prueba inexistente | `coverage.spec.ts`: «cited test that does not exist is named» |
| Cobertura con una prueba no admitida | `coverage.spec.ts`: «covered entry citing a non-admitted test fails» |
| Prueba admitida fuera del mapa | `coverage.spec.ts`: «admitted test cited by no entry fails» |
| Cambio solo del catálogo / de un módulo de la suite | falsaciones (a) y (f) de la 5.5 (segunda corrida sin `[local cache]`) |
| Prueba nueva sin inventario | `coverage.spec.ts`: «test missing from inventory is named» |
| Estado que no coincide con la etiqueta | `coverage.spec.ts`: «inventory state contradicting the lot tag fails» |
| Un fichero solo con pruebas admitidas no queda exento | falsaciones (b) y (e) de la 2.3 |
| (reglas extra) | `coverage.spec.ts`: «only the Recorrido headings count», «renumbering alone changes nothing», «lot written on a covered entry fails», «two lot tags on one test fail» |
| Aviso de privacidad por URL directa / Verificación / Recuperación / Borrado | `account.spec.ts`: «account: privacy, sign up, verify email, profile, recover password and delete» (pasos 0, 3, 6, 7) |
| Enlace del correo hacia otro origen | `local-only.spec.ts`: «mail link outside the app origin is rejected» |
| (selección del correo) | `local-only.spec.ts`: «pickLatest ignores mail older than after», «pickLatest picks the newest for that address and subject» |
| Guardar una clave propia en la pila de la suite | 4.1 con `byok.spec.ts` sobre la pila del runner |
| Prueba apta para remoto que lee el correo, en local | `local-only.spec.ts`: «remote-safe test cannot read mailpit», «guard throws before the connector is invoked» (espía con cero llamadas); 2.4 en Playwright |
| Ayudante local con el perfil remoto | `local-only.spec.ts`: «remote profile cannot use mailpit», más «remote-safe test cannot use mongo» y «remote profile cannot use redis-docker» (las tres operaciones, B1) |
| Ayudante sin la dirección de la pila | `local-only.spec.ts`: «missing E2E_MAILPIT_URL is named» |
| Acceso directo / lectura de la dirección / origen escrito a mano | falsaciones (a), (b), (c) y (d) de la 2.3 |
| Otra prueba admitida en el primer lote | la corrida de la 7.2 con `@paste-actions` en `main` |

## Risks / Trade-offs

- [Cada change que añade una prueba e2e tiene que tocar `catalog-coverage.json`] → es el objetivo (la cobertura se
  declara); el mensaje de la comprobación dice qué añadir, y la nota de C15 avisa a las ramas abiertas.
- [Un fichero con alguna prueba no admitida queda exento entero del lint de acceso local] → `links.spec.ts`, con
  `@paste-actions` admitida, puede seguir abriendo Mongo en sus otras pruebas; el guardia de tiempo de ejecución no lo ve
  porque no pasa por el fixture. Se acepta hasta que su lote limpie el fichero (B1).
- [`playwright test --list` ejecuta el código de primer nivel de cada spec] → la regla de C9 lo acota para los
  admitidos; los no admitidos hoy solo leen constantes y fixtures. La 5.2 lo mide.
- [`repo-checks` corre también en `cd-staging` y `cd-prod`] → un mapa roto en `main` pararía el CD; solo llega allí con
  `ci.yml` en rojo en su PR, que corre la misma comprobación.
- [El presupuesto de registros queda a 3 de su límite en una corrida normal] → D8; el `429` sale nombrado, y el lote 3
  hereda la decisión.
- [Borrar `auth`, `auth-email-recovery` y `deploy-prod`] → la 4.7 coteja cada aserción antes de borrar; `git log
  --follow` conserva la historia de `auth.spec.ts`.
- [Las primeras invitaciones de 35b no quedan cubiertas por este lote] (B5) → el lote 2 llega después de cerrar la fila
  35: cuando las primeras personas recuperen su contraseña o borren su cuenta en staging, lo que lo cubre es el
  recorrido a mano de 35b, no esta suite.
- [El texto de la interfaz cambia entre hoy y el día de aplicar] → los textos se toman del código vigente al aplicar.

## Migration Plan

Aditivo salvo los tres specs absorbidos. Vuelta atrás: revertir el PR restaura los specs y el `@lot1` literal del
runner; `repo-checks` pierde su target y su `dependsOn` en el mismo revert. Sin datos ni secretos.

## Open Questions

- **Q1 — Fila en `docs/design-v0.2.md` §6** **[bloqueante para `/opsx:apply`]**. Opciones: (a) fila 37, tras
  `golden-sets-reales` (36), desplazando a la candidata `web-english-locale`; (b) **∥ 36**, en paralelo a
  `golden-sets-reales`, tras archivar 35c **y `e2e-suite`** (cuyo grupo 9 está bloqueado por 35b, C24); (c) entre 35c y
  36, retrasando la 36. **Recomendación: (b)** (mantenida en la iteración 1, B7): la 36 espera a que el uso consentido
  de 35b produzca casos reales, y este change no comparte ficheros con ella.
- **Q2 — El lote 2 también en el móvil emulado** **[no bloqueante]**. (a) **sí**, `account.spec.ts` en `chromium` y
  `mobile`; (b) solo `chromium`. **Recomendación: (a)** (mantenida, B7): las personas invitadas usan el móvil, y el
  presupuesto lo admite (D8). Si (b), salen la 4.6b y la 4.9b.
- **Q3** — retirada en la iteración 1 (B3): la privacidad es el paso 0 de `account.spec.ts`, solo `local`; motivo en
  D7.
- **Q4 — Los hallazgos H8-H10, H12 y H14-H17** **[no bloqueante]**. (a) **aquí solo H11** (D9); H8 y H12 a un change
  de fixtures de replay; H9, H10 y H15-H17 a su lote, anotados en `reason` del inventario; **y la limpieza de H14 y de
  Mongo de la antigua D6, a su lote** (B1); (b) además H16 aquí (las capturas a `dist/`). **Recomendación: (a)**
  (mantenida, B7).

## Debate

### Debate iteración 1 (2026-11-04)

Critic: 0 P0. Business: 0 V0. Reflect: el recorte de business es la base; de critic se aplica lo que sobrevive a él.

| id | Decisión | Motivo |
|---|---|---|
| B1 | Fuera D6 y el grupo 3; el fixture nace solo con `mailpit`; `assertLocalOnly` con las tres operaciones en Vitest; lint en todo `src/**` con exención por fichero derivada del inventario; Q4 (a) amplía a la limpieza de H14 y Mongo | La limpieza no admite nada: es trabajo sin cobertura nueva, y su lote la rehará al admitir |
| B2 | `catalog` indexado por título; número informativo; escenario «Título cambiado» | Insertar una funcionalidad renumeraba medio mapa sin cambiar ninguna cobertura |
| B3 | Fuera `privacy.spec.ts`; paso 0 de `account.spec.ts` = `/privacidad` sin sesión por URL directa; `mobile` con dos ficheros; Q3 retirada | El camino crítico remoto ya prueba el fallback del SPA en staging |
| B4 | Fuera `depends` y `pendingLot`; `lot` opcional en `planned` y `not-admitted`; lo descriptivo en `reason`/`pending` | Un vocabulario que nadie verifica es decoración |
| B5 | Riesgo: las primeras invitaciones de 35b no las cubre este lote | Decirlo en vez de dejarlo implícito |
| B6 | La 4.8 imprime el margen por proyecto; el README lo publica | El margen es lo que decide el lote siguiente |
| B7 | Se mantienen Q1 (b), Q2 (a) y Q4 (a) | — |
| C1 | `ADMITTED` y `profileGrepConditions` en `args.ts`; la falsación rompe esa función | Lo que se falsa tiene que ser lo que ejecuta el runner |
| C3 | `inputs` ampliados (suite entera salvo informes, `libs/shared`, `tsconfig.base.json`, `externalDependencies`); falsación con `scripts/lib/remote.ts` | Los specs importan módulos fuera de `src/`; con la lista corta, la caché los ignoraba |
| C6 | Conector inyectable; Vitest «guard throws before the connector is invoked» con espía | «Antes de conectar» no se veía sin espía |
| C7 | Selectores de importación dinámica, `require` y `process.env` con las direcciones locales; dos falsaciones | `import()` y leer `MONGO_URI` rodeaban el `no-restricted-imports` |
| C8 | Composición de bloques escrita en D5; falsación de esperas fijas en un exento y en `local-only` | ESLint no combina opciones entre bloques: un bloque nuevo podía apagar la regla de esperas fijas |
| C9 | Regla: ningún spec admitido lee variables obligatorias a nivel de módulo; 5.2 con lista blanca mínima | `--list` cargaría el fichero sin el entorno del runner |
| C10 | `latest({ to, subject, after })` con `pickLatest` puro | Sin `after`, el correo de una acción anterior pasaría por el nuevo |
| C11 | Ya cubierto por la 5.6c de `paste-fallback-honest`; anotado en D8/D11 y 0.4; la 4.10 confirma | Sin duplicar el arreglo |
| C12 | Ya cubierto por `c31ba3e`; anotado en D8/D11; fuera la antigua 6.3 | El guardia ya tiene la forma que hace falta |
| C13 | MODIFIED corto de «El primer lote es el camino crítico…»; la 0.3 compara también ese bloque | El texto decía «SHALL ser un recorrido» y el lote 1 ya admite otras pruebas |
| C14 | 4.9 partida en 4.9a (`chromium`) y 4.9b (`mobile`) | Cada una cabe en menos de una hora |
| C15 | La 0.4 deja una nota en el cierre de `web-shell-capabilities` y `paste-fallback-honest` si siguen abiertas | Que la comprobación no les llegue como sorpresa |
| C16 | Cabecera de `repo-checks.sh`; JSON por `PLAYWRIGHT_JSON_OUTPUT_FILE` a un temporal | La salida estándar de Playwright mezcla avisos con el JSON |
| C17 | Fuera `lot` de `covered`/`partial`; se deriva del menor lote citado | Un dato que se puede derivar se contradice |
| C18 | La 1.2 lista con `playwright test --list` y el `--grep` de `args.ts`, sin montar la pila | Montar la pila para listar gastaba minutos sin probar nada más |
| C19 | Las falsaciones de 4.4 y 4.5 dicen dónde caen | Una falsación que no dice dónde cae puede caer por otra cosa |
| C20 | La 6.2 apunta las referencias de la guía a `account.spec.ts` | La guía cita los tres ficheros borrados |
| C21 | Línea en el README sobre lo que exige el camino antiguo; el fixture nombra la variable que falta | `account.spec.ts` por el camino antiguo fallaría sin decir por qué |
| C22 | Línea en el presupuesto: un `429` en un reintento de CI es consecuencia | Evita perseguir el `429` en vez del primer fallo |
| C23 | El runner falla antes del ensayo si el filtro no deja ninguna prueba apta para remoto | Un ensayo de cero pruebas saldría en verde |
| C24 | (a) frase de `shell-nav.ts` corregida (apoyo, no prueba); (b) Q1 (b) espera también el archivo de `e2e-suite` | Precisión |
| C2, C4, C5 | Sin efecto | Hablaban de la limpieza de D6, retirada por B1 |

Pendiente: iteración 2 si critic o business la piden, y aprobación humana.
