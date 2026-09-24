#!/usr/bin/env bash
# ===================================================================================================================
# Comprobaciones de repositorio: el paso **incondicional** de los tres workflows.
# ===================================================================================================================
# Tareas 3.2 y 11.5 del change `deploy-image-verification`; ADR-048 §5.
#
# --- Por qué incondicional y no por afectación ------------------------------------------------------------------------
# Las comprobaciones de `tools/repo-checks` son lecturas de ficheros que tardan segundos, y lo que miran (el compose
# de producción, `.env.example`, el RUNBOOK) no pertenece a ningún proyecto de Nx. Colgarlas de `nx affected` las
# ataría a que el cálculo de afectación las alcance; aquí se ejecutan **siempre**, y el acotado por afectación queda
# para lo que sí es caro.
#
# --- El guardia, y por qué son dos -------------------------------------------------------------------------------------
#  1. **Ninguna comprobación ejecutada.** Un agregador que se quede sin comprobaciones —porque alguien las saca del
#     `dependsOn`, o porque el target se renombra— terminaría en 0 y el paso saldría verde sin haber mirado nada. Un
#     verde sin nada mirado es exactamente la señal falsa que este change existe para no volver a dar, así que si el
#     agregador no dice cuántas ejecutó, o dice cero, esto falla.
#  2. **El agregador no puede ser cacheable.** Si `targets.check` llevara `cache: true`, Nx **reproduciría su salida
#     desde la caché** —incluida la línea "N comprobaciones ejecutadas"— sin ejecutar nada. El guardia 1 la leería y
#     daría verde. Es la misma avería que la tarea 11.2 cierra en `nx.json` (comprobaciones que nacen muertas), un
#     piso más arriba, así que se comprueba aquí en vez de confiar en que nadie toque esa línea.
#
# --- Por qué a fichero y nunca por tubería -----------------------------------------------------------------------------
# La salida de `nx` pasa por un renderizador que, sin un consumidor que lea hasta el final, puede quedarse bloqueado.
# La norma del repositorio (ver `infra/ci/assert-release-projects.sh`) es redirigir a fichero y leer el fichero; la
# versión anterior de este paso, escrita en línea en `ci.yml`, hacía `| tee` y era la única excepción.
#
# --- Los tres workflows -------------------------------------------------------------------------------------------------
# `ci.yml`, `cd-staging.yml` y `cd-prod.yml` invocan **este mismo script**. No hay workflow reutilizable en este
# change (su extracción es de la fila 35), pero el cuerpo del paso vive en un único sitio a propósito: tres bloques
# copiados en tres YAML divergen, y la mitad de este grupo trata justamente de comprobaciones que dejan de
# ejecutarse sin que nadie se entere. Lo que sigue duplicado es la invocación de cuatro líneas de cada workflow.
#
# Uso:
#   infra/ci/repo-checks.sh
# ===================================================================================================================
set -euo pipefail

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  printf '::error file=tools/repo-checks/project.json::%s\n' "$1" >&2
  printf '\n[FAIL] %s\n' "$1" >&2
  shift
  for line in "$@"; do
    printf '       %s\n' "$line" >&2
  done
  exit 1
}

printf '=== Comprobaciones de repositorio (tools/repo-checks), paso incondicional\n\n'

# Guardia 2: el agregador no puede ser cacheable. Se lee el `project.json` con node —presente allí donde `nx` pueda
# correr— en vez de con `grep`, que no distingue en qué target está la línea.
node -e '
  const fs = require("fs");
  const project = JSON.parse(fs.readFileSync("tools/repo-checks/project.json", "utf8"));
  const check = project.targets && project.targets.check;
  if (!check) {
    process.stderr.write("tools/repo-checks/project.json no declara el target agregador \"check\"\n");
    process.exit(1);
  }
  if (check.cache !== false) {
    process.stderr.write(
      "el target agregador \"check\" tiene cache=" + JSON.stringify(check.cache) + "; SHALL ser false\n",
    );
    process.exit(2);
  }
' || fail "el agregador de repo-checks no es ejecutable de forma fiable (ver tools/repo-checks/project.json)" \
  "Con 'cache: true' Nx reproduce la salida guardada —incluida la línea que este paso lee— sin ejecutar" \
  "ninguna comprobación, y el guardia del recuento daría verde sobre un verde restaurado."

log="$tmp/repo-checks.log"
status=0
pnpm nx run repo-checks:check >"$log" 2>&1 || status=$?
cat "$log"

if [ "$status" -ne 0 ]; then
  fail "las comprobaciones de repositorio terminaron con código $status" \
    "La salida completa está arriba: cada comprobación imprime qué miró y qué encontró."
fi

ran="$(sed -nE 's/^repo-checks: ([0-9]+) comprobaciones ejecutadas.*$/\1/p' "$log" | tail -n 1)"
if [ -z "$ran" ] || [ "$ran" -eq 0 ]; then
  fail "el agregador de repo-checks no ejecutó ninguna comprobación" \
    "El agregador (tools/repo-checks/src/aggregate.mjs) imprime cuántas ejecutó; aquí no dijo ninguna." \
    "Un agregador vacío no cuenta como verde: revisa el 'dependsOn' del target 'check'."
fi

printf '\nok: %s comprobaciones de repositorio ejecutadas\n' "$ran"
