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

**La verificación del artefacto NO SHALL depender de que exista un servidor.** SHALL ejecutarse con las imágenes recién
construidas —levantándolas junto a sus dependencias en el propio corredor— y SHALL comprobar que `api` **arranca** y
responde readiness de Nest (`GET /health` con sus comprobaciones de mongo y redis), no que el código compile. Que el
build termine NO SHALL bastar para dar el artefacto por bueno.

El despliegue a staging, cuando hay destino, SHALL seguir el mecanismo cerrado: publicar imágenes en **GHCR**, luego
actualizar el target compose de staging (placeholders de host documentados) con **ssh + `docker compose pull` + `up`**
(o equivalente documentado con el mismo efecto), y ejecutar un smoke post-deploy de `GET /health` **contra el servicio
`api` en la red host/Docker** (no contra el origen HTTPS público de Traefik). El smoke SHALL exigir respuesta de
readiness de Nest, no HTML del SPA. Un job que solo realiza dry-run **NO SHALL** satisfacer la parte de despliegue de
este requirement, ni SHALL presentarse como tal.

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
- **THEN** SHALL levantarse `api` a partir de la imagen construida, con sus dependencias, dentro del propio corredor
- **AND** SHALL comprobarse que responde readiness con mongo y redis
- **AND** esta comprobación NO SHALL requerir ningún secreto de despliegue

#### Scenario: Una imagen que no arranca rompe el pipeline

- **GIVEN** una imagen que se construye pero cuyo proceso termina al ejecutarla
- **WHEN** corre la verificación del artefacto
- **THEN** el pipeline SHALL fallar señalando que la imagen no arranca
- **AND** NO SHALL publicarse como apta ni desplegarse

#### Scenario: Sin destino configurado el pipeline termina en verde sin desplegar

- **GIVEN** un merge a `main` con la verificación y el artefacto en verde, y **ningún** secreto de destino configurado
- **WHEN** termina el workflow
- **THEN** el workflow SHALL terminar en éxito
- **AND** SHALL informar de forma visible que no se desplegó por no haber destino
- **AND** NO SHALL afirmar en ningún punto que el despliegue se realizó
- **AND** la ausencia de destino NO SHALL registrarse como fallo

#### Scenario: Un destino a medias sí falla

- **GIVEN** un destino de staging configurado solo en parte, con secretos que faltan
- **WHEN** el pipeline llega a la etapa de despliegue
- **THEN** SHALL fallar nombrando lo que falta
- **AND** NO SHALL tratarse como "no hay destino", porque alguien quiso desplegar y no se hizo

### Requirement: CD a producción por tag semver

Al publicar un tag `v*` con forma semver (p. ej. `v1.2.3`), el pipeline SHALL ejecutar la verificación y, **solo si
pasa**, SHALL construir y **verificar el artefacto** con el mismo criterio que el CD de staging, y desplegar a
**producción** con el mecanismo cerrado (GHCR → compose pull+up del target prod → smoke `/health` interno contra `api`,
no Traefik público) **cuando haya destino configurado**. Un tag que no cumpla el patrón documentado NO SHALL desplegar
a prod. El fallo de verify NO SHALL desplegar a producción. Dry-run **NO SHALL** satisfacer la parte de despliegue.

Los tres resultados del CD de staging SHALL aplicarse igual aquí: un artefacto que no se construye o no arranca es un
fallo; sin destino configurado el pipeline termina en verde sin desplegar y diciéndolo. Este workflow **no se ha
ejecutado nunca**, así que hereda el arreglo del artefacto sin ninguna evidencia previa de funcionar y SHALL quedar
cubierto por la misma verificación.

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
- **THEN** SHALL comprobarse que `api` arranca y responde readiness, igual que en staging
- **AND** esa comprobación SHALL ocurrir antes de cualquier intento de despliegue
