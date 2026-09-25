## Why

`cd-staging` acumula **21 ejecuciones y 21 fallos**. La más antigua es `862bc03`, que es el propio commit de
`deploy-prod` (#35): **el despliegue no ha funcionado nunca**, y las filas 17 a 33 del plan se han fusionado encima.

Hay dos defectos, y el segundo explica por qué el primero sobrevivió veintiuna corridas sin que nadie lo notara.

**El primero, técnico, reproducido localmente** (`pnpm nx build api --configuration=production` y después el mismo
install en `dist/apps/api`):

`docker/api.Dockerfile` y `docker/worker.Dockerfile` hacen, tras compilar, `pnpm install --prod
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
- `ai/usage-accounting`, `ai/task-execution`, `cv/match` y `web/byok`: las cuatro definen "BYOK elegible" como
  *consentimiento + clave + capacidades*, sin contar si ese vendor puede construirse. Suman la condición que faltaba.
  **Entraron por decisión humana al cerrar el debate**, y por un motivo concreto: sin ellas, alguien cuya única clave
  fuera un vendor no construible contaría como elegible, la cadena restringida quedaría **vacía** y saldría un fallo de
  cadena vacía en lugar del `quota_exceeded` honesto — y en la pantalla se leería "no forzamos `data_collection: deny`"
  cuando la verdad es "este vendor no está disponible". `openspec validate` **no** las detecta: son contradicciones
  entre capacidades distintas.
- `ai/data-protection`: "Secretos BYOK fuera de logs y respuestas" limita las respuestas de gestión de claves a
  `vendor`, `keyHint` y timestamps. El dato nuevo entra en ese conjunto cerrado, así que la capacidad **se amplía
  nombrándolo** en vez de que el campo aparezca fuera de lo declarado: `available` es un booleano pelado —ni el modelo,
  ni la variable que falta, ni el motivo—, porque decir *por qué* un vendor no está disponible revelaría la
  configuración del servidor por el camino que abrimos para no revelarla. Son **nueve** deltas en total, no ocho: esta
  se quedó fuera de la primera enumeración.

## Impact

El change nació tocando solo infraestructura y, al cerrar el debate, **se decidió (A1) llevarlo hasta la pantalla** para
no fusionar ninguna contradicción conocida. El impacto queda enumerado por componente, no descrito en prosa.

### Imagen y despliegue

| Componente | Qué cambia |
|---|---|
| `docker/api.Dockerfile`, `docker/worker.Dockerfile` | La etapa de dependencias de producción: se retira del manifiesto generado el campo que impide instalar con el bloqueo puesto |
| `docker-compose.prod.yml` | Variables obligatorias que faltan en `api` y `worker`; `healthcheck` de `worker` y `web` decidiendo por **contenido**; nombres de imagen sin valor por defecto hacia un espacio ajeno |
| `.github/workflows/cd-staging.yml` | Construir → verificar → publicar en un solo job, identidad por digest, preflight con tres resultados, job de reporte y estado de commit |
| `.github/workflows/cd-prod.yml` | Lo mismo, más verificación de **todo** el workspace y guardia de semver. **Nunca se ha ejecutado** |
| `.github/workflows/ci.yml` | Paso incondicional de comprobaciones de repositorio |
| `tools/repo-checks` (nuevo) | Las comprobaciones que hacen que la documentación no pueda volver a mentir |
| `nx.json` | `.env.example` y el compose de producción en entradas globales. **`docs/**` no**, a propósito |
| `infra/ci/verify.env` (nuevo) | Relleno para la verificación, con cabecera de que no sirve para ningún despliegue |
| `docker-compose.yml` | El compose **de desarrollo** también cambia, y no por simetría: la imagen de MinIO estaba fijada a fuego en los **dos** ficheros, así que cuando `quay.io` pasó a devolver `401` ni siquiera el entorno del README podía levantarse desde cero (ADR-048 §8) |
| Espejo de la imagen de MinIO | Se replica el **mismo objeto** a `ghcr.io/manuxd270516/linkvault-minio` y los dos composes lo referencian por `MINIO_IMAGE`/`MINIO_IMAGE_TAG`, con el espejo por defecto y no otra URL clavada. Precios aceptados: mantenerlo es trabajo nuestro y lo replicado es **solo `linux/amd64`**; sustituir MinIO y mantener el espejo quedan registrados en la fila 35 |

### Elegibilidad BYOK (entra por A1 — ADR-049)

| Componente | Qué cambia |
|---|---|
| `libs/shared/src/schemas/ai-byok.schema.ts` | La vista de una clave suma la **disponibilidad** de ese vendor |
| `libs/ai` — `byok-provider.factory.ts` | Sin modelo utilizable **no construye** el proveedor, en vez de construirlo con la política en `omit` |
| `libs/ai` — `ai-config.schema.ts`, `parse-ai-config.ts`, `default-byok-config.ts` | El valor por defecto pasa al modelo verificado; canal de **avisos** de configuración, que hoy solo sabe abortar |
| `libs/ai` — predicado de disponibilidad | **Exportado y consumido**, no reimplementado en la API: dos implementaciones del mismo criterio son dos verdades que divergen |
| `apps/api` — `list-my-ai-keys.usecase.ts`, `ai-keys.controller.ts` | Pueblan el campo nuevo |
| `apps/web` — `ai-keys.api.ts`, `ai-keys.store.ts`, `profile.page.html` | El aviso deja de estar cableado (hoy dice literalmente "MVP: siempre") y pasa a **dos avisos distintos** que no pueden confundirse |
| `apps/web/src/locale/messages*.xlf` | Textos ES y EN con **identificador nuevo** para lo que cambie de contenido |
| Tests | Unitarios del predicado, del caso de uso y del componente; `byok.spec.ts` de e2e con el vendor indisponible |

### Documentación

| Componente | Qué cambia |
|---|---|
| `docs/RUNBOOK.md` | Deja de afirmar en **ocho** sitios que no existe el borrado de cuenta; documenta `cd-staging` (hoy no lo menciona); separa el breaker de plataforma del BYOK inenrutable |
| `infra/README.md` | Deja de describir la regla vieja ("sin secretos el deploy falla") y documenta el arranque |
| `.env.example` | Modelo verificado en vez del muerto |
| `apps/api/**` (comentarios) | Tres sitios que repiten que el borrado de cuenta no existe |
| ADR | **ADR-048** (nuevo), **ADR-049** (nuevo), nota de enmienda en **ADR-033 D10** |

### Lo que este change NO cierra

Escrito aquí, con **dónde se retoma cada cosa**, en vez de quedar suelto en las notas de implementación de `tasks.md`.
Todo lo de esta lista está además registrado en la **fila 35** (`staging-host`), en `docs/design-v0.2.md` §6 y en
`openspec-changes.yaml`.

1. **Sigue sin haber servidor de staging.** El objetivo es que el pipeline diga la verdad sobre eso, no inventarse un
   destino. Es la fila 35, y ningún otro change puede precederla mientras el pipeline termine en "verificado sin
   destino" (ADR-048 §Consecuencias). → **fila 35**.
2. **El healthcheck de MinIO sigue aprovisionando buckets** (4.15). Aquí solo se le quita el `grep` que la imagen no
   trae y se hacen distinguibles sus tres desenlaces; separar "¿está configurado?" de "¿está sano?" pide un despliegue
   real contra el que probar el paso de aprovisionamiento. → **fila 35**.
3. **Las dos tareas de endurecer el paso de secretos por ssh** —sacar `STAGING_COMPOSE_DIR`/`PROD_COMPOSE_DIR` y
   `GHCR_READ_TOKEN` del `script:` de `appleboy/ssh-action` a `envs:`—. Aquí solo podrían cerrarse leyendo YAML, porque
   el job de despliegue queda **saltado** por no haber destino. → **fila 35**.
4. **Las dos tareas del workflow reutilizable de `verify`** —extraerlo con input de modo (`affected` / `all`) y llevar
   allí el step `Check prompt assets`—. Es un refactor que ningún defecto de este change exige, y un fallo en él pondría
   en rojo los tres pipelines justo en el change cuyo entregable es una corrida verde (grupo 9 y 11.5). → **fila 35**.
5. **El hueco del modo de prueba con destino configurado, en los dos workflows.** Con `dry_run: true` **y** destino
   configurado, el job de despliegue queda saltado a propósito y `infra/ci/report-cd-outcome.sh` lo lee como "había
   destino y el despliegue no terminó bien" → **rojo falso**. Hoy no puede darse (cero secretos configurados). No se
   arregla aquí duplicando la tabla de decisión en un segundo script —dos lógicas de decisión son peores que un rojo
   falso imposible— y se cierra para `cd-staging` (6.4) y `cd-prod` (8.7) a la vez. → **fila 35**.
6. **La comprobación post-merge de que una corrida de `main` con la verificación en rojo no mueve `:staging`** (6.4).
   Fuera de `main` el tag móvil no se toca en ningún caso, así que desde esta rama no hay nada que observar. → **fila
   35**, tras el merge.
7. ~~**El aviso de consentimiento apagado sigue siendo de sección, no por vendor.**~~ **Retirado de esta lista el
   2026-09-25: se cerró dentro del change** (`4dca9e3`). Durante un día fue un diferido —el párrafo era único para
   toda la sección, atado a que hubiera al menos una clave de un vendor no indisponible, y con una clave disponible y
   otra caída seguía hablando en plural ("Tienes claves guardadas…")—. Hoy el aviso sale **por vendor**, dentro del
   bloque de cada uno: `data-testid` `profile-byok-consent-off-<vendor>` e id de i18n nuevo
   `profile.byok.vendorKeyInactive` en ES y EN, con `profile.byok.keysInactive` retirado de los dos catálogos. El
   número se conserva para no renumerar los puntos 8 y 9, a los que apuntan `tasks.md` y `openspec-changes.yaml`.
   → **no queda nada pendiente aquí**.
8. **El adaptador SMTP no sabe autenticarse.** `SmtpMailer` (`apps/api/src/infrastructure/mail/smtp-mailer.ts`) crea el
   transporte **sin bloque `auth`** y con `secure: false`, y no existen `MAIL_SMTP_USER` ni `MAIL_SMTP_PASSWORD` en
   ninguno de los dos esquemas de configuración: sirve para un relay que autorice por red o por IP y **no** para una
   submission con usuario y contraseña en el 587 (Gmail, Fastmail, el SMTP de Mailgun). Este change lo **documenta**
   como limitación en `infra/README.md`; no lo arregla. → **fila 35**, donde los primeros usuarios no-autor obligan a
   que el correo funcione de verdad.
9. **Sustituir MinIO, y mantener su espejo mientras tanto** (ADR-048 §8). El 2026-09-24 MinIO restringió el acceso
   anónimo a sus imágenes en `quay.io` —`401` para el repositorio entero— y los dos composes dejaron de poder
   levantarse en una máquina limpia; lo destapó la verificación del artefacto de este change, no un despliegue
   fallido. Aquí se toma la salida rápida: **replicar el mismo objeto** a `ghcr.io/manuxd270516/linkvault-minio` y
   referenciarlo por variable en los dos composes (4.16, 4.17). El camino limpio —otro servidor compatible con S3— y
   el **coste de mantener el espejo** (una vulnerabilidad en esa versión ya no se arregla sola, y lo replicado es
   **solo `linux/amd64`**) quedan abiertos. → **fila 35**.

### Fuera de alcance

Provisionar el servidor de staging o sus secretos —eso es la **fila 35**, que ningún otro change puede preceder
mientras el pipeline siga sin destino, para que "verde sin desplegar" no dure para siempre—, Traefik y DNS, y publicar
en registries de extensiones.

**`cd-prod` sí entra**: hereda el arreglo del artefacto y los tres resultados, sin ninguna evidencia previa de
funcionar.

**Y "ningún cambio funcional de la aplicación" quedó revocado al cerrar el debate** (alcance A1, decisión humana). El
change toca `libs/shared`, `libs/ai`, `apps/api` y `apps/web`. La distinción que se mantiene es otra: no se toca nada
**por iniciativa propia**; todo lo que entra es consecuencia de una contradicción que este change destapa y que se
decidió no fusionar a sabiendas.

Las decisiones no triviales quedan en **ADR-048**, que enmienda en parte ADR-033 D10, y en **ADR-049**, que enmienda la
definición de elegibilidad BYOK de ADR-032.
