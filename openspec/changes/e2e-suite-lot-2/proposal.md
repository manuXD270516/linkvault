## Why

`e2e-suite` dejó reproducible **una** prueba, el camino crítico (`@lot1`), y mandó al lote 2 todo lo que permite que
la suite crezca sin mentir: el **mapa de cobertura** contra `docs/catalogo-de-uso.md` y su comprobación (el requirement
«La cobertura se declara contra el catálogo», retirado de su delta, B-V1-7), los **helpers `local-only`** con el
guardia que impide que una prueba apta para remoto escriba en Mongo o lea correo (R-18 de su iteración 2, ADR-053 §4),
el **inventario** de la suite y la **limpieza** de los specs no admitidos, que siguen con `localhost` escrito a mano,
`MongoClient` directo y un `docker exec` a un contenedor de nombre fijo que se traga el error. Sin eso, cada prueba que
otros changes admiten (`paste-fallback-honest` ya etiquetó una `@lot1`) entra sin que nadie sepa qué cubre, y la frase
«una prueba apta para remoto que intente cualquiera de esas operaciones SHALL fallar» no tiene quién la haga cumplir.

La limpieza de esos specs no admitidos **no entra** (iteración 1 del debate, B1): no añade cobertura, y la rehará el
lote que admita cada uno. Mientras tanto, el lint los exime por lo que dice el inventario.

También entra **H11** de la guía de uso: `e2e.env` no declara `AI_VAULT_KEY`, así que en la pila de la suite guardar
una clave propia responde `503` y `byok.spec.ts` falla por configuración, no por el producto. **H3** ya no es de aquí:
lo corrige `web-error-copy-coverage`.

Es **candidato posterior a la fila 35**: la excepción de ADR-053 cubre solo el lote 1 (Q3 de `e2e-suite`). Su fila en
`docs/design-v0.2.md` §6 la asigna el owner (Q1). Se especifica ahora por petición del owner del 2026-11-04 de adelantar
en paralelo la especificación de los changes que siguen a los siete de robustez; no se aplica hasta entonces.

## What Changes

- **Admitida = una etiqueta `@lot<N>`.** El runner deja de buscar el `@lot1` literal y ejecuta todas las pruebas de
  cualquier lote (y en `remote`, las de cualquier lote aptas para remoto); el `--grep` de quien ejecuta acota, nunca
  amplía, y un ensayo remoto sin pruebas aptas falla antes de empezar. Las condiciones viven en `scripts/lib/args.ts`
  (`profileGrepConditions`).
- **Mapa de cobertura e inventario** en `apps/web-e2e/catalog-coverage.json`: una entrada por funcionalidad del
  catálogo, **por título** (el número es informativo), con estado y pruebas o motivo (el lote de lo cubierto se deriva
  de las pruebas), y una por prueba de cada fichero (admitida, no admitida o informativa, con motivo). Una
  comprobación, con la lógica en la suite y ejecutada desde `repo-checks` con el catálogo, la suite, `libs/shared` y
  las dependencias de Playwright en sus `inputs`, falla si falta o sobra una funcionalidad, si se cita una prueba
  inexistente o no admitida, si una prueba admitida no está en el mapa o si una prueba no está en el inventario. La
  lista de pruebas sale de `playwright test --list`, sin montar nada.
- **Guardia `local-only`** (`assertLocalOnly`, para Mongo, Redis/`docker` y Mailpit, probado en Vitest) y un fixture de
  prueba en `apps/web-e2e/src/support/local-only/` que nace **solo con Mailpit**, con conector inyectable y la dirección
  por variable: falla nombrando la operación, antes de conectar, si la prueba lleva `@remote-safe` (en cualquier
  perfil) o si el perfil es `remote`. El lint de todo `src/**` rechaza la importación (estática o dinámica) de
  `mongodb`, `child_process` e `ioredis`, la lectura de las direcciones locales del entorno y los orígenes de bucle
  local, salvo en el fixture y en los ficheros que el inventario declara con pruebas no admitidas. La limpieza de esos
  specs y los métodos de Mongo y del contador llegan con su lote.
- **Lote 2 (cuenta y salida):** `account.spec.ts` (`@lot2 @account`, solo `local`), un recorrido con una sola alta:
  `/privacidad` sin sesión por URL directa, registro, sesión restaurada sin token en el almacenamiento, verificación
  del email por Mailpit (y el enlace usado rechazado), nombre y contraseña, aviso de privacidad desde el perfil,
  recuperación de la contraseña por Mailpit con la sesión de otro navegador invalidada, y borrado de la cuenta.
  Absorbe y borra `auth.spec.ts`, `auth-email-recovery.spec.ts` y `deploy-prod.spec.ts`. Catálogo 1-6 y 44. Admitido
  con carga, por etiqueta, en `chromium` y (Q2) `mobile`.
- **Presupuesto de registros** por etiqueta, con el margen publicado por proyecto: las órdenes de admisión del README
  llevan siempre su `--grep`.
- **H11:** `AI_VAULT_KEY` de relleno en `e2e.env`.
- **ADR-067** (propuesto) y una anotación de una línea en ADR-053 §7.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `platform/e2e-suite` (la crea `e2e-suite`; tiene que estar archivado antes de aplicar este change):
  - **ADDED** «Lo admitido es lo de algún lote, y nada más», «La cobertura se declara contra el catálogo», «La suite
    lleva el inventario de sus pruebas» y «El segundo lote cubre la cuenta y la salida».
  - **MODIFIED** «El entorno de la suite es el versionado, no el del desarrollador» (la bóveda con valor de relleno),
    «Cada destino se declara con un perfil que dice qué puede hacer la suite» (el guardia `local-only` en cualquier
    perfil y el lint; la frase que `e2e-suite` retiró) y «El primer lote es el camino crítico, como un solo recorrido»
    (el lote 1 incluye ese recorrido y admite otras pruebas).

## Impact

- **Código:** `apps/web-e2e` (runner: selección de lotes, ensayo sin pruebas y `E2E_MAILPIT_URL`; `scripts/lib/args.ts`,
  `scripts/lib/coverage.ts`, `scripts/lib/local-only.ts` y sus Vitest; `scripts/check-coverage.ts`;
  `src/support/local-only/`; `eslint.config.mjs`; `playwright.config.mts`, `testMatch` de `mobile`; `account.spec.ts`;
  borrado de tres specs; `e2e.env`; `catalog-coverage.json`; README). En `tools/repo-checks/project.json`, el target
  `check-catalog-coverage` y su `dependsOn`; la cabecera de `infra/ci/repo-checks.sh`. **Ningún cambio** en `apps/api`,
  `apps/worker`, `apps/web`, `libs/*` ni en los specs no admitidos.
- **CI:** la comprobación entra por el paso incondicional «Repo checks» de `ci.yml` (y de los dos CD, que invocan el
  mismo script); ningún workflow se edita.
- **Documentación:** `docs/adr/ADR-067.md`, una línea en `docs/adr/ADR-053.md`, `apps/web-e2e/README.md` («Cómo admitir
  una prueba», presupuesto, admisiones, camino antiguo), `docs/guia-de-uso/README.md` (H11 y las referencias a los
  specs absorbidos) y, tras Q1, la fila de §6 en `docs/design-v0.2.md`. `openspec-changes.yaml` no se edita aquí (lo
  reescribe la rama de `web-error-copy-coverage`).
- **Dependencias:** ninguna nueva (Mailpit se lee por HTTP con `fetch`).
- **Relación con otros changes:** `e2e-suite` archivado y 35c archivado son precondiciones de `/opsx:apply`; las
  pruebas de `paste-fallback-honest` y `web-shell-capabilities` entran en el inventario y el mapa el día de aplicar, o
  las añade el change que llegue segundo (`support/shell-nav.ts` es un módulo de apoyo: sin inventario, pero en los
  `inputs` de la comprobación).
- **Pendiente antes de `/opsx:apply`:** Q1 (fila en §6) y la aprobación humana tras el debate.
