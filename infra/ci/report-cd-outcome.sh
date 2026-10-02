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
#   verificación   preflight   modo       despliegue   →  estado    significado
#   -------------  ----------  ---------  -----------  -   -------  ----------------------------------------------
#   ≠ success      cualquiera  cualquiera cualquiera      failure   la verificación no pasó: fallo **exista o no destino**
#   success        partial/∅   cualquiera cualquiera      failure   el preflight no pudo decidir: nunca se cae del lado verde
#   success        full/none   test       (saltado)       success   verificado y NO desplegado: modo de prueba
#   success        full/none   off-main   (saltado)       success   verificado y NO desplegado: corrida fuera de main
#   success        full        real       success         success   verificado y desplegado (resultado 2)
#   success        full        real       ≠ success       failure   había destino y el despliegue no terminó bien
#   success        none        real       (saltado)       success   verificado y **sin destino**: verde diciendo que no desplegó
#
# El orden es el de la tabla (design D1 de `staging-host`). La fila de `partial` va **antes** que la del modo: un
# destino a medias es un defecto de configuración también en modo de prueba o fuera de `main`, y con el modo delante
# `partial` + `test` saldría verde. Si el preflight falla (destino a medias) o no llega a emitir estado, lo cómodo sería
# tratarlo como "no hay destino" y terminar en verde. Eso es la mentira que ADR-048 §3 prohíbe.
#
# `RUN_MODE` (`real` | `test` | `off-main`) es el modo de la corrida: `test` es el modo de prueba (`dry_run`) y
# `off-main`, una corrida real lanzada desde otra rama. **Ausente vale `real`**: `cd-prod` no lo pasa hasta 35c y su
# comportamiento no cambia. Un valor desconocido es `failure` nombrándolo: inventarle un significado sería decidir a
# ciegas si se desplegó.
#
# --- El cuarto desenlace: "no se pudo verificar" no es "el artefacto está roto" ---------------------------------------
# La primera fila decía siempre lo mismo —"El artefacto no se construyó o no arrancó"— y en las corridas reales
# 36045259965 y 36048413770 eso era **falso**: las dos cayeron porque el registro de terceros no sirvió las imágenes de
# terceros (mongo, redis y el almacén de objetos), con el artefacto sin llegar a levantarse. El mismo pecado que este
# script ya había corregido para `cancelled`/`skipped` (nombrar el resultado real en vez de inventar el motivo) seguía
# vivo para `failure`.
#
# Por eso `failure` se desglosa por la **clase** que escribe `infra/ci/verify-artifact.sh` y transporta el job:
#   artifact     → el artefacto no se construyó, no arrancó o una imagen no existe para la arquitectura del destino
#                  (ADR-051 §3; `infra/deploy/check-image-platforms.sh` sale con 3, design D9 de `object-store`).
#   environment  → el entorno no dejó verificar; nadie ha comprobado el artefacto.
#   vacía        → **no se afirma ninguna causa**. Vacío ≠ `artifact`: si el mecanismo de transporte falla, o el job
#                  muere antes de clasificar, la salida honesta es decir que la verificación no pasó y callar el
#                  porqué. Confundir "no lo sé" con "lo de siempre" es exactamente el defecto que esto arregla.
# En los tres casos `state` es `failure` y este script sale ≠0: **un fallo de entorno no es verde**. Lo que cambia es
# qué se dice que pasó, no si pasó.
#
# El `name` NO se desglosa, y no es un descuido: el nombre del job se evalúa en el YAML a partir de los contextos
# `needs`, donde la clase no está (viaja por un artefacto que solo el propio job de reporte puede recoger). Así que el
# nombre se queda en el enunciado que es cierto en los tres casos —la verificación no pasó— y la causa la lleva la
# descripción.
#
# Longitud: un estado de commit admite 140 caracteres de `description`, y no está escrito en ninguna parte si el límite
# se cuenta en caracteres o en bytes. Todas las descripciones se midieron al escribirlas por **las dos** varas; la más
# larga es la de `environment`, con 137 caracteres y 139 bytes. Alargar una sin medirla se lleva por delante la
# publicación del estado, que es la única superficie que se lee sin abrir la corrida.
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
# Opcional **a propósito**: su ausencia es un desenlace previsto (sin causa), no un error de invocación.
VERIFY_FAIL_CLASS="${VERIFY_FAIL_CLASS:-}"
# Ausente = `real` (ver la cabecera): `cd-prod` no lo pasa hasta 35c.
RUN_MODE="${RUN_MODE:-real}"

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
    # La clase la escribe `infra/ci/verify-artifact.sh` y la transporta el job; ver el bloque de cabecera. El `*`
    # cubre tanto la ausencia como cualquier valor que no se reconozca: en los dos casos lo único honesto es no
    # nombrar causa alguna.
    case "$VERIFY_FAIL_CLASS" in
      artifact)
        description="El artefacto no se construyó, no arrancó o no existe para la arquitectura del destino: no se publicó ni desplegó nada."
        ;;
      environment)
        description="No se pudo verificar el artefacto: el registro de terceros no sirvió sus imágenes. Nada publicado ni desplegado. Reintentar suele bastar."
        ;;
      *)
        description="La verificación del artefacto no pasó: no se publicó nada y no se desplegó nada."
        ;;
    esac
  else
    # `cancelled` o `skipped` no son "artefacto roto", y decir que no arrancó sería inventarse el motivo: tampoco
    # son verde, porque nadie ha comprobado nada. Se nombra el resultado real.
    description="La verificación del artefacto terminó en '${VERIFY_RESULT}': no se publicó nada y no se desplegó nada."
  fi
elif [ "$PREFLIGHT_STATE" != 'full' ] && [ "$PREFLIGHT_STATE" != 'none' ]; then
  status_state='failure'
  name="resultado: destino de ${TARGET_LABEL} indeterminado — no se desplegó"
  description="El preflight terminó en '${PREFLIGHT_RESULT}' con estado '${PREFLIGHT_STATE:-vacío}': no se despliega."
elif [ "$RUN_MODE" = 'test' ]; then
  status_state='success'
  name="resultado: artefacto verificado — NO desplegado (modo de prueba)"
  description="Artefacto verificado. NO desplegado: el modo de prueba nunca despliega, haya o no destino de ${TARGET_LABEL}."
elif [ "$RUN_MODE" = 'off-main' ]; then
  status_state='success'
  name="resultado: artefacto verificado — NO desplegado (corrida fuera de main)"
  description="Artefacto verificado. NO desplegado: solo una corrida de main despliega a ${TARGET_LABEL}."
elif [ "$RUN_MODE" != 'real' ]; then
  status_state='failure'
  name="resultado: modo de corrida desconocido — no se desplegó"
  description="Modo de corrida desconocido '${RUN_MODE:0:40}' (se espera real, test u off-main): no se despliega."
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
else
  status_state='success'
  name="resultado: artefacto verificado — NO desplegado (sin destino de ${TARGET_LABEL})"
  description="Artefacto verificado. NO desplegado: no hay destino de ${TARGET_LABEL} configurado (ADR-048 §3)."
fi

# El job escribe la clase por defecto al empezar, así que en una corrida verde llega con valor y no significa nada: se
# muestra como "no aplica" en vez de dejar un "clase del fallo: artifact" junto a una verificación que pasó.
if [ "$VERIFY_RESULT" = 'success' ]; then
  fail_class_shown='no aplica (la verificación pasó)'
else
  fail_class_shown="${VERIFY_FAIL_CLASS:-vacía}"
fi

printf '=== Resultado del CD\n'
printf '  verificación del artefacto : %s (clase del fallo: %s)\n' "$VERIFY_RESULT" "$fail_class_shown"
printf '  preflight                  : %s (estado: %s)\n' "$PREFLIGHT_RESULT" "${PREFLIGHT_STATE:-vacío}"
printf '  despliegue                 : %s\n' "$DEPLOY_RESULT"
printf '  modo de la corrida         : %s\n' "$RUN_MODE"
printf '  ------------------------------------------------------------\n'
printf '  estado de commit           : %s\n' "$status_state"
printf '  nombre (lista de checks)   : %s\n' "$name"
printf '  descripción                : %s\n' "$description"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '### %s\n\n' "$name"
    printf '%s\n\n' "$description"
    printf '| | |\n|---|---|\n'
    printf '| verificación del artefacto | `%s` (clase del fallo: %s) |\n' "$VERIFY_RESULT" "$fail_class_shown"
    printf '| preflight | `%s` (estado `%s`) |\n' "$PREFLIGHT_RESULT" "${PREFLIGHT_STATE:-vacío}"
    printf '| despliegue | `%s` |\n' "$DEPLOY_RESULT"
    printf '| modo de la corrida | `%s` |\n' "$RUN_MODE"
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
