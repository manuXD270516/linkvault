#!/usr/bin/env bash
# ===================================================================================================================
# Preflight del destino de despliegue: decide **cuál de los tres resultados del CD** aplica a esta corrida.
# ===================================================================================================================
# Grupo 7 del change `deploy-image-verification`; decisión en ADR-048 §3 (que **enmienda** ADR-033 D10); requirement
# "CD a staging en main" de `platform/ci-pipeline` (escenarios "Sin destino configurado el pipeline termina en verde
# sin desplegar" y "Un destino a medias sí falla").
#
# --- Por qué esto es un job con un script, y no un `if:` de job -----------------------------------------------------
# El contexto `secrets` **no está disponible en `jobs.<id>.if`**. Una condición escrita ahí no da error: se evalúa
# contra un contexto vacío, de modo que el job se saltaría —o se ejecutaría— **siempre**, y en silencio. Es el peor
# fallo posible en el mecanismo que existe para dejar de mentir sobre el despliegue. La única vía es mapear los
# secretos a `env:` **dentro de un step** (ahí sí se pueden leer) y emitir el estado como **output del job**, que es
# lo que este script hace.
#
# --- Los tres estados ----------------------------------------------------------------------------------------------
#   `none`    — no hay **ninguno** de los secretos del destino: no hay destino. El CD termina en **verde**
#               diciendo que no desplegó. Es el estado real de este repositorio hoy (ADR-048 §3).
#   `full`    — están todos: hay destino y se despliega.
#   `partial` — están algunos y faltan otros: **fallo**, y este script sale ≠0 nombrando los que faltan. La distinción
#               es por **intención declarada**: quien configuró algunos secretos quería desplegar, así que
#               tratarlo como "no hay destino" sería exactamente la mentira cómoda que ADR-048 §3 prohíbe.
#
# El estado se escribe en `GITHUB_OUTPUT` **antes** de salir ≠0 en el caso `partial`, para que el job de reporte lo
# vea y publique un estado de commit honesto en vez de uno vacío.
#
# --- Lo que este script NO hace --------------------------------------------------------------------------------
#   * **No imprime ningún valor de secreto**, ni su longitud, ni un prefijo: solo el **nombre** y si está o no. Un
#     preflight que revele material de despliegue habría cambiado una mentira por una fuga.
#   * **No comprueba que el destino funcione.** "Están los secretos" no es "hay un servidor que responde": eso lo
#     dice el despliegue, y hoy no hay ninguno contra el que probarlo (fila 35 del plan).
#   * **No decide por `environment`.** En `cd-prod` los secretos son de *environment*, así que un preflight que no
#     pueda leer ese entorno los vería vacíos y reportaría "sin destino → verde" para siempre — la misma mentira
#     mudada al peor sitio (ADR-048 §3). Que el job pueda leerlos es responsabilidad del workflow que lo invoca; el
#     grupo 8 lo cierra para producción.
#
# --- Qué secretos, por destino (tarea 3.1 de `staging-host`, design D3) -----------------------------------------
# La lista **la da quien invoca**, porque cada destino tiene la suya: staging necesita seis (`STAGING_HOST`,
# `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_SSH_HOST_KEY`, `GHCR_READ_USER`, `GHCR_READ_TOKEN`) y producción
# conserva sus cuatro `PROD_*`. Dos formas:
#   * `DEPLOY_SECRETS` con los nombres separados por espacios, y cada valor en la variable de **ese mismo nombre**.
#     Los nombres se validan (`^[A-Z][A-Z0-9_]*$`) antes de leerlos por indirección.
#   * Sin `DEPLOY_SECRETS`, la forma de siempre: `DEPLOY_SECRET_PREFIX` y los cuatro `DEPLOY_HOST`,
#     `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY` y `DEPLOY_COMPOSE_DIR`. Es la que usa `cd-prod.yml`, que este change no toca
#     (35c lo pasará a la lista).
#
# Uso:
#   DEPLOY_TARGET=staging DEPLOY_SECRETS='STAGING_HOST STAGING_SSH_USER …' STAGING_HOST=… STAGING_SSH_USER=… \
#     infra/ci/preflight-deploy-target.sh
#   DEPLOY_TARGET=production DEPLOY_SECRET_PREFIX=PROD \
#   DEPLOY_HOST=… DEPLOY_SSH_USER=… DEPLOY_SSH_KEY=… DEPLOY_COMPOSE_DIR=… \
#     infra/ci/preflight-deploy-target.sh
# ===================================================================================================================
set -euo pipefail

: "${DEPLOY_TARGET:?DEPLOY_TARGET es obligatoria: la etiqueta legible del destino (staging, production)}"

names=()
values=()
if [ -n "${DEPLOY_SECRETS:-}" ]; then
  read -r -a names <<<"$DEPLOY_SECRETS"
  for name in "${names[@]}"; do
    if ! [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
      printf '::error::DEPLOY_SECRETS lleva un nombre no válido: %s\n' "$name" >&2
      exit 2
    fi
    values+=("${!name:-}")
  done
else
  : "${DEPLOY_SECRET_PREFIX:?DEPLOY_SECRET_PREFIX es obligatoria sin DEPLOY_SECRETS: el prefijo de los secretos}"
  # Los cuatro sufijos, en el orden en que se documentan en infra/README.md.
  for suffix in HOST SSH_USER SSH_KEY COMPOSE_DIR; do
    var="DEPLOY_${suffix}"
    names+=("${DEPLOY_SECRET_PREFIX}_${suffix}")
    values+=("${!var:-}")
  done
fi
total="${#names[@]}"
[ "$total" -gt 0 ] || { printf '::error::la lista de secretos del destino está vacía\n' >&2; exit 2; }

present=()
missing=()
printf '=== Preflight del destino de despliegue (%s)\n' "$DEPLOY_TARGET"
for i in "${!names[@]}"; do
  # Solo importa si está vacío. Se recorta el espacio en blanco porque un secreto con un salto de línea suelto no es
  # un destino: se configuró mal, y tratarlo como presente llevaría a un `ssh` que falla sin explicar por qué.
  stripped="${values[$i]//[[:space:]]/}"
  if [ -n "$stripped" ]; then
    present+=("${names[$i]}")
    printf '  %-24s %s\n' "${names[$i]}" 'presente'
  else
    missing+=("${names[$i]}")
    printf '  %-24s %s\n' "${names[$i]}" 'ausente'
  fi
done

if [ "${#missing[@]}" -eq 0 ]; then
  state='full'
  summary="hay destino de ${DEPLOY_TARGET}: los ${total} secretos están configurados"
elif [ "${#present[@]}" -eq 0 ]; then
  state='none'
  summary="no hay destino de ${DEPLOY_TARGET} configurado: ninguno de los ${total} secretos existe"
else
  state='partial'
  summary="destino de ${DEPLOY_TARGET} a medias: faltan ${missing[*]}"
fi

printf '\nestado: %s\n%s\n' "$state" "$summary"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    printf 'state=%s\n' "$state"
    printf 'summary=%s\n' "$summary"
  } >>"$GITHUB_OUTPUT"
fi

case "$state" in
  partial)
    # Nombrar lo que falta, no "faltan secretos": quien configuró unos tiene que saber cuáles le faltan.
    printf '::error::Destino de %s configurado a medias; faltan: %s\n' "$DEPLOY_TARGET" "${missing[*]}"
    printf 'Están: %s. Documentados en infra/README.md.\n' "${present[*]}"
    printf 'Esto es un fallo, no "no hay destino": con algunos secretos puestos, alguien sí quería desplegar\n'
    printf '(ADR-048 §3). Configura los que faltan, o retira los que hay para volver al estado "sin destino".\n'
    exit 1
    ;;
  none)
    printf '::notice::Sin destino de %s: el artefacto se verifica y NO se despliega (ADR-048 §3).\n' "$DEPLOY_TARGET"
    ;;
esac

exit 0
