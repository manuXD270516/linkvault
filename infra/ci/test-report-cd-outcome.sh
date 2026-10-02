#!/usr/bin/env bash
# ===================================================================================================================
# Prueba de la tabla de decisión de `infra/ci/report-cd-outcome.sh` (tarea 2.2 de `staging-host`, design D1).
# ===================================================================================================================
# Ejecuta el reporte con `CD_REPORT_LOCAL=1` (no publica nada) en **cada** combinación de las cuatro dimensiones
#   verificación × preflight × despliegue × modo de la corrida (con `RUN_MODE` ausente como un modo más)
# y compara el estado, el nombre y el código de salida con los que dicta la tabla, escrita aquí **otra vez y por
# separado**: si el script y esta prueba se escribieran desde la misma fuente, un error en la tabla pasaría por los dos.
# Los nombres son el contrato con la expresión `name:` del job `report` del workflow, por eso se comparan literales.
#
# El texto de la clase `artifact` (el que dejó `object-store`, su tarea 2.16) se **lee del script**, no se copia aquí:
# lo que se comprueba es que el caso lo imprime, no cuál es.
#
# Solo usa builtins de bash además del propio `bash`: en Windows el PATH que hereda puede no tener `grep` ni `sed`.
# Uso: infra/ci/test-report-cd-outcome.sh   (sale 0 si todos los casos coinciden; la última línea dice cuántos corrió)
# ===================================================================================================================
set -uo pipefail

root="${BASH_SOURCE[0]%/*}/../.."
script="$root/infra/ci/report-cd-outcome.sh"
[ -f "$script" ] || { printf '[FAIL] no encuentro %s\n' "$script" >&2; exit 2; }

# Texto de la clase `artifact`: la línea `description="…"` que sigue a `artifact)` en el script.
artifact_text=''
seen_artifact=0
while IFS= read -r line || [ -n "$line" ]; do
  if [ "$seen_artifact" = 1 ] && [[ "$line" =~ description=\"([^\"]+)\" ]]; then
    artifact_text="${BASH_REMATCH[1]}"
    break
  fi
  [[ "$line" =~ ^[[:space:]]*artifact\)[[:space:]]*$ ]] && seen_artifact=1
done <"$script"
[ -n "$artifact_text" ] || { printf '[FAIL] no encuentro en el script el texto de la clase artifact\n' >&2; exit 2; }

# Dimensiones. Verificación: resultado y clase del fallo («:» separa; clase vacía = sin causa).
VERIFICATIONS=('success:' 'failure:artifact' 'failure:environment' 'failure:' 'cancelled:')
# Preflight: estado y resultado del job (un destino a medias hace fallar el job; vacío = no llegó a emitir estado).
PREFLIGHTS=('full:success' 'none:success' 'partial:failure' ':failure')
DEPLOYS=('success' 'failure' 'skipped')
MODES=('real' 'test' 'off-main' '<ausente>')

target='staging'
cases=0
failures=0

expect() {
  # $1 verificación, $2 estado del preflight, $3 despliegue, $4 modo → fija exp_state y exp_name.
  local verify="$1" pstate="$2" deploy="$3" mode="$4"
  [ "$mode" = '<ausente>' ] && mode='real'
  if [ "$verify" != 'success' ]; then
    exp_state='failure'; exp_name='resultado: el artefacto NO pasó la verificación'
  elif [ "$pstate" != 'full' ] && [ "$pstate" != 'none' ]; then
    exp_state='failure'; exp_name="resultado: destino de ${target} indeterminado — no se desplegó"
  elif [ "$mode" = 'test' ]; then
    exp_state='success'; exp_name='resultado: artefacto verificado — NO desplegado (modo de prueba)'
  elif [ "$mode" = 'off-main' ]; then
    exp_state='success'; exp_name='resultado: artefacto verificado — NO desplegado (corrida fuera de main)'
  elif [ "$pstate" = 'full' ] && [ "$deploy" = 'success' ]; then
    exp_state='success'; exp_name="resultado: artefacto verificado y desplegado a ${target}"
  elif [ "$pstate" = 'full' ]; then
    exp_state='failure'; exp_name="resultado: artefacto verificado, despliegue a ${target} NO completado"
  else
    exp_state='success'; exp_name="resultado: artefacto verificado — NO desplegado (sin destino de ${target})"
  fi
}

field() {
  # Valor de la línea «<etiqueta> : valor» de la salida del reporte.
  local label="$1" out="$2" line
  while IFS= read -r line; do
    if [[ "$line" == *"$label"*:* ]]; then
      printf '%s' "${line#*: }"
      return
    fi
  done <<<"$out"
}

for v in "${VERIFICATIONS[@]}"; do
  verify="${v%%:*}"; class="${v#*:}"
  for p in "${PREFLIGHTS[@]}"; do
    pstate="${p%%:*}"; presult="${p#*:}"
    for deploy in "${DEPLOYS[@]}"; do
      for mode in "${MODES[@]}"; do
        cases=$((cases + 1))
        expect "$verify" "$pstate" "$deploy" "$mode"
        env_args=(CD_REPORT_LOCAL=1 "PATH=$PATH" "TARGET_LABEL=$target" "VERIFY_RESULT=$verify"
          "VERIFY_FAIL_CLASS=$class" "PREFLIGHT_RESULT=$presult" "PREFLIGHT_STATE=$pstate" "DEPLOY_RESULT=$deploy")
        [ "$mode" != '<ausente>' ] && env_args+=("RUN_MODE=$mode")
        out="$(env -i "${env_args[@]}" bash "$script" 2>&1)"
        code=$?
        got_state="$(field 'estado de commit' "$out")"
        got_name="$(field 'nombre (lista de checks)' "$out")"
        got_desc="$(field 'descripción' "$out")"
        problem=''
        [ "$got_state" = "$exp_state" ] || problem+=" estado '${got_state}' (esperado '${exp_state}');"
        [ "$got_name" = "$exp_name" ] || problem+=" nombre '${got_name}' (esperado '${exp_name}');"
        if [ "$exp_state" = 'success' ] && [ "$code" -ne 0 ]; then problem+=" sale ${code} siendo success;"; fi
        if [ "$exp_state" = 'failure' ] && [ "$code" -eq 0 ]; then problem+=' sale 0 siendo failure;'; fi
        if [ "$verify" = 'failure' ] && [ "$class" = 'artifact' ] && [ "$got_desc" != "$artifact_text" ]; then
          problem+=" descripción '${got_desc}' (esperada la de la clase artifact);"
        fi
        if [ -n "$problem" ]; then
          failures=$((failures + 1))
          printf '[FAIL] verificación=%s clase=%s preflight=%s despliegue=%s modo=%s:%s\n' \
            "$verify" "${class:-vacía}" "${pstate:-vacío}" "$deploy" "$mode" "$problem"
        fi
      done
    done
  done
done

expected_cases=$(( ${#VERIFICATIONS[@]} * ${#PREFLIGHTS[@]} * ${#DEPLOYS[@]} * ${#MODES[@]} ))
if [ "$cases" -ne "$expected_cases" ]; then
  printf '[FAIL] corrí %s casos y el producto de las dimensiones es %s\n' "$cases" "$expected_cases"
  failures=$((failures + 1))
fi
printf 'test-report-cd-outcome: %s casos (%s×%s×%s×%s), %s fallos\n' "$cases" "${#VERIFICATIONS[@]}" \
  "${#PREFLIGHTS[@]}" "${#DEPLOYS[@]}" "${#MODES[@]}" "$failures"
[ "$failures" -eq 0 ]
