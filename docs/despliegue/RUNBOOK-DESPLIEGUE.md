# Runbook: desplegar LinkVault en Oracle Cloud Always Free (consolidación)

**Destino:** una VM Ampere A1 Always Free (2 OCPU / 12 GB, Ubuntu 24.04 `aarch64`) con `docker-compose.prod.yml`
(Traefik, Mongo con replica set, Redis, SeaweedFS cifrado, `api`, `worker` y `web`), en
`https://<ip-con-guiones>.sslip.io` con certificado de Let's Encrypt. Costo: 0 USD por mes, sostenido por las reglas de
corte de costo de la [fase 1](#fase-1-cuenta-y-reglas-de-costo-vos).

**Estado del respaldo (C1, change `staging-backups`, 2026-11-18):** la parte local está implementada y probada en su rama
(`infra/backup/run-backup.sh`, `restore.sh`, `restore-drill.sh`, aislamiento por proceso y credencial de solo lectura de Mongo),
pero **sin fusionar ni desplegar**: faltan los destinos y el monitor que crea el dueño (fases 6 y 8), la decisión sobre la
identidad S3 de solo lectura (Q3 del change) y el ensayo en el host (fase 9). **No terminado hasta que la fase 9 cierre con una
restauración probada en el host.**

**Estado al 2026-11-16:** sin desplegar. El destino está a medio preparar por el change `staging-host` (35b). La
decisión de plataforma y sus condiciones están en [DECISION-DESPLIEGUE.md](DECISION-DESPLIEGUE.md). El estado de cada
fase se marca **acá**, en la [lista de cierre](#cierre-del-despliegue); [`despliegue.json`](despliegue.json) solo se
actualiza al cierre. Este documento no se fusiona a `main` hasta la ventana del PR-2 de 35b: mientras tanto se lee
desde la rama `docs/estrategia-despliegue`.

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
| Change de respaldo (contenedor dedicado, dos destinos, aviso, restauración ensayada) | **Nuevo** | Cambio C1 de la decisión; fases 8 y 9 |
| SSH endurecido | **Nuevo** | Cambio C3; fase 2 |
| PR-2 de 35b fusionado en su ventana | Falta; depende de Q4 de 35b (invitados) y de 5.10 (pago por uso) | Fase 7 |
| Filtro de salida del worker (`enrichment-egress-guard`) | Implementado en su rama, **sin fusionar**; entra en la ventana posterior a la 11.6 | Cambio C2; fase 8 |

**Congelación de `main`:** entre PR-1b y PR-2 de 35b no se fusiona nada a `main`, y en particular nada durante el
ensayo de reconstrucción 9.1-9.4 (`tasks.md` de 35b). Por eso el respaldo (C1) y el filtro de salida (C2) entran recién
en la ventana posterior a la 11.6 (fase 8).

**Plazo que corre:** GitHub deja relanzar jobs de una corrida hasta 30 días después de creada. La corrida `42344081533`
(push de PR-1b, creada el 2026-11-07) vence el **2026-12-07**, y estas tareas la relanzan:

| Tarea de 35b | Qué relanza | Alternativa si venció |
|---|---|---|
| 6.3 | El `preflight` (primer despliegue) | La alternativa escrita de 6.3: `cd-staging` a mano sobre `main` fuera del modo de prueba. **Desde entonces el plazo se cuenta desde esa corrida nueva** |
| 6.5, 6.6 y 6.7 | Solo el job de despliegue (token fuera de `ps`, inyección, clave del host) | Lo mismo sobre la corrida de 6.3 vigente; si también venció, una corrida nueva sobre `main` |
| 9.4 | Solo el job de despliegue, tras reconstruir | Las dos órdenes del job desde la máquina del operador (`infra/README.md`, reconstrucción, paso 5) |
| 11.6 | El job de despliegue de la corrida de 6.3 y después el de PR-2 | La vuelta atrás desde el host de 11.2, anotada |
| Vuelta atrás por GitHub | Solo el job de despliegue de una corrida anterior | [Vuelta atrás sin GitHub](#volver-atrás) |

## Reglas de corte

Parate y no sigas si pasa algo de esto:

1. **Oracle pide un pago, muestra un cargo distinto de 0 o no da capacidad A1** tras el protocolo de 35b 5.2 (45 minutos
   por sesión, tres días). Se pasa al plan B ([Salir de Oracle](#salir-de-oracle-hacia-el-plan-b)).
2. **La instancia no es exactamente 2 OCPU y 12 GB**, aunque la consola ofrezca más. Con pago por uso, crear 4/24
   cobraría.
3. **El estimador de costos muestra un importe distinto de 0** para algún recurso del plan (A1 2/12, volumen de
   arranque, IP reservada, Object Storage por debajo de 10 GB) **antes** de pasar a pago por uso.
4. **Una alerta de presupuesto o de pronóstico se dispara.** Se busca el recurso en *Cost Analysis*, se borra, y no se
   sigue hasta que el pronóstico vuelva a 0. **Un bucket con retención se vacía quitando primero la regla, con el usuario
   administrador** (la retención no se bloquea: la quita el dueño de la cuenta, nunca la credencial del host).
5. **Una verificación de seguridad de la fase 5 da otro resultado** (ruta protegida sin `401`, puerto de datos abierto,
   `/metrics` público, dirección de metadatos alcanzable).
6. **La exención de inactividad no está confirmada** (Q5 de la decisión) al llegar a la fase 11: o se confirma, o se
   acepta el riesgo por escrito, o plan B.
7. **El respaldo no corrió, no avisó o no se pudo restaurar** en la fase 8 o en la 9. No se invita sin respaldo probado.
8. **Un destino de respaldo tiene versionado sin regla de ciclo de vida**, o la credencial que vive en el host puede
   borrar instantáneas.
9. **Aparece un dato real o un secreto** en un archivo versionado, en un comando guardado en el historial o en el
   chat.

No entran datos reales (invitados) hasta terminar las fases 9 (restauración ensayada) y 10 (prueba con datos
ficticios).

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

Los comandos de tu PC usan Git Bash desde la raíz del repositorio, salvo los `gh secret set`, que van en PowerShell
o Windows Terminal (fase 3). Los del host corren por SSH, en `bash`, desde `/srv/linkvault-staging`. En los del host,
`<sha12>` es el commit desplegado (`docker compose … images` lo muestra).

En tu PC, para las comprobaciones desde fuera:

```bash
BASE=https://<ip-con-guiones>.sslip.io
```

En **cada** sesión del host, antes de cualquier orden de Compose:

```bash
cd /srv/linkvault-staging && DC="docker compose -f docker-compose.prod.yml --env-file .env.staging"
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
3. **Pago por uso (35b 5.10, decisión tuya).** El panel recomienda pasar, para evitar la reclamación por
   inactividad (que esa exención exista es la Q5) y por una posible prioridad de capacidad A1. Esa prioridad es un
   **supuesto**: la afirma el runbook de Oracle, no una fuente oficial citada. Runbook de Oracle §11 y §13.2, con dos
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
   (fase 8) y la revisión mensual de consumo ([Mantenimiento](#mantenimiento)).
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
   (reemplazá `<usuario-admin>` por el tuyo; en la imagen de Oracle es `ubuntu`):

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
3. **Secretos del CD:** 35b 6.1, con PR-1 y PR-1b ya en `main` (lo están). Desde **PowerShell o Windows Terminal**, en
   la raíz del repositorio: `gh` pide el valor sin mostrarlo y no queda en el historial. En Git Bash el aviso no
   funciona bien; ahí solo vale la redirección desde un archivo.

   ```powershell
   gh secret set STAGING_HOST
   ```

   Lo mismo con `STAGING_SSH_USER`, `STAGING_SSH_HOST_KEY`, `GHCR_READ_USER` y `GHCR_READ_TOKEN`. La clave privada de
   despliegue se carga redirigiendo su archivo, que vive fuera del repositorio (desde Git Bash):

   ```bash
   gh secret set STAGING_SSH_KEY < ~/.ssh/<clave de despliegue>
   ```

   Si para algún otro valor usás un archivo temporal, que esté fuera del repositorio y borralo apenas termina el
   comando.

4. **Configuración de `main` y revisión del env file (Claude te pasa la orden, vos la corrés en el host).** Es la copia
   manual de 35b 5.7, una sola vez, y la revisión completa de `check-env-file.mjs` (paso 2 de
   [`infra/revision-despliegue.md`](../../infra/revision-despliegue.md)). El script lee del repositorio
   `docker-compose.prod.yml`, `docker-compose.yml`, `infra/ci/verify.env` y `.env.example`, y no viaja con el
   despliegue: se clona el repositorio público en un directorio temporal del host, se corre con los dos montados de
   solo lectura y sin red, y se borra. `<commit>` es el de `main` que se va a desplegar (el de la corrida
   `42344081533`, o el de la corrida nueva si se usó la alternativa de 6.3). `git` viene en la imagen de Ubuntu; si
   falta, `sudo apt-get install -y git`.

   ```bash
   cd /srv/linkvault-staging && DC="docker compose -f docker-compose.prod.yml --env-file .env.staging"
   ```

   ```bash
   TMP=$(mktemp -d) && git clone --quiet https://github.com/<owner>/linkvault.git "$TMP/repo" && git -C "$TMP/repo" checkout --quiet <commit>
   ```

   ```bash
   (cd "$TMP/repo" && tar -cf - -T infra/deploy/config-files.txt) | tar -xf - -C /srv/linkvault-staging
   ```

   ```bash
   $DC config -q
   ```

   Antes del primer despliegue la imagen de `api` todavía no está en el host: se usa la imagen pública de Node de la
   misma versión mayor (la 22). Después del primer despliegue, en la fase 5, se usa la de `api`.

   ```bash
   docker run --rm --network none --read-only --user "$(id -u):$(id -g)" -v "$TMP/repo":/repo:ro -v /srv/linkvault-staging/.env.staging:/env/.env.staging:ro -w /repo node:22-slim node infra/ci/check-env-file.mjs /env/.env.staging
   ```

   ```bash
   cut -d= -f1 .env.staging | grep -v -e '^#' -e '^$' | sort
   ```

   ```bash
   rm -rf "$TMP"
   ```

**Terminada cuando:** `gh secret list` muestra los seis nombres; la corrida de modo de prueba sobre `main` de 35b 6.1
dice `full` en el preflight y no despliega; `stat -c %a .env.staging` da `600`; la suma SHA-256 de la copia coincide
con la del original (35b 5.8); `$DC config -q` sale 0; `check-env-file.mjs` termina en `all checks passed`; el listado
de nombres coincide con los de la tabla de valores; y el directorio temporal ya no existe.

## Fase 4: primer despliegue (Claude, con tu confirmación)

1. Corrida desde una rama fuera del modo de prueba: no despliega (35b 6.2).
2. **Primer despliegue real:** relanzar el `preflight` de la corrida `42344081533`, **antes del 2026-12-07** (35b 6.3,
   con su alternativa escrita si vence el plazo; ver [Plazo que corre](#dónde-estamos)).
3. Host después del despliegue, memoria en régimen y falsaciones del token y de la clave del host: 35b 6.4-6.7.
4. Nombre y TLS: primero contra ACME *staging*, después producción (35b 6.8-6.9). Enrutado y `Referrer-Policy`: 35b
   6.10-6.11.

El emisor del certificado (en tu PC, `<nombre>` es `<ip-con-guiones>.sslip.io`):

```bash
openssl s_client -connect <nombre>:443 -servername <nombre> </dev/null 2>/dev/null | openssl x509 -noout -issuer
```

La memoria, en el host, al menos 30 minutos después del despliegue y sin actividad:

```bash
free -m
```

**Terminada cuando:** el reporte de la corrida dice «artefacto verificado y desplegado a staging»; `$DC ps` muestra
todos los servicios `healthy`; el emisor es de Let's Encrypt de producción (sin `STAGING` ni `Fake` en el nombre); y en
`free -m` la columna `used` está **por debajo del 75 %** de `total` (si no, regla de corte: la pila no entra con
margen, y se revisa antes de seguir). La cifra queda anotada en 35b 6.4.

## Fase 5: verificación sin login (Claude)

| # | Comprobación | Resultado esperado |
|---|---|---|
| 1 | `curl -s -o /dev/null -w "%{http_code}\n" "$BASE/"` | `200` |
| 2 | `curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/users/me"` (ruta protegida, sin sesión) | `401` |
| 3 | Atajos de desarrollo apagados: el `check-env-file.mjs` de la fase 3.4 repetido con la imagen de `api` en vez de la de Node (abajo). Revisa IA `mock`, correo `capture` y claves de desarrollo. La semilla de demostración es un target de Nx (`api:seed-demo`) que el despliegue nunca ejecuta | `all checks passed` |
| 4 | `/metrics`, `/health` y `/health/live` desde fuera (35b 9.5) | Ninguno devuelve el cuerpo de `api` |
| 5 | `curl -sI "$BASE/unirse"` | Hoy: `Referrer-Policy: no-referrer`. Las demás cabeceras llegan con `edge-security-headers` y se comprueban una por una en la fase 9 |
| 6 | Puertos de datos desde fuera (35b 5.5), un bloque por puerto, abajo | Los tres fallan (sin conexión) |
| 7 | En el host, `sudo ss -tlnp` | Fuera de loopback (`127.0.0.0/8`, `::1`) solo escuchan 22, 80 y 443 |
| 8 | Regla de metadatos (35b 12.7) | Ningún contenedor llega a la dirección de metadatos; el host sí |
| 9 | Códigos de invitación fuera de los logs (35b 9.6) | No aparecen |

Fila 3, en el host: los mismos pasos de la fase 3.4 (clonar en `$TMP`, correr y borrar), con `<commit>` el
desplegado. Lo único que cambia es la orden del medio:

```bash
docker run --rm --network none --read-only --user "$(id -u):$(id -g)" -v "$TMP/repo":/repo:ro -v /srv/linkvault-staging/.env.staging:/env/.env.staging:ro -w /repo --entrypoint node "$($DC images -q api)" infra/ci/check-env-file.mjs /env/.env.staging
```

Fila 6, desde tu PC (Git Bash); cada orden tiene que **fallar** (tiempo agotado o conexión rechazada):

```bash
curl -sv --max-time 3 telnet://<ip>:27017
```

```bash
curl -sv --max-time 3 telnet://<ip>:6379
```

```bash
curl -sv --max-time 3 telnet://<ip>:8080
```

O desde PowerShell, con `TcpTestSucceeded : False` en cada uno:

```powershell
Test-NetConnection <ip> -Port 27017
```

```powershell
Test-NetConnection <ip> -Port 6379
```

```powershell
Test-NetConnection <ip> -Port 8080
```

**Regla de corte:** si 2, 4, 6, 7 u 8 no coinciden, parate (regla 5).

**Terminada cuando:** las nueve filas coinciden, con las salidas guardadas en la nota del grupo 6 o 9 de 35b.

## Fase 6: servicios externos (Vos)

1. **Correo:** Brevo según el runbook de Oracle §13.3; después Claude mide entrega y rechazos (35b 7.9-7.12). Umbral:
   bandeja de entrada en 2 de 3 proveedores, o riesgo aceptado por escrito.
2. **IA:** llamada real por OpenRouter `:free` con `data_collection: deny` y degradación comprensible (35b 8.1 y 9.9).
3. **Aviso de respaldo faltante (nuevo):** creá una cuenta gratuita en un monitor de tareas programadas (por ejemplo
   healthchecks.io), un chequeo con período de 1 día y **margen de 3 horas**, y avisos a tu correo. Su URL de ping es un
   secreto: va como `BACKUP_PING_URL` en `.env.staging` y en su copia (eso se hace en la fase 8, con C1). `run-backup.sh` manda `start`,
   éxito o `fail` (con la clase de la falla) desde el host.

**Terminada cuando:** 7.10 tiene su umbral cumplido o el riesgo aceptado; 8.1 anotó una respuesta real; el monitor
existe y muestra el chequeo en estado «nuevo» (todavía sin pings).

## Fase 7: cierre de 35b hasta la 11.6 (Claude y Vos)

`main` sigue congelado: entre PR-1b y PR-2 no se fusiona nada.

1. **Ensayo de reconstrucción, como lo escribe 35b:** 9.1-9.4 («Replace boot volume»), con la pila vacía. No se
   restaura nada (todavía no hay respaldo) y no se fusiona nada a `main` mientras dure.
2. **PR-2 de 35b fusionado en su ventana.** Depende de Q4 de 35b (invitados: lista y entrevistas, 9.7 y 10.1) y de la
   decisión de pago por uso (5.10), porque lleva sus anotaciones. La ventana la autoriza el owner. El PR de esta
   propuesta (`docs/estrategia-despliegue`) se fusiona en esa misma ventana, no antes.
3. **35b 11.6:** despliegue por merge de PR-2 y vuelta atrás por GitHub (dentro de su plazo; si venció, desde el host,
   anotado).

**Terminada cuando:** las notas de 9.1-9.4 están cerradas con el tiempo del ensayo; `gh pr view <número de PR-2>
--json state,mergedAt` da `MERGED`; la corrida del push de PR-2 dice «artefacto verificado y desplegado a staging»; y
la 11.6 está anotada con cada `sha-<12>` visto en el host.

## Fase 8: ventana posterior a la 11.6: filtro de salida y respaldo (Claude implementa, Vos crea los destinos)

Requiere Q1 y Q2 de la decisión respondidas y los changes C1 y C2 aprobados en su debate, cada uno con su propio PR.
Los nombres de servicio y de variables son los de `staging-backups`: `run-backup.sh`, `restore.sh --from`, `restore-drill.sh`,
`docker-compose.backup.yml` y `.env.example`.

1. **Filtro de salida del worker (C2):** `enrichment-egress-guard` fusionado y desplegado. Comprobación: guardar un
   link a una dirección privada o a un nombre sin punto es rechazado como URL no válida, y el enriquecimiento de un
   link público sigue funcionando.
2. **Destino en Oracle (Vos).** *Storage → Buckets → Create Bucket*: **privado**, nivel Standard, **con versionado**
   (modelo V del design D6), una retención de 30 días **sin bloquear** y una **regla de ciclo de vida que expira las versiones
   no actuales a los 31 días** (nunca versionado sin ciclo de vida). Un usuario IAM dedicado al respaldo con una política
   limitada a ese bucket **sin** borrar versiones ni cambiar el versionado, el ciclo de vida o la retención, y su *Customer
   Secret Key*.
3. **Destino fuera de Oracle (Vos):** el que salga de Q2, con las mismas condiciones: privado, sin cobro posible y
   con el borrado protegido. Si pide una cuenta, una tarjeta o tiene costo, decidís vos antes de seguir.
4. **Credencial de poda (Vos):** la que puede borrar en cada destino. Solo en tu gestor de contraseñas.
5. **Secretos en el host (Vos):** los del respaldo y `BACKUP_PING_URL` en `.env.staging`, y la copia fuera del host
   actualizada (35b 5.8).
6. **Despliegue de C1 (Claude, con tu confirmación):** por el camino normal de
   [Publicar una actualización](#publicar-una-actualización).
7. **Primer respaldo a mano (Claude, en el host, con `DC` definido):**

   ```bash
   bash /srv/linkvault-staging/infra/backup/run-backup.sh
   ```

   Las unidades del timer se instalan siguiendo solo `infra/README.md`, «Respaldo programado» (y la **franja sin despliegues**
   de 06:15 a 08:45 UTC). Después, desde tu PC con la credencial del host, `restic snapshots --compact` de cada destino: tres
   instantáneas por corrida (`kind:mongo`, `kind:objects`, `kind:manifest`).

8. **El bucket es privado (Claude, desde tu PC):** un pedido sin credenciales al listado del bucket no puede dar `200`
   (`<región>`, `<namespace>` y `<bucket>` los ves en la consola; no se anotan en el repositorio):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "https://objectstorage.<región>.oraclecloud.com/n/<namespace>/b/<bucket>/o"
   ```

9. **Falsaciones de C1 (Claude):** desde `backup-push`, `api` no resuelve y la dirección de metadatos no responde; el usuario de Mongo de respaldo no puede
   escribir; la identidad S3 de respaldo no puede escribir ni borrar; la credencial del host no puede borrar un paquete
   del repositorio; un umbral de tamaño de prueba hace fallar el respaldo y llega el aviso.
10. **Aviso de falla real (Vos):** dejá pasar una ventana sin respaldo (Claude desactiva el programador una noche) y
    comprobá que llega el correo del monitor; después se reactiva.

**Terminada cuando:** C2 y C1 están fusionados y desplegados (reportes de sus corridas); cada destino lista al menos
dos instantáneas de días distintos; el monitor muestra pings de éxito diarios y mandó el aviso del paso 10; el pedido
anónimo al bucket no da `200`; las cinco falsaciones fallaron como debían; el tamaño del repositorio en Oracle está
anotado.

## Fase 9: restauración ensayada y resto de lo previo a invitar (Claude y Vos)

1. **Ensayo de restauración nuevo, sobre el host real** (cambio C1): con el volumen que ya tiene y **sin** repetir
   «Replace boot volume». Se restaura la última instantánea **desde `offsite`** (el destino que cubre la pérdida de la cuenta
   de Oracle) en un proyecto de Compose aparte, con el override `docker-compose.restore.yml` que no publica puertos ni tiene
   Traefik, y se lo baja con `down -v` al terminar. La pila de staging sigue arriba y no se toca:

   ```bash
   read -rs LV_DRILL_PASSWORD; printf "%s\n" "$LV_DRILL_PASSWORD" | BACKUP_DRILL_EMAIL=<correo de la cuenta de ensayo> \
     bash /srv/linkvault-staging/infra/backup/restore-drill.sh --from offsite; unset LV_DRILL_PASSWORD
   ```

   `restore-drill.sh` comprueba por la API del proyecto aparte el login, los links y el CV de la **cuenta permanente de ensayo**,
   imprime el informe de conciliación y el RTO, y falla si cambió el `Id`, el `StartedAt` o el `RestartCount` de algún contenedor
   de staging. Calendario del ensayo: este primero (antes de invitar y de la 10.7 de 35b), mensual los dos primeros meses y
   después trimestral alternando destino, más uno extra cada vez que sube la imagen de `mongo` o del almacén o cambia
   `infra/backup/`. Después:

   ```bash
   docker compose ls && docker volume ls
   ```

2. **Cabeceras del borde completas:** con `edge-security-headers` fusionado en su ventana, su 9.1 y su 9.3a sobre el
   commit desplegado, como exige 35b 10.7. La comprobación desde fuera, una orden por cabecera (en la SPA, `/unirse`;
   en la API, `/api/users/me`):

   | Cabecera | Orden | SPA | API |
   |---|---|---|---|
   | `Strict-Transport-Security` | `curl -sI "$BASE/unirse" \| grep -i '^strict-transport-security:'` | `max-age=604800; includeSubDomains`, sin `preload` | Igual (`$BASE/api/users/me`) |
   | `Content-Security-Policy` | `curl -sI "$BASE/unirse" \| grep -i '^content-security-policy:'` | La política del SPA, con `frame-ancestors 'none'` | `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` |
   | `X-Frame-Options` | `curl -sI "$BASE/unirse" \| grep -i '^x-frame-options:'` | `DENY` | `DENY` |
   | `X-Content-Type-Options` | `curl -sI "$BASE/unirse" \| grep -i '^x-content-type-options:'` | `nosniff` | `nosniff` |
   | `Referrer-Policy` | `curl -sI "$BASE/unirse" \| grep -i '^referrer-policy:'` | `no-referrer` | `no-referrer` |
   | `Permissions-Policy` | `curl -sI "$BASE/unirse" \| grep -i '^permissions-policy:'` | Presente | No aplica |
   | `Cross-Origin-Opener-Policy` | `curl -sI "$BASE/unirse" \| grep -i '^cross-origin-opener-policy:'` | `same-origin` | No aplica |

   `/p/<slug>` conserva su CSP propia (ADR-027) y suma `X-Frame-Options: DENY`. Para la API se repite cada orden
   cambiando `/unirse` por `/api/users/me`.
3. **Superficie expuesta:** 35b 9.5, 9.6 y 9.12 (cuentas no invitadas).
4. **Q5 respondida** (regla de corte 6).

**Terminada cuando:** la restauración del paso 1 terminó con las comprobaciones en verde y el informe de conciliación
sin faltantes, su tiempo (RTO) está anotado, y después de `down -v` ni `docker compose ls` ni `docker volume ls`
muestran nada de `linkvault-restore`; las siete cabeceras coinciden en la SPA y las que aplican en la API; 9.5, 9.6
y 9.12 están cerradas; Q5 tiene respuesta escrita.

## Fase 10: prueba con datos ficticios (Vos y Claude)

**Este paso decide si se puede confiar en el despliegue.** Solo cuentas de prueba y datos inventados. Se hace sobre el
commit desplegado final: si después se fusiona algo antes de invitar, se repiten la fila 5 y la 9.3a de
`edge-security-headers`.

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Recorrido completo con una cuenta de prueba A y un buzón ajeno (35b 10.5): registro, correo, verificación, login, recuperación de contraseña, link, postulación, CV, análisis, borrado de cuenta | Cada paso funciona |
| 2 | Otra cuenta no entra: con el token de una cuenta de prueba B, sin grupo en común con A, pedir los recursos de A: `GET /api/cv/<id de CV de A>/text-preview`, `GET /api/applications/<id de postulación de A>/events`, `GET /api/links/<id de link de A>/match` y `GET /api/groups/<id de grupo de A>/links` | `404` o `403` en las cuatro, nunca el dato |
| 3 | Segundo dispositivo (móvil, 35b 9.8 con links de prueba) | Mismos datos |
| 4 | **Peor caso de carga:** subir un CV cerca del tope de tamaño y pedir un análisis de encaje mientras el worker enriquece links; después `free -m` y `docker stats --no-stream` en el host | Sin reinicios; `used` por debajo del 75 % de `total` en `free -m` |
| 5 | Suite remota contra staging (precondición de 35b 10.7: `e2e-remote` en `chromium` y `mobile`, sobre el commit desplegado) | Verde |
| 6 | Recargar y reiniciar la pila (`$DC restart`) | Los datos siguen |
| 7 | Respaldo de la noche siguiente y restauración **en el host**, en el proyecto aparte de la fase 9 y con `down -v` al terminar (nunca en tu PC) | Los datos de prueba aparecen restaurados |

**Terminada cuando:** las siete pasan. Después, 35b 10.6: borrar las cuentas de prueba con el borrado de cuenta del
producto y tomar la línea base de la medición.

## Fase 11: invitados (Vos)

No hay datos reales previos que migrar: los datos reales son los que crean los invitados. Esta fase reemplaza a la
«migración».

1. Lista nominal y entrevistas (35b 9.7 y 10.1), fuera del repositorio.
2. El aviso a los invitados, ya con el texto nuevo sobre las copias cifradas y su retención (cambio C1 y 35b 9.10).
3. Invitar (35b 10.7), con todas sus condiciones y las de las fases 8 y 9.

**Terminada cuando:** `infra/staging/measure.mongosh.js` (por `infra/staging/run.sh`) cuenta en `users` exactamente las
personas de la lista del host, y el primer respaldo con invitados aparece en los dos destinos.

## Publicar una actualización

1. PR a `main` con el CI en verde (`lint`, `typecheck`, `test`, `build`, `repo-checks`). Merge commit, solo en una
   ventana autorizada mientras dure la congelación de 35b.
2. **Datos.** El repositorio no tiene un framework de migraciones: Mongoose crea los índices al arrancar. Un change que
   agregue un índice único (puede fallar con datos que ya lo violan) o que transforme datos trae su propio script,
   revisado en su debate, y **antes del merge** se hace un respaldo a mano (`bash /srv/linkvault-staging/infra/backup/run-backup.sh`) y se comprueba que
   llegó a los dos destinos. Nada se despliega entre las 06:15 y las 08:45 UTC (franja del respaldo). El script corre después del despliegue, con la vuelta atrás de la base a mano.
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

- Pasados los 30 días, o sin GitHub: en el host, con `DC` definido, desde el `.incoming-<sha12>` anterior (se
  conservan cinco). Primero, que la imagen anterior siga en el host:

  ```bash
  docker image ls --format '{{.Repository}}:{{.Tag}}' | grep ':sha-<sha12 anterior>$'
  ```

  Si la lista sale vacía, hay que bajarla con la credencial de lectura del registro. El token se teclea (o se pega) en
  la entrada estándar, nunca en la orden:

  ```bash
  docker login ghcr.io -u <usuario> --password-stdin
  ```

  ```bash
  IMAGE_TAG=sha-<sha12 anterior> $DC pull
  ```

  ```bash
  docker logout ghcr.io
  ```

  Después, la configuración y el arranque:

  ```bash
  bash /srv/linkvault-staging/.incoming-<sha12 anterior>/infra/deploy/install-config.sh /srv/linkvault-staging
  ```

  ```bash
  IMAGE_TAG=sha-<sha12 anterior> $DC up -d --wait
  ```

  **Nota para 35b:** su 11.2 tiene el mismo hueco (no comprueba que la imagen esté en el host ni dice cómo bajarla).
  Queda anotado en la decisión (C4) para pasárselo a su sesión; este runbook no edita 35b.

**Base de datos.** Sobrescribe todo lo que haya cambiado desde la instantánea elegida: lo posterior se pierde.
Antes, un respaldo a mano del estado actual (`bash /srv/linkvault-staging/infra/backup/run-backup.sh`), para poder volver, y un ensayo en el
proyecto aparte de la fase 9 con la misma instantánea. El procedimiento es el de `infra/backup/restore.sh --project
linkvault-prod --from oci|offsite` (cambio C1), con `gh workflow disable cd-staging` antes y `gh workflow enable cd-staging` al
terminar (pide escribir «CD DESACTIVADO»): para `api` y `worker`, deja `mongo` solo, `mongorestore --drop` sin restaurar
`admin.*`, recarga los objetos con la misma `OBJECT_STORE_SSE_KEY`, recrea Redis y reencola el outbox con tu confirmación, e
imprime la conciliación (CV sin objeto y objetos sin documento). Hasta que C1 esté fusionado, **no hay vuelta atrás de
datos**: es otra razón para no invitar antes. Detalle en `docs/RUNBOOK.md`, «Respaldo y restauración de staging».

**Aplicación fuera de servicio.** Sin el host no funciona nada: ni la web, ni la API, ni el correo ni los avisos. Los
datos siguen en los dos destinos del respaldo, y las imágenes en GHCR.

## Respaldos

| Respaldo | Cuándo | Cubre | Límite |
|---|---|---|---|
| Restic a OCI Object Storage (C1) | Nocturno, 06:30 UTC (Q4) | Mongo entero y los objetos de CV y snapshots, cifrados por restic, **modelo V** (versionado + ciclo de vida) | RPO de 24 h; misma cuenta de Oracle; tope de 4 GiB (`BACKUP_MAX_REPO_BYTES`) bajo los 10 GB por nivel |
| Restic al destino fuera de Oracle (C1, Q2) | En la misma corrida | Lo mismo | RPO de 24 h; límites del destino elegido |
| Copia de `.env.staging` (35b 5.8) | Cada vez que cambia | Claves de cifrado, contraseñas de datos y `RESTIC_PASSWORD` | Manual: toda tarea que edita el archivo actualiza la copia |
| `acme.json` (35b 6.9) | Al emitir el certificado de producción | Certificado y cuenta ACME | Se puede reemitir, con límites de Let's Encrypt |

Redis no se respalda: guarda colas y caché, y el outbox de Mongo vuelve a encolar lo que no se publicó.

Una vez por mes (los dos primeros meses; después, trimestral), restaurá la última instantánea en una pila limpia y comprobá que
abre una cuenta de prueba y un CV, con `restore-drill.sh`. La prueba se hace **siempre en el host**, en el proyecto de Compose
aparte de la fase 9 (`docker-compose.restore.yml`, sin Traefik ni puertos) y con `down -v` al terminar, **nunca en tu PC**: con invitados el respaldo tiene CV reales. Un respaldo que
nunca se probó no cuenta.

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
| Poda de los repositorios con la credencial de poda, desde tu PC (sesión mensual de `docs/RUNBOOK.md`) | Mensual |
| Verificación de las copias desde la PC (`restic snapshots`) | Quincenal (5 minutos) |
| *Cost Analysis* de Oracle en 0 y tamaño del bucket de respaldo | Mensual |
| Actualizaciones de Ubuntu (`unattended-upgrades` ya activo) y reinicio si lo pide (`/var/run/reboot-required`) | Mensual |
| Dependencias e imágenes: Renovate en el repo, CI en verde, despliegue por merge | Según los PR |
| Revisar los cambios de Always Free, Brevo y OpenRouter | Trimestral |
| Rotar el token del registro antes de su caducidad (35b 5.9) | Según la caducidad anotada |
| Rotar la clave de despliegue SSH y las credenciales del respaldo | Anual, o si se sospecha una filtración |
| Rotar `AUTH_JWT_SECRET` (cierra todas las sesiones) y `AI_VAULT_KEY` (exige volver a cifrar las claves BYOK guardadas) | Solo si se sospecha una filtración |
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
| `mongo` no llega a `healthy` tras restaurar | El volumen quedó sin usuario raíz: se restauró sobre un volumen nuevo sin inicializar, o se pisó `admin.*` | Restaurar sin `admin.*` (lo hace `restore.sh`), con `MONGO_ROOT_USER` y `MONGO_ROOT_PASSWORD` de la copia de `.env.staging`, sobre un volumen que `mongo` inicializó con ellos |

Para ver los errores de producción, en el host:

```bash
$DC logs --since 1h api worker
```

## Salir de Oracle hacia el plan B

El plan B es **`casa-tunel`**: la misma pila en un equipo del owner siempre encendido, expuesta con un túnel. Se activa
con la regla de corte 1, 3, 4 o 6, o si Oracle recupera la instancia o cierra la cuenta.

Qué se lleva: todo. La base y los objetos están en los dos destinos del respaldo, la configuración en el repositorio,
las imágenes en GHCR y los secretos en la copia de `.env.staging`. Qué es irreversible: la región de origen de la
cuenta de Oracle, lo que se haya perdido después del último respaldo, y el bucket de respaldo de Oracle, que **no se
puede borrar hasta que vence su regla de retención**: hasta entonces sigue ocupando espacio (dentro de Always Free si
no pasa de 10 GB).

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
cuando venza su retención (después de comprobar el paso 3), y volver a mirar *Cost Analysis* al mes siguiente.

## Cierre del despliegue

- [ ] Fase 0: repositorio listo.
- [ ] Fase 1: cuenta, estimador en 0, pago por uso decidido, presupuesto con dos alertas, cuotas.
- [ ] Fase 2: host creado y SSH endurecido.
- [ ] Fase 3: secretos cargados y copia de `.env.staging` comprobada.
- [ ] Fase 4: primer despliegue antes del 2026-12-07 (o la alternativa de 35b 6.3).
- [ ] Fase 5: verificación sin login.
- [ ] Fase 6: correo medido, IA real, monitor de respaldos creado.
- [ ] Fase 7: ensayo 9.1-9.4 con la pila vacía, PR-2 de 35b fusionado en su ventana, 11.6.
- [ ] Fase 8: C2 y C1 fusionados en la ventana posterior a la 11.6; respaldo en dos destinos, bucket privado, borrado
  protegido, aviso probado.
- [ ] Fase 9: restauración ensayada en el host con el volumen existente, en proyecto aparte; cabeceras completas; Q5
  respondida.
- [ ] Fase 10: prueba con datos ficticios superada y cuentas de prueba borradas.
- [ ] Fase 11: invitados dados de alta y primer respaldo con datos reales en los dos destinos.
- [ ] `despliegue.json` actualizado al cierre.
- [ ] Recordatorios creados: restauración mensual, poda mensual, revisión de costo mensual.
