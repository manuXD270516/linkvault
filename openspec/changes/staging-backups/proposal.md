## Why

El 2026-11-18 el owner aprobó la estrategia de despliegue (`docs/despliegue/DECISION-DESPLIEGUE.md`: Oracle Cloud
Always Free con Docker Compose) y respondió sus Q1-Q6 con las recomendaciones. La decisión dice, arriba de todo: **«No
terminado hasta C1: sin respaldo fuera de Oracle ni restauración probada»**. Este change es ese C1.

Hoy staging es **desechable y sin copias** (ADR-051 §2, `infra/README.md` «Qué vive solo en el host»): si se pierde el
host, o se reemplaza su volumen de arranque, se pierden todas las cuentas, links, postulaciones y CV. Con 3 a 5
invitados reales eso deja de ser aceptable: una caída de horas se tolera; **perder datos, no** (perfil del despliegue).
La regla de corte 7 del runbook lo hace explícito: **no se invita sin respaldo probado**, y la 10.7 de 35b (invitar)
espera a este change.

El panel de la decisión encontró además que el respaldo «obvio» no sirve:

- un timer del host no llega al almacén, cuyas redes son internas y solo tienen a `api` y `worker`; y un proceso con
  Mongo, el almacén **e** Internet sería el más privilegiado de la pila y desharía el aislamiento por proceso de D18 de
  35b (H1);
- quien compromete el host podría borrar los respaldos con la misma credencial que los escribe, y un bucket con
  versionado sin ciclo de vida acumula y cobra (H2, H3);
- la copia fuera de Oracle era manual y sin alarma (H6), y la restauración estaba subespecificada: el usuario raíz de
  Mongo, el usuario de respaldo sobre un volumen viejo, la clave del almacén (H7);
- los eventos del outbox ya relevados a Redis no se reenvían si Redis se pierde (hallazgo del critic sobre
  `gestionado-gratis`, que también aplica a una restauración).

## What Changes

- **Respaldo nocturno cifrado fuera del host, en dos destinos** (Q2 y Q4 de la decisión): un bucket privado de OCI
  Object Storage y un destino fuera de Oracle, el (a) de Q2 —almacenamiento de objetos gratuito, sin tarjeta y con
  bloqueo de objetos— si se verifica, y si no el (b), un Google Drive dedicado. Cada noche, `mongodump --oplog` primero
  y los objetos de CV y snapshots después, en `restic`, sin texto en claro en disco, y un **manifiesto** que hace válida
  la corrida. RPO de 24 h, aceptado (Q4), con revisión a las dos semanas con invitados.
- **Procesos del respaldo que no deshacen D18**: dos lectores efímeros sin salida a Internet (uno con Mongo, otro con
  el almacén) y un empujador sin acceso a los datos, unidos por una tubería en el host. Ninguno comparte red con `api` ni
  con `worker`. Usuario de Mongo de solo lectura (rol `backup`) e identidad S3 de solo lectura propia.
- **Borrado protegido**: la credencial que vive en el host no puede destruir respaldos antes de la ventana de
  protección; nada de versionado sin ciclo de vida; la poda la corre una credencial que **no** vive en el host.
  Retención de 7 diarios y 4 semanales (Q3).
- **Tope de tamaño** que hace fallar el respaldo y avisa, por debajo de los 10 GB por nivel de Always Free.
- **Aviso de respaldo faltante o fallido** con un monitor de pings gratuito (`BACKUP_PING_URL`).
- **Programación** con un timer de systemd del host que sobrevive a reinicios y se rehace desde `infra/README.md`.
- **Restauración** (`infra/backup/restore.sh`) sin `admin.*`, con reencolado del outbox y un informe de conciliación;
  **ensayada en el host**, en un proyecto de Compose aparte y con un override sin Traefik, sin puertos, sin salida y sin
  `worker`, **antes de invitar y después cada mes**, nunca en la PC del owner.
- **Aviso de privacidad** (`/privacidad`) y aviso a los invitados: los datos borrados siguen en las copias cifradas
  hasta un plazo máximo escrito.
- **ADR-066**, que enmienda ADR-051 §2 («sin copias»), `infra/README.md` «Qué vive solo en el host» y el riesgo
  residual del almacén de ADR-052 (un tercer proceso, sin salida, alcanza sus interfaces internas).

## Fuera de alcance

- **Q5 de la decisión (exención de inactividad en pago por uso):** la resuelve el owner (regla de corte 6 del runbook).
- **Q6 de la decisión (SSH endurecido):** va en 35b, junto a su 5.4 y al ensayo de reconstrucción.
- **Respaldar Redis:** guarda colas y caché; el outbox lo repone (design D12).
- **Respaldo de `.env.staging`:** ya lo cubre la copia fuera del host de 35b 5.8; aquí solo se suman variables a ella.
- **Respaldo continuo o con RPO menor a 24 h**, réplicas de Mongo y alta disponibilidad: el owner tolera caídas de horas.
- **`cd-prod`** y cualquier host de producción.
- **Tocar `apps/api`, `apps/worker` o `libs/**`:** el change solo toca `apps/web` (el texto de `/privacidad`).

## Capabilities

### New Capabilities

- `platform/backups`: respaldo cifrado fuera del host, sus procesos y credenciales, su protección contra el borrado,
  su aviso y su restauración ensayada.

### Modified Capabilities

- `platform/object-store`: «Solo la aplicación alcanza el almacén por la red» admite al lector de objetos del respaldo,
  sin salida a Internet y con identidad de solo lectura.
- `platform/production-deploy`: los dos requirements que añade 35b dejan de declarar staging como desechable y suman
  al lector del respaldo como tercer proceso que alcanza el almacén. **Este delta se aplica después de archivar 35b**
  (design D14).
- `web/privacy`: el aviso dice que las copias de seguridad cifradas conservan los datos borrados hasta un plazo máximo.

## Impact

- **Ficheros nuevos:** `infra/backup/` (scripts, compose del respaldo, override de restauración, unidades de systemd,
  pruebas), una comprobación de `tools/repo-checks` y una entrada del registro de afirmaciones.
- **Ficheros modificados:** `docker-compose.prod.yml` (dos redes internas y el usuario de respaldo de Mongo),
  `infra/deploy/config-files.txt`, `infra/ci/verify.env`, `infra/ci/check-env-file.mjs`, `.env.example`,
  `infra/README.md`, `docs/RUNBOOK.md`, `docs/despliegue/RUNBOOK-DESPLIEGUE.md`, `apps/web` (texto de `/privacidad`
  y catálogo i18n) y los ADR anotados.
- **Despliegue:** el primer despliegue de este change **recrea `mongo` y `object-store`** porque cambian sus redes: un
  corte de uno o dos minutos, dentro de la ventana de fusión (design D15).
- **Cuentas del owner:** dos destinos de respaldo, un monitor de pings y, si Q2 cae en (b), una cuenta de Google
  dedicada. Ninguna con cobro posible; si alguna lo pide, decide el owner.
- **Secuencia:** excepción a la precedencia de la fila 35 concedida por el owner el 2026-11-18 (Q1 de la decisión);
  se fusiona después de la 11.6 de 35b y antes de su 10.7, como `enrichment-egress-guard` (ADR-066 §1).
