> **Cómo leer este fichero.** Tarea C1 de `docs/despliegue/DECISION-DESPLIEGUE.md`. Cada tarea cabe en **menos de una
> hora**, lleva su etiqueta y dice qué se ejecuta para cerrarla. Las del owner llevan `[infra]` y empiezan por
> «**Owner:**». Un **guardia permanente** (comprobación de `repo-checks`, prueba de un script) se rompe a mano, se ve
> fallar y se restaura en la misma tarea (ADR-048 §7). La documentación se verifica con un `node -e` de un solo uso que
> busca las afirmaciones concretas. Para contar coincidencias se usa `node`, no `grep -c`, y `nx` nunca va por tubería.
> Ningún secreto se escribe en el repositorio, en un comando guardado ni en el chat: las órdenes que los necesitan los
> leen del entorno o de la entrada estándar.
>
> **Ventana:** nada de este change se fusiona a `main` antes de la 11.6 de 35b ni después de su 10.7 (design D1). El
> grupo 1 y la implementación en la rama corren en paralelo a 35b; el grupo 10 es después de fusionar.
>
> **«Qn»** es una pregunta de este change (design, Open Questions); **«Qn de la decisión»**, una de
> `DECISION-DESPLIEGUE.md`, ya respondida el 2026-11-18.

## 0. Antes de aplicar

- [ ] 0.1 [infra] Q1-Q4 del design respondidas por el owner, o aceptados sus valores por defecto (Q1 y Q2 no
  bloquean; Q3 solo si falla la 1.7; Q4 solo si la 1.1 termina en (b)), y anotadas con fecha en design.md («Respuestas
  del owner y aprobación») y en ADR-066 («Respuestas del owner»). Con Q1 y Q2 cerradas, el plazo máximo de D7 queda
  fijado como número de semanas. Verificar con `node -e` que la línea «Q1-Q4 de este change:» de design.md y la línea
  «Q1-Q4 del change:» de ADR-066 ya no dicen «pendientes» y llevan una fecha `2026-`.
- [ ] 0.2 [infra] Debate critic/business/reflect (`/lv:debate`) cerrado sin P0/V0 abiertos y aprobación humana
  registrada en design.md con su fecha; ADR-066 sigue «Propuesto» hasta el archivo. Verificar: la sección del debate
  de la última iteración dice «Convergencia: SI».
- [x] 0.3 [infra] ADR-066 «Propuesto» y sus anotaciones de una línea en ADR-051 §2, ADR-048 §Consecuencias (excepción)
  y ADR-052 (riesgo residual del almacén); fila del change en `openspec-changes.yaml` y en `docs/design-v0.2.md` §6.
  Verificar con `node -e` que ADR-051, ADR-048 y ADR-052 contienen `](ADR-066.md)`, que `openspec-changes.yaml`
  contiene `name: staging-backups` y que `openspec validate --all --strict` pasa. **Estado (2026-11-18): hecha** con la
  spec del change.

## 1. Destinos, monitor y mediciones previas (design D3, D5, D6, D9)

- [ ] 1.1 [infra] **Owner:** verificar el destino (a) de Q2 de la decisión: un almacenamiento de objetos fuera de Oracle
  con plan gratuito. Criterios, todos obligatorios: (1) alta **sin tarjeta**, o con tope duro en 0 escrito por el
  proveedor; (2) API compatible con S3 que restic usa; (3) **bloqueo de objetos o retención**, con versionado y regla de
  ciclo de vida para versiones no actuales (modelo V de D6) o retención sin versionado (modelo R); (4) claves con
  permisos acotados por bucket y **sin** borrado de versiones; (5) plan gratuito de al menos 2× el tope de D8.
  **Criterio de corte:** si en **7 días naturales** desde que empieza esta tarea ningún candidato cumple los cinco, se
  pasa a (b). Si el candidato pide una cuenta con datos personales más allá del correo, o tiene costo posible, decide
  el owner antes de seguir. Verificar: una línea en ADR-066 «Destino fuera de Oracle (Q2 de la decisión), AAAA-MM-DD:
  (a) <proveedor> | (b) Google Drive dedicado», con los cinco criterios marcados y **sin** datos de la cuenta (ni
  correo, ni identificadores, ni región).
- [ ] 1.2 [infra] **Owner (solo si 1.1 terminó en (b)):** cuenta de Google **dedicada** al respaldo, no la personal;
  cliente OAuth propio **publicado** (no «en pruebas», para que el token no venza a los 7 días) con el alcance mínimo
  de Drive que use rclone; carpeta dedicada. Claude diseña en esta tarea el `rclone serve restic` efímero de D5 y fija
  los nombres de `BACKUP_OFFSITE_*`. Verificar: Q4 respondida (0.1) y los nombres de las variables escritos en design
  D16.
- [ ] 1.3 [infra] **Owner:** en OCI, bucket **privado**, nivel Standard, con el modelo de protección de D6 (versionado
  con retención y ciclo de vida de versiones no actuales a `P + 1` días, o regla de retención sin versionado si la 1.5a o la 1.5b
  elige el modelo R); un usuario IAM dedicado con una política limitada a ese bucket **sin** borrado de versiones ni
  cambio de retención, ciclo de vida o versionado, y su *Customer Secret Key* (credencial del host); y otra credencial,
  la de poda, solo en el gestor de contraseñas. Antes de crear nada, el estimador de costos en 0 (regla de corte 3 del
  runbook). Verificar: el owner confirma en el chat «bucket OCI creado, privado, modelo V|R, dos credenciales», sin
  nombres de bucket, espacio de nombres ni región.
- [ ] 1.4 [infra] **Owner:** el destino de fuera (el de 1.1 o 1.2) con las mismas dos credenciales: la del host, sin
  borrado definitivo, y la de poda, solo en el gestor de contraseñas. Verificar: confirmación del owner en el chat con
  la misma forma que 1.3.
- [ ] 1.5a [infra] Medir el modelo de protección en **OCI** (design D6), con un repositorio restic de **prueba**
  (`restic init` con una clave de prueba, datos sintéticos de 1 MiB) y las credenciales que el owner carga en el
  entorno de la sesión sin mostrarlas. Con la credencial del host: `restic backup`, `restic check` y
  `restic snapshots` terminan en 0, y dos `backup` seguidos no dejan bloqueos que impidan el tercero. **Falsación:** con
  la credencial del host, borrar de forma definitiva un paquete de `data/` (y, en el modelo V, una versión de ese
  paquete) falla, o el paquete sigue recuperable listando versiones. Con la credencial de poda: `restic forget
  --keep-last 1 --prune --max-unused unlimited --no-cache` termina en 0. Verificar: tabla en design D6 «Medido» con
  destino, modelo y resultado de cada orden, sin nombres de bucket ni cuenta. Al terminar, borrar el repositorio de
  prueba con la credencial de poda (o anotar que caduca con la retención).
- [ ] 1.5b [infra] La misma medición de 1.5a en el **destino de fuera de Oracle**, con sus dos credenciales. Con Drive
  (Q2 de la decisión en (b)), la falsación de borrado definitivo **se espera que no falle** y se anota como el riesgo de
  Q4. Verificar: su fila en la tabla «Medido» de design D6.- [ ] 1.6 [infra] **Owner:** monitor de pings en un servicio gratuito (por ejemplo healthchecks.io), con periodo de un
  día, margen de 3 horas y aviso por correo; su dirección será `BACKUP_PING_URL`. Verificar: el owner confirma «monitor
  creado, periodo 1 d, margen 3 h» y que mandó un ping de prueba desde su PC y lo vio en el panel; la dirección no se
  pega en el chat.
- [ ] 1.7 [infra] Medir el mecanismo de la identidad S3 de solo lectura en SeaweedFS 4.47 `mini` con `-disableHttp`
  (design D3), en una pila local (`pnpm infra:up` y el compose de producción con `infra/ci/verify.env`). Probar, en
  orden: la API IAM embebida de la pasarela S3 con la identidad de la aplicación, desde un contenedor de un solo uso en
  la red del almacén; y la configuración de identidades por `weed shell` dentro del contenedor del almacén. Para cada
  uno, los cuatro criterios de D3: sin fichero con secreto montado; sin cambio de `command`, `environment` ni volumen
  del servicio; la identidad sobrevive a `docker compose restart object-store`; con ella `ListObjectsV2` y `GetObject`
  funcionan en los dos buckets y **(falsación)** `PutObject` y `DeleteObject` fallan con `AccessDenied`. Verificar: el
  mecanismo elegido y su salida, anotados en design D3 («Medido»). Si ninguno cumple, Q3 pasa a bloqueante y el grupo 3
  espera su respuesta.

## 2. Redes y servicios del respaldo (design D2)

- [ ] 2.1 [infra] En `docker-compose.prod.yml`: redes `data-backup` y `store-backup` (`internal: true`), `mongo` en
  `data-backup` y `object-store` en `store-backup`; la tabla de redes del comentario de cabecera, actualizada. Verificar:
  `docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config --format json` volcado a fichero y
  leído con `node`: `data-backup` y `store-backup` con `internal: true`; `mongo` en `data-api`, `data-worker` y
  `data-backup`; `object-store` en `store-api`, `store-worker` y `store-backup`; ningún otro servicio de ese fichero en
  ellas.
- [ ] 2.2 [infra] `infra/backup/docker-compose.backup.yml` con `backup-mongo`, `backup-objects` y `backup-push` como en
  la tabla de D2: imágenes fijadas por digest, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `tmpfs` con
  tamaño (`BACKUP_OBJECTS_MAX_BYTES` en el lector de objetos), red `backup-egress` definida aquí, y los scripts de
  `infra/backup/` montados en solo lectura. En el host, `swapon --show` vacío o swap cifrada (D4, R8). Verificar:
  `config --format json` de los dos ficheros juntos, leído con `node`, con las redes de cada servicio exactamente como
  la tabla; y `bash infra/deploy/check-image-platforms.sh --platform linux/arm64 <las tres imágenes>` sale 0.
- [ ] 2.3 [infra] Comprobación permanente `tools/repo-checks/src/backup-isolation.check.mjs`, sumada al agregador:
  sobre la configuración de los dos ficheros (con `lib/compose.mjs`), falla si un servicio `backup-*` está en una red de
  salida y en una de datos a la vez, si comparte red con `api` o `worker`, si `data-backup` tiene miembros distintos de
  `mongo` y `backup-mongo`, o si `store-backup` los tiene distintos de `object-store` y `backup-objects`. Verificar:
  `bash infra/ci/repo-checks.sh` en verde con una comprobación más. **Falsación**, cada una sobre el fichero y
  restaurada: `backup-mongo` también en `backup-egress` → falla nombrando servicio y red; `worker` en `store-backup` →
  falla; `backup-push` en `data-backup` → falla.
- [ ] 2.4 [infra] `infra/deploy/config-files.txt` suma `infra/backup/docker-compose.backup.yml`,
  `infra/backup/docker-compose.restore.yml` y los scripts de `infra/backup/` que se ejecutan en el host. Verificar con
  `node -e` que cada fichero de la lista existe en el árbol y que el guardia de `repo-checks` sobre la lista (si 35c ya
  lo trajo) sigue en verde.
- [ ] 2.5 [infra] Prueba de aislamiento en una pila local con los dos ficheros: con `backup-mongo` en marcha (`run -d`
  con `sleep`), resolver `api` y abrir `https://example.com` fallan y `mongo:27017` responde; desde `backup-push`,
  resolver `mongo`, `object-store` y `api` falla y la salida HTTPS responde; desde `worker`, resolver `backup-mongo`
  falla. Verificar: las salidas, anotadas en el PR; los contenedores de prueba borrados (`docker ps -a` sin `backup-*`).

## 3. Credenciales de solo lectura (design D3)

- [ ] 3.1 [infra] `infra/backup/ensure-backup-user.js` (script de `mongosh`) y su invocación por
  `docker compose exec -T mongo mongosh --quiet --file …` (montado o pasado por la entrada estándar): autentica como
  raíz y crea o actualiza `MONGO_BACKUP_USER` con el rol `backup`, todo desde `process.env`; `MONGO_BACKUP_USER` y
  `MONGO_BACKUP_PASSWORD` en el entorno del servicio `mongo` con `${VAR:?}`, y relleno en `infra/ci/verify.env`.
  Verificar en la pila local: dos ejecuciones seguidas terminan en 0; `mongodump --archive` con ese usuario termina en
  0; con un volumen creado **antes** del cambio (sin el usuario), la primera ejecución lo crea. **Falsación:** un
  `insertOne` con el usuario de respaldo falla con `Unauthorized`; cambiar la contraseña en el entorno y repetir deja la
  nueva vigente (la vieja falla).
- [ ] 3.2 [infra] Mecanismo de la identidad S3 de solo lectura elegido en 1.7, en `infra/backup/ensure-backup-identity.sh`,
  idempotente, invocado en cada corrida. Verificar en la pila local: dos ejecuciones terminan en 0; con
  `S3_BACKUP_*`, listar y leer un objeto de cada bucket funciona; tras `docker compose restart object-store` sigue
  funcionando. **Falsación:** `PutObject` y `DeleteObject` con esa identidad fallan; si se le da escritura a mano, la
  prueba lo detecta (restaurar).
- [ ] 3.3 [infra] Si el mecanismo de 1.7 cambia la configuración del servicio `object-store`: repetir C3-C5 y C7-C9 de
  `docs/object-store-matrix/matriz.md` sobre ella y anotarlas, como 12.3 de 35b. Si no la cambia, anotar en ADR-052
  «Consecuencias para 35b y 35c» que la configuración medida no cambió. Verificar con `node -e` que la anotación existe.

## 4. Corrida de respaldo (design D4, D5, D8, D9)

- [ ] 4.1 [infra] Esqueleto de `infra/backup/run-backup.sh`: `set -euo pipefail`; `flock` no bloqueante sobre
  `/srv/linkvault-staging/.backup.lock` (o el directorio que reciba); lectura de `BACKUP_PING_URL` desde
  `.env.staging` sin `source` (solo esa clave); `ping start|success|fail <clase>` con `curl --config -` por la entrada
  estándar y plazo de 10 s; identificador de corrida UTC; `trap` que manda `fail` con la última clase. Verificar con la
  prueba de 4.7a (lock ocupado → `lock_busy` y salida ≠0 sin respaldar).
- [ ] 4.2 [infra] Pasada de la base (D4, paso 1): `ensure-backup-user`, después `run --rm -T backup-mongo` con
  `mongodump --config <tmpfs> --archive --gzip --oplog` → `tee` a `sha256sum` y contador de bytes en el host →
  `run --rm -T backup-push` con `restic backup --stdin --stdin-filename mongo.archive.gz` y las etiquetas de D4.
  Verificar en la pila local con un repositorio restic **local** (`BACKUP_OCI_REPOSITORY=/tmp/...` montado en
  `backup-push`): `restic snapshots --tag kind:mongo` lista una; `restic dump` de ella tiene la misma suma que el host
  calculó.
- [ ] 4.3 [infra] Pasada de los objetos (D4, paso 2): `ensure-backup-identity`, después `run --rm -T backup-objects`
  con `rclone copy` de los dos buckets al `tmpfs` y `tar -c` a la salida estándar → `tee` → `backup-push` con
  `objects.tar`; fallo `objects_too_large` si el `tmpfs` se llena. Verificar en la pila local con tres CV y dos
  snapshots sintéticos: el `tar` de la instantánea lista los cinco objetos con sus rutas `bucket/clave`. **Falsación:**
  `BACKUP_OBJECTS_MAX_BYTES` menor que los objetos → clase `objects_too_large`, sin instantánea de objetos.
- [ ] 4.4 [infra] Manifiesto (D4, paso 3): JSON con identificador, horas UTC, bytes y SHA-256 de cada flujo, objetos
  por bucket, digests de las tres imágenes y `formatVersion: 1`, enviado como `manifest.json` solo si las dos pasadas
  anteriores terminaron en 0. Verificar: en la pila local, el manifiesto de la corrida lista sumas iguales a las de
  `restic dump`. **Falsación:** matar `backup-mongo` a mitad (`docker kill`) → la corrida termina en `mongo_dump` y no
  hay manifiesto con ese identificador.
- [ ] 4.5 [infra] Dos destinos (D5): la pasada completa (4.2-4.4) se repite para el destino de fuera con sus
  credenciales; un fallo en uno no impide el otro y la corrida termina en `push_oci` o `push_offsite`. Verificar en la
  pila local con dos repositorios locales: una corrida deja tres instantáneas con el mismo `run:` en cada uno.
  **Falsación:** el primer repositorio sin permisos de escritura → el segundo recibe su corrida completa y el ping es
  `fail push_oci`.
- [ ] 4.6 [infra] Tope de tamaño (D8): antes de cada pasada, `restic stats --mode raw-data --json` contra
  `BACKUP_MAX_REPO_BYTES` (4 GiB por defecto); si lo pasa, `size_cap` sin enviar a ese destino. Verificar con la
  prueba de 4.7b. **Falsación** en la pila local: `BACKUP_MAX_REPO_BYTES=1` → clase `size_cap` y ninguna instantánea
  nueva.
- [ ] 4.7a [infra] Prueba permanente `infra/backup/test-run-backup.sh` con un `docker` y un `curl` falsos (como
  `infra/ci/test-report-cd-outcome.sh`) que registran su `argv` y contestan por guion. Casos: corrida buena (pings
  `start` y `success`, manifiesto después de los dos flujos), `lock_busy` y `mongo_dump`. Verificar:
  `bash infra/backup/test-run-backup.sh` sale 0. **Falsación:** mover el envío del manifiesto antes de la pasada de
  objetos → el caso de la corrida buena falla; restaurar.
- [ ] 4.7b [infra] Casos restantes de la misma prueba: `size_cap`; un destino que falla y el otro no; **ningún secreto
  en los argumentos** (busca en el `argv` registrado los valores de prueba de `RESTIC_PASSWORD`, `BACKUP_PING_URL` y las
  credenciales); y la comprobación `backup-run-script` de `repo-checks` que ejecuta la prueba. Verificar:
  `bash infra/ci/repo-checks.sh` en verde con una comprobación más. **Falsación:** pasar `BACKUP_PING_URL` como
  argumento de `curl` en el script → la prueba falla nombrando la variable y `repo-checks` sale ≠0; restaurar.

## 5. Programación (design D10)

- [ ] 5.1 [infra] `infra/backup/systemd/linkvault-backup@.service` y `linkvault-backup@.timer` como D10. Verificar con
  `systemd-analyze verify` sobre los dos ficheros en un Linux con systemd (el host o un contenedor de Ubuntu 24.04), con
  la salida anotada.
- [ ] 5.2 [infra] Pasos de instalación en `infra/README.md` (copiar las unidades, `systemctl daemon-reload`,
  `systemctl enable --now linkvault-backup@<usuario>.timer`, comprobar con `systemctl list-timers`) y el paso nuevo en
  «Reconstrucción por reemplazo del volumen de arranque». Verificar con `node -e` que el README contiene
  `linkvault-backup@` en las dos secciones y `Persistent=true` en la unidad.

## 6. Restauración (design D11, D12, D13)

- [ ] 6.1 [infra] `infra/backup/restore.sh --project <nombre> [--run <id>]`, pasos 1-4 de D11: elegir corrida con
  manifiesto, verificar sumas antes de tocar nada, parar `api` y `worker`, `mongorestore --archive --gzip --drop
  --oplogReplay --nsExclude 'admin.*'` por tubería, `ensure-backup-user`. Verificar en una pila local de prueba
  (`-p linkvault-bktest`) con datos sintéticos y repositorio local: tras restaurar, las cuentas y links sintéticos están
  y `mongo` está sano con el usuario raíz. **Falsación:** alterar un byte del flujo de la base en el repositorio de
  prueba (otra instantánea con el mismo `run:`) → la restauración termina con error antes de parar nada.
- [ ] 6.2 [infra] `infra/backup/docker-compose.restore.yml` como D13 y comprobación en `backup-isolation` (2.3) sobre
  `-p linkvault-restore`: ningún `ports`, ningún servicio en `edge`, `api-egress`, `worker-egress` ni `backup-egress`
  salvo `backup-push`, `traefik`, `web` y `worker` deshabilitados, volúmenes con el prefijo del proyecto. En el host,
  `docker compose version` ≥ 2.24 (por `!reset`). Verificar: `config --format json` leído con `node`. **Falsación:**
  quitar `ports: !reset []` de `traefik` → la comprobación falla; quitar el perfil de `worker` → falla; restaurar.
- [ ] 6.3 [infra] `infra/backup/requeue-outbox.js` y `infra/backup/requeue-outbox.sh --since <hora>` (D12): lee los
  nombres de los campos de `apps/api/src/infrastructure/outbox/mongo-outbox.ts`, pone pendientes los eventos publicados
  desde la hora dada (sin tocar los `failed`) e imprime cuántos. Verificar en la pila local: con tres eventos publicados
  y uno `failed`, el script deja tres pendientes y el relay de `api` los publica (pendientes en 0 a los pocos segundos).
  **Falsación:** una hora posterior a todos → cero reencolados.
- [ ] 6.4 [infra] Pasos 5-6 de D11 en `restore.sh`: `provision` del almacén, recarga de objetos desde `objects.tar` con
  un contenedor de un solo uso sin salida, reencolado con la ventana `BACKUP_REQUEUE_WINDOW_HOURS` contada desde la hora
  del manifiesto, e informe de conciliación (CV sin objeto, objetos sin documento con referencia al «Paso 6 octies» del
  RUNBOOK, eventos reencolados). Verificar en `linkvault-bktest`: un CV sintético se descarga con la misma suma que el
  original; el informe sale con ceros. **Falsación:** borrar un objeto antes de respaldar y no su documento → el informe
  lo lista como CV sin objeto.
- [ ] 6.5 [infra] Guardia «nunca en la PC del owner» (D11): fuera del host, `restore.sh` rechaza un repositorio que no
  sea un directorio local antes de leer nada. Verificar en la PC: con `BACKUP_OCI_REPOSITORY=s3:https://example.invalid/x`
  sale ≠0 con el mensaje del guardia y sin ninguna petición (sin red). **Falsación:** comentar el guardia → el script
  intenta conectar; restaurar.
- [ ] 6.6 [infra] `infra/backup/restore-drill.sh` (D13): memoria libre anotada, `CreatedAt` de staging antes,
  `up -d mongo redis object-store api` en `linkvault-restore`, `restore.sh`, comprobación por la API (login de una
  cuenta de prueba con credenciales leídas con `read -s`, `GET` de sus links, descarga de su CV), conciliación, RTO
  impreso, `down -v`, `CreatedAt` de staging después (≠ → error). Verificar en la pila local con dos proyectos
  (`linkvault-bktest` como «staging» y `linkvault-restore`): termina en 0, `docker compose ls` y `docker volume ls` sin
  restos de `linkvault-restore`. **Falsación:** reiniciar un contenedor del proyecto «staging» durante el ensayo → el
  ensayo termina con error nombrándolo.

## 7. Variables (design D16)

- [ ] 7.1 [infra] `.env.example` con las variables de D16 y valores ficticios (sin un solo valor real), y comentarios
  de cómo se genera cada una. Verificar con `node -e` que están todas las de D16.
- [ ] 7.2 [infra] `infra/ci/check-env-file.mjs` lee también los `${VAR:?}` de `infra/backup/docker-compose.backup.yml`
  (tercer argumento opcional) y aplica: formato apto para URI a `MONGO_BACKUP_*` (como D18), ≥ 32 caracteres a
  `RESTIC_PASSWORD`, `https://` a `BACKUP_PING_URL`, enteros positivos a los topes, y que ninguno sea el de
  `.env.example` ni el relleno de CI. Verificar: con un fichero de prueba completo sale 0; con uno al que le falta
  **cada** variable, por turnos, sale ≠0 nombrándola y sin imprimir ningún valor. Es guardia: **falsación** quitando la
  regla de `RESTIC_PASSWORD` → el fichero sin ella pasa; restaurar.

## 8. Documentación y coordinación (design D7, D14)

- [ ] 8.1 [infra] `infra/README.md`: «Qué vive solo en el host» con la enmienda de ADR-066 (datos con respaldo, RPO y
  retención; Redis y los registros sin copia); la tabla de redes con `data-backup`, `store-backup` y `backup-egress`;
  el riesgo residual del almacén con el lector del respaldo; la variable nueva en «`.env.staging`». Verificar con
  `node -e` que ya no dice «sus datos no tienen copia» y sí cada afirmación nueva.
- [ ] 8.2 [infra] `infra/backup/README.md`: qué se respalda, cuándo, dónde, el modelo de protección medido, el plazo
  máximo de D7 en semanas, las clases de falla y qué hacer con cada una. `docs/RUNBOOK.md`, «Operar staging»:
  respaldo a mano, restauración, ensayo mensual, poda y verificación fuera del host desde la PC (órdenes con variables,
  sin valores). Verificar con `node -e` que cada sección existe y que el plazo en semanas coincide con el de design D7.
- [ ] 8.3 [infra] `docs/despliegue/RUNBOOK-DESPLIEGUE.md`: fases 8 y 9, «Respaldos», «Volver atrás» y «Mantenimiento»
  con los nombres finales de servicios, variables y scripts, y la línea «No terminado hasta C1» sustituida por el
  estado real al cierre. Verificar con `node -e` que cada nombre del runbook existe en el árbol (`infra/backup/…`) o en
  `.env.example`.
- [ ] 8.4 [infra] Entrada `staging-sin-copias` en `tools/repo-checks/src/claims.registry.mjs` (design D14): patrones
  «sin copias» y «desechable» en `infra/README.md`, `docs/RUNBOOK.md`, `docs/despliegue/` y `apps/web/src`; símbolo que
  la desmiente, `infra/backup/run-backup.sh`. Verificar: `bash infra/ci/repo-checks.sh` en verde. **Falsación:**
  volver a escribir «sus datos no tienen copia» en `infra/README.md` → falla nombrando la entrada; restaurar.
- [ ] 8.5 [infra] Notas para 35b, sin editar `openspec/changes/staging-host/`: (1) el texto nuevo de su 9.10 (copias
  cifradas fuera del host, plazo máximo de D7, que el borrado de cuenta desaparece de las copias en ese plazo);
  (2) que este change modifica sus dos requirements de `platform/production-deploy` y se archiva después (D14). Se le
  pasan a la sesión dueña de 35b. En el PR de fusión de este change, anotar en el `scope` de `staging-host` de
  `openspec-changes.yaml` que las copias de datos pasaron a `staging-backups` (ADR-066). Verificar: la nota citada en
  la descripción del PR y `node -e` sobre `openspec-changes.yaml` que encuentra «staging-backups» en el `scope` de
  `staging-host`.

## 9. Aviso de privacidad (design D7)

- [ ] 9.1 [frontend] `/privacidad`, sección de borrado: un párrafo nuevo con id i18n nuevo (`@@privacy.deletion.backups`)
  que dice que las copias de seguridad cifradas fuera del servidor conservan los datos borrados hasta el plazo máximo de
  D7 y que después desaparecen; catálogo re-extraído con `pnpm nx run web:extract-i18n` y traducción en
  `messages.en.xlf` (ADR-050). Test en `privacy.page.spec.ts`: «renders the backup retention notice with the documented
  maximum» (busca el número de semanas de D7). Verificar: `pnpm nx run web:test` con ese spec y
  `pnpm nx run web:i18n-check` en verde.

## 10. Despliegue y ensayo en el host (después de fusionar; design D13, D15; fases 8 y 9 del runbook)

- [ ] 10.1 [infra] **Owner:** secretos del respaldo en `.env.staging` (generados con las órdenes de `.env.example`) y
  la copia fuera del host actualizada (regla de 35b 5.8, sumas comparadas con `node`). Verificar:
  `node infra/ci/check-env-file.mjs .env.staging docker-compose.prod.yml .env.example infra/backup/docker-compose.backup.yml`
  sale 0 en el host.
- [ ] 10.2 [infra] Despliegue del commit del change por el camino normal; `mongo` y `object-store` recreados (D15) y
  smoke en verde; 9.4 de `e2e-suite` sobre el hash desplegado (D1). Verificar: reporte de la corrida, `CreatedAt` nuevo
  de los dos servicios y el id de la corrida de la 9.4 en la descripción del PR.
- [ ] 10.3 [infra] **Owner:** instalar las unidades con `sudo` según `infra/README.md`. Verificar: `systemctl
  list-timers linkvault-backup@*` volcado a fichero y leído con `node` muestra el siguiente disparo.
- [ ] 10.4 [infra] Primer respaldo a mano en el host (`systemctl start linkvault-backup@<usuario>.service`, o
  `run-backup.sh`). Verificar: `restic snapshots --tag run:<id>` en cada destino (desde `backup-push`) lista las tres
  instantáneas; el monitor muestra `start` y éxito; el tamaño de cada repositorio queda anotado.
- [ ] 10.5 [infra] Falsaciones en el host (fase 8, paso 9 del runbook): desde `backup-push`, `api` no resuelve; el
  usuario de respaldo no inserta; la identidad S3 de respaldo no sube ni borra; la credencial del host no destruye un
  paquete; `BACKUP_MAX_REPO_BYTES=1` hace fallar con `size_cap` y llega el correo del monitor. Y el pedido anónimo al
  listado del bucket de OCI no da `200` (fase 8, paso 8). Verificar: las salidas, anotadas en el PR de archivo.
- [ ] 10.6 [infra] **Owner:** aviso de respaldo faltante (fase 8, paso 10): Claude desactiva el timer una noche, llega
  el correo del monitor, se reactiva. Y un reinicio del host deja el timer programado (`list-timers`). Verificar:
  confirmación del owner y la salida de `list-timers` tras el reinicio.
- [ ] 10.7 [infra] Dos noches seguidas: cada destino lista corridas con manifiesto de dos días distintos; las peticiones
  de OCI Object Storage de esa semana, leídas en la consola por el owner y anotadas (R3). Verificar: listado y cifra en
  el PR de archivo.
- [ ] 10.8 [infra] Ensayo de restauración en el host (fase 9, paso 1): `restore-drill.sh` sobre la última corrida, con
  el volumen existente y **sin** «Replace boot volume». Verificar: cuentas, links y CV de las cuentas de prueba
  leídos; conciliación sin faltantes; RTO anotado en `infra/backup/README.md`; `CreatedAt` de staging igual antes y
  después; `docker compose ls` y `docker volume ls` sin `linkvault-restore`.
- [ ] 10.9 [infra] **Owner:** primera sesión mensual desde la PC (D6): `restic snapshots` de cada destino con la
  continuidad de corridas esperada y la poda de prueba con la credencial de poda (sin nada que podar todavía, termina en
  0); recordatorio mensual creado (ensayo, poda, verificación y costo). Verificar: confirmación del owner y la fecha del
  recordatorio.

## 11. Cierre

- [ ] 11.1 [infra] `pnpm exec openspec validate --all --strict --no-interactive`, `bash infra/ci/repo-checks.sh` y
  `pnpm nx affected -t lint,typecheck,test,i18n-check` en verde. Verificar: salidas anotadas en el PR.
- [ ] 11.2 [infra] Revisión a las dos semanas con invitados (Q4 de la decisión): tamaño de cada repositorio, peticiones
  de OCI del mes y si el intervalo nocturno sigue bastando; la decisión del owner, anotada con fecha en ADR-066.
  Verificar con `node -e` que ADR-066 contiene «Revisión del intervalo (Q4 de la decisión), 20».
- [ ] 11.3 [infra] Al archivar (después de 35b, D14): ADR-066 pasa a «Aceptado» con la fecha y el PR; la línea «No
  terminado hasta C1» del runbook y de la decisión se sustituye por el estado; `despliegue.json`, condiciones 1-5 y 8
  marcadas. Verificar con `node -e` sobre los tres ficheros.

## 12. Fusión (design D1)

- [ ] 12.1 [infra] **Fusiones de clase 1** (la del change y cualquier correctiva antes de la 10.7), comprobadas justo
  antes de cada una: (1) confirmación escrita y fechada del owner en el PR, «PR-2 de 35b = #NN; 11.6 hecha el
  AAAA-MM-DD; 10.7 no hecha; sin `e2e-remote` hoy»; (2) `git log --first-parent --oneline origin/main` volcado a
  fichero con el merge del PR-2 de 35b y ese número; (3) «en ventana» solo si el PR-2 está en `main`, la 11.6 hecha y la
  10.7 no; (4) después de desplegar, la 9.4 de `e2e-suite` sobre el hash desplegado, con el hash y el id de la corrida
  en la descripción del PR; (5) la 10.7 solo procede con la 9.4 en verde sobre el **último** hash desplegado de
  cualquier fusión de clase 1 (de este change o de `enrichment-egress-guard`). Verificar: los cinco puntos en la
  descripción de cada PR. **Falsación** de escritorio, nunca como comentario del PR: aplicar la regla a una
  confirmación de prueba con la 10.7 hecha, con la 11.6 no hecha y con un número de PR-2 que no coincide, y obtener
  «fuera de ventana» en las tres.
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
| backups · Un volcado interrumpido no deja una corrida válida | `run-backup: mongo dump failure leaves no manifest and pings fail mongo_dump` | 4.7a; 4.4 |
| backups · Un destino caído no impide el otro | `run-backup: failing oci destination still completes offsite and pings fail push_oci` | 4.7b; 4.5 |
| backups · El lector de la base no sale a Internet ni ve a la API | `isolation: backup-mongo resolves mongo but not api and has no egress` | 2.5; 10.5 |
| backups · El que envía no alcanza los datos | `isolation: backup-push cannot resolve mongo, object-store or api` | 2.5; 10.5 |
| backups · El worker no ve a los procesos del respaldo | `isolation: worker cannot resolve backup services` | 2.5 |
| backups · Una configuración que mezcla datos y salida rompe la comprobación | `backup-isolation: backup service on data and egress networks fails` | 2.3 |
| backups · El usuario de respaldo no puede escribir | `mongo backup user insert is unauthorized` | 3.1; 10.5 |
| backups · El usuario de respaldo existe sobre un volumen viejo | `ensure-backup-user creates the user on a pre-existing volume` | 3.1 |
| backups · La identidad S3 de respaldo no puede escribir ni borrar | `s3 backup identity can list and get but not put or delete` | 3.2; 10.5 |
| backups · La credencial del host no destruye un paquete | `host credential cannot permanently delete a pack` | 1.5a; 1.5b; 10.5 |
| backups · La poda con la credencial de poda aplica la retención | `prune credential applies keep-daily 7 keep-weekly 4` | 1.5a; 1.5b; 10.9 |
| backups · Un destino con versionado sin ciclo de vida se rechaza | `destination with versioning and no noncurrent expiry is not apt` | 1.1; 1.3; 1.4 |
| backups · Un tope menor que el tamaño actual hace fallar el respaldo | `run-backup: size cap below repo size pings fail size_cap and skips push` | 4.7b; 4.6; 10.5 |
| backups · Una falla avisa con su clase | `run-backup: fail ping carries run id and class only` | 4.7a; 4.7b |
| backups · Un respaldo que no corre produce un aviso | `monitor emails when no success arrives in its window` | 10.6 |
| backups · Tras reiniciar el host el respaldo sigue programado | `timer stays scheduled after host reboot` | 10.6 |
| backups · Dos corridas no se solapan | `run-backup: second run exits lock_busy without backing up` | 4.7a |
| backups · Restaurar no deja a la base sin usuario raíz | `restore keeps root user and ensures backup user on a fresh volume` | 6.1 |
| backups · Una corrida con sumas que no coinciden no se restaura | `restore refuses a run whose mongo stream hash mismatches before stopping services` | 6.1 |
| backups · El trabajo en vuelo al volcar se vuelve a publicar | `requeue-outbox marks events published in the window as pending and skips failed` | 6.3 |
| backups · El informe de conciliación sale aunque no haya diferencias | `restore prints a zero reconciliation report` | 6.4 |
| backups · El ensayo restaura sin tocar staging | `restore-drill fails if a staging container CreatedAt changes` | 6.6; 10.8 |
| backups · El override de restauración no publica nada | `backup-isolation: restore override has no ports, no egress and no shared volumes` | 6.2 |
| backups · El ensayo no deja restos | `restore-drill leaves no linkvault-restore project or volume` | 6.6; 10.8 |
| backups · Restaurar un repositorio remoto fuera del host se rechaza | `restore refuses a remote repository outside the host` | 6.5 |
| backups · Falta una variable del respaldo | `check-env-file names each missing backup variable without printing values` | 7.2 |
| backups · Ninguna credencial en los argumentos | `run-backup: no secret value appears in docker or curl argv` | 4.7b |
| object-store · El lector del respaldo alcanza el almacén y nada más | `isolation: backup-objects lists buckets and has no egress` | 2.5; 3.2 |
| object-store · El que envía los respaldos no alcanza el almacén | `isolation: backup-push cannot resolve object-store` | 2.5 |
| object-store · (escenarios existentes) | sin cambios; `backup-isolation` comprueba las redes | 2.3 |
| production-deploy · La reconstrucción reinstala el respaldo | `README rebuild section installs the backup timer` | 5.2 |
| production-deploy · Lo que se pierde con el host está escrito | `README host-only section states backup, RPO and what has no copy` | 8.1; 8.4 |
| production-deploy · El lector del respaldo alcanza el almacén sin salir a Internet | igual que el de object-store | 2.5; 10.5 |
| web/privacy · El aviso dice cuánto duran los datos borrados en las copias | `renders the backup retention notice with the documented maximum` | 9.1 |
