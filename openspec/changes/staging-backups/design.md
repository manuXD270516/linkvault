## Context

Es la tarea **C1** de `docs/despliegue/DECISION-DESPLIEGUE.md`, aprobada por el owner el 2026-11-18 junto con sus
respuestas a Q1-Q6 («Toma las recomendaciones»). Sin este change el runbook queda «no terminado» y no se invita a nadie
(regla de corte 7; condiciones 1-5 y 8 del disenso).

**Cómo se citan las preguntas:** «Q2 de la decisión» es una pregunta de `DECISION-DESPLIEGUE.md`, ya respondida; «Q2» a
secas es una pregunta de este change (sección «Open Questions»). Los identificadores `C<n>` y `B<n>` remiten a la tabla
del debate (sección «Debate iteración 1»).

**Estado de partida, leído en el repositorio (`origin/main` 59617ac4):**

- `docker-compose.prod.yml` (proyecto **`linkvault-prod`**, por su `name:`) ya tiene las redes por proceso de D18 de
  35b: `data-api` y `data-worker` (internas, con `mongo` y `redis`), `store-api` y `store-worker` (internas, con
  `object-store`), `api-egress` y `worker-egress` (con salida). Mongo tiene usuario raíz (`MONGO_ROOT_*`), creado
  **solo sobre volumen vacío**; Redis, contraseña.
- El almacén es SeaweedFS 4.47 `mini` con `-disableHttp`. Su pasarela S3 (8333) pide claves; el maestro, el volumen y
  los gRPC escuchan **sin autenticación**, alcanzables solo desde `api` y `worker` (riesgo residual de ADR-052 y D18).
  Tiene una sola identidad S3, la de la aplicación (`S3_ACCESS_KEY`/`S3_SECRET_KEY`). La spec `platform/object-store`
  exige hablar con él **solo por la API S3**, sin CLI ni API de administración del producto.
- `tools/repo-checks` exige healthcheck a **todo** servicio de `docker-compose.prod.yml` (`compose-healthchecks`) y
  `check-env-file.mjs` toma las obligatorias de los `${VAR:?}` de ese fichero.
- El despliegue lleva al host los ficheros de `infra/deploy/config-files.txt` desde el commit desplegado (D4 de 35b).
- El outbox (`apps/api/src/infrastructure/outbox/outbox-event.schemas.ts`) tiene `publishedAt`, `failedAt`,
  `attempts` y `nextAttemptAt`; la spec `platform/outbox` exige consumidores idempotentes.
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
- Que la restauración esté escrita, probada en el host antes de invitar y repetida con un calendario fijo.

**Non-Goals**

- RPO menor a 24 h, réplicas o alta disponibilidad (Q4 de la decisión).
- Respaldar Redis (D12), `.env.staging` (35b 5.8) o `acme.json` (35b 6.9).
- SSH endurecido (Q6 de la decisión: va en 35b) y exención de inactividad (Q5: la resuelve el owner).
- Automatizar el ensayo de restauración: queda como procedimiento con script y recordatorio.
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

**Precondiciones de la fusión de clase 1 (C14, C17):** los secretos del respaldo ya están en `.env.staging` y en su
copia (tarea 10.1, con el procedimiento de la fase 3 del runbook), porque el compose de producción pasa a exigir
`MONGO_BACKUP_*` y el `up` del despliegue fallaría sin ellas; y la 9.10 de 35b está enmendada con el aviso nuevo.

**Orden con `enrichment-egress-guard`:** comparten ventana y cada uno va en su PR. No hay dependencia de código entre
ellos; el orden lo elige el owner. Cada fusión de clase 1 de cualquiera de los dos obliga a repetir la 9.4.

### D2. Lectores sin salida, un empujador que no puede consultar los datos, unidos por una tubería del host

El panel pidió «un contenedor de respaldo dedicado con redes que no deshagan D18» (H1). Un solo contenedor con la red de
Mongo, la del almacén y salida a Internet **sería** el proceso más privilegiado de la pila. Se parte en servicios
efímeros (`docker compose run --rm --no-deps -T`), que solo existen mientras dura la corrida o la restauración:

| Servicio | Imagen (fijada por digest, `arm64`) | Redes | Qué tiene | Cuándo |
|---|---|---|---|---|
| `backup-mongo` | `mongo:7.0.43` (la misma de la pila) | `data-backup` (interna: `mongo` y él) | `MONGO_BACKUP_*` | Respaldo |
| `backup-objects` | `rclone/rclone` | `store-backup` (interna: `object-store` y los dos de objetos) | `S3_BACKUP_*` | Respaldo |
| `backup-push` | `restic/restic` | `backup-egress` (con salida, solo él) | `RESTIC_PASSWORD` y credenciales de los destinos | Respaldo y restauración |
| `restore-objects` | `rclone/rclone` | `store-backup` | Identidad de la aplicación (`S3_ACCESS_KEY`) | Solo restauración |
| `backup-identity` | cliente SigV4 `arm64` fijado por digest (lo elige la 1.7a) | `store-backup` | Identidad de la aplicación, para asegurar la de respaldo | Respaldo y restauración |

El orquestador (`infra/backup/run-backup.sh`, en el host, como el usuario de despliegue) encadena
`run backup-mongo … | run backup-push …`: los datos pasan por una tubería del host. **Ningún proceso puede consultar
los datos y además salir a Internet** (C3): los lectores y el cargador consultan Mongo o el almacén y no tienen salida;
`backup-push` tiene salida y no alcanza ni Mongo ni el almacén, pero **sí ve en claro el flujo que recibe** antes de
cifrarlo. Ese es un riesgo residual de la imagen de restic, escrito en ADR-066: se mitiga con la imagen oficial fijada
por digest y comprobada por plataforma (C26).

- **Sin registros de datos (C1, P0):** todos los servicios de este fichero llevan `logging: { driver: none }`. Su
  salida estándar **es** el volcado de la base o el `tar` de los objetos (o, en `backup-push`, el `restic dump` de una
  restauración); con el controlador por defecto de Docker (`json-file`) quedaría escrita **en claro** en
  `/var/lib/docker/containers/<id>/…-json.log`. Que la tubería de `run -T` siga entregando los bytes íntegros con
  `none` es un supuesto **medido en la tarea 1.8** (C1-a): 64 MiB aleatorios generados en el `tmpfs` de un contenedor
  con `logging: none` dan la misma suma dentro y fuera, `LogPath` queda vacío y `docker logs` da error.
- **El orquestador tampoco filtra datos (C1-b):** `run-backup.sh` y `restore.sh` nunca reproducen el flujo en su
  propia salida ni en la de systemd: sin `set -x`, sin `tee` a la salida estándar. La prueba de la 4.7a lo vigila con
  un marcador binario.

**Medido (tarea 1.8, 2026-11-18; Docker 29.9.3 y Compose v5.7.0 sobre Docker Desktop, Linux amd64).** Un contenedor efímero
con `logging: { driver: none }`, `read_only` y un `tmpfs` de 128 MiB generó 64 MiB aleatorios y los sacó por su salida
estándar con `docker compose run --rm --no-deps -T`:

| Medida | Resultado |
|---|---|
| `sha256sum` dentro del contenedor | `331299f928777dccf33b054dd1e01ef2ad063ab7e17ec2f881434eb7c64352ef` |
| `sha256sum` del flujo en el host (`run -T … | sha256sum`) | `331299f928777dccf33b054dd1e01ef2ad063ab7e17ec2f881434eb7c64352ef` (igual) |
| `docker inspect` (`run -d`) | `HostConfig.LogConfig.Type = none`, `LogPath = []` (vacío) |
| `docker logs <id>` | error: `configured logging driver does not support reading` (código 1) |

El supuesto de D2 se cumple: la tubería entrega los bytes íntegros con `logging: none`.
- Los cinco van en **`infra/backup/docker-compose.backup.yml`**, que se suma con `-f` solo para respaldar y restaurar.
  No van en `docker-compose.prod.yml` porque `compose-healthchecks` exige healthcheck a todo servicio de ese fichero y
  un trabajo de un solo uso no tiene uno honesto (el mismo motivo por el que ADR-052 §4 descartó un servicio de
  aprovisionamiento).
- Las redes `data-backup` y `store-backup` **sí** van en `docker-compose.prod.yml`, porque `mongo` y `object-store`
  tienen que estar unidos a ellas cuando corren; `backup-egress`, en el fichero del respaldo.
- Endurecimiento: `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, usuario no root
  cuando la imagen lo permite, `tmpfs` como única área de escritura, `networks` explícitas, sin `network_mode` y sin
  `ports`.
- **Guardia `backup-isolation` (C4):** en CI lee `docker compose -f docker-compose.prod.yml -f
  infra/backup/docker-compose.backup.yml [-f infra/backup/docker-compose.restore.yml] --env-file infra/ci/verify.env
  config --format json`, volcado a fichero y leído con `node`. Donde no hay `docker` (y solo fuera de CI) aplica las
  mismas reglas sobre los ficheros crudos. Reglas: cada servicio `backup-*`/`restore-*` declara `networks` explícitas,
  no tiene `network_mode`, no está en la red `default`, no tiene `ports` y lleva `logging.driver: none`; ninguno está a
  la vez en una red con salida y en una de datos; ninguno comparte red con `api` ni `worker`; `data-backup` y
  `store-backup` son `internal: true`, y sus miembros son exactamente `mongo`+`backup-mongo` y
  `object-store`+`backup-objects`+`restore-objects`+`backup-identity`; en el override de restauración, el único servicio en una red con
  salida es `backup-push`, sin redes de datos (C6).

**Riesgo residual que se extiende (ADR-066 §Enmiendas, punto 3):** `backup-objects`, `restore-objects` y
`backup-identity` alcanzan las
interfaces sin autenticación del almacén (maestro, volumen y gRPC), como `api` y `worker`. Se acepta porque no tienen
salida y solo existen unos minutos, con una imagen fijada.

*Descartado:* un contenedor con las tres redes (deshace D18, H1); un timer del host que vuelca con `docker exec` en
`mongo` y `object-store` (el host no llega al almacén por la red, y `exec` en el almacén usaría la identidad de la
aplicación); leer el volumen del almacén en crudo (lectura no consistente, atada al formato interno de SeaweedFS y a su
clave); servicios con `profiles:` dentro de `docker-compose.prod.yml` (chocan con `compose-healthchecks`).

### D3. Credenciales de solo lectura propias

- **Mongo:** usuario `MONGO_BACKUP_USER` con el rol integrado `backup` sobre `admin` (permite `mongodump --oplog` y no
  escribe). Se **asegura en cada corrida y en cada restauración**: `docker compose exec -T mongo mongosh` con el script
  **por la entrada estándar** (`--file /dev/stdin` o el equivalente que mida la 3.1; D3-a), sin montajes nuevos en
  `mongo`; el script lee `process.env` (raíz y respaldo) y hace `createUser` o `updateUser` idempotente. Por eso
  `MONGO_BACKUP_USER` y `MONGO_BACKUP_PASSWORD` van en el entorno del servicio `mongo` con `${VAR:?}`, con el formato
  apto para URI de D18. Cubre los volúmenes viejos (H7) y la rotación de la contraseña.
  *Descartado:* crearlo en el healthcheck (un healthcheck que escribe, el mismo rechazo de ADR-052 §4); un `post_start`
  de Compose (depende de una versión mínima que el host no tiene anotada todavía); `MONGO_INITDB_*` (solo corre sobre
  volumen vacío).
- **`mongodump` sin contraseña en los argumentos:** el lector escribe un fichero de configuración (`--config`) en su
  `tmpfs` desde su entorno, con modo 600, y lo pasa por ruta. Nunca una URI con credenciales en la orden.
- **Almacén:** identidad S3 propia (`S3_BACKUP_ACCESS_KEY`/`S3_BACKUP_SECRET_KEY`) con solo `List` y `Read` sobre los
  dos buckets, asegurada por `infra/backup/ensure-backup-identity.sh` desde el servicio `backup-identity` (D2).
  **El mecanismo se mide antes de implementar** (tareas 1.7a y 1.7b) con siete criterios:
  1. no monta un fichero con secreto en el servicio `object-store`;
  2. no cambia `command`, `environment` ni volumen del servicio (si los cambia, se repiten C3-C5 y C7-C9 de la matriz
     antes de adoptarlo, ADR-052 §2);
  3. la identidad sobrevive a un reinicio del almacén y se asegura de forma idempotente en cada corrida;
  4. `PutObject` y `DeleteObject` con ella fallan;
  5. **(C2, P0)** después de asegurarla y de `docker compose restart object-store`, `node object-store.js verify` con
     la imagen de `api` sale 0, y `PutObject` y `DeleteObject` con la identidad de **la aplicación** siguen
     funcionando: crear una identidad no puede degradar la de la aplicación (un almacén que pasa de «una identidad
     administradora implícita» a «lista de identidades» puede dejar a la aplicación sin permisos);
  6. **(C2, P0)** el listado de identidades antes y después difiere **solo** en la del respaldo;
  7. **(C19-a)** la clave de la identidad se puede **fijar desde el entorno** (`S3_BACKUP_*`). Si el almacén solo la
     genera él, se adopta la **variante efímera**: la identidad se crea al empezar cada corrida, su clave pasa a
     `backup-objects` por entorno (nunca por `argv`) y se borra al terminar, también si la corrida falla; en ese caso
     `S3_BACKUP_*` sale de D16, de la 7.2 y de la 10.1.
  Si fallan los criterios, o ninguna de las dos variantes sirve, se pasa a Q3.
- **Defensa en cada corrida (C2-a):** después de `ensure-backup-identity`, `run-backup.sh` ejecuta
  `run --rm --no-deps api node object-store.js verify`; si falla, la corrida termina con `fail ensure_identity`, que el
  RUNBOOK trata como **urgente** (la aplicación podría haber perdido permisos). El RUNBOOK tiene «Revertir la identidad
  de respaldo», probada en la 1.7b.
- **Alcance real de la identidad de solo lectura (C19-b):** **evita escrituras por error; no contiene a un lector
  comprometido**, porque el gRPC del filer y las demás interfaces internas del almacén siguen sin autenticación y el
  lector las alcanza. Se escribe así en ADR-066.
- **Mecanismo candidato (C19):** solo la **API IAM** que expone la pasarela S3, llamada con la identidad de la
  aplicación desde un contenedor de un solo uso en `store-backup`. Tiene la forma de la API IAM de AWS, así que un
  almacén sustituto que la ofrezca no obliga a reescribir el script; aun así es una API de administración, y la spec
  `platform/object-store` («El almacén se usa solo por la API S3») se **modifica** con una excepción acotada a
  `ensure-backup-identity`, aislada en un solo script que es lo único a reescribir si cambia el producto. Se
  **descarta `weed shell`**: es la CLI de un producto concreto y exigiría ejecutar dentro del contenedor del almacén,
  dos cosas que esa spec prohíbe sin excepción posible acotada. Si la API IAM no cumple los siete criterios, Q3.

**Medido (tareas 1.7a y 1.7b, 2026-11-18; SeaweedFS 4.47 `mini` con `-disableHttp`, la pila de producción con
`infra/ci/verify.env`, cliente SigV4 `amazon/aws-cli:2.37.8`, que tiene `arm64`, desde un contenedor en `store-api`):**
la API de identidades **existe** en la pasarela (`iam list-users` con la identidad de la aplicación lista `admin-linkvaul`), pero
**con la configuración medida está en solo lectura**: `weed mini -h` documenta `-s3.iam.readOnly` con valor por defecto `true`, y
`CreateUser`, `PutUserPolicy` y `CreateAccessKey` terminan en `AccessDenied: IAM write operations are disabled on this
server`. Escribir exige `-s3.iam.readOnly=false` en el `command` del almacén. Para dar datos a la decisión, el resto de los
criterios se midió **en una copia de la pila con ese único argumento añadido** (un override en el directorio de trabajo, nunca
en el repositorio):

| Criterio de D3 | Resultado |
|---|---|
| 1. sin fichero con secreto montado | cumple (todo por la API, nada montado) |
| 2. sin cambio de `command`, `environment` ni volumen | **NO cumple**: hace falta `-s3.iam.readOnly=false` en `command` (también para borrar la identidad) |
| 3. sobrevive a `restart object-store` | cumple (con el argumento) |
| 4. `PutObject` y `DeleteObject` con ella fallan | cumple: `AccessDenied` en los dos; `ListObjectsV2` y `GetObject` funcionan en `cvs` y `snapshots` |
| 5. (C2) tras asegurarla y reiniciar: `verify` en 0 y la aplicación sigue subiendo y borrando | cumple |
| 6. (C2) el listado de identidades difiere solo en la del respaldo | cumple (`admin-linkvaul` → `admin-linkvaul`, `lv-backup-ro`) |
| 7. (C19-a) clave fijable desde el entorno | **NO**: `CreateAccessKey` la genera el almacén (20 + 40 caracteres) |

Política de la identidad medida: `s3:ListBucket`, `s3:GetObject`, `s3:GetObjectTagging` y `s3:GetBucketLocation` sobre los dos buckets.
**«Revertir la identidad de respaldo» ensayado** con `iam delete-access-key`, `iam delete-user-policy` y `iam delete-user`: el
listado vuelve a ser idéntico al de antes, la clave borrada responde `InvalidAccessKeyId` y `verify` sale 0. `CreateUser` de un
usuario existente responde `EntityAlreadyExists` (el script idempotente lo tiene que tolerar). **Resultado: los criterios 2 y 7 fallan
con el almacén tal como está medido, así que el mecanismo pasa a la Q3.** La respuesta del owner registrada en «Respuestas del
owner y aprobación» dice (b) si fallan los criterios y (a) solo si no cambia `command`; esa decisión no se toma en la 1.7: la
implementación sigue sin `backup-identity` ni `ensure-backup-identity.sh` hasta que se confirme (tareas 3.2, 3.3 y la mitad de la 4.3).
- `rclone` recibe todo por variables de entorno (`RCLONE_CONFIG_STORE_*`), sin fichero de configuración.

### D4. Formato, orden y manifiesto de una corrida

Una corrida tiene un identificador (`<AAAAMMDD>T<HHMMSS>Z`) y, **por destino**, este orden fijo (H5):

0. **Preparación (C26, C27):** espera a que `mongo` y `object-store` estén sanos (plazo de 10 minutos; si no,
   `stack_unhealthy`); `docker compose pull` de las cuatro imágenes del respaldo y `check-image-platforms.sh` sobre
   ellas (si no, `images`).
1. **Base:** `mongodump --archive --gzip --oplog` con el usuario de respaldo → tubería → `restic backup --stdin
   --stdin-filename mongo.archive.gz --tag run:<id> --tag kind:mongo --host linkvault-staging`.
2. **Objetos:** `rclone copy` de los dos buckets al `tmpfs` del lector (tope `BACKUP_OBJECTS_MAX_BYTES`, por defecto
   1 GiB; pasarlo es una falla de clase `objects_too_large`), y `tar` a la salida estándar → `restic backup --stdin
   --stdin-filename objects.tar --tag kind:objects`. Va **después** de la base: todo objeto que la base referencia está
   en la copia, y lo que sobra lo dice la conciliación (D11).
3. **Manifiesto:** en el host, cada flujo pasa por `tee` hacia `sha256sum` y un contador de bytes, y al terminar los dos
   el orquestador emite un JSON (`manifest.json`, `--tag kind:manifest`) con el identificador, las horas UTC
   (entre ellas `mongoDumpStartedAt` y `mongoDumpFinishedAt` **de ese destino**, C8-a), bytes y SHA-256 de cada flujo, el número de objetos por bucket, los digests de las imágenes y la versión del formato.
   **Una corrida sin manifiesto no es un respaldo**: la restauración solo parte de corridas con manifiesto cuyas sumas
   coinciden. Dos manifiestos, o dos instantáneas del mismo tipo, con el mismo identificador son un **error** al
   restaurar (C25), no se elige uno.

Ningún dato en claro toca un disco: la base y los objetos viajan por tuberías, sin registros de Docker (D2); el área de
trabajo de los objetos es memoria (`tmpfs`). Como un `tmpfs` puede ir a swap, la tarea 2.2 comprueba que el host no
tiene swap o que está cifrada.

**Estructura del script (C13, C13-a):** todo el cuerpo de `run-backup.sh` y de `restore.sh` va dentro de
`main() { … }` y la última línea es `main "$@"; exit $?`. Además, al tomar el candado, cada uno **copia
`infra/backup/` y los dos compose a `.backup-run-<id>/`** en el directorio fijo y ejecuta desde esa copia (la borra al
terminar): un despliegue que reemplaza los ficheros a mitad de corrida no cambia lo que la corrida usa.

**Identidad verificada (C2-a):** entre `ensure-backup-identity` y la lectura de los objetos va el `verify` de D3.

**Aviso de poda vencida (B3):** al terminar bien, el script mira la instantánea más vieja de cada destino; si pasa de
**65 días** (34 de la retención más 31 de la poda mensual), manda `fail prune_overdue` **después** de haber respaldado:
el respaldo se hizo, y el correo del monitor le recuerda al owner la sesión mensual.

*Descartado:* `restic backup` de un directorio en disco (texto en claro en disco); un solo `tar` con la base y los
objetos (no permite restaurar la base sola ni verificar cada parte); `restic tag` para marcar la corrida buena (reescribe
la instantánea, es decir, borra, y choca con D6).

### D5. Dos destinos, una pasada completa por destino

Q2 de la decisión (2026-11-18): destino 1, un **bucket privado de OCI Object Storage**; destino 2, **fuera de Oracle**,
(a) un almacenamiento de objetos con plan gratuito sin tarjeta y con bloqueo de objetos, si se verifica, y si no (b)
una cuenta de Google Drive **dedicada** con su cliente OAuth publicado (para que el token no venza a los 7 días) y el
alcance `drive.file` (B12): la aplicación solo ve lo que ella misma creó.

La corrida hace **una pasada completa (D4) por destino**, primero OCI y después el de fuera, con el mismo identificador.
Las dos son independientes: si una falla, la otra sigue, y la corrida termina en falla nombrando el destino.

- Con (b), restic usa su backend `rclone`, que necesita el binario de rclone junto a restic. Como ninguna imagen
  oficial trae los dos, `backup-push` levanta un `rclone serve restic` efímero en una red interna propia y restic habla
  con él por `rest:`. Se diseña en la tarea 1.2 solo si Q2 cae en (b).
- La verificación del destino es **tarea del owner** (1.1), con criterio de corte, y va **después de la 1.5a** (nota de
  business): si OCI no admite el modelo V, cambia el reparto de destinos y lo que se le pide al de fuera.
- Q5 (propuesta, B7): si la 1.1 termina en (a), quedarse con un solo destino. Reabre la respuesta del owner a Q2 de la
  decisión, así que va como propuesta con recomendación, no como decisión.

*Descartado:* `restic copy` de OCI al otro destino (el segundo dependería del primero y su credencial tendría que leer
OCI); `tee` hacia dos empujadores (una falla de uno corta al otro); el destino (c) de Q2, la PC del owner (solo con la
PC encendida, y deja datos de invitados en la PC).

### D6. Borrado protegido: versiones retenidas, credencial del host sin borrado definitivo, poda fuera del host

Restic necesita borrar al menos sus ficheros de bloqueo en cada corrida, y la poda borra paquetes. Una credencial «solo
de escritura» no sirve (H2). El modelo que se adopta, por destino:

- **Modelo V (preferido):** bucket con **versionado** y **retención o bloqueo de objetos** de `P` días (por defecto 30,
  Q1), más una **regla de ciclo de vida que expira las versiones no actuales** a los `P + 1` días. La credencial del
  host puede crear, leer, listar y «borrar» (en un bucket versionado eso deja un marcador y la versión queda retenida),
  pero **no** puede borrar versiones (borrado con `versionId`), suspender el versionado, cambiar el ciclo de vida ni
  tocar la retención. Así restic funciona (bloqueos, `backup`, `check`) y lo que borre un atacante con esa credencial
  sigue recuperable `P` días.
- **Retención no bloqueada (C16):** la regla de retención se crea **sin bloquear** (en OCI, sin fecha de bloqueo): el
  owner, con su usuario administrador, puede quitarla; la credencial del host no. Así la regla de corte 4 del runbook
  (alerta de costo → borrar el recurso) sigue siendo posible. Se escribe en esa regla: «un bucket con retención se
  vacía quitando primero la regla, con el usuario administrador».
- **Modelo R (alternativa):** regla de retención sin versionado, que impide borrar a cualquiera durante `P` días. Solo
  si las tareas 1.5a y 1.5b demuestran que restic `backup`, `check` y la poda terminan en 0 con él.
- **Nunca versionado sin ciclo de vida** (regla de corte 8 del runbook): acumula versiones y cobra (H2, H3).
- **La credencial de poda** (la que puede borrar versiones o podar) vive **solo** en el gestor de contraseñas del owner y
  se usa desde su PC (Q2). La poda es `restic forget --keep-daily 7 --keep-weekly 4 --prune --max-unused unlimited
  --no-cache`: no reempaqueta, así que no descarga datos a la PC; solo índices y metadatos, cifrados.
- **En la PC solo `snapshots`, `forget --prune`, `stats` y `check` (B9)**, nunca `restore`, `dump` ni `mount`: esas
  órdenes traerían datos en claro a la PC. El `RUNBOOK` lo dice junto a las órdenes.
- **Verificación fuera del host cada ≤ `P` − 7 días (C15):** un `restic snapshots` **quincenal** de cada destino, de
  unos 5 minutos, desde la PC. Criterio simple (B5): la última corrida con manifiesto es de hoy o de ayer, y hay al menos
  7 en los últimos 7 días. Detecta lo que el monitor de pings no ve (un atacante con el host puede seguir mandando
  éxitos) a tiempo para recuperar dentro de la ventana `P`. Una vez por mes, además, `restic check` por destino (solo
  metadatos, C7).
- **«Recuperar tras un borrado» (C15):** sección del RUNBOOK con el procedimiento del owner, con su usuario
  administrador: listar las versiones no actuales de los prefijos de restic, restaurar la última versión de cada objeto
  borrado (quitar el marcador), y comprobar con `restic snapshots` y `restic check`. Dentro de la ventana `P`.

Qué modelo admite cada destino **se mide** en las tareas 1.5a y 1.5b con un repositorio de prueba y la credencial del
host, con cinco falsaciones: borrar de forma definitiva un paquete, borrar con `versionId`, suspender el versionado,
cambiar el ciclo de vida y tocar la retención. No se da por hecho desde la documentación del proveedor.

Con (b) de Q2 (Drive) el destino de fuera **no** tiene borrado protegido frente al host: el token que vive en el host
puede vaciar la papelera. La copia protegida es la de OCI; la de Drive cubre la pérdida de la cuenta de Oracle. Es la
Q4, bloqueante solo si Q2 cae en (b).

### D7. Retención, poda y plazo máximo de un dato borrado en las copias

Retención: 7 diarios y 4 semanales (Q3 de la decisión, 2026-11-18). La poda es mensual desde la PC (Q2 de este change,
por defecto), nunca diaria (peticiones de Object Storage). El **plazo máximo** durante el que un dato borrado (un CV,
una cuenta) sigue en alguna copia es la suma de estos términos:

| Término | Peor caso |
|---|---|
| La última instantánea que lo contiene sigue como semanal | 34 días |
| Hasta la siguiente poda (mensual) | 31 días |
| Ventana de protección `P` (versiones retenidas) | 30 días |
| **Total** | **95 días: «hasta 14 semanas»** |
| Si el destino de fuera es Drive (Q2 de la decisión en (b)): papelera (C29) | + 30 días: «hasta 18 semanas» |

Con `P` = 14 y poda mensual son 79 días («hasta 12 semanas»); con `P` = 14 y poda semanal, 55 («hasta 8 semanas»). El
número final lo fijan Q1, Q2 y la 1.1, y se escribe en **tres sitios comparados por el guardia** (C32, T-2, tarea
8.6): `infra/backup/README.md`, el aviso de `docs/RUNBOOK.md` y `/privacidad`. El aviso a los invitados de la 9.10
de 35b, que no es de este change, se comprueba con `node -e` como precondición de la fusión (12.1).

### D8. Tope de tamaño

Antes de cada pasada, `backup-push` mide el repositorio del destino y, si pasa `BACKUP_MAX_REPO_BYTES` (por defecto
**4 GiB**), la pasada falla con clase `size_cap` sin enviar nada. La medida preferida suma todas las versiones del
bucket (`ListObjectVersions`), si la credencial del host puede listarlas (C16); si no, `restic stats --mode raw-data
--json`, que no ve las versiones retenidas. Por eso 4 GiB y no 5: con el modelo V, las versiones retenidas durante `P`
días también ocupan, y el nivel gratuito de OCI es de 10 GB por nivel en cuenta de pago (H3). La revisión mensual mira
además el tamaño del bucket en la consola. El lector de objetos tiene su propio tope (D4).

### D9. Aviso: pings desde el host a un monitor gratuito

El orquestador manda `start` al empezar, éxito al terminar las dos pasadas con manifiesto y `fail` con un cuerpo de una
línea (identificador de la corrida y clase: `lock_busy`, `stack_unhealthy`, `images`, `ensure_user`,
`ensure_identity`, `mongo_dump`, `objects_read`, `objects_too_large`, `size_cap`, `push_oci`, `push_offsite`,
`manifest`, `prune_overdue`) a `BACKUP_PING_URL` (por ejemplo, healthchecks.io, plan gratuito). El monitor se
configura con un periodo de un día y un **margen de 3 horas**, y avisa por correo de una falla y de un éxito que no
llega.

- Los pings salen **del host** con `curl`, no de un contenedor: así también avisan si Docker no arranca, y la imagen de
  restic no necesita cliente HTTP.
- La dirección del monitor es un secreto (quien la tiene puede mandar éxitos falsos): `curl` la recibe por
  `--config -` en la entrada estándar, nunca en los argumentos, y el orquestador la lee de `.env.staging` sin
  `source` (solo esa clave). Es obligatoria aunque ningún compose la use, así que `check-env-file.mjs` la exige de
  forma explícita (C23).

### D10. Programación: timer de systemd del host

`infra/backup/systemd/linkvault-backup@.service` (`Type=oneshot`, `User=%i`, `Wants=` y `After=docker.service`,
`TimeoutStartSec=2h`, `ExecStart=/bin/bash /srv/linkvault-staging/infra/backup/run-backup.sh`, C13 y C27) y
`linkvault-backup@.timer` (`OnCalendar=*-*-* 06:30:00 UTC`, alrededor de las 03:30 en Argentina,
`RandomizedDelaySec=15min`, `Persistent=true`). La instancia es el nombre del usuario de despliegue. Las unidades las
instala una vez el operador con `sudo` (el usuario de despliegue no tiene `sudo`) **siguiendo solo la sección de
`infra/README.md`**, y cada paso que falte se cuenta como defecto (C18); la reconstrucción del host lo repite. El script
llega al host con cada despliegue (`config-files.txt`).

**Un solo candado (C13):** `run-backup.sh`, `restore.sh` y `restore-drill.sh` toman el mismo `flock` sobre
`/srv/linkvault-staging/.backup.lock`. **Despliegues:** `deploy.sh` no se toca (es de 35b, con sus pruebas y sus
clases de reporte); se documenta una **franja sin despliegues** de 06:15 a 08:45 UTC en `infra/README.md` y en el
runbook. Un despliegue dentro de la franja que recree `mongo` u `object-store` solo hace fallar esa corrida, con su
aviso; la siguiente noche respalda normal. `Persistent=true` puede disparar una corrida perdida **fuera de la franja**
(al arrancar el host tras un apagado): el peor caso es el mismo, una corrida fallida con aviso.

**Restaurar en `linkvault-prod` con el CD apagado (C13-b):** el procedimiento del RUNBOOK empieza con
`gh workflow disable cd-staging` y termina con `gh workflow enable cd-staging`, y `restore.sh --project
linkvault-prod` pide escribir «CD DESACTIVADO» antes de tocar nada. Un despliegue a mitad de una restauración
recrearía `api` y `worker` sobre una base a medio restaurar.

*Descartado:* un programador dentro de un contenedor (tendría que vivir siempre, con datos y salida o con el socket de
Docker); `cron` del host (no recupera una corrida perdida con el host apagado); que `deploy.sh` espere el candado (toca
un fichero de 35b para evitar una falla que ya avisa sola).

### D11. Restauración y conciliación

`infra/backup/restore.sh --project <nombre> --from oci|offsite [--run <id>] [--confirm-host]`, para el proyecto de
staging (`linkvault-prod`, vuelta atrás de datos) y para el de ensayo (`linkvault-restore`):

1. Toma el candado (D10) y ejecuta desde su copia `.backup-run-<id>/` (D4). En `linkvault-prod`, pide la
   confirmación «CD DESACTIVADO» (D10). Lee la etiqueta de la imagen de la `api` que corre en `linkvault-prod` y **falla si no es
   `sha-<12>`** (C12): el proyecto que se restaura usa ese mismo `IMAGE_TAG`, nunca `:latest`.
2. Elige la última corrida con manifiesto del destino pedido (o la pedida) y **verifica las sumas** bajando los flujos
   una vez antes de tocar nada; manifiestos o instantáneas duplicados son error.
3. Para `api` y `worker`; deja `mongo` solo, sano y con el usuario raíz del fichero de entorno (un volumen nuevo lo
   inicializa la propia imagen con él).
4. **Restaura la base dentro de `mongo` (C5):** `restic dump` en `backup-push` → tubería → `docker compose exec -T mongo`
   con un `sh -c` que escribe en el `/tmp` del contenedor un `--config` con las credenciales raíz leídas de su entorno y
   ejecuta `mongorestore --config … --archive --gzip --drop --oplogReplay --nsExclude 'admin.*'`. No se pisa
   `admin.system.users` (H7) y ninguna credencial pasa por argumentos.
5. Asegura el usuario de respaldo (D3).
6. **En este orden (D11-a):** aprovisiona los buckets (`run --rm --no-deps api node object-store.js provision`);
   asegura la identidad S3 de respaldo y comprueba que lista los dos buckets; y recarga los objetos con
   `restore-objects` (D2): `restic dump` → tubería → `tar -x` en su `tmpfs` y `rclone copy` con la identidad de la
   aplicación. El almacén cifra con la `OBJECT_STORE_SSE_KEY` del fichero de entorno: la copia guarda los objetos
   **descifrados** (cifrados por restic), así que lo que exige la misma copia de `.env.staging` es `AI_VAULT_KEY` (las
   claves BYOK de la base).
7. Reencola el outbox (D12) e imprime la conciliación: CV de la base sin objeto, objetos sin documento (con el
   procedimiento de dos pasos del RUNBOOK, «Paso 6 octies», para borrarlos), eventos reencolados por tipo, y las
   cabeceras (`Content-Type`, `Content-Length` y metadatos de usuario) de cada CV comparadas con las del manifiesto
   (C28).
8. **Paso posterior (B4):** el script termina recordando que el owner vuelva a aplicar los **borrados de cuenta o de CV
   que le consten** posteriores al volcado (por correo o por su registro): una restauración devuelve lo borrado en las
   últimas 24 h. El aviso a los invitados y `/privacidad` lo dicen.

**Destino de la restauración (C7, B6):** antes de invitar, el ensayo restaura **desde `offsite`**, el destino que
cubre la pérdida de la cuenta de Oracle y el menos ejercitado; después, cada ensayo **alterna** el destino.

**Guardia «nunca en la PC del owner» (B1):** el script se niega a usar un repositorio remoto si no existe
`/srv/linkvault-staging/.env.staging` **y** no se pasó `--confirm-host`. No mira la arquitectura (un plan B `amd64`
también es un host). Fuera del host, las pruebas de desarrollo usan un repositorio local con datos sintéticos.

### D12. Redis no se respalda; el outbox vuelve a publicar lo que estaba en vuelo

Redis guarda colas y caché. El relay solo publica los eventos con `publishedAt: null`, así que un evento **ya
publicado** cuyo job no se había consumido al volcar se pierde con Redis: un enriquecimiento que no llega, un CV que no
se extrae, un `cv-deleted` que deja un objeto huérfano (hallazgo del critic de `gestionado-gratis`).

**Decisión (C8, B2, C24):**

- La restauración pone como pendientes (`publishedAt: null`, `attempts: 0`, `nextAttemptAt` = ahora) los eventos con
  **`publishedAt ≥ mongoDumpStartedAt − W`**, donde `mongoDumpStartedAt` es el del manifiesto **del destino que se
  restaura** (C8-a) y `W` es `BACKUP_REQUEUE_WINDOW_HOURS` (por defecto **1**), sin tocar los `failed`. Así entra
  también un evento publicado mientras corría el volcado y que quedó en él como publicado. Una hora cubre de sobra la latencia normal de las colas; si la revisión de las dos semanas (11.2) mide una
  latencia máxima mayor (reintentos, diferimientos por dominio), la ventana sube a esa cifra. La latencia se mide con
  un script de un solo uso que lee los jobs completados de las colas (`finishedOn − timestamp`), y el número va a
  ADR-066 (C8-b).
- **En `linkvault-prod`, antes de reencolar**, `restore.sh` para `api` y `worker` y **recrea el volumen de Redis**: los
  jobs que quedaron en Redis corresponden a un estado posterior al volcado y no deben correr sobre la base restaurada.
- El script muestra el **recuento por tipo de evento** y pide confirmación escrita antes de reencolar; en el ensayo
  **solo cuenta** y no reencola.
- `infra/backup/requeue-outbox.sh --since <hora>` sirve suelto si se pierde solo Redis.
- **Constantes fijas (C9):** el script lleva el nombre de la colección y de los campos como constantes, y un test
  permanente de `repo-checks` las compara con `outbox-event.schemas.ts`; renombrar un campo lo hace fallar.

**Qué implica para el RPO:** el RPO de los **datos** sigue siendo 24 h. Para los **efectos**, el reencolado cubre los
eventos en vuelo al volcar. Un efecto **duplicado es esperable** (no un fallo de idempotencia) para lo consumido entre
el volcado y la pérdida: la base restaurada no guarda el rastro de ese consumo, así que un correo o un push puede salir
dos veces. Y los jobs que **no pasan por el outbox** (los programados del worker, que se registran al arrancar, y
cualquier encolado directo) no se reencolan: los programados vuelven solos; un encolado directo en vuelo se pierde.

### D13. Ensayo de restauración en el host, en un proyecto aparte

`infra/backup/docker-compose.restore.yml`, sumado con `-p linkvault-restore` al compose de producción y al del
respaldo:

- `traefik`, `web` y `worker` con `profiles: [never]`; `ports: !reset []` en `traefik` (los `ports` se suman entre
  ficheros; `!reset` exige Compose ≥ 2.24, que la tarea 6.2 comprueba en el host);
- `api` solo en sus redes internas (`networks: !reset`, sin `api-egress`);
- `mongo` con `--wiredTigerCacheSizeGB 0.5`, para que dos `mongod` quepan en 12 GB junto a staging;
- volúmenes del proyecto (`linkvault-restore_*`), nunca los de `linkvault-prod`;
- el único servicio en una red con salida es `backup-push`, sin redes de datos (C6).

`infra/backup/restore-drill.sh` toma el candado, anota la memoria libre y, de cada contenedor de `linkvault-prod`, `Id`,
`State.StartedAt` y `RestartCount` (C10); mide el tiempo total (RTO); levanta `mongo`, `redis`, `object-store` y `api`
del proyecto aparte; restaura con D11 (sin reencolar, solo cuenta); comprueba **por la API del proyecto aparte**
(`exec api` con `fetch` a `127.0.0.1:3000`) el login de la **cuenta permanente de ensayo** (C11), sus links y la
descarga de su CV; imprime la conciliación; termina con `down -v`; y falla si cambió cualquiera de los tres valores de
algún contenedor de `linkvault-prod`.

**Cuenta permanente de ensayo (C11):** una cuenta con datos sintéticos (links y un CV inventado), creada una vez en
staging, cuyo `userId` se anota en `infra/backup/README.md` y se le pasa a 35b para que su medición la excluya, como a
las cuentas E2E. Su contraseña vive en el gestor del owner y el script la lee por la entrada estándar (`read -s`).

**Calendario (B10):** el primer ensayo, **después de desplegar este change y antes de la 10.7** (fase 9 del runbook,
sobre el volumen existente, **sin** «Replace boot volume», desde `offsite`); después, **mensual los dos primeros
meses**, y luego **trimestral**, más uno **extra** cada vez que suba la imagen de `mongo` o del almacén o cambie
`infra/backup/`. Siempre en el host; **nunca** en la PC del owner. El `restic snapshots` quincenal y el `restic check`
mensual (D6) siguen igual.

**Sesión mensual (B5, ≈ 1 h):** un solo procedimiento en `docs/RUNBOOK.md`, en orden fijo: (1) verificar (`snapshots` y
`check` de cada destino, con el criterio de D6); (2) podar; (3) costo (*Cost Analysis* en 0 y tamaño de los buckets);
(4) ensayo de restauración, los meses que toca. Con las órdenes para PowerShell y para Bash y la salida esperada de cada
una.

### D14. Coordinación con 35b: specs, aviso y orden de archivo

- El delta de `platform/production-deploy` de este change **modifica dos requirements que añade 35b** («El destino de
  staging se puede reconstruir…» y «La pila de staging separa la red…»). Hoy no están en `openspec/specs`, así que
  **el PR de archivo de este change va después del archivo de 35b**. Si al archivar 35b ya hubiera cambiado su texto,
  este delta se rehace sobre el texto archivado antes de archivar. **Plazo de revisión (R11):** si a los **60 días** de
  fusionar este change 35b sigue sin archivar, se revisa ADR-066 y se decide con el owner entre esperar o archivar este
  change sin el delta de `production-deploy`, pasándoselo a 35b.
- La 9.10 de 35b (aviso a los invitados) dice «entorno desechable y sin copias». Este change **no** edita 35b: la tarea
  8.5 deja la nota para su sesión, con el texto nuevo, y **«9.10 de 35b enmendada» es precondición de la fusión** (D1).
- **Este change sí edita el aviso de `docs/RUNBOOK.md`** (C17), que no es de 35b.
- La línea «Fuera: copias de seguridad de datos (staging es desechable)» del `scope` de `staging-host` en
  `openspec-changes.yaml` se anota en el PR de fusión de este change (tarea 8.5), no antes, para no chocar con el PR-2
  de 35b.
- **Registro de afirmaciones (C17):** una entrada `staging-sin-copias` (ADR-048 §5) con patrones **afirmativos y
  específicos** («staging es desechable», «sus datos no tienen copia», «entorno desechable y sin copias», «no hay
  copias de seguridad de datos») sobre `infra/README.md`, `docs/RUNBOOK.md`, `docs/despliegue/RUNBOOK-DESPLIEGUE.md` y
  `apps/web/src`, con `infra/backup/run-backup.sh` como símbolo que la desmiente. `DECISION-DESPLIEGUE.md` queda fuera:
  es un registro histórico.

### D15. El despliegue de este change recrea `mongo` y `object-store`

Unir `mongo` a `data-backup` y `object-store` a `store-backup` cambia su configuración: el `up` del despliegue los
**recrea** (sin tocar sus volúmenes), y con ellos se reinician `api` y `worker`. Es un corte de uno o dos minutos. Va
dentro de la ventana de D1, con el smoke del despliegue y la 9.4 de `e2e-suite` después. Volver atrás es la vuelta
atrás de código de 35b: las redes nuevas sobran sin efecto.

### D16. Variables y secretos

| Variable | Dónde | Formato |
|---|---|---|
| `MONGO_BACKUP_USER`, `MONGO_BACKUP_PASSWORD` | `docker-compose.prod.yml` (servicio `mongo`, `${VAR:?}`) y el del respaldo | Apto para URI, como D18 |
| `S3_BACKUP_ACCESS_KEY`, `S3_BACKUP_SECRET_KEY` | compose del respaldo; **no existen** con la variante efímera de D3 | Como `S3_ACCESS_KEY` |
| `RESTIC_PASSWORD` | compose del respaldo | ≥ 32 caracteres, `openssl rand -hex 32` |
| `BACKUP_OCI_REPOSITORY`, `BACKUP_OCI_ACCESS_KEY_ID`, `BACKUP_OCI_SECRET_ACCESS_KEY` | compose del respaldo | `s3:https://…` |
| `BACKUP_OFFSITE_*` | compose del respaldo | Nombres finales tras Q2 (tarea 1.2) |
| `BACKUP_PING_URL` | solo el host (`run-backup.sh`); obligatoria explícita en `check-env-file.mjs` | `https://…` |
| `BACKUP_MAX_REPO_BYTES`, `BACKUP_OBJECTS_MAX_BYTES`, `BACKUP_REQUEUE_WINDOW_HOURS` | compose del respaldo, con defecto | Enteros |

Todas en `.env.staging` y en su copia fuera del host (regla de 35b 5.8); **`RESTIC_PASSWORD` sin copia no hay
respaldo que valga**. La credencial de poda, solo en el gestor de contraseñas del owner. `.env.example` lleva valores
ficticios; `infra/ci/verify.env`, relleno para `MONGO_BACKUP_*`; `check-env-file.mjs` recibe el compose del respaldo
como **cuarto argumento** opcional (C23), lee sus `${VAR:?}` y aplica los formatos.

## Risks / Trade-offs

- **[R1] La identidad S3 de solo lectura puede no existir sin cambiar la configuración del almacén o sin degradar la de
  la aplicación.** → Tareas 1.7a y 1.7b antes de nada, con los seis criterios de D3; si fallan, Q3.
- **[R2] OCI o el destino de fuera pueden no admitir el modelo V.** → Tareas 1.5a (primero) y 1.5b; el modelo R solo si
  restic funciona con él; si ninguno, el destino no es apto y vuelve al owner.
- **[R3] Peticiones de OCI Object Storage (50.000 al mes).** Una corrida son decenas a cientos de peticiones por
  destino; la tarea 10.7 las mide en la consola tras una semana y la revisión de las dos semanas las vuelve a mirar.
- **[R4] Un atacante con el host manda pings de éxito falsos y oculta copias.** → `restic snapshots` quincenal desde la
  PC (≤ `P` − 7 días) y procedimiento «Recuperar tras un borrado».
- **[R5] Plazo largo de los datos borrados en las copias (hasta 14 semanas por defecto, 18 con Drive).** → Escrito en
  `/privacidad` y en el aviso; acortarlo es Q1 y Q2.
- **[R6] Efectos duplicados tras restaurar** para lo consumido entre el volcado y la pérdida. → Aceptado y escrito
  (D12); confirmación por tipo antes de reencolar; el ensayo no reencola.
- **[R7] Dos `mongod` en 12 GB durante el ensayo.** → Caché de 0,5 GB en el proyecto aparte y memoria libre anotada.
- **[R8] `tmpfs` y swap.** → Tarea 2.2: sin swap o swap cifrada; si no, se decide antes de desplegar.
- **[R9] Con Drive (Q2 b) la copia de fuera no tiene borrado protegido.** → Q4.
- **[R10] Los lectores y el cargador de objetos amplían el riesgo residual del almacén.** → Sin salida, efímeros, imagen
  fijada (D2).
- **[R11] El archivo depende del archivo de 35b.** → D14, con revisión a los 60 días.
- **[R12] La imagen de restic ve los datos en claro antes de cifrarlos.** → Imagen oficial fijada por digest y
  comprobada por plataforma; escrito en ADR-066.
- **[R13] Una restauración devuelve borrados de las últimas 24 h.** → Paso posterior del owner (D11, paso 8) y aviso.

## Migration Plan

1. 1.5a primero; después el resto del grupo 1 (destinos, monitor, 1.7a y 1.7b), en paralelo a 35b: no tocan `main`.
2. Implementación en la rama del change; pruebas con pila local y repositorio local con datos sintéticos.
3. Antes de fusionar: secretos en `.env.staging` y su copia (10.1) y 9.10 de 35b enmendada.
4. Fusión en la ventana de D1 (después de la 11.6, antes de la 10.7); despliegue normal (D15).
5. Unidades instaladas siguiendo solo el README; primer respaldo a mano; dos noches seguidas; falsaciones en el host
   (fase 8 del runbook).
6. Ensayo de restauración en el host desde `offsite` (fase 9), con RTO anotado.
7. Recién entonces, la 10.7 de 35b.

**Vuelta atrás:** revertir el PR deja la pila sin las redes del respaldo (recrea `mongo` y `object-store` otra vez) y el
timer fallando con aviso hasta que se desactive (`systemctl disable --now`). Los respaldos ya hechos siguen en los
destinos y se pueden restaurar con el `restore.sh` del commit anterior a la reversión.

## Open Questions

Las Q1-Q6 de la decisión de despliegue están respondidas (2026-11-18). Estas son nuevas, de este change:

**Q1. Ventana de protección `P` del borrado.** **[no bloqueante; el change trae 30 días por defecto]**
(a) 30 días; (b) 14 días; (c) 7 días. Menos días acortan el plazo de los datos borrados (D7) y lo que ocupan las
versiones, y obligan a verificar más seguido (cada ≤ `P` − 7 días: con 14, semanal; con 7, no hay margen).
**Recomendación: (a).**

**Q2. Dónde y cada cuánto se poda.** **[no bloqueante; por defecto (a)]**
(a) Mensual, desde la PC del owner, en la sesión mensual; (b) semanal, desde la PC (plazo de D7 más corto, una tarea
más por semana); (c) semanal, con un workflow programado de GitHub Actions y la credencial de poda como secreto del
repositorio (automático, pero junta en GitHub la credencial que destruye los respaldos con la clave SSH que da root en
el host). **Recomendación: (a).**

**Q3. Si no hay identidad S3 de solo lectura que cumpla los siete criterios de D3.** **[bloqueante solo si fallan la
1.7a o la 1.7b]**
(a) Adoptar la configuración del almacén que la dé y repetir las celdas de la matriz (ADR-052 §2); (b) aceptar por
escrito que el lector de objetos use la identidad de la aplicación (sin salida, efímero). Como la identidad de solo
lectura evita escrituras por error pero no contiene a un lector comprometido (D3), (b) pierde poco. **Recomendación
(C19-b, B8): (b), aceptada por escrito, si fallan los criterios; (a) solo si la configuración que la da no cambia
`command` del almacén y la repetición cabe en un día.**

**Q4. Si el destino de fuera de Oracle es Google Drive.** **[bloqueante solo si Q2 de la decisión cae en (b)]**
(a) Aceptar por escrito que esa copia no tiene borrado protegido frente al host (la de OCI sí lo tiene) y que suma 30
días de papelera al plazo de D7; (b) seguir buscando un destino (a). **Recomendación: (a)**: Drive cubre la pérdida de
la cuenta de Oracle, que es su función.

**Q5 (propuesta, B7). Si la 1.1 termina en (a), ¿un solo destino?** **[no bloqueante; reabre la respuesta del owner a
Q2 de la decisión, por eso es una propuesta]**
(a) Mantener los dos destinos, como respondió el owner; (b) quedarse solo con el destino de fuera de Oracle, que ya
cubre la pérdida del host y de la cuenta, y simplificar la sesión mensual y las peticiones. **Recomendación: (a)**: dos
proveedores independientes significan que perder una cuenta o un proveedor no deja sin copia; el costo es configuración
y la mitad de la sesión quincenal, que es de 5 minutos.

## Respuestas del owner y aprobación

- **2026-11-18, decisión de despliegue:** Q1 (a), Q2 (a) si se verifica y si no (b), Q3 (a), Q4 (a) con revisión a las
  dos semanas, Q5 (a) y si no hay respuesta en una semana (b), Q6 (a). «Toma las recomendaciones».
- **Q1-Q5 de este change:** 2026-11-18: «Aprobado», con las recomendaciones. Q1 (a), P = 30 días; Q2 (a), poda mensual desde la PC; Q3: si fallan los criterios, (b) aceptada por escrito, y (a) solo si no cambia `command` y cabe en un día; Q4 (a), Drive sin borrado protegido; Q5: mantener los dos destinos.
- **Debate critic/business/reflect:** iteraciones 1 y 2 aplicadas (abajo); convergencia en la 2. **Aprobación del owner: 2026-11-18** («Aprobado»).

## Debate iteración 1 (2026-11-18)

Critic: 2 P0, 18 P1, 12 P2. Business: 0 V0. Reflect de la sesión principal: aceptados todos. Sin «Convergencia»: había
P0 abiertos al empezar la iteración.

| id | Decisión | Motivo |
|---|---|---|
| C1 (P0) | `logging: none` en todo servicio del respaldo y la restauración; `backup-isolation` lo exige; 2.5 y 10.5 lo comprueban con `docker inspect` y sin fichero de log | Con `json-file`, la salida estándar (el volcado) queda en claro en `/var/lib/docker` (D2) |
| C2 (P0) | Criterios 5 y 6 en 1.7a/1.7b, 3.2 y 10.5; si fallan, Q3 | Crear una identidad podría degradar la de la aplicación (D3) |
| C3 | Redacción «ningún proceso puede consultar los datos y además salir»; riesgo de la imagen de restic en ADR-066 | `backup-push` ve el flujo en claro (D2, R12) |
| C4 | Guardia sobre `config --format json` en CI, ficheros crudos fuera de CI; reglas de redes explícitas, sin `network_mode`, `default` ni `ports`; redes de datos internas | Lo resuelto por Compose es lo que corre (D2) |
| C5 | `mongorestore` con `exec -T mongo` y `--config` en su `/tmp`; servicio `restore-objects` aparte | Sin escritor de datos con credenciales en argumentos; el cargador, declarado y vigilado (D11, D2) |
| C6 | El escenario del override nombra la excepción de `backup-push` | Precisión del escenario (spec) |
| C7 = B6 | `restore.sh --from oci\|offsite`; primer ensayo desde `offsite`, después alterna; `restic check` mensual por destino | Ejercitar el destino que cubre la pérdida de la cuenta (D11, D6) |
| C8 + B2 + C24 | Ventana de 1 h (o la latencia máxima medida); Redis recreado en `linkvault-prod`; recuento por tipo y confirmación; el ensayo solo cuenta; texto de duplicados corregido; prueba con un Redis que ya tenía el job | El reencolado amplio duplicaba efectos (D12) |
| C9 | Constantes fijas y test contra `outbox-event.schemas.ts` | Acoplamiento con el esquema, vigilado (D12) |
| C10 | Se comparan `Id`, `State.StartedAt` y `RestartCount` | `CreatedAt` no ve un reinicio (D13) |
| C11 | Cuenta permanente de ensayo sintética, excluida de la medición de 35b; contraseña por la entrada estándar | Comprobación repetible sin datos reales (D13) |
| C12 | `restore.sh` toma la etiqueta `sha-<12>` de la `api` de staging o falla | Nunca `:latest` (D11) |
| C13 | `ExecStart=/bin/bash`; `main(){…}; main "$@"`; candado común; franja sin despliegues documentada (sin tocar `deploy.sh`) | Scripts reemplazados en caliente y corridas solapadas (D4, D10) |
| C14 | 10.1 es precondición de la fusión, con la fase 3 del runbook | El compose exige `MONGO_BACKUP_*` (D1) |
| C15 | Cinco falsaciones en 1.5a/1.5b; «Recuperar tras un borrado»; `snapshots` quincenal (≤ `P` − 7) | La protección se mide y se usa (D6) |
| C16 | Retención no bloqueada, que quita el owner y no la credencial del host; regla de corte 4; tope con `ListObjectVersions` si se puede | Poder borrar el recurso ante un cargo (D6, D8) |
| C17 | Patrones afirmativos y específicos; `DECISION` excluida; este change edita el aviso de `docs/RUNBOOK.md`; «9.10 enmendada» en 12.1 | Evitar falsos positivos y huecos (D14) |
| C18 | 10.3 sigue solo el README y cuenta defectos; requirement redactado así | La programación es parte de la reconstrucción (D10, spec) |
| C19 | Solo la API IAM, con excepción acotada en `platform/object-store`; `weed shell` descartado | `weed shell` es CLI del producto dentro del almacén (D3) |
| C20 | 1.7, 3.3, 6.4 y 6.6 partidas | Tareas de menos de una hora |
| C21 | 4.7a comprueba `-T` y `--no-deps` | Sin `-T` la tubería se corrompe; sin `--no-deps`, `run` toca la pila |
| C22 | Runbook alineado (margen 3 h, modelo V, `run-backup.sh`, «Publicar una actualización») en 8.3 | Coherencia de nombres |
| C23 | Cuarto argumento de `check-env-file.mjs`; `BACKUP_PING_URL` obligatoria explícita | No está en ningún compose (D9, D16) |
| C25 | Falsaciones de 4.4 y 6.1 con datos grandes y suma alterada; duplicados son error | Un corte a mitad con datos chicos no se ve (D4) |
| C26 | Pull y comprobación de plataformas de las imágenes del respaldo | Sin el despliegue, nadie las comprobaba (D4) |
| C27 | `TimeoutStartSec=2h`, `After=docker.service` y espera de salud | Corrida al arrancar el host (D10, D4) |
| C28 | Cabeceras del CV comparadas al restaurar | Un CV sin `Content-Type` no se descarga bien (D11) |
| C29 | Papelera de Drive suma 30 días al plazo | Plazo honesto (D7) |
| C30 | El proyecto es `linkvault-prod` | Nombre real del compose |
| C31 | `backup-push` no alcanza la dirección de metadatos | Es el único con salida del respaldo (2.5, 10.5) |
| C32 | Guardia del plazo en semanas en los cuatro sitios | El número no puede divergir (D7) |
| R11 | Revisión a los 60 días si 35b sigue sin archivar | Plazo para no quedar colgado (D14) |
| B1 | Guardia: `.env.staging` del host o `--confirm-host`, sin mirar la arquitectura | Un plan B `amd64` también es host (D11) |
| B3 | `prune_overdue` a los 65 días sin cortar el respaldo | Recordatorio de la sesión mensual (D4) |
| B4 | Paso posterior: el owner reaplica los borrados que le consten; el aviso lo dice | Una restauración devuelve borrados (D11) |
| B5 | Sesión mensual única en la 8.2, orden fijo, PowerShell y Bash, criterio simple | Operable por una persona (D13) |
| B7 | Q5 como propuesta | Reabre una respuesta del owner |
| B8 | Q3 recomienda (a) solo si cabe en 1 día | Costo de la matriz |
| B9 | En la PC solo `snapshots`, `forget --prune`, `stats`, `check` | Nunca datos en claro en la PC (D6) |
| B10 | Ensayo mensual dos meses, después trimestral más extras | Carga sostenible (D13) |
| B11 | La 1.1 corta a los 7 días o a las 3 h de búsqueda | Acotar el esfuerzo del owner |
| B12 | Alcance `drive.file` | Mínimo privilegio (D5) |
| B13 | `/privacidad` con los cuatro puntos | Aviso honesto (spec `web/privacy`) |
| B14 | La 1.3 sigue design D6, no la fase 8 paso 2 | El runbook es anterior al design |
| Nota business | 1.5a primero en el grupo 1 | Si OCI no admite V, cambia el reparto |

## Debate iteración 2 (2026-11-18)

Critic: 0 P0 (C1 y C2 cerrados), 16 P1. Reflect de la sesión principal: aceptados todos.

| id | Decisión | Motivo |
|---|---|---|
| C1-a | Tarea 1.8 antes del grupo 2: 64 MiB aleatorios en `tmpfs` con `logging: none`, misma suma dentro y por `run -T … \| sha256sum`, `LogPath` vacío y `docker logs` con error; la 2.5 deja la comparación con `mongodump`; D2 dice «medido en 1.8» | El transporte sin registros era un supuesto |
| C1-b | La 4.7a emite un marcador binario y exige que no aparezca en la salida de `run-backup.sh`; falsación con `tee`; `set -x` prohibido | El orquestador tampoco puede filtrar datos a systemd |
| C2-a | `object-store.js verify` tras `ensure-backup-identity` en cada corrida, `fail ensure_identity` urgente; orden de la 10.4; «Revertir la identidad de respaldo» probada en la 1.7b | Detectar y deshacer una degradación de la identidad de la app |
| C19-a | Criterio 7: clave fijable desde el entorno o variante efímera (sin `S3_BACKUP_*`); si no, Q3 | El almacén puede generar la clave él |
| C19-b | Alcance escrito: evita escrituras por error, no contiene un lector comprometido; Q3 reformulada | gRPC del filer sin autenticación |
| C19-c | Servicio `backup-identity` declarado (cliente SigV4 `arm64`, `store-backup`, `logging: none`, sin salida), en el guardia, C26, 2.2 y 2.3 | El proceso que asegura la identidad también es un miembro de la red del almacén |
| D11-a | Restaurar: `provision` → identidad → recarga; 6.1b y 6.4a verifican que la identidad lista los dos buckets | Sobre un almacén nuevo la identidad no existe hasta aprovisionar |
| D3-a | Script de `mongosh` por la entrada estándar, medido en 3.1, sin montajes nuevos | No cambiar el servicio `mongo` |
| C13-a | Copia a `.backup-run-<id>/` al tomar el candado; `main "$@"; exit $?` comprobado en 4.7a | Un despliegue reemplaza ficheros a mitad de corrida |
| C13-b | Restaurar en `linkvault-prod` con `gh workflow disable/enable cd-staging` y confirmación «CD DESACTIVADO»; `Persistent` fuera de la franja anotado | Un despliegue durante una restauración |
| C8-a | Manifiesto por destino con `mongoDumpStartedAt`/`mongoDumpFinishedAt`; ventana `publishedAt ≥ mongoDumpStartedAt − W`; caso de un evento publicado durante el volcado | La ventana se contaba desde una hora posterior al volcado |
| C8-b | La 11.2 mide la latencia con `finishedOn − timestamp` de los jobs completados; número en ADR-066 | Fijar `W` con un dato |
| T-1 | 2.5 partida (registros a 1.8), 6.1 en a/b, 8.2 en a/b/c | Tareas de menos de una hora |
| T-2 | D7: tres sitios comparados por el guardia; la 9.10 de 35b con `node -e` en la 12.1 | El aviso de 35b no es de este change |
| T-3 | La 10.1 usa la invocación con contenedor de la fase 3.4 del RUNBOOK, con el cuarto argumento | Es la forma documentada en el host |

**Convergencia: SI** (critic P0 0, business V0 0).
