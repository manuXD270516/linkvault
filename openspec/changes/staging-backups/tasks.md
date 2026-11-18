> **Cómo leer este fichero.** Tarea C1 de `docs/despliegue/DECISION-DESPLIEGUE.md`. Cada tarea cabe en **menos de una
> hora**, lleva su etiqueta y dice qué se ejecuta para cerrarla. Las del owner llevan `[infra]` y empiezan por
> «**Owner:**». Un **guardia permanente** (comprobación de `repo-checks`, prueba de un script) se rompe a mano, se ve
> fallar y se restaura en la misma tarea (ADR-048 §7). La documentación se verifica con un `node -e` de un solo uso que
> busca las afirmaciones concretas. Para contar coincidencias se usa `node`, no `grep -c`, y `nx` nunca va por tubería.
> Ningún secreto se escribe en el repositorio, en un comando guardado ni en el chat: las órdenes que los necesitan los
> leen del entorno o de la entrada estándar.
>
> **Ventana:** nada de este change se fusiona a `main` antes de la 11.6 de 35b ni después de su 10.7 (design D1). El
> grupo 1 y la implementación en la rama corren en paralelo a 35b; el grupo 10, salvo la 10.1, es después de fusionar.
>
> **«Qn»** es una pregunta de este change (design, Open Questions); **«Qn de la decisión»**, una de
> `DECISION-DESPLIEGUE.md`, ya respondida el 2026-11-18. El proyecto de Compose de staging es `linkvault-prod`.

## 0. Antes de aplicar

- [ ] 0.1 [infra] Q1-Q5 del design respondidas por el owner, o aceptados sus valores por defecto (Q1, Q2 y Q5 no
  bloquean; Q3 solo si fallan la 1.7a o la 1.7b; Q4 solo si la 1.1 termina en (b)), y anotadas con fecha en design.md
  («Respuestas del owner y aprobación») y en ADR-066 («Respuestas del owner»). Con Q1, Q2 y la 1.1 cerradas, el plazo
  máximo de D7 queda fijado como número de semanas. Verificar con `node -e` que la línea «Q1-Q5 de este change:» de
  design.md y la línea «Q1-Q5 del change:» de ADR-066 ya no dicen «pendientes» y llevan una fecha `2026-`.
- [ ] 0.2 [infra] Debate critic/business/reflect (`/lv:debate`) cerrado sin P0/V0 abiertos y aprobación humana
  registrada en design.md con su fecha; ADR-066 sigue «Propuesto» hasta el archivo. Verificar: la sección del debate
  de la última iteración dice «Convergencia: SI».
- [x] 0.3 [infra] ADR-066 «Propuesto» y sus anotaciones de una línea en ADR-051 §2, ADR-048 §Consecuencias (excepción)
  y ADR-052 (riesgo residual del almacén); fila del change en `openspec-changes.yaml` y en `docs/design-v0.2.md` §6.
  Verificar con `node -e` que ADR-051, ADR-048 y ADR-052 contienen `](ADR-066.md)`, que `openspec-changes.yaml`
  contiene `name: staging-backups` y que `openspec validate --all --strict` pasa. **Estado (2026-11-18): hecha** con la
  spec del change.

## 1. Destinos, monitor y mediciones previas (design D3, D5, D6, D9)

**Orden del grupo** (nota de business): 1.3 → **1.5a** → 1.1 → 1.2 → 1.4 → 1.5b → 1.6 → 1.7a → 1.7b. Si la 1.5a dice
que OCI no admite el modelo V, se para y vuelve al owner antes de buscar el destino de fuera.

- [ ] 1.3 [infra] **Owner:** en OCI, siguiendo **design D6** (no la fase 8, paso 2 del runbook, que es anterior; B14):
  bucket **privado**, nivel Standard, con versionado, retención de `P` días **sin bloquear** y regla de ciclo de vida
  que expira las versiones no actuales a `P + 1` días; un usuario IAM dedicado con una política limitada a ese bucket
  **sin** borrar versiones, suspender el versionado, cambiar el ciclo de vida ni tocar la retención, y su *Customer
  Secret Key* (credencial del host); y otra credencial, la de poda, solo en el gestor de contraseñas. Antes de crear
  nada, el estimador de costos en 0 (regla de corte 3). Verificar: el owner confirma en el chat «bucket OCI creado,
  privado, modelo V, retención sin bloquear, dos credenciales», sin nombres de bucket, espacio de nombres ni región.
- [ ] 1.5a [infra] Medir el modelo de protección en **OCI** (design D6), con un repositorio restic de **prueba** (clave
  de prueba, datos sintéticos de 1 MiB) y las credenciales que el owner carga en el entorno de la sesión sin
  mostrarlas. Con la credencial del host: `restic backup`, `restic check` y `restic snapshots` terminan en 0, y dos
  `backup` seguidos no dejan bloqueos que impidan el tercero. **Cinco falsaciones** con la credencial del host (C15):
  borrar de forma definitiva un paquete de `data/`; borrarlo con su `versionId`; suspender el versionado; cambiar el
  ciclo de vida; acortar o quitar la retención. Cada una falla, o el paquete sigue recuperable listando versiones. Con
  la credencial de poda: `restic forget --keep-last 1 --prune --max-unused unlimited --no-cache` termina en 0. Y si la
  credencial del host puede listar versiones (`ListObjectVersions`), anotarlo para D8. Verificar: tabla «Medido» en
  design D6 con destino, modelo y resultado de cada orden, sin nombres de bucket ni cuenta. Al terminar, borrar el
  repositorio de prueba con la credencial de poda (o anotar que caduca con la retención).
- [ ] 1.1 [infra] **Owner:** verificar el destino (a) de Q2 de la decisión: un almacenamiento de objetos fuera de Oracle
  con plan gratuito. Criterios, todos obligatorios: (1) alta **sin tarjeta**, o con tope duro en 0 escrito por el
  proveedor; (2) API compatible con S3 que restic usa; (3) **bloqueo de objetos o retención**, con versionado y regla de
  ciclo de vida para versiones no actuales (modelo V de D6) o retención sin versionado (modelo R); (4) claves con
  permisos acotados por bucket y **sin** borrado de versiones; (5) plan gratuito de al menos 2× el tope de D8.
  **Criterio de corte (B11):** a los **7 días naturales** desde que empieza esta tarea **o a las 3 horas de búsqueda
  acumuladas**, lo primero que llegue, si ningún candidato cumple los cinco, se pasa a (b). Si el candidato pide una
  cuenta con datos personales más allá del correo, o tiene costo posible, decide el owner antes de seguir. Verificar:
  una línea en ADR-066 «Destino fuera de Oracle (Q2 de la decisión), AAAA-MM-DD: (a) <proveedor> | (b) Google Drive
  dedicado», con los cinco criterios marcados y **sin** datos de la cuenta.
- [ ] 1.2 [infra] **Owner (solo si 1.1 terminó en (b)):** cuenta de Google **dedicada** al respaldo, no la personal;
  cliente OAuth propio **publicado** (no «en pruebas», para que el token no venza a los 7 días) con el alcance
  **`drive.file`** (B12); carpeta dedicada. Claude diseña en esta tarea el `rclone serve restic` efímero de D5 y fija
  los nombres de `BACKUP_OFFSITE_*`. Verificar: Q4 respondida (0.1), los nombres de las variables escritos en design
  D16 y el plazo de D7 con la papelera sumada.
- [ ] 1.4 [infra] **Owner:** el destino de fuera (el de 1.1 o 1.2) con las mismas dos credenciales: la del host, sin
  borrado definitivo ni cambios de protección, y la de poda, solo en el gestor de contraseñas. Verificar: confirmación
  del owner en el chat con la misma forma que 1.3.
- [ ] 1.5b [infra] La misma medición de 1.5a, con sus cinco falsaciones, en el **destino de fuera de Oracle**. Con Drive
  (Q2 de la decisión en (b)), las falsaciones de borrado **se espera que no fallen** y se anotan como el riesgo de Q4.
  Verificar: su fila en la tabla «Medido» de design D6.
- [ ] 1.6 [infra] **Owner:** monitor de pings en un servicio gratuito (por ejemplo healthchecks.io), con periodo de un
  día, **margen de 3 horas** y aviso por correo; su dirección será `BACKUP_PING_URL`. Verificar: el owner confirma
  «monitor creado, periodo 1 d, margen 3 h» y que mandó un ping de prueba desde su PC y lo vio en el panel; la dirección
  no se pega en el chat.
- [ ] 1.7a [infra] Medir la identidad S3 de solo lectura por la **API IAM** de la pasarela de SeaweedFS 4.47 `mini`
  con `-disableHttp` (design D3, C19), en una pila local (el compose de producción con `infra/ci/verify.env`), desde un
  contenedor de un solo uso en la red del almacén con la identidad de la aplicación. Criterios 1-4 de D3: sin fichero
  con secreto montado; sin cambio de `command`, `environment` ni volumen del servicio; la identidad sobrevive a
  `docker compose restart object-store`; con ella `ListObjectsV2` y `GetObject` funcionan en los dos buckets y
  **(falsación)** `PutObject` y `DeleteObject` fallan con `AccessDenied`. Verificar: salida anotada en design D3
  («Medido»). `weed shell` no se prueba (descartado en D3).
- [ ] 1.7b [infra] Criterios 5 y 6 de D3 (C2) sobre la misma pila: guardar el listado de identidades antes; asegurar la
  identidad; `docker compose restart object-store`; `run --rm --no-deps api node object-store.js verify` sale 0;
  `PutObject` y `DeleteObject` con la identidad de la **aplicación** funcionan; el listado de identidades después
  difiere del de antes **solo** en la del respaldo (comparado con `node`). Verificar: salidas anotadas en design D3. Si
  falla cualquiera de los seis criterios, Q3 pasa a bloqueante y el grupo 3 espera su respuesta.

## 2. Redes y servicios del respaldo (design D2)

- [ ] 2.1 [infra] En `docker-compose.prod.yml`: redes `data-backup` y `store-backup` (`internal: true`), `mongo` en
  `data-backup` y `object-store` en `store-backup`; la tabla de redes del comentario de cabecera, actualizada. Verificar:
  `docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config --format json` volcado a fichero y
  leído con `node`: `data-backup` y `store-backup` con `internal: true`; `mongo` en `data-api`, `data-worker` y
  `data-backup`; `object-store` en `store-api`, `store-worker` y `store-backup`; ningún otro servicio de ese fichero en
  ellas.
- [ ] 2.2 [infra] `infra/backup/docker-compose.backup.yml` con `backup-mongo`, `backup-objects`, `backup-push` y
  `restore-objects` como la tabla de D2: imágenes fijadas por digest, **`logging: { driver: none }` en los cuatro**
  (C1), `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `networks` explícitas, sin `ports`, `tmpfs` con
  tamaño (`BACKUP_OBJECTS_MAX_BYTES` en los de objetos), red `backup-egress` definida aquí, y los scripts de
  `infra/backup/` montados en solo lectura. En el host, `swapon --show` vacío o swap cifrada (D4, R8). Verificar:
  `config --format json` de los dos ficheros juntos, leído con `node`, con redes y `logging` de cada servicio como la
  tabla; y `bash infra/deploy/check-image-platforms.sh --platform linux/arm64 <las imágenes>` sale 0.
- [ ] 2.3 [infra] Comprobación permanente `tools/repo-checks/src/backup-isolation.check.mjs`, sumada al agregador, con
  las reglas de D2 (C4): en CI lee `config --format json` de los ficheros con `infra/ci/verify.env` volcado a fichero;
  fuera de CI y sin `docker`, los ficheros crudos. Verificar: `bash infra/ci/repo-checks.sh` en verde con una
  comprobación más. **Falsaciones**, cada una sobre el fichero y restaurada: `backup-mongo` también en `backup-egress`
  → falla nombrando servicio y red; `worker` en `store-backup` → falla; `backup-push` en `data-backup` → falla; quitar
  `networks` a `backup-mongo` → falla; quitar `logging` a `backup-objects` → falla; `internal: true` fuera de
  `data-backup` → falla.
- [ ] 2.4 [infra] `infra/deploy/config-files.txt` suma `infra/backup/docker-compose.backup.yml`,
  `infra/backup/docker-compose.restore.yml` y los scripts de `infra/backup/` que se ejecutan en el host. Verificar con
  `node -e` que cada fichero de la lista existe en el árbol y que el guardia de `repo-checks` sobre la lista (si 35c ya
  lo trajo) sigue en verde.
- [ ] 2.5 [infra] Prueba de aislamiento y de registros en una pila local con los dos ficheros: con `backup-mongo` en
  marcha (`run -d` con `sleep`), resolver `api` y abrir `https://example.com` fallan y `mongo:27017` responde; desde
  `backup-push`, resolver `mongo`, `object-store` y `api` falla, la salida HTTPS responde y `http://169.254.169.254/`
  termina en error de conexión o de plazo (C31; en local se anota que la regla es del host, 12.7 de 35b); desde
  `worker`, resolver `backup-mongo` falla. Registros (C1): `docker inspect` de cada contenedor del respaldo da
  `HostConfig.LogConfig.Type = none` y `LogPath` vacío, y una tubería `run -T backup-mongo … | sha256sum` da la misma
  suma que el volcado hecho dentro del contenedor (la conexión funciona sin registros). Verificar: las salidas,
  anotadas en el PR; los contenedores de prueba borrados (`docker ps -a` sin `backup-*`).

## 3. Credenciales de solo lectura (design D3)

- [ ] 3.1 [infra] `infra/backup/ensure-backup-user.js` (script de `mongosh`) y su invocación por
  `docker compose exec -T mongo mongosh --quiet --file …`: autentica como raíz y crea o actualiza `MONGO_BACKUP_USER`
  con el rol `backup`, todo desde `process.env`; `MONGO_BACKUP_USER` y `MONGO_BACKUP_PASSWORD` en el entorno del
  servicio `mongo` con `${VAR:?}`, y relleno en `infra/ci/verify.env`. Verificar en la pila local: dos ejecuciones
  seguidas terminan en 0; `mongodump --archive` con ese usuario termina en 0; con un volumen creado **antes** del cambio
  (sin el usuario), la primera ejecución lo crea. **Falsación:** un `insertOne` con el usuario de respaldo falla con
  `Unauthorized`; cambiar la contraseña en el entorno y repetir deja la nueva vigente (la vieja falla).
- [ ] 3.2 [infra] `infra/backup/ensure-backup-identity.sh` con el mecanismo de 1.7a, idempotente, invocado en cada
  corrida y restauración, desde un contenedor de un solo uso sin salida y sin registros. Verificar en la pila local los
  **seis** criterios de D3: dos ejecuciones terminan en 0; con `S3_BACKUP_*`, listar y leer un objeto de cada bucket
  funciona; tras `restart object-store` sigue funcionando; `object-store.js verify` sale 0; la aplicación sube y borra;
  el listado de identidades difiere solo en la del respaldo. **Falsación:** `PutObject` y `DeleteObject` con la
  identidad de respaldo fallan; si se le da escritura a mano, la prueba lo detecta (restaurar).
- [ ] 3.3a [infra] Si el mecanismo cambió la configuración del servicio `object-store` (criterio 2 de D3): repetir C3-C5
  de `docs/object-store-matrix/matriz.md` sobre ella y anotarlas. Si no la cambió, anotar en ADR-052 «Consecuencias
  para 35b y 35c» que la configuración medida no cambió y cerrar también la 3.3b. Verificar con `node -e` que la
  anotación existe.
- [ ] 3.3b [infra] Solo si la 3.3a repitió celdas: C7-C9 sobre la misma configuración, anotadas como la 12.3 de 35b.
  Verificar con `node -e` que la matriz tiene las seis celdas con la fecha.

## 4. Corrida de respaldo (design D4, D5, D8, D9)

- [ ] 4.1 [infra] Esqueleto de `infra/backup/run-backup.sh`: todo dentro de `main() { … }` y `main "$@"` al final
  (C13); `set -euo pipefail`; `flock` no bloqueante sobre `/srv/linkvault-staging/.backup.lock` (o el directorio que
  reciba); lectura de `BACKUP_PING_URL` desde `.env.staging` sin `source` (solo esa clave); `ping start|success|fail
  <clase>` con `curl --config -` por la entrada estándar y plazo de 10 s; identificador de corrida UTC; `trap` que
  manda `fail` con la última clase; espera de salud de `mongo` y `object-store` (10 minutos, `stack_unhealthy`) y
  `pull` + `check-image-platforms.sh` de las imágenes del respaldo (`images`) (C26, C27); todas las órdenes `run` con
  `--rm --no-deps -T`. Verificar con la prueba de 4.7a.
- [ ] 4.2 [infra] Pasada de la base (D4, paso 1): `ensure-backup-user`, después `run backup-mongo` con
  `mongodump --config <tmpfs> --archive --gzip --oplog` → `tee` a `sha256sum` y contador de bytes en el host →
  `run backup-push` con `restic backup --stdin --stdin-filename mongo.archive.gz` y las etiquetas de D4. Verificar en
  la pila local con un repositorio restic **local** montado en `backup-push`: `restic snapshots --tag kind:mongo` lista
  una; `restic dump` de ella tiene la misma suma que el host calculó.
- [ ] 4.3 [infra] Pasada de los objetos (D4, paso 2): `ensure-backup-identity`, después `run backup-objects` con
  `rclone copy` de los dos buckets al `tmpfs` y `tar -c` a la salida estándar → `tee` → `backup-push` con
  `objects.tar`; fallo `objects_too_large` si el `tmpfs` se llena. Verificar en la pila local con tres CV y dos
  snapshots sintéticos: el `tar` de la instantánea lista los cinco objetos con sus rutas `bucket/clave`. **Falsación:**
  `BACKUP_OBJECTS_MAX_BYTES` menor que los objetos → clase `objects_too_large`, sin instantánea de objetos.
- [ ] 4.4 [infra] Manifiesto (D4, paso 3): JSON con identificador, horas UTC, bytes y SHA-256 de cada flujo, objetos
  por bucket con sus cabeceras (`Content-Type`, `Content-Length`, metadatos de usuario, C28), digests de las imágenes y
  `formatVersion: 1`, enviado como `manifest.json` solo si las dos pasadas anteriores terminaron en 0. Verificar: en la
  pila local, el manifiesto lista sumas iguales a las de `restic dump`. **Falsación (C25):** con una base sintética de
  al menos 50 MB, matar `backup-mongo` a mitad (`docker kill`) → la corrida termina en `mongo_dump` y no hay manifiesto
  con ese identificador.
- [ ] 4.5 [infra] Dos destinos (D5): la pasada completa (4.2-4.4) se repite para el destino de fuera con sus
  credenciales; un fallo en uno no impide el otro y la corrida termina en `push_oci` o `push_offsite`. Verificar en la
  pila local con dos repositorios locales: una corrida deja tres instantáneas con el mismo `run:` en cada uno.
  **Falsación:** el primer repositorio sin permisos de escritura → el segundo recibe su corrida completa y el ping es
  `fail push_oci`.
- [ ] 4.6 [infra] Tope de tamaño (D8): antes de cada pasada, la suma de versiones (`ListObjectVersions`) si la 1.5a o la
  1.5b dijeron que se puede, y si no `restic stats --mode raw-data --json`, contra `BACKUP_MAX_REPO_BYTES` (4 GiB por
  defecto); si lo pasa, `size_cap` sin enviar a ese destino. Verificar con la prueba de 4.7b. **Falsación** en la pila
  local: `BACKUP_MAX_REPO_BYTES=1` → clase `size_cap` y ninguna instantánea nueva.
- [ ] 4.7a [infra] Prueba permanente `infra/backup/test-run-backup.sh` con un `docker` y un `curl` falsos (como
  `infra/ci/test-report-cd-outcome.sh`) que registran su `argv` y contestan por guion. Casos: corrida buena (pings
  `start` y `success`, manifiesto después de los dos flujos), `lock_busy`, `mongo_dump`, y **cada `run` lleva `-T` y
  `--no-deps`** (C21). Verificar: `bash infra/backup/test-run-backup.sh` sale 0. **Falsación:** mover el envío del
  manifiesto antes de la pasada de objetos → el caso de la corrida buena falla; quitar `-T` de un `run` → falla;
  restaurar.
- [ ] 4.7b [infra] Casos restantes de la misma prueba: `size_cap`; un destino que falla y el otro no; `prune_overdue`
  (4.8); **ningún secreto en los argumentos** (busca en el `argv` registrado los valores de prueba de
  `RESTIC_PASSWORD`, `BACKUP_PING_URL` y las credenciales); y la comprobación `backup-run-script` de `repo-checks` que
  ejecuta la prueba. Verificar: `bash infra/ci/repo-checks.sh` en verde con una comprobación más. **Falsación:** pasar
  `BACKUP_PING_URL` como argumento de `curl` en el script → la prueba falla nombrando la variable y `repo-checks` sale
  ≠0; restaurar.
- [ ] 4.8 [infra] Aviso de poda vencida (B3): después de una corrida buena, si la instantánea más vieja de un destino
  tiene más de 65 días, `fail prune_overdue` con el destino en el cuerpo, sin borrar ni dejar de respaldar. Verificar
  con el caso de 4.7b (una instantánea falsa de hace 70 días → `prune_overdue` y manifiesto de la corrida presente).

## 5. Programación (design D10)

- [ ] 5.1 [infra] `infra/backup/systemd/linkvault-backup@.service` (`Type=oneshot`, `User=%i`, `Wants=` y
  `After=docker.service`, `TimeoutStartSec=2h`, `ExecStart=/bin/bash /srv/linkvault-staging/infra/backup/run-backup.sh`)
  y `linkvault-backup@.timer` (`OnCalendar=*-*-* 06:30:00 UTC`, `RandomizedDelaySec=15min`, `Persistent=true`), como
  D10. Verificar con `systemd-analyze verify` sobre los dos ficheros en un Linux con systemd (el host o un contenedor de
  Ubuntu 24.04), con la salida anotada.
- [ ] 5.2 [infra] Sección «Respaldo programado» en `infra/README.md`, escrita para seguirse **sola** (C18): copiar las
  unidades, `systemctl daemon-reload`, `systemctl enable --now linkvault-backup@<usuario>.timer`, comprobar con
  `systemctl list-timers`; el paso nuevo en «Reconstrucción por reemplazo del volumen de arranque»; y la **franja sin
  despliegues** de 06:15 a 08:45 UTC (D10). Verificar con `node -e` que el README contiene `linkvault-backup@` en las
  dos secciones, la franja, y `Persistent=true` en la unidad.

## 6. Restauración (design D11, D12, D13)

- [ ] 6.1 [infra] `infra/backup/restore.sh --project <nombre> --from oci|offsite [--run <id>] [--confirm-host]`, pasos
  1-5 de D11, dentro de `main() { … }; main "$@"` y con el candado común: etiqueta `sha-<12>` de la `api` de
  `linkvault-prod` o error; elegir corrida con manifiesto; verificar sumas antes de tocar nada; manifiestos o
  instantáneas duplicados son error; parar `api` y `worker`; `restic dump` → `exec -T mongo` con `--config` escrito en
  el `/tmp` de `mongo` y `mongorestore --archive --gzip --drop --oplogReplay --nsExclude 'admin.*'` (C5);
  `ensure-backup-user` y `ensure-backup-identity`. Verificar en una pila local de prueba (`-p linkvault-bktest`) con
  datos sintéticos y repositorio local: tras restaurar, las cuentas y links sintéticos están y `mongo` está sano con el
  usuario raíz. **Falsaciones (C25):** con un flujo de la base de al menos 50 MB, otra instantánea del mismo `run:` con
  un byte cambiado → error antes de parar nada; un segundo manifiesto con el mismo `run:` → error; una `api` con
  `:latest` → error.
- [ ] 6.2 [infra] `infra/backup/docker-compose.restore.yml` como D13 y reglas en `backup-isolation` (2.3) sobre
  `-p linkvault-restore`: ningún `ports`; el único servicio en una red con salida es `backup-push`, sin redes de datos
  (C6); `traefik`, `web` y `worker` deshabilitados; volúmenes con el prefijo del proyecto. En el host,
  `docker compose version` ≥ 2.24 (por `!reset`). Verificar: `config --format json` leído con `node`. **Falsación:**
  quitar `ports: !reset []` de `traefik` → la comprobación falla; quitar el perfil de `worker` → falla; poner `api` en
  `api-egress` → falla; restaurar.
- [ ] 6.3a [infra] `infra/backup/requeue-outbox.js` y `infra/backup/requeue-outbox.sh --since <hora> [--count-only]`
  (D12): constantes fijas con la colección y los campos (`publishedAt`, `failedAt`, `attempts`, `nextAttemptAt`), pone
  pendientes los eventos publicados desde la hora dada sin tocar los `failed`, e imprime el recuento por tipo. Test
  permanente en `repo-checks` (C9) que compara las constantes con
  `apps/api/src/infrastructure/outbox/outbox-event.schemas.ts`. Verificar en la pila local: con tres eventos publicados
  y uno `failed`, el script deja tres pendientes y el relay de `api` los publica; con `--count-only` no cambia ninguno.
  **Falsaciones:** una hora posterior a todos → cero; renombrar un campo en una copia de las constantes → el test de
  `repo-checks` falla; restaurar.
- [ ] 6.3b [infra] Reencolado dentro de `restore.sh` (C8, B2, C24): en `linkvault-prod`, con `api` y `worker`
  parados, **recrear el volumen de Redis**; mostrar el recuento por tipo con la ventana `BACKUP_REQUEUE_WINDOW_HOURS`
  (por defecto 1) contada desde la hora del manifiesto y pedir que se escriba `REENCOLAR`; en `linkvault-restore`, solo
  `--count-only`. Verificar en `linkvault-bktest`: con un Redis que **ya tenía** el job de uno de los eventos de la
  ventana, tras restaurar y confirmar hay **un solo** job por evento; sin la confirmación, nada cambia.
- [ ] 6.4a [infra] Paso 6 de D11 en `restore.sh`: `provision` del almacén y recarga de objetos con `restore-objects`
  (`restic dump` → `tar -x` en su `tmpfs` → `rclone copy` con la identidad de la aplicación), sin salida y sin
  registros. Verificar en `linkvault-bktest`: un CV sintético se descarga con la misma suma que el original, y sus
  cabeceras (`Content-Type`, `Content-Length`, metadatos) coinciden con las del manifiesto (C28).
- [ ] 6.4b [infra] Pasos 7 y 8 de D11: informe de conciliación (CV sin objeto, objetos sin documento con referencia al
  «Paso 6 octies» del RUNBOOK, eventos por tipo, cabeceras distintas) y el recordatorio final de reaplicar los borrados
  que consten (B4). Verificar en `linkvault-bktest`: el informe sale con ceros y el recordatorio aparece.
  **Falsación:** borrar un objeto antes de respaldar y no su documento → el informe lo lista como CV sin objeto.
- [ ] 6.5 [infra] Guardia «nunca en la PC del owner» (B1): sin `/srv/linkvault-staging/.env.staging` y sin
  `--confirm-host`, `restore.sh` rechaza un repositorio que no sea un directorio local antes de leer nada; no mira la
  arquitectura. Verificar en la PC: con `BACKUP_OCI_REPOSITORY=s3:https://example.invalid/x` sale ≠0 con el mensaje del
  guardia y sin ninguna petición. **Falsación:** comentar el guardia → el script intenta conectar; restaurar.
- [ ] 6.6a [infra] `infra/backup/restore-drill.sh`, parte 1 (D13): candado común; memoria libre; `Id`,
  `State.StartedAt` y `RestartCount` de cada contenedor de `linkvault-prod` antes (C10); `up -d mongo redis
  object-store api` en `linkvault-restore` con la etiqueta de la 6.1; `restore.sh` con `--count-only`; `down -v`;
  los tres valores después, con error si cambió alguno. Verificar en la pila local con dos proyectos
  (`linkvault-bktest` como «staging» y `linkvault-restore`): termina en 0; `docker compose ls` y `docker volume ls` sin
  restos de `linkvault-restore`. **Falsación:** `docker restart` de un contenedor del proyecto «staging» durante el
  ensayo → el ensayo termina con error nombrándolo.
- [ ] 6.6b [infra] `restore-drill.sh`, parte 2: comprobación por la API del proyecto aparte con la **cuenta permanente
  de ensayo** (C11; contraseña leída con `read -s`, nunca en argumentos ni en el entorno de `docker`): login, `GET` de
  sus links y descarga de su CV; conciliación; RTO impreso. Verificar en la pila local con una cuenta sintética: las
  tres comprobaciones pasan y el RTO sale. **Falsación:** una contraseña equivocada → el ensayo falla en el login.

## 7. Variables (design D16)

- [ ] 7.1 [infra] `.env.example` con las variables de D16 y valores ficticios (sin un solo valor real), y comentarios
  de cómo se genera cada una. Verificar con `node -e` que están todas las de D16.
- [ ] 7.2 [infra] `infra/ci/check-env-file.mjs` acepta el compose del respaldo como **cuarto argumento** opcional (C23),
  lee sus `${VAR:?}` y aplica: formato apto para URI a `MONGO_BACKUP_*` (como D18), ≥ 32 caracteres a
  `RESTIC_PASSWORD`, `BACKUP_PING_URL` **obligatoria explícita** con `https://`, enteros positivos a los topes, y que
  ninguno sea el de `.env.example` ni el relleno de CI. Verificar: con un fichero de prueba completo sale 0; con uno al
  que le falta **cada** variable, por turnos, sale ≠0 nombrándola y sin imprimir ningún valor. Es guardia:
  **falsación** quitando la regla de `BACKUP_PING_URL` → el fichero sin ella pasa; restaurar.

## 8. Documentación y coordinación (design D6, D7, D13, D14)

- [ ] 8.1 [infra] `infra/README.md`: «Qué vive solo en el host» con la enmienda de ADR-066 (datos con respaldo, RPO y
  retención; Redis y los registros sin copia); la tabla de redes con `data-backup`, `store-backup` y `backup-egress`;
  el riesgo residual del almacén con los procesos de objetos del respaldo; las variables nuevas en «`.env.staging`».
  Verificar con `node -e` que ya no dice «sus datos no tienen copia» y sí cada afirmación nueva.
- [ ] 8.2 [infra] `infra/backup/README.md` (qué se respalda, cuándo, dónde, el modelo medido, el plazo de D7 en semanas,
  las clases de falla y qué hacer con cada una, el `userId` de la cuenta de ensayo, RTO medidos) y `docs/RUNBOOK.md`,
  «Operar staging»: respaldo a mano (`run-backup.sh`), restauración, **«Sesión mensual (≈ 1 h)»** (B5) en orden fijo
  —verificar, podar, costo, ensayo cuando toca (B10)— con las órdenes para **PowerShell y para Bash** y su salida
  esperada y el criterio simple de D6; la **verificación quincenal** de 5 minutos; **«Recuperar tras un borrado»**
  (C15); la lista de órdenes permitidas en la PC y las prohibidas (B9); y el aviso a los invitados actualizado (C17).
  Verificar con `node -e` que cada sección existe, que no aparecen `restic restore`, `restic dump` ni `restic mount`
  en las órdenes para la PC, y que el plazo coincide con el de design D7 (lo comprueba además 8.6).
- [ ] 8.3 [infra] `docs/despliegue/RUNBOOK-DESPLIEGUE.md` (C22): fases 8 y 9, «Respaldos», «Volver atrás»,
  «Mantenimiento» y «Publicar una actualización» con los nombres finales (`run-backup.sh` en vez de
  `$DC run --rm backup`, `restore.sh --from`, `restore-drill.sh`), margen de 3 h del monitor, modelo V, calendario de
  B10, franja sin despliegues; regla de corte 4 con «un bucket con retención se vacía quitando primero la regla, con el
  usuario administrador» (C16); y la línea «No terminado hasta C1» sustituida por el estado real al cierre. Verificar
  con `node -e` que cada nombre del runbook existe en el árbol o en `.env.example` y que ya no aparece
  `run --rm backup`.
- [ ] 8.4 [infra] Entrada `staging-sin-copias` en `tools/repo-checks/src/claims.registry.mjs` (design D14, C17):
  patrones afirmativos y específicos («staging es desechable», «sus datos no tienen copia», «entorno desechable y sin
  copias», «no hay copias de seguridad de datos») en `infra/README.md`, `docs/RUNBOOK.md`,
  `docs/despliegue/RUNBOOK-DESPLIEGUE.md` y `apps/web/src`, sin `DECISION-DESPLIEGUE.md`; símbolo que la desmiente,
  `infra/backup/run-backup.sh`. Verificar: `bash infra/ci/repo-checks.sh` en verde. **Falsación:** volver a escribir
  «sus datos no tienen copia» en `infra/README.md` → falla nombrando la entrada; restaurar.
- [ ] 8.5 [infra] Notas para 35b, sin editar `openspec/changes/staging-host/`: (1) el texto nuevo de su 9.10, con los
  cuatro puntos de B13 y el plazo de D7; (2) el `userId` de la cuenta permanente de ensayo, para excluirla de la
  medición como a las cuentas E2E (C11); (3) que este change modifica sus dos requirements de
  `platform/production-deploy` y se archiva después (D14). Se le pasan a la sesión dueña de 35b. En el PR de fusión de
  este change, anotar en el `scope` de `staging-host` de `openspec-changes.yaml` que las copias de datos pasaron a
  `staging-backups` (ADR-066). Verificar: la nota citada en la descripción del PR y `node -e` sobre
  `openspec-changes.yaml` que encuentra «staging-backups» en el `scope` de `staging-host`.
- [ ] 8.6 [infra] Guardia permanente `backup-retention-claim` en `repo-checks` (C32): extrae el número de semanas del
  plazo máximo de `infra/backup/README.md` (línea marcada), de `docs/RUNBOOK.md` y del `source` de
  `@@privacy.backups.retention` en `apps/web/src/locale/messages.xlf`, y falla si difieren, nombrando ficheros y
  números. Verificar: `bash infra/ci/repo-checks.sh` en verde. **Falsación:** cambiar el número en `docs/RUNBOOK.md` →
  falla; restaurar.

## 9. Aviso de privacidad (design D7)

- [ ] 9.1 [frontend] `/privacidad`, sección nueva «Copias de seguridad» con los **cuatro puntos** de B13 y la spec
  `web/privacy` (copias cifradas con clave propia fuera del servidor, en servicios de almacenamiento de terceros; borrado
  inmediato en la app y en las copias en ≤ N semanas, sin poder acelerarlo; pérdida posible de las últimas 24 h; lo
  borrado justo antes de una recuperación puede volver y el responsable lo vuelve a borrar), con ids i18n nuevos
  (`@@privacy.backups.*`, entre ellos `@@privacy.backups.retention`); catálogo re-extraído con
  `pnpm nx run web:extract-i18n` y traducción en `messages.en.xlf` (ADR-050). Test en `privacy.page.spec.ts`:
  «renders the backup notice with the four points and the documented maximum». Verificar: `pnpm nx run web:test` con
  ese spec y `pnpm nx run web:i18n-check` en verde.

## 10. Despliegue y ensayo en el host (design D1, D13, D15; fases 8 y 9 del runbook)

- [ ] 10.1 [infra] **Owner, antes de fusionar (precondición de la 12.1, C14):** secretos del respaldo en
  `.env.staging`, generados con las órdenes de `.env.example` y cargados con el procedimiento de la **fase 3** del
  runbook, y la copia fuera del host actualizada (regla de 35b 5.8, sumas comparadas con `node`). Verificar:
  `node infra/ci/check-env-file.mjs .env.staging docker-compose.prod.yml .env.example infra/backup/docker-compose.backup.yml`
  sale 0 en el host, con el compose de la rama del change copiado a un directorio temporal del host (no al fijo).
- [ ] 10.2 [infra] Despliegue del commit del change por el camino normal; `mongo` y `object-store` recreados (D15) y
  smoke en verde; 9.4 de `e2e-suite` sobre el hash desplegado (D1). Verificar: reporte de la corrida, `CreatedAt` nuevo
  de los dos servicios y el id de la corrida de la 9.4 en la descripción del PR.
- [ ] 10.3 [infra] **Owner:** instalar las unidades con `sudo` **siguiendo solo** la sección de `infra/README.md`
  (C18); cada paso que falte o confunda se anota como defecto y se corrige en el README en el PR de archivo. Verificar:
  `systemctl list-timers 'linkvault-backup@*'` volcado a fichero y leído con `node` muestra el siguiente disparo, y la
  lista de defectos (o «ninguno») en el PR de archivo.
- [ ] 10.4 [infra] Primer respaldo a mano en el host (`systemctl start linkvault-backup@<usuario>.service`). Verificar:
  `restic snapshots --tag run:<id>` en cada destino (desde `backup-push`) lista las tres instantáneas; el monitor
  muestra `start` y éxito; el tamaño de cada repositorio queda anotado.
- [ ] 10.5 [infra] Falsaciones en el host (fase 8, paso 9 del runbook): desde `backup-push`, `api` no resuelve y la
  dirección de metadatos no responde (C31); `docker inspect` de un contenedor del respaldo con `LogConfig.Type = none`
  y sin fichero en `/var/lib/docker/containers/<id>/` (C1); el usuario de respaldo no inserta; la identidad S3 de
  respaldo no sube ni borra, `object-store.js verify` sale 0 y la aplicación sube y borra (C2); la credencial del host
  no destruye un paquete ni cambia la protección; `BACKUP_MAX_REPO_BYTES=1` hace fallar con `size_cap` y llega el
  correo del monitor. Y el pedido anónimo al listado del bucket de OCI no da `200` (fase 8, paso 8). Verificar: las
  salidas, anotadas en el PR de archivo.
- [ ] 10.6 [infra] **Owner:** aviso de respaldo faltante (fase 8, paso 10): Claude desactiva el timer una noche, llega
  el correo del monitor, se reactiva. Y un reinicio del host deja el timer programado y, si el disparo cayó con el host
  apagado, la corrida se recupera (`Persistent=true`). Verificar: confirmación del owner y la salida de `list-timers`
  tras el reinicio.
- [ ] 10.7 [infra] Dos noches seguidas: cada destino lista corridas con manifiesto de dos días distintos; las peticiones
  de OCI Object Storage de esa semana, leídas en la consola por el owner y anotadas (R3). Verificar: listado y cifra en
  el PR de archivo.
- [ ] 10.8 [infra] **Owner:** cuenta permanente de ensayo en staging (C11) con datos sintéticos (tres links y un CV
  inventado), contraseña en su gestor; su `userId` anotado en `infra/backup/README.md` y pasado a 35b (8.5). Verificar:
  el `userId` en el README y la confirmación del owner; ningún dato real en la cuenta.
- [ ] 10.9 [infra] Primer ensayo de restauración en el host (fase 9, paso 1): `restore-drill.sh` sobre la última corrida
  **desde `offsite`** (C7), con el volumen existente y **sin** «Replace boot volume». Verificar: login, links y CV de
  la cuenta de ensayo leídos; conciliación sin faltantes; RTO anotado en `infra/backup/README.md`; `Id`,
  `State.StartedAt` y `RestartCount` de `linkvault-prod` iguales antes y después; `docker compose ls` y
  `docker volume ls` sin `linkvault-restore`.
- [ ] 10.10 [infra] **Owner:** primera verificación desde la PC (D6): `restic snapshots` y `restic check` de cada
  destino con el criterio simple, y la poda de prueba con la credencial de poda (sin nada que podar, termina en 0);
  recordatorios creados: verificación quincenal, sesión mensual, ensayo mensual los dos primeros meses y después
  trimestral (B10). Verificar: confirmación del owner y las fechas de los recordatorios.

## 11. Cierre

- [ ] 11.1 [infra] `pnpm exec openspec validate --all --strict --no-interactive`, `bash infra/ci/repo-checks.sh` y
  `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salidas anotadas en el PR.
- [ ] 11.2 [infra] Revisión a las dos semanas con invitados (Q4 de la decisión): tamaño de cada repositorio, peticiones
  de OCI del mes, si el intervalo nocturno sigue bastando y la latencia máxima de las colas (de los registros del
  worker), que fija `BACKUP_REQUEUE_WINDOW_HOURS` si pasa de 1 h (D12); la decisión del owner, anotada con fecha en
  ADR-066. Verificar con `node -e` que ADR-066 contiene «Revisión del intervalo (Q4 de la decisión), 20».
- [ ] 11.3 [infra] Al archivar (después de 35b, D14): ADR-066 pasa a «Aceptado» con la fecha y el PR; la línea «No
  terminado hasta C1» del runbook y de la decisión se sustituye por el estado; `despliegue.json`, condiciones 1-5 y 8
  marcadas. Verificar con `node -e` sobre los tres ficheros.
- [ ] 11.4 [infra] Plazo de revisión (R11): a los 60 días de la fusión, si 35b sigue sin archivar, se revisa ADR-066 con
  el owner (esperar, o archivar sin el delta de `production-deploy` y pasárselo a 35b) y se anota la decisión con fecha.
  Verificar con `node -e` que ADR-066 contiene «Revisión del archivo (R11), 20» o que el change ya está archivado.

## 12. Fusión (design D1)

- [ ] 12.1 [infra] **Fusiones de clase 1** (la del change y cualquier correctiva antes de la 10.7), comprobadas justo
  antes de cada una: (0) **precondiciones**: la 10.1 hecha (check de `.env.staging` en 0) y **la 9.10 de 35b
  enmendada** con el aviso nuevo (C14, C17); (1) confirmación escrita y fechada del owner en el PR, «PR-2 de 35b = #NN;
  11.6 hecha el AAAA-MM-DD; 10.7 no hecha; sin `e2e-remote` hoy»; (2) `git log --first-parent --oneline origin/main`
  volcado a fichero con el merge del PR-2 de 35b y ese número; (3) «en ventana» solo si el PR-2 está en `main`, la
  11.6 hecha y la 10.7 no; (4) después de desplegar, la 9.4 de `e2e-suite` sobre el hash desplegado, con el hash y el
  id de la corrida en la descripción del PR; (5) la 10.7 solo procede con la 9.4 en verde sobre el **último** hash
  desplegado de cualquier fusión de clase 1 (de este change o de `enrichment-egress-guard`). Verificar: los seis puntos
  en la descripción de cada PR. **Falsación** de escritorio, nunca como comentario del PR: aplicar la regla a una
  confirmación de prueba con la 10.7 hecha, con la 11.6 no hecha, con un número de PR-2 que no coincide y sin la 10.1,
  y obtener «fuera de ventana» en las cuatro.
- [ ] 12.2 [infra] **Fusiones posteriores a la 10.7** (clase 2, el PR de archivo, después del archivo de 35b; clase 3,
  una vuelta atrás y su vuelta), cada una con su confirmación del owner («PR-2 de 35b = #NN; 11.6 hecha el …; 10.7 hecha
  el …; 9.1-9.4 de 35b no en curso; medición: día N; hoy no hay corrida `e2e-remote`») y el volcado de `git log`. «En
  ventana» solo si no está entre el PR-2 y la 11.6 de 35b, no hay 9.1-9.4 en curso, N no es 7 ni 14 y no hay
  `e2e-remote` ese día. Las anotaciones posteriores a la fusión viajan en el PR de archivo. Verificar: la cita, el
  volcado y el resultado en la descripción de cada PR. **Falsación** de escritorio con N = 7, con una corrida
  `e2e-remote` ese día y con la 10.7 no hecha (remite a 12.1): «fuera de ventana» en cada una.

## Casos de prueba derivados de los escenarios

Nombres para trasladar a las pruebas (casos de `test-run-backup.sh` y de `repo-checks`, y anotaciones de las tareas de
verificación manual). Un escenario puede cubrirse en más de un sitio.

| Spec · escenario | Caso | Dónde |
|---|---|---|
| backups · Una corrida completa deja tres instantáneas y su manifiesto | `run-backup: good run pings start and success and writes the manifest last` | 4.7a; 4.4; 10.4 |
| backups · Un volcado interrumpido no deja una corrida válida | `run-backup: killed 50 MB mongo dump leaves no manifest and pings fail mongo_dump` | 4.7a; 4.4 |
| backups · Un destino caído no impide el otro | `run-backup: failing oci destination still completes offsite and pings fail push_oci` | 4.7b; 4.5 |
| backups · Los datos no quedan en los registros de Docker | `backup services use log driver none and leave no log file` | 2.5; 10.5 |
| backups · El lector de la base no sale a Internet ni ve a la API | `isolation: backup-mongo resolves mongo but not api and has no egress` | 2.5; 10.5 |
| backups · El que envía no alcanza los datos ni la dirección de metadatos | `isolation: backup-push cannot resolve data services nor reach metadata` | 2.5; 10.5 |
| backups · El worker no ve a los procesos del respaldo | `isolation: worker cannot resolve backup services` | 2.5 |
| backups · Una configuración que mezcla datos y salida rompe la comprobación | `backup-isolation: backup service on data and egress networks fails` | 2.3 |
| backups · Un servicio del respaldo sin redes explícitas o con registros rompe la comprobación | `backup-isolation: missing networks or logging driver fails` | 2.3 |
| backups · El usuario de respaldo no puede escribir | `mongo backup user insert is unauthorized` | 3.1; 10.5 |
| backups · El usuario de respaldo existe sobre un volumen viejo | `ensure-backup-user creates the user on a pre-existing volume` | 3.1 |
| backups · La identidad S3 de respaldo no puede escribir ni borrar | `s3 backup identity can list and get but not put or delete` | 1.7a; 3.2; 10.5 |
| backups · La identidad de la aplicación no cambia | `app identity still verifies, puts and deletes; identity list differs only by backup` | 1.7b; 3.2; 10.5 |
| backups · La credencial del host no destruye un paquete | `host credential cannot permanently delete a pack or its version` | 1.5a; 1.5b; 10.5 |
| backups · La credencial del host no cambia la protección | `host credential cannot suspend versioning, change lifecycle or retention` | 1.5a; 1.5b |
| backups · La poda con la credencial de poda aplica la retención | `prune credential applies keep-daily 7 keep-weekly 4` | 1.5a; 1.5b; 10.10 |
| backups · Un destino con versionado sin ciclo de vida se rechaza | `destination with versioning and no noncurrent expiry is not apt` | 1.1; 1.3; 1.4 |
| backups · La poda vencida avisa sin cortar el respaldo | `run-backup: snapshot older than 65 days pings prune_overdue after a complete run` | 4.7b; 4.8 |
| backups · Un tope menor que el tamaño actual hace fallar el respaldo | `run-backup: size cap below repo size pings fail size_cap and skips push` | 4.7b; 4.6; 10.5 |
| backups · Una falla avisa con su clase | `run-backup: fail ping carries run id and class only` | 4.7a; 4.7b |
| backups · Un respaldo que no corre produce un aviso | `monitor emails when no success arrives in its window` | 10.6 |
| backups · Tras reiniciar el host el respaldo sigue programado | `timer stays scheduled after host reboot` | 10.6 |
| backups · Dos corridas no se solapan | `run-backup: second run or restore exits lock_busy without touching anything` | 4.7a; 6.1 |
| backups · La instalación sigue solo el README | `timer installed following only the README section, defects listed` | 5.2; 10.3 |
| backups · Restaurar no deja a la base sin usuario raíz | `restore keeps root user and ensures backup user on a fresh volume` | 6.1 |
| backups · Una corrida con sumas que no coinciden no se restaura | `restore refuses a mismatched hash or a duplicate manifest before stopping services` | 6.1 |
| backups · El trabajo en vuelo al volcar se vuelve a publicar una vez | `restore recreates redis and leaves one job per requeued event` | 6.3b |
| backups · El ensayo no reencola | `restore drill counts requeue candidates by type and changes none` | 6.3a; 6.6a |
| backups · El informe de conciliación sale aunque no haya diferencias | `restore prints a zero reconciliation report` | 6.4b |
| backups · Sin imagen etiquetada por commit no se restaura | `restore refuses when staging api is not sha-<12>` | 6.1 |
| backups · El ensayo restaura sin tocar staging | `restore-drill fails if a staging container Id, StartedAt or RestartCount changes` | 6.6a; 10.9 |
| backups · El override de restauración no publica nada | `backup-isolation: restore override has no ports and only backup-push has egress` | 6.2 |
| backups · El ensayo no deja restos | `restore-drill leaves no linkvault-restore project or volume` | 6.6a; 10.9 |
| backups · Restaurar un repositorio remoto fuera del host se rechaza | `restore refuses a remote repository without host env file or --confirm-host` | 6.5 |
| backups · Falta una variable del respaldo | `check-env-file names each missing backup variable, BACKUP_PING_URL included` | 7.2 |
| backups · Ninguna credencial en los argumentos | `run-backup: no secret value appears in docker or curl argv` | 4.7b |
| backups · Un plazo distinto en un aviso rompe la comprobación | `backup-retention-claim: differing week counts fail` | 8.6 |
| object-store · La API de identidades solo la usa el script del respaldo | `identity admin API only in ensure-backup-identity.sh` | 3.2 (búsqueda con `node -e`) |
| object-store · El lector del respaldo alcanza el almacén y nada más | `isolation: backup-objects lists buckets and has no egress` | 2.5; 3.2 |
| object-store · El que envía los respaldos no alcanza el almacén | `isolation: backup-push cannot resolve object-store` | 2.5 |
| object-store · (escenarios existentes) | sin cambios; `backup-isolation` comprueba las redes | 2.3 |
| production-deploy · La reconstrucción reinstala el respaldo | `README rebuild section installs the backup timer` | 5.2 |
| production-deploy · Lo que se pierde con el host está escrito | `README host-only section states backup, RPO and what has no copy` | 8.1; 8.4 |
| production-deploy · El lector del respaldo alcanza el almacén sin salir a Internet | igual que el de object-store | 2.5; 10.5 |
| web/privacy · El aviso explica las copias de seguridad | `renders the backup notice with the four points and the documented maximum` | 9.1 |
