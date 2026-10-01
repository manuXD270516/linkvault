# platform/production-deploy Specification

## Purpose

Define el camino reproducible a producción: compose con Traefik y TLS, imágenes publicables, réplicas del worker, contrato
de variables de entorno y documentación del despliegue canónico (compose+Traefik) sin exigir hosts alternativos como
código del repositorio.

## Requirements

### Requirement: Compose de producción

El repositorio SHALL incluir un `docker-compose.prod.yml` (o nombre equivalente documentado) que declare los servicios
`api`, `worker` (al menos una réplica), `web`, MongoDB como replica set `rs0` de un nodo, Redis, un almacén de objetos
S3-compatible que cumpla `platform/object-store` y Traefik como proxy de entrada. El compose NO SHALL nombrar un
producto de almacén concreto como parte del contrato: la imagen del almacén es un valor por defecto sustituible por
variable.

El arranque documentado SHALL constar de **levantar la pila esperando a que esté sana y ejecutar la orden de
aprovisionamiento del almacén** («Aprovisionamiento idempotente y separado de la salud», `platform/object-store`), y
SHALL dejar esos servicios saludables según sus healthchecks y el almacén aprovisionado, sin pasos manuales fuera de las
variables de entorno, los secretos y esas órdenes documentadas.

**El healthcheck de cada servicio SHALL decidir por el contenido de la respuesta, no por su código de estado.** El de
`worker` hoy solo hace `JSON.parse` del cuerpo: acierta **por accidente**, porque el controlador devuelve `503` cuando
algún indicador está caído. El día que responda `200` describiendo un estado degradado —un cambio razonable, hecho en
otro fichero por alguien que no sabe que este depende de ese detalle—, `docker compose up --wait` daría **verde con el
worker degradado** y el despliegue se daría por bueno. Una garantía que se sostiene sobre una casualidad no es una
garantía. Por tanto:

- Cuando el servicio publique un estado y sus dependencias, el healthcheck SHALL exigir **estado global arriba y cada
  dependencia arriba**; para `api` y `worker`, al menos mongo y redis, con el mismo criterio en los dos.
- Cuando el servicio sirva contenido, como `web`, el healthcheck SHALL exigir que lo servido sea el documento esperado,
  no una respuesta cualquiera.
- Un healthcheck que necesite el código de estado para distinguir sano de degradado NO SHALL considerarse suficiente,
  aunque hoy funcione.
- El healthcheck del almacén SHALL ser de **solo lectura** («Healthcheck del almacén de solo lectura»,
  `platform/object-store`): contestar si está sano NO SHALL crear ni configurar nada.

#### Scenario: Stack prod completo

- **GIVEN** un host con Docker y las variables de producción definidas
- **WHEN** se ejecuta el arranque documentado en `infra/README.md`
- **THEN** SHALL quedar en ejecución `api`, al menos una réplica de `worker`, `web`, Mongo `rs0`, Redis, el object store
  y Traefik
- **AND** los healthchecks de `api` y `worker` SHALL reportar salud según `platform/runtime-health`
- **AND** el almacén SHALL quedar aprovisionado y su modo de comprobación SHALL terminar con código cero

#### Scenario: Réplicas del worker

- **GIVEN** la configuración de compose con `worker` a escala ≥ 1
- **WHEN** se levanta el stack de producción
- **THEN** SHALL existir al menos una réplica de `worker` consumiendo colas
- **AND** el compose SHALL permitir escalar `worker` sin tocar el resto de servicios

#### Scenario: La salud se decide por el contenido, no por el código de estado

- **GIVEN** un servicio cuyo endpoint de salud responde `200` con un cuerpo que declara una dependencia caída
- **WHEN** el healthcheck de ese servicio en el compose lo evalúa
- **THEN** SHALL considerarlo **no** saludable por lo que dice el cuerpo
- **AND** `docker compose up --wait` NO SHALL terminar en verde con ese servicio degradado
- **AND** el healthcheck de `worker` SHALL exigir mongo y redis arriba, igual que el de `api`, sin apoyarse en el código
  de estado

#### Scenario: Levantar la pila no aprovisiona el almacén

- **GIVEN** volúmenes vacíos y la pila levantada con espera de salud, sin ejecutar todavía la orden de aprovisionamiento
- **WHEN** se listan los buckets del almacén
- **THEN** NO SHALL existir ninguno creado por el healthcheck
- **AND** tras ejecutar la orden de aprovisionamiento SHALL existir los dos con su configuración

### Requirement: TLS Let's Encrypt vía Traefik

Traefik SHALL terminar TLS con certificados Let's Encrypt para los hosts públicos documentados del entorno. Los logs de
acceso de Traefik (o del proxy de entrada) NO SHALL registrar query strings de las rutas del SPA `/login`, `/registro` ni
`/unirse`, de modo que códigos de invitación u otros secretos en la URL NO SHALL quedar en disco.

#### Scenario: HTTPS público

- **GIVEN** DNS apuntando al host de producción y Let's Encrypt alcanzable
- **WHEN** un cliente abre el origen HTTPS documentado
- **THEN** Traefik SHALL servir un certificado válido de Let's Encrypt
- **AND** el tráfico hacia `api` y `web` SHALL llegar por el proxy de confianza

#### Scenario: Sin query strings de rutas sensibles del SPA

- **GIVEN** una petición a `/unirse?codigo=<secreto>` (o a `/login` / `/registro` con query)
- **WHEN** Traefik escribe el log de acceso de esa petición
- **THEN** la línea de log NO SHALL contener el query string
- **AND** el path `/unirse` (o `/login` / `/registro`) MAY aparecer sin parámetros

### Requirement: Enrutado Traefik de paths públicos

Traefik SHALL enrutar el tráfico de entrada así:

- paths bajo `/p/` → servicio `api` (páginas públicas de share);
- paths bajo `/api/` → servicio `api`;
- el resto de paths del origen público → servicio `web` (SPA).

Las rutas `/metrics` y `/health` / `/health/*` (o equivalentes de liveness/readiness) NO SHALL exponerse a Internet
público; SHALL quedar restringidas a la red interna de Docker o a una ACL Traefik equivalente (allowlist / no entrypoint
público).

#### Scenario: Share y API van a api

- **GIVEN** el stack prod con Traefik
- **WHEN** un cliente pide `GET /p/<slug>` o cualquier path bajo `/api/`
- **THEN** Traefik SHALL enrutar al servicio `api`

#### Scenario: SPA por defecto

- **GIVEN** el stack prod con Traefik
- **WHEN** un cliente pide `/login` o `/privacidad` (u otra ruta que no sea `/p/` ni `/api/`)
- **THEN** Traefik SHALL enrutar al servicio `web`

#### Scenario: Metrics y health no públicos

- **GIVEN** un cliente en Internet sin acceso a la red Docker
- **WHEN** intenta `GET /metrics` o `GET /health` en el origen público HTTPS
- **THEN** la petición NO SHALL alcanzar el scraper/orquestador como endpoint público documentado
- **AND** el acceso legítimo SHALL ser solo desde la red interna o ACL documentada

### Requirement: Rate limit y tope de cuerpo en POST /api/cv

En Traefik (borde), `POST /api/cv` SHALL tener **rate limit por IP** de **10 peticiones / 15 minutos** por IP y un
`clientMaxBodySize` (o equivalente) acotado al contrato de CV: **5 MiB** de archivo más overhead multipart, tope proxy
**6 MiB**. Una petición que exceda el tope SHALL rechazarse en el proxy sin exigir que `api` lea el cuerpo completo.

#### Scenario: Cuerpo demasiado grande en el borde

- **GIVEN** Traefik con el tope de cuerpo de CV configurado
- **WHEN** un cliente envía `POST /api/cv` con un cuerpo mayor al tope documentado
- **THEN** Traefik SHALL rechazar la petición (p. ej. 413)
- **AND** `api` NO SHALL verse obligada a bufferizar el exceso completo

#### Scenario: Rate limit por IP en subida de CV

- **GIVEN** Traefik con rate limit por IP en `POST /api/cv`
- **WHEN** la misma IP supera el umbral documentado en la ventana
- **THEN** las peticiones siguientes desde esa IP SHALL recibir `429` (o equivalente del proxy)
- **AND** otra IP NO SHALL compartir ese contador

### Requirement: Referrer-Policy en rutas del SPA

Las respuestas de las rutas del SPA servidas vía Traefik o `web` (en especial `/unirse`) SHALL incluir una cabecera
`Referrer-Policy` documentada (`no-referrer` o `strict-origin-when-cross-origin`) de modo que códigos de invitación en la
URL NO SHALL filtrarse a terceros vía Referer.

#### Scenario: Unirse no filtra el código por Referer

- **GIVEN** Ana abre `/unirse?codigo=<secreto>`
- **WHEN** el navegador sigue un enlace a un origen tercero desde esa página
- **THEN** la política de referrer documentada SHALL impedir que el query con el código viaje completo a ese tercero
  (según el valor de política elegido)

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

### Requirement: Outbox relay en exactamente una instancia de api

En producción, el relay del outbox SHALL estar habilitado (`OUTBOX_RELAY_ENABLED=true` o equivalente) en **exactamente
una** instancia de `api`. Las demás instancias de `api`, si las hubiera, SHALL arrancar con el relay apagado. El compose
y `infra/README.md` SHALL documentar cómo se garantiza esa unicidad.

#### Scenario: Una sola api con relay

- **GIVEN** el stack de producción arrancado según la documentación
- **WHEN** se revisa la configuración de las instancias de `api`
- **THEN** exactamente una SHALL tener el relay del outbox habilitado
- **AND** el resto, si existen, SHALL tenerlo deshabilitado

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

**Y ningún valor por defecto SHALL nombrar un recurso que el proyecto no controle.** El nombre de las imágenes
(`API_IMAGE`, `WORKER_IMAGE`, `WEB_IMAGE`) tiene hoy por defecto un espacio de nombres del registro que **no es del
proyecto**. Es un tercer defecto de la misma familia que los otros dos: **nunca se ha ejercitado**, porque los
workflows exportan siempre esas variables, así que el único que recorre ese camino es quien copia la configuración y
hace `pull` —y no obtiene nuestra imagen—. Peor: ese espacio de nombres está **libre**, de modo que quien lo registre
decide qué se ejecuta como producción en las máquinas que usen el valor por defecto. Por tanto, el nombre de cada
imagen SHALL resolver a un espacio de nombres que el proyecto controle, o SHALL declararse en la forma que aborta el
`up` nombrando la variable; NO SHALL quedar un valor por defecto que apunte a un espacio ajeno. La comprobación
automatizada de valores por defecto SHALL cubrir también este caso, porque un defecto que nadie ejercita solo se
descubre si algo lo mira a propósito.

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

#### Scenario: Las imágenes no apuntan por defecto a un espacio de nombres ajeno

- **GIVEN** el compose de producción sin ninguna de sus variables exportada, tal y como lo ejecuta quien copia la
  configuración
- **WHEN** se resuelven los nombres de las imágenes de `api`, `worker` y `web`
- **THEN** cada nombre SHALL resolver a un espacio de nombres del registro que el proyecto controle, o el `up` SHALL
  abortar nombrando la variable
- **AND** la comprobación automatizada de valores por defecto SHALL fallar si alguno resuelve a un espacio ajeno
- **AND** que los workflows exporten siempre esas variables NO SHALL bastar para dar el valor por defecto por bueno

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

### Requirement: Las imágenes de la pila se pueden descargar en la arquitectura del destino

Antes de descargar ninguna imagen para arrancar la pila, SHALL comprobarse que **cada imagen que resuelve el compose de
producción** —las de la aplicación y las de terceros— existe en su registro **para la plataforma del destino**. La
plataforma del destino SHALL ser la del daemon de Docker donde se va a arrancar, salvo que se declare explícitamente.

**Alcance y desde cuándo.** Este requirement SHALL aplicarse al despliegue a staging desde `staging-host` (35b) y al
despliegue a producción desde `verify-reusable-workflow` (35c); hasta entonces, esos despliegues no lo incumplen por no
llamar todavía al script. En la **verificación del artefacto** del CD, las imágenes propias recién construidas aún no
están en ningún registro: se comprueban **en el daemon** donde se cargaron, y las de terceros con el script.

El repositorio SHALL incluir un script que haga esa comparación, y su resultado SHALL distinguir tres desenlaces:

1. **todas presentes** → sigue el despliegue;
2. **alguna imagen no existe para esa plataforma** —el registro la ofrece solo para otras, su índice no la incluye, o
   el registro dice que esa etiqueta no existe— → falla nombrando la imagen, la plataforma pedida y las que sí existen. Es un **defecto del artefacto**: el
   repositorio eligió o publicó esa imagen, y NO SHALL comunicarse como avería del registro;
3. **no se pudo consultar el registro** (sin respuesta, nombre que no resuelve, credenciales rechazadas, límite de
   peticiones o cualquier error que no se sepa clasificar) → falla diciendo que no se pudo comprobar, sin atribuirlo a
   la imagen.

El script SHALL ejecutarse solo con Docker y sus plugins oficiales de Compose y Buildx, sin intérpretes ni utilidades
que el host de despliegue no necesite ya para desplegar.

#### Scenario: Todas las imágenes existen para el destino

- **GIVEN** un compose cuyas imágenes existen todas para `linux/arm64` y un destino `linux/arm64`
- **WHEN** se ejecuta la comprobación de plataformas
- **THEN** SHALL terminar con código cero listando cada imagen con la plataforma encontrada

#### Scenario: Una imagen de terceros sin la arquitectura del destino

- **GIVEN** un compose que referencia una imagen cuyo índice no incluye `linux/arm64`, y un destino `linux/arm64`
- **WHEN** se ejecuta la comprobación de plataformas
- **THEN** SHALL fallar antes de descargar nada, nombrando la imagen y las plataformas que sí ofrece
- **AND** el fallo SHALL identificarse como defecto del artefacto, no como avería del registro

#### Scenario: Una imagen de una sola plataforma distinta de la del destino

- **GIVEN** una imagen publicada con un único manifiesto `linux/amd64`, sin índice, y un destino `linux/arm64`
- **WHEN** se ejecuta la comprobación de plataformas
- **THEN** SHALL fallar igual que si faltara en un índice, sin dejar que la descarga la acepte con un aviso y el
  contenedor muera después con un error de formato

#### Scenario: El registro no responde

- **GIVEN** un registro que no responde o rechaza las credenciales
- **WHEN** se ejecuta la comprobación de plataformas
- **THEN** SHALL fallar diciendo que no se pudo comprobar
- **AND** NO SHALL afirmar que falta ninguna plataforma
