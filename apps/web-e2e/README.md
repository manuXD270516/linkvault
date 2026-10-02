# web-e2e — suite end-to-end de LinkVault

Suite de Playwright de LinkVault (change `e2e-suite`, ADR-053). Lo **reproducible** es lo etiquetado `@lot1`: hoy, un
solo recorrido, el camino crítico (`src/critical-path.spec.ts`, design D11), en escritorio (`chromium`) y en un móvil
emulado (`mobile`, Pixel 7). El resto de specs sigue por el camino antiguo (ver abajo) hasta que su lote los admita.

## El comando de la suite

```bash
pnpm nx run web-e2e:e2e-stack
```

Es **el mismo comando en local y en CI** (`e2e.yml`, job `local`). Monta una pila **aislada**, sirve `api` y `worker`
(`nx serve`) y `web` (`nx serve web -c production`) desde el código del checkout, ejecuta Playwright con el perfil
`local` y **apaga lo que arrancó**, también si falla o se interrumpe (Ctrl+C). Sale con ≠0 si falla cualquier fase o
prueba, y el mensaje nombra la fase: comprobación previa, infraestructura, aplicaciones, siembra, suite o apagado.

La infraestructura se levanta con el comando de arranque local del repositorio, **`pnpm infra:up`** (35a,
`object-store`: `docker compose up -d --wait` + `api:object-store -- provision`, que crea los buckets), con el proyecto
de compose de la suite (`COMPOSE_PROJECT_NAME`) y `apps/web-e2e/e2e.env` como fichero de entorno (`COMPOSE_ENV_FILES`).
Hay un solo sitio en el runner que arranca la infraestructura: `startInfra` en `scripts/lib/infra.ts`.

Los argumentos que no son del runner pasan a Playwright: `--grep` (siempre combinado con `@lot1`), ficheros,
`--project=chromium|mobile`, `--repeat-each=N`, `--list`. Informes y diagnóstico en `dist/.playwright/apps/web-e2e/`:
`playwright-report/` y `test-output/` (perfil `local`), `playwright-report-remote/` y `test-output-remote/` (ensayo), y
`stack-logs/` (`runner.log`, `api.log`, `worker.log`, `web.log`, `infra.log`). Cada prueba que falla deja su traza y su
vídeo.

## Opciones del runner

Todas son **flags**: el runner **no lee el entorno** para sus entradas, porque Nx carga el `.env` de la raíz en la tarea
antes de lanzarlo (design D3). La única excepción son las credenciales remotas (ver «Credenciales remotas»).

| Flag | Qué hace |
|---|---|
| `--rehearse-remote` | Tras el perfil `local`, siembra la cuenta del ensayo por la API pública, reinicia **solo** `worker` con un proveedor de IA externo inalcanzable y ejecuta el **ensayo**: el perfil `remote` contra la misma pila. Solo cuando se pide (verificación del grupo 4, admisión, cambios en el perfil `remote`). |
| `--skip-local` | Solo junto a `--rehearse-remote`: ejecuta solo el ensayo (admisión del ensayo sin gastar los intentos de registro del perfil `local`). Sin `--rehearse-remote`, sale con ≠0 sin arrancar nada. |
| `--match-expectation replay-report\|consent-required` | Desenlace esperado del paso 7 (design D7). En `e2e-stack`: `replay-report` en `local` y `consent-required` en el ensayo si no se pasa; si se pasa, vale para los dos perfiles de la corrida. En `e2e-remote`, **obligatoria**. |
| `--keep-stack` | No apaga: deja la pila levantada e imprime la orden para apagarla. |
| `--down` | Apaga una pila dejada con `--keep-stack` (solo los PID que esa corrida lanzó y su proyecto de compose). |
| `--web-port`, `--api-port`, `--worker-port`, `--mongo-port`, `--redis-port`, `--object-store-port`, `--mailpit-smtp-port`, `--mailpit-ui-port` | Anulaciones del bloque de puertos. Desplazan el bloque y cambian el nombre del proyecto. |
| `--base-url`, `--api-origin` | Origen del destino (`e2e-remote`); el de la API se deriva siempre de `--base-url` y uno distinto hace fallar la corrida antes de ejecutar nada. |
| `--stack-fault …` | Solo para falsar los guardias del runner (tareas 2.4c, 2.6b, 2.7); lo anuncia en su salida. |

Ninguna variable `E2E_*_PORT`, `E2E_BASE_URL`, `E2E_API_ORIGIN`, `E2E_MATCH_EXPECTATION` ni `E2E_STACK_FAULT` del
entorno cambia nada: esas variables existen solo **del runner hacia Playwright**.

## Los dos perfiles

| | `local` | `remote` |
|---|---|---|
| Target | `web-e2e:e2e-stack` (y el ensayo de `--rehearse-remote`) | `web-e2e:e2e-remote` |
| Pila | la monta el runner | no la monta nadie |
| Pruebas | `@lot1` | `@lot1` **y** `@remote-safe` |
| Cuentas | las registra cada prueba (A y, en el camino crítico, B) | la cuenta de prueba declarada |
| Encaje (paso 7) | `replay-report`: el informe exacto del fixture de replay | el que declara `--match-expectation` |
| Origen de la API | el de la pila | **siempre** `new URL('/api', --base-url)` |

```bash
pnpm nx run web-e2e:e2e-remote -- --base-url https://<origen> --match-expectation consent-required
```

`e2e-remote` no monta nada: comprueba el origen, la expectativa y las credenciales, y ejecuta el perfil `remote`
contra `--base-url`. Sin origen, con un `--api-origin` distinto o sin `--match-expectation`, sale con ≠0 sin ejecutar
ninguna prueba. No hay excepciones de TLS (`ignoreHTTPSErrors` está prohibido): un certificado no confiable hace fallar
la corrida.

## Credenciales remotas

`E2E_REMOTE_EMAIL` y `E2E_REMOTE_PASSWORD` son las **únicas** entradas que el runner lee del entorno: en un flag
quedarían en la lista de procesos. Se ponen **en la sesión**, sin dejar el valor en el historial; **nunca** con un
`export` que lleve el valor escrito, y **nunca** en un `.env`: si cualquiera de las dos está en alguno de los `.env*`
que Nx cargaría (los de la raíz y los de `apps/web-e2e/`, salvo `.env.example`), el runner falla sin ejecutar nada
(«pásala en el entorno de la sesión, no en un `.env`»).

PowerShell (`Read-Host -AsSecureString` para la contraseña):

```powershell
$env:E2E_REMOTE_EMAIL = Read-Host 'E2E_REMOTE_EMAIL'
$secret = Read-Host -AsSecureString 'E2E_REMOTE_PASSWORD'
$env:E2E_REMOTE_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
```

bash (`read -s` para la contraseña; `export` solo con el nombre):

```bash
read -r -p 'E2E_REMOTE_EMAIL: ' E2E_REMOTE_EMAIL && export E2E_REMOTE_EMAIL
read -r -s -p 'E2E_REMOTE_PASSWORD: ' E2E_REMOTE_PASSWORD && echo && export E2E_REMOTE_PASSWORD
```

En el ensayo (`--rehearse-remote`), la cuenta del ensayo sale de `e2e.env` (`rehearsal+e2e@example.com`), no del
entorno. En CI, los secretos `E2E_STAGING_EMAIL`/`E2E_STAGING_PASSWORD` llegan al paso por `env:` con esos dos nombres.

## Bloque de puertos y nombre de proyecto

| Servicio | Desarrollo | Suite | Flag |
|---|---|---|---|
| `web` | 4200 | 4300 | `--web-port` |
| `api` | 3000 | 3100 | `--api-port` |
| `worker` (salud) | 3001 | 3101 | `--worker-port` |
| Mongo | 27017 | 27117 | `--mongo-port` |
| Redis | 6379 | 6479 | `--redis-port` |
| Almacén S3 (`object-store`) | 9000 | 9100 | `--object-store-port` |
| Mailpit (SMTP / UI y API) | 1025 / 8025 | 1125 / 8125 | `--mailpit-smtp-port`, `--mailpit-ui-port` |
| Inspector de `api` / `worker` (solo con `--stack-fault=inspect`) | 9229 | 9329 / 9330 | — |

Antes de arrancar nada, el runner comprueba que **cada** puerto del bloque está libre (conexión a `127.0.0.1` y `::1`, y
`bind`), que Docker y Chromium están listos y que no hay un `nx serve` de `api` o `worker` de **este** checkout (uno de
otro worktree no bloquea). Tras levantar, exige que todo puerto publicado por compose esté dentro del bloque y que cada
proceso que escucha en el puerto de una aplicación sea del árbol que lanzó.

El proyecto de compose es **`linkvault-e2e-<hash8>`**: los ocho primeros hex del SHA-256 de la ruta del checkout
normalizada (unidad en minúscula, barras `/`, sin separador final) más el bloque efectivo. El runner lo imprime al
empezar. Dos checkouts, o dos bloques, no comparten contenedores ni volúmenes; la pila de desarrollo (`linkvault`) no se
toca.

## Qué hace el apagado

Siempre (`finally` y `SIGINT`/`SIGTERM`), salvo con `--keep-stack`:

1. Termina el árbol de cada proceso que **esta** corrida lanzó (Playwright, `api`, `worker`, `web`; en Windows
   `taskkill /T /F` por el PID raíz). Nunca mata por nombre ni por puerto.
2. `docker compose -p <proyecto> down -v --remove-orphans`: sin contenedores ni volúmenes del proyecto.
3. Vuelve a probar el bloque y falla nombrando el puerto que siga ocupado.

Con `--keep-stack`, `pnpm nx run web-e2e:e2e-stack -- --down` hace lo mismo sobre la pila guardada. En Windows, si un
`--keep-stack` lanzado por `pnpm nx run` termina en rojo, Nx termina `api`, `worker` y `web` al salir: el runner lo
avisa y da la orden directa con `node` (riesgo abierto, design D3).

## Presupuesto de intentos de registro

El producto limita el registro a **10 intentos de registro cada 15 minutos por IP** (ADR-020), y el limitador consume
**antes** de crear la cuenta: un `409` y la siembra («alta; si existe, login») cuentan igual (design D5).

| Corrida | Intentos de registro |
|---|---|
| `e2e-stack`: perfil `local`, `chromium` y `mobile`, dos personas cada uno | 4 |
| `e2e-stack --rehearse-remote`: lo anterior + la siembra de la cuenta del ensayo | 5 |
| Admisión de `local` en **un** proyecto, `--repeat-each=5` (una invocación por proyecto, pila nueva) | 10, **justo el límite** |
| Admisión del ensayo en un proyecto (`--rehearse-remote --skip-local`) | 1 |

Un lote que añada un intento al recorrido hace caer la admisión de `local` con el `429` del producto, nombrado en el
informe: ese lote decide cómo repartirlo.

## Cómo admitir una prueba

Una prueba entra en la suite reproducible (design D14 y D12) cuando:

1. Lleva la etiqueta de su lote (`@lot1` en este change) y, solo si cumple el perfil `remote` (no escribe en Mongo ni
   Redis, no llama a `docker`, no lee Mailpit ni afirma una salida concreta del mock), también `@remote-safe`.
2. Pasa por el runner en verde, sin esperas fijas ni saltos (el lint de `apps/web-e2e` los rechaza: `waitForTimeout`,
   `waitForSelector`, el `setTimeout` global y `test.skip` en `error`), sincronizándose con respuestas, navegaciones o
   estados visibles armados antes de la acción.
3. Pasa la **admisión con carga**: `--repeat-each=5` en verde **con la CPU cargada** (tantos procesos `node` en un bucle
   ocupado como núcleos, desde que empieza Playwright: ver «Admisiones»), en **cada proyecto** en que se ejecuta (`chromium` y `mobile`) y en cada perfil (`local` y el
   ensayo), **una invocación del runner por proyecto y perfil, sobre una pila nueva**:

   ```bash
   pnpm nx run web-e2e:e2e-stack -- --project=chromium --repeat-each=5
   pnpm nx run web-e2e:e2e-stack -- --rehearse-remote --skip-local --project=chromium --repeat-each=5
   pnpm nx run web-e2e:e2e-stack -- --project=mobile --repeat-each=5
   pnpm nx run web-e2e:e2e-stack -- --rehearse-remote --skip-local --project=mobile --repeat-each=5
   ```

   Cinco de cinco en cada una y ningún `429` de registro en `stack-logs/api.log`. Un intermitente se arregla (la
   sincronización) y se repite, o no se admite: no se reintenta hasta que salga. En CI, un reintento que pasa cuenta
   como fallo (`failOnFlakyTests`).
4. Su resultado se anota aquí, con fecha, en «Admisiones».

## El camino antiguo, no reproducible

```bash
pnpm nx e2e web-e2e
```

Ejecuta todos los specs contra la pila que cada cual tenga levantada (reutiliza o arranca un `nx serve web` en `4200`,
con la `api` y el `worker` que haya), con los supuestos de entorno de cada spec (Mongo en `27017`, `docker exec
linkvault-redis-1`, `localhost:4200` escrito a mano, flags del `.env`…). **No es reproducible**: su resultado depende de
la máquina y de lo que otra sesión tenga en esos puertos. Sirve para iterar sobre un spec **no admitido**; ningún spec
sin `@lot1` cuenta como verificado hasta que su lote lo admita (design D1, D14).

## El `.env` es intocable

- La suite **no lee ni escribe** el `.env` de quien la ejecuta: `api`, `worker`, `web`, compose y Playwright reciben
  solo `apps/web-e2e/e2e.env` (versionado, sin secretos: IA en `mock`/`replay`, correo al Mailpit del bloque, flags de
  producto apagados) más una lista blanca de variables del sistema (design D6). Un cambio en el `.env` no cambia el
  resultado de la suite.
- No se pone configuración de la suite en el `.env`, y **nunca** las credenciales remotas (el runner falla).
- Una tarea o prueba que necesite editar el `.env` lo copia antes y lo restaura comprobando con `node` que queda
  idéntico byte a byte.

## CI y minutos

`e2e.yml` se lanza **solo a mano** (`workflow_dispatch`, entradas `target` —`local` | `staging`— y `rehearse_remote`),
no en cada pull request ni es check obligatorio. **Umbral de minutos**: antes de cada corrida manual se consulta el
consumo del mes de GitHub Actions; con el **70 %** o más de los 2000 minutos del plan consumidos **no se lanza
`e2e.yml`**: la suite se ejecuta en local con el mismo comando, sin minutos (ADR-053 §1.2). Staging solo se lanza desde
`main`.

## Staging

- **Como mucho 5 corridas contra staging por día**: la cuenta de prueba tiene un cupo de 10 análisis de encaje al día y
  cada corrida en verde gasta dos (uno por proyecto); un `429` del cupo se resuelve otro día (design D10).
- **Prohibido lanzar la suite remota contra staging los días 7 y 14 de la medición de 35b** (ni `e2e-remote` ni
  `e2e.yml` con `target: staging`).
- La cuenta de prueba la crea el autor a mano: alias `+e2e`, email **sin verificar** y **sin** permiso de IA externa. La
  suite lo comprueba por la API antes de tocar nada y falla sin cambiar la cuenta si no se cumple; luego limpia lo que
  dejó una corrida anterior y, al terminar, lo que creó.

## Admisiones

Cada admisión con carga (design D12): cinco de cinco por proyecto y perfil, una invocación del runner con pila nueva
cada una, y ningún intento de registro con `429` en `stack-logs/api.log`.

**Carga usada:** tantos procesos `node` en un bucle ocupado como núcleos (24 en la máquina de estas corridas), desde que
empieza Playwright hasta que termina la corrida. Con la carga desde antes de arrancar la pila, `nx serve api` no llegó
a cargar sus plugins de Nx en el plazo de Nx y la corrida cayó en la fase «aplicaciones», antes de ejecutar ninguna
prueba (medido el 2026-09-28).

### 2026-09-28 — `critical-path.spec.ts` en `chromium` (tarea 5.9a, sobre `e2d0cc5`)

| Invocación | Resultado | Registro |
|---|---|---|
| `pnpm nx run web-e2e:e2e-stack -- --project=chromium --repeat-each=5` | 5 de 5 en verde (3,9 min) | 10 `POST /api/auth/register` `201`, ningún `429` |
| `pnpm nx run web-e2e:e2e-stack -- --rehearse-remote --skip-local --project=chromium --repeat-each=5` | 5 de 5 en verde (2,6 min) | 1 (la siembra) `201`, ningún `429` |

### 2026-09-28 — `critical-path.spec.ts` en `mobile` (tarea 5.9b, sobre `e2d0cc5`)

| Invocación | Resultado | Registro |
|---|---|---|
| `pnpm nx run web-e2e:e2e-stack -- --project=mobile --repeat-each=5` | 5 de 5 en verde (3,8 min) | 10 `POST /api/auth/register` `201`, ningún `429` |
| `pnpm nx run web-e2e:e2e-stack -- --rehearse-remote --skip-local --project=mobile --repeat-each=5` | 5 de 5 en verde (2,7 min) | 1 (la siembra) `201`, ningún `429` |

Con la 5.9a, el camino crítico queda **admitido** en el lote 1: `chromium` y `mobile`, perfil `local` y ensayo.

### 2026-10-02 — readmisión de `critical-path.spec.ts` (sobre `491d0a0`)

La sincronización del paso 7 cambió después de la admisión: los sondeos del análisis se leen por `page.route` en vez de
con `response.json()`, que en el runner Linux de CI no tenía el cuerpo (corrida 36827569812). Se repiten las cuatro
invocaciones, con la carga de arriba (24 procesos desde que empieza Playwright):

| Invocación | Resultado | Registro |
|---|---|---|
| `pnpm nx run web-e2e:e2e-stack -- --project=chromium --repeat-each=5` | 5 de 5 en verde (4,3 min) | 10 `POST /api/auth/register` `201`, ningún `429` |
| `pnpm nx run web-e2e:e2e-stack -- --rehearse-remote --skip-local --project=chromium --repeat-each=5` | 5 de 5 en verde (2,7 min) | 1 (la siembra) `201`, ningún `429` |
| `pnpm nx run web-e2e:e2e-stack -- --project=mobile --repeat-each=5` | 5 de 5 en verde (3,8 min) | 10 `POST /api/auth/register` `201`, ningún `429` |
| `pnpm nx run web-e2e:e2e-stack -- --rehearse-remote --skip-local --project=mobile --repeat-each=5` | 5 de 5 en verde (2,5 min) | 1 (la siembra) `201`, ningún `429` |

Ningún fallo ni intermitente. El camino crítico sigue **admitido** con la sincronización nueva.
