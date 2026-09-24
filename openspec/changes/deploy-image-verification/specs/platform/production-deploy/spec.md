## MODIFIED Requirements

### Requirement: Imágenes multi-stage publicables

El repositorio SHALL incluir Dockerfiles multi-stage para `api`, `worker` y `web` que produzcan imágenes publicables en
**GHCR**. Las imágenes de `api` y `worker` SHALL declarar un `HEALTHCHECK` de imagen sobre `GET /health/live`
(**liveness** únicamente). La **readiness** (`GET /health`) SHALL ser responsabilidad del orquestador (p. ej. el
`healthcheck` de servicio en `docker-compose.prod.yml`), no del `HEALTHCHECK` embebido en la imagen. La imagen de `api`
SHALL incluir los prompts de IA en la ruta documentada para `AI_PROMPTS_DIR`.

**El build SHALL completarse de verdad**, y esto SHALL comprobarse en cada corrida, no darse por supuesto: durante un
mes el escenario "Build de imágenes" se dio por cumplido mientras las imágenes de `api` y `worker` **no se habían
construido ni una sola vez**.

- **Las dependencias de producción SHALL resolverse de forma reproducible**: la instalación que prepara el artefacto
  SHALL usar exactamente las versiones bloqueadas y NO SHALL permitirse que resuelva contra el registro lo que hubiera
  publicado el día del build. Aflojar el bloqueo para que el build pase NO SHALL considerarse una solución.
- **El manifiesto generado para el artefacto y su bloqueo SHALL ser coherentes entre sí**: ninguno de los dos SHALL
  declarar algo que obligue al otro a cambiar durante una instalación bloqueada. Es exactamente lo que ocurría —el
  manifiesto pedía una versión del gestor de paquetes que el bloqueo no registraba—, y el efecto no era un aviso sino
  la imposibilidad de construir.
- **Las imágenes SHALL arrancar.** Que el código compile y que la imagen se construya no implica que el proceso
  levante: hasta hoy nada comprobaba lo tercero. La comprobación de arranque SHALL cubrir **las tres** imágenes —`api`,
  `worker` y `web`—, porque las tres se publican y las tres se despliegan.

**Lo que la imagen lleva dentro SHALL comprobarse sobre la imagen, y con el proceso ya arrancado**, no sobre el
directorio de compilación del que se construyó. Inspeccionar `dist/` responde a otra pregunta: un `COPY` que no ocurrió,
una ruta que el `Dockerfile` cambió o un `AI_PROMPTS_DIR` que apunta a un directorio vacío pasarían en verde y toda la
IA moriría en el primer despliegue, en el peor sitio posible para descubrirlo.

#### Scenario: Build de imágenes

- **WHEN** se construyen las tres imágenes con los Dockerfiles del repositorio
- **THEN** el build SHALL terminar con éxito sin secretos embebidos en capas
- **AND** las imágenes de `api` y `worker` SHALL declarar `HEALTHCHECK` sobre `/health/live` (liveness)
- **AND** el compose / orquestador de producción SHALL usar `/health` para readiness

#### Scenario: Prompts en la imagen de api

- **GIVEN** el contenedor de `api` **en ejecución** a partir de la imagen construida
- **WHEN** se inspecciona, dentro de ese contenedor, la ruta que resuelve `AI_PROMPTS_DIR`
- **THEN** SHALL existir el árbol de prompts versionados necesarios para `runTask` en producción
- **AND** la comprobación NO SHALL hacerse sobre `dist/` ni sobre ningún directorio del corredor

#### Scenario: Un directorio de prompts vacío rompe la verificación

- **GIVEN** una imagen de `api` cuya ruta de `AI_PROMPTS_DIR` no contiene ningún prompt
- **WHEN** corre la verificación de la imagen arrancada
- **THEN** SHALL fallar nombrando la ruta vacía
- **AND** la imagen NO SHALL darse por apta por el solo hecho de haber arrancado

#### Scenario: Las dependencias de producción se instalan con el bloqueo intacto

- **GIVEN** el artefacto compilado de `api` con su manifiesto y su bloqueo generados
- **WHEN** se instalan sus dependencias de producción exigiendo el bloqueo
- **THEN** la instalación SHALL terminar con éxito
- **AND** NO SHALL haber hecho falta relajar ni regenerar el bloqueo para conseguirlo

#### Scenario: Un manifiesto que obliga a tocar el bloqueo rompe el build

- **GIVEN** un manifiesto generado que declara una versión del gestor de paquetes ausente del bloqueo
- **WHEN** se instalan las dependencias de producción exigiendo el bloqueo
- **THEN** el build SHALL fallar señalando esa incoherencia
- **AND** NO SHALL resolverse permitiendo que la instalación reescriba el bloqueo

#### Scenario: La imagen de api arranca y responde

- **GIVEN** la imagen de `api` recién construida y sus dependencias de infraestructura disponibles
- **WHEN** se ejecuta el contenedor
- **THEN** el proceso SHALL quedar escuchando
- **AND** `GET /health` SHALL responder readiness con sus comprobaciones de mongo y redis

#### Scenario: Las imágenes de worker y web también arrancan

- **GIVEN** las imágenes de `worker` y `web` recién construidas, con sus dependencias disponibles
- **WHEN** se ejecutan los contenedores
- **THEN** `worker` SHALL quedar escuchando en su puerto de salud y `GET /health` SHALL responder readiness con mongo y
  redis
- **AND** `web` SHALL servir el documento del SPA en su puerto
- **AND** que `api` arranque NO SHALL bastar para dar por buenas las otras dos

### Requirement: Contrato de variables de producción

El arranque de producción de `api` (y, donde aplique, `worker`) SHALL exigir las variables obligatorias del entorno real,
entre ellas al menos: `PUBLIC_PAGE_BASE_URL`, `WEB_BASE_URL`, `AI_VAULT_KEY`, las de OpenRouter de plataforma
(`OPENROUTER_*` documentadas), las de enriquecimiento (`ENRICH_*`), las de paste (`PASTE_*` documentadas, incluido
`PASTE_EXTRACTION_TIMEOUT_MS` cuando corresponda) y `AI_PROMPTS_DIR` apuntando a los prompts embebidos en la imagen de
`api`. `TRUST_PROXY=true` SHALL figurar en el compose de producción detrás de Traefik y NO SHALL ser el valor por defecto
en local/dev. Una variable obligatoria ausente o inválida SHALL impedir el arranque según `platform/runtime-health`.

**El compose de producción SHALL declarar todas las variables que sus procesos validan al arrancar.** No es una
recomendación de higiene: un proceso al que le falta una variable obligatoria termina con código distinto de cero
**antes de escuchar**, así que un compose incompleto no arranca degradado, **no arranca**. Es el mismo defecto nunca
verificado que el del build —arreglar la imagen no habría servido de nada— y hoy es real: al servicio `api` le faltan
`MAIL_PROVIDER`, `MAIL_FROM`, `AUTH_VERIFY_TOKEN_TTL_HOURS` y `AUTH_RESET_TOKEN_TTL_SECONDS`, y al servicio `worker`,
`WEB_BASE_URL`, `MAIL_PROVIDER` y `MAIL_FROM`.

- **La correspondencia SHALL comprobarse de forma automatizada contra los esquemas de configuración** que cada proceso
  usa al arrancar (`api-config.schema.ts`, `worker-config.schema.ts` y lo que validen en cadena, como la configuración
  de IA), y NO SHALL depender de que alguien compare las dos listas a ojo. Una variable obligatoria del esquema que no
  tenga valor en el servicio correspondiente del compose SHALL hacer fallar esa comprobación **nombrándola**.
- Una variable SHALL considerarse declarada cuando el compose le da valor en ese servicio, ya sea fijo, por sustitución
  con valor por defecto (`${VAR:-…}`) o por sustitución obligatoria (`${VAR:?}`). Las obligatorias **sin** valor por
  defecto razonable SHALL usar la forma que aborta el `up` nombrando la variable, no una que deje arrancar al
  contenedor para que muera dentro.
- La comprobación NO SHALL exigir que las dos listas coincidan exactamente: el compose MAY declarar variables que el
  esquema trate como opcionales. Lo prohibido es la dirección contraria —que el esquema exija algo que el compose no
  da—, que es la que impide arrancar.

**Ningún valor por defecto del compose SHALL elegir por el operador un comportamiento que descarte trabajo en
silencio.** En particular, el proveedor de correo (`MAIL_PROVIDER`) NO SHALL quedar por defecto en un valor que capture
o deseche los mensajes sin entregarlos: un despliegue de producción que arranca "correctamente" y nunca envía la
verificación de una cuenta es peor que uno que se niega a arrancar, porque el fallo se descubre en la bandeja de
entrada de otra persona. Cuando no haya un valor por defecto seguro, la variable SHALL ser obligatoria y abortar el
arranque nombrándose.

#### Scenario: Arranque sin URL pública

- **GIVEN** un entorno de producción sin `PUBLIC_PAGE_BASE_URL`
- **WHEN** se arranca `api`
- **THEN** el proceso SHALL terminar con código distinto de cero nombrando la variable

#### Scenario: Contrato documentado

- **WHEN** un operador lee `.env.example` o el apartado de variables de `infra/README.md`
- **THEN** SHALL constar la lista de variables obligatorias de producción citadas en este requirement
- **AND** SHALL indicarse que `AI_PROMPTS_DIR` en la imagen de `api` apunta a los assets embebidos
- **AND** SHALL indicarse que `TRUST_PROXY=true` aplica solo detrás de Traefik en compose prod

#### Scenario: El compose de producción declara lo que los procesos exigen

- **GIVEN** los esquemas de configuración con los que `api` y `worker` validan su entorno al arrancar
- **WHEN** corre la comprobación automatizada sobre el compose de producción
- **THEN** cada variable obligatoria del esquema de `api` SHALL tener valor en el servicio `api`
- **AND** cada variable obligatoria del esquema de `worker` SHALL tener valor en el servicio `worker`

#### Scenario: Una variable obligatoria que falta hace fallar la comprobación

- **GIVEN** un esquema que exige una variable sin valor por defecto y un servicio del compose que no la declara
- **WHEN** corre la comprobación automatizada
- **THEN** SHALL fallar nombrando la variable y el servicio al que le falta
- **AND** NO SHALL descubrirse en el arranque del contenedor, que termina antes de escuchar

#### Scenario: El proveedor de correo no se queda por defecto descartando correos

- **WHEN** se inspecciona el compose de producción
- **THEN** `MAIL_PROVIDER` NO SHALL tener como valor por defecto uno que capture o deseche los mensajes sin entregarlos
- **AND** si no se define, el `up` SHALL abortar nombrando la variable

### Requirement: Documentación del camino canónico compose+Traefik

`infra/README.md` SHALL documentar cómo operar el compose de producción (arranque, secretos, TLS, escalado de `worker`,
relay del outbox, placeholders de host **staging** vs **prod** como dos targets de deploy). Otros hosts (VPS genérico
sin este compose, Fly, Railway, Render, k3s+Helm, Cloud Run, etc.) **NO SHALL** presentarse como soportados en este
change: una sola línea MAY indicar que no están soportados y que el camino canónico es compose+Traefik. NO SHALL
exigirse manifiestos Helm ni configs de esos hosts como entregable.

**La documentación operativa NO SHALL contradecir lo que el producto ya hace.** En particular, NO SHALL instruir a
nadie para que haga a mano lo que existe como operación del producto: hacerlo a mano es más lento, no es atómico y
deja fuera las partes de la cascada que quien escribe el procedimiento no recordó. Cuando exista una operación del
producto para un fin, el procedimiento manual SHALL presentarse como el camino excepcional —para cuando esa operación
no se pueda usar— y SHALL nombrar la operación que sustituye.

Que una afirmación de la documentación envejezca mal SHALL detectarse solo, pero la comprobación SHALL atarse a un
**registro declarado** de afirmaciones, no a la prosa entera del RUNBOOK. Analizar todo el texto para decidir si alguna
frase afirma que algo no existe no es implementable: exigirlo produciría una comprobación que finge una cobertura que
no tiene. El registro SHALL vivir en el repositorio y cada entrada SHALL asociar, como mínimo:

- un **patrón** que reconozca la afirmación en la documentación, y el archivo donde se busca;
- el **símbolo del código que la desmiente** —una ruta HTTP, un caso de uso o un test— cuya presencia hace falsa la
  afirmación.

La comprobación SHALL fallar cuando, para una entrada del registro, el patrón siga apareciendo en la documentación y el
símbolo exista en el código. El registro SHALL contener al menos la afirmación de que **el borrado de cuenta no
existe**, desmentida por la operación de borrado con cascada. Atarlo a un patrón registrado tiene un efecto buscado:
reescribir la frase con otras palabras **rompe** la entrada —el patrón deja de casar y hay que actualizarlo— en vez de
dejar que la comprobación siga en verde fingiendo que cubre lo que ya no cubre.

#### Scenario: README cubre el camino canónico

- **WHEN** un operador abre `infra/README.md`
- **THEN** SHALL encontrar el procedimiento del compose prod con Traefik y los placeholders de staging/prod
- **AND** NO SHALL interpretarse una lista larga de alternativas como soporte entregado de este change

#### Scenario: Alternativas sin código obligatorio

- **WHEN** se revisa el repositorio de este change
- **THEN** NO SHALL exigirse manifiestos Helm, configs Fly/Railway/Render ni Cloud Run como entregable
- **AND** la ausencia de esos archivos NO SHALL invalidar el compose prod documentado

#### Scenario: El borrado de cuenta ya no se manda hacer a mano

- **GIVEN** que el producto ofrece una operación de borrado de cuenta con su cascada
- **WHEN** un operador busca en la documentación cómo borrar todo lo de una persona
- **THEN** SHALL encontrar primero esa operación
- **AND** NO SHALL leer que el borrado de cuenta no existe
- **AND** el procedimiento manual SHALL quedar como camino excepcional, diciendo qué operación sustituye

#### Scenario: Afirmar que algo no existe se comprueba

- **GIVEN** una entrada del registro con el patrón de la afirmación "el borrado de cuenta no existe" y el símbolo que la
  desmiente
- **WHEN** el patrón aparece en la documentación y el símbolo existe en el código
- **THEN** una comprobación automatizada SHALL fallar nombrando la entrada, el archivo y el símbolo
- **AND** NO SHALL bastar con que alguien recuerde actualizar el texto

#### Scenario: El registro cubre lo declarado, ni más ni menos

- **WHEN** se revisa el alcance de la comprobación de afirmaciones
- **THEN** SHALL limitarse a las entradas del registro declarado
- **AND** NO SHALL exigirse analizar toda la prosa del RUNBOOK para decidir qué afirma
- **AND** el registro SHALL incluir la afirmación de que el borrado de cuenta no existe
