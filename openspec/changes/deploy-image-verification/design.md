# Diseño — `deploy-image-verification`

## Context

Ver `proposal.md` §Why. Lo que condiciona el diseño y no está ahí:

- **La causa está reproducida, no inferida.** `pnpm nx build api --configuration=production` genera en `dist/apps/api`
  su propio `package.json`, `pnpm-lock.yaml` y `pnpm-workspace.yaml`. El manifiesto generado **lleva
  `packageManager: pnpm@12.4.2`**; el lockfile generado **no lleva** la entrada `packageManagerDependencies` que pnpm 12
  asocia a ese campo. Con `--frozen-lockfile`, pnpm aborta. Retirando ese campo, el mismo install termina en **3,4 s**.
- **No hay servidor de staging ni secretos.** `gh secret list` devuelve vacío. Cualquier diseño que dependa de un
  destino para estar en verde repetiría el error que este change corrige.
- **`cd-prod` nunca se ha ejecutado** (cero ejecuciones), así que no hay evidencia de nada sobre él.
- El `verify` de `cd-staging` sí pasa: instala desde la raíz, donde el lockfile es coherente. Por eso el PR se veía
  sano y el fallo vivía en el job siguiente.

## Goals / Non-Goals

**Goals:**

- Que las imágenes de `api` y `worker` se construyan, **sin renunciar a la resolución bloqueada**.
- Que el pipeline compruebe que el artefacto **arranca**, no solo que compila, y que pueda hacerlo **hoy**, sin
  infraestructura que no existe.
- Que el estado del CD sea legible de un vistazo y **no pueda volver a esconder un defecto real detrás de un rojo
  esperado**.
- Que dos mentiras de la documentación operativa dejen de serlo, y que se detecten solas si vuelven.

**Non-Goals:**

- Provisionar servidor de staging, secretos, DNS o Traefik.
- Cambiar el mecanismo de despliegue (GHCR → ssh → compose pull+up) ni el smoke contra la red interna.
- Cualquier cambio funcional de la aplicación.
- Reescribir `docs/design.md`, que promete trazas OTel inexistentes: es deuda real, pero es de otro change (ver
  Pendientes).

## Decisions

### D1. Se quita `packageManager` del manifiesto del artefacto, no el candado del lockfile

Las dos formas de que el install pase son eliminar la **causa** (el campo que exige una entrada ausente) o eliminar la
**detección** (el `--frozen-lockfile`). La segunda pone el pipeline en verde hoy y deja el artefacto a merced de lo que
haya publicado el registro el día del build.

El campo no aporta nada en la imagen: dentro del contenedor no se gestiona ninguna versión de gestor de paquetes, y la
instalación ya ocurre con la versión que fija la etapa de build. Es decir, **se retira algo que no hacía falta**, en
vez de renunciar a una garantía que sí.

*Alternativa descartada:* generar el lockfile del artefacto con la entrada `packageManagerDependencies`. Es coherente,
pero depende de lo que Nx decida escribir en cada versión y nos ata a reproducir un detalle interno del formato.

*Alternativa descartada:* `pnpm deploy`. Resuelve el caso de forma idiomática, pero cambia la estructura del artefacto
y el `Dockerfile` entero; es una reescritura mayor para un problema que se cierra quitando un campo. Queda anotada por
si el manifiesto generado vuelve a dar guerra.

### D2. El artefacto se verifica en el corredor, no en un servidor

La comprobación que faltaba —**¿arranca?**— no necesita staging: necesita las imágenes recién construidas y sus
dependencias. Se levantan en el propio runner y se le pide a `api` readiness real (mongo y redis), que es lo mismo que
el smoke post-deploy exige.

Esto cambia la naturaleza del pipeline: pasa de "no puedo estar verde hasta que alguien provisione un servidor" a
"estoy verde cuando he hecho todo lo que puedo hacer". Es lo que permite que un rojo vuelva a significar algo.

*Nota sobre el alcance:* se verifica `api`, que es la que tiene readiness con dependencias. `worker` comparte la etapa
de dependencias de producción —y por tanto el defecto—, así que su build queda cubierto por el mismo arreglo; añadir
una comprobación de arranque para `worker` es barato y se decide en el debate.

### D3. Tres resultados, no dos

El pipeline distingue **artefacto roto** (fallo), **desplegado** (verde, con smoke) y **verificado sin destino**
(verde, diciendo que no se desplegó). Hoy los tres colapsan en rojo.

Esto **no contradice ADR-033 D10**, lo concreta: un dry-run sigue sin contar como despliegue y el pipeline sigue sin
poder afirmar que desplegó. Lo que cambia es que "no había dónde desplegar" deja de comunicarse como avería. ADR-033
quiso evitar la mentira optimista y produjo, sin querer, una señal inútil — y una señal inútil se ignora, que es cómo
un `ERR_PNPM_FROZEN_LOCKFILE` sobrevivió veintiún intentos.

**El caso peligroso es el destino a medias**: secretos configurados en parte. Ahí alguien **sí** quería desplegar, así
que es un fallo y no un "no hay destino". La distinción es por intención declarada, no por conveniencia.

### D4. Lo que se afirma sobre el producto en la documentación se comprueba sola

Las dos mentiras encontradas tienen la misma forma: una afirmación cierta cuando se escribió, que nadie volvió a mirar
cuando dejó de serlo. Corregir el texto sin más las deja volver.

- **"Hoy no existe el borrado de cuenta"** (cuatro sitios del RUNBOOK) mientras `DELETE /api/users/me` existe con su
  cascada probada. Un operador que siga el RUNBOOK borraría a mano, sin transacción, y **omitiría lo que no recuerde**.
- **`BYOK_OPENROUTER_MODEL` apunta a un modelo que el propio RUNBOOK declara muerto (`404`).** No falla ruidosamente:
  abre el breaker y degrada en silencio.

La regla que se escribe en las specs es la que evita la reincidencia: **afirmar que una capacidad no existe queda
cubierto por una comprobación**, y **un valor por defecto desmentido por la documentación rompe la verificación**. No
se pide a nadie que se acuerde.

## Risks / Trade-offs

- **Levantar imágenes en el runner alarga el CD** → se acota a `api` y sus dependencias, con plazo; sigue siendo mucho
  más barato que descubrirlo en un servidor.
- **Verde sin desplegar puede leerse como "ya está desplegado"** → por eso el requirement obliga a decir *por qué* no
  se desplegó, de forma visible, y prohíbe afirmar lo contrario. El riesgo de la señal optimista es real y es
  exactamente lo que ADR-033 quería evitar; se mitiga con el texto, no fingiendo que no existe.
- **La comprobación de la documentación puede volverse frágil** (buscar frases literales envejece mal) → se ata a la
  afirmación concreta que hoy es falsa, no a una gramática general.
- **Retirar `packageManager` depende de cómo Nx genere el manifiesto** → si un día deja de escribirlo, el paso se
  vuelve inocuo; si escribe otra cosa incompatible, el build **falla ruidosamente**, que es el comportamiento que
  queremos.

## Open Questions

- **Q1. ¿Se verifica también el arranque de `worker`?** Comparte el defecto y el arreglo; la comprobación de arranque
  es más floja porque no expone readiness HTTP. Barato de añadir, decidible sin tocar el resto.
- **Q2. ¿`web` entra en la verificación de arranque?** Su Dockerfile no tiene la etapa afectada y sirve estáticos; el
  valor es menor.

**No** son preguntas abiertas, aunque lo parezcan: si se retira el campo o se afloja el candado (D1, se retira el
campo), y si "sin destino" es verde (D3, lo es). El debate puede revocarlas, pero son decisiones tomadas.

## Pendientes que este change no cierra

- **Golden sets reales** (aplazado cinco veces; los cinco `golden.jsonl` siguen con etiqueta `placeholder`). Toda la
  línea base de calidad de IA mide datos sintéticos. Candidato firme a la fila 35.
- **OTel**: `docs/design.md` promete trazas exportadas a Grafana Tempo que no existen, y la spec principal de
  observabilidad todavía habla de "este change" tras haberse archivado.
- **No hay servidor de staging.** Este change hace que su ausencia se diga en voz alta; no la resuelve.
