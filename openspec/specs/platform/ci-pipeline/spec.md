# platform/ci-pipeline Specification

## Purpose

Asegura que cada push y cada pull request verifique de forma automática el lint, los tipos, los tests y la coherencia
de las specs, de modo que ninguna de las reglas duras del proyecto dependa de que alguien se acuerde de correrlas.

## Requirements

### Requirement: Etapas de verificación

La integración continua SHALL ejecutarse en cada push a `main` y en cada pull request, y SHALL correr, en este orden:
lint, validación de las specs de OpenSpec, typecheck, tests, comprobación del catálogo de traducciones del SPA (solo cuando
`web` está afectado), evaluación de IA en replay (solo cuando `ai` está afectado) y build. El fallo de cualquier etapa SHALL
marcar la ejecución como fallida y NO SHALL ejecutar las etapas posteriores.

#### Scenario: Lint fallido detiene el pipeline

- **GIVEN** una rama con una violación de una regla de lint
- **WHEN** se ejecuta el pipeline
- **THEN** SHALL fallar en la etapa de lint
- **AND** NO SHALL ejecutar typecheck, tests ni build

#### Scenario: Spec inválida detiene el pipeline

- **GIVEN** un change cuya spec no cumple el formato de OpenSpec
- **WHEN** se ejecuta el pipeline
- **THEN** SHALL fallar en la validación de specs
- **AND** NO SHALL ejecutar typecheck, tests ni build

#### Scenario: Catálogo de traducciones atrasado detiene el pipeline

- **GIVEN** un pull request que añade un texto marcado para i18n en una plantilla de `apps/web` sin regenerar el catálogo
  fuente
- **WHEN** se ejecuta el pipeline
- **THEN** SHALL fallar en la comprobación del catálogo de traducciones
- **AND** NO SHALL ejecutar la evaluación de IA ni el build

#### Scenario: Cambio que no afecta a web

- **GIVEN** un cambio que solo modifica `apps/api`
- **WHEN** se ejecuta el pipeline
- **THEN** la comprobación del catálogo de traducciones NO SHALL ejecutarse

### Requirement: Herramientas con versión fijada

El pipeline SHALL obtener las versiones de Node, pnpm y del CLI de OpenSpec desde archivos versionados del repositorio,
y NO SHALL depender de herramientas instaladas globalmente en el runner.

#### Scenario: Runner limpio

- **WHEN** se ejecuta el pipeline en un runner recién aprovisionado
- **THEN** SHALL usar la versión de Node, pnpm y OpenSpec declarada en el repositorio

### Requirement: La IA fijada en mock durante los tests

La etapa de tests SHALL ejecutarse con `AI_CHAIN=mock` y `AI_MOCK_MODE=replay` definidos en el entorno del proceso de test,
aunque existan otras variables de IA en el entorno del runner.

#### Scenario: Variables de la cadena de IA

- **WHEN** un test lee el entorno durante la etapa de tests
- **THEN** `AI_CHAIN` SHALL valer `mock`
- **AND** `AI_MOCK_MODE` SHALL valer `replay`

### Requirement: Tests de integración sin servicios externos

Los tests que necesiten MongoDB SHALL levantar una instancia efímera en replica set de un nodo, de la misma versión mayor
que la infraestructura local, sin depender de servicios declarados en el runner.

#### Scenario: Transacción en el test de integración

- **GIVEN** un test que abre una transacción multi-documento
- **WHEN** se ejecuta en CI
- **THEN** SHALL pasar

#### Scenario: Runner sin servicios declarados

- **WHEN** se ejecuta el pipeline en un runner sin MongoDB ni Redis
- **THEN** la etapa de tests SHALL completarse

### Requirement: Verificación acotada por afectación

El pipeline SHALL limitar lint, typecheck, tests y build a los proyectos afectados respecto de la base del cambio. Un
cambio en la configuración compartida del workspace (`nx.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.nvmrc`,
`package.json` raíz o `pnpm-lock.yaml`) SHALL afectar a todos los proyectos.

#### Scenario: Cambio acotado a un proyecto

- **GIVEN** un cambio que solo modifica archivos de `apps/web`
- **WHEN** se calculan los proyectos afectados
- **THEN** la lista SHALL incluir `web`
- **AND** NO SHALL incluir `api` ni `worker`

#### Scenario: Cambio en configuración compartida

- **GIVEN** un cambio que modifica `eslint.config.mjs`
- **WHEN** se calculan los proyectos afectados
- **THEN** la lista SHALL incluir todos los proyectos

### Requirement: Evaluación de IA en replay

Cuando el proyecto `ai` está afectado, el pipeline SHALL ejecutar, después de los tests, la evaluación en replay de todas las
tareas evaluables comparada con sus líneas base, con el entorno de IA fijado en mock y sin contactar a ningún proveedor real, y
SHALL fallar si alguna evaluación termina con error.

#### Scenario: Pipeline sin regresión

- **GIVEN** un cambio que afecta a `ai` sin alterar resultados de replay
- **WHEN** se ejecuta el pipeline
- **THEN** la etapa de evaluación SHALL pasar

#### Scenario: Pipeline con regresión

- **GIVEN** un cambio que modifica `skills_recall` en replay respecto a la línea base
- **WHEN** se ejecuta el pipeline
- **THEN** la etapa de evaluación SHALL fallar nombrando la métrica

#### Scenario: Cambio que no afecta a ai

- **GIVEN** un cambio que solo modifica `apps/web`
- **WHEN** se ejecuta el pipeline
- **THEN** la etapa de evaluación NO SHALL ejecutarse

### Requirement: CD a staging en main

Tras un push o merge a `main`, el pipeline SHALL ejecutar la verificación existente (lint, specs, typecheck, tests, eval
cuando aplique, build) y, **solo si esa verificación pasa**, SHALL construir el artefacto, **verificarlo** y, cuando
haya un destino configurado, desplegarlo a **staging**. El fallo de cualquier etapa de verificación NO SHALL disparar
nada de lo que viene después.

El pipeline SHALL distinguir **tres** resultados, porque confundirlos es lo que hizo que un defecto real de build
sobreviviera veintiuna corridas escondido detrás de un rojo que todo el mundo daba por normal:

1. **El artefacto no se pudo construir o no arranca** → fallo. Es un defecto del repositorio y SHALL romper el
   pipeline, exista o no un destino de despliegue.
2. **El artefacto está verificado y hay destino** → se despliega y se comprueba con el smoke.
3. **El artefacto está verificado y NO hay destino configurado** → el pipeline SHALL terminar **en verde**,
   informando de forma visible que **no se desplegó** y por qué. NO SHALL afirmar que se desplegó, NO SHALL contarse
   como despliegue, y NO SHALL fallar por ello.

Y SHALL distinguir un **cuarto desenlace**, que no es un cuarto color sino una causa distinta bajo el mismo rojo:

4. **La verificación no se pudo llevar a cabo** porque una avería ajena lo impidió → SHALL seguir siendo **fallo**,
   porque nadie ha comprobado el artefacto y eso NO SHALL caer del lado verde; pero la señal NO SHALL atribuirlo al
   artefacto. Decir «el artefacto no arrancó» cuando el artefacto no llegó a levantarse manda a depurar el sitio
   equivocado, y lo desmiente la propia ejecución que lo publica.

**Cuando la causa no conste, NO SHALL nombrarse ninguna.** Una causa ausente NO SHALL tratarse como la causa habitual:
el pipeline SHALL decir que la verificación no pasó y callar el porqué. Confundir "no se sabe" con "lo de siempre" es
el mismo defecto que los cuatro desenlaces existen para cerrar, reconstruido por el mecanismo que lo cierra.

Y el mecanismo que lleva la causa desde la verificación hasta donde se publica el resultado SHALL **sobrevivir al
fallo** de la etapa que la produce —es el único caso en que hace falta—. Un mecanismo del que no se haya demostrado
eso NO SHALL darse por bueno por parecer correcto: su modo de error es silencioso, porque la causa llegaría vacía
siempre y el resultado seguiría publicándose sin que nada avise de que dejó de informar.

**El orden SHALL ser: construir → verificar que arranca → publicar.** Una imagen que no ha superado la verificación
NO SHALL publicarse en el registro **con ningún tag**, tampoco con uno móvil como `:staging` o `:latest`. Publicar
antes de verificar contradice el propósito entero de este requirement y además es destructivo: un tag móvil que
sobrescribe al anterior convierte una imagen rota en la imagen que el siguiente `docker compose pull` se lleva, y
deja al despliegue anterior —que sí funcionaba— sin referencia a la que volver. Publicar SHALL ser consecuencia de
haber verificado, no un paso previo.

**Y lo publicado SHALL ser exactamente lo verificado, comprobado por identidad del artefacto.** El orden no basta: la
imagen que se levanta para verificarla vive en el entorno donde se verificó, así que una publicación que no reutilice
ese mismo artefacto lo **reconstruiría** y subiría al registro bits que nadie ha comprobado —se cumpliría el orden y se
incumpliría el propósito, que es el peor resultado posible: una garantía que se ve satisfecha y no lo está—. Por tanto,
para cada imagen publicada, el **digest** SHALL ser el mismo que el del artefacto que superó la verificación, y esa
coincidencia SHALL comprobarse **en la propia corrida**. Si algún digest publicado no es el verificado, el pipeline
SHALL fallar y NO SHALL contarse ese despliegue como realizado. Es una propiedad observable del artefacto, no de la
secuencia de pasos: cómo se consiga —reutilizando el artefacto, transfiriéndolo o publicándolo desde donde se
verificó— queda abierto, mientras la identidad se demuestre.

**La verificación del artefacto NO SHALL depender de que exista un servidor.** SHALL ejecutarse con las imágenes recién
construidas, levantándolas en el propio corredor, y SHALL comprobar que los procesos **arrancan** y responden, no que el
código compile. Que el build termine NO SHALL bastar para dar el artefacto por bueno.

**Lo que se verifica SHALL ser la pila de producción completa, con la configuración de producción real:**

- El alcance SHALL cubrir `api`, `worker`, `web` y sus dependencias (mongo, redis y el almacén de objetos), no solo
  `api`. `web` es lo único que toca una persona y hoy se publica sin que nada compruebe que sirve algo.
- SHALL usarse **`docker-compose.prod.yml`**, el mismo fichero que se despliega, y NO SHALL escribirse un compose
  paralelo para el corredor. Un compose escrito para CI verificaría una configuración que nadie ejecuta, y es
  exactamente donde vivía el defecto de las variables obligatorias que faltan: la comprobación habría pasado en verde
  mientras producción no arrancaba.
- Lo único que MAY diferir del despliegue real es apuntar las imágenes a las recién construidas y dejar fuera el borde:
  Traefik, los certificados y la publicación de puertos al exterior NO SHALL formar parte de la verificación, porque
  exigen DNS y ACME.
- Lo que SHALL venir del fichero de producción es el **mapa de servicio a variable**: qué variables recibe cada
  servicio, y con qué forma de sustitución. Ahí es donde vivía el defecto —al servicio le faltaba una variable
  obligatoria— y por eso NO SHALL añadirse ni retirarse ninguna variable de ningún servicio para que la comprobación
  pase. Los **valores** MAY ser de relleno, escogidos para el corredor (host público, credenciales del almacén,
  destinatarios de correo), porque en el corredor no hay DNS ni cuentas reales: sustituir un valor no oculta nada;
  sustituir el conjunto de variables oculta exactamente el defecto que esta verificación busca.
- Mongo SHALL levantarse como **replica set**, igual que en producción: con instancia suelta, cualquier transacción
  multi-documento fallaría solo en el despliegue real, que es el sitio más caro para enterarse.

Las comprobaciones por servicio SHALL ser, como mínimo: `api` respondiendo readiness de Nest (`GET /health` con sus
comprobaciones de mongo y redis); `worker` respondiendo readiness en **su propio `GET /health`** —lo expone, con los
mismos indicadores de mongo y redis, en su puerto de salud—; y `web` sirviendo el documento del SPA.

El despliegue a staging, cuando hay destino, SHALL seguir el mecanismo cerrado: publicar imágenes en **GHCR**, luego
actualizar el target compose de staging (placeholders de host documentados) con **ssh + `docker compose pull` + `up`**
(o equivalente documentado con el mismo efecto), y ejecutar un smoke post-deploy de `GET /health` **contra el servicio
`api` en la red host/Docker** (no contra el origen HTTPS público de Traefik). El smoke SHALL exigir respuesta de
readiness de Nest, no HTML del SPA. Un job que solo realiza dry-run **NO SHALL** satisfacer la parte de despliegue de
este requirement, ni SHALL presentarse como tal.

**El resultado SHALL ser legible sin abrir la ejecución.** No basta con escribirlo en el resumen interno: dentro de tres
meses nadie abre el run, ve el tick verde y concluye que hay algo desplegado. El estado —desplegado, o verificado sin
destino— SHALL aparecer en el **nombre de algo que se ve desde fuera**, en **al menos una superficie que alguien mire de
forma habitual** —la lista de checks de un commit o de una pull request—, de modo que una corrida que no desplegó se
distinga de una que sí a simple vista y no solo por el color del resultado.

**Y la spec SHALL nombrar el límite en vez de dejarlo ambiguo.** La superficie donde se acumularon las veintiuna
corridas rojas es la **lista de ejecuciones del workflow**, y esa lista muestra el nombre de la ejecución, que se fija
al iniciarla: no puede depender de un resultado que todavía no existe. Por tanto esta spec NO SHALL exigir que el
estado aparezca ahí, porque sería prometer lo que la herramienta no permite y volvería el requirement incumplible o,
peor, cumplido de mentira. Lo exigible es la superficie que sí puede llevarlo; quien mire solo la lista de ejecuciones
SHALL seguir necesitando abrir la corrida, y eso queda dicho aquí en lugar de darse por resuelto.

#### Scenario: Merge a main verde despliega staging

- **GIVEN** un merge a `main` cuya verificación completa termina con éxito y un destino de staging configurado
- **WHEN** termina el workflow de CI/CD
- **THEN** SHALL haberse publicado imagen(es) en GHCR y actualizado el compose de staging
- **AND** el smoke post-deploy de `/health` SHALL haber corrido contra `api` en red interna/Docker
- **AND** el smoke NO SHALL haberse limitado a curl del entrypoint público Traefik
- **AND** el despliegue NO SHALL haberse iniciado antes de que verify terminara en éxito

#### Scenario: Verify fallido no despliega staging

- **GIVEN** un push a `main` cuya etapa de tests falla
- **WHEN** termina el workflow
- **THEN** NO SHALL desplegarse a staging
- **AND** NO SHALL contarse un dry-run como despliegue exitoso

#### Scenario: El artefacto se verifica sin servidor

- **GIVEN** un merge a `main` con la verificación en verde
- **WHEN** se construyen las imágenes
- **THEN** SHALL levantarse la pila de `docker-compose.prod.yml` con esas imágenes dentro del propio corredor
- **AND** SHALL comprobarse que `api` responde readiness con mongo y redis
- **AND** esta comprobación NO SHALL requerir ningún secreto de despliegue

#### Scenario: Se verifica la pila entera, no solo api

- **GIVEN** las tres imágenes recién construidas
- **WHEN** corre la verificación del artefacto
- **THEN** `worker` SHALL responder readiness en su propio `GET /health` con mongo y redis
- **AND** `web` SHALL servir el documento del SPA
- **AND** que `api` esté en verde NO SHALL bastar para dar el artefacto por verificado

#### Scenario: La verificación usa el compose de producción

- **GIVEN** el corredor con las imágenes construidas
- **WHEN** se levanta la pila para verificarla
- **THEN** SHALL usarse `docker-compose.prod.yml`, no un compose escrito aparte para CI
- **AND** cada servicio SHALL recibir exactamente las variables que ese fichero le declara, sin añadir ni quitar ninguna
- **AND** los valores de esas variables MAY ser de relleno para el corredor
- **AND** mongo SHALL levantarse como replica set, igual que en producción
- **AND** Traefik y los certificados SHALL quedar fuera del alcance

#### Scenario: Una variable obligatoria ausente en el compose se descubre aquí

- **GIVEN** un `docker-compose.prod.yml` al que le falta una variable que el proceso valida al arrancar
- **WHEN** corre la verificación del artefacto con ese mismo fichero
- **THEN** el servicio SHALL terminar sin llegar a escuchar y la verificación SHALL fallar
- **AND** NO SHALL enmascararse declarando esa variable fuera del compose ni cambiando qué variables recibe el servicio
- **AND** dar valores de relleno a las variables que el compose sí declara NO SHALL considerarse enmascaramiento

#### Scenario: Una imagen que no arranca rompe el pipeline

- **GIVEN** una imagen que se construye pero cuyo proceso termina al ejecutarla
- **WHEN** corre la verificación del artefacto
- **THEN** el pipeline SHALL fallar señalando que la imagen no arranca
- **AND** NO SHALL publicarse como apta ni desplegarse

#### Scenario: Una avería ajena no se comunica como artefacto roto

- **GIVEN** una corrida en la que la verificación no llega a levantar el artefacto porque una dependencia ajena al
  repositorio no responde (p. ej. el registro del que se descargan las imágenes de las dependencias)
- **WHEN** se publica el resultado del CD
- **THEN** el resultado SHALL ser **fallo**, porque nadie ha comprobado el artefacto
- **AND** lo publicado SHALL decir que **no se pudo verificar** y nombrar la avería ajena
- **AND** NO SHALL afirmar que el artefacto no se construyó o no arrancó
- **AND** el transporte de esa causa SHALL sobrevivir al fallo de la etapa que la produce

#### Scenario: Sin causa conocida no se inventa una

- **GIVEN** una corrida cuya verificación falla y cuya causa no llega al punto donde se publica el resultado
- **WHEN** se publica el resultado del CD
- **THEN** el resultado SHALL ser **fallo** y SHALL decir que la verificación no pasó
- **AND** NO SHALL atribuirse a ninguna causa concreta
- **AND** la ausencia de causa NO SHALL tratarse como la causa habitual

#### Scenario: Nada se publica antes de verificarse

- **GIVEN** un merge a `main` con las imágenes construidas y la verificación todavía sin ejecutar
- **WHEN** se observa el registro de imágenes
- **THEN** NO SHALL haberse publicado ninguna imagen, con ningún tag
- **AND** la publicación SHALL ocurrir solo después de que la verificación termine en éxito

#### Scenario: Una imagen no verificada no sobrescribe un tag móvil

- **GIVEN** una imagen que falla la verificación y un tag móvil (p. ej. `:staging`) que hoy apunta a una imagen buena
- **WHEN** termina el pipeline
- **THEN** ese tag SHALL seguir apuntando a la imagen anterior
- **AND** la imagen fallida NO SHALL quedar publicada bajo ningún otro tag

#### Scenario: Se publica exactamente el artefacto verificado

- **GIVEN** unas imágenes que acaban de superar la verificación de arranque en el corredor
- **WHEN** esas imágenes se publican en el registro
- **THEN** el digest de cada imagen publicada SHALL ser el mismo que el de la imagen verificada
- **AND** la coincidencia SHALL comprobarse en la propia corrida, no deducirse de que la publicación ocurriera después

#### Scenario: Publicar algo reconstruido rompe el pipeline

- **GIVEN** una publicación que no reutiliza el artefacto verificado y produce bits distintos de los que se levantaron
- **WHEN** se comparan los digests de lo publicado y de lo verificado
- **THEN** el pipeline SHALL fallar señalando que lo publicado no es lo que se verificó
- **AND** NO SHALL darse por cumplido el requirement por haberse respetado el orden construir → verificar → publicar

#### Scenario: Sin destino configurado el pipeline termina en verde sin desplegar

- **GIVEN** un merge a `main` con la verificación y el artefacto en verde, y **ningún** secreto de destino configurado
- **WHEN** termina el workflow
- **THEN** el workflow SHALL terminar en éxito
- **AND** SHALL informar de forma visible que no se desplegó por no haber destino
- **AND** NO SHALL afirmar en ningún punto que el despliegue se realizó
- **AND** la ausencia de destino NO SHALL registrarse como fallo

#### Scenario: El estado se lee sin abrir la ejecución

- **GIVEN** una corrida que verificó el artefacto y no desplegó por no haber destino
- **WHEN** alguien mira la lista de checks del commit o de la pull request, sin abrir la corrida
- **THEN** el nombre de lo que ve SHALL decir que no se desplegó
- **AND** NO SHALL distinguirse de una corrida que sí desplegó solo por el color del resultado
- **AND** NO SHALL bastar con dejarlo escrito en el resumen interno del run

#### Scenario: El límite de la señal queda escrito

- **GIVEN** la lista de ejecuciones del workflow, cuyo nombre se fija al iniciar la corrida y no puede llevar el estado
- **WHEN** se evalúa el cumplimiento de la señal
- **THEN** la spec SHALL decir que esa superficie no lo lleva y cuál sí
- **AND** NO SHALL exigirse que el estado aparezca en una superficie que la herramienta no permite

#### Scenario: Un destino a medias sí falla

- **GIVEN** un destino de staging configurado solo en parte, con secretos que faltan
- **WHEN** el pipeline llega a la etapa de despliegue
- **THEN** SHALL fallar nombrando lo que falta
- **AND** NO SHALL tratarse como "no hay destino", porque alguien quiso desplegar y no se hizo

### Requirement: CD a producción por tag semver

Al publicar un tag `v*` con forma semver (p. ej. `v1.2.3`), el pipeline SHALL ejecutar la verificación y, **solo si
pasa**, SHALL construir y **verificar el artefacto** con el mismo criterio que el CD de staging —la pila de
`docker-compose.prod.yml` completa, levantada antes de publicar nada, y el digest de lo publicado idéntico al de lo
verificado—, y desplegar a **producción** con el mecanismo
cerrado (GHCR → compose pull+up del target prod → smoke `/health` interno contra `api`, no Traefik público) **cuando
haya destino configurado**. Un tag que no cumpla el patrón documentado NO SHALL desplegar a prod. El fallo de verify
NO SHALL desplegar a producción. Dry-run **NO SHALL** satisfacer la parte de despliegue.

Los tres resultados del CD de staging SHALL aplicarse igual aquí: un artefacto que no se construye o no arranca es un
fallo; sin destino configurado el pipeline termina en verde sin desplegar y diciéndolo. Este workflow **no se ha
ejecutado nunca**, así que hereda el arreglo del artefacto sin ninguna evidencia previa de funcionar y SHALL quedar
cubierto por la misma verificación.

**La verificación de un release SHALL cubrir todo el workspace, no el delta respecto de `main`.** Un tag apunta casi
siempre a un commit que ya está en `main`: base y cabeza coinciden, el conjunto de proyectos afectados sale **vacío**, y
el pipeline daría "verify verde" **sin haber ejecutado nada** justo antes de desplegar a producción. Es el peor sitio
donde puede darse una señal vacía. Para el evento de tag, esta regla SHALL prevalecer sobre el acotado por afectación,
que existe para abaratar los pushes y las pull requests, no para abaratar un release.

#### Scenario: Tag v* verde despliega prod

- **GIVEN** el tag `v1.0.0` publicado, la verificación en verde y un destino de producción configurado
- **WHEN** termina el workflow de release
- **THEN** SHALL haberse desplegado a producción vía GHCR + compose del target prod
- **AND** el smoke de `/health` SHALL haber corrido contra `api` en red interna/Docker

#### Scenario: Verify fallido no despliega prod

- **GIVEN** el tag `v1.0.1` y una etapa de verify fallida
- **WHEN** termina el workflow
- **THEN** NO SHALL desplegarse a producción

#### Scenario: Push a main no despliega prod

- **GIVEN** un merge a `main` en verde
- **WHEN** termina el CD de staging
- **THEN** NO SHALL haberse desplegado a producción por ese solo evento
- **AND** el despliegue a prod SHALL quedar reservado al tag `v*`

#### Scenario: El artefacto de producción se verifica igual

- **GIVEN** el tag `v1.0.0` con la verificación en verde
- **WHEN** se construyen las imágenes de release
- **THEN** SHALL levantarse la pila de `docker-compose.prod.yml` y comprobarse `api`, `worker` y `web`, igual que en
  staging
- **AND** esa comprobación SHALL ocurrir antes de publicar ninguna imagen y antes de cualquier intento de despliegue
- **AND** el digest de cada imagen publicada SHALL ser el de la imagen verificada, comprobado en la corrida

#### Scenario: Un release verifica todo el workspace

- **GIVEN** el tag `v1.0.0` apuntando a un commit que ya está en `main`
- **WHEN** corre la verificación del release
- **THEN** SHALL ejecutarse sobre todos los proyectos del workspace
- **AND** NO SHALL acotarse a los proyectos afectados respecto de `main`
- **AND** una verificación con el conjunto de proyectos vacío NO SHALL contarse como verde

### Requirement: El CD verifica con las mismas etapas que la integración continua

La verificación previa a cualquier despliegue (el CD a staging y el CD a producción) SHALL ejecutar todas las etapas de
«Etapas de verificación», en su orden, incluida la comprobación del catálogo de traducciones del SPA, de modo que ningún
despliegue se salte una etapa que la integración continua sí exige. Donde otro requirement de esta spec enumere las etapas
de esa verificación, esta regla SHALL prevalecer sobre la enumeración. El CD a staging SHALL acotar las etapas por
afectación igual que la integración continua. El CD a producción SHALL ejecutarlas sobre todo el workspace, conforme a
«CD a producción por tag semver».

#### Scenario: Catálogo de traducciones atrasado no despliega staging

- **GIVEN** un push a `main` que afecta a `web` con el catálogo fuente atrasado respecto a las fuentes
- **WHEN** termina el workflow de CD a staging
- **THEN** su verificación SHALL fallar en la comprobación del catálogo de traducciones
- **AND** NO SHALL construirse, publicarse ni desplegarse el artefacto

#### Scenario: Catálogo de traducciones atrasado no despliega producción

- **GIVEN** un tag `v*` cuyo commit tiene el catálogo fuente atrasado respecto a las fuentes, aunque ese commit no toque
  `apps/web`
- **WHEN** termina el workflow de CD a producción
- **THEN** su verificación SHALL fallar en la comprobación del catálogo de traducciones
- **AND** NO SHALL desplegarse a producción
