# Diseño — `deploy-image-verification`

## Context

Ver `proposal.md` §Why. Lo que condiciona el diseño y no está ahí:

- **La causa está reproducida, no inferida.** `pnpm nx build api --configuration=production` genera en `dist/apps/api`
  su propio `package.json`, `pnpm-lock.yaml` y `pnpm-workspace.yaml`. El manifiesto generado **lleva
  `packageManager: pnpm@12.4.2`**; el lockfile generado **no lleva** la entrada `packageManagerDependencies` que pnpm 12
  asocia a ese campo. Con `--frozen-lockfile`, pnpm aborta. Retirando ese campo, el mismo install termina en **3,4 s**.
- **No hay servidor de staging ni secretos de repositorio.** `gh secret list` devuelve vacío — y **no enumera los de
  *environment***, que es donde `cd-prod` lee los suyos, así que eso se comprueba al implementar. Cualquier diseño que
  dependa de un destino para estar en verde repetiría el error que este change corrige.
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

### D2. Se verifica la **pila de producción entera** en el corredor, con su propio compose

La comprobación que faltaba —**¿arranca?**— no necesita staging: necesita las imágenes recién construidas y sus
dependencias, levantadas en el propio runner.

Esto cambia la naturaleza del pipeline: pasa de "no puedo estar verde hasta que alguien provisione un servidor" a
"estoy verde cuando he hecho todo lo que puedo hacer". Es lo que permite que un rojo vuelva a significar algo.

**Rectificación de la primera versión de este diseño.** Escribí que se verificaría solo `api` "que es la que tiene
readiness con dependencias", y que `worker` no expone readiness HTTP. **Era falso**: `worker` sirve `GET /health` con
los mismos indicadores de mongo y redis en su puerto de salud. Lo afirmé sin comprobarlo, que es exactamente el pecado
que este change persigue.

El alcance sube a **`api`, `worker` y `web`**, y por dos razones que no son simetría:

- **`web` es lo único que una persona toca**, y hoy se publica sin que nada compruebe que sirve algo. Un SPA que no
  entregue su documento pasaría el pipeline entero.
- **`worker` tiene su propio grafo de dependencias de producción**, así que es justo donde un "el build pasa y la
  imagen queda mal" sobreviviría sin testigos.

**Y se usa `docker-compose.prod.yml`, no un compose escrito para CI.** Un compose paralelo verificaría una
configuración que nadie ejecuta — y es literalmente donde estaba escondido el segundo defecto (D2-bis). Lo único que
puede diferir es apuntar a las imágenes recién construidas y dejar fuera Traefik y los certificados, que exigen DNS y
ACME. Los valores de entorno vienen del fichero de producción. Mongo, replica set, como en producción.

### D2-bis. El compose de producción tampoco podía arrancar, y eso es un segundo defecto nunca verificado

Arreglar la imagen no habría bastado. `docker-compose.prod.yml` **no declara variables que sus procesos validan al
arrancar**: a `api` le faltan las de correo y los TTL de tokens de auth; a `worker`, `WEB_BASE_URL` y las de correo.
Ambos terminan con código distinto de cero **antes de escuchar**, así que el stack no arranca degradado: **no
arranca**.

Es el mismo patrón que el del build —algo que se dio por hecho y nadie ejecutó— y por eso la corrección no es solo
añadir las variables, sino **comprobar la correspondencia contra los esquemas de configuración**, de modo que la
próxima variable obligatoria que alguien añada al código rompa la comprobación en vez de romper el despliegue.

La comprobación es **unidireccional**: el compose puede declarar opcionales de más; lo prohibido es que el esquema
exija algo que el compose no da. La dirección contraria es la que impide arrancar.

### D2-ter. Lo que se publica es, por identidad, lo que se verificó

La primera versión de este diseño pedía "construir → verificar → publicar" y lo dejaba ahí. **No basta.** Una imagen
cargada en el daemon vive **solo en ese runner**: si la publicación ocurre donde la imagen no está, se reconstruye — y
se publican bits que nadie verificó. Se cumpliría el orden y se incumpliría el propósito.

La garantía correcta no es temporal sino de **identidad**: lo publicado y lo verificado tienen el **mismo digest**,
comprobado en la propia corrida, y si difieren el pipeline falla. Es la tercera vez en este change que la forma de una
regla se cumple y su contenido no.

### D3. Tres resultados, no dos

El pipeline distingue **artefacto roto** (fallo), **desplegado** (verde, con smoke) y **verificado sin destino**
(verde, diciendo que no se desplegó). Hoy los tres colapsan en rojo.

**Esto es una enmienda a ADR-033 D10, y hay que llamarla así.** La primera versión de este diseño decía "no contradice,
concreta" mientras las propias tareas lo llamaban enmienda; una de las dos sobraba. D10 no prohibía solo el dry-run: la
regla operativa vigente, escrita en `infra/README.md` y en la cabecera de los dos workflows, es **"sin secretos el job
de deploy falla"**. Eso se revoca. Lo que se mantiene íntegro es que **un dry-run no cuenta como despliegue** y que el
pipeline nunca afirma haber desplegado.

ADR-033 quiso evitar la mentira optimista y produjo, sin querer, una señal que no podía ser verde — y una señal así se
ignora, que es cómo un `ERR_PNPM_FROZEN_LOCKFILE` sobrevivió veintiún intentos.

**El caso peligroso es el destino a medias**: secretos configurados en parte. Ahí alguien **sí** quería desplegar, así
que es un fallo y no un "no hay destino". La distinción es por intención declarada, no por conveniencia.

**El mecanismo importa y se fija aquí**, porque escrito en prosa se implementa mal: el contexto de secretos **no está
disponible en un `if:` de job**, así que la condición se evaluaría en vacío y el job se saltaría —o se ejecutaría—
siempre, en silencio. Un job `preflight` mapea los secretos a variables de entorno en un step y emite el estado
(`none`, `partial`, `full`); el job de despliegue depende de él con un `if:` sobre ese output y **sin `always()`**,
porque meter la rama "sin destino" en el mismo job con `always()` o `continue-on-error` dejaría pasar en verde un
artefacto roto — el fallo exacto que este change corrige.

**Y en producción los secretos son de *environment*, no de repositorio.** Un preflight que no declare
`environment: production` los leerá vacíos y reportará "sin destino → verde" **para siempre**, aunque estén
configurados. Sería la misma mentira, mudada al sitio donde más cuesta.

### D3-bis. El resultado se lee desde la lista, no desde el run

"Verde sin desplegar" es honesto hoy y se convierte en rebaja **por el paso del tiempo**: dentro de tres meses nadie
abre la ejecución, ve cuarenta ticks verdes en la lista de commits y concluye que hay algo desplegado. El aviso dentro
del run no alcanza a quien mira desde fuera.

Por eso el estado va en **una superficie que alguien mire sin abrir la corrida** —la lista de checks del commit—, y por
eso el compromiso del destino necesita **fila propia y precedencia**, no una nota al pie: un estado sin dueño ni límite
dura para siempre, que es el mismo mecanismo que produjo los veintiún rojos, invertido de signo.

Se descartó fijar una **fecha**: nadie la había acordado, y una fecha inventada envejece sola sin que nada la observe.
La precedencia —ningún change puede preceder a la fila 35 mientras el pipeline termine en "verificado sin destino"— se
comprueba con un dato objetivo. *Y este párrafo es el mejor ejemplo de por qué:* la primera versión daba la fecha por
escrita cuando no existía, y esa afirmación sobrevivió en cuatro sitios hasta la tercera iteración del debate, incluida
la tarea que la habría reintroducido al implementarla.

### D3-ter. Un release se verifica entero, no por afectación

En un tag que apunta a un commit de `main`, la base y la cabeza del cálculo de afectación coinciden, así que
`nx affected` verifica **cero proyectos** y "verify verde" antes de desplegar a producción no significaría nada. Nunca
se ha detectado porque `cd-prod` no se ha ejecutado jamás. Un release verifica todo el workspace; acotar por afectación
abarata pushes y PRs, no una publicación.

### D4. Lo que se afirma sobre el producto en la documentación se comprueba sola

Las dos mentiras encontradas tienen la misma forma: una afirmación cierta cuando se escribió, que nadie volvió a mirar
cuando dejó de serlo. Corregir el texto sin más las deja volver.

- **"Hoy no existe el borrado de cuenta"** (**ocho** sitios del RUNBOOK) mientras `DELETE /api/users/me` existe con su
  cascada probada. Un operador que siga el RUNBOOK borraría a mano, sin transacción, y **omitiría lo que no recuerde**.
- **`BYOK_OPENROUTER_MODEL` apunta a un modelo que el propio RUNBOOK declara muerto (`404`).** No falla ruidosamente:
  abre el breaker y degrada en silencio.

La regla que se escribe en las specs es la que evita la reincidencia: **afirmar que una capacidad no existe queda
cubierto por una comprobación**, y **un valor por defecto desmentido por la documentación rompe la verificación**. No
se pide a nadie que se acuerde.

Con tres correcciones que el debate obligó a hacer, y que son la diferencia entre una regla y una regla que funciona:

- **La comprobación se ata a un registro declarado**, no a la prosa. La primera versión exigía que *cualquier*
  procedimiento que afirmara la inexistencia de algo quedara cubierto, lo que obliga a analizar todo el RUNBOOK. Ahora
  cada entrada asocia un patrón con el símbolo del código que lo desmiente: reescribir la frase con otras palabras
  rompe el patrón registrado, en vez de fingir cobertura total.
- **Las comprobaciones habrían nacido muertas.** `nx.json` no incluye `.env.example` ni `docs/**` entre sus entradas
  globales: un commit que solo tocara el RUNBOOK no marcaría ningún proyecto como afectado y, peor, el hash de caché no
  cambiaría y Nx **restauraría un verde cacheado**. La salida **no** es meter `docs/**` en las globales —en un
  repositorio dirigido por specs eso invalidaría la caché de todos los proyectos en casi cada commit, desactivándola de
  hecho—: a globales van solo `.env.example` y el compose de producción, la documentación entra por las **entradas
  explícitas** del proyecto de comprobaciones, y ese proyecto corre como paso **incondicional**, sin depender de la
  afectación.
- **El arreglo del modelo muerto podía apagar una protección — dos veces.** `data_collection: deny` solo se fuerza con
  modelos `:free`; sustituirlo por uno verificado que no lo sea haría viajar el texto del CV **sin esa política**, en
  silencio — peor que el modelo muerto, que al menos falla.

  Y la corrección que escribí en la iteración 1 —"la variable queda vacía con aviso"— **tenía el mismo defecto**: la
  factory construye el proveedor igualmente y pone la política en `omit`, y un valor vacío se lee como ausente y cae
  al valor por defecto del **código**. El estado por defecto habría mandado texto de CV sin protección, por el arreglo
  pensado para protegerlo.

  **"Sin modelo utilizable" significa proveedor no disponible**, no proveedor sin política: no se construye y no entra
  en el enrutado. Avisar no basta. Y el valor vive en **tres** sitios —ejemplo, compose de producción y el default del
  código—, así que arreglar solo el ejemplo dejaría la avería donde más cuesta verla.

## Risks / Trade-offs

- **Levantar la pila en el runner alarga el CD** → se acota a la **pila mínima**: sin Traefik ni certificados, con
  plazo explícito y volcado de logs al vencer. Sigue siendo mucho más barato que descubrirlo en un servidor.
- **Verde sin desplegar puede leerse como "ya está desplegado"** → por eso el requirement obliga a decir *por qué* no
  se desplegó, de forma visible, y prohíbe afirmar lo contrario. El riesgo de la señal optimista es real y es
  exactamente lo que ADR-033 quería evitar; se mitiga con el texto, no fingiendo que no existe.
- **La comprobación de la documentación puede volverse frágil** (buscar frases literales envejece mal) → se ata a la
  afirmación concreta que hoy es falsa, no a una gramática general.
- **Retirar `packageManager` depende de cómo Nx genere el manifiesto** → si un día deja de escribirlo, el paso se
  vuelve inocuo; si escribe otra cosa incompatible, el build **falla ruidosamente**, que es el comportamiento que
  queremos.

## Open Questions

- **Q1 y Q2 — cerradas en el debate, las dos en "sí".** Se verifica `worker` (expone readiness, y su premisa para
  excluirlo era falsa) y se verifica `web` (es lo único que una persona toca). Ninguna era una pregunta: eran alcance
  recortado justo por debajo de donde estaba el valor.
- **Q3 — cerrada, y no era una pregunta: el repositorio ya la había respondido.** Pregunté si existe algún modelo de
  OpenRouter a la vez disponible y sujeto a `data_collection: deny`, citando la parte del RUNBOOK que dice que los
  `:free` populares estaban en rate-limit. **Omití el párrafo de al lado**, que registra con fecha la pasada real y el
  modelo confirmado: `cohere/north-mini-code:free`, que `.env.example` ya usa para el proveedor de plataforma. Ese es
  el sustituto, en las tres fuentes.

  La regla "sin modelo utilizable → proveedor no disponible" **se queda**, pero como **invariante**, no como el camino
  esperado: dejarla escrita como desenlace probable habría llevado a vaciar la variable y a dejar BYOK-OpenRouter
  inenrutable sin motivo — una regresión funcional metida por un change de infraestructura, a partir de una premisa
  que el propio repositorio desmentía.

**No** son preguntas abiertas, aunque lo parezcan: si se retira el campo o se afloja el candado (D1, se retira el
campo), y si "sin destino" es verde (D3, lo es). El debate puede revocarlas, pero son decisiones tomadas.

## Pendientes que este change no cierra

- **Golden sets reales** (aplazado cinco veces; los cinco `golden.jsonl` siguen con etiqueta `placeholder`). Toda la
  línea base de calidad de IA mide datos sintéticos. Van a la **fila 36**, no a la 35: business argumentó —y le doy la
  razón— que miden la calidad de funciones de IA que **nadie fuera del autor usa**, y que con cero usuarios la sexta
  curación volvería a ser sintética. La **fila 35 es destino real y primeros usuarios**.
- **OTel**: `docs/design.md` promete trazas exportadas a Grafana Tempo que no existen, y la spec principal de
  observabilidad todavía habla de "este change" tras haberse archivado.
- **No hay servidor de staging.** Este change hace que su ausencia se diga en voz alta; no la resuelve.
