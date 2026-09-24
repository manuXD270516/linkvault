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
#   `none`    — no hay **ninguno** de los cuatro secretos: no hay destino. El CD termina en **verde** diciendo que no
#               desplegó. Es el estado real de este repositorio hoy (ADR-048 §3).
#   `full`    — están los cuatro: hay destino y se despliega.
#   `partial` — están algunos y faltan otros: **fallo**, y este script sale ≠0 nombrando los que faltan. La distinción
#               es por **intención declarada**: quien configuró tres secretos quería desplegar, así que tratarlo como
#               "no hay destino" sería exactamente la mentira cómoda que ADR-048 §3 prohíbe.
#
# El estado se escribe en `GITHUB_OUTPUT` **antes** de salir ≠0 en el caso `partial`, para que el job de reporte lo
# vea y publique un estado de commit honesto en vez de uno vacío.
#
# --- Lo que este script NO hace --------------------------------------------------------------------------------
#   * **No imprime ningún valor de secreto**, ni su longitud, ni un prefijo: solo el **nombre** y si está o no. Un
#     preflight que revele material de despliegue habría cambiado una mentira por una fuga.
#   * **No comprueba que el destino funcione.** "Hay cuatro secretos" no es "hay un servidor que responde": eso lo
#     dice el despliegue, y hoy no hay ninguno contra el que probarlo (fila 35 del plan).
#   * **No decide por `environment`.** En `cd-prod` los secretos son de *environment*, así que un preflight que no
#     pueda leer ese entorno los vería vacíos y reportaría "sin destino → verde" para siempre — la misma mentira
#     mudada al peor sitio (ADR-048 §3). Que el job pueda leerlos es responsabilidad del workflow que lo invoca; el
#     grupo 8 lo cierra para producción.
#
# Uso:
#   DEPLOY_TARGET=staging DEPLOY_SECRET_PREFIX=STAGING \
#   DEPLOY_HOST=… DEPLOY_SSH_USER=… DEPLOY_SSH_KEY=… DEPLOY_COMPOSE_DIR=… \
#     infra/ci/preflight-deploy-target.sh
# ===================================================================================================================
set -euo pipefail

: "${DEPLOY_TARGET:?DEPLOY_TARGET es obligatoria: la etiqueta legible del destino (staging, production)}"
: "${DEPLOY_SECRET_PREFIX:?DEPLOY_SECRET_PREFIX es obligatoria: el prefijo con el que se nombran los secretos}"

# Los cuatro sufijos, en el orden en que se documentan en infra/README.md.
SUFFIXES=(HOST SSH_USER SSH_KEY COMPOSE_DIR)

present=()
missing=()

for suffix in "${SUFFIXES[@]}"; do
  var="DEPLOY_${suffix}"
  value="${!var:-}"
  # Solo importa si está vacío. Se recorta el espacio en blanco porque un secreto con un salto de línea suelto no es
  # un destino: se configuró mal, y tratarlo como presente llevaría a un `ssh` que falla sin explicar por qué.
  stripped="$(printf '%s' "$value" | tr -d '[:space:]')"
  if [ -n "$stripped" ]; then
    present+=("${DEPLOY_SECRET_PREFIX}_${suffix}")
  else
    missing+=("${DEPLOY_SECRET_PREFIX}_${suffix}")
  fi
done

printf '=== Preflight del destino de despliegue (%s)\n' "$DEPLOY_TARGET"
for suffix in "${SUFFIXES[@]}"; do
  name="${DEPLOY_SECRET_PREFIX}_${suffix}"
  found='ausente'
  for p in "${present[@]}"; do
    if [ "$p" = "$name" ]; then found='presente'; fi
  done
  printf '  %-24s %s\n' "$name" "$found"
done

if [ "${#missing[@]}" -eq 0 ]; then
  state='full'
  summary="hay destino de ${DEPLOY_TARGET}: los cuatro secretos están configurados"
elif [ "${#present[@]}" -eq 0 ]; then
  state='none'
  summary="no hay destino de ${DEPLOY_TARGET} configurado: ninguno de los cuatro secretos existe"
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
    # Nombrar lo que falta, no "faltan secretos": quien configuró tres tiene que saber cuál es el cuarto.
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
