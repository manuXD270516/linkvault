## Why

El repositorio es privado en el plan Free: 2000 minutos de Actions al mes. Septiembre de 2026 se agotó y las dos
corridas de `cd-staging` del 30-sep en `main` no llegaron a arrancar («recent account payments have failed or your
spending limit needs to be increased»). El 2026-10-01 el usuario pidió gastar el mínimo de minutos posible.

`cd-staging` corre en **cada** push a `main` y cuesta unos 20 minutos (≈17 de `amd64` y 2-5 de `arm64`), aunque la
fusión solo toque specs o documentación: archivar un change, una corrección de un ADR o del RUNBOOK. Esas corridas
reconstruyen y verifican un artefacto idéntico al de la corrida anterior. El 2026-10-01, la del archivo de
`ai-usage-consent-reason` (#74, solo `openspec/`) se canceló a mano por eso. Quedan por delante varios archivos
(35a, `e2e-suite`, 35b) y correcciones de docs que pagarían la corrida entera cada uno.

## What Changes

- **`paths-ignore` en el `push` de `cd-staging.yml`**: un push a `main` cuyos ficheros cambiados están **todos** en
  `openspec/**`, `docs/**`, `.claude/**`, `.cursor/**`, `*.md` de la raíz, `infra/**/*.md`, `tools/**/*.md` o
  `**/README.md` no lanza el workflow. Basta un fichero fuera de esa lista para que corra como hoy.
- **`**/*.md` no se ignora a propósito**: los prompts de `libs/ai/src/infrastructure/prompts/<task>.vN.md` son `.md`,
  viajan en las imágenes de `api` y `worker` (`AI_PROMPTS_DIR`) y cambiarlos cambia el artefacto.
- **`workflow_dispatch` no cambia**: el lanzamiento manual (y el modo de prueba `dry_run`) sigue disponible siempre.
- **Lo que se deja de comprobar en `main` en esas fusiones, y quién lo cubre**: la etapa `verify` de `cd-staging`
  ejecuta `repo-checks` (que lee `infra/README.md`, `docs/RUNBOOK.md` y el registro de afirmaciones en `.md`) y
  `openspec validate`. En una fusión solo de documentación esas dos comprobaciones SHALL ejecutarse en local antes de
  fusionar (`bash infra/ci/repo-checks.sh` y `pnpm exec openspec validate --all --no-interactive`), y el PR lo dice.
- `ci.yml` no se toca: sigue `disabled_manually` y su alcance (`push` a `main` y `pull_request`) es otra decisión.

## Capabilities

### New Capabilities
Ninguna.

### Modified Capabilities
- `platform/ci-pipeline`: requirement nuevo "CD a staging omitido en fusiones solo de documentación", con sus
  escenarios. "CD a staging en main" no se modifica: sigue rigiendo todo push que dispare el workflow.

## Impact

- **Código**: solo `.github/workflows/cd-staging.yml` (el bloque `on.push`). Ningún fichero de `apps/**` ni `libs/**`.
- **Coste**: la fusión de este change **sí** lanza una corrida (toca el propio workflow), sobre un código de
  aplicación idéntico al de `1e17c7a`, ya verificado y publicado por la corrida de #72. A partir de ahí, cada fusión
  solo de documentación ahorra unos 20 minutos.
- **Verificación sin minutos**: el archivo de este mismo change es una fusión solo de `openspec/`; que **no** aparezca
  ninguna corrida de `cd-staging` para ese commit es la prueba del filtro, sin gastar nada.
- **Estado de commit**: el `HEAD` de `main` puede no llevar `cd-staging/artifact` si el último commit fue solo de
  docs. El commit desplegado o publicado es el último de `main` **con** ese estado, no el `HEAD`; quien lo lea (p. ej.
  la 9.4 de `e2e-suite`, la 6.x de `staging-host`) debe buscarlo así. Ninguna tarea abierta lee el `HEAD` a ciegas.
- **Riesgo residual**: una fusión solo de docs que rompa `repo-checks` y se fusione sin la comprobación local no se
  detecta en `main` hasta la siguiente fusión con código, que sí corre `verify` y fallaría allí.
- **ADRs**: coherente con ADR-048 (la verificación no se relaja: se omite solo donde el artefacto no cambia, y lo
  omitido queda nombrado). La decisión es local y no crea ADR nuevo.
- **35b (`staging-host`)**: reescribe partes de `cd-staging.yml` (2.4, 3.x, 4.5) pero no el bloque `on:`; si lo
  tocara, este filtro debe conservarse.
