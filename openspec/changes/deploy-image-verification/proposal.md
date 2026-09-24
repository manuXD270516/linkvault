## Why

`cd-staging` acumula **21 ejecuciones y 21 fallos**. La más antigua es `862bc03`, que es el propio commit de
`deploy-prod` (#35): **el despliegue no ha funcionado nunca**, y las filas 17 a 33 del plan se han fusionado encima.

Hay dos defectos, y el segundo explica por qué el primero sobrevivió veintiuna corridas sin que nadie lo notara.

**El primero, técnico, reproducido localmente** (`pnpm nx build api --configuration=production` y después el mismo
install en `dist/apps/api`):

`docker/api.Dockerfile:23` y `docker/worker.Dockerfile:22` hacen, tras compilar, `pnpm install --prod
--frozen-lockfile` dentro de `dist/apps/<app>`. Nx genera ahí un `package.json`, un `pnpm-lock.yaml` y un
`pnpm-workspace.yaml` propios — así que el problema **no** es que falte un lockfile. Es más fino: Nx **copia el campo
`packageManager: pnpm@12.4.2`** al manifiesto generado, pero el lockfile que genera **no lleva la entrada
`packageManagerDependencies`** que ese campo exige en pnpm 12, donde pnpm se autogestiona como dependencia. pnpm
quiere escribir esa entrada, `--frozen-lockfile` se lo prohíbe, y aborta:

```
ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE
× resolve package manager dependencies
╰─▶ Cannot update packageManagerDependencies with "frozen-lockfile" because the lockfile is not up to date
```

Comprobado que esa es la causa y no otra: retirando `packageManager` del manifiesto generado, **el mismo install con
`--frozen-lockfile` intacto termina en 3,4 s**. No es una regresión ni un lockfile desactualizado por olvido de nadie:
**esa línea nunca pudo pasar**, y la reproducibilidad no es lo que estorba.

**El segundo, de diseño, y es el que importa.** El job de despliegue exige `STAGING_HOST`, `STAGING_SSH_USER`,
`STAGING_SSH_KEY` y `STAGING_COMPOSE_DIR`, y falla a propósito si faltan, porque ADR-033 D10 decidió que *"a dry-run is
NOT an accepted CD outcome"*. El repositorio **no tiene ningún secret de repositorio configurado** —los de *environment*
no los enumera `gh secret list`, así que se comprueban aparte durante la implementación—. Es decir: el pipeline era **rojo
por construcción**, el rojo era el estado esperado, y detrás de esa expectativa se escondió un defecto real de build
durante un mes.

La decisión de ADR-033 era correcta en su intención —no dar por desplegado lo que no se desplegó— pero produjo una
señal que **no podía ser verde nunca**, y una señal que no puede ser verde deja de ser una señal. Las specs lo
consagraron: el escenario "Merge a main verde despliega staging" de `platform/ci-pipeline` y el escenario de
"Imágenes multi-stage publicables" de `platform/production-deploy` describen cosas que **no han ocurrido ni una vez**,
y ambos se dieron por cumplidos.

## What Changes

- **La imagen se construye, y de forma reproducible.** Se arregla la instalación de dependencias de producción sin
  renunciar a la resolución bloqueada: el artefacto que se despliega no puede depender de lo que hubiera publicado en
  el registro el día que se construyó. Un arreglo que se limite a aflojar el candado (`--no-frozen-lockfile`) pondría
  el pipeline en verde **y dejaría el problema**, que es exactamente cómo llegamos hasta aquí.
- **El compose de producción tampoco podía arrancar**, y es un **segundo defecto nunca verificado** que el debate
  destapó: `docker-compose.prod.yml` no declara variables que sus procesos validan al arrancar —las de correo y los TTL
  de auth en `api`; `WEB_BASE_URL` y las de correo en `worker`—, y ambos terminan **antes de escuchar**. Arreglar la
  imagen no habría servido de nada. La correspondencia pasa a comprobarse contra los esquemas de configuración, no a
  ojo.
- **El artefacto se verifica en el propio CI, sin necesitar servidor, y se verifica entero.** Se levanta la pila de
  **`docker-compose.prod.yml`** —el mismo fichero que se despliega, no uno escrito para CI— con las imágenes recién
  construidas, y se comprueba que **`api`, `worker` y `web`** arrancan de verdad: readiness con mongo y redis las dos
  primeras, y el documento del SPA la tercera, que es lo único que una persona toca. Hasta hoy nada comprobaba que
  ninguna imagen arrancara: solo que el código compilaba.
- **El orden pasa a ser construir → verificar → publicar.** Hoy se publica antes de comprobar nada, así que una imagen
  rota sobrescribe el tag móvil y deja al despliegue anterior sin referencia a la que volver.
- **El estado del CD deja de mentir en las dos direcciones.** "No hay dónde desplegar" y "el despliegue falló" pasan a
  ser resultados distintos y distinguibles de un vistazo. Se mantiene íntegro el principio de ADR-033 —nunca se afirma
  que se desplegó algo que no se desplegó— pero deja de expresarse como un fallo permanente que entrena a todo el mundo
  a ignorar el pipeline.
- **Las dos specs dejan de prometer lo que no se ha verificado nunca**, y pasan a exigir lo que sí puede comprobarse
  hoy, sin infraestructura que no existe.
- **Dos mentiras operativas del mismo tejido**, encontradas en el barrido de diferidos que acompañó a esta revisión.
  Las dos son cosas que se dieron por hechas y nadie volvió a comprobar:
  - **El RUNBOOK afirma en ocho sitios que "hoy no existe el borrado de cuenta"** (`:468`, `:478`, `:558`, `:585`, `:709`, `:929`, `:952`, `:1008`) y
    manda borrar a mano, con `mongosh`, los datos de una persona. **Es falso desde `deploy-prod`**: existe
    `DELETE /api/users/me` con su cascada, probada en `account-deletion.cascade.spec.ts`. Un operador que siga el
    RUNBOOK haría a mano, sin transacción y a medias, lo que el producto ya hace entero. Es el defecto más caro del
    inventario.
  - **`.env.example:166` reparte un modelo muerto.** Fija `BYOK_OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free`
    mientras el propio RUNBOOK (`:1045`) documenta que ese modelo **ya no existe y responde `404`**. Quien copie el
    ejemplo y active BYOK arranca con el proveedor caído, el breaker abierto y una degradación silenciosa. Y vive en
    **seis sitios**, no en uno: el ejemplo, los dos servicios del compose de producción, el valor por defecto del propio
    código —el peor, porque es el que gana cuando la variable no se define—, su consumidor, y dos ficheros de test que
    lo fijan literal y que **romperán** al vaciarlo, lo cual es una señal y no un estorbo.

## Capabilities

### Modified Capabilities

- `platform/production-deploy`: "Imágenes multi-stage publicables" pasa a exigir que las imágenes de `api` y `worker`
  se construyan **de verdad**, con dependencias de producción resueltas de forma reproducible, y que **arranquen**.
- `platform/ci-pipeline`: "CD a staging en main" y "CD a producción por tag semver" separan **verificar el artefacto**
  —que ocurre siempre y puede estar en verde hoy— de **desplegarlo**, que necesita un destino configurado; y definen
  qué se informa cuando no lo hay, sin contarlo como éxito ni como avería.
- `platform/local-environment`: la configuración de ejemplo no puede repartir valores por defecto que **se sabe** que
  no funcionan, ni sustituirlos por otros que apaguen una protección.
- `ai/byok`: "sin modelo utilizable" pasa a significar **proveedor no disponible**, no proveedor sin política de datos.
  Sin esto, el arreglo del modelo muerto **apagaría** la protección que pretende preservar.

## Impact

- **`docker/api.Dockerfile` y `docker/worker.Dockerfile`**: la etapa de dependencias de producción.
- **`.github/workflows/cd-staging.yml` y `cd-prod.yml`**: verificación del artefacto en el runner y estado honesto
  cuando no hay destino. `cd-prod` **nunca se ha ejecutado** (cero ejecuciones), así que hereda el mismo arreglo sin
  ninguna evidencia previa de funcionar.
- **`docs/RUNBOOK.md`**: hoy no menciona `cd-staging` en ningún sitio, lo que contribuyó a que nadie lo mirara.
- **Riesgo que este change NO cierra**: sigue sin haber servidor de staging. El objetivo es que el pipeline diga la
  verdad sobre eso, no inventarse un destino.

### Fuera de alcance

Provisionar el servidor de staging o sus secrets —eso es la **fila 35**, que ningun otro change puede preceder
mientras el pipeline siga sin destino, para que "verde sin desplegar" no dure para siempre—, Traefik y DNS, publicar en registries de extensiones, y cualquier cambio funcional de la
aplicación. **`cd-prod` sí entra**: hereda el arreglo del artefacto y los tres resultados, sin ninguna evidencia previa
de funcionar.

Las decisiones no triviales quedan en **ADR-048**, que enmienda en parte ADR-033 D10.
