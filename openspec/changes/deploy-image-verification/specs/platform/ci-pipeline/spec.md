## MODIFIED Requirements

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

**El orden SHALL ser: construir → verificar que arranca → publicar.** Una imagen que no ha superado la verificación
NO SHALL publicarse en el registro **con ningún tag**, tampoco con uno móvil como `:staging` o `:latest`. Publicar
antes de verificar contradice el propósito entero de este requirement y además es destructivo: un tag móvil que
sobrescribe al anterior convierte una imagen rota en la imagen que el siguiente `docker compose pull` se lleva, y
deja al despliegue anterior —que sí funcionaba— sin referencia a la que volver. Publicar SHALL ser consecuencia de
haber verificado, no un paso previo.

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
  exigen DNS y ACME. Los **valores de entorno de los servicios** SHALL venir del fichero de producción, sin sustituirlos
  por unos escritos para que la comprobación pase.
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

**El resultado SHALL ser legible desde la lista de ejecuciones, sin abrir el run.** No basta con escribirlo en el
resumen interno: dentro de tres meses nadie abre el run, ve el tick verde y concluye que hay algo desplegado. El estado
—desplegado, o verificado sin destino— SHALL aparecer en el **nombre de lo que se ve en la lista** (el nombre de la
ejecución o del check que la representa), de modo que una corrida que no desplegó se distinga de una que sí a simple
vista.

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
- **AND** los valores de entorno de los servicios SHALL ser los de ese fichero
- **AND** mongo SHALL levantarse como replica set, igual que en producción
- **AND** Traefik y los certificados SHALL quedar fuera del alcance

#### Scenario: Una variable obligatoria ausente en el compose se descubre aquí

- **GIVEN** un `docker-compose.prod.yml` al que le falta una variable que el proceso valida al arrancar
- **WHEN** corre la verificación del artefacto con ese mismo fichero
- **THEN** el servicio SHALL terminar sin llegar a escuchar y la verificación SHALL fallar
- **AND** NO SHALL enmascararse sustituyendo ese entorno por uno escrito para el corredor

#### Scenario: Una imagen que no arranca rompe el pipeline

- **GIVEN** una imagen que se construye pero cuyo proceso termina al ejecutarla
- **WHEN** corre la verificación del artefacto
- **THEN** el pipeline SHALL fallar señalando que la imagen no arranca
- **AND** NO SHALL publicarse como apta ni desplegarse

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

#### Scenario: Sin destino configurado el pipeline termina en verde sin desplegar

- **GIVEN** un merge a `main` con la verificación y el artefacto en verde, y **ningún** secreto de destino configurado
- **WHEN** termina el workflow
- **THEN** el workflow SHALL terminar en éxito
- **AND** SHALL informar de forma visible que no se desplegó por no haber destino
- **AND** NO SHALL afirmar en ningún punto que el despliegue se realizó
- **AND** la ausencia de destino NO SHALL registrarse como fallo

#### Scenario: El estado se lee desde la lista de ejecuciones

- **GIVEN** una corrida que verificó el artefacto y no desplegó por no haber destino
- **WHEN** alguien mira la lista de ejecuciones sin abrir ninguna
- **THEN** el nombre de lo que ve SHALL decir que no se desplegó
- **AND** NO SHALL distinguirse de una corrida que sí desplegó solo por el color del resultado
- **AND** NO SHALL bastar con dejarlo escrito en el resumen interno del run

#### Scenario: Un destino a medias sí falla

- **GIVEN** un destino de staging configurado solo en parte, con secretos que faltan
- **WHEN** el pipeline llega a la etapa de despliegue
- **THEN** SHALL fallar nombrando lo que falta
- **AND** NO SHALL tratarse como "no hay destino", porque alguien quiso desplegar y no se hizo

### Requirement: CD a producción por tag semver

Al publicar un tag `v*` con forma semver (p. ej. `v1.2.3`), el pipeline SHALL ejecutar la verificación y, **solo si
pasa**, SHALL construir y **verificar el artefacto** con el mismo criterio que el CD de staging —la pila de
`docker-compose.prod.yml` completa, levantada antes de publicar nada—, y desplegar a **producción** con el mecanismo
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

#### Scenario: Un release verifica todo el workspace

- **GIVEN** el tag `v1.0.0` apuntando a un commit que ya está en `main`
- **WHEN** corre la verificación del release
- **THEN** SHALL ejecutarse sobre todos los proyectos del workspace
- **AND** NO SHALL acotarse a los proyectos afectados respecto de `main`
- **AND** una verificación con el conjunto de proyectos vacío NO SHALL contarse como verde
