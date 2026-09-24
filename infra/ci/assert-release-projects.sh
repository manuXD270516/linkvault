#!/usr/bin/env bash
# ===================================================================================================================
# Guardia del conjunto vacío: un release NO puede verificarse "en verde" sin haber ejecutado nada.
# ===================================================================================================================
# Tareas 8.4 y 8.5 del change `deploy-image-verification`; requirement "CD a producción por tag semver" de
# `platform/ci-pipeline` (escenario "Un release verifica todo el workspace").
#
# --- El defecto que esto cierra --------------------------------------------------------------------------------------
# `cd-prod.yml` derivaba la base de afectación con `nrwl/nx-set-shas` y verificaba con `nx affected`. Un tag apunta
# casi siempre a un commit que **ya está en `main`**, así que base y cabeza coinciden y el conjunto afectado sale
# vacío. Medido en este repositorio (Nx 23.2.1):
#
#     $ pnpm nx show projects --affected --base=HEAD --head=HEAD --json
#     []
#     $ NX_BASE=HEAD NX_HEAD=HEAD pnpm nx affected -t lint
#     NX   No tasks were run            ← y termina con código **0**
#
# Es decir: el `verify` de un release daba **verde sin ejecutar una sola tarea**, justo antes de desplegar a
# producción. De ahí las dos mitades del arreglo: el release verifica con `run-many --all` (8.4) y, además, este
# guardia comprueba que ese "todo" **no está vacío** (8.5).
#
# --- Por qué hace falta el guardia si ya se usa `--all` ---------------------------------------------------------------
# Porque `--all` tampoco garantiza que se ejecute algo. Medido igual:
#
#     $ pnpm nx run-many --all -t no-such-target
#     NX   No tasks were run            ← código **0**
#
# Un target renombrado, un `project.json` que deja de declararlo o un filtro mal puesto dejan el conjunto vacío y el
# paso en verde. "No se ejecutó nada" y "se ejecutó todo y pasó" tienen que distinguirse, o el verde del release no
# significa nada.
#
# --- Por qué **solo** en el modo release, y nunca en `ci.yml` ni en `cd-staging.yml` -----------------------------------
# Ahí el conjunto vacío es **legítimo**: un merge que solo toca documentación o specs no afecta a ningún proyecto, y
# `nx affected` no ejecutando nada es la respuesta correcta. Un guardia incondicional pondría esos merges en rojo
# inventando un fallo donde no lo hay —y las comprobaciones de repositorio, que sí tienen que correr siempre, ya van
# como paso **incondicional** en `ci.yml` (tarea 3.2), no por afectación—. Por eso este script se invoca **únicamente**
# desde `cd-prod.yml`, y la distinción está escrita aquí para que no se "generalice" más adelante.
#
# --- Qué comprueba exactamente ---------------------------------------------------------------------------------------
# Para cada target del release, la lista de proyectos que `nx` resolvería con `run-many --all -t <target>`. Falla si
# el workspace no declara proyectos, o si **algún** target del release no tiene ni uno. Imprime además la lista
# completa del workspace, que es con lo que 8.4 se comprueba: lo que el release verifica tiene que ser eso y no un
# subconjunto.
#
# Uso:
#   infra/ci/assert-release-projects.sh
#   RELEASE_TARGETS='lint typecheck test' infra/ci/assert-release-projects.sh   # para ejercitarlo
# ===================================================================================================================
set -euo pipefail

# Los mismos targets, y en el mismo orden, que el job `verify` de `cd-prod.yml` ejecuta con `run-many --all`. Si allí
# se añade o se quita uno, aquí también: un target verificado sin guardia vuelve a poder salir vacío en silencio.
RELEASE_TARGETS="${RELEASE_TARGETS:-lint typecheck test eval-ci build}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() {
  printf '::error::%s\n' "$1" >&2
  printf '\n[FAIL] %s\n' "$1" >&2
  shift
  for line in "$@"; do
    printf '       %s\n' "$line" >&2
  done
  exit 1
}

# `nx` se invoca **redirigiendo a fichero**, nunca por tubería: su salida pasa por un renderizador que, sin un
# consumidor que lea hasta el final, puede quedarse bloqueado. El JSON se extrae con node —presente en cualquier sitio
# donde `nx` pueda correr— en vez de con `jq`, que no está garantizado.
list_projects() {
  local target="${1:-}"
  local -a args=(nx show projects --json)
  if [ -n "$target" ]; then
    args+=(--with-target "$target")
  fi
  if ! pnpm "${args[@]}" >"$tmp/out.json" 2>"$tmp/err.txt"; then
    printf '\n--- salida de: pnpm %s\n' "${args[*]}" >&2
    sed -n '1,40p' "$tmp/err.txt" >&2
    fail "'pnpm ${args[*]}' terminó con error: no se puede afirmar qué verifica este release"
  fi
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) { process.stderr.write("no se encontró un array JSON en la salida de nx\n"); process.exit(3); }
    const arr = JSON.parse(m[0]);
    if (arr.length) { process.stdout.write(arr.join("\n") + "\n"); }
  ' "$tmp/out.json"
}

count_of() {
  # Sin proyectos, la cadena es vacía y `wc -l` diría 0 igualmente; se cuenta así para no depender de eso.
  if [ -z "$1" ]; then printf '0\n'; else printf '%s\n' "$1" | wc -l; fi
}

printf '=== Guardia del conjunto de proyectos del release (modo run-many --all)\n'

all="$(list_projects '')"
if [ -z "$all" ]; then
  fail "el workspace no declara **ningún** proyecto: el verify del release no ejecutaría nada" \
    "Un 'No tasks were run' con código 0 se lee igual que un verify completo en verde. No lo es." \
    "Revisa la instalación de dependencias y la configuración de Nx antes de desplegar a producción."
fi

printf '\nProyectos del workspace (%s):\n' "$(count_of "$all")"
printf '%s\n' "$all" | sed 's/^/  - /'

empty=()
printf '\nProyectos por target del release:\n'
for target in $RELEASE_TARGETS; do
  projects="$(list_projects "$target")"
  n="$(count_of "$projects")"
  if [ "$n" -eq 0 ]; then
    empty+=("$target")
    printf '  %-12s %s  <-- VACÍO\n' "$target" "$n"
  else
    printf '  %-12s %s  (%s)\n' "$target" "$n" "$(printf '%s' "$projects" | tr '\n' ' ')"
  fi
done

if [ "${#empty[@]}" -gt 0 ]; then
  fail "el release verificaría **cero proyectos** para: ${empty[*]}" \
    "'nx run-many --all -t <target>' sin ningún proyecto que lo declare termina con 'No tasks were run' y" \
    "código 0, así que ese verify saldría verde sin haber ejecutado nada — justo antes de desplegar a" \
    "producción. Comprueba que los proyectos siguen declarando esos targets, o corrige la lista de targets" \
    "del release en cd-prod.yml y en RELEASE_TARGETS de este script (van juntas)."
fi

printf '\nok: el release verifica %s proyectos y ningún target del release queda vacío\n' "$(count_of "$all")"
