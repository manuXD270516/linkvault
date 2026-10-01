# Revisión de la configuración de despliegue

Procedimiento para **revisar**, de una pasada, que la configuración de un despliegue de LinkVault es la que dicen los
ADR, antes de que un fallo lo descubra. No sustituye a [`README.md`](README.md) (cómo se despliega) ni a las secciones
de operación del [RUNBOOK](../docs/RUNBOOK.md): los comprueba.

Cada comprobación dice **qué** mirar, **por qué** (el ADR o la spec que lo exige), **cómo** (comando de solo lectura)
y **qué debe salir**. Ninguna modifica nada, y ninguna imprime un secreto.

## Cuándo pasarla

| Momento | Pasos |
|---|---|
| Antes de cargar los secretos de un destino (el PR-1 de 35b, ADR-051 §4) | 1, 3, 4 |
| Antes del primer despliegue a un host nuevo | todos |
| Tras cambiar `docker-compose.prod.yml`, `.env.example`, un workflow de CD o `infra/ci/` | 1, 2, 4 |
| Cada mes con staging en marcha, y antes de invitar a nadie (ADR-051 §6) | 3, 5–9 |

## Cómo leer las etiquetas

La fila 35 está a medias (ADR-051 §1), así que no todo lo que se revisa existe todavía:

- **[hoy]** — existe en `main` y se puede comprobar ya.
- **[35b]** — llega con `staging-host`: host de Oracle, guardias de despliegue, `sslip.io`, correo con Brevo.

Una comprobación de una pieza que aún no está fusionada no se marca como fallida: se marca **N/A** en el registro
(paso 10). Cuando la pieza se fusione, quitar su etiqueta de aquí es parte de su cierre.

**Estado de este documento (2026-09-26):** los comandos de los pasos 1-4 se han ejecutado contra `main` (`3ce5368`), y
su resultado de ese día está en «Línea base». Los de los pasos 5-9 se ejecutan en el host, que aún no existe: son el
procedimiento, no algo ya probado, y la primera revisión real los confirma o los corrige aquí.

---

## 1. El repositorio, sin host [hoy]

Desde la raíz, en `main` actualizado.

| Qué | Por qué | Cómo | Esperado |
|---|---|---|---|
| Comprobaciones de repositorio | ADR-048 §5: compose, healthchecks, contrato de env, docs | `bash infra/ci/repo-checks.sh` | `ok: 5 comprobaciones de repositorio ejecutadas` |
| Specs válidas | `platform/ci-pipeline` | `pnpm exec openspec validate --all --no-interactive` | `0 failed` |
| Mismas etapas en los tres `verify` | «El CD verifica con las mismas etapas que la integración continua» (ADR-050) | `node infra/ci/check-verify-stages.mjs` | `same stages, same order` |
| El compose resuelve con un env completo | README «Arranque» | En una máquina con Docker: `docker compose -f docker-compose.prod.yml --env-file <env> config --quiet` | Sin salida y código 0 |
| Catálogo i18n al día | `web/i18n` (ADR-050) | `pnpm nx run web:i18n-check` | `messages.xlf is the output of the extraction` |

## 2. El env file del destino [hoy]

El fichero (`.env.staging`, `.env.prod`) vive **solo en el host y en su copia de seguridad** (ADR-051 §2), nunca en el
repositorio.

| Qué | Por qué | Cómo | Esperado |
|---|---|---|---|
| Contrato completo | Obligatorias `${VAR:?}` del compose, formatos y valores prohibidos (README «Variables de entorno») | `node infra/ci/check-env-file.mjs <env-file>` | `all checks passed`. Imprime **solo nombres**, nunca valores. |
| Permisos del fichero | Contiene `AI_VAULT_KEY` y todas las credenciales | En el host: `stat -c '%a %U' <env-file>` | `600` y el usuario de despliegue |
| Copia fuera del host | Sin `AI_VAULT_KEY` las claves BYOK guardadas no se descifran (ADR-051 §2) | `sha256sum` del original y de la copia | Los dos hashes iguales. Anotar en el registro solo la fecha de la copia, no el hash. |

`check-env-file.mjs` lee las obligatorias del propio compose, así que sigue solo a 35b (cuando el compose declare
`MAIL_SMTP_USER`/`MAIL_SMTP_PASSWORD`, las exige con `MAIL_PROVIDER=smtp`). La clave del cifrado de los CV,
`OBJECT_STORE_SSE_KEY`, la comprueba además con la misma regla que el guardia de arranque del almacén (64 caracteres
`[0-9a-f]`; design D16 de `object-store`) y rechaza el valor de desarrollo de `docker-compose.yml` y el de relleno de
`infra/ci/verify.env`, que el guardia sí deja pasar porque tienen el formato. El guardia sigue siendo la última
barrera: sale con `64` ante una clave ausente o mal formada y con `65` sobre un volumen que arrancó sin ella (README
«Almacén de objetos (CV y snapshots)»).

## 3. Secretos de GitHub y quién puede desplegar [hoy]

**Quien tiene escritura en el repositorio tiene root en staging** (ADR-051 §4): puede escribir un workflow que lea los
secretos, y el usuario de despliegue está en el grupo `docker`. Por eso esta revisión mira el acceso, no solo los
secretos.

| Qué | Cómo | Esperado |
|---|---|---|
| Colaboradores | `gh api repos/manuXD270516/linkvault/collaborators --jq '.[] \| "\(.login) \(.role_name)"'` | Solo el autor |
| Claves de despliegue | `gh api repos/manuXD270516/linkvault/keys --jq '.[] \| "\(.title) read_only=\(.read_only)"'` | Ninguna, o todas `read_only=true` |
| GitHub Apps con acceso al repositorio | En GitHub: *Settings → Integrations → GitHub Apps* (la API pide un token de app) | Cada una anotada en `infra/README.md` con sus permisos |
| Secretos presentes (nombres, nunca valores) | `gh secret list` | Los cuatro `STAGING_*` **todos o ninguno** (el preflight falla con un destino a medias, ADR-048 §3), y lo mismo con `PROD_*`. `GHCR_READ_TOKEN` si hay destino. |
| Caducidad del token del registro [35b] | Anotada en el RUNBOOK por la tarea 5.9 de `staging-host` | Fecha futura, con margen de un mes |

## 4. Workflows de CD [hoy, 35b]

| Qué | Por qué | Cómo | Esperado |
|---|---|---|---|
| Nada se publica sin verificar [hoy] | ADR-048 §4 | `grep -n "needs: verify" .github/workflows/cd-staging.yml .github/workflows/cd-prod.yml` | `build-verify-publish` depende de `verify` en los dos |
| El release verifica todo el workspace [hoy] | «CD a producción por tag semver» | `grep -n "nx affected" .github/workflows/cd-prod.yml` | Ninguna coincidencia: en `cd-prod` todo es `run-many --all` |
| Se verifica la arquitectura del destino [hoy] | ADR-051 §3 | `grep -n "runs-on" .github/workflows/cd-staging.yml` | `build-verify-publish` en `ubuntu-24.04-arm` |
| El modo de prueba no despliega [35b] | ADR-051 §4 (guardia de accidentes) | Leer el `if:` del job de despliegue | Excluye `dry_run` y cualquier ref que no sea `refs/heads/main` |
| El despliegue no usa acciones de terceros con la clave [35b] | ADR-051 §Consecuencias | Buscar `uses:` en el job de despliegue | Solo OpenSSH nativo, con `known_hosts` fijado y comprobación estricta |

## 5. El host [35b]

En el host, por SSH con el usuario de despliegue.

| Qué | Por qué | Cómo | Esperado |
|---|---|---|---|
| Arquitectura | ADR-051 §3 | `uname -m` | `aarch64` |
| Docker oficial | Tarea 5.3 de `staging-host` | `docker version --format '{{.Server.Version}}'` y `docker compose version` | Versiones anotadas en `infra/README.md` |
| IP reservada | El nombre `sslip.io` depende de la IP (ADR-051 §Riesgos) | Consola de Oracle: la IP pública es *Reserved* | *Reserved*, no *Ephemeral* |
| SSH solo con clave | Acceso root de hecho vía `docker` | `sudo sshd -T \| grep -Ei '^(passwordauthentication\|permitrootlogin)'` | `passwordauthentication no`, `permitrootlogin no` |
| Cortafuegos en dos capas | Tarea 5.1 de `staging-host` | Lista de seguridad de Oracle **y** `sudo iptables -S INPUT` (o `ufw status`) | Entrada solo en 22, 80 y 443 |
| Nada más escucha fuera | Mongo, Redis y el almacén son solo red interna | `sudo ss -tlnp` | En `0.0.0.0`/`[::]` solo 22, 80 y 443 |
| Memoria por encima del umbral de reclamación | Oracle reclama si CPU, red **y memoria** están por debajo del 20 % durante 7 días (ADR-051 §Riesgos) | `free -m` con la pila levantada | Memoria usada > 20 % del total. Si no, anotarlo: es la defensa práctica mientras no haya pago por uso. |

## 6. El borde: nombre y certificado [35b]

| Qué | Por qué | Cómo | Esperado |
|---|---|---|---|
| El nombre resuelve a la IP | ADR-051 §2 | `dig +short <ip-con-guiones>.sslip.io @1.1.1.1` y `@8.8.8.8` | La IP reservada, en los dos |
| Certificado de producción, no de pruebas | La primera emisión va contra el entorno *staging* de ACME (ADR-051 §2) | `echo \| openssl s_client -connect <host>:443 -servername <host> 2>/dev/null \| openssl x509 -noout -issuer -enddate` | Emisor de Let's Encrypt **sin** `(STAGING)`, y caducidad futura |
| HTTP redirige a HTTPS | Borde de Traefik | `curl -sI http://<host>/ \| head -1` | `301` o `308` |
| Traefik sin el socket de Docker | Tarea 4.6 de `staging-host` | `grep -n docker.sock docker-compose.prod.yml` | Ninguna coincidencia (hoy **sí** lo monta, `:ro`) |
| Readiness no expuesta al público | README «Smoke de readiness (nunca Traefik público)» | `curl -s -o /dev/null -w '%{http_code}' https://<host>/health` | No es el JSON de Nest (404 o el SPA) |

## 7. Servicios en marcha [hoy en el compose; se ejecuta en el host]

Con `C="docker compose -f docker-compose.prod.yml --env-file <env-file>"` en el directorio del compose.

| Qué | Por qué | Cómo | Esperado |
|---|---|---|---|
| Todo sano | `up --wait` solo espera a lo que tiene healthcheck | `$C ps --format '{{.Service}} {{.Status}}'` | Todos `healthy` |
| Readiness interna | README «Checklist pre-prod» | El `node -e … fetch('http://127.0.0.1:3000/health')` del README, con `$C exec -T api` | `200` y JSON con `status: up` |
| Un solo relay del outbox | README «relay único» | `$C config \| grep -n OUTBOX_RELAY_ENABLED` | `true` solo en `api`, y una sola réplica de `api` |
| Replica set de Mongo | Las transacciones lo exigen (21 ficheros usan sesiones) | `$C exec -T mongo mongosh --quiet --eval 'rs.status().ok'` | `1` |
| Redis sin desalojo | BullMQ exige `noeviction`, y el compose no lo fija: vale el valor por defecto de Redis | `$C exec -T redis redis-cli CONFIG GET maxmemory-policy` | `noeviction` |
| Redis persiste | El compose arranca con AOF | `$C exec -T redis redis-cli CONFIG GET appendonly` | `yes` |
| Almacén: buckets, cifrado del de CV y retención de snapshots | README «Almacén de objetos (CV y snapshots)»; ADR-052 §4 y §7 (la retención es el barrido diario del `worker`, no una regla del almacén) | `docker compose -f docker-compose.prod.yml --env-file <env-file> run --rm --no-deps api node object-store.js verify` (no escribe nada) | `verify: ok`: los dos buckets presentes, **ninguna** regla de ciclo de vida, cifrado por defecto en el de CV, ningún snapshot de más de 31 días y acceso anónimo rechazado |

## 8. Correo [hoy, 35b]

| Qué | Por qué | Cómo | Esperado |
|---|---|---|---|
| No es `capture` | `capture` guarda en memoria y no envía (README «Correo») | Paso 2 (`check-env-file.mjs`) | `PASS  MAIL_PROVIDER is smtp or resend` |
| SMTP autenticado [35b] | Brevo pide usuario y contraseña: letra (e) de ADR-051 | Paso 2 | `MAIL_SMTP_USER` y `MAIL_SMTP_PASSWORD` en PASS |
| Llega a la bandeja de entrada [35b] | Umbral de ADR-051 §6: 2 de 3 proveedores; sin dominio no hay DKIM alineado | Registrar una cuenta de prueba en Gmail, Outlook y un tercero | En la bandeja (no en spam) en al menos 2 de 3. Si no, **no se invita**. |
| Cuota | Brevo gratuito: 300 correos al día (ADR-051 §2) | Panel de Brevo | Uso diario lejos del tope |

## 9. IA [hoy]

| Qué | Por qué | Cómo | Esperado |
|---|---|---|---|
| Sin `mock` en producción | `parseAiConfig` aborta el arranque | Paso 2 | PASS en `AI_CHAIN`/`AI_EMBED_CHAIN` |
| Solo modelos gratuitos | README «Variables de entorno»; ADR-051 §2 | Paso 2 | `OPENROUTER_MODEL ends with :free` |
| Sin búsqueda ni embeddings en staging | ADR-051 §6: decisión del design | `grep -nE "FEATURE_SEARCH\|MEILI_\|AI_EMBED_CHAIN" docker-compose.prod.yml` | Ninguna coincidencia |
| `data_collection: deny` | ADR-032 §4 | Es código, no configuración: lo cubren los tests de `libs/ai` en CI | CI en verde |

## 10. Registro de la revisión

Una fila por revisión, añadida al final de este fichero en el mismo PR que corrige lo que salga. **Nunca** un valor
de un secreto, una IP de un host de producción o datos de personas.

| Fecha | Commit | Destino | Pasos | Resultado | Hallazgos |
|---|---|---|---|---|---|

### Línea base (2026-09-26, `main` en `3ce5368`, sin host)

| Paso | Resultado |
|---|---|
| 1 | `check-verify-stages`: las tres con `Repo checks → Lint → Validate OpenSpec specs → Typecheck → Test → i18n catalog → Eval (replay) → Build`. El resto del paso lo ejecuta el CI en cada PR. |
| 2 | `check-env-file.mjs .env.example` falla en 9 comprobaciones, como debe: `.env.example` es de local, no de despliegue. |
| 3 | Colaboradores: solo el autor (`admin`). Claves de despliegue: 0. Secretos de despliegue: ninguno, estado `none` del preflight («verificado sin destino», ADR-048 §3). GitHub Apps: **sin revisar** (necesita la interfaz). |
| 4 | [hoy] correcto. [35a] y [35b]: N/A. |
| 5-9 | N/A: no hay host. Traefik aún monta `docker.sock` (lo quita 35b). |
