## Why

Con 34 filas entregadas, **nadie salvo el autor ha usado nada**, y `cd-staging` termina en "verificado sin destino"
en cada merge: el repositorio tiene **cero secretos**, ningún entorno de despliegue real y ninguna release (medido con
la API de GitHub el 2026-09-25). ADR-048 §Consecuencias convirtió ese estado en una **precedencia verificable** —mientras
el pipeline siga sin destino, la fila 35 es la siguiente— porque "verde sin desplegar" es honesto hoy y se vuelve rebaja
por el paso del tiempo.

Este change es la pieza **35b** de esa fila (ADR-051): lleva el CD del tercer resultado al segundo —desplegado de verdad,
con su smoke— sobre un host gratuito, pone el producto en manos de las primeras personas que no son el autor y **mide**
si lo usan. Llega después de **35a** (`object-store`), que deja la pila en `arm64` y sin MinIO, y antes de **35c**
(`verify-reusable-workflow`).

## Partición de la fila 35

La fila 35 se ejecuta como la secuencia **35a → 35b → 35c** (ADR-051 §1). La precedencia de ADR-048 §Consecuencias
aplica a la **fila entera**: ningún change de otra fila entra entre medias (decisión humana del 2026-09-25). `main` queda
verde tras cada pieza, y en "verificado sin destino" hasta que esta pieza despliega.

| Pieza | Change | Alcance en una frase |
|---|---|---|
| **35a** | `object-store` | Sustituir MinIO por un almacén S3 mantenido y `arm64`, elegido con una matriz de requisitos ejecutada, y construir, verificar y publicar en un runner `arm64`. |
| **35b** | `staging-host` (**este**) | Guardias de despliegue, host de Oracle, TLS con `sslip.io`, correo con Brevo, primeros usuarios y medición de su uso. |
| **35c** | `verify-reusable-workflow` | Workflow reutilizable de verificación, comprobación post-merge de un `main` en rojo, primera release `v0.1.0` y los guardias de `repo-checks` diferidos. |

**Lo que sale de este change hacia 35a (`object-store`):**
- sustituir MinIO (candidatos SeaweedFS, RustFS y Garage, en ese orden, parando en el primero que cumpla todos los
  requisitos) y su aprovisionamiento por la API S3, sin `mc`;
- el rediseño del healthcheck del almacén (antiguo grupo 7, design D5) y el MODIFIED de «Compose de producción» que lo
  especificaba;
- el requirement «Las imágenes de la pila se pueden descargar en la arquitectura del destino» y el script que lo
  comprueba;
- las antiguas tareas 11.5-11.7 (prueba de candidatos, deltas, sustitución);
- el paso de `build-verify-publish` a `ubuntu-24.04-arm`, la clasificación `artifact` de una arquitectura ausente y la
  medición de minutos de CI en `arm64`.

**Lo que sale de este change hacia 35c (`verify-reusable-workflow`):**
- el workflow reutilizable de verificación (antiguo grupo 12, design D2), como **MODIFIED** de «El CD verifica con las
  mismas etapas que la integración continua» tras archivar `i18n-catalog-gate`; el ADDED «Una sola definición de la
  verificación…» que este change proponía **desaparece**;
- la comprobación post-merge de que un `main` en rojo no mueve `:staging` (antiguo grupo 9, design D9);
- la primera release `v0.1.0` (antiguo grupo 13), solo `arm64` mientras no haya host de producción;
- los guardias de `repo-checks` de inyección en pasos remotos y de lista de ficheros de configuración frente a los
  montajes del compose (antiguas 3.1 y 4.1);
- (iteración 2) el guardia de `publish-artifact.sh` que impide republicar un `sha-<12>` existente, con su clase
  `republish` en el reporte, y la regla `actions-pinned` de `repo-checks`, ampliada a todo `uses:` de un job con
  `packages: write`; con ellos se van los escenarios «Un tag de commit no se reescribe…» y «Una acción que recibe
  secretos fijada por etiqueta…»;
- (iteración 2) todo lo que toca `cd-prod`: el modo de corrida en su reporte (y el escenario «Modo de prueba con
  destino de producción configurado»), sus secretos como datos y el runner `arm64` de su `build-verify-publish`.

**Lo que se elimina sin moverse:** el mantenimiento del espejo de MinIO (antiguas 11.1-11.4: 35a lo sustituye), la
migración de objetos (11.8: 35a llega antes que los usuarios), el registro restringido (10.5), las copias de seguridad
de datos (staging es desechable) y la extensión del navegador para estos usuarios.

**Trazabilidad de las letras (a)-(g)** del `scope` original, a las que apuntan el change archivado
`deploy-image-verification`, ADR-048 §8 y los dos composes: (a) → 35c; **(b) → 35b** (su parte de `cd-prod`, 35c);
(c) → 35c; (d) retirada; **(e) → 35b**; (f) → 35a; (g) → 35c. La tabla completa está en ADR-051 §1.

## What Changes

**Guardias, antes de configurar ningún secreto.**
- **(b) El modo de prueba nunca despliega** y **a staging solo despliega una corrida real de `main`**. En `cd-staging`
  el job de despliegue hoy **no** queda saltado en modo de prueba (su `if:` solo mira el preflight): con secretos
  puestos, un `dry_run` sobre `main` desplegaría de verdad. El desenlace se deriva en la misma tabla de
  `infra/ci/report-cd-outcome.sh`, con el destino a medias evaluado antes que el modo. La spec escribe además el
  **límite**: el guardia evita accidentes y no autoriza; quien tiene escritura en el repositorio tiene root en staging
  (colaboradores, claves de despliegue y aplicaciones: solo el autor). `cd-prod` lo adopta en 35c.
- **OpenSSH nativo en lugar de `appleboy/*`**: ningún código de terceros recibe la clave de despliegue. La configuración
  viaja por `tar | ssh` y el usuario y el token del registro por la entrada estándar de `deploy.sh` (en la orden remota
  solo quedan valores no secretos y validados), con `docker logout` al terminar
  y sin rama de login opcional. `STAGING_COMPOSE_DIR` deja de ser secreto y pasa a **ruta fija** del repositorio
  (`/srv/linkvault-staging`): lo que el script usa como ruta o como código va en el repositorio.
- **Clave del host obligatoria** (`STAGING_SSH_HOST_KEY`, en `known_hosts` con `StrictHostKeyChecking=yes`) y
  **preflight a seis valores**: `STAGING_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `STAGING_SSH_HOST_KEY`,
  `GHCR_READ_USER` y `GHCR_READ_TOKEN`.
- **`packages: write` solo en el job que publica.**
- **Configuración del mismo commit, en este orden:** copia a `.incoming-<sha12>` → login → comprobar plataformas y
  el digest del almacén (el de ADR-052 «Elección», que el corredor lee y pasa a `deploy.sh`) → `pull` con el compose
  de `.incoming` → `install-config` → `up` → `object-store.js provision` → `object-store.js
  verify` (arranque documentado de 35a, con el compose instalado). Se conservan los últimos `.incoming-*` para volver
  atrás.
- **Repetir un despliegue = relanzar solo su job** (`gh run rerun <id> --job …`); el guardia que impide republicar un
  `sha-<12>` es de 35c.
- Traefik deja de montar `docker.sock`: solo usa el proveedor de ficheros.

**Host, nombre y certificado.**
- Oracle Cloud Always Free, Ampere A1 (`arm64`, 2 OCPU / 12 GB), región anotada, **IP pública reservada**, cortafuegos
  del proveedor **y** reglas `iptables` propias de la imagen Ubuntu de OCI, y un procedimiento ante "Out of host
  capacity".
- `<ip>.sslip.io`, comprobado con `dig` en dos resolvers y contra la Public Suffix List; primera emisión contra el entorno
  *staging* de ACME y después contra producción.

**Correo.**
- **(e) SMTP con autenticación y TLS verificado** en `api` y en `worker` (son dos adaptadores), con el rechazo del
  servidor registrado por clase y sin secretos. Brevo como proveedor, con remitente verificado y sin dominio.
- Envío real a Gmail, Outlook y un tercer proveedor, con `Authentication-Results` y carpeta de llegada anotados. Si no
  llega a la bandeja de entrada en al menos dos, el dominio vuelve al usuario como decisión con coste, y no se invita
  hasta resolverlo o hasta que el usuario acepte el riesgo por escrito.
- La interfaz dice que verificar el correo no es necesario para empezar y que revisen spam (la spec `auth/email-
  verification` ya no lo exige); procedimiento manual de recuperación de cuenta en el RUNBOOK.

**IA.** Una llamada real desde el host por OpenRouter `:free` con `data_collection: deny`, anotando qué proveedor
responde o el error "no endpoints", y el cupo diario en el RUNBOOK. **Sin búsqueda en staging**, como decisión del
design (iteración 3), no del usuario: el compose de producción no la tiene, y el aviso y quien invita lo dicen.
Activarla sería un change posterior a 35c.

**Antes de invitar.** Ensayo de reconstrucción **reemplazando el volumen de arranque** del propio host, copia de
`.env.staging`, `/metrics` y `/health` no públicos, códigos de invitación ausentes de los logs, entrevista previa que
dice qué fuentes usan los invitados, recorrido en el móvil con cinco links reales de esas fuentes y aviso ampliado para
cada persona. La vuelta atrás por GitHub se ejercita con PR-2 en `main`.

**Usuarios y medición.** 3-5 personas que buscan empleo ahora, 2-3 en un mismo grupo (Q4, bloqueada por el usuario),
con un **plan de medición escrito antes de invitar**: umbrales fijados de antemano, un script `mongosh` de solo lectura
que devuelve recuentos, una conversación de cinco preguntas el día 14 y una regla de decisión.

**No hay cambios BREAKING** para quien usa el producto. Para el operador cambia el despliegue documentado (ruta fija,
configuración por `.incoming`, clave del host y credencial del registro obligatorias).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `platform/ci-pipeline`: se **añaden** tres requirements, sin modificar ninguno existente: qué corridas pueden
  desplegar (el modo de prueba nunca, a staging solo una corrida real de `main`, con el límite del guardia escrito); los
  secretos del despliegue a staging como datos (clave del host, credencial del registro por la entrada estándar, lo
  que es ruta o código en el repositorio); y la configuración desplegada del mismo commit que las imágenes, con el
  orden por `.incoming`. No se tocan «Etapas de verificación», «El CD verifica con las mismas etapas que la integración
  continua» (los modifica `i18n-catalog-gate`, y el segundo lo modificará 35c) ni «CD a staging en main» (lo modifican
  35a y 35c, en ese orden de archivo).
- `platform/production-deploy`: se **añade** «El destino de staging se puede reconstruir desde la documentación». No se
  modifica «Compose de producción»: **35a lo modificará** (almacén por defecto y healthcheck de solo lectura), y dos
  MODIFIED del mismo requirement en changes consecutivos se pisarían.
- `platform/email`: «Adaptadores Resend, SMTP/Mailpit y captura» pasa a admitir SMTP con autenticación y TLS verificado,
  en `api` y en `worker`, y a registrar el rechazo del servidor por clase y sin secretos.

**Anotado, no modificado aquí:** `platform/local-environment` «Infraestructura con un comando» y `cv/documents`
«Retención de snapshots de enriquecimiento» son de 35a si su matriz lo exige.

## Preguntas abiertas (histórico)

Planteadas al redactar la primera versión y **respondidas el 2026-09-25**; el debate de la iteración 1 fijó el resto.
Se conservan tal como se escribieron, porque el alcance de 35a/35b/35c sale de sus respuestas; lo vigente está en
«Decisiones del usuario» y en ADR-051. Las referencias a "tareas", "grupos" y "este change" dentro de ellas son las de
la primera versión. Quedan dos decisiones del usuario pendientes, y las dos **bloquean invitar a nadie** y retienen
PR-2: pasar la cuenta de Oracle a pago por uso y quiénes son las personas invitadas (Q4). La cadena de embeddings dejó
de ser decisión del usuario en la iteración 3: sin búsqueda en staging es decisión del design (D13).

- **Q1 — Servidor: proveedor, tamaño, coste y arquitectura.** Opciones: (A) VPS `amd64` en un proveedor a elegir;
  (B) VPS `arm64` (suele ser más barato), que **no puede correr la pila hoy**: el espejo de MinIO es solo `linux/amd64`,
  así que B exige resolver antes Q5 (sustituir MinIO o replicar su imagen para `arm64`); (C) una máquina propia
  expuesta a Internet (sin coste de proveedor, con la disponibilidad y la IP a cargo del autor). El tamaño mínimo lo
  fija la pila entera (mongo, redis, almacén de objetos, api, worker, web, Traefik): se mide en la primera tarea del
  host, no se supone.
- **Q2 — Dominio y DNS.** ¿Qué nombre tiene staging y dónde se gestiona la zona? Traefik y ACME necesitan que resuelva
  antes del primer despliegue. Opciones: (A) subdominio de un dominio propio existente; (B) dominio nuevo; (C) un
  nombre de DNS dinámico o del proveedor (sin coste, y con el riesgo de que el certificado y el remitente del correo
  queden atados a un dominio que no es nuestro).
- **Q3 — Correo: proveedor y dominio del remitente.** Opciones: (A) Resend, que ya tiene adaptador y es el de ADR-034;
  exige verificar el dominio del `MAIL_FROM` con SPF y DKIM para escribir a alguien que no sea el titular de la cuenta;
  (B) una submission SMTP con usuario y contraseña (la que cierra el punto (e)); (C) un relay por IP. **(e) entra en
  cualquier caso**, porque está en el `scope`; lo que Q3 decide es cuál se configura en staging y qué dominio de
  remitente se verifica (depende de Q2).
- **Q4 — Primeros usuarios no-autor.** ¿Quiénes y cuántos? Es la razón de ser de la fila. Y una decisión que va con
  ella: ¿el registro en staging queda **abierto a Internet** (cualquiera con la URL crea cuenta, y cada alta envía un
  correo real) o **restringido** a quien se invite? Restringirlo no existe hoy en el producto: sería un requirement
  nuevo de `auth` y ensancharía el change.
- **Q5 — Almacén de objetos (punto f).** Con las letras de ADR-048 §8: (A) **mantener el espejo** de MinIO: añade un
  requirement de procedencia y procedimiento de actualización del espejo, y obliga a replicar `arm64` si Q1 elige ARM;
  (C) **sustituir MinIO** por otro servidor compatible con S3: el sustituto tiene que cumplir lo que hoy se exige al
  almacén (cifrado en reposo del bucket de CV, ADR-033 D5; expiración a 30 días de los snapshots, ADR-022; sin acceso
  anónimo; imagen descargable sin credenciales y multiarquitectura), y **toca más specs**: `platform/local-environment`
  nombra MinIO en «Infraestructura con un comando». Si se elige C **después** de que haya usuarios en staging, hace
  falta además migrar sus CV. Es una decisión de alcance y **cambia las specs**: se resuelve antes de `/opsx:apply`.
- **Q6 — ¿Un change o varios?** La fila es grande. Propuesta de partición, **no aplicada**: (1) `staging-host`,
  núcleo: modo de prueba, ssh, host, DNS/TLS, sincronizar la configuración, healthcheck de MinIO, correo, primer
  despliegue, comprobación post-merge y primeros usuarios, más la primera release (es pequeña); (2)
  `verify-reusable-workflow`, el punto (a), un refactor sin dependencia del host que, por la precedencia de ADR-048,
  iría **después** de (1); (3) `object-store`, el punto (f), solo si Q5 = C, porque sustituir el almacén toca los dos
  composes, el aprovisionamiento y otra spec. Si se mantiene uno solo, el orden de `tasks.md` ya pone lo que da destino
  primero.
- **Q7 — Visibilidad de las imágenes y token de lectura.** Hoy `linkvault-api`, `-worker` y `-web` son **privadas** en
  GHCR (el espejo de MinIO es público), así que el host **no puede** hacer `pull` sin credenciales, y `GHCR_READ_TOKEN`
  —documentado como "opcional"— es en la práctica obligatorio. Opciones: (A) mantenerlas privadas y tratar el token como
  secreto requerido del destino (un token personal con caducidad, atado a una persona); (B) hacerlas públicas
  (desaparece el token; cualquiera puede descargar las imágenes).
- **Q8 — Qué se promete a esos usuarios sobre sus datos.** Staging con personas reales guarda datos personales
  reales, CV incluidos (ADR-028). Opciones: (A) staging **desechable**, dicho por escrito a cada usuario antes del
  alta (sin copias de seguridad; se puede borrar); (B) copia de seguridad mínima de mongo y del almacén de objetos, que
  **ensancha** el change con un requirement nuevo y su restauración probada.
- **Q9 — Número y momento de la primera release.** ¿`v0.1.0` u otro? ¿Antes o después del primer despliegue real de
  staging? Publicarla mueve `:latest`, que es el valor por defecto de `IMAGE_TAG` en el compose de producción.
- **Q10 — ¿El mismo principio para mongo?** El healthcheck de mongo también **aprovisiona**: inicia el replica set
  (`rs.initiate`) para responder si está sano, igual que ADR-022 hizo con MinIO. El `scope` solo nombra MinIO.
  Opciones: (A) dejar mongo como está y decirlo; (B) extender el rediseño a mongo en este change.
- **Q11 — Qué IA usan esos usuarios.** `AI_CHAIN` es obligatoria en el compose y ninguna opción es neutra: (A)
  `mock` en `replay` no sirve a personas reales (devuelve fixtures), y `synth` está prohibido fuera de desarrollo;
  (B) OpenRouter de plataforma con modelos `:free` y `data_collection: deny` (ADR-032 §4): coste cero, límites de
  uso del proveedor y texto de usuario —redactado por `PiiRedactor`— saliendo a un tercero; (C) Ollama en el propio
  host: sin tercero, pero exige un host bastante más grande (afecta a Q1); (D) solo BYOK: cada usuario trae su clave.
  El alcance no cambia con la respuesta; el coste, el tamaño del host y lo que se dice a los usuarios (Q8), sí.

## Decisiones del usuario (2026-09-25) y lo que cambió al investigarlas

El usuario aceptó las sugerencias de las once preguntas y añadió una **condición**: **todavía no hay dominio**, y el
despliegue tiene que ser **gratuito al principio y con la infraestructura completa**. Al investigar esa condición con
datos de hoy, tres de las sugerencias quedaron invalidadas: no por su razonamiento, sino porque se apoyaban en
supuestos que la condición o los hechos tumban. Se deja escrito qué cambió y por qué, para que el debate discuta el
plan real y no el aceptado.

**Hechos comprobados (septiembre de 2026):**

- **Ningún servidor gratuito `amd64` aguanta la pila completa.** Mongo en replica set, Redis, almacén S3, api, worker,
  web y Traefik no caben en las máquinas gratuitas pequeñas (GCP `e2-micro` y AWS `t*.micro`, de ~1 GB). La única
  opción gratuita con capacidad es **Oracle Cloud Always Free Ampere A1, que es ARM**. Oracle la **redujo a la mitad**
  el 15-06-2026: **2 OCPU y 12 GB de RAM** en cuentas gratuitas, frente a 4 y 24 en cuentas de pago por uso, que siguen
  sin coste dentro del límite. Reclama las instancias **inactivas** (percentil 95 de CPU, red y memoria por debajo del
  20 % durante 7 días), y en regiones populares a veces no hay capacidad ARM. Pasar la cuenta a pago por uso evita la
  reclamación y sigue costando cero dentro de los límites, pero pide una tarjeta.
- **Sin dominio hay nombre y certificado igualmente.** `sslip.io` y `nip.io` resuelven un nombre que lleva la IP dentro
  (`<ip>.sslip.io`), y Let's Encrypt emite certificados válidos para esos nombres con el reto HTTP-01, que Traefik ya
  sabe hacer. La contrapartida es depender de un servicio gratuito de terceros para el DNS.
- **Resend no sirve sin dominio.** Mientras no se verifica un dominio propio, solo envía desde `onboarding@resend.dev`
  **y solo al correo de quien abrió la cuenta**: no puede mandar la verificación a un usuario real. **Brevo** tiene un
  plan gratuito permanente de **300 correos al día** por SMTP (`smtp-relay.brevo.com:587`, STARTTLS) **con usuario y
  contraseña**, y solo pide verificar la dirección del remitente, no un dominio. Eso convierte el punto (e) (SMTP con
  autenticación) en **imprescindible**, no en opcional. Sin dominio propio no hay DKIM alineado, así que es de esperar
  que algún correo acabe en spam.
- **MinIO community está muerto.** Dejó de publicar imágenes y binarios en octubre de 2025, **archivó su repositorio en
  febrero de 2026** (sin desarrollo ni parches de seguridad) y **retiró sus imágenes de Docker Hub el 11-09-2026**. Lo
  que tenemos en GHCR es la copia de una versión que ya **no recibirá ningún parche**, y guarda los CV. Además es
  **solo `amd64`**, y la fuente ya no deja obtener la variante `arm64`.
- **GitHub ofrece runners `arm64` gratuitos en repositorios privados** desde el 29-01-2026 (2 vCPU; consumen los minutos
  del plan). El repositorio es privado y hoy todo se construye solo para `amd64`.

**Decisiones resultantes:**

| Q | Sugerencia aceptada | Decisión tras investigar | Por qué cambió |
|---|---|---|---|
| **Q1** | VPS `amd64` | **Oracle Cloud Always Free, Ampere A1 (ARM64), 2 OCPU / 12 GB** | Es la única máquina gratuita donde cabe la pila completa. Pasar a pago por uso (cero euros dentro del límite, pero con tarjeta) queda como **sub-decisión del usuario**. |
| **Q2** | depende del dominio | **`<ip>.sslip.io` + Let's Encrypt HTTP-01 vía Traefik**; dominio propio más adelante | No hay dominio. El nombre depende de la IP, así que una IP nueva obliga a cambiar de nombre y de certificado. |
| **Q3** | Resend | **Brevo, gratis, SMTP con autenticación**; remitente verificado sin dominio | Resend no envía a terceros sin dominio verificado. El punto (e) pasa a ser obligatorio. |
| **Q4** | «solo tú lo sabes» | Registro **abierto pero no anunciado**, 3-5 personas invitadas por el autor; **sin** requirement nuevo de `auth` | Supuesto por defecto; **el usuario debe confirmar quiénes**. El límite de 300 correos al día acota el abuso de altas. |
| **Q5** | mantener el espejo | **Sustituir MinIO** por un servidor S3 compatible **multiarquitectura** y mantenido | Un almacén de CV sin parches no se puede sostener, y el espejo no corre en ARM. Candidatos: **SeaweedFS**, **RustFS** y **Garage**. El debate elige, con una **prueba ejecutada** de los requisitos: SSE en reposo, expiración a 30 días, sin acceso anónimo, imágenes `amd64`+`arm64` descargables sin credenciales. |
| **Q6** | partir en tres | **Partir**, con otro orden: el almacén de objetos deja de ser opcional y pasa a ser **precondición** del primer despliegue | Un host ARM no puede levantar la pila con el MinIO actual. El debate fija las piezas y su orden. |
| **Q7** | privadas | **Privadas**, con `GHCR_READ_TOKEN` como secreto requerido | Sin cambio. |
| **Q8** | desechable | **Staging desechable, avisado por escrito** | Sin cambio. Pesa más con una máquina gratuita que Oracle puede reclamar. |
| **Q9** | `v0.1.0` tras el primer despliegue estable | **Sin cambio**, pero la release debe publicar también `arm64` | Una release solo `amd64` no se podría desplegar en el host elegido. |
| **Q10** | dejar mongo | **Sin cambio** | — |
| **Q11** | OpenRouter `:free` | **Sin cambio** | ARM no afecta: la IA es remota. |

**Lo que el debate de la iteración 1 cambió sobre esa tabla** (detalle en ADR-051 y `design.md`):

- **Q4:** "abierto pero no anunciado" es **falso**: el certificado de `<ip>.sslip.io` se publica en los registros de
  Certificate Transparency. Se acepta el riesgo con un recuento periódico de cuentas no invitadas y un procedimiento de
  borrado. Las personas pasan a ser **3-5 que buscan empleo ahora, 2-3 en un mismo grupo**, y Q4 **bloquea** las
  invitaciones hasta que el usuario la decida.
- **Q6:** la partición queda fijada como 35a → 35b → 35c, con la precedencia sobre la fila entera.
- **Q9:** la primera release va a 35c y publica **solo `arm64`** mientras no haya host de producción; la matriz
  multiarquitectura queda diferida.
- **Q8:** sin copias de seguridad de datos; sí copia de `.env.staging`, porque contiene `AI_VAULT_KEY`.
- **Pago por uso:** decisión del usuario que **bloquea invitar a nadie**; si se toma, alerta de presupuesto a 1 €.

**Lo que cambió la iteración 2** (detalle en `design.md` y ADR-051 §Enmiendas):

- **OpenSSH nativo** en lugar de `appleboy/*`, con la clave pública del host (no su huella) en `known_hosts`.
- **Tercera decisión del usuario:** la cadena de embeddings en staging (propuesta: sin cadena, y sin búsqueda). Las tres
  decisiones se toman en paralelo a 35a. El umbral del correo (bandeja de entrada en 2 de 3 proveedores) también
  bloquea invitar, salvo riesgo aceptado por escrito.
- **Dos PR con ventana de fusión autorizada por el usuario:** PR-1 (guardias y código de correo) y PR-2 (cierre).
- **A 35c:** el guardia contra republicar un `sha-<12>`, la regla de acciones fijadas y todo `cd-prod`.
- Mongo de producción no tiene autenticación: la garantía de solo lectura de los scripts de medición es una
  comprobación estática, y el límite queda escrito.

**Lo que cambió la iteración 3** (la última: cerró con 0 P0 y 0 V0; detalle en `design.md`):

- **Sin búsqueda en staging** pasa a ser decisión del design, no del usuario. Quedan dos decisiones del usuario (Q4 y
  pago por uso), y las dos retienen también PR-2, que lleva sus anotaciones. La ventana de fusión de PR-2 se pide junto
  con Q4.
- **Usuario y token del registro por la entrada estándar**: en la orden remota solo quedan valores no secretos y
  validados (tag, plazo de arranque, `sha12`), y el host se valida por lista blanca.
- **Todo lo que `deploy.sh` usa viaja en la lista o llega como argumento**; `up` usa el compose instalado, e
  `install-config.sh` escribe sin cambiar el inodo, porque Traefik monta `dynamic.yml` como fichero suelto.
- **El primer despliegue relanza el preflight** de la corrida del push de PR-1, sin republicar; relanzar tiene el
  límite de 30 días de GitHub.
- Los scripts de medición se ejecutan por un envoltorio en la máquina del operador, que aplica la comprobación de solo
  lectura antes de abrir la sesión.

**Consecuencias para el debate** (redactadas antes de la iteración 1; se conservan como estaban):

1. **Imágenes `arm64` verificadas, no solo construidas.** El artefacto que se despliega es `arm64`, así que la
   verificación de ADR-048 tiene que ejecutarse **sobre la imagen `arm64`** (en un runner `arm64`), y la identidad por
   digest tiene que cubrir **cada plataforma**. Verificar `amd64` y desplegar `arm64` sería exactamente el defecto que
   ADR-048 cerró. *(Resuelto en ADR-051 §3: 35a construye, verifica y publica una sola plataforma en un runner nativo,
   así que la identidad por digest no cambia de forma.)*
2. **El almacén de objetos es un change con specs propias**, porque toca `platform/local-environment`,
   `platform/production-deploy` y el cifrado de los CV. Y es **precondición** del núcleo, no un añadido. *(Es 35a.)*
3. **Riesgos de la opción gratuita que hay que escribir, no esconder:** Oracle puede reclamar la máquina o no tener
   capacidad; `sslip.io` es un tercero; los correos sin dominio propio pueden acabar en spam. Q8 (staging desechable)
   es lo que hace aceptables estos riesgos. *(Escritos en ADR-051 §Riesgos aceptados.)*
4. **Pendiente del usuario:** quiénes son los primeros usuarios (Q4) y si convierte la cuenta de Oracle a pago por uso
   (con tarjeta, pero sin coste dentro de los límites). *(Siguen pendientes y bloquean las invitaciones.)*

## Impact

- **Workflows:** `.github/workflows/cd-staging.yml` (condición de despliegue, modo de corrida, OpenSSH con clave del
  host fijada, copia por `tar | ssh`, ruta fija, `packages: write` solo en el job que publica). `cd-prod.yml` y `ci.yml`
  no cambian en este change.
- **Scripts de CI y despliegue:** `infra/ci/report-cd-outcome.sh` (un modo de corrida más en la misma tabla, con el
  destino a medias antes que el modo), `infra/ci/preflight-deploy-target.sh` (valores por destino), y nuevos en
  `infra/deploy/` (lista de configuración, `install-config.sh`, `deploy.sh`) y en `infra/staging/` (scripts de
  medición y su comprobación estática de solo lectura).
- **`tools/repo-checks`:** sin comprobaciones nuevas en este change (las diferidas son de 35c).
- **Compose:** `docker-compose.prod.yml` (variables SMTP nuevas en `api` y `worker`, Traefik sin `docker.sock`,
  servidor de ACME configurable para la primera emisión).
- **Código:** `libs/shared` (fragmento de esquema SMTP y función pura de transporte),
  `apps/api/src/infrastructure/mail/smtp-mailer.ts`, `apps/api/src/infrastructure/config/api-config.schema.ts`,
  `apps/worker/src/modules/notifications/infrastructure/mail/notify-mailer.ts`,
  `apps/worker/src/infrastructure/config/worker-config.schema.ts`, con sus tests; y, si hace falta, textos i18n de
  registro y verificación en `apps/web`.
- **Documentación:** `infra/README.md` (destino real, alternativas de host evaluadas, quién puede desplegar, qué vive
  solo en el host, vuelta atrás), `docs/RUNBOOK.md` (operar staging, recuperación manual de cuenta, cupo de IA, aviso
  a usuarios, plan de medición, cuentas no invitadas), `.env.example`, `docs/design-v0.2.md` fila 35 y ADR-051.
- **Infraestructura externa:** cuenta de Oracle Cloud, cuenta de Brevo, cuenta de OpenRouter, secretos de repositorio.
  Coste recurrente cero dentro de los límites gratuitos.
- **Dependencias de orden:** 35a (`object-store`) archivado antes de `/opsx:apply` de este change. `i18n-catalog-gate`
  no bloquea este change: ya no se toca ninguno de sus requirements.
- **ADRs:** ADR-051 (nuevo, con sus enmiendas), ADR-048 (§3 los desenlaces, §Consecuencias la precedencia, §8 el
  espejo), ADR-033 (D1, D2, D9, D10 con su enmienda, y D5, anotada como enmendada por ADR-051), ADR-034 (§1, anotada
  como enmendada por ADR-051) y ADR-035 (correo de `api` y de `worker`), ADR-036 (cadena de embeddings), ADR-032 §4
  (`data_collection`), ADR-020 (límites del registro) y ADR-012 (sesión y cookie).
