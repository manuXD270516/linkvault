# Runbook — Cuenta de Oracle Cloud y servidor de staging (Ampere A1)

Guía paso a paso para crear la cuenta de Oracle Cloud Always Free y dejar lista la máquina ARM donde vivirá staging
(ADR-051, change `staging-host`, 35b). Cubre lo que **haces tú** en la consola de Oracle y en tu terminal; lo que
automatiza 35b (despliegue, secretos del CD, TLS) queda fuera y se enlaza al final.

- **Tiempo estimado:** 1-2 h si hay capacidad ARM; la creación de la instancia puede requerir reintentos otro día.
- **Coste:** 0 € con la cuenta gratuita. Oracle pide una tarjeta para verificar identidad (retención temporal, sin
  cargo). Si pasas a pago por uso (paso 11), sigue costando 0 € mientras no salgas de lo Always Free.
- **Qué entregas a 35b al terminar** (sin secretos en el chat): región de origen, IP pública reservada, usuario de
  despliegue, clave pública `ed25519` del host y las cifras reales de OCPU/memoria.

> **Sobre los videos.** Son de terceros y la consola de Oracle cambia a menudo: úsalos como apoyo visual. Si un video
> contradice este runbook, manda el runbook (está alineado con las decisiones de ADR-051 y las tareas 5.x de 35b).
> Varios dicen «4 OCPU / 24 GB»: en cuentas gratuitas Oracle lo redujo a **2 OCPU / 12 GB** en 2026 (ADR-051 §Contexto).

---

## 0. Antes de empezar

- Un correo al que tengas acceso y que **no** hayas usado antes en Oracle Cloud.
- Una tarjeta de crédito o débito a tu nombre (no prepago; muchas virtuales se rechazan).
- Un teléfono para el SMS de verificación y una app de autenticación (Oracle Mobile Authenticator, Google
  Authenticator, 1Password…).
- En tu PC, OpenSSH (viene en Windows 10/11: `ssh -V` en PowerShell).

## 1. Crear la cuenta

1. Entra en <https://signup.cloud.oracle.com/> y elige **país**, nombre y correo. Verifica el correo.
2. **Contraseña fuerte** (gestor de contraseñas) y **nombre del tenancy** (cuenta cloud): corto, en minúsculas, p. ej.
   `linkvault`. No se puede cambiar.
3. **Región de origen (home region): elige con cuidado, no se puede cambiar y los recursos Always Free solo existen en
   ella.** Para usuarios en Latinoamérica, candidatas: `sa-saopaulo-1` (São Paulo), `sa-santiago-1` (Santiago),
   `sa-bogota-1` (Bogotá), `mx-queretaro-1` (Querétaro); o `us-ashburn-1` si prima la capacidad. Las regiones grandes
   suelen tener más máquinas ARM libres; las pequeñas, menos competencia. Anótala: 35b la registra en `infra/README.md`.
4. Dirección y teléfono (SMS). Tipo de cuenta **Individual** si no hay empresa.
5. **Tarjeta:** Oracle hace una retención de verificación (≈ 1 USD o equivalente) que se devuelve. Si la rechaza, prueba
   otra tarjeta; no insistas muchas veces seguidas con la misma (bloquea el alta).
6. Acepta los términos y espera el correo **«Your Oracle Cloud Account is fully provisioned»** (minutos, a veces horas).

🎬 Videos:
- [Oracle Cloud Free Tier: Step-by-Step Registration Guide (2026)](https://www.youtube.com/watch?v=bij3ZSaobVk)
- [[2026] Create Oracle Cloud Free Tier account (cuenta personal)](https://www.youtube.com/watch?v=f1Ip6h63sGs)
- [Getting Started with Oracle Cloud Free Tier (oficial de Oracle)](https://www.youtube.com/watch?v=So0OCWLRvzk)
- En español: [Consigue un Servidor Gratis para siempre: Tutorial Paso a Paso (Oracle Free Tier)](https://www.youtube.com/watch?v=l0tSPtSCp7M)

## 2. Asegurar la cuenta (antes de crear nada)

1. Inicia sesión en <https://cloud.oracle.com/> con el tenancy y tu usuario.
2. **Activa MFA:** menú de usuario (arriba a la derecha) → *My profile* → *Security* / *Multi-factor authentication* →
   registra tu app de autenticación. Guarda los códigos de recuperación en tu gestor de contraseñas.
3. Comprueba en *Governance & Administration → Tenancy details* que la **home region** es la que elegiste.
4. (Recomendado) Crea un **compartimento** `linkvault-staging`: *Identity & Security → Compartments → Create*. Todo lo
   de este runbook va dentro de él; así se borra o se audita junto.

## 3. Generar tus claves SSH (en tu PC)

En PowerShell:

```powershell
ssh-keygen -t ed25519 -C "linkvault-staging-admin" -f $HOME\.ssh\linkvault_oci_admin
```

- Pon una **frase de paso**. La clave **privada** (`linkvault_oci_admin`) no sale de tu PC; la **pública**
  (`linkvault_oci_admin.pub`) es la que subirás a Oracle.
- La clave del **despliegue** (la que usará GitHub Actions) es otra distinta y la crea 35b (tareas 3.x/5.4): no
  reutilices esta.

## 4. Red: VCN con acceso a internet

1. *Networking → Virtual cloud networks → Start VCN Wizard → Create VCN with Internet Connectivity*.
2. Nombre `linkvault-vcn`, compartimento `linkvault-staging`, rangos por defecto. El asistente crea la subred pública,
   el Internet Gateway y la lista de seguridad por defecto (con 22 abierto).
3. No abras 80/443 todavía: se hace en el paso 7, junto con el cortafuegos de Ubuntu.

🎬 [Configure the VCN Internet Gateway in Oracle Cloud Infrastructure](https://www.youtube.com/watch?v=JdbDXr9FfD8)

## 5. Crear la instancia Ampere A1

1. *Compute → Instances → Create instance*, compartimento `linkvault-staging`, nombre `linkvault-staging`.
2. **Placement:** deja el dominio de disponibilidad (AD) por defecto; si falla por capacidad, prueba los demás (paso 6).
3. **Image and shape:**
   - *Change image* → **Canonical Ubuntu 24.04** (la variante `aarch64` aparece al elegir la forma ARM).
   - *Change shape* → *Ampere* → **VM.Standard.A1.Flex** → **2 OCPU y 12 GB** (lo máximo gratuito en cuentas
     gratuitas; si la consola te deja 4/24 en la tuya, 35b lo aprovecha, pero dimensiona con 2/12).
   - Comprueba que aparece la etiqueta **Always Free-eligible**.
4. **Networking:** la VCN y la subred pública del paso 4; *Assign a public IPv4 address* activado (lo cambiarás por
   una reservada en el paso 8).
5. **Add SSH keys:** *Upload public key files* → `linkvault_oci_admin.pub`.
6. **Boot volume:** 50-100 GB (hasta 200 GB en total son gratis). Deja el cifrado por defecto.
7. *Create* y espera a **Running**. Anota la IP pública provisional.

🎬 Videos:
- [How to Create an Ampere A1 Compute Instance (oficial de Oracle)](https://www.youtube.com/watch?v=48hNbDzFuZA)
- [How to Create an Instance in Oracle Cloud (Free Tier), Step-by-Step 2025](https://www.youtube.com/watch?v=W6yXvYnd1tw)
- [Oracle Gives You a 12GB Server Free Forever. Full Setup](https://www.youtube.com/watch?v=1_RkcTO5jOA) (cuenta ya las
  cifras nuevas de 2/12)
- [How to Build a Free Ubuntu Server on Oracle Cloud](https://www.youtube.com/watch?v=_9FWri0a9Bo)

## 6. Si sale «Out of host capacity»

Es lo más frecuente con A1 y **no es un error tuyo**: no quedan máquinas ARM libres en ese AD en ese momento.

1. Reintenta en **cada AD** de tu región, dos rondas, durante un máximo de **45 minutos** por sesión. Anota cada intento
   (hora y AD): 35b los registra (tarea 5.2).
2. Si no sale, prueba **otro día y a otra hora** (madrugada o fin de semana suelen ir mejor).
3. **No cambies de región** (no se puede para Always Free) ni uses scripts de reintento automático que martilleen la API.
4. Tras **tres días** sin capacidad, la decisión pasa a ti: seguir esperando o pasar a pago por uso (paso 11), que da
   prioridad de capacidad. Otra salida es reabrir la alternativa de Fly.io ([ADR-054](../adr/ADR-054.md)).

🎬 Videos:
- [Fix Oracle Cloud "Out of Host Capacity" Error for Free Tier (2026)](https://www.youtube.com/watch?v=jXFdB45rn6k)
- [How to Troubleshoot Out-of-Capacity Issues of Compute Instances in OCI (oficial)](https://www.youtube.com/watch?v=DL5ff34R9Xg)
- [Oracle Free Tier Issues Solved: Out of Capacity & Idle Stops](https://www.youtube.com/watch?v=Xto9zROBwqY)

## 7. Abrir 80 y 443 (dos capas: Oracle **y** Ubuntu)

Las imágenes de Ubuntu de Oracle traen **iptables propio** que bloquea todo salvo 22, además de la lista de seguridad
de la VCN. Hay que abrir en las dos o no llega nada.

**Capa 1 — lista de seguridad de la VCN:** *Networking → VCN `linkvault-vcn` → Security Lists → Default Security List
→ Add Ingress Rules*: origen `0.0.0.0/0`, TCP, puertos de destino `80` y `443` (una regla por puerto). **No abras**
27017, 6379, 8080 ni otros.

**Capa 2 — iptables en la instancia** (por SSH, paso 9):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save        # lo guarda en /etc/iptables/rules.v4
sudo iptables -S INPUT                # comprueba que las reglas de 80 y 443 van ANTES del REJECT final
```

No uses `ufw` en estas imágenes: choca con las reglas de Oracle. Comprueba tras un reinicio (`sudo reboot`) que las
reglas siguen (35b lo verifica en la tarea 5.5).

🎬 Videos:
- [How to open Ports for an Ubuntu VM on Oracle Cloud (2025)](https://www.youtube.com/watch?v=xkaAFxS0dYs)
- [Fixing Access Issues: Open Ports on Oracle Cloud's Ubuntu Instance](https://www.youtube.com/watch?v=loOzM3M_jF4)
- En español: [Abrir Puertos en Ubuntu - Oracle Cloud](https://www.youtube.com/watch?v=Jxs9M8qZkRM)

## 8. IP pública reservada

Una IP efímera cambia si recreas la instancia; staging necesita una fija (el nombre `sslip.io` sale de ella).

1. *Networking → IP Management → Reserved public IPs → Reserve public IP address*, nombre `linkvault-staging-ip`, en el
   compartimento. (Si pasas a pago por uso, confirma en el estimador de costes de Oracle que sigue sin coste.)
2. En la instancia: *Attached VNICs → VNIC principal → IPv4 Addresses → IP privada → Edit*: primero **No public IP**
   (quita la efímera) y guarda; después vuelve a editar → **Reserved public IP** → `linkvault-staging-ip`.
3. Anota la IP reservada: es la que va a `PUBLIC_HOST=<ip-con-guiones>.sslip.io` y al secreto de host de 35b.

🎬 Videos:
- [How to Assign a Reserved Public IP in Oracle Cloud (2025, explica el paso de quitar la efímera)](https://www.youtube.com/watch?v=Jc3ZJCE5C5I)
- [How to Assign a Reserve Public IP to a New Instance in OCI](https://www.youtube.com/watch?v=-IVG9hTwN_Q)

## 9. Primer acceso y puesta a punto de Ubuntu

```powershell
ssh -i $HOME\.ssh\linkvault_oci_admin ubuntu@<IP-reservada>
```

En el servidor:

```bash
uname -m            # aarch64
nproc; free -g      # 2 y ~11 (anota las cifras reales para 35b)
sudo apt update && sudo apt -y full-upgrade
sudo apt -y install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
sudo timedatectl set-timezone UTC
sudo reboot
```

**Clave del host (sin fiarte de la red):** en la consola de Oracle, instancia → *More actions → Console history →
Capture* y copia la línea `ssh-ed25519 …` entre `-----BEGIN SSH HOST KEY KEYS-----` y `-----END SSH HOST KEY KEYS-----`.
Es la que 35b pondrá como `STAGING_SSH_HOST_KEY` (tarea 5.6). Compárala con la huella que te mostró `ssh` al conectar.

## 10. Docker y usuario de despliegue

**Docker Engine + Compose** desde el repositorio oficial (no el paquete `docker.io` de Ubuntu):

```bash
sudo apt -y install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update && sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version && docker compose version && sudo docker run --rm hello-world
```

Referencia oficial: <https://docs.docker.com/engine/install/ubuntu/>.

**Usuario de despliegue** (solo clave, en el grupo `docker`), con la clave pública **de despliegue** que genere 35b:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# pega la clave pública de despliegue en /home/deploy/.ssh/authorized_keys (propietario deploy, permisos 600)
sudo install -d -o deploy -g deploy /srv/linkvault-staging
```

**Sin contraseñas por SSH:** en `/etc/ssh/sshd_config.d/99-linkvault.conf`:

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
```

`sudo systemctl restart ssh` y comprueba con `sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin'`.

🎬 Videos:
- [Oracle Cloud VPS: Ubuntu Docker Installation](https://www.youtube.com/watch?v=Kw0RHDkps84)
- [Setup Forever Free Oracle ARM-based Ampere Cloud (incluye Docker)](https://www.youtube.com/watch?v=BUxyD-IXP1s)

## 11. Decisión: ¿pasar a pago por uso? (tuya, tarea 5.10 de 35b)

| | Cuenta gratuita | Pago por uso (PAYG) |
|---|---|---|
| Coste dentro de Always Free | 0 € | 0 € |
| Reclamación por inactividad | **Sí:** si en 7 días el percentil 95 de CPU, red y memoria queda bajo el 20 %, Oracle puede reclamar la instancia | No aplica |
| Capacidad ARM | Baja prioridad | Más fácil conseguir A1; en PAYG Oracle mantiene 4 OCPU / 24 GB gratuitos |
| Riesgo | Perder staging (es desechable y se reconstruye) | Cobro si creas algo fuera de Always Free |

Si pasas a PAYG: *Billing & Cost Management → Upgrade and Manage Payment → Upgrade to Pay As You Go*, y **en el mismo
momento** crea un **presupuesto con alerta a 1 €** (*Billing & Cost Management → Budgets → Create Budget*, importe 1,
alerta al 100 % por correo). 35b lo verifica en la tarea 5.10. La memoria real en régimen se mide tras el primer
despliegue (tarea 6.4) para decidir con el dato.

Documentación oficial de la política de reclamación:
<https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>

## 12. Qué pasar a 35b (y qué no)

Pásame **solo** esto por el chat:

- Región de origen, AD donde salió la instancia y las cifras de `nproc`/`free -g`.
- IP pública reservada.
- Nombre del usuario de despliegue (`deploy`) y ruta `/srv/linkvault-staging`.
- La clave **pública** `ssh-ed25519 …` del host (paso 9).
- Tu decisión del paso 11.

**Nunca** pegues en el chat: la clave privada SSH, contraseñas, códigos MFA, tokens de GitHub, `AI_VAULT_KEY`,
`OBJECT_STORE_SSE_KEY` ni el contenido de `.env.staging`. Los secretos del CD (`gh secret set`) los pones tú, con los
nombres que te dé 35b (tarea 6.1).

A partir de aquí 35b hace, verificando cada paso: `.env.staging` y su copia fuera del host (5.7-5.8), credencial de
lectura del registro (5.9), secretos y primer despliegue (6.x), TLS con sslip.io y Let's Encrypt (6.8-6.9), correo por
Brevo (7.x) y la precondición de invitar (9.x).

## 13. Lo que falta de tu parte para el primer despliegue

El código de 35b que va antes de los secretos ya está en `main` (PR-1, #86: guardias del despliegue, SSH nativo con la
configuración del mismo commit y correo SMTP autenticado). Lo que queda para desplegar y para invitar depende de
**cuatro cosas tuyas**. Ninguna pasa un secreto por el chat.

| Pendiente | Apartado | Qué desbloquea en 35b | Qué me pasas cuando lo tengas |
|---|---|---|---|
| Servidor de Oracle | 13.1 | grupo 5 (5.2-5.9) y, con él, los secretos (6.1) y el primer despliegue (6.x) | los datos del paso 12 |
| Pago por uso | 13.2 | 5.10 y el PR-2 | «sí» o «no» (y, si es sí, que el presupuesto está creado) |
| Cuenta de Brevo | 13.3 | 7.9-7.12 (correo real) | que está hecho, **sin** la clave |
| Personas invitadas | 13.4 | 9.7, 9.8, 10.1 y la invitación (10.7) | que tienes la lista y las entrevistas, **sin** nombres |

**Orden recomendado:** 13.1 y 13.2 juntos (la decisión de pago por uso puede hacer falta si no hay capacidad ARM),
después 13.3 (el correo tiene que funcionar antes de invitar) y 13.4 en paralelo desde ya, porque las entrevistas no
dependen del servidor.

### 13.1 Servidor de Oracle

Es este runbook entero: pasos 1 a 10, en orden, y la lista de comprobación del final. Al terminar, pásame **solo** lo
del paso 12 (región, AD, `nproc`/`free -g`, IP reservada, usuario `deploy`, ruta `/srv/linkvault-staging` y la clave
**pública** `ssh-ed25519 …` del host).

- **Si no hay capacidad ARM** («Out of host capacity», paso 6): reintenta en cada AD hasta 45 minutos por sesión y
  anota cada intento (hora y AD); tras tres días sin capacidad, decide 13.2 o la alternativa de Fly.io (ADR-054).
- **La clave del usuario `deploy`:** déjale preparada la carpeta `.ssh` (paso 10) y espera a que 35b te dé la clave
  pública de despliegue para pegarla en `authorized_keys`. No reutilices tu clave de administración.
- **Lo que hago yo con tus datos:** `.env.staging` y su copia fuera del host (5.7-5.8), la credencial de lectura del
  registro (5.9) y la lista de los seis secretos del CD que pones **tú** con `gh secret set` (6.1). Después, el primer
  despliegue relanzando el `preflight` de la corrida del PR-1 (6.3; hay plazo: **30 días** desde esa corrida, que es del
  2026-10-28).

### 13.2 Pago por uso (tarea 5.10)

La comparación está en el paso 11. Resumen para decidir:

- **No pasar:** sigue costando 0 €, pero Oracle puede **reclamar** la instancia si en 7 días queda por debajo del
  20 % de uso (CPU, red y memoria). Staging es desechable y se reconstruye, así que el riesgo es perder tiempo, no
  datos de nadie: el aviso a las personas invitadas ya dice que el entorno puede perderse.
- **Pasar:** también 0 € mientras no salgas de Always Free, sin reclamación por inactividad y con más facilidad para
  conseguir capacidad ARM. El riesgo es un cobro si alguien crea algo fuera de lo gratuito; por eso, **en el mismo
  momento**, el presupuesto con alerta a 1 € del paso 11.

Dime la decisión en el chat. 35b la anota en `infra/README.md` y, si es «no», el aviso a los invitados lleva la
reclamación a 7 días (9.10). La memoria real en régimen se mide tras el primer despliegue (6.4), por si quieres
revisarla con el dato.

### 13.3 Cuenta de Brevo (correo de staging)

Staging envía la verificación de cuenta y la recuperación de contraseña por **Brevo**, por SMTP con usuario y
contraseña, con un remitente verificado y **sin dominio propio** (ADR-051; plan gratuito de 300 correos al día). Los
nombres de los menús de Brevo cambian a menudo: si no coinciden, busca el equivalente.

1. **Crea la cuenta** en <https://www.brevo.com/> con el plan gratuito y activa la verificación en dos pasos.
2. **Verifica el remitente:** *Senders, domains & dedicated IPs → Senders → Add a sender*, con un nombre visible
   (`LinkVault`) y una dirección **que controles**; Brevo manda un código o un enlace a esa dirección. Esa dirección es
   la de `MAIL_FROM`. Sin dominio propio no hay DKIM alineado y los correos **pueden ir a spam**: es un riesgo aceptado
   (ADR-051) que 35b mide antes de invitar (7.10).
3. **Genera la clave SMTP:** *SMTP & API → SMTP → Generate a new SMTP key*, con un nombre como `linkvault-staging`. La
   pantalla muestra el **servidor** (`smtp-relay.brevo.com`), el **puerto** (587) y el **login** SMTP (no es tu
   contraseña de Brevo). La clave solo se ve una vez: guárdala en tu gestor de contraseñas.
4. **Ponla en el host, no en el chat.** Por SSH, en `/srv/linkvault-staging/.env.staging` (permisos `600`), sustituye
   los `MAIL_*` provisionales que dejó la tarea 5.7:

   ```bash
   MAIL_PROVIDER=smtp
   MAIL_FROM=LinkVault <la-direccion-verificada>
   MAIL_SMTP_HOST=smtp-relay.brevo.com
   MAIL_SMTP_PORT=587
   MAIL_SMTP_SECURE=false        # STARTTLS exigido en el 587: con credenciales, la app cifra antes de autenticarse
   MAIL_SMTP_USER=<el login SMTP de Brevo>
   MAIL_SMTP_PASSWORD=<la clave SMTP>
   ```

   Las dos credenciales van **juntas**: con una sola, `api` y `worker` no arrancan y dicen cuál falta.
5. **Actualiza la copia de `.env.staging`** que guardaste fuera del host (5.8): sin ella, la reconstrucción perdería la
   clave.
6. **Avísame** de que está hecho. Desde el host compruebo el TLS de Brevo (7.9) y, con la pila arriba, envío la
   verificación a una cuenta de Gmail, una de Outlook y una de otro proveedor (7.10): si llega a la bandeja de entrada
   en al menos dos de los tres, seguimos; si no, la decisión vuelve a ti (dominio propio con su coste, o el riesgo
   aceptado por escrito).

**Si un correo no sale**, el log de `api` o `worker` lo dice sin mostrar credenciales: `class=credentials_rejected`
es la clave mal copiada; `class=quota_exceeded`, el cupo diario de Brevo agotado (vuelve al día siguiente). Detalle en
el RUNBOOK, [«Operar staging»](../RUNBOOK.md#paso-6-sexdecies--operar-staging-staging-host--adr-051).

### 13.4 Personas invitadas (Q4, tareas 9.7 y 10.1)

**Ya decidido** (2026-10-08): **5 personas** que buscan empleo ahora, configurable; las **5 entran en tu grupo** con el
código de unión. Esto último es la interpretación de tu «respetemos 5»: si querías otra cosa, dilo y se corrige
(design D15 sugería 2 o 3 en el grupo). Está escrito en el RUNBOOK,
[«Personas invitadas»](../RUNBOOK.md#personas-invitadas).

**Lo que falta, todo fuera del repositorio:**

1. **La lista nominal** de quiénes. Vive en el host (`/srv/linkvault-staging/invited-ids.txt`, con los ids de usuario
   cuando existan) y en tus notas; **nunca** en el repositorio ni en el chat.
2. **Una entrevista de 10 minutos con cada persona, antes de invitarla** (9.7): cómo guarda hoy las ofertas, **qué
   fuentes de ofertas usa y cómo le llegan** (enlace directo, WhatsApp, correo, aplicación). Pásame las respuestas
   **anonimizadas** (persona 1, persona 2…): 35b las escribe en el RUNBOOK con una tabla de fuentes. Con ellas se
   prepara el recorrido en el móvil con los cinco links reales de las fuentes más usadas (9.8).
3. **No invites todavía.** La invitación es la tarea 10.7 y tiene condiciones: correo medido (13.3), pago por uso
   decidido (13.2), la precondición de `e2e-suite` en verde contra staging y la línea base de la medición. Cuando
   invites, cada persona recibe **antes del alta** el texto del RUNBOOK,
   [«Aviso para las personas invitadas»](../RUNBOOK.md#aviso-para-las-personas-invitadas), por el mismo canal por el
   que la invitas.

## Lista de comprobación

- [ ] Cuenta aprovisionada, MFA activo, home region anotada
- [ ] Compartimento, VCN y subred pública creados
- [ ] Instancia A1 `Running` con Ubuntu 24.04 `aarch64`, 2 OCPU / 12 GB (o lo que dé la cuenta)
- [ ] 80 y 443 abiertos en la lista de seguridad **y** en iptables (persistente tras reinicio); nada más abierto salvo 22
- [ ] IP pública reservada asignada
- [ ] Ubuntu actualizado, `unattended-upgrades` activo, zona horaria UTC
- [ ] Clave del host copiada desde el historial de consola
- [ ] Docker y Compose instalados desde el repositorio oficial; `hello-world` funciona
- [ ] Usuario `deploy` con solo clave y en el grupo `docker`; SSH sin contraseñas ni root
- [ ] Decisión de pago por uso tomada (y, si es sí, presupuesto con alerta a 1 €)
- [ ] Datos del paso 12 pasados a 35b (sin secretos)
- [ ] Brevo: cuenta con verificación en dos pasos, remitente verificado y clave SMTP generada
- [ ] `.env.staging` con los `MAIL_*` de Brevo y su copia fuera del host actualizada; aviso a 35b de que está hecho
- [ ] Lista nominal de las 5 personas (fuera del repositorio) y entrevista de 10 minutos con cada una
- [ ] Respuestas de las entrevistas pasadas a 35b, anonimizadas
