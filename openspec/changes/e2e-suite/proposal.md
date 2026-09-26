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
registrada en **ADR-053** junto con las condiciones que impiden que retrase el despliegue.

## What Changes

- **Un solo comando local** que levanta la infraestructura en un proyecto de compose propio y con un bloque de puertos
  propio, sirve `api`, `worker` y `web` desde el código, siembra lo que la suite necesita, ejecuta Playwright y **apaga
  lo que arrancó**, también si falla o se interrumpe. Nunca reutiliza procesos ajenos: un puerto ocupado detiene la
  corrida nombrándolo.
- **El mismo comando en CI**: un workflow nuevo, `e2e.yml`, a demanda (`workflow_dispatch` y pull requests con la
  etiqueta `e2e`), en un runner limpio, que sube el informe HTML, las trazas y los vídeos de los fallos. **No** es un
  check obligatorio ni corre en cada push hasta tener medidos sus minutos (repositorio privado, plan Free).
- **Contra cualquier origen**: `E2E_BASE_URL` y un **perfil** (`local` o `remote`) que declara qué puede hacer la suite
  en ese destino. En `remote` no se escribe en bases de datos, no se lee correo y no se afirma ninguna salida concreta de
  la IA; una prueba apta para remoto que intente hacerlo **falla**, no se salta.
- **Staging especificado ya, verificado después**: el perfil `remote` se ensaya desde el primer día contra la pila
  local; las tareas que tocan staging nacen **bloqueadas por 35b** (`staging-host`). Nada se da por verificado contra
  staging antes de que exista.
- **IA y correo deterministas**: `AI_CHAIN=mock` con `AI_MOCK_MODE=replay` en local y en CI, aunque el `.env` del
  desarrollador diga `synth`; Mailpit del propio proyecto de compose. En staging la IA es real y la suite no la consume.
- **Sin esperas fijas ni reintentos que escondan**: reglas de lint de Playwright en error, sincronización por eventos
  armados antes de la acción (la lección de la carrera de PR #59), un intermitente es un fallo, y una prueba entra en la
  suite solo tras repetirse bajo carga.
- **Lote 1 = el camino crítico**: registro → grupo → guardar link → postulación → CV → encaje, como un único recorrido.
  El resto del catálogo de uso (`docs/catalogo-de-uso.md`, 46 funcionalidades) se añade **por lotes** sobre la misma
  base, con un mapa de cobertura versionado y comprobado.
- **ADR-053** (el 052 está reservado por `object-store`), anotación en ADR-048 §Consecuencias, entrada en
  `openspec-changes.yaml` tras `object-store` y fila en `docs/design-v0.2.md` §6.

## Capabilities

### New Capabilities

- `platform/e2e-suite`: la suite end-to-end reproducible — comando único, aislamiento de puertos y datos, entorno
  versionado, perfiles por destino, pruebas remotas que no contaminan ni gastan, determinismo, camino crítico y mapa de
  cobertura contra el catálogo de uso.

### Modified Capabilities

- `platform/ci-pipeline`: **ADDED** «Suite end-to-end a demanda en un runner limpio». No modifica ningún requirement
  existente: en particular **no toca «CD a staging en main»**, que ya modifican 35a y 35c (ver design D16).

## Impact

- **Código:** `apps/web-e2e` (configuración de Playwright, runner, perfiles, entorno versionado, helpers, spec del camino
  crítico, mapa de cobertura y su comprobación, reglas de lint); un fixture escrito a mano de `match-cv` (y los que pida
  la corrida) en `libs/ai/src/infrastructure/fixtures`; ningún cambio de comportamiento de `api`, `worker` ni `web`.
- **CI:** `.github/workflows/e2e.yml` nuevo; `ci.yml`, `cd-staging.yml` y `cd-prod.yml` **no se tocan**.
- **Documentación:** `docs/adr/ADR-053.md`, anotación en `docs/adr/ADR-048.md`, `openspec-changes.yaml`,
  `docs/design-v0.2.md` §6, `apps/web-e2e/README.md` y la medición de minutos en `infra/README.md`.
- **Dependencias:** ninguna nueva (Playwright 1.63 y `eslint-plugin-playwright` ya están).
- **Relación con la fila 35:** no toca ningún fichero de despliegue ni ningún requirement que 35a, 35b o 35c modifiquen.
  El runner arranca la infraestructura con el comando de `platform/local-environment`, que 35a cambia; las tareas de
  staging esperan a 35b; y la exclusión de las cuentas de prueba de la medición de 35b es una **pregunta para el
  usuario** (design, Q1).
- **Pendiente antes de `/opsx:apply`:** el debate critic/business/reflect y la aprobación humana.
