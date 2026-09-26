## Why

El usuario pidió el 2026-09-26 «automatización de pruebas con Playwright, y que dicha configuración podamos replicarla a
necesidad y demanda». Hoy existe una suite (`apps/web-e2e`, quince specs), pero **no es replicable**: depende de la
pila que cada cual tenga levantada, de su `.env` y de sus puertos; Playwright **reutiliza** cualquier servidor que ya
escuche en `4200` (`reuseExistingServer: true`), y el 2026-09-19 una sesión ajena en `3000`/`3001` hizo que el e2e
corriera **contra código viejo** sin avisar; la `api` se levanta a mano; varios specs escriben directamente en Mongo o en
el Redis de un contenedor con nombre fijo; y **ningún job de CI ejecuta Playwright**. Una suite que solo pasa en la
máquina de quien la escribió no protege nada.

Este change va **en paralelo a 35a (`object-store`)**, como **excepción explícita** a la precedencia de la fila 35
(ADR-048 §Consecuencias, extendida a la fila entera por ADR-051 §1): la decisión es del usuario, con fecha, y queda
registrada en **ADR-053** junto con las condiciones que impiden que retrase el despliegue. Se **construye** en paralelo,
pero su primer PR se **fusiona después de 35a**, para nacer con el arranque local definitivo.

## What Changes

- **Un solo comando local** que levanta la infraestructura (con `pnpm infra:up` de 35a) en un proyecto de compose propio
  por checkout y con un bloque de puertos propio, sirve `api`, `worker` y `web` (bundle de producción) desde el código,
  ejecuta Playwright y **apaga lo que arrancó**, también si falla o se interrumpe. Nunca reutiliza procesos ajenos: un
  puerto ocupado detiene la corrida nombrándolo, y tras arrancar comprueba que quien atiende cada puerto es lo que lanzó.
- **El mismo comando en CI**: un workflow nuevo, `e2e.yml`, **solo a mano** (`workflow_dispatch`), en un runner
  limpio, con las corridas contra staging en serie, que sube el informe HTML, las trazas y los vídeos de los fallos.
  **No** es un check obligatorio ni corre en pushes ni pull requests hasta tener medidos sus minutos (repositorio
  privado, plan Free), y con el 70 % del mes consumido no se lanza: la suite se ejecuta en local con el mismo comando.
- **Contra cualquier origen**: un origen por argumento (`--base-url`) y un **perfil** (`local` o `remote`) que declara
  qué puede hacer la suite en ese destino. En `remote` no se escribe en bases de datos, no se lee correo y no se afirma
  ninguna salida concreta de la IA; los helpers que harán cumplir eso a las pruebas que los necesiten llegan con el
  lote 2 (el lote 1 no los usa).
- **Staging especificado ya, verificado después**: el perfil `remote` se **ensaya** contra la pila local cuando se pide
  (`--rehearse-remote`), con un proveedor de IA externo inalcanzable para que el desenlace sea el mismo que en staging;
  las tareas que tocan staging nacen **bloqueadas por 35b** (`staging-host`). En staging: sin altas, cuentas de prueba
  `+e2e` sin email verificado ni permiso de IA, guardias antes de limpiar, y la suite remota no se lanza los días 7 y 14
  de la medición.
- **La medición de 35b excluye a las cuentas de prueba** (Q1, decidida por el usuario): se edita `staging-host` para que
  sus scripts excluyan por `userId` en cada métrica la lista «autor + cuentas E2E». Esas ediciones llegan a `main` en un
  **PR solo de spec** (#71), cuya fusión es condición de la aprobación humana del `/opsx:apply` de este change y que
  llega siempre antes del de 35b.
- **Invitar exige una corrida en verde contra staging**: `e2e-remote` en verde en escritorio y móvil sobre el commit
  desplegado, lanzada desde la máquina del autor, es precondición de la invitación de 35b, sin respaldo local; si PR-1
  no está en `main` ese día, se lanza desde la cabeza de su rama, y el mismo recorrido hecho a mano en el móvil, escrito
  paso a paso en 35b, queda como último recurso. El despliegue no espera a la suite.
- **IA y correo deterministas**: `AI_CHAIN=mock` con `AI_MOCK_MODE=replay` en local y en CI, aunque el `.env` del
  desarrollador diga `synth` (el `.env` no llega a los procesos); Mailpit del propio proyecto de compose. La entrada del
  recorrido se versiona junto a sus fixtures y un Vitest de `libs/ai` rompe CI si falta alguno.
- **Sin esperas fijas ni reintentos que escondan**: reglas de lint de Playwright y contra `setTimeout` en error,
  sincronización por eventos armados antes de la acción (la lección de la carrera de PR #59), un intermitente es un
  fallo, un salto sin motivo lo rechaza el lint, y una prueba entra en la suite solo tras repetirse bajo carga en cada
  navegador.
- **Lote 1 = el camino crítico**: registro → grupo → **segunda persona que abre el enlace de invitación sin sesión,
  crea su cuenta y se une** → guardar link →
  postulación → CV → encaje, como un único recorrido, **en escritorio y en un móvil emulado**. El mapa de cobertura
  contra el catálogo de uso y la limpieza de los specs existentes pasan al **lote 2**, candidato posterior a la fila 35.
- **ADR-053** (el 052 está reservado por `object-store`), anotación en ADR-048 §Consecuencias, entrada en
  `openspec-changes.yaml` tras `object-store` (y la del lote 2 como candidata al final) y fila en
  `docs/design-v0.2.md` §6.

## Capabilities

### New Capabilities

- `platform/e2e-suite`: la suite end-to-end reproducible — comando único, aislamiento de puertos, procesos y datos,
  entorno versionado, perfiles por destino, pruebas remotas que no contaminan ni gastan, determinismo y camino crítico en
  escritorio y móvil.

### Modified Capabilities

- `platform/ci-pipeline`: **ADDED** «Suite end-to-end a demanda en un runner limpio». No modifica ningún requirement
  existente: en particular **no toca «CD a staging en main»**, que ya modifican 35a y 35c (ver design D16).

## Impact

- **Código:** `apps/web-e2e` (configuración de Playwright con proyectos `chromium` y `mobile`, runner, perfiles, entorno
  versionado, helpers, spec del camino crítico, reglas de lint); en `libs/ai`, la entrada versionada del recorrido, sus
  fixtures escritos a mano y un Vitest que los exige; ningún cambio de comportamiento de `api`, `worker` ni `web`.
- **CI:** `.github/workflows/e2e.yml` nuevo; `ci.yml`, `cd-staging.yml` y `cd-prod.yml` **no se tocan**.
- **Otro change:** `openspec/changes/staging-host` (35b), design D14, D15/D16 y tabla de bloqueos, y tareas 10.2,
  10.3, 10.6 y 10.7, por Q1 y por la precondición de invitar, sin tocar las secciones que edita 35a, en un commit
  propio que llega a `main` en un PR solo de spec (#71).
- **Documentación:** `docs/adr/ADR-053.md`, anotación en `docs/adr/ADR-048.md`, `openspec-changes.yaml`,
  `docs/design-v0.2.md` §6, `apps/web-e2e/README.md`, la medición de minutos en `infra/README.md` y, en PR-2, la corrida
  previa a invitar en el RUNBOOK.
- **Dependencias:** ninguna nueva (Playwright 1.63 y `eslint-plugin-playwright` ya están).
- **Relación con la fila 35:** no toca ningún fichero de despliegue ni ningún requirement que 35a, 35b o 35c modifiquen.
  PR-1 se fusiona después de 35a y antes del PR-1 de 35b o después de su 11.6; las tareas de staging esperan a 35b.
- **Pendiente antes de `/opsx:apply`:** la aprobación humana del design tras el debate, con la #71 fusionada en `main`
  como condición.
