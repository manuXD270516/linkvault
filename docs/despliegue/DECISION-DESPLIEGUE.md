# Decisión de despliegue: LinkVault

**Fecha:** 2026-11-16. **Método:** 3 agentes defendieron una plataforma cada uno, un crítico atacó cada propuesta
comprobando sus supuestos contra la documentación vigente y el repositorio, 3 jueces con lentes distintas (costo,
seguridad y operación) puntuaron y votaron sin verse entre sí, y un árbitro revisó el resultado: 9 agentes en total,
aprobados por el owner. Profundidad: `normal`. Modo: `proponer` (no se desplegó ni se creó nada).

**No terminado hasta C1: sin respaldo fuera de Oracle ni restauración probada.**

**Fusión de este documento:** el PR que lo trae **no se fusiona hasta la ventana del PR-2 de 35b** (entre PR-1b y PR-2
no se fusiona nada a `main`); mientras tanto el owner lo lee desde la rama `docs/estrategia-despliegue`. Los
parámetros y la decisión, sin secretos, están en [`despliegue.json`](despliegue.json): va en `docs/despliegue/` y no en
la raíz porque un archivo en la raíz dispararía `cd-staging` al fusionarse (`docs/**` está en su `paths-ignore`). El
estado por fase vive en el runbook; el JSON solo se actualiza al cierre.

**Estado:** aprobada por el owner el 2026-11-18 («Aprobada»); las preguntas Q1-Q6 siguen abiertas. No reemplaza a ningún ADR: confirma el destino de
[ADR-051](../adr/ADR-051.md) y le agrega condiciones. Lo que enmienda a ADR-051 §2 («sin copias de seguridad de datos»)
entra al repositorio por el change de respaldo y su ADR (ver [Cambios de código](#cambios-de-código-que-el-despliegue-necesita)),
no por este documento.

## Resultado

Gana **Oracle Cloud Always Free con Docker Compose (`oracle-free`)**: es el único candidato que corre las imágenes
`arm64` y el `docker-compose.prod.yml` de hoy sin tocar `apps/**` ni `libs/**`, con procesos persistentes, SSE, los
crons del worker y el replica set de verdad, y es el destino que el CD ya prepara. Costo: **0 USD por mes, sostenido
por reglas de corte** (cuotas, alertas y estimador), no por contrato. Plan B: **`casa-tunel`** (la misma pila en un
equipo propio del owner, expuesta con un túnel), si Oracle no da capacidad A1, pide un cobro, recupera la instancia o
el owner no puede cumplir las reglas de corte de costo.

Pesos usados por el panel: costo 15, ajuste 20, seguridad 20, operación 20, reversibilidad 15, esfuerzo 10. Costo bajó
de 20 a 15 porque el 0 USD es una restricción dura que veta, no un criterio que puntúa fino; operación subió de 15 a 20
porque una sola persona sostiene una pila de siete servicios con datos. La rúbrica sugiere seguridad 25 y esfuerzo 5
con datos sensibles: con esos pesos el orden no cambia (2,98, 2,53 y 1,97).

| Criterio | Peso | Por qué pesa | `oracle-free` | `casa-tunel` | `gestionado-gratis` |
|---|---:|---|---:|---:|---:|
| Costo | 15 | 0 USD con tarjeta aceptada solo para alta o pago por uso | 2,00 | 3,00 | 1,33 |
| Ajuste al stack | 20 | Mongo con replica set, Redis para BullMQ, S3 cifrado, SSE, `arm64` | 4,00 | 3,00 | 1,67 |
| Seguridad | 20 | CV con datos personales, claves BYOK cifradas, repo público | 3,00 | 2,00 | 2,00 |
| Operación | 20 | Una sola persona, pila de siete servicios | 3,00 | 2,00 | 2,33 |
| Reversibilidad | 15 | Vuelta atrás del código y de la base, salida sin bloqueo | 2,67 | 3,00 | 2,67 |
| Esfuerzo | 10 | Pasos del owner hasta el primer despliegue verificado | 2,67 | 2,67 | 1,33 |
| **Puntaje sobre 5** | | | **2,97** | 2,57 | 1,93 |
| **Votos (Borda)** | | | **6** | 3 | 0 |
| **Primeros puestos** | | | **3 de 3** | 0 | 0 |
| **Veto** | | | marcado por el script (ver arbitraje) | no | no |

Los tres jueces ordenaron igual: `oracle-free`, `casa-tunel`, `gestionado-gratis`. Ninguno vetó a nadie.

**Consenso: 3 de 3 jueces pusieron primero al ganador.**

**Arbitraje (2026-11-16).** El script de conteo declaró ganador a `casa-tunel` con consenso 0 porque marcó vetado a
`oracle-free` por la regla 3 de la rúbrica: su propio proponente había escrito dos cosas en `incumple`. El árbitro
revisó las dos y ninguna es una incompatibilidad con una restricción dura: las dos se cierran con acciones, así que el
veto no aplica y gana el candidato con más Borda y más puntaje.

1. **«El 0 USD es práctico y no contractual en pago por uso.»** Es cierto, y pasa a **regla de corte**: cuotas de
   compartimento que impiden crear algo fuera de lo gratuito, una alerta de presupuesto de 1 en la moneda de la cuenta y una alerta de
   pronóstico, y la comprobación en el estimador de que cada recurso cuesta 0 **antes** de pasar a pago por uso. El
   owner aceptó la tarjeta justamente para el alta o el pago por uso sin cobros (2026-11-16); lo que no aceptó es un
   cobro, y eso es lo que las reglas de corte detienen.
2. **«Falta respaldo fuera del host.»** Es cierto hoy, porque ADR-051 §2 declara staging desechable y sin copias. Se
   cierra con un **change de respaldo que va antes de invitar**. No distingue a los candidatos: `casa-tunel` y
   `gestionado-gratis` también lo necesitaban.

## El proyecto, en lo que importa para desplegarlo

Perfil completo en [`perfil-despliegue.json`](perfil-despliegue.json).

- Siete servicios en contenedores detrás de Traefik: SPA Angular estática, API NestJS/Fastify con SSE y un worker
  NestJS con colas BullMQ, cuatro tareas programadas internas y relevo del outbox por intervalo.
- MongoDB 7 con replica set obligatorio (transacciones y outbox), Redis 7 para BullMQ y almacén S3 (SeaweedFS con
  cifrado nativo, ADR-052) para CV y snapshots. Cambiar de motor es reescribir repositorios.
- Datos sensibles: CV con datos personales, postulaciones y claves BYOK cifradas. Repositorio público desde el
  2026-10-09: ningún secreto versionado.
- Audiencia: 3 a 5 invitados, menos de 2.000 peticiones por día, desde Latinoamérica. Una caída de horas se tolera;
  perder datos, no.
- Imágenes `linux/arm64`, construidas y verificadas en un runner `arm64` (ADR-051 §3).
- No desplegado, pero el destino está a medio preparar (change `staging-host`, 35b): el CD termina en «verificado sin
  destino» (corrida `42344081533`, 2026-11-07) y el compose de producción ya tiene las redes por proceso y las
  contraseñas de datos de design D18 (PR #92 y #93).

## Restricciones

| Restricción | Origen | A quién afectó |
|---|---|---|
| 0 USD por mes | Owner, 2026-11-16 | `gestionado-gratis`: el sandbox de Northflank tiene tarjeta cargada y no documenta qué pasa al superar el crédito de 20 USD. `oracle-free`: el 0 es práctico, se sostiene con reglas de corte |
| Tarjeta solo para el alta o el pago por uso, sin cobros | Owner, 2026-11-16 | Habilita a `oracle-free` en pago por uso; nadie quedó vetado |
| Procesos persistentes sin suspensión (api, worker con colas y crons, SSE) | Perfil | Descarta todo lo que duerme por inactividad; en `oracle-free` deja abierta la exención de inactividad (regla de corte 6 del runbook) |
| Mongo con replica set, Redis y S3 cifrado; datos sensibles con respaldo fuera del host | Perfil y ADR-052 | Los tres necesitaban un respaldo nuevo |
| Imágenes `arm64` ya construidas; cambiar de arquitectura tiene costo | Perfil y ADR-051 §3 | `gestionado-gratis` exige `amd64`; `casa-tunel`, si el equipo es `amd64` |
| Repositorio público | Perfil | Secretos solo fuera del repo, en los tres |

## Por qué ganó

- **Corre lo que ya existe.** Las imágenes `arm64` y el compose de producción van tal cual, sin cambiar código de la
  aplicación. Fuente: `docker-compose.prod.yml`, `cd-staging.yml` (runner `ubuntu-24.04-arm`) y la corrida
  `42344081533`. Los otros dos exigían tocar el CD, el compose o el código (SSE-C, proxy, override de puertos).
- **Cabe con margen.** Always Free da 1.500 horas OCPU y 9.000 GB-hora al mes, el equivalente a 2 OCPU y 12 GB, contra
  una pila estimada en 1,5 a 3 GB en reposo (supuesto que mide la tarea 6.4). Fuente: documentación de Always Free de
  OCI, consultada el 2026-11-16.
- **Replica set, colas y SSE de verdad.** Mongo con transacciones, Redis con `noeviction` y conexiones SSE largas, sin
  límites de comandos ni suspensión. `gestionado-gratis` dependía de supuestos sin verificar en los tres (transacciones
  en Atlas M0, política de desalojo del Redis gestionado, 0,2 vCPU para el worker).
- **El destino ya está a medio preparar.** Guardias del CD, configuración del mismo commit, OpenSSH con clave del host
  fijada, redes por proceso, Redis y Mongo con contraseña y almacén con `-disableHttp` están en `main` (35b, grupos
  1-4, 7 y 12.1-12.6). Elegir otro destino tira ese trabajo o lo rehace.
- **Salida sin bloqueo.** Es Docker Compose estándar con imágenes en GHCR y la configuración en el repositorio: con un
  respaldo restaurable, irse es levantar el mismo compose en otro host. Es lo que hace viable al plan B.
- **Lo eligieron las tres lentes.** Costo, seguridad y operación lo pusieron primero, cada una con reservas que pasaron
  a condiciones (ver [Disenso](#disenso)).

## Por qué no los otros

- **`casa-tunel` (segundo, plan B).** Cuesta 0 de plataforma y no pide tarjeta, pero suma riesgos que en Oracle no
  existen: el worker llega a la red de la casa (SSRF hacia el router, otros equipos y la tailnet), el cifrado del
  disco con LUKS deja el equipo esperando la frase de paso tras cada corte de luz o reinicio, `deploy.sh` y
  `config-files.txt` no llevan el override que la propuesta daba por hecho, y depende de hardware dedicado y de la
  luz que paga el owner. Sus supuestos (SSE por Tailscale Funnel, alta sin tarjeta) siguen sin verificar.
- **`gestionado-gratis` (tercero).** Su crítico encontró un **bloqueante**: no hay forma de verificar que el sandbox de
  Northflank no cobre al superar el crédito de 20 USD con la tarjeta cargada, y el egress se descuenta de ese crédito.
  Además: el cifrado SSE-C que proponía para los CV no existe en el código de producción, el worker tendría 0,2 vCPU
  para extraer CV de hasta 5 MiB, y perder el Redis gestionado pierde eventos ya relevados (entre ellos `cv-deleted`,
  que deja CV huérfanos), con imágenes `amd64` y un CD nuevo.

## Hallazgos que condicionan el diseño

Lo que encontraron los críticos y pasa a ser una regla de corte, una prueba obligatoria o un cambio. Las columnas
«Dónde» apuntan al runbook ([RUNBOOK-DESPLIEGUE.md](RUNBOOK-DESPLIEGUE.md)) o a la lista de cambios.

| # | Hallazgo (gravedad del crítico) | Qué pasa a ser | Dónde |
|---|---|---|---|
| H1 | El respaldo propuesto no puede correr: un timer en el host no llega al almacén, cuyas redes son `internal` y solo tienen a `api` y `worker`; y un proceso con Mongo, S3 e Internet sería el más privilegiado de la pila y desharía D18 (alta) | Contenedor de respaldo dedicado con redes propias, usuario de Mongo de solo lectura e identidad S3 de solo lectura propia | Cambio C1 |
| H2 | Una clave de solo escritura no sirve para restic (`prune`, `check` y los locks leen, listan y borran), y si se le da borrado, quien compromete el host borra los respaldos. El versionado sin ciclo de vida acumula y cobra (alta) | Borrado protegido por retención o bloqueo de objetos; la poda con una credencial que no vive en el host; nada de versionado sin ciclo de vida | Cambio C1, regla de corte 8 |
| H3 | Las cuotas de compartimento frenan crear cómputo y volúmenes, no los GB ni las peticiones de Object Storage; la alerta de presupuesto (1 en la moneda de la cuenta) avisa, no corta (alta) | Tope de tamaño del repositorio de respaldo comprobado por el propio respaldo, alerta de pronóstico y revisión mensual de consumo | Cambio C1, fase 1, Mantenimiento |
| H4 | Que el pago por uso exima de la reclamación por inactividad no está en la documentación oficial (alta) | Regla de corte: el owner lo confirma con documentación o soporte; si no, acepta el riesgo por escrito o va al plan B | Regla de corte 6, Q5 |
| H5 | Un respaldo nocturno pierde hasta 24 h; `mongodump` y la copia de objetos no son atómicos entre sí (alta) | RPO de 24 h como costo aceptado (Q4); orden fijo Mongo → objetos y conciliación al restaurar | Costos aceptados, cambio C1 |
| H6 | La copia semanal fuera de Oracle era manual y sin alarma (alta) | Copia fuera de Oracle automatizada desde el mismo contenedor, con aviso de respaldo faltante | Cambio C1, Q2 |
| H7 | La restauración estaba subespecificada: `admin.system.users` choca con el usuario raíz, el usuario de respaldo solo se crearía sobre volumen vacío, los objetos exigen la misma `OBJECT_STORE_SSE_KEY` (media) | Restauración ensayada sobre el host real con el volumen existente, en un proyecto de Compose aparte, antes de invitar | Cambio C1, fase 9 |
| H8 | El SSH queda abierto a todo Internet porque el CD sale de runners con IP variable, y ahora conviven en el host la clave del respaldo y `RESTIC_PASSWORD` (media) | SSH endurecido y comprobado | Cambio C3, fase 2 |
| H9 | La IP reservada y otros recursos se comprobaban «después» de pasar a pago por uso (media) | Estimador **antes** de pasar a pago por uso | Fase 1, regla de corte 3 |
| H10 | Del crítico de `casa-tunel`, aplica también a Oracle: el worker descarga URLs de usuarios sin filtro de destinos internos (SSRF). En Oracle llega a la VCN, a la dirección de metadatos y a servicios internos | Dependencia antes de invitar: `enrichment-egress-guard` fusionado. Está implementado en la rama `change/enrichment-egress-guard`, sin fusionar; su ventana, decidida por el owner el 2026-10-29, es después de la 11.6 y antes de la 10.7 de 35b (ADR-056 §1 de esa rama) | Cambio C2, fase 8 |
| H11 | El runbook de Oracle dice que en pago por uso hay 4 OCPU y 24 GB gratis; la documentación vigente da 2 y 12 a todas las cuentas (media) | La instancia y la cuota se fijan en 2 OCPU y 12 GB pase lo que pase | Regla de corte 2, cambio C4 |
| H12 | Let's Encrypt sobre `sslip.io`: si no está en la Public Suffix List, el cupo de emisión es compartido (baja) | Ya cubierto por 6.8 (ACME *staging* primero y comprobación de la PSL) | Fase 4 |
| H13 | Sin capacidad A1 en regiones chicas durante días; la región de origen es irreversible (baja) | Disparador del plan B tras el protocolo de 35b (tres días) | Regla de corte 1 |

## Costos aceptados

- **El 0 USD es práctico, no contractual.** En pago por uso, Oracle cobra lo que exceda Always Free. Se mitiga con
  cuotas, alerta de presupuesto (1 en la moneda de la cuenta) y de pronóstico, estimador previo, un solo administrador con MFA y ninguna clave de la API de
  OCI fuera de la máquina del owner. Si aparece un cargo, es regla de corte.
- **RPO de 24 horas** con el respaldo nocturno: si se pierde el host, se pierden hasta 24 h de postulaciones, CV y
  análisis. El owner puede acortar el intervalo del dump (Q4). Si se pierde la cuenta entera de Oracle, la copia fuera
  de Oracle acota la pérdida al mismo intervalo, siempre que esa copia sea automática.
- **Un solo host sin SLA.** Una caída de la VM, del disco o de la zona deja todo abajo por horas (RTO estimado: unas
  2 h con «Replace boot volume» y restauración). El owner tolera caídas de horas.
- **Dependencia de la cuenta de Oracle.** Hay casos conocidos de cuentas gratuitas cerradas sin aviso. Se mitiga con
  la copia fuera de Oracle y con la salida al plan B.
- **Los respaldos conservan los CV borrados** hasta que rotan. El aviso a los invitados y el borrado de cuenta lo dicen
  con el plazo de retención.
- **`sslip.io` y Certificate Transparency** (ya aceptados en ADR-051): DNS de un tercero gratuito y URL pública en
  cuanto se emite el certificado.
- **La latencia** depende de la región de origen que dé capacidad: una región grande de Estados Unidos da más
  capacidad a costa de latencia, y la elección es irreversible.

## Disenso

Los tres jueces pusieron primero a `oracle-free`, pero cada uno con una preocupación que, por decisión del árbitro,
**pasa a condición obligatoria antes de invitar** (tarea 10.7 de 35b):

| Juez | Preocupación | Condición |
|---|---|---|
| Costo | Las cuotas no topean Object Storage; el versionado sin ciclo de vida puede pasar los 10 GB por nivel; la IP reservada y la exención de inactividad son supuestos | Borrado protegido sin versionado que acumule; estimador antes del pago por uso; exención confirmada o riesgo aceptado por escrito |
| Seguridad | El respaldo, tal como estaba, rompía el aislamiento de D18 o no funcionaba; quien compromete el host podría borrar los respaldos; SSH abierto | Contenedor dedicado con usuario de Mongo e identidad S3 de solo lectura propios y redes que no deshagan D18; borrado protegido; SSH endurecido; copia fuera de Oracle automática |
| Operación | La protección de los datos dependía de la disciplina de una persona: copia manual, sin alarma, restauración no ensayada | Copia fuera de Oracle automatizada; aviso de respaldo faltante (ping de monitoreo, por ejemplo healthchecks.io gratuito); restauración ensayada sobre un host con volumen viejo |

Son **nueve condiciones antes de invitar**: las ocho que salen del disenso y la (9), que viene del hallazgo H10 y
no de un juez. Las mismas nueve están en [`despliegue.json`](despliegue.json). (1) respaldo con contenedor dedicado, usuario de Mongo de solo lectura, identidad S3 de
solo lectura propia y una red que no deshaga el aislamiento por proceso de D18; (2) copia fuera de Oracle
automatizada; (3) borrado de respaldos protegido con retención o bloqueo, sin versionado sin ciclo de vida; (4) aviso
de respaldo faltante; (5) restauración ensayada; (6) SSH endurecido; (7) exención de inactividad confirmada, o riesgo
aceptado por escrito, o plan B; (8) RPO de 24 h aceptado, con la opción de acortar el intervalo como decisión del
owner; (9) `enrichment-egress-guard` fusionado y desplegado (cambio C2).

## Orden hasta invitar

35b congela `main` entre PR-1b y PR-2 (`openspec/changes/staging-host/tasks.md`, encabezado y tarea 9.1): no se fusiona
nada, y menos durante el ensayo de reconstrucción. Por eso el respaldo y el filtro de salida entran **después** de la
11.6, y el orden es este:

1. Ensayo de reconstrucción de 35b 9.1-9.4, como lo escribe 35b: con la pila vacía, sin respaldo que restaurar.
2. PR-2 de 35b fusionado en su ventana. Depende de Q4 de 35b (invitados) y de 5.10 (pago por uso), porque lleva sus
   anotaciones.
3. 35b 11.6: despliegue por merge y vuelta atrás por GitHub.
4. En la ventana posterior a la 11.6: C2 (`enrichment-egress-guard`) y C1 (respaldo), cada uno con su propio PR.
5. Respaldo desplegado y funcionando (fase 8 del runbook).
6. Ensayo de restauración nuevo sobre el host real, con el volumen que ya tiene, en un proyecto de Compose aparte y
   **sin** repetir «Replace boot volume».
7. 35b 10.7: invitar.

**Riesgos que quedan abiertos:** que Oracle cierre la cuenta (mitigado, no eliminado), que no haya capacidad A1 en la
región elegida, y que el destino gratuito de la copia fuera de Oracle exija una cuenta o una tarjeta (Q2).

## Cambios de código que el despliegue necesita

Tareas sin aplicar. Ninguna toca `apps/**` ni `libs/**`. Cada una se implementa en su change con su `/opsx:*` y su
debate; acá solo se fija qué hace falta y cómo se comprueba.

### C1. Change de respaldo (nuevo; nombre provisional `staging-backups`)

Se fusiona en la ventana posterior a la 11.6 de 35b y antes de la 10.7 (ver [Orden hasta invitar](#orden-hasta-invitar)).
Su lugar en el plan es la Q1.

- [ ] `[infra]` ADR nuevo con el siguiente número libre al abrir el change (las ramas sin fusionar ya usan hasta
  ADR-062) que enmienda ADR-051 §2 («No hay copias de seguridad de datos») por respaldo cifrado fuera del host, con
  una línea de anotación en ADR-051. Verificar con `node -e` que ADR-051 enlaza al ADR nuevo.
- [ ] `[infra]` Entrada en `openspec-changes.yaml` y anotación en el `scope` de `staging-host`, que hoy dice «Fuera:
  copias de seguridad de datos (staging es desechable)». Verificar con `openspec validate --all --strict`.
- [ ] `[infra]` Servicio `backup` en `docker-compose.prod.yml` con imagen `arm64` fijada por digest y redes propias:
  una `internal` con `mongo`, otra `internal` con `object-store` y una con salida solo para él. No comparte red con
  `api` ni con `worker`. Verificar con `docker compose config` leído con `node` y **falsar**: desde `backup`, `api` no
  resuelve; desde `worker`, `backup` no resuelve.
- [ ] `[infra]` Usuario de Mongo de solo lectura (rol `backup`), creado o actualizado **en cada arranque** de `mongo`,
  no solo sobre volumen vacío. Verificar que el respaldo vuelca con él y **falsar**: un `insert` con ese usuario falla
  por autorización.
- [ ] `[infra]` Identidad S3 de solo lectura propia en el almacén (leer y listar los buckets de CV y snapshots).
  Verificar que la copia lee los objetos descifrados por el almacén y **falsar**: un `PutObject` y un `DeleteObject`
  con esa identidad fallan.
- [ ] `[infra]` `infra/backup/backup.sh`: `mongodump --oplog --archive --gzip` primero y la lectura de objetos después,
  todo por la entrada estándar de `restic backup` (sin texto en claro en disco), hacia dos repositorios: un bucket
  privado de OCI Object Storage y un destino gratuito fuera de Oracle (Q2), los dos desde el mismo contenedor y en la
  misma corrida. Verificar con dos instantáneas listadas por `restic snapshots` en cada destino.
- [ ] `[infra]` Borrado protegido: la credencial que vive en el host no puede borrar instantáneas (retención o bloqueo
  de objetos en el destino, o un mecanismo equivalente que el design elija y verifique contra los locks de restic); la
  poda (`forget --prune`, semanal o mensual, nunca diaria) la corre una credencial que no está en el host. Sin
  versionado sin regla de ciclo de vida. **Falsar**: con la credencial del host, borrar un paquete del repositorio
  falla.
- [ ] `[infra]` Tope de tamaño: el respaldo falla y avisa si el repositorio de OCI pasa un umbral por debajo de los 10 GB
  por nivel (por ejemplo, 5 GB). **Falsar** con un umbral de prueba menor que el tamaño actual.
- [ ] `[infra]` Aviso de respaldo faltante: ping de inicio, éxito y falla a un monitor gratuito (por ejemplo
  healthchecks.io) con su URL como secreto `BACKUP_PING_URL`. **Falsar**: un respaldo que no corre en su ventana
  produce el aviso por correo.
- [ ] `[infra]` Programación (timer de systemd en el host o programador en el contenedor, a decidir en el design) que
  sobreviva a un reinicio y que una reconstrucción futura rehaga desde `infra/README.md` (el ensayo 9.1-9.4 de 35b es
  anterior a este change y no la cubre).
- [ ] `[infra]` `infra/backup/restore.sh`: parar `api` y `worker`; `mongo` solo; `mongorestore --drop --oplogReplay`
  sin restaurar `admin.*`; recarga de objetos con la misma `OBJECT_STORE_SSE_KEY`; arranque; informe de conciliación
  (CV en Mongo sin objeto y objetos sin documento). Verificar con el ensayo de la tarea siguiente.
- [ ] `[infra]` Override de Compose para restaurar (por ejemplo `infra/backup/docker-compose.restore.yml`): un proyecto
  aparte (`-p linkvault-restore`) con sus propios volúmenes, **sin** Traefik ni los puertos 80 y 443 (con `!reset` o un
  compose propio, porque `ports` se suma entre archivos) y sin salida a Internet. Verificar con `docker compose config`
  leído con `node`: ningún `ports` y ningún volumen compartido con el proyecto de staging.
- [ ] `[infra]` Ensayo de restauración sobre el host real, **con el volumen existente** y sin repetir «Replace boot
  volume»: después de la 11.6 y con el respaldo ya desplegado, restaurar la última instantánea en el proyecto aparte,
  comprobar cuentas, links y un CV descargable de las cuentas de prueba, anotar el tiempo total (RTO medido) y terminar
  con `down -v`. Verificar además que la pila de staging no se reinició (`docker compose ps` con el mismo `CreatedAt`).
- [ ] `[infra]` Prueba mensual de restauración con el mismo procedimiento: siempre en el host, en el proyecto aparte y
  con `down -v` al terminar, **nunca** en la PC del owner (con invitados el respaldo tiene CV reales). Verificar con
  `docker compose ls` y `docker volume ls` antes y después (sin restos del proyecto de prueba).
- [ ] `[infra]` Variables nuevas en `.env.example` con valores ficticios y en `infra/ci/check-env-file.mjs`
  (`RESTIC_PASSWORD`, repositorios y credenciales de los dos destinos, usuario y contraseña de Mongo de respaldo,
  identidad S3 de respaldo, `BACKUP_PING_URL`). `RESTIC_PASSWORD` entra en la copia de `.env.staging` fuera del host
  (5.8). Verificar con `node infra/ci/check-env-file.mjs <env de prueba>` sobre un fichero de prueba al que le falta
  cada variable (sale ≠0 nombrándola) y con uno completo (sale 0).
- [ ] `[infra]` Documentación: `infra/README.md` «Qué vive solo en el host» (los datos pasan a tener copia),
  RUNBOOK «Operar staging» (respaldo, restauración, poda) y el aviso a los invitados de 9.10 (cambia «entorno
  desechable y sin copias» por copias cifradas con su retención, y el borrado de cuenta dice cuándo desaparece de los
  respaldos). Coordinar con 35b: 9.10 es una tarea suya. Verificar con `node -e` que encuentre cada afirmación.

### C2. Filtro de salida del worker (existente)

- [ ] `[backend]` Fusionar `enrichment-egress-guard` (rama `change/enrichment-egress-guard`) en su ventana: después de
  la 11.6 y antes de la 10.7 de 35b. Verificar con su propio `/opsx:verify` y, ya desplegado, con la prueba de la
  fase 8 del runbook.

### C3. SSH endurecido (dentro de 35b o del change de respaldo, Q6)

- [ ] `[infra]` Sumar a `infra/README.md` («Usuario de despliegue») y al ensayo de reconstrucción: `AllowUsers` con los
  dos usuarios (administración y despliegue), sin contraseñas ni `root` (ya exigido), y un limitador de intentos
  (`fail2ban` con la jaula de `sshd`). Verificar con `sudo sshd -T` y `sudo fail2ban-client status sshd` volcados a
  fichero y leídos con `node`.

### C4. Correcciones del runbook de Oracle

- [ ] `[infra]` `docs/runbooks/oracle-cloud-a1.md` §11 y §13.2: quitar «en PAYG Oracle mantiene 4 OCPU / 24 GB
  gratuitos», sumar las cuotas de compartimento, la alerta de pronóstico, el estimador antes de pasar y la regla de
  confirmar la exención de inactividad; cambiar «alerta a 1 €» por «alerta de 1 en la moneda de la cuenta» (§11, §13.2
  y la lista de comprobación), y marcar como supuesto que el pago por uso dé prioridad de capacidad A1. Verificar con
  `node -e` que ya no aparecen «4 OCPU / 24 GB gratuitos» ni «1 €», y sí cada paso nuevo.
- [ ] `[infra]` Nota para 35b, sin editarla desde acá: la vuelta atrás sin GitHub de la 11.2 tiene el mismo hueco que
  corrige el runbook de esta propuesta. Si la imagen anterior ya no está en el host, el `up` falla sin credencial del
  registro; hace falta comprobarla con `docker image ls` y, si falta, `docker login` con el token por la entrada
  estándar y `docker logout` al final. Se le pasa a la sesión dueña de 35b.

## Qué reabriría esta decisión

- Oracle cobra cualquier importe, pide un pago para seguir, recupera la instancia o cierra la cuenta: se pasa al plan B
  sin votar de nuevo.
- Oracle cambia Always Free (forma A1, Object Storage o la política de inactividad) de modo que la pila no entre o el 0
  no se pueda sostener.
- La audiencia deja de ser un equipo de 3 a 5 personas (registro público, más invitados) o se pide un SLA.
- Se decide producción con dominio propio (`cd-prod` con host): es otra decisión, con otro presupuesto.
- El owner quiere eliminar la tarjeta de la cuenta, o cambia el presupuesto.
- Una medición real (6.4) muestra que la pila no entra en 12 GB.

## Preguntas abiertas para el owner

**Q1. ¿Dónde va el respaldo en el plan?** **[bloqueante para abrir el change de respaldo]**
(a) Change propio (`staging-backups`) con una excepción a la precedencia de la fila 35 (ADR-048), fusionado en la misma
ventana que `enrichment-egress-guard`: después de la 11.6 y antes de la 10.7. (b) Un grupo nuevo dentro de 35b, que
amplía su alcance y su PR-2. **Recomendación: (a)**, porque 35b excluye por escrito las copias y ya tiene dos PR en
curso; el patrón de excepción ya existe y el owner lo usó el 2026-10-29.

**Q2. ¿Cuál es el destino gratuito de la copia fuera de Oracle?** **[bloqueante para el change de respaldo, no para
el primer despliegue]**
Condiciones: fuera de Oracle, compatible con restic, sin cobro posible (sin tarjeta, o con tope duro), y con forma de
proteger el borrado. Opciones a verificar en el change: (a) un almacenamiento de objetos con plan gratuito que se
pueda abrir sin tarjeta y con tope en 0; (b) una cuenta de Google Drive **dedicada** al respaldo (no la personal, para
no compartir cuota con el correo), con su cliente OAuth publicado para que el token no venza a los 7 días;
(c) la PC del owner por una tarea programada que trae la copia, que solo funciona con la PC encendida.
**Recomendación: (a) si se verifica sin tarjeta y con bloqueo de objetos; si no, (b).** Si la opción que quede pide
una cuenta o tiene costo, decide el owner.

**Q3. ¿Retención de los respaldos?** **[no bloqueante; el change trae un valor por defecto]**
(a) 7 diarios y 4 semanales (los CV borrados duran hasta 4 semanas en las copias); (b) 7 diarios solamente (menos
espacio y menos tiempo de CV borrados, menos margen para descubrir un daño). **Recomendación: (a).**

**Q4. ¿Intervalo del dump?** **[no bloqueante]**
(a) Nocturno, RPO de 24 h, aceptado como costo; (b) cada 6 h (más peticiones a Object Storage, todavía lejos de las
50.000 al mes con pocos datos). **Recomendación: (a) para empezar**, y revisarlo con el tamaño real del repositorio
tras dos semanas con invitados.

**Q5. Exención de inactividad en pago por uso.** **[bloqueante para invitar (10.7)]**
(a) Confirmarla con la documentación oficial o con soporte de Oracle y guardar la respuesta fuera del repositorio
(sin datos de la cuenta); (b) aceptar por escrito el riesgo de reclamación, sabiendo que con el respaldo cuesta horas y
no datos; (c) plan B. **Recomendación: (a), y si no hay respuesta en una semana, (b).**

**Q6. ¿Dónde va el endurecimiento del SSH?** **[no bloqueante]**
(a) En 35b, junto a 5.4 y al ensayo de reconstrucción; (b) en el change de respaldo, porque es el que suma secretos al
host. **Recomendación: (a)**: protege también al primer despliegue, que llega antes que el respaldo.

La decisión de pago por uso sigue siendo la tarea 5.10 de 35b y es del owner. El panel recomienda pasar a pago por
uso con las reglas de corte; quedarse en la cuenta gratuita exige aceptar por escrito el riesgo de reclamación (Q5 b).
