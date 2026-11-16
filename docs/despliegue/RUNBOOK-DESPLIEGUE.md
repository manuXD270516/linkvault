# Runbook: desplegar LinkVault en Oracle Cloud Always Free (consolidación)

**Destino:** una VM Ampere A1 Always Free (2 OCPU / 12 GB, Ubuntu 24.04 `aarch64`) con `docker-compose.prod.yml`
(Traefik, Mongo con replica set, Redis, SeaweedFS cifrado, `api`, `worker` y `web`), en
`https://<ip-con-guiones>.sslip.io` con certificado de Let's Encrypt. Costo: 0 USD por mes, sostenido por las reglas de
corte de costo de la [fase 1](#fase-1-cuenta-y-reglas-de-costo-vos).

**Estado al 2026-11-16:** sin desplegar. El destino está a medio preparar por el change `staging-host` (35b). La
decisión de plataforma y sus condiciones están en [DECISION-DESPLIEGUE.md](DECISION-DESPLIEGUE.md).

**Este runbook no repite el de Oracle.** Los pasos de consola están en
[`docs/runbooks/oracle-cloud-a1.md`](../runbooks/oracle-cloud-a1.md) (citado como «runbook de Oracle §N»), cómo está
montado el host en [`infra/README.md`, «Destino de staging real»](../../infra/README.md#destino-de-staging-real) y cada
verificación en las tareas de [`openspec/changes/staging-host/tasks.md`](../../openspec/changes/staging-host/tasks.md)
(citadas por número, «35b 5.2»). Acá va el orden, lo que ya está hecho y lo **nuevo**: las reglas de corte de costo, el
respaldo y lo que endurece el plan.

| Símbolo | Quién lo hace |
|---|---|
| **Vos** | El owner: cuentas, inicios de sesión, medios de pago, secretos y consolas web |
| **Claude** | Un agente, cuando se lo pidas, con tu confirmación antes de cada despliegue |

## Dónde estamos

| Pieza | Estado | Evidencia |
|---|---|---|
| CD `arm64` que construye, verifica y publica por digest | **Hecho y verificado** | Corrida `42344081533` de `cd-staging` (2026-11-07, push de PR-1b): «artefacto verificado — NO desplegado (sin destino de staging)» |
| Guardias del despliegue, SSH nativo con clave del host fijada, configuración del mismo commit, correo SMTP autenticado | **Hecho** | PR-1 (#86); 35b grupos 1-4 y 7.1-7.8 |
| Compose de producción con redes por proceso, Redis y Mongo con contraseña, almacén con `-disableHttp`, guardia de salida en `smoke.sh` | **Hecho** | PR #92 y #93; 35b 12.1-12.6 |
| VM de Oracle | Falta, **Vos** | 35b 5.2-5.6 y 12.7 |
| Pago por uso (decisión) | Falta, **Vos** | 35b 5.10 |
| Cuenta de Brevo | Falta, **Vos** | 35b 7.9 |
| Lista de invitados y entrevistas | Falta, **Vos** | 35b 9.7 y 10.1 |
| `.env.staging` y su copia fuera del host | Falta, **Vos con Claude** | 35b 5.7-5.8 |
| Reglas de corte de costo (cuotas, alertas, estimador) | **Nuevo** | Fase 1 de este runbook |
| Change de respaldo (contenedor dedicado, dos destinos, aviso, restauración ensayada) | **Nuevo** | Cambio C1 de la decisión; fase 7 |
| SSH endurecido | **Nuevo** | Cambio C3; fase 2 |
| Filtro de salida del worker (`enrichment-egress-guard`) | Implementado en su rama, **sin fusionar** | Cambio C2; fase 8 |

**Plazo que corre:** el primer despliegue relanza el `preflight` de la corrida `42344081533` (35b 6.3), y GitHub lo
permite hasta 30 días después de creada: **hasta el 2026-12-07**. Pasado ese día vale la alternativa escrita de 6.3
(una corrida nueva sobre `main`).

## Reglas de corte

Parate y no sigas si pasa algo de esto:

1. **Oracle pide un pago, muestra un cargo distinto de 0 o no da capacidad A1** tras el protocolo de 35b 5.2 (45 minutos
   por sesión, tres días). Se pasa al plan B ([Salir de Oracle](#salir-de-oracle-hacia-el-plan-b)).
2. **La instancia no es exactamente 2 OCPU y 12 GB**, aunque la consola ofrezca más. Con pago por uso, crear 4/24
   cobraría.
3. **El estimador de costos muestra un importe distinto de 0** para algún recurso del plan (A1 2/12, volumen de
   arranque, IP reservada, Object Storage por debajo de 10 GB) **antes** de pasar a pago por uso.
4. **Una alerta de presupuesto o de pronóstico se dispara.** Se busca el recurso en *Cost Analysis*, se borra, y no se
   sigue hasta que el pronóstico vuelva a 0.
5. **Una verificación de seguridad de la fase 5 da otro resultado** (ruta protegida sin `401`, puerto de datos abierto,
   `/metrics` público, dirección de metadatos alcanzable).
6. **La exención de inactividad no está confirmada** (Q5 de la decisión) al llegar a la fase 10: o se confirma, o se
   acepta el riesgo por escrito, o plan B.
7. **El respaldo no corrió, no avisó o no se pudo restaurar** en la fase 7 o en la 8. No se invita sin respaldo probado.
8. **Un destino de respaldo tiene versionado sin regla de ciclo de vida**, o la credencial que vive en el host puede
   borrar instantáneas.
9. **Aparece un dato real o un secreto** en un archivo versionado, en un comando guardado en el historial o en el
   chat.

No entran datos reales (invitados) hasta terminar la fase de prueba con datos ficticios y la fase 8.

## Valores que vas a necesitar

| Valor | Forma | Dónde vive |
|---|---|---|
| URL de la aplicación | `https://<ip-con-guiones>.sslip.io` | `PUBLIC_HOST` en `.env.staging`; se anota en `infra/README.md` (35b 5.7) |
| IP pública reservada | `<a.b.c.d>` | Consola de Oracle; `infra/README.md` (35b 5.2) |
| Seis secretos del CD | `STAGING_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_SSH_HOST_KEY`, `GHCR_READ_USER`, `GHCR_READ_TOKEN` | Secretos de GitHub del repositorio (35b 6.1) |
| Secretos de la aplicación | `AUTH_JWT_SECRET`, `AI_VAULT_KEY`, `OBJECT_STORE_SSE_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `REDIS_PASSWORD`, `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`, `VAPID_PRIVATE_KEY`, `MAIL_SMTP_USER`, `MAIL_SMTP_PASSWORD`, `OPENROUTER_API_KEY` | `/srv/linkvault-staging/.env.staging` (permisos `600`) y su copia en tu gestor de contraseñas (35b 5.8) |
| Secretos del respaldo (nuevos) | `RESTIC_PASSWORD`, credenciales de los dos destinos, usuario de Mongo de respaldo, identidad S3 de respaldo, `BACKUP_PING_URL` (nombres finales en el change C1) | `.env.staging` y su copia fuera del host. Sin `RESTIC_PASSWORD` los respaldos no se descifran |
| Credencial de poda de respaldos (nueva) | Clave del destino con permiso de borrar | Solo tu gestor de contraseñas, **nunca** en el host |
| Región de origen | por ejemplo `sa-saopaulo-1` | Consola de Oracle; `infra/README.md`. Irreversible |

Los comandos de tu PC usan Git Bash desde la raíz del repositorio. Los del host corren por SSH, en `bash`, desde
`/srv/linkvault-staging`. En los del host, `<sha12>` es el commit desplegado (`docker compose … images` lo muestra).

```bash
BASE=https://<ip-con-guiones>.sslip.io
```

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.staging"
```

## Fase 0: repositorio listo (Claude)

Ya está casi todo hecho; se comprueba que siga así.

1. CI de `main` en verde:

   ```bash
   gh run list --workflow ci.yml --branch main --limit 1
   ```

2. La corrida que va a desplegar sigue disponible y en verde:

   ```bash
   gh run view 42344081533 --json conclusion,createdAt,headSha
   ```

3. Comprobaciones del repositorio, que incluyen el contrato de variables y el compose:

   ```bash
   bash infra/ci/repo-checks.sh
   ```

4. El repositorio es público: ningún secreto versionado (35b 1.2 lo comprobó; se repite si cambió algo).

**Terminada cuando:** el CI de `main` está en `success`, la corrida `42344081533` dice `success` con fecha
2026-11-07 y `repo-checks.sh` sale 0.

## Fase 1: cuenta y reglas de costo (Vos)

1. **Cuenta y MFA:** runbook de Oracle §0-2. La región de origen es definitiva.
2. **Estimador, antes de cualquier pago por uso (nuevo).** En el [estimador de costos de Oracle](https://www.oracle.com/cloud/costestimator.html),
   cargá exactamente lo del plan: A1 con 2 OCPU y 12 GB, un volumen de arranque de 50 a 100 GB, una IP pública
   reservada y Object Storage Standard por debajo de 10 GB. Anotá fuera del repositorio el total. **Si no es 0, regla
   de corte 3.**
3. **Pago por uso (35b 5.10, decisión tuya).** El panel recomienda pasar, para tener prioridad de capacidad A1 y
   evitar la reclamación por inactividad (que esa exención exista es la Q5). Runbook de Oracle §11 y §13.2, con dos
   correcciones: en pago por uso **no** hay 4/24 gratis (la cifra es 2/12 para todas las cuentas), y el presupuesto se
   crea con las dos alertas del paso 4. Si decidís no pasar, anotá por escrito que aceptás el riesgo de reclamación.
4. **Presupuesto con dos alertas (endurece §11).** *Billing & Cost Management → Budgets → Create Budget*, sobre el
   tenancy, importe 1 en la moneda de la cuenta. Dos reglas de alerta por correo: una de tipo **real** al 100 % y una
   de tipo **pronóstico** al 100 %.
5. **Cuotas de compartimento (nuevo).** *Governance & Administration → Quota Policies → Create Quota Policy*, en el
   compartimento raíz. Lo que se busca: cero en toda familia de cómputo salvo A1, A1 con tope de 2 OCPU y 12 GB, y
   volúmenes con tope de 200 GB. Una forma de escribirlo (los nombres exactos de cada cuota se confirman en la vista
   previa de la consola o en *Limits, Quotas and Usage*; si alguno no existe, se busca su nombre ahí):

   ```text
   zero compute-core quotas in tenancy
   set compute-core quota standard-a1-core-count to 2 in tenancy
   zero compute-memory quotas in tenancy
   set compute-memory quota standard-a1-memory-count to 12 in tenancy
   set block-storage quota total-storage-gb to 200 in tenancy
   ```

   Las cuotas no frenan los GB ni las peticiones de Object Storage: eso lo vigila el respaldo con su tope de tamaño
   (fase 7) y la revisión mensual de consumo ([Mantenimiento](#mantenimiento)).
6. **Exención de inactividad (Q5).** Buscá en la documentación de Always Free de Oracle, o preguntá a soporte, si una
   cuenta de pago por uso queda exenta de la reclamación de instancias inactivas. Guardá la respuesta fuera del
   repositorio, sin datos de la cuenta. No bloquea las fases 2 a 9; bloquea la 10.

**Terminada cuando:** *Budgets* muestra el presupuesto de 1 con dos reglas (real y pronóstico); *Quota Policies*
muestra la política; *Limits, Quotas and Usage* muestra disponibilidad 2 para los núcleos A1 y 0 para las demás
familias de cómputo; el total del estimador anotado es 0; la decisión de 5.10 está tomada.

## Fase 2: servidor (Vos)

1. **Crear y preparar el host:** runbook de Oracle §3-10, en orden, con su lista de comprobación. Cubre 35b 5.2-5.6
   (instancia 2/12 con IP reservada, Docker oficial, usuario `deploy`, 22/80/443 en las dos capas, clave del host
   desde la consola). Si sale «Out of host capacity», runbook de Oracle §6; tras tres días, regla de corte 1.
2. **Regla de la dirección de metadatos:** 35b 12.7 (`infra/README.md`, «Redes de la pila y dirección de metadatos»).
3. **SSH endurecido (nuevo, cambio C3).** En el host, por SSH con tu usuario de administración. Limitar quién entra
   (reemplazá `<usuario-admin>` por el tuyo, en la imagen de Oracle es `ubuntu`):

   ```bash
   echo 'AllowUsers <usuario-admin> deploy' | sudo tee -a /etc/ssh/sshd_config.d/99-linkvault.conf
   ```

   ```bash
   sudo sshd -t && sudo systemctl restart ssh
   ```

   Limitar los intentos fallidos:

   ```bash
   sudo apt-get install -y fail2ban
   ```

   Antes de cerrar la sesión, abrí **otra** y comprobá que tu usuario y `deploy` siguen entrando con su clave.

**Terminada cuando:** en tu PC tenés los datos del runbook de Oracle §12 (región, AD, `nproc` = 2, `free -g`, IP
reservada, clave pública del host) y en el host
`sudo sshd -T | grep -E '^(allowusers|passwordauthentication|permitrootlogin)'` muestra los dos usuarios,
`passwordauthentication no` y `permitrootlogin no`, y `sudo fail2ban-client status sshd` lista la jaula.

## Fase 3: secretos (Vos, con Claude)

Nunca pongas estos valores en un archivo versionado, en el repositorio ni en el chat.

1. **`.env.staging` y su copia:** 35b 5.7 y 5.8 (Claude te da los comandos de generación de `infra/README.md`; vos los
   corrés en el host y guardás la copia).
2. **Credencial del registro:** 35b 5.9 (token clásico solo con `read:packages`, con caducidad).
3. **Secretos del CD:** 35b 6.1, con PR-1 y PR-1b ya en `main` (lo están). Cada uno se carga por la entrada estándar,
   sin el valor en la línea de comandos:

   ```bash
   gh secret set STAGING_HOST
   ```

   Lo mismo con `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_SSH_HOST_KEY`, `GHCR_READ_USER` y `GHCR_READ_TOKEN`
   (para la clave privada: `gh secret set STAGING_SSH_KEY < <ruta de la clave>`).

4. **Revisión del env file en el host** (no imprime valores; comprueba las variables obligatorias del compose):

   ```bash
   cd /srv/linkvault-staging && $DC config -q
   ```

   La revisión completa (formatos y valores prohibidos en producción) es `check-env-file.mjs`, paso 2 de
   [`infra/revision-despliegue.md`](../../infra/revision-despliegue.md). Necesita el repositorio junto al archivo, y
   el script no viaja con el despliegue (`config-files.txt` no lo lleva): Claude te dice dónde correrlo sin sacar el
   archivo de un lugar seguro.

**Terminada cuando:** `gh secret list` muestra los seis nombres; la corrida de modo de prueba sobre `main` de 35b 6.1
dice `full` en el preflight y no despliega; `stat -c %a .env.staging` da `600`; la suma SHA-256 de la copia coincide
con la del original (35b 5.8).

## Fase 4: primer despliegue (Claude, con tu confirmación)

1. Corrida desde una rama fuera del modo de prueba: no despliega (35b 6.2).
2. **Primer despliegue real:** relanzar el `preflight` de la corrida `42344081533`, **antes del 2026-12-07** (35b 6.3,
   con su alternativa escrita si vence el plazo).
3. Host después del despliegue, memoria en régimen y falsaciones del token y de la clave del host: 35b 6.4-6.7.
4. Nombre y TLS: primero contra ACME *staging*, después producción (35b 6.8-6.9). Enrutado y `Referrer-Policy`: 35b
   6.10-6.11.

**Terminada cuando:** el reporte de la corrida dice «artefacto verificado y desplegado a staging», `$DC ps` muestra
todos los servicios `healthy`, `curl -sI "$BASE/"` responde con certificado de Let's Encrypt de producción y la memoria
en régimen quedó anotada (35b 6.4).

## Fase 5: verificación sin login (Claude)

| # | Comprobación | Resultado esperado |
|---|---|---|
| 1 | `curl -s -o /dev/null -w "%{http_code}\n" "$BASE/"` | `200` |
| 2 | `curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/users/me"` (ruta protegida, sin sesión) | `401` |
| 3 | Atajos de desarrollo apagados: `check-env-file.mjs` de la fase 3 (IA `mock`, correo `capture`, claves de desarrollo). La semilla de demostración es un target de Nx (`api:seed-demo`) que el despliegue nunca ejecuta | `all checks passed` |
| 4 | `/metrics`, `/health` y `/health/live` desde fuera (35b 9.5) | Ninguno devuelve el cuerpo de `api` |
| 5 | `curl -sI "$BASE/unirse"` | `Referrer-Policy: no-referrer` y `X-Content-Type-Options: nosniff`. El resto de las cabeceras llega con `edge-security-headers` (fase 8) |
| 6 | `nc -zvw3 <ip> 27017`, `6379` y `8080` desde fuera (35b 5.5) | Los tres fallan |
| 7 | Regla de metadatos (35b 12.7) | Ningún contenedor llega a la dirección de metadatos; el host sí |
| 8 | Códigos de invitación fuera de los logs (35b 9.6) | No aparecen |

**Regla de corte:** si 2, 4, 6 o 7 no coinciden, parate (regla 5).

**Terminada cuando:** las ocho filas coinciden, con las salidas guardadas en la nota del grupo 6 o 9 de 35b.

## Fase 6: servicios externos (Vos)

1. **Correo:** Brevo según el runbook de Oracle §13.3; después Claude mide entrega y rechazos (35b 7.9-7.12). Umbral:
   bandeja de entrada en 2 de 3 proveedores, o riesgo aceptado por escrito.
2. **IA:** llamada real por OpenRouter `:free` con `data_collection: deny` y degradación comprensible (35b 8.1 y 9.9).
3. **Aviso de respaldo faltante (nuevo):** creá una cuenta gratuita en un monitor de tareas programadas (por ejemplo
   healthchecks.io), un chequeo con período de 1 día y gracia de 2 horas, y avisos a tu correo. Su URL de ping es un
   secreto: va como `BACKUP_PING_URL` en `.env.staging` y en su copia.

**Terminada cuando:** 7.10 tiene su umbral cumplido o el riesgo aceptado; 8.1 anotó una respuesta real; el monitor
existe y muestra el chequeo en estado «nuevo» (todavía sin pings).

## Fase 7: respaldo (nuevo; Claude implementa, Vos crea los destinos)

Requiere Q1 y Q2 respondidas y el change de respaldo (C1) aprobado en su debate. Los nombres de servicio y de
variables son los que propone C1; si su design los cambia, se actualizan acá.

1. **Destino en Oracle (Vos).** *Storage → Buckets → Create Bucket*: privado, nivel Standard, **sin versionado**, con
   una regla de retención que impida borrar objetos antes de su plazo (el plazo lo fija el design de C1 según la
   retención de Q3). Un usuario IAM dedicado al respaldo con una política limitada a ese bucket y su *Customer Secret
   Key*; los permisos exactos (sin borrado) los fija C1.
2. **Destino fuera de Oracle (Vos):** el que salga de Q2, con las mismas condiciones: privado, sin cobro posible y
   con el borrado protegido. Si pide una cuenta, una tarjeta o tiene costo, decidís vos antes de seguir.
3. **Credencial de poda (Vos):** la que puede borrar en cada destino. Solo en tu gestor de contraseñas.
4. **Secretos en el host (Vos):** los del respaldo en `.env.staging`, y la copia fuera del host actualizada (35b 5.8).
5. **Despliegue del change (Claude, con tu confirmación):** por el camino normal de
   [Publicar una actualización](#publicar-una-actualización).
6. **Primer respaldo a mano (Claude, en el host):**

   ```bash
   $DC run --rm backup
   ```

   ```bash
   $DC run --rm backup restic snapshots
   ```

7. **Falsaciones de C1 (Claude):** desde `backup`, `api` no resuelve; el usuario de Mongo de respaldo no puede
   escribir; la identidad S3 de respaldo no puede escribir ni borrar; la credencial del host no puede borrar un paquete
   del repositorio; un umbral de tamaño de prueba hace fallar el respaldo y llega el aviso.
8. **Aviso de falla real (Vos):** dejá pasar una ventana sin respaldo (Claude desactiva el programador una noche) y
   comprobá que llega el correo del monitor; después se reactiva.

**Terminada cuando:** cada destino lista al menos dos instantáneas de días distintos; el monitor muestra pings de
éxito diarios y mandó el aviso de la prueba 8; las cinco falsaciones fallaron como debían; el tamaño del repositorio
en Oracle está anotado.

## Fase 8: antes de invitar (Claude y Vos)

Todo esto va antes de la fase 10 y la condiciona (35b 10.7).

1. **Filtro de salida del worker (C2):** `enrichment-egress-guard` fusionado en su ventana (después de 35b 11.6) y
   desplegado. Comprobación: guardar un link a una dirección privada o sin punto es rechazado como URL no válida, y el
   enriquecimiento de un link público sigue funcionando.
2. **Cabeceras del borde:** lo que 35b 10.7 exige de `edge-security-headers`.
3. **Ensayo de reconstrucción con restauración:** 35b 9.1-9.4 («Replace boot volume»), y, en vez de terminar con la pila
   vacía, restaurar desde el respaldo con el procedimiento de [Volver atrás → Base de datos](#volver-atrás). Se
   comprueban las cuentas, los links y un CV descargable de las cuentas de prueba, y se anota el tiempo total (RTO).
   Durante el ensayo no se fusiona nada a `main`.
4. **Despliegue por merge y vuelta atrás por GitHub:** 35b 11.6.
5. **Superficie expuesta:** 35b 9.5, 9.6 y 9.12 (cuentas no invitadas).
6. **Q5 respondida** (regla de corte 6).

**Terminada cuando:** las seis casillas están cerradas, con la restauración del paso 3 hecha sobre el host real y su
informe de conciliación sin faltantes.

## Fase 9: prueba con datos ficticios (Vos y Claude)

**Este paso decide si se puede confiar en el despliegue.** Solo cuentas de prueba y datos inventados.

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Recorrido completo con una cuenta de prueba y un buzón ajeno (35b 10.5): registro, correo, verificación, login, recuperación de contraseña, link, postulación, CV, análisis, borrado de cuenta | Cada paso funciona |
| 2 | Otra cuenta no entra: con una segunda cuenta de prueba, pedir el link y el CV de la primera por la API | `404` o `403`, nunca el dato |
| 3 | Segundo dispositivo (móvil, 35b 9.8 con links de prueba) | Mismos datos |
| 4 | **Peor caso de carga:** subir un CV cerca del tope de tamaño y pedir un análisis de encaje mientras el worker enriquece links; después `docker stats --no-stream` en el host | Sin reinicios, memoria total por debajo de 12 GB con margen; el dato junto al de 35b 6.4 |
| 5 | Suite remota contra staging (precondición de 35b 10.7: `e2e-remote` en `chromium` y `mobile`, sobre el commit desplegado) | Verde |
| 6 | Recargar y reiniciar la pila (`$DC restart`) | Los datos siguen |
| 7 | Respaldo de la noche siguiente y restauración en una pila local limpia | Los datos de prueba aparecen restaurados |

**Terminada cuando:** las siete pasan. Después, 35b 10.6: borrar las cuentas de prueba con el borrado de cuenta del
producto y tomar la línea base de la medición.

## Fase 10: invitados (Vos)

No hay datos reales previos que migrar: los datos reales son los que crean los invitados. Esta fase reemplaza a la
«migración».

1. Lista nominal y entrevistas (35b 9.7 y 10.1), fuera del repositorio.
2. El aviso a los invitados, ya con el texto nuevo sobre las copias cifradas y su retención (cambio C1 y 35b 9.10).
3. Invitar (35b 10.7), con todas sus condiciones y las de la fase 8.

**Terminada cuando:** `infra/staging/measure.mongosh.js` (por `infra/staging/run.sh`) cuenta en `users` exactamente las
personas de la lista del host, y el primer respaldo con invitados aparece en los dos destinos.

## Publicar una actualización

1. PR a `main` con el CI en verde (`lint`, `typecheck`, `test`, `build`, `repo-checks`). Merge commit.
2. Las migraciones de LinkVault corren dentro de la aplicación al arrancar y solo agregan. Si un change trae una que
   transforma datos, el respaldo de esa noche tiene que estar en verde antes del merge (mirá el monitor).
3. El push a `main` dispara `cd-staging`: construye, verifica, publica por digest y despliega por SSH (`deploy.sh`).
   Ventanas de fusión: las que fije el owner (35b, ADR-056 §1 para `enrichment-egress-guard`).
4. Repetir las filas 1, 2 y 4 de la fase 5 y mirar el reporte de la corrida.
5. Versión: las releases las define 35c (`verify-reusable-workflow`); hasta entonces, la identidad es el `sha-<12>`.

## Volver atrás

**Código.** No revierte la base.

- Dentro de los 30 días de la corrida: relanzar **solo el job de despliegue** de la corrida anterior que estaba bien
  (RUNBOOK, «Operar staging»; 35b 11.2).

  ```bash
  gh run rerun <id de la corrida anterior> --job <id del job deploy-staging>
  ```

- Pasados los 30 días, o sin GitHub: en el host, desde el `.incoming-<sha12>` anterior (se conservan cinco):

  ```bash
  bash /srv/linkvault-staging/.incoming-<sha12 anterior>/infra/deploy/install-config.sh /srv/linkvault-staging
  ```

  ```bash
  IMAGE_TAG=sha-<sha12 anterior> $DC up -d --wait
  ```

**Base de datos.** Sobrescribe todo lo que haya cambiado desde la instantánea elegida: lo posterior se pierde.
Antes, un respaldo a mano del estado actual (`$DC run --rm backup`), para poder volver. El procedimiento es el de
`infra/backup/restore.sh` (cambio C1): para `api` y `worker`, deja `mongo` solo, `mongorestore --drop --oplogReplay`
sin restaurar `admin.*`, recarga los objetos con la misma `OBJECT_STORE_SSE_KEY`, arranca la pila e imprime la
conciliación (CV sin objeto y objetos sin documento). Hasta que C1 esté fusionado, **no hay vuelta atrás de datos**: es
otra razón para no invitar antes.

**Aplicación fuera de servicio.** Sin el host no funciona nada: ni la web, ni la API, ni el correo ni los avisos. Los
datos siguen en los dos destinos del respaldo, y las imágenes en GHCR.

## Respaldos

| Respaldo | Cuándo | Cubre | Límite |
|---|---|---|---|
| Restic a OCI Object Storage (C1) | Nocturno (Q4) | Mongo entero y los objetos de CV y snapshots, cifrados por restic | RPO de 24 h; misma cuenta de Oracle; tope de 10 GB por nivel |
| Restic al destino fuera de Oracle (C1, Q2) | En la misma corrida | Lo mismo | RPO de 24 h; límites del destino elegido |
| Copia de `.env.staging` (35b 5.8) | Cada vez que cambia | Claves de cifrado, contraseñas de datos y `RESTIC_PASSWORD` | Manual: toda tarea que edita el archivo actualiza la copia |
| `acme.json` (35b 6.9) | Al emitir el certificado de producción | Certificado y cuenta ACME | Se puede reemitir, con límites de Let's Encrypt |

Redis no se respalda: guarda colas y caché, y el outbox de Mongo vuelve a encolar lo que no se publicó.

Una vez por mes, restaurá la última instantánea en una pila limpia y comprobá que abre una cuenta de prueba y un CV.
Con invitados, el respaldo tiene CV reales: la prueba se hace **en el host**, en un proyecto de Compose aparte, sin
puertos publicados y con `down -v` al terminar (el procedimiento exacto lo deja C1), no en tu PC. Un respaldo que nunca
se probó no cuenta.

## Límites del plan

En pago por uso, al superar un límite Always Free, Oracle **cobra**. En la cuenta gratuita, **bloquea** (y puede
reclamar instancias inactivas).

| Recurso | Límite Always Free | Uso esperado | Acción |
|---|---|---|---|
| Cómputo A1 | 1.500 h OCPU y 9.000 GB-h al mes (2 OCPU / 12 GB) | 2/12 fijos | Cuota a 2/12; regla de corte 2 |
| Volúmenes en bloque | 200 GB entre arranque y bloques, 5 respaldos de volumen | 50-100 GB, sin respaldos de volumen | Cuota a 200 GB; no activar políticas de respaldo de volumen |
| Object Storage | 10 GB por nivel en cuenta de pago (20 GB en gratuita) y 50.000 peticiones al mes | Cientos de MB y cientos de peticiones por día | Tope de tamaño del respaldo; poda semanal o mensual, nunca diaria; revisión mensual |
| Egreso | 10 TB al mes | Muy por debajo | Ninguna |
| Inactividad | Cuenta gratuita: CPU p95, red y memoria por debajo del 20 % durante 7 días | 3-5 usuarios quedan por debajo | Pago por uso, con la exención confirmada (Q5) |
| Brevo | 300 correos por día | Decenas | `class=quota_exceeded` en el log; vuelve al día siguiente |
| OpenRouter `:free` | Cupo diario del plan gratuito (anotado en 35b 9.9) | Pocos análisis por día | Degradación a `RuleBasedMatcher` |
| Let's Encrypt | Emisiones por dominio registrado por semana (compartidas si `sslip.io` no está en la PSL) | Una emisión, y renovaciones | ACME *staging* para iterar (35b 6.8) |

Revisá esta tabla cuando Oracle anuncie cambios de Always Free y en la revisión mensual.

## Mantenimiento

| Tarea | Frecuencia |
|---|---|
| Mirar el monitor de respaldos (los avisos llegan solos; esto es comprobar que el monitor sigue vivo) | Semanal |
| Restaurar un respaldo en una pila limpia, en el host (ver [Respaldos](#respaldos)) | Mensual |
| Poda de los repositorios con la credencial de poda, desde tu PC | Mensual (o lo que fije C1) |
| *Cost Analysis* de Oracle en 0 y tamaño del bucket de respaldo | Mensual |
| Actualizaciones de Ubuntu (`unattended-upgrades` ya activo) y reinicio si lo pide (`/var/run/reboot-required`) | Mensual |
| Dependencias e imágenes: Renovate en el repo, CI en verde, despliegue por merge | Según los PR |
| Revisar los cambios de Always Free, Brevo y OpenRouter | Trimestral |
| Rotar el token del registro antes de su caducidad (35b 5.9) | Según la caducidad anotada |
| Rotar la clave de despliegue SSH y las credenciales del respaldo | Anual, o si se sospecha una filtración |
| Recuento de cuentas no invitadas (35b 9.12) | Semanal mientras dure la prueba |

## Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| «Out of host capacity» al crear la instancia | Sin capacidad A1 en la región | Runbook de Oracle §6; tras tres días, regla de corte 1 |
| 80 y 443 cerrados aunque la VCN los abre | Las reglas `iptables` propias de la imagen | Runbook de Oracle §7 (dos capas) |
| El despliegue falla con `Host key verification failed` | Se reconstruyó el disco y cambió la clave del host | Actualizar `STAGING_SSH_HOST_KEY` (35b 9.3) |
| `gh run rerun` rechazado | Pasaron 30 días desde la corrida | Vuelta atrás sin GitHub, o una corrida nueva sobre `main` |
| `api` o `worker` no arrancan y nombran una variable | Falta o tiene mal formato en `.env.staging` | El arranque nombra la variable; `$DC config -q` y la revisión de la fase 3 |
| `SMTP send rejected: class=credentials_rejected` | Clave SMTP mal copiada | Runbook de Oracle §13.3 |
| El certificado no se emite | Límite de Let's Encrypt o `sslip.io` sin resolver | 35b 6.8; esperar la ventana, no reintentar en bucle |
| Llega un correo del monitor de respaldos | El respaldo no corrió o falló | `$DC logs backup`; respaldo a mano; si falla por tamaño, poda |
| Alerta de presupuesto o de pronóstico | Algo fuera de Always Free | Regla de corte 4: *Cost Analysis*, borrar el recurso |
| La instancia aparece detenida o recuperada por Oracle | Reclamación por inactividad | Plan B o reconstrucción y restauración; revisar Q5 |
| `smoke.sh` falla en la salida a Brevo u OpenRouter | Red de salida rota o el proveedor caído | Mensaje del smoke (nombra servicio y destino) |

Para ver los errores de producción, en el host:

```bash
$DC logs --since 1h api worker
```

## Salir de Oracle hacia el plan B

El plan B es **`casa-tunel`**: la misma pila en un equipo del owner siempre encendido, expuesta con un túnel. Se activa
con la regla de corte 1, 3, 4 o 6, o si Oracle recupera la instancia o cierra la cuenta.

Qué se lleva: todo. La base y los objetos están en los dos destinos del respaldo, la configuración en el repositorio,
las imágenes en GHCR y los secretos en la copia de `.env.staging`. Qué es irreversible: la región de origen de la
cuenta de Oracle, y lo que se haya perdido después del último respaldo.

Antes de mover datos reales al plan B hacen falta estos cambios, que su crítico encontró (cada uno, su change y su
debate):

1. **El filtro de salida del worker es obligatorio**, no deseable: en una casa, sin él, el worker llega a la red local
   y a la tailnet (C2 ya lo cubre si está fusionado).
2. Un compose propio o un override con `!reset` para que Traefik no publique 80 y 443, un `dynamic.yml` sin
   `certResolver`, y `deploy.sh` y `config-files.txt` que los lleven al host.
3. IP real del cliente detrás del túnel para el límite por IP (Traefik `forwardedHeaders.trustedIPs` y `TRUST_PROXY`),
   medida antes de invitar.
4. Si el equipo es `amd64`: construir y verificar `amd64` en `cd-staging` (ADR-051 §3 lo difiere hoy).
5. Cifrado del disco que se desbloquee solo tras un corte de luz (TPM o clave remota), o cifrado solo del volumen de
   datos.
6. Verificar que el túnel deja pasar SSE de larga duración y que su alta no pide tarjeta.
7. Un ADR que reemplace el destino de ADR-051.

Pasos de la salida: (1) un respaldo a mano y comprobar que llegó a los dos destinos; (2) levantar la pila en el destino
nuevo; (3) restaurar `.env.staging` y los datos con `restore.sh`; (4) cambiar `PUBLIC_HOST` y las URL base, y avisar a
los invitados de la URL nueva; (5) en Oracle, terminar la instancia, liberar la IP reservada y borrar el bucket
(después de comprobar el paso 3), y volver a mirar *Cost Analysis* al mes siguiente.

## Cierre del despliegue

- [ ] Fase 0: repositorio listo.
- [ ] Fase 1: cuenta, estimador en 0, pago por uso decidido, presupuesto con dos alertas, cuotas.
- [ ] Fase 2: host creado y SSH endurecido.
- [ ] Fase 3: secretos cargados y copia de `.env.staging` comprobada.
- [ ] Fase 4: primer despliegue antes del 2026-12-07 (o la alternativa de 35b 6.3).
- [ ] Fase 5: verificación sin login.
- [ ] Fase 6: correo medido, IA real, monitor de respaldos creado.
- [ ] Fase 7: respaldo en dos destinos, borrado protegido, aviso probado.
- [ ] Fase 8: filtro de salida fusionado, reconstrucción con restauración ensayada, Q5 respondida.
- [ ] Fase 9: prueba con datos ficticios superada y cuentas de prueba borradas.
- [ ] Fase 10: invitados dados de alta y primer respaldo con datos reales en los dos destinos.
- [ ] Recordatorios creados: restauración mensual, poda mensual, revisión de costo mensual.
