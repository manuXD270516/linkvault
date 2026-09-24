#!/usr/bin/env bash
# ===================================================================================================================
# Los tres resultados del CD, dichos donde se leen sin abrir la ejecución.
# ===================================================================================================================
# Tareas 7.5, 7.6 y 7.7 del change `deploy-image-verification`; decisión en ADR-048 §3; requirement "CD a staging en
# main" de `platform/ci-pipeline` (escenarios "El estado se lee sin abrir la ejecución" y "El límite de la señal
# queda escrito").
#
# --- Qué superficie lleva el estado, y por qué no otra --------------------------------------------------------------
# Lo que alguien mira por costumbre es la **lista de checks del commit o de la PR**, y ahí se ve el **nombre del job**
# y los **estados de commit**. La lista de *ejecuciones del workflow* **no puede** llevarlo: su nombre (`run-name`) se
# fija al **iniciar** la corrida, antes de que existan los resultados de los jobs, así que no puede depender de ellos.
# Por eso este script publica un **estado de commit** y el workflow calcula el **nombre del job** con la misma lógica.
#
# --- Por qué el estado de commit lleva `state` y no solo `description` -----------------------------------------------
# Este script corre desde un job con `if: always()`, es decir, **también cuando el artefacto está roto**. Un reporte
# que publicara siempre `success` —cambiando solo el texto— pondría un **tic verde junto al check rojo** del
# artefacto: exactamente la señal confusa que este change viene a arreglar, reconstruida por el mecanismo que la
# cierra. Por eso `state` se **deriva** del resultado del job de construir-verificar-publicar y del estado del
# preflight, **nunca** de un literal, y por eso este script **sale ≠0** cuando lo que deriva es un fallo: el propio
# job de reporte tiene que verse rojo, no verde al lado de un rojo.
#
# --- La tabla de decisión (es la del ADR-048 §3, escrita como código) -------------------------------------------------
#   verificación   preflight   despliegue   →  estado    significado
#   -------------  ----------  -----------  -   -------  --------------------------------------------------------
#   ≠ success      cualquiera  cualquiera      failure   artefacto roto: fallo **exista o no destino** (resultado 1)
#   success        full        success         success   verificado y desplegado (resultado 2)
#   success        full        ≠ success       failure   había destino y el despliegue no terminó bien
#   success        none        (saltado)       success   verificado y **sin destino**: verde diciendo que no desplegó
#   success        partial/∅   cualquiera      failure   el preflight no pudo decidir: nunca se cae del lado verde
#
# La última fila importa tanto como las otras: si el preflight falla (destino a medias) o no llega a emitir estado, lo
# cómodo sería tratarlo como "no hay destino" y terminar en verde. Eso es la mentira que ADR-048 §3 prohíbe.
#
# Uso (local, para ejercitar la tabla sin publicar nada):
#   CD_REPORT_LOCAL=1 VERIFY_RESULT=success PREFLIGHT_RESULT=success PREFLIGHT_STATE=none DEPLOY_RESULT=skipped \
#     TARGET_LABEL=staging infra/ci/report-cd-outcome.sh
# ===================================================================================================================
set -euo pipefail

: "${VERIFY_RESULT:?VERIFY_RESULT es obligatoria: el result del job de construir-verificar-publicar}"
: "${PREFLIGHT_RESULT:?PREFLIGHT_RESULT es obligatoria: el result del job de preflight}"
: "${DEPLOY_RESULT:?DEPLOY_RESULT es obligatoria: el result del job de despliegue (skipped si no se ejecutó)}"
: "${TARGET_LABEL:?TARGET_LABEL es obligatoria: la etiqueta del destino (staging, production)}"
PREFLIGHT_STATE="${PREFLIGHT_STATE:-}"

fail() {
  printf '::error::%s\n' "$1" >&2
  printf '\n[FAIL] %s\n' "$1" >&2
  exit 1
}

# --- Derivación ------------------------------------------------------------------------------------------------
# `name` es lo que se ve en la lista de checks. **El workflow calcula el mismo texto** en `jobs.<id>.name`, porque el
# nombre de un job no puede salir de un step suyo: si cambias estas cadenas, cambia también la expresión del YAML
# (`.github/workflows/cd-staging.yml`, job `report`). El nombre derivado aquí se imprime y va al resumen, de modo que
# una divergencia entre los dos se ve en la propia corrida en vez de pasar inadvertida.
if [ "$VERIFY_RESULT" != 'success' ]; then
  status_state='failure'
  name="resultado: el artefacto NO pasó la verificación"
  if [ "$VERIFY_RESULT" = 'failure' ]; then
    description="El artefacto no se construyó o no arrancó: no se publicó nada y no se desplegó nada."
  else
    # `cancelled` o `skipped` no son "artefacto roto", y decir que no arrancó sería inventarse el motivo: tampoco
    # son verde, porque nadie ha comprobado nada. Se nombra el resultado real.
    description="La verificación del artefacto terminó en '${VERIFY_RESULT}': no se publicó nada y no se desplegó nada."
  fi
elif [ "$PREFLIGHT_STATE" = 'full' ]; then
  if [ "$DEPLOY_RESULT" = 'success' ]; then
    status_state='success'
    name="resultado: artefacto verificado y desplegado a ${TARGET_LABEL}"
    description="Artefacto verificado y desplegado a ${TARGET_LABEL}."
  else
    status_state='failure'
    name="resultado: artefacto verificado, despliegue a ${TARGET_LABEL} NO completado"
    description="Había destino de ${TARGET_LABEL} y el despliegue terminó en '${DEPLOY_RESULT}': no se desplegó."
  fi
elif [ "$PREFLIGHT_STATE" = 'none' ]; then
  status_state='success'
  name="resultado: artefacto verificado — NO desplegado (sin destino de ${TARGET_LABEL})"
  description="Artefacto verificado. NO desplegado: no hay destino de ${TARGET_LABEL} configurado (ADR-048 §3)."
else
  status_state='failure'
  name="resultado: destino de ${TARGET_LABEL} indeterminado — no se desplegó"
  description="El preflight terminó en '${PREFLIGHT_RESULT}' con estado '${PREFLIGHT_STATE:-vacío}': no se despliega."
fi

printf '=== Resultado del CD\n'
printf '  verificación del artefacto : %s\n' "$VERIFY_RESULT"
printf '  preflight                  : %s (estado: %s)\n' "$PREFLIGHT_RESULT" "${PREFLIGHT_STATE:-vacío}"
printf '  despliegue                 : %s\n' "$DEPLOY_RESULT"
printf '  ------------------------------------------------------------\n'
printf '  estado de commit           : %s\n' "$status_state"
printf '  nombre (lista de checks)   : %s\n' "$name"
printf '  descripción                : %s\n' "$description"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '### %s\n\n' "$name"
    printf '%s\n\n' "$description"
    printf '| | |\n|---|---|\n'
    printf '| verificación del artefacto | `%s` |\n' "$VERIFY_RESULT"
    printf '| preflight | `%s` (estado `%s`) |\n' "$PREFLIGHT_RESULT" "${PREFLIGHT_STATE:-vacío}"
    printf '| despliegue | `%s` |\n' "$DEPLOY_RESULT"
    printf '| estado de commit publicado | `%s` |\n' "$status_state"
  } >>"$GITHUB_STEP_SUMMARY"
fi

# --- Publicación del estado de commit -------------------------------------------------------------------------
# El `context` es **fijo** (`STATUS_CONTEXT`): es la identidad del check, y GitHub sustituye el estado anterior del
# mismo contexto. Meter el resultado en el contexto dejaría un check distinto por cada desenlace, todos vivos a la
# vez, y la lista diría a un tiempo que se desplegó y que no. Lo que varía es `state` y `description`.
if [ -n "${GH_TOKEN:-}" ]; then
  : "${STATUS_SHA:?STATUS_SHA es obligatoria cuando se publica el estado}"
  : "${STATUS_CONTEXT:?STATUS_CONTEXT es obligatoria cuando se publica el estado}"
  : "${GH_REPO:?GH_REPO es obligatoria cuando se publica el estado}"
  printf '\n=== Publicando estado de commit %s en %s (%s)\n' "$status_state" "$STATUS_SHA" "$STATUS_CONTEXT"
  if ! gh api --silent --method POST "repos/${GH_REPO}/statuses/${STATUS_SHA}" \
    -f "state=${status_state}" \
    -f "context=${STATUS_CONTEXT}" \
    -f "description=${description}" \
    -f "target_url=${STATUS_TARGET_URL:-}"; then
    fail "no se pudo publicar el estado de commit: sin él, el resultado del CD no se lee desde la lista de checks"
  fi
elif [ "${CD_REPORT_LOCAL:-}" = '1' ]; then
  # Solo para ejercitar la tabla en local. En CI **no** se define, de modo que un token ausente es un fallo ruidoso y
  # no un reporte que se salta en silencio: una señal que no se publica es peor que ninguna, porque el job sigue
  # verde y nadie se entera de que dejó de informar.
  printf '\n[local] no se publica estado de commit (CD_REPORT_LOCAL=1)\n'
else
  fail "GH_TOKEN vacío: el job de reporte no puede publicar el estado de commit (¿falta 'statuses: write'?)"
fi

if [ "$status_state" != 'success' ]; then
  printf '\n[FAIL] %s\n' "$description" >&2
  exit 1
fi

exit 0
