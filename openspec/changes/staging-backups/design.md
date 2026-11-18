## Context

Es la tarea **C1** de `docs/despliegue/DECISION-DESPLIEGUE.md`, aprobada por el owner el 2026-11-18 junto con sus
respuestas a Q1-Q6 («Toma las recomendaciones»). Sin este change el runbook queda «no terminado» y no se invita a nadie
(regla de corte 7; condiciones 1-5 y 8 del disenso).

**Cómo se citan las preguntas:** «Q2 de la decisión» es una pregunta de `DECISION-DESPLIEGUE.md`, ya respondida; «Q2» a
secas es una pregunta de este change (sección «Open Questions»).

**Estado de partida, leído en el repositorio (`origin/main` 59617ac4):**

- `docker-compose.prod.yml` ya tiene las redes por proceso de D18 de 35b: `data-api` y `data-worker` (internas, con
  `mongo` y `redis`), `store-api` y `store-worker` (internas, con `object-store`), `api-egress` y `worker-egress` (con
  salida). Mongo tiene usuario raíz (`MONGO_ROOT_*`), creado **solo sobre volumen vacío**; Redis, contraseña.
- El almacén es SeaweedFS 4.47 `mini` con `-disableHttp`. Su pasarela S3 (8333) pide claves; el maestro, el volumen y
  los gRPC escuchan **sin autenticación**, alcanzables solo desde `api` y `worker` (riesgo residual de ADR-052 y D18).
  Tiene una sola identidad S3, la de la aplicación (`S3_ACCESS_KEY`/`S3_SECRET_KEY`).
- `tools/repo-checks` exige healthcheck a **todo** servicio de `docker-compose.prod.yml` (`compose-healthchecks`) y
  `check-env-file.mjs` toma las obligatorias de los `${VAR:?}` de ese fichero.
- El despliegue lleva al host los ficheros de `infra/deploy/config-files.txt` desde el commit desplegado (D4 de 35b).
- El outbox marca cada evento publicado con `publishedAt` y la spec `platform/outbox` exige consumidores idempotentes
  («Entrega idempotente», «El trabajo encolado no se pierde»).
- El host corre con el usuario de despliegue en el grupo `docker` (equivale a root, ADR-051 §4); el operador tiene un
  usuario de administración con `sudo`.
- 35b está en curso: PR-1 y PR-1b en `main`; entre PR-1b y PR-2 no se fusiona nada (`staging-host/tasks.md`,
  encabezado); su 9.10 (aviso a los invitados) y su requirement «El destino de staging se puede reconstruir desde la
  documentación» dicen hoy «desechable, sin copias». Este change no edita `openspec/changes/staging-host/`.

## Goals / Non-Goals

**Goals**

- Que perder el host, su volumen de arranque o la cuenta de Oracle cueste horas y como mucho 24 h de datos.
- Que el respaldo no sea el proceso más privilegiado de la pila ni deshaga D18.
- Que quien comprometa el host no pueda destruir los respaldos.
- Que un respaldo que falla o que falta se entere el owner sin mirar nada.
- Que la restauración esté escrita, probada en el host antes de invitar y repetida cada mes.

**Non-Goals**

- RPO menor a 24 h, réplicas o alta disponibilidad (Q4 de la decisión).
- Respaldar Redis (D12), `.env.staging` (35b 5.8) o `acme.json` (35b 6.9).
- SSH endurecido (Q6 de la decisión: va en 35b) y exención de inactividad (Q5: la resuelve el owner).
- Automatizar el ensayo mensual de restauración: queda como procedimiento con script y recordatorio.
- Cambiar código de `apps/api`, `apps/worker` o `libs/**`.

## Decisions

### D1. Excepción a la fila 35 y ventana de fusión (Q1 de la decisión, 2026-11-18)

El owner respondió Q1 = (a): change propio, con excepción a la precedencia de la fila 35 (ADR-048 §Consecuencias,
extendida por ADR-051 §1), fusionado **en la misma ventana que `enrichment-egress-guard`**: después de la 11.6 de 35b
y antes de su 10.7. Se registra en ADR-066 §1 y, en una línea, en ADR-048 §Consecuencias. Se aplican las **tres clases
de fusión** de ADR-056 §1 y ADR-060 §1 (en las ramas sin fusionar `change/enrichment-egress-guard` y
`change/paste-fallback-honest`):

1. **La fusión del change** (y cualquier correctiva antes de la 10.7): solo después de la 11.6 y antes de la 10.7,
   **nunca con una corrida `e2e-remote` en curso**, y repitiendo después de desplegar la 9.4 de `e2e-suite` sobre el
   commit desplegado. La 10.7 solo procede con la 9.4 en verde sobre el **último** hash desplegado.
2. **El PR de archivo**, después de la 10.7 **y después del archivo de 35b** (D14).
3. **Las fusiones de vuelta atrás** y su vuelta.

Las clases 2 y 3 siguen las reglas propias: nunca entre el PR-2 de 35b y su 11.6, nunca durante su 9.1-9.4, nunca los
días 7 y 14 de la medición y nunca con una corrida `e2e-remote` ese día.

El estado de 35b sale de una **confirmación escrita y fechada del owner en cada PR** («PR-2 de 35b = #NN; 11.6 hecha el
AAAA-MM-DD; 10.7 no hecha; sin `e2e-remote` hoy»), no de las casillas de `staging-host/tasks.md`, y se contrasta con
`git log --first-parent origin/main`. La confirmación lleva la fecha del día de la fusión.

**Orden con `enrichment-egress-guard`:** comparten ventana y cada uno va en su PR. No hay dependencia de código entre
ellos; el orden lo elige el owner. Cada fusión de clase 1 de cualquiera de los dos obliga a repetir la 9.4.

### D2. Dos lectores sin salida y un empujador sin datos, unidos por una tubería del host

El panel pidió «un contenedor de respaldo dedicado con redes que no deshagan D18» (H1). Un solo contenedor con la red de
Mongo, la del almacén y salida a Internet **sería** el proceso más privilegiado de la pila. Se parte en tres servicios
efímeros (`docker compose run --rm`), que solo existen mientras dura la corrida:

| Servicio | Imagen (fijada por digest, `arm64`) | Redes | Qué tiene |
|---|---|---|---|
| `backup-mongo` | `mongo:7.0.43` (la misma de la pila) | `data-backup` (interna: `mongo` y él) | `MONGO_BACKUP_*` |
| `backup-objects` | `rclone/rclone` | `store-backup` (interna: `object-store` y él) | `S3_BACKUP_*` |
| `backup-push` | `restic/restic` | `backup-egress` (con salida, solo él) | `RESTIC_PASSWORD` y credenciales de los destinos |

El orquestador (`infra/backup/run-backup.sh`, en el host, como el usuario de despliegue) encadena
`run backup-mongo … | run -T backup-push …`: los datos pasan por una tubería del host y **ningún proceso tiene a la vez
datos y salida**. El lector sin salida no puede exfiltrar; el empujador solo ve un flujo que restic cifra antes de
enviar.

- Los tres van en **`infra/backup/docker-compose.backup.yml`**, que se suma con `-f` solo para respaldar y restaurar.
  No van en `docker-compose.prod.yml` porque `compose-healthchecks` exige healthcheck a todo servicio de ese fichero y
  un trabajo de un solo uso no tiene uno honesto (el mismo motivo por el que ADR-052 §4 descartó un servicio de
  aprovisionamiento).
- Las redes `data-backup` y `store-backup` **sí** van en `docker-compose.prod.yml`, porque `mongo` y `object-store`
  tienen que estar unidos a ellas cuando corren; `backup-egress`, en el fichero del respaldo.
- Endurecimiento de los tres: `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, usuario no
  root cuando la imagen lo permite y `tmpfs` como única área de escritura.
- Las imágenes de terceros se comprueban con `infra/deploy/check-image-platforms.sh` antes de usarlas y se fijan por
  digest; las nuevas son las oficiales de restic y rclone.
- Una comprobación permanente de repositorio (`backup-isolation`) lee la configuración resuelta y falla si un servicio
  del respaldo mezcla redes de datos y de salida, si comparte red con `api` o `worker`, o si las redes de datos del
  respaldo tienen otros miembros.

**Riesgo residual que se extiende (ADR-066 §Enmiendas, punto 3):** `backup-objects` alcanza las interfaces sin
autenticación del almacén (maestro, volumen y gRPC), como `api` y `worker`. Se acepta porque no tiene salida, corre
unos minutos por noche con una imagen fijada y nada de él lee datos de usuario.

*Descartado:* un contenedor con las tres redes (deshace D18, H1); un timer del host que vuelca con `docker exec` en
`mongo` y `object-store` (el host no llega al almacén por la red, y `exec` en el almacén usaría la identidad de la
aplicación); leer el volumen del almacén en crudo (lectura no consistente, atada al formato interno de SeaweedFS y a su
clave); servicios con `profiles:` dentro de `docker-compose.prod.yml` (chocan con `compose-healthchecks`).

### D3. Credenciales de solo lectura propias

- **Mongo:** usuario `MONGO_BACKUP_USER` con el rol integrado `backup` sobre `admin` (permite `mongodump --oplog` y no
  escribe). Se **asegura en cada corrida y en cada restauración**: `docker compose exec -T mongo mongosh` con un
  `--eval` que lee `process.env` (raíz y respaldo) y hace `createUser` o `updateUser` idempotente. Por eso
  `MONGO_BACKUP_USER` y `MONGO_BACKUP_PASSWORD` van en el entorno del servicio `mongo` con `${VAR:?}`, con el formato
  apto para URI de D18. Cubre los volúmenes viejos (H7) y la rotación de la contraseña.
  *Descartado:* crearlo en el healthcheck (un healthcheck que escribe, el mismo rechazo de ADR-052 §4); un `post_start`
  de Compose (depende de una versión mínima que el host no tiene anotada todavía); `MONGO_INITDB_*` (solo corre sobre
  volumen vacío).
- **`mongodump` sin contraseña en los argumentos:** el lector escribe un fichero de configuración (`--config`) en su
  `tmpfs` desde su entorno, con modo 600, y lo pasa por ruta. Nunca una URI con credenciales en la orden.
- **Almacén:** identidad S3 propia (`S3_BACKUP_ACCESS_KEY`/`S3_BACKUP_SECRET_KEY`) con solo `List` y `Read` sobre los
  dos buckets. **El mecanismo se mide antes de implementar** (tarea 1.7), con estos criterios: (1) no monta un fichero
  con secreto en el servicio `object-store` (la forma de C3 de ADR-052 no lo admite); (2) no cambia `command`,
  `environment` ni volumen del servicio, o si los cambia se repiten C3-C5 y C7-C9 de la matriz antes de adoptarlo
  (ADR-052 §2); (3) la identidad sobrevive a un reinicio del almacén y se asegura de forma idempotente en cada corrida;
  (4) `PutObject` y `DeleteObject` con ella fallan. Candidatos, en orden: la API IAM embebida en la pasarela S3, llamada
  con la identidad de la aplicación desde un contenedor de un solo uso en `store-backup`; y la configuración de
  identidades del filer por `weed shell` dentro del contenedor del almacén. Si ninguno cumple, decide el owner (Q3).
- `rclone` recibe todo por variables de entorno (`RCLONE_CONFIG_STORE_*`), sin fichero de configuración.

### D4. Formato, orden y manifiesto de una corrida

Una corrida tiene un identificador (`<AAAAMMDD>T<HHMMSS>Z`) y, **por destino**, este orden fijo (H5):

1. **Base:** `mongodump --archive --gzip --oplog` con el usuario de respaldo → tubería → `restic backup --stdin
   --stdin-filename mongo.archive.gz --tag run:<id> --tag kind:mongo --host linkvault-staging`.
2. **Objetos:** `rclone copy` de los dos buckets al `tmpfs` del lector (tope `BACKUP_OBJECTS_MAX_BYTES`, por defecto
   1 GiB; pasarlo es una falla de clase `objects_too_large`), y `tar` a la salida estándar → `restic backup --stdin
   --stdin-filename objects.tar --tag kind:objects`. Va **después** de la base: todo objeto que la base referencia está
   en la copia, y lo que sobra lo dice la conciliación (D11).
3. **Manifiesto:** en el host, cada flujo pasa por `tee` hacia `sha256sum` y un contador de bytes, y al terminar los dos
   el orquestador emite un JSON (`manifest.json`, `--tag kind:manifest`) con el identificador, las horas UTC, bytes y
   SHA-256 de cada flujo, el número de objetos por bucket, los digests de las tres imágenes y la versión del formato.
   **Una corrida sin manifiesto no es un respaldo** (requirement «Respaldo nocturno…»): la restauración solo parte de
   corridas con manifiesto cuyas sumas coinciden.

Ningún dato en claro toca un disco: la base y los objetos viajan por tuberías; el área de trabajo de los objetos es
memoria (`tmpfs`). Como un `tmpfs` puede ir a swap, la tarea 2.2 comprueba que el host no tiene swap o que está cifrada.

*Descartado:* `restic backup` de un directorio en disco (texto en claro en disco); un solo `tar` con la base y los
objetos (no permite restaurar la base sola ni verificar cada parte); `restic tag` para marcar la corrida buena (reescribe
la instantánea, es decir, borra, y choca con D6).

### D5. Dos destinos, una pasada completa por destino

Q2 de la decisión (2026-11-18): destino 1, un **bucket privado de OCI Object Storage**; destino 2, **fuera de Oracle**,
(a) un almacenamiento de objetos con plan gratuito sin tarjeta y con bloqueo de objetos, si se verifica, y si no (b)
una cuenta de Google Drive **dedicada** con su cliente OAuth publicado (para que el token no venza a los 7 días).

La corrida hace **una pasada completa (D4) por destino**, primero OCI y después el de fuera, con el mismo identificador.
Las dos son independientes: si una falla, la otra sigue, y la corrida termina en falla nombrando el destino.

- Con (b), restic usa su backend `rclone`, que necesita el binario de rclone junto a restic. Como ninguna imagen
  oficial trae los dos, `backup-push` levanta un `rclone serve restic` efímero en una red interna propia y restic habla
  con él por `rest:`. Se diseña en la tarea 1.2 solo si Q2 cae en (b).
- La verificación del destino es **la primera tarea, del owner** (1.1), con criterio de corte (tasks).

*Descartado:* `restic copy` de OCI al otro destino (el segundo dependería del primero y su credencial tendría que leer
OCI); `tee` hacia dos empujadores (una falla de uno corta al otro); el destino (c) de Q2, la PC del owner (solo con la
PC encendida, y deja datos de invitados en la PC).

### D6. Borrado protegido: versiones retenidas, credencial del host sin borrado definitivo, poda fuera del host

Restic necesita borrar al menos sus ficheros de bloqueo en cada corrida, y la poda borra paquetes. Una credencial «solo
de escritura» no sirve (H2). El modelo que se adopta, por destino:

- **Modelo V (preferido):** bucket con **versionado** y **retención o bloqueo de objetos** de `P` días (por defecto 30,
  Q1), más una **regla de ciclo de vida que expira las versiones no actuales** a los `P + 1` días. La credencial del
  host puede crear, leer, listar y «borrar» (en un bucket versionado eso deja un marcador y la versión queda retenida),
  pero **no** puede borrar versiones, cambiar la retención, el versionado ni el ciclo de vida. Así restic funciona
  (bloqueos, `backup`, `check`) y lo que borre un atacante con esa credencial sigue recuperable `P` días.
- **Modelo R (alternativa):** regla de retención sin versionado, que impide borrar a cualquiera durante `P` días. Solo
  si las tareas 1.5a y 1.5b demuestran que restic `backup`, `check` y la poda terminan en 0 con él (los bloqueos y los paquetes
  recientes no se pueden borrar).
- **Nunca versionado sin ciclo de vida** (regla de corte 8 del runbook): acumula versiones y cobra (H2, H3).
- **La credencial de poda** (la que puede borrar versiones o podar) vive **solo** en el gestor de contraseñas del owner y
  se usa desde su PC (Q2). La poda es `restic forget --keep-daily 7 --keep-weekly 4 --prune --max-unused unlimited
  --no-cache`: no reempaqueta, así que no descarga datos a la PC; solo índices y metadatos, cifrados.
- **Verificación fuera del host** en la misma sesión mensual: desde la PC, `restic snapshots` de cada destino tiene que
  mostrar una corrida con manifiesto por cada uno de los últimos 7 días y una por cada una de las últimas 4 semanas.
  Detecta lo que el monitor de pings no ve: un atacante con el host puede seguir mandando pings de éxito.

Qué modelo admite cada destino (OCI y el de fuera) **se mide** en las tareas 1.5a y 1.5b con un repositorio de prueba y la
credencial del host, incluida la falsación «borrar de forma definitiva un paquete falla». No se da por hecho desde la
documentación del proveedor.

Con (b) de Q2 (Drive) el destino de fuera **no** tiene borrado protegido frente al host: el token que vive en el host
puede vaciar la papelera. La copia protegida es la de OCI; la de Drive cubre la pérdida de la cuenta de Oracle. Es la
Q4, bloqueante solo si Q2 cae en (b).

### D7. Retención, poda y plazo máximo de un dato borrado en las copias

Retención: 7 diarios y 4 semanales (Q3 de la decisión, 2026-11-18). La poda es mensual desde la PC (Q2 de este change, por defecto),
nunca diaria (peticiones de Object Storage). El **plazo máximo** durante el que un dato borrado (un CV, una cuenta)
sigue en alguna copia es la suma de tres términos:

| Término | Peor caso |
|---|---|
| La última instantánea que lo contiene sigue como semanal | 34 días |
| Hasta la siguiente poda (mensual) | 31 días |
| Ventana de protección `P` (versiones retenidas) | 30 días |
| **Total** | **95 días: «hasta 14 semanas»** |

Con `P` = 14 y poda mensual son 79 días («hasta 12 semanas»); con `P` = 14 y poda semanal, 55 («hasta 8 semanas»). El
número final lo fijan Q1 y Q2 y se escribe en tres sitios que se comprueban juntos (tarea 8.4): `infra/backup/README.md`,
el aviso a los invitados (9.10 de 35b) y `/privacidad`.

### D8. Tope de tamaño

Antes de cada pasada, `backup-push` mide el repositorio del destino (`restic stats --mode raw-data --json`) y, si pasa
`BACKUP_MAX_REPO_BYTES` (por defecto **4 GiB**), la pasada falla con clase `size_cap` sin enviar nada. 4 GiB y no 5:
con el modelo V, las versiones retenidas durante `P` días también ocupan, y el nivel gratuito de OCI es de 10 GB por
nivel en cuenta de pago (H3). La revisión mensual mira además el tamaño del bucket en la consola (versiones incluidas).
El lector de objetos tiene su propio tope (D4).

### D9. Aviso: pings desde el host a un monitor gratuito

El orquestador manda `start` al empezar, éxito al terminar las dos pasadas con manifiesto y `fail` con un cuerpo de una
línea (identificador de la corrida y clase: `lock_busy`, `ensure_user`, `mongo_dump`, `objects_read`,
`objects_too_large`, `size_cap`, `push_oci`, `push_offsite`, `manifest`) a `BACKUP_PING_URL` (por ejemplo,
healthchecks.io, plan gratuito). El monitor se configura con un periodo de un día y un margen de 3 horas, y avisa por
correo de una falla y de un éxito que no llega.

- Los pings salen **del host** con `curl`, no de un contenedor: así también avisan si Docker no arranca, y la imagen de
  restic no necesita cliente HTTP.
- La dirección del monitor es un secreto (quien la tiene puede mandar éxitos falsos): `curl` la recibe por
  `--config -` en la entrada estándar, nunca en los argumentos, y el orquestador la lee de `.env.staging` sin
  `source` (solo esa clave).

### D10. Programación: timer de systemd del host

`infra/backup/systemd/linkvault-backup@.service` (`Type=oneshot`, `User=%i`, ejecuta
`/srv/linkvault-staging/infra/backup/run-backup.sh`) y `linkvault-backup@.timer` (`OnCalendar=*-*-* 06:30:00 UTC`,
alrededor de las 03:30 en Argentina, `RandomizedDelaySec=15min`, `Persistent=true`). La instancia es el nombre del
usuario de despliegue. Las unidades las instala una vez el operador con `sudo` (el usuario de despliegue no tiene
`sudo`), siguiendo `infra/README.md`, y la reconstrucción del host lo repite. El script llega al host con cada
despliegue (`config-files.txt`). `flock` sobre un fichero del directorio fijo impide dos corridas a la vez.

*Descartado:* un programador dentro de un contenedor (tendría que vivir siempre, con datos y salida o con el socket de
Docker); `cron` del host (no recupera una corrida perdida con el host apagado).

### D11. Restauración y conciliación

`infra/backup/restore.sh --project <nombre> [--run <id>]`, para el proyecto de staging (vuelta atrás de datos) y para el
proyecto de ensayo:

1. Elige la última corrida con manifiesto (o la pedida) y **verifica las sumas** bajando los flujos una vez antes de
   tocar nada.
2. Para `api` y `worker`; deja `mongo` solo, sano y con el usuario raíz del fichero de entorno (un volumen nuevo lo
   inicializa la propia imagen con él).
3. `mongorestore --archive --gzip --drop --oplogReplay --nsExclude 'admin.*'` desde la tubería. No se pisa
   `admin.system.users` (H7).
4. Asegura el usuario de respaldo (D3).
5. Aprovisiona los buckets (`run --rm --no-deps api node object-store.js provision`) y recarga los objetos por la API S3
   con un contenedor de un solo uso con la identidad de la aplicación, en la red del almacén del proyecto, sin salida.
   El almacén cifra con la `OBJECT_STORE_SSE_KEY` del fichero de entorno: la copia guarda los objetos **descifrados**
   (cifrados por restic), así que la clave del almacén de destino puede ser la misma u otra; lo que sí exige la misma
   copia de `.env.staging` es `AI_VAULT_KEY` (las claves BYOK de la base).
6. Reencola el outbox (D12) e imprime la conciliación: CV de la base sin objeto, objetos sin documento (con el
   procedimiento de dos pasos del RUNBOOK, «Paso 6 octies», para borrarlos), eventos reencolados.

**Guardia «nunca en la PC del owner»:** fuera del host (sin `/srv/linkvault-staging/.env.staging` o con una
arquitectura distinta de `aarch64`), el script se niega a usar un repositorio que no sea un directorio local; así las
pruebas de desarrollo usan un repositorio local con datos sintéticos y uno remoto con datos reales no se puede
restaurar en otra máquina por accidente.

### D12. Redis no se respalda; el outbox vuelve a publicar lo que estaba en vuelo

Redis guarda colas y caché. El relay solo publica los eventos con `publishedAt: null`, así que un evento **ya
publicado** cuyo job no se había consumido al volcar se pierde con Redis: un enriquecimiento que no llega, un CV que no
se extrae, un `cv-deleted` que deja un objeto huérfano (hallazgo del critic de `gestionado-gratis`).

**Decisión:** la restauración vuelve a poner como pendientes (`publishedAt: null`, intentos y espera a cero) los eventos
publicados en las **24 h anteriores al volcado** (`BACKUP_REQUEUE_WINDOW_HOURS`, por defecto 24). La spec
`platform/outbox` exige consumidores idempotentes («Entrega idempotente», «Evento republicado tras la retención»), así
que repetir un evento ya consumido no duplica su efecto. El mismo script sirve suelto si se pierde solo Redis
(`infra/backup/requeue-outbox.sh --since <hora>`).

**Qué implica para el RPO:** el RPO de los **datos** sigue siendo 24 h. El de los **efectos** (correos, push,
enriquecimientos, extracciones) queda cubierto «al menos una vez» por el reencolado; el riesgo residual es un correo o un
push repetido si algún consumidor no cumpliera la idempotencia que su spec exige. En el **ensayo** no corre `worker`
(D13), así que nada sale: solo se cuenta cuántos eventos quedaron pendientes.

El script depende de los campos del outbox (`publishedAt`, `failedAt`, `attempts`, `nextAttemptAt` o como se llamen en
`apps/api/src/infrastructure/outbox/mongo-outbox.ts`): la tarea 6.3 los lee del código y una prueba local comprueba que
el relay publica lo reencolado. Los eventos `failed` no se tocan.

### D13. Ensayo de restauración en el host, en un proyecto aparte

`infra/backup/docker-compose.restore.yml`, sumado con `-p linkvault-restore` al compose de producción y al del
respaldo:

- `traefik`, `web` y `worker` con `profiles: [never]`; `ports: !reset []` en `traefik` (los `ports` se suman entre
  ficheros; `!reset` exige Compose ≥ 2.24, que la tarea 6.2 comprueba en el host);
- `api` solo en sus redes internas (`networks: !reset`, sin `api-egress`);
- `mongo` con `--wiredTigerCacheSizeGB 0.5`, para que dos `mongod` quepan en 12 GB junto a staging;
- volúmenes del proyecto (`linkvault-restore_*`), nunca los de staging.

`infra/backup/restore-drill.sh` mide el tiempo total (RTO), levanta `mongo`, `redis`, `object-store` y `api` del
proyecto aparte, restaura con D11, comprueba **por la API del proyecto aparte** (`exec api` con `fetch` a
`127.0.0.1:3000`) el login de una cuenta de prueba (credenciales tecleadas, nunca guardadas), sus links y la descarga de
su CV, imprime la conciliación y termina con `down -v`. Antes y después anota `CreatedAt` de los contenedores de staging
y falla si cambió alguno.

Calendario: el primer ensayo, **después de desplegar este change y antes de la 10.7** (fase 9 del runbook, sobre el
volumen existente y **sin** «Replace boot volume»); después, **cada mes**, en la misma sesión que la poda y la
verificación fuera del host (D6). Siempre en el host; **nunca** en la PC del owner (con invitados hay CV reales).

### D14. Coordinación con 35b: specs, aviso y orden de archivo

- El delta de `platform/production-deploy` de este change **modifica dos requirements que añade 35b** («El destino de
  staging se puede reconstruir…» y «La pila de staging separa la red…»). Hoy no están en `openspec/specs`, así que
  **el PR de archivo de este change va después del archivo de 35b**. Si al archivar 35b ya hubiera cambiado su texto,
  este delta se rehace sobre el texto archivado antes de archivar.
- La 9.10 de 35b (aviso a los invitados) dice «entorno desechable y sin copias». Este change **no** edita 35b: la tarea
  8.5 deja la nota para su sesión, con el texto nuevo (copias cifradas, plazo de D7, borrado de cuenta).
- La línea «Fuera: copias de seguridad de datos (staging es desechable)» del `scope` de `staging-host` en
  `openspec-changes.yaml` se anota en el PR de fusión de este change (tarea 8.5), no antes, para no chocar con el PR-2
  de 35b.
- Una entrada nueva del registro de afirmaciones (`staging-sin-copias`, ADR-048 §5) hace fallar `repo-checks` si
  `infra/README.md`, `docs/RUNBOOK.md`, `docs/despliegue/` o `apps/web/src` siguen diciendo «sin copias» o
  «desechable» con `infra/backup/run-backup.sh` en el árbol.

### D15. El despliegue de este change recrea `mongo` y `object-store`

Unir `mongo` a `data-backup` y `object-store` a `store-backup` cambia su configuración: el `up` del despliegue los
**recrea** (sin tocar sus volúmenes), y con ellos se reinician `api` y `worker`. Es un corte de uno o dos minutos. Va
dentro de la ventana de D1, con el smoke del despliegue y la 9.4 de `e2e-suite` después. Volver atrás es la vuelta
atrás de código de 35b: las redes nuevas sobran sin efecto.

### D16. Variables y secretos

| Variable | Dónde | Formato |
|---|---|---|
| `MONGO_BACKUP_USER`, `MONGO_BACKUP_PASSWORD` | `docker-compose.prod.yml` (servicio `mongo`, `${VAR:?}`) y el del respaldo | Apto para URI, como D18 |
| `S3_BACKUP_ACCESS_KEY`, `S3_BACKUP_SECRET_KEY` | compose del respaldo | Como `S3_ACCESS_KEY` |
| `RESTIC_PASSWORD` | compose del respaldo | ≥ 32 caracteres, `openssl rand -hex 32` |
| `BACKUP_OCI_REPOSITORY`, `BACKUP_OCI_ACCESS_KEY_ID`, `BACKUP_OCI_SECRET_ACCESS_KEY` | compose del respaldo | `s3:https://…` |
| `BACKUP_OFFSITE_*` | compose del respaldo | Nombres finales tras Q2 (tarea 1.2) |
| `BACKUP_PING_URL` | solo el host (`run-backup.sh`) | `https://…` |
| `BACKUP_MAX_REPO_BYTES`, `BACKUP_OBJECTS_MAX_BYTES`, `BACKUP_REQUEUE_WINDOW_HOURS` | compose del respaldo, con defecto | Enteros |

Todas en `.env.staging` y en su copia fuera del host (regla de 35b 5.8); **`RESTIC_PASSWORD` sin copia no hay
respaldo que valga**. La credencial de poda, solo en el gestor de contraseñas del owner. `.env.example` lleva valores
ficticios; `infra/ci/verify.env`, relleno para `MONGO_BACKUP_*`; `check-env-file.mjs` lee también los `${VAR:?}` del
compose del respaldo y aplica los formatos.

## Risks / Trade-offs

- **[R1] La identidad S3 de solo lectura puede no existir sin cambiar la configuración del almacén.** → Tarea 1.7 antes
  de nada; si exige otra configuración, repetir celdas de la matriz (días) o Q3 al owner.
- **[R2] OCI o el destino de fuera pueden no admitir el modelo V.** → Tareas 1.5a y 1.5b miden el modelo por destino; el modelo R
  solo si restic funciona con él; si ninguno, el destino no es apto y vuelve al owner.
- **[R3] Peticiones de OCI Object Storage (50.000 al mes).** Una corrida son decenas a cientos de peticiones por
  destino; la tarea 7.6 las mide en la consola tras una semana y la revisión de Q4 a las dos semanas las vuelve a mirar.
- **[R4] Un atacante con el host manda pings de éxito falsos.** → Verificación mensual fuera del host (D6) y ventana `P`
  de 30 días que la cubre.
- **[R5] Plazo largo de los datos borrados en las copias (hasta 14 semanas por defecto).** → Escrito en `/privacidad` y
  en el aviso; acortarlo es Q1 y Q2.
- **[R6] Reencolar puede repetir un correo o un push** si un consumidor no cumple su idempotencia. → Aceptado; el ensayo
  no corre `worker`.
- **[R7] Dos `mongod` en 12 GB durante el ensayo.** → Caché de 0,5 GB en el proyecto aparte y memoria libre anotada
  antes de empezar.
- **[R8] `tmpfs` y swap.** → Tarea 2.2: sin swap o swap cifrada; si no, se decide antes de desplegar.
- **[R9] Con Drive (Q2 b) la copia de fuera no tiene borrado protegido.** → Q4.
- **[R10] El lector de objetos amplía el riesgo residual del almacén.** → Sin salida, efímero, imagen fijada (D2).
- **[R11] El archivo depende del archivo de 35b.** → D14; si 35b se retrasa, el PR de archivo espera.

## Migration Plan

1. Tareas del owner del grupo 1 (destinos, monitor) y la medición 1.5a, 1.5b y 1.7, en paralelo a 35b: no tocan `main`.
2. Implementación en la rama del change; pruebas con pila local y repositorio local con datos sintéticos.
3. Fusión en la ventana de D1 (después de la 11.6, antes de la 10.7); despliegue normal (D15).
4. Secretos en `.env.staging` y su copia; unidades instaladas; primer respaldo a mano; dos noches seguidas; falsaciones
   en el host (fase 8 del runbook).
5. Ensayo de restauración en el host (fase 9), con RTO anotado.
6. Recién entonces, la 10.7 de 35b.

**Vuelta atrás:** revertir el PR deja la pila sin las redes del respaldo (recrea `mongo` y `object-store` otra vez) y el
timer fallando con aviso hasta que se desactive (`systemctl disable --now`). Los respaldos ya hechos siguen en los
destinos y se pueden restaurar con el `restore.sh` del commit anterior a la reversión.

## Open Questions

Las Q1-Q6 de la decisión de despliegue están respondidas (2026-11-18). Estas son nuevas, de este change:

**Q1. Ventana de protección `P` del borrado.** **[no bloqueante; el change trae 30 días por defecto]**
(a) 30 días: cubre la verificación mensual fuera del host; (b) 14 días; (c) 7 días. Menos días acortan el plazo de los
datos borrados (D7) y lo que ocupan las versiones, pero un borrado malicioso podría no detectarse a tiempo.
**Recomendación: (a).**

**Q2. Dónde y cada cuánto se poda.** **[no bloqueante; por defecto (a)]**
(a) Mensual, desde la PC del owner, en la misma sesión que el ensayo de restauración y la verificación fuera del host;
(b) semanal, desde la PC (plazo de D7 más corto, una tarea más por semana); (c) semanal, con un workflow programado de
GitHub Actions y la credencial de poda como secreto del repositorio (automático, pero junta en GitHub la credencial que
destruye los respaldos con la clave SSH que da root en el host). **Recomendación: (a).**

**Q3. Si no hay identidad S3 de solo lectura sin cambiar la configuración del almacén.** **[bloqueante solo si la
tarea 1.7 no encuentra un mecanismo que cumpla sus cuatro criterios]**
(a) Adoptar la configuración que la dé y repetir C3-C5 y C7-C9 de la matriz (ADR-052 §2); (b) aceptar por escrito que
el lector de objetos use la identidad de la aplicación (sin salida, efímero), lo que relaja la condición (1) del
disenso. **Recomendación: (a)**, salvo que la repetición de la matriz pase de dos días.

**Q4. Si el destino de fuera de Oracle es Google Drive.** **[bloqueante solo si Q2 de la decisión cae en (b)]**
(a) Aceptar por escrito que esa copia no tiene borrado protegido frente al host (la de OCI sí lo tiene); (b) seguir
buscando un destino (a). **Recomendación: (a)**: Drive cubre la pérdida de la cuenta de Oracle, que es su función.

## Respuestas del owner y aprobación

- **2026-11-18, decisión de despliegue:** Q1 (a), Q2 (a) si se verifica y si no (b), Q3 (a), Q4 (a) con revisión a las
  dos semanas, Q5 (a) y si no hay respuesta en una semana (b), Q6 (a). «Toma las recomendaciones».
- **Q1-Q4 de este change:** pendientes (tarea 0.1).
- **Debate critic/business/reflect y aprobación:** pendientes (tarea 0.2).
