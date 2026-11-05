## Why

`e2e-suite` dejó reproducible **una** prueba, el camino crítico (`@lot1`), y mandó al lote 2 todo lo que permite que
la suite crezca sin mentir: el **mapa de cobertura** contra `docs/catalogo-de-uso.md` y su comprobación (el requirement
«La cobertura se declara contra el catálogo», retirado de su delta, B-V1-7), los **helpers `local-only`** con el
guardia que impide que una prueba apta para remoto escriba en Mongo o lea correo (R-18 de su iteración 2, ADR-053 §4),
el **inventario** de la suite y la **limpieza** de los specs no admitidos, que siguen con `localhost` escrito a mano,
`MongoClient` directo y un `docker exec` a un contenedor de nombre fijo que se traga el error. Sin eso, cada prueba que
otros changes admiten (`paste-fallback-honest` ya etiquetó una `@lot1`) entra sin que nadie sepa qué cubre, y la frase
«una prueba apta para remoto que intente cualquiera de esas operaciones SHALL fallar» no tiene quién la haga cumplir.

También entra **H11** de la guía de uso: `e2e.env` no declara `AI_VAULT_KEY`, así que en la pila de la suite guardar
una clave propia responde `503` y `byok.spec.ts` falla por configuración, no por el producto. **H3** ya no es de aquí:
lo corrige `web-error-copy-coverage`.

Es **candidato posterior a la fila 35**: la excepción de ADR-053 cubre solo el lote 1 (Q3 de `e2e-suite`). Su fila en
`docs/design-v0.2.md` §6 la asigna el owner (Q1). Se especifica ahora por petición del owner del 2026-11-04 de adelantar
en paralelo la especificación de los changes que siguen a los siete de robustez; no se aplica hasta entonces.

## What Changes

- **Admitida = una etiqueta `@lot<N>`.** El runner deja de buscar el `@lot1` literal y ejecuta todas las pruebas de
  cualquier lote (y en `remote`, las de cualquier lote aptas para remoto); el `--grep` de quien ejecuta acota, nunca
  amplía.
- **Mapa de cobertura e inventario** en `apps/web-e2e/catalog-coverage.json`: una entrada por número del catálogo
  (título, estado, lote, pruebas o motivo) y una por prueba de cada fichero (admitida o no, lote previsto,
  dependencias de entorno). Una comprobación, con la lógica en la suite y ejecutada desde `repo-checks` con el catálogo
  en sus `inputs`, falla si falta un número, si un título no coincide (renumeración), si se cita una prueba inexistente
  o no admitida, si una prueba admitida no está en el mapa o si una prueba no está en el inventario. La lista de
  pruebas sale de `playwright test --list`.
- **Helpers `local-only`** en `apps/web-e2e/src/support/local-only/`: un fixture de prueba con Mongo, el vaciado del
  contador de registros por `docker exec` al proyecto de compose de la corrida y la lectura de Mailpit, con URIs del
  bloque por variable. Cada operación falla nombrándose si la prueba lleva `@remote-safe` (en cualquier perfil) o si el
  perfil es `remote`. El lint rechaza `mongodb`, `child_process` e `ioredis` fuera de ellos, y cualquier literal con
  `localhost`, `127.0.0.1` o `[::1]` en `src/`.
- **Limpieza** de `home`, `groups` y `public-share` (orígenes) y de `links`, `match` y `freshness` (Mongo), y
  `register-limit.ts` sustituido por el fixture en los trece specs que lo usan. Ninguno se admite; se verifica que su
  resultado no empeora.
- **Lote 2 (cuenta y salida):** `account.spec.ts` (`@lot2 @account`, solo `local`), un recorrido con una sola alta:
  registro, sesión restaurada sin token en el almacenamiento, verificación del email por Mailpit (y el enlace usado
  rechazado), nombre y contraseña, aviso de privacidad, recuperación de la contraseña por Mailpit con la sesión de otro
  navegador invalidada, y borrado de la cuenta. Absorbe y borra `auth.spec.ts`, `auth-email-recovery.spec.ts` y
  `deploy-prod.spec.ts`. Y `privacy.spec.ts` (`@lot2 @privacy @remote-safe`, Q3): `/privacidad` sin sesión.
  Catálogo 1-6 y 44. Admitidos con carga, por etiqueta.
- **Presupuesto de registros** rehecho por etiqueta: las órdenes de admisión del README llevan siempre su `--grep`, y
  si las entradas de admisión de `e2e.yml` están en `main`, su guardia pasa a exigir `grep` y proyecto con
  `repeat_each > 1`.
- **H11:** `AI_VAULT_KEY` de relleno en `e2e.env`.
- **ADR-067** (propuesto) y una anotación de una línea en ADR-053 §7.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `platform/e2e-suite` (la crea `e2e-suite`; tiene que estar archivado antes de aplicar este change):
  - **ADDED** «Lo admitido es lo de algún lote, y nada más», «La cobertura se declara contra el catálogo», «La suite
    lleva el inventario de sus pruebas» y «El segundo lote cubre la cuenta y la salida».
  - **MODIFIED** «El entorno de la suite es el versionado, no el del desarrollador» (la bóveda con valor de relleno) y
    «Cada destino se declara con un perfil que dice qué puede hacer la suite» (los helpers `local-only`, su guardia en
    cualquier perfil y el lint), la frase que `e2e-suite` retiró.

## Impact

- **Código:** `apps/web-e2e` (runner: selección de lotes y `E2E_MAILPIT_URL`; `scripts/lib/coverage.ts`,
  `scripts/lib/local-only.ts` y sus Vitest; `scripts/check-coverage.ts`; `src/support/local-only/`; `eslint.config.mjs`;
  `playwright.config.mts`, `testMatch` de `mobile`; los specs limpiados; `account.spec.ts` y `privacy.spec.ts`; borrado
  de tres specs y de `register-limit.ts`; `e2e.env`; `catalog-coverage.json`; README). En `tools/repo-checks/project.json`,
  el target `check-catalog-coverage` y su `dependsOn`. Si `chore/e2e-dispatch-admission` está en `main`, el guardia de
  entradas de `e2e.yml` y sus descripciones. **Ningún cambio** en `apps/api`, `apps/worker`, `apps/web` ni `libs/*`.
- **CI:** la comprobación entra por el paso incondicional «Repo checks» de `ci.yml` (y de los dos CD, que invocan el
  mismo script); `ci.yml`, `cd-staging.yml` y `cd-prod.yml` no se editan.
- **Documentación:** `docs/adr/ADR-067.md`, una línea en `docs/adr/ADR-053.md`, `apps/web-e2e/README.md` («Cómo admitir
  una prueba», presupuesto, admisiones), `docs/guia-de-uso/README.md` (H11) y, tras Q1, la fila de §6 en
  `docs/design-v0.2.md`. `openspec-changes.yaml` no se edita aquí (lo reescribe la rama de `web-error-copy-coverage`).
- **Dependencias:** ninguna nueva (`mongodb` y Playwright ya están; Mailpit se lee por HTTP con `fetch`).
- **Relación con otros changes:** `e2e-suite` archivado y 35c archivado son precondiciones de `/opsx:apply`; las
  pruebas de `paste-fallback-honest` y `web-shell-capabilities` (y `support/shell-nav.ts`) entran en el inventario y el
  mapa el día de aplicar, o las añade el change que llegue segundo.
- **Pendiente antes de `/opsx:apply`:** Q1 (fila en §6) y la aprobación humana tras el debate.
