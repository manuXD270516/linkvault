# Respaldo de staging (ADR-066)

Respaldo cifrado de los datos de staging **fuera del host**, en dos destinos independientes, con borrado protegido y
restauración ensayada. Decisiones y su porqué: [`openspec/changes/staging-backups/design.md`](../../openspec/changes/staging-backups/design.md)
y [ADR-066](../../docs/adr/ADR-066.md). Cómo se instala el timer: [`infra/README.md`, «Respaldo programado»](../README.md#respaldo-programado).
Cómo se opera (restaurar, sesión mensual, recuperar tras un borrado): [`docs/RUNBOOK.md`](../../docs/RUNBOOK.md), «Operar staging».

## Qué se respalda, cuándo y dónde

| Qué | Cómo | Dónde |
|---|---|---|
| Base de datos entera (Mongo) | `mongodump --archive --gzip` (sin `--oplog`) con el usuario de respaldo (rol `backup`, solo lectura) | instantánea `kind:mongo` |
| Objetos de los dos buckets (`cvs` y `snapshots`) | `rclone copy` al `tmpfs` del lector y `tar` | instantánea `kind:objects` |
| Manifiesto de la corrida | JSON con identificador, horas del volcado, bytes y SHA-256 de cada flujo medidos **en el host**, objetos por bucket con sus cabeceras y digests de las imágenes | instantánea `kind:manifest` |

- **Cuándo:** cada noche a las 06:30 UTC (≈ 03:30 en Argentina). **RPO de 24 h** (aceptado el 2026-11-18).
- **Dónde:** dos destinos, cada uno con su pasada completa y el mismo identificador de corrida: `oci` (bucket privado de OCI
  Object Storage, dentro de la cuenta de Oracle) y `offsite` (fuera de Oracle). Si uno falla, el otro sigue.
- **Cifrado:** `restic`, con `RESTIC_PASSWORD`, que no vive en ningún destino (solo en `.env.staging` y su copia).
- **Retención:** 7 diarias y 4 semanales; la poda es **mensual y desde la PC del owner** con la credencial de poda, nunca desde el host.
- **No se respalda:** Redis (colas y caché; el outbox repone lo publicado poco antes del volcado), `.env.staging` (tiene su
  copia aparte) y `acme.json`.
- **Una corrida vale solo si deja su manifiesto.** Si el volcado se corta, restic puede dejar una instantánea parcial de ese
  flujo, pero sin manifiesto: `restore.sh` solo parte de corridas con manifiesto cuyas sumas coinciden.

## Plazo máximo de un dato borrado en las copias

<!-- plazo-maximo --> **Lo que se borra de la aplicación sigue en alguna copia hasta 14 semanas** (peor caso: la última instantánea
que lo contiene sigue como semanal, 34 días; hasta la poda mensual, 31 días; y la ventana de protección del borrado, 30 días =
95 días). Con Google Drive como destino de fuera, la papelera suma 30 días (hasta 18 semanas). Ese número es el mismo en este
README, en `docs/RUNBOOK.md` y en `/privacidad` (`@@privacy.backups.retention`), y la comprobación `backup-retention-claim` de
`tools/repo-checks` falla si difieren. El valor final lo fijan Q1 y Q2 del change y la 1.1 del owner (destino de fuera de Oracle).

## Modelo de protección contra el borrado (design D6)

La credencial del destino que vive en el host puede crear, leer, listar y «borrar» (en un bucket versionado eso deja un marcador:
la versión queda retenida), pero **no** puede borrar versiones, suspender el versionado, cambiar el ciclo de vida ni tocar la
retención. El bucket tiene versionado, retención de 30 días **sin bloquear** (el owner, con su usuario administrador, puede
quitarla; un bucket con retención se vacía quitando primero la regla) y una regla de ciclo de vida que expira las versiones no
actuales a los 31 días. **Nunca versionado sin ciclo de vida.** Qué modelo admite cada destino se **mide** con las tareas 1.5a y
1.5b (las hace el owner con sus cuentas): **pendiente**.

> Con Drive como destino de fuera (Q4 del change) esa copia no tiene borrado protegido frente al host.

## Clases de falla del respaldo y qué hacer

El monitor recibe `start`, éxito o `fail` con el identificador de la corrida y la clase (nunca datos). Cada falla nombra la clase y,
si aplica, el destino (`push_oci`, `mongo_dump@offsite`).

| Clase | Qué pasó | Qué hacer |
|---|---|---|
| `lock_busy` | hay otro respaldo, restauración o ensayo en curso | nada si es un ensayo a propósito; si no, ver `systemctl status` y el candado `/srv/linkvault-staging/.backup.lock` |
| `stack_unhealthy` | `mongo` u `object-store` no llegaron a sanos en 10 min | mirar `docker compose ps`; ¿un despliegue dentro de la franja 06:15-08:45 UTC? la noche siguiente respalda normal |
| `images` | `pull` o la plataforma de las imágenes del respaldo | `bash infra/deploy/check-image-platforms.sh --platform linux/arm64 <imágenes>`; el registro puede estar limitando |
| `ensure_user` | no se pudo asegurar el usuario de respaldo de Mongo | revisar `MONGO_BACKUP_*` y el entorno de `mongo` |
| `mongo_dump` | el volcado de la base falló o se cortó | sin manifiesto de esa corrida; ver el estado de `mongo` y repetir a mano |
| `objects_read` | el lector de objetos falló | ver `object-store` y repetir |
| `objects_too_large` | los objetos pasan de `BACKUP_OBJECTS_MAX_BYTES` (1 GiB por defecto) | subir el tope **con cuidado**: es memoria del host (`tmpfs`) |
| `size_cap` | el repositorio de ese destino pasa de `BACKUP_MAX_REPO_BYTES` (4 GiB) | sin enviar nada a ese destino: podar (sesión mensual) o decidir con el owner; el nivel gratuito de OCI es de 10 GB |
| `push_oci` / `push_offsite` | no se pudo enviar al destino | credencial, red o cuota del destino; el otro destino ya tiene su corrida |
| `manifest` | no se pudo guardar el manifiesto | la corrida de ese destino no cuenta como respaldo; repetir |
| `prune_overdue` | la instantánea más vieja de un destino tiene más de 65 días | **el respaldo ya se hizo**: es el recordatorio de la sesión mensual (podar) |

## Cuenta permanente de ensayo y tiempos medidos

El ensayo (`restore-drill.sh`) comprueba por la API del proyecto aparte el login, los links y el CV de una **cuenta permanente
de ensayo con datos sintéticos**, que se crea una vez en staging (tarea 10.8, la hace el owner).

- `userId` de la cuenta de ensayo: **pendiente** (10.8). Se le pasa a 35b para excluirla de su medición, como a las cuentas E2E.
- **RTO medido** (tiempo del ensayo, del `up` del proyecto aparte a la cuenta comprobada):

| Dónde | Datos | RTO |
|---|---|---|
| Desarrollo (Docker Desktop, base y objetos sintéticos pequeños, repositorio local) | 3 links y 1 CV | 58 s |
| Host de staging (fase 9 del runbook) | — | **pendiente** (10.9) |

## Piezas de este directorio

| Fichero | Para qué |
|---|---|
| `docker-compose.backup.yml` | los servicios efímeros: `backup-mongo`, `backup-objects`, `restore-objects`, `backup-push` (sin registros, sin datos y salida a la vez) |
| `docker-compose.restore.yml` | el override del ensayo de restauración (`-p linkvault-restore`) |
| `run-backup.sh` / `test-run-backup.sh` | el orquestador de la corrida y su prueba con `docker`, `curl` y `flock` falsos |
| `restore.sh`, `restore-drill.sh` | restaurar un respaldo y ensayarlo en el host |
| `requeue-outbox.{js,sh}` | volver a poner como pendientes los eventos del outbox publicados desde una hora |
| `ensure-backup-user.js` | crea o actualiza el usuario de respaldo de Mongo (idempotente) |
| `dump-mongo.sh`, `read-objects.sh`, `list-objects.sh`, `load-objects.sh` | lo que corre dentro de cada servicio |
| `systemd/` | la unidad y el timer del host |

La **Q3** quedó resuelta en (b) (design D3): el lector de objetos usa la identidad S3 de la aplicación, efímero y sin salida. Esa identidad
puede escribir, así que `backup-isolation` y `test-run-backup.sh` vigilan que sus scripts solo lean. Con SeaweedFS 4.47 la API de
identidades arranca en solo lectura y una identidad propia exigiría cambiar `command` del almacén (medición 1.7: design D3, «Medido»).
