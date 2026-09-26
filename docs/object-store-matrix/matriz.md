# Matriz del almacén de objetos (35a)

Evidencia ejecutada de la elección del almacén de objetos (change `object-store`, design D1; ADR-052). Cada celda sale
de una orden ejecutada cuya salida se pega aquí. La pre-lectura ([`prelectura.md`](prelectura.md)) ordena el cribado y
**no aprueba ninguna celda**. Ruta estable: no se mueve al archivar el change.

## Regla de parada

**Precondición cumplida:** regla de parada y retención por barrido **confirmadas por el usuario el 2026-09-26**
(«Sí, adoptemos el barrido»; design D1 y Open Questions de `object-store`). Motivo del usuario: «el cifrado de los CV
es lo último que conviene rebajar por ganar días de calendario». Las dos decisiones:

1. **«Cumple todo» = celdas duras (C1-C4, C7, C8) y C5 `nativo`.** Puntero (dónde se gastan C7-C9), entre los que
   pasan C1-C4: primero los de C5 `nativo`; después, el orden de la lista (SeaweedFS → RustFS → Garage). El primero del
   puntero que cumple todo se elige y se deja de buscar. Sin nadie que cumpla todo, el primer apto con salida (duras +
   C5 = `salida`); sin aptos, el change se para y vuelve al usuario. Ninguna celda dura se relaja.
2. **Retención por barrido, siempre.** La expiración de snapshots va siempre por el barrido diario del `worker`, así
   que C6 no se mide: en esta matriz queda como «no medido: retención por barrido, decisión del usuario 2026-09-26».

## Línea base

Máquina de la matriz (Windows 11 + Docker Desktop), leída el 2026-09-26T21:26Z.

`docker version`:

```text
Client:
 Version:           29.8.0
 API version:       1.56
 Go version:        go1.26.8
 Git commit:        88096ef
 Built:             Thu Sep  3 21:53:38 2026
 OS/Arch:           windows/amd64
 Context:           desktop-linux

Server: Docker Desktop 4.91.0 (239619)
 Engine:
  Version:          29.8.0
  API version:      1.56 (minimum version 1.40)
  Go version:       go1.26.8
  Git commit:       3ce5872
  Built:            Thu Sep  3 21:51:20 2026
  OS/Arch:          linux/amd64
  Experimental:     false
 containerd:
  Version:          v2.3.4
  GitCommit:        db8809540e1a7a9da5d518876894933ff55692ab
 runc:
  Version:          1.4.3
  GitCommit:        v1.4.3-0-gbb14dabe
 docker-init:
  Version:          0.19.0
  GitCommit:        de40ad0
```

`docker compose version`:

```text
Docker Compose version v5.5.1
```

`node --version`:

```text
v22.23.1
```

`node -e "console.log(require('@aws-sdk/client-s3/package.json').version)"` (desde la raíz del repositorio):

```text
3.1134.0
```

## Versiones fijadas (tarea 1.2)

Última versión **estable** de cada candidato, leída de `releases/latest` de su forja (excluye prereleases y borradores)
el 2026-09-26T21:29Z. Son las que usan la 1.4 y el resto de la matriz.

```text
$ gh api repos/seaweedfs/seaweedfs/releases/latest
  tag_name=4.47 prerelease=false draft=false published_at=2026-09-14T01:31:59Z
$ gh api repos/rustfs/rustfs/releases/latest
  tag_name=1.0.0 prerelease=false draft=false published_at=2026-09-16T10:03:34Z
$ curl -s https://git.deuxfleurs.fr/api/v1/repos/Deuxfleurs/garage/releases/latest
  tag_name=v2.4.1 prerelease=false draft=false published_at=2026-09-08T08:44:05Z
```

| Candidato | Versión fijada | Imagen | Digest del índice (leído el 2026-09-26) |
|---|---|---|---|
| SeaweedFS | 4.47 | `chrislusf/seaweedfs:4.47` | `sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882` |
| RustFS | 1.0.0 | `rustfs/rustfs:1.0.0` | `sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff` |
| Garage | v2.4.1 | `dxflrs/garage:v2.4.1` | `sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020` |

El digest lo comprueba la 1.4 (C1) con `docker buildx imagetools inspect`; los pulls del corredor `arm64` descargaron
esos mismos índices (líneas `Digest:` del log).

## Corredor `arm64` (tarea 1.2)

Workflow temporal `.github/workflows/arm64-probe.yml` (commit `d485340`, `on: push` limitado a
`branches: [change/object-store]` y `paths:` a su propio fichero; borrado en el commit siguiente). Corrida
[36273151927](https://github.com/manuXD270516/linkvault/actions/runs/36273151927): creada 21:30:14Z, job asignado y
empezado 21:30:19Z (**5 s en cola**), terminado 21:30:54Z, `success`. Imagen del corredor: `ubuntu-24.04-arm`
versión 20260920.129.1, Ubuntu 24.04.5, runner 2.337.0.

Cada candidato arranca con su imagen `arm64` en la versión fijada. Ninguna de las tres imágenes declara `HEALTHCHECK`,
así que la espera es por HTTP en el puerto S3: cualquier respuesta HTTP cuenta; `403` es el rechazo del anónimo.
SeaweedFS arranca con `server -s3`. RustFS arranca con credenciales por variables. Garage lleva un `garage.toml`
mínimo sin secretos, montado de solo lectura, y `GARAGE_RPC_SECRET` por variable.

Verificación: `gh run view 36273151927 --log` y `gh api repos/{owner}/{repo}/actions/runs/36273151927/timing`, ambos
volcados a fichero y leídos con `node`:

```text
uname -m: aarch64
docker server: Server: Docker Engine - Community / Version:          28.0.4 / OS/Arch:          linux/arm64
binfmt_misc: [llvm-16-runtime.binfmt, llvm-17-runtime.binfmt, llvm-18-runtime.binfmt, python3.12, register, status] qemu-*: 0
mongod: db version v7.0.43 "distarch": "aarch64", "target_arch": "aarch64"
PROBE seaweedfs: http_code=200 after 0s
PROBE seaweedfs: image_arch=arm64 healthcheck=null
PROBE rustfs: http_code=403 after 0s
PROBE rustfs: image_arch=arm64 healthcheck=null
PROBE garage: http_code=403 after 0s
PROBE garage: image_arch=arm64 healthcheck=null
PROBE seaweedfs version: version 30GB 4.47 c50733600 linux arm64
PROBE rustfs version: rustfs 1.0.0
PROBE garage version: garage v2.4.1 [features: bundled-libs, consul-discovery, fjall, journald, k2v, kubernetes-discovery, lmdb, metrics, sqlite, syslog, telemetry-otlp]
PROBE seaweedfs server header: Server: SeaweedFS 30GB 4.47
timing: billable={"UBUNTU":{"total_ms":0,"jobs":1,"job_runs":[{"job_id":108490792554,"duration_ms":0}]}} run_duration_ms=40000
RESULT: ok
```

- **Corredor:** existe para este repositorio privado y entra en el plan: asignado en 5 s, sin error de plan.
- **`binfmt_misc`:** sin entradas `qemu-*`. Las entradas `llvm-*-runtime.binfmt` y `python3.12` son de la imagen del
  corredor. Un binario `amd64` no arrancaría por emulación sin avisar.
- **`mongo:7.0.43`:** arranca nativo (`target_arch: aarch64`).
- **Candidatos:** los tres responden en su versión fijada, con imagen `arm64` y el binario informando `arm64`/la
  versión.
- **Minutos: no concluyente.** `timing` devuelve `billable.UBUNTU.total_ms = 0` (reloj: 40 s de corrida, 35 s de job).
  Pero también devuelve `total_ms = 0` para una corrida de `ci` en `ubuntu-24.04` del mismo repositorio privado. Según las condiciones
  documentadas de GitHub, esa corrida se descuenta de los minutos del plan:

  ```text
  $ gh api repos/manuXD270516/linkvault/actions/runs/36272884056/timing
  {"billable":{"UBUNTU":{"total_ms":0,"jobs":1,"job_runs":[{"job_id":108490055614,"duration_ms":0}]}},"run_duration_ms":61000}
  ```

  El campo `billable` no discrimina, así que de él no sale ni «no consume» ni un ritmo. Los informes de facturación
  (`users/{user}/settings/billing/usage` y `.../billing/actions`) responden `404` y piden el ámbito `user` del token,
  que hoy tiene `gist, read:org, repo, workflow, write:packages`. **Pendiente de decisión del usuario:** cómo se mide
  (conceder el ámbito `user` o leer la página de facturación). Afecta a D11 y a la 9.4, no al resto del grupo 1.

- **Workflow temporal retirado** en el commit que cierra el grupo 1 (índice de git tras `git rm`):

  ```text
  $ git ls-files .github/workflows
  .github/workflows/cd-prod.yml
  .github/workflows/cd-staging.yml
  .github/workflows/ci.yml
  ```

## Forma del espejo de MinIO e imagen de la falsación «índice sin `arm64`» (tarea 1.3)

Órdenes, el 2026-09-26: `docker buildx imagetools inspect --raw <ref>` volcado a fichero y leído con `node` (tipo de
medio; si es índice, `platform` de cada entrada; si es manifiesto único, número de capas). La plataforma de un
manifiesto único se lee de su configuración con `--format`.

```text
ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z
  mediaType: application/vnd.docker.distribution.manifest.v2+json
  forma: manifiesto único
  config.mediaType: application/vnd.docker.container.image.v1+json
  capas: 9
docker.io/library/mysql:5.7
  mediaType: application/vnd.oci.image.index.v1+json
  forma: índice
  plataformas: linux/amd64, unknown/unknown
  incluye linux/arm64: false

$ docker buildx imagetools inspect ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z --format "{{.Manifest.Digest}} {{.Image.OS}}/{{.Image.Architecture}}"
sha256:a1a8bd4ac40ad7881a245bab97323e18f971e4d4cba2c2007ec1bedd21cbaba2 linux/amd64
$ docker buildx imagetools inspect mysql:5.7 --format "{{.Manifest.Digest}}"
sha256:4bc6bc963e6d8443453676cae56536f4b8156d78bae03c0145cbe47c2aad73bb
```

- **Espejo de MinIO** (`ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z`): un **manifiesto único**
  (`application/vnd.docker.distribution.manifest.v2+json`), no un índice, y solo `linux/amd64` según su
  configuración. Es el caso «manifiesto único de otra arquitectura» para el script de plataformas (D9).
- **Falsación «índice sin `arm64`»:** `docker.io/library/mysql:5.7` (índice
  `sha256:4bc6bc963e6d8443453676cae56536f4b8156d78bae03c0145cbe47c2aad73bb`). Es un **índice** OCI con `linux/amd64` y
  un manifiesto de atestación (`unknown/unknown`), sin `linux/arm64`. Es una imagen oficial pública de una versión sin
  soporte, así que no se espera que su índice gane `arm64`.

## Día 1: C1 y C2 de los tres (tarea 1.4)

Versiones: las fijadas en la 1.2. Ejecutado el 2026-09-26 entre 21:33Z y 21:37Z.

### C1: imágenes (dura)

**Cómo se consiguió el «sin credenciales».** En esta máquina Docker Desktop tiene la sesión de Docker Hub en su
almacén de credenciales (`credsStore: desktop`). Un `docker logout` cerraría esa sesión del usuario, y el permiso de la
sesión lo denegó. Por eso C1 se ejecutó con un `DOCKER_CONFIG` aislado cuyo `config.json` es `{}`: sin `auths` ni
`credsStore`. `DOCKER_HOST` apuntaba al motor de Docker Desktop, `npipe:////./pipe/dockerDesktopLinuxEngine`.
Sin credenciales que enviar, el cliente no manda autenticación con el `pull`, que es lo que la celda pide comprobar.
Antes de los pulls se borraron con `docker rmi` las copias locales de las tres etiquetas, que había descargado la
prueba de arranque local de la 1.2, así que los pulls descargan del registro. El corredor `arm64` de la 1.2 también
descargó las tres sin `docker login` (log de la corrida 36273151927).

```text
$ cat $DOCKER_CONFIG/config.json
{}
$ docker buildx version
github.com/docker/buildx v0.37.0 ac30b249211430b85fb8f37b6e7154b5c47ba0b6
===== chrislusf/seaweedfs:4.47
$ docker buildx imagetools inspect chrislusf/seaweedfs:4.47
Name:      docker.io/chrislusf/seaweedfs:4.47
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882
           
Manifests: 
  Name:      docker.io/chrislusf/seaweedfs:4.47@sha256:510f79fd8cac766560cec4b8c7ec463d2fc49eb320b4e64e1dbfcac8076a52d3
  MediaType: application/vnd.oci.image.manifest.v1+json
  Platform:  linux/arm/v7
             
  Name:      docker.io/chrislusf/seaweedfs:4.47@sha256:d4cf67729aa8777e1a43a5b61d72e5b96179e4b7bac9a221cb14cbc2036cb32e
  MediaType: application/vnd.oci.image.manifest.v1+json
  Platform:  linux/arm64
             
  Name:      docker.io/chrislusf/seaweedfs:4.47@sha256:f23d878047b185f9119ae7b4a3f0d5c8b94a4712f488392d4decd81d40382bc8
  MediaType: application/vnd.oci.image.manifest.v1+json
  Platform:  linux/386
             
  Name:      docker.io/chrislusf/seaweedfs:4.47@sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362
  MediaType: application/vnd.oci.image.manifest.v1+json
  Platform:  linux/amd64
exit=0
$ docker pull --platform linux/amd64 chrislusf/seaweedfs:4.47
docker.io/chrislusf/seaweedfs:4.47
exit=0
$ docker image inspect --platform linux/amd64 --format '{{.Os}}/{{.Architecture}}' chrislusf/seaweedfs:4.47
linux/amd64
$ docker pull --platform linux/arm64 chrislusf/seaweedfs:4.47
docker.io/chrislusf/seaweedfs:4.47
exit=0
$ docker image inspect --platform linux/arm64 --format '{{.Os}}/{{.Architecture}}' chrislusf/seaweedfs:4.47
linux/arm64
===== rustfs/rustfs:1.0.0
$ docker buildx imagetools inspect rustfs/rustfs:1.0.0
Name:      docker.io/rustfs/rustfs:1.0.0
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff
           
Manifests: 
  Name:        docker.io/rustfs/rustfs:1.0.0@sha256:ba0a1b53e36f321c0d46f3867104abef169f7bc59c467c664ddac87e7ddc9a8b
  MediaType:   application/vnd.oci.image.manifest.v1+json
  Platform:    linux/amd64
               
  Name:        docker.io/rustfs/rustfs:1.0.0@sha256:42edb61d588775f9431ff436216d14392d2234d4eb2ed68321569fbf7245b36b
  MediaType:   application/vnd.oci.image.manifest.v1+json
  Platform:    linux/arm64
               
  Name:        docker.io/rustfs/rustfs:1.0.0@sha256:9d2888ccf2bd27699f46f880d078fa7f1734c795cef490b215a15123f04da625
  MediaType:   application/vnd.oci.image.manifest.v1+json
  Platform:    unknown/unknown
  Annotations: 
    vnd.docker.reference.digest: sha256:ba0a1b53e36f321c0d46f3867104abef169f7bc59c467c664ddac87e7ddc9a8b
    vnd.docker.reference.type:   attestation-manifest
               
  Name:        docker.io/rustfs/rustfs:1.0.0@sha256:583d27cbd4cb474b674d14a1ebff8d526395b7ba4d97a6ff88fa7fd2160383f8
  MediaType:   application/vnd.oci.image.manifest.v1+json
  Platform:    unknown/unknown
  Annotations: 
    vnd.docker.reference.digest: sha256:42edb61d588775f9431ff436216d14392d2234d4eb2ed68321569fbf7245b36b
    vnd.docker.reference.type:   attestation-manifest
exit=0
$ docker pull --platform linux/amd64 rustfs/rustfs:1.0.0
docker.io/rustfs/rustfs:1.0.0
exit=0
$ docker image inspect --platform linux/amd64 --format '{{.Os}}/{{.Architecture}}' rustfs/rustfs:1.0.0
linux/amd64
$ docker pull --platform linux/arm64 rustfs/rustfs:1.0.0
docker.io/rustfs/rustfs:1.0.0
exit=0
$ docker image inspect --platform linux/arm64 --format '{{.Os}}/{{.Architecture}}' rustfs/rustfs:1.0.0
linux/arm64
===== dxflrs/garage:v2.4.1
$ docker buildx imagetools inspect dxflrs/garage:v2.4.1
Name:      docker.io/dxflrs/garage:v2.4.1
MediaType: application/vnd.docker.distribution.manifest.list.v2+json
Digest:    sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020
           
Manifests: 
  Name:      docker.io/dxflrs/garage:v2.4.1@sha256:2749e37137dae41459f49955e8082951f4a1ebea4e25d153182039f20a4b5974
  MediaType: application/vnd.docker.distribution.manifest.v2+json
  Platform:  linux/arm64
             
  Name:      docker.io/dxflrs/garage:v2.4.1@sha256:0d7c74fc8ca6fef68a5a941c0e7558c8b1e92ba3588fa7505400e1350456c796
  MediaType: application/vnd.docker.distribution.manifest.v2+json
  Platform:  linux/amd64
             
  Name:      docker.io/dxflrs/garage:v2.4.1@sha256:ef7f73b46b036a50a654a904f83391c87f8c68ad4b26c703ca800ce9a84dd0a4
  MediaType: application/vnd.docker.distribution.manifest.v2+json
  Platform:  linux/386
             
  Name:      docker.io/dxflrs/garage:v2.4.1@sha256:2a36d7dc17228bf6664f991efb15d41a8fe47254e6f50caf535f1c3221390b49
  MediaType: application/vnd.docker.distribution.manifest.v2+json
  Platform:  linux/arm
exit=0
$ docker pull --platform linux/amd64 dxflrs/garage:v2.4.1
docker.io/dxflrs/garage:v2.4.1
exit=0
$ docker image inspect --platform linux/amd64 --format '{{.Os}}/{{.Architecture}}' dxflrs/garage:v2.4.1
linux/amd64
$ docker pull --platform linux/arm64 dxflrs/garage:v2.4.1
docker.io/dxflrs/garage:v2.4.1
exit=0
$ docker image inspect --platform linux/arm64 --format '{{.Os}}/{{.Architecture}}' dxflrs/garage:v2.4.1
linux/arm64
```

### C2: mantenido (dura)

Por la API de la forja oficial (design D1). La licencia de Garage se lee del fichero `LICENSE` de su rama por defecto
(`main-v2`), porque la API de Forgejo no expone ese campo:
`curl -s 'https://git.deuxfleurs.fr/api/v1/repos/deuxfleurs/garage/raw/LICENSE?ref=main-v2'` → `GNU AFFERO GENERAL
PUBLIC LICENSE`, `Version 3, 19 November 2007` (AGPL-3.0). Criterio: `archived: false` y una versión publicada
después de 2025-09-26, es decir, en los últimos 12 meses.

```text
== SeaweedFS
$ gh api repos/seaweedfs/seaweedfs
  full_name=seaweedfs/seaweedfs archived=false default_branch=master license=Apache-2.0
$ gh api repos/seaweedfs/seaweedfs/releases/latest
  tag_name=4.47 prerelease=false published_at=2026-09-14T01:31:59Z
  C2: pasa (archived=false: true; publicada tras 2025-09-26: true)
== RustFS
$ gh api repos/rustfs/rustfs
  full_name=rustfs/rustfs archived=false default_branch=main license=Apache-2.0
$ gh api repos/rustfs/rustfs/releases/latest
  tag_name=1.0.0 prerelease=false published_at=2026-09-16T10:03:34Z
  C2: pasa (archived=false: true; publicada tras 2025-09-26: true)
== Garage
$ curl -s https://git.deuxfleurs.fr/api/v1/repos/deuxfleurs/garage
  full_name=Deuxfleurs/garage archived=false default_branch=main-v2 license=(la API no expone licencia)
$ curl -s 'https://git.deuxfleurs.fr/api/v1/repos/deuxfleurs/garage/releases?limit=1'
  tag_name=v2.4.1 prerelease=false published_at=2026-09-08T08:44:05Z
  C2: pasa (archived=false: true; publicada tras 2025-09-26: true)
```

### Resultado del día 1

| Candidato | Versión | C1 | Digest del índice | C2 | Licencia |
|---|---|---|---|---|---|
| SeaweedFS | 4.47 | **pasa**: índice OCI con `linux/amd64` y `linux/arm64`; pulls anónimos de las dos terminan con exit 0 | `sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882` | **pasa**: `archived=false`, 4.47 del 2026-09-14 | Apache-2.0 |
| RustFS | 1.0.0 | **pasa**: índice OCI con `linux/amd64` y `linux/arm64`, más atestaciones; pulls anónimos de las dos terminan con exit 0 | `sha256:8cc9801755448b71a786705ce76692c77e14936cccd87cf2fc31842e58f4d1ff` | **pasa**: `archived=false`, 1.0.0 del 2026-09-16 | Apache-2.0 |
| Garage | v2.4.1 | **pasa**: lista de manifiestos Docker con `linux/amd64` y `linux/arm64`; pulls anónimos de las dos terminan con exit 0 | `sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020` | **pasa**: `archived=false`, v2.4.1 del 2026-09-08 | AGPL-3.0 |

Parada de la 1.4, «ningún candidato pasa C1 y C2»: **no se cumple**. Los tres pasan C1 y C2, y el cribado C3-C5 empieza
por SeaweedFS (grupo 3).

## Traslados a 35b y 35c (tarea 2.12)

Comprueba que siguen en `openspec/changes/staging-host/` (design, tasks, proposal y su spec `platform/ci-pipeline`) y
en el `scope` de `verify-reusable-workflow` de `openspec-changes.yaml` los traslados que el debate de 35a editó allí
(design de `object-store`, «Traslados»). Cada comprobación mira **su** sitio: la sección `### Dn.` del design o la línea
de la tarea, con el texto normalizado (espacios colapsados, sin `**`), y, donde importa el orden, que las piezas
aparezcan en ese orden. Ejecutado el 2026-09-26, en el árbol de trabajo y, una vez, contra las versiones del commit
`2409bbb` leídas con `git show 2409bbb:<ruta>`.

Script (en el scratchpad de la sesión, `traslados-check.js`, ejecutado con `node -e "$(cat traslados-check.js)"`):

```js
// 2.12: los traslados a 35b (staging-host) y 35c (verify-reusable-workflow) siguen hechos.
// Uso: node -e "$(cat traslados-check.js)"            (árbol de trabajo)
//      REV=2409bbb node -e "$(cat traslados-check.js)" (versiones de ese commit, con git show)
const fs = require('fs');
const { execFileSync } = require('child_process');
const rev = process.env.REV || '';
const read = (p) => (rev ? execFileSync('git', ['show', `${rev}:${p}`], { encoding: 'utf8' }) : fs.readFileSync(p, 'utf8'));
const norm = (s) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ');
const SH = 'openspec/changes/staging-host/';
const design = read(SH + 'design.md');
const tasks = read(SH + 'tasks.md');
const proposal = read(SH + 'proposal.md');
const spec = read(SH + 'specs/platform/ci-pipeline/spec.md');
const yaml = read('openspec-changes.yaml');
const section = (n) => {
  const m = design.match(new RegExp(`^### D${n}\\.[\\s\\S]*?(?=^###? )`, 'm'));
  return m ? norm(m[0]) : '';
};
const task = (id) => {
  const m = tasks.match(new RegExp(`^- \\[[ x]\\] ${id.replace('.', '\\.')} .*$`, 'm'));
  return m ? norm(m[0]) : '';
};
const block = (src, startRe, endRe) => {
  const s = src.search(startRe);
  if (s < 0) return '';
  const rest = src.slice(s + 1);
  const e = rest.search(endRe);
  return norm(e < 0 ? src.slice(s) : src.slice(s, s + 1 + e));
};
// a antes que b antes que c (cada uno buscado a partir del anterior)
const inOrder = (txt, ...res) => {
  let at = 0;
  for (const re of res) {
    const i = txt.slice(at).search(re);
    if (i < 0) return false;
    at += i + 1;
  }
  return true;
};
const has = (txt, ...res) => res.every((re) => (typeof re === 'string' ? txt.includes(re) : re.test(txt)));

const D3 = section(3), D4 = section(4), D5 = section(5);
const t11 = task('1.1'), t22 = task('2.2'), t41 = task('4.1'), t44 = task('4.4'), t45 = task('4.5'), t53 = task('5.3'), t910 = task('9.10');
const prop = block(proposal, /^- \*\*Configuración del mismo commit/m, /^- \*\*/m);
const vrw = block(yaml, /^ {2}- name: verify-reusable-workflow$/m, /^ {2}- name: /m);
const UP = /up -d --wait/, PROV = /object-store\.js provision/, VER = /verify/;

const checks = [
  ['D4: `up` → `object-store.js provision` → `verify`', inOrder(D4, UP, PROV, VER)],
  ['4.4: `up` → `object-store.js provision` → `object-store.js verify`', inOrder(t44, UP, PROV, /object-store\.js verify/)],
  ['4.4: `docker` falso que contesta a `imagetools inspect`', has(t44, /docker` falso[^;]*imagetools inspect/)],
  ['4.4: caso de plataforma ausente', has(t44, 'plataforma ausente', /sin `pull`, sin instalación y con `logout`/)],
  ['D5: aprovisionar es un `run` aparte', has(D5, /aprovisionar es un `run [^`]*object-store\.js provision` aparte/)],
  ['D5: 35a no mide `service_completed_successfully`', has(D5, /35a no vuelve a medir `service_completed_successfully`/)],
  ['5.3: `docker buildx version`', has(t53, '`docker buildx version`')],
  ['1.1: `check-image-platforms.sh`', has(t11, 'check-image-platforms.sh')],
  ['1.1: `object-store.js`', has(t11, 'dist/apps/api/object-store.js')],
  ['4.1: `infra/deploy/check-image-platforms.sh`', has(t41, 'infra/deploy/check-image-platforms.sh')],
  ['9.10: «se guarda cifrado» y «Mi CV»', has(t910, 'se guarda cifrado', 'Mi CV')],
  ['D3: digest como tercer argumento de `deploy.sh`', has(D3, '<tag> <plazo> <digest>', '^sha256:[0-9a-f]{64}$')],
  ['D4: corredor lee `Digest del índice:` de ADR-052 «Elección»', has(D4, '`Digest del índice: sha256:<64 hexadecimales>`', 'ADR-052 «Elección»', 'El corredor la lee')],
  ['D4: `deploy.sh` lo recibe como tercer argumento y lo compara antes del `pull`', has(D4, /tercer argumento[^.]*antes del `pull`/, 'config --images object-store', 'imagetools inspect', 'Si difieren, sale ≠0')],
  ['4.4: tercer argumento, comparado con el digest resuelto de `object-store`', has(t44, '^sha256:[0-9a-f]{64}$', /config --images object-store[^;]*imagetools inspect[^;]*comparado con el tercer argumento/)],
  ['4.4: `docker` falso con digest distinto', has(t44, /con digest distinto[^;]*sin `pull`, sin instalación y con `logout`/)],
  ['4.5: el corredor lee la línea del digest y la pasa a `deploy.sh`', has(t45, '`^Digest del índice: (sha256:[0-9a-f]{64})$`', 'docs/adr/ADR-052.md', 'deploy.sh <tag> <plazo> <digest>')],
  ['1.1: línea `Digest del índice:` de ADR-052', has(t11, '«Elección» de `docs/adr/ADR-052.md`', '`^Digest del índice: (sha256:[0-9a-f]{64})$`')],
  ['proposal: digest del almacén en el orden del despliegue', inOrder(prop, /comprobar plataformas/, /digest del almacén/, /`pull`/, /`up`/, PROV, /verify/)],
  ['2.2: clase `artifact` con el texto de 35a', has(t22, 'clase `artifact`', 'que dejó 35a', 'leído de `infra/ci/report-cd-outcome.sh`')],
  ['spec ci-pipeline: almacén aprovisionado y comprobado tras arrancar', has(norm(spec), /y arrancar con la configuración instalada, dejando el almacén de objetos aprovisionado y comprobado/)],
  ['scope verify-reusable-workflow: `deploy-prod` con `object-store.js provision`', has(vrw, /`deploy-prod` hereda de `object-store`/, PROV)],
  ['scope verify-reusable-workflow: `check-image-platforms.sh`', has(vrw, 'infra/deploy/check-image-platforms.sh')],
  ['scope verify-reusable-workflow: `WAIT_TIMEOUT`', has(vrw, 'WAIT_TIMEOUT')],
];
const bad = checks.filter(([, ok]) => !ok);
console.log(`traslados (${rev ? 'git show ' + rev : 'árbol de trabajo'}): ${checks.length - bad.length}/${checks.length}`);
for (const [n, ok] of checks) console.log(`${ok ? 'ok   ' : 'FALTA'} ${n}`);
process.exit(bad.length ? 1 : 0);
```

En el árbol de trabajo, verde:

```text
$ node -e "$(cat traslados-check.js)"
traslados (árbol de trabajo): 24/24
ok    D4: `up` → `object-store.js provision` → `verify`
ok    4.4: `up` → `object-store.js provision` → `object-store.js verify`
ok    4.4: `docker` falso que contesta a `imagetools inspect`
ok    4.4: caso de plataforma ausente
ok    D5: aprovisionar es un `run` aparte
ok    D5: 35a no mide `service_completed_successfully`
ok    5.3: `docker buildx version`
ok    1.1: `check-image-platforms.sh`
ok    1.1: `object-store.js`
ok    4.1: `infra/deploy/check-image-platforms.sh`
ok    9.10: «se guarda cifrado» y «Mi CV»
ok    D3: digest como tercer argumento de `deploy.sh`
ok    D4: corredor lee `Digest del índice:` de ADR-052 «Elección»
ok    D4: `deploy.sh` lo recibe como tercer argumento y lo compara antes del `pull`
ok    4.4: tercer argumento, comparado con el digest resuelto de `object-store`
ok    4.4: `docker` falso con digest distinto
ok    4.5: el corredor lee la línea del digest y la pasa a `deploy.sh`
ok    1.1: línea `Digest del índice:` de ADR-052
ok    proposal: digest del almacén en el orden del despliegue
ok    2.2: clase `artifact` con el texto de 35a
ok    spec ci-pipeline: almacén aprovisionado y comprobado tras arrancar
ok    scope verify-reusable-workflow: `deploy-prod` con `object-store.js provision`
ok    scope verify-reusable-workflow: `check-image-platforms.sh`
ok    scope verify-reusable-workflow: `WAIT_TIMEOUT`
exit=0
```

Contra `2409bbb`, cae y nombra los 24. Ninguno existía en ese commit, y coincide con `git diff 2409bbb HEAD` de esas
cinco rutas: todo lo que se comprueba entró después de él.

```text
$ REV=2409bbb node -e "$(cat traslados-check.js)"
traslados (git show 2409bbb): 0/24
FALTA D4: `up` → `object-store.js provision` → `verify`
FALTA 4.4: `up` → `object-store.js provision` → `object-store.js verify`
FALTA 4.4: `docker` falso que contesta a `imagetools inspect`
FALTA 4.4: caso de plataforma ausente
FALTA D5: aprovisionar es un `run` aparte
FALTA D5: 35a no mide `service_completed_successfully`
FALTA 5.3: `docker buildx version`
FALTA 1.1: `check-image-platforms.sh`
FALTA 1.1: `object-store.js`
FALTA 4.1: `infra/deploy/check-image-platforms.sh`
FALTA 9.10: «se guarda cifrado» y «Mi CV»
FALTA D3: digest como tercer argumento de `deploy.sh`
FALTA D4: corredor lee `Digest del índice:` de ADR-052 «Elección»
FALTA D4: `deploy.sh` lo recibe como tercer argumento y lo compara antes del `pull`
FALTA 4.4: tercer argumento, comparado con el digest resuelto de `object-store`
FALTA 4.4: `docker` falso con digest distinto
FALTA 4.5: el corredor lee la línea del digest y la pasa a `deploy.sh`
FALTA 1.1: línea `Digest del índice:` de ADR-052
FALTA proposal: digest del almacén en el orden del despliegue
FALTA 2.2: clase `artifact` con el texto de 35a
FALTA spec ci-pipeline: almacén aprovisionado y comprobado tras arrancar
FALTA scope verify-reusable-workflow: `deploy-prod` con `object-store.js provision`
FALTA scope verify-reusable-workflow: `check-image-platforms.sh`
FALTA scope verify-reusable-workflow: `WAIT_TIMEOUT`
exit=1
```

## Plataformas en el registro: medición (tarea 2.14)

Se midió antes de escribir el script de la 2.15 (design D9), el 2026-09-26 entre 21:45Z y 21:49Z, con
`docker buildx` v0.37.0 y Docker Compose v5.5.1 (línea base). Todas las órdenes corrieron con un `DOCKER_CONFIG`
aislado cuyo `config.json` es `{}` y con `DOCKER_HOST=npipe:////./pipe/dockerDesktopLinuxEngine`, como en la 1.4. El
almacén de credenciales de Docker Desktop no tiene ninguna entrada de `ghcr.io`, solo las de Docker Hub
(`docker-credential-desktop list`). Así que ese `DOCKER_CONFIG` es exactamente el estado «tras `docker logout ghcr.io`»
que pide el caso `401`, y no hizo falta ningún `docker logout`. Cada orden se volcó a fichero (stdout, stderr y código
de salida) y se leyó con `node`. La imagen privada del caso `401` es `ghcr.io/manuxd270516/linkvault-api:staging`:
`gh api user/packages/container/linkvault-api` da `visibility: private`, y la etiqueta `staging` existe en sus
versiones.

Plantillas probadas:

```text
RANGO       = {{range .Manifest.Manifests}}{{.Platform.OS}}/{{.Platform.Architecture}}{{"\n"}}{{end}}
PLATAFORMAS = {{if or (eq .Manifest.MediaType "application/vnd.oci.image.index.v1+json") (eq .Manifest.MediaType "application/vnd.docker.distribution.manifest.list.v2+json")}}{{range .Manifest.Manifests}}{{with .Platform}}{{.OS}}/{{.Architecture}}{{"\n"}}{{end}}{{end}}{{else}}{{.Image.OS}}/{{.Image.Architecture}}{{"\n"}}{{end}}
```

### Plataformas: índice, manifiesto único y atestaciones

`RANGO` sobre un índice (`mongo:7.0.43`), sobre el manifiesto único del espejo (1.3) y sobre una imagen con entradas
de atestación (`rustfs/rustfs:1.0.0`):

```text
$ docker buildx imagetools inspect mongo:7.0.43 --format "$RANGO"
linux/amd64
unknown/unknown
linux/arm64
unknown/unknown
windows/amd64
windows/amd64
exit=0
$ docker buildx imagetools inspect ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z --format "$RANGO"
ERROR: template: :1:17: executing "" at <.Manifest.Manifests>: can't evaluate field Manifests in type interface {}
exit=1
$ docker buildx imagetools inspect rustfs/rustfs:1.0.0 --format "$RANGO"
linux/amd64
linux/arm64
unknown/unknown
unknown/unknown
exit=0
```

Con un manifiesto único, `.Manifest` no tiene `Manifests` y la plantilla **falla con exit 1**. El error no se evita
metiendo el `range` dentro de un `{{if .Manifest.Manifests}}`: evaluar la condición ya falla (medido, `:1:14`, el
mismo error). `PLATAFORMAS` decide por `.Manifest.MediaType`, que existe en los dos casos, y solo entra en el `range`
si es un índice OCI o una lista de Docker. Si no, lee la configuración de la imagen. `imagetools` **sí** distingue
índice de manifiesto único, así que no hace falta la alternativa `docker manifest inspect --verbose` de D9. Se probó
sobre las cinco formas: índice OCI con atestaciones y entradas `windows` (`mongo`), manifiesto único (espejo), índice
con atestaciones (`rustfs`), lista de manifiestos de Docker (`garage`) e índice sin `arm64` (`mysql:5.7`, de la 1.3):

```text
$ docker buildx imagetools inspect mongo:7.0.43 --format "$PLATAFORMAS"
linux/amd64
unknown/unknown
linux/arm64
unknown/unknown
windows/amd64
windows/amd64
exit=0
$ docker buildx imagetools inspect ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z --format "$PLATAFORMAS"
linux/amd64
exit=0
$ docker buildx imagetools inspect rustfs/rustfs:1.0.0 --format "$PLATAFORMAS"
linux/amd64
linux/arm64
unknown/unknown
unknown/unknown
exit=0
$ docker buildx imagetools inspect dxflrs/garage:v2.4.1 --format "$PLATAFORMAS"
linux/arm64
linux/amd64
linux/386
linux/arm
exit=0
$ docker buildx imagetools inspect mysql:5.7 --format "$PLATAFORMAS"
linux/amd64
unknown/unknown
exit=0
```

- Las entradas de atestación salen como `unknown/unknown` y se ignoran. Las `windows/amd64` de `mongo` no casan con
  ninguna `linux/…` pedida.
- `{{with .Platform}}` salta una entrada de índice sin plataforma en vez de fallar. Ninguna de las cinco la tiene.
- Una variante (`linux/arm/v7` en SeaweedFS, 1.4) sale como `linux/arm`: la plantilla solo da `os/arch`.

### Digest del índice

La plantilla `{{.Manifest.Digest}}`, contrastada con la línea `Digest:` de la salida sin plantilla (se pegan sus
tres primeras líneas):

```text
$ docker buildx imagetools inspect mongo:7.0.43
Name:      docker.io/library/mongo:7.0.43
MediaType: application/vnd.oci.image.index.v1+json
Digest:    sha256:9854f7139445d766a9523571d6f047530c45547460ffcf8259eb2bf4264632ca
(…)
exit=0
```

```text
$ docker buildx imagetools inspect mongo:7.0.43 --format '{{.Manifest.Digest}}'
sha256:9854f7139445d766a9523571d6f047530c45547460ffcf8259eb2bf4264632ca
exit=0
```

```text
$ docker buildx imagetools inspect ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z
Name:      ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z
MediaType: application/vnd.docker.distribution.manifest.v2+json
Digest:    sha256:a1a8bd4ac40ad7881a245bab97323e18f971e4d4cba2c2007ec1bedd21cbaba2
(…)
exit=0
```

```text
$ docker buildx imagetools inspect ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z --format '{{.Manifest.Digest}}'
sha256:a1a8bd4ac40ad7881a245bab97323e18f971e4d4cba2c2007ec1bedd21cbaba2
exit=0
```

```text
$ docker buildx imagetools inspect dxflrs/garage:v2.4.1
Name:      docker.io/dxflrs/garage:v2.4.1
MediaType: application/vnd.docker.distribution.manifest.list.v2+json
Digest:    sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020
(…)
exit=0
```

```text
$ docker buildx imagetools inspect dxflrs/garage:v2.4.1 --format '{{.Manifest.Digest}}'
sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020
exit=0
```

Da el digest del índice en un índice OCI (`mongo`) y en una lista de Docker (`garage`, el mismo de la 1.4). En un
manifiesto único (el espejo) da el del manifiesto. Imprime **71 bytes sin salto de línea**
(`sha256:` + 64 hexadecimales), medidos con `node` sobre el fichero volcado.

### `config --images` de un servicio

```text
$ docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config --images
mongo:7.0.43
redis:7.4.11
ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z
ghcr.io/manuxd270516/linkvault-api:latest
ghcr.io/manuxd270516/linkvault-worker:latest
ghcr.io/manuxd270516/linkvault-web:latest
traefik:v3.3.5
exit=0
$ docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config --images minio
ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z
exit=0
$ docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config --images object-store
no such service: object-store
exit=1
$ docker compose -f <scratchpad>/prod-renamed.yml --project-directory . --env-file infra/ci/verify.env config --images object-store
ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z
exit=0
$ docker compose -f <scratchpad>/prod-renamed.yml --project-directory . --env-file infra/ci/verify.env config --images object-store api
mongo:7.0.43
redis:7.4.11
ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z
ghcr.io/manuxd270516/linkvault-api:latest
exit=0
```

- Hoy el servicio del almacén se llama `minio`: `config --images object-store` sale con 1 (`no such service`). La
  forma se midió sobre una copia del compose de producción, en el scratchpad, que solo renombra la clave del servicio
  `minio` y sus dos `depends_on` a `object-store` (lo que hará la 7.3), con `--project-directory .`. Imprime **una
  línea**, la imagen de ese servicio.
- **Con nombres de servicio, Compose añade las imágenes de sus `depends_on`:** `config --images object-store api` da
  también `mongo` y `redis`, de los que depende `api`. `config --images object-store` da una sola línea **mientras
  `object-store` no tenga `depends_on`**, como en el compose de hoy. Quien la lea (la 7.1 y el `deploy.sh` de 35b)
  tiene esa condición.
- El orden de las imágenes de `config --images` sin argumentos no es estable entre corridas: en la 2.15 salió
  `redis`, `traefik`, `mongo`.

### Errores de `imagetools inspect`

Con la plantilla `PLATAFORMAS` (el stderr es lo que clasifica el script):

```text
$ docker buildx imagetools inspect mongo:0.0.0-noexiste --format "$PLATAFORMAS"
ERROR: docker.io/library/mongo:0.0.0-noexiste: not found
exit=1
$ docker buildx imagetools inspect ghcr.io/manuxd270516/noexiste:1 --format "$PLATAFORMAS"
ERROR: failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://ghcr.io/token?scope=repository%3Amanuxd270516%2Fnoexiste%3Apull&service=ghcr.io: 403 Forbidden
exit=1
$ docker buildx imagetools inspect registry.invalid/x:1 --format "$PLATAFORMAS"
ERROR: failed to do request: Head "https://registry.invalid/v2/x/manifests/1": dial tcp: lookup registry.invalid: no such host
exit=1
$ docker buildx imagetools inspect ghcr.io/manuxd270516/linkvault-api:staging --format "$PLATAFORMAS"
ERROR: failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://ghcr.io/token?scope=repository%3Amanuxd270516%2Flinkvault-api%3Apull&service=ghcr.io: 401 Unauthorized
exit=1
$ docker buildx imagetools inspect ghcr.io/manuxd270516/linkvault-minio:noexiste --format "$PLATAFORMAS"
ERROR: ghcr.io/manuxd270516/linkvault-minio:noexiste: not found
exit=1
$ docker buildx imagetools inspect docker.io/manuxd270516/noexiste-lv:1 --format "$PLATAFORMAS"
ERROR: pull access denied, repository does not exist or may require authorization: server message: insufficient_scope: authorization failed
exit=1
```

Sin plantilla, el mismo stderr, así que no depende de ella:

```text
$ docker buildx imagetools inspect mongo:0.0.0-noexiste
ERROR: docker.io/library/mongo:0.0.0-noexiste: not found
exit=1
$ docker buildx imagetools inspect ghcr.io/manuxd270516/noexiste:1
ERROR: failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://ghcr.io/token?scope=repository%3Amanuxd270516%2Fnoexiste%3Apull&service=ghcr.io: 403 Forbidden
exit=1
$ docker buildx imagetools inspect registry.invalid/x:1
ERROR: failed to do request: Head "https://registry.invalid/v2/x/manifests/1": dial tcp: lookup registry.invalid: no such host
exit=1
$ docker buildx imagetools inspect ghcr.io/manuxd270516/linkvault-api:staging
ERROR: failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://ghcr.io/token?scope=repository%3Amanuxd270516%2Flinkvault-api%3Apull&service=ghcr.io: 401 Unauthorized
exit=1
```

Los dos últimos casos con plantilla son extra, para no clasificar por un solo registro: un tag inexistente en un
repositorio **público** de GHCR y un repositorio inexistente en Docker Hub.

| Caso | stderr medido (última línea) | Código de `imagetools` | Salida del script |
|---|---|---|---|
| Tag inexistente, Docker Hub (`mongo:0.0.0-noexiste`) | `ERROR: docker.io/library/mongo:0.0.0-noexiste: not found` | 1 | **3** |
| Tag inexistente, GHCR público (`linkvault-minio:noexiste`) | `ERROR: ghcr.io/manuxd270516/linkvault-minio:noexiste: not found` | 1 | **3** |
| Repositorio inexistente, GHCR sin sesión (`ghcr.io/manuxd270516/noexiste:1`) | `… failed to fetch anonymous token: … 403 Forbidden` | 1 | **4** |
| Repositorio inexistente, Docker Hub (`manuxd270516/noexiste-lv:1`) | `… pull access denied, repository does not exist or may require authorization: … insufficient_scope …` | 1 | **4** |
| Nombre que no resuelve (`registry.invalid/x:1`) | `… dial tcp: lookup registry.invalid: no such host` | 1 | **4** |
| `401`: imagen privada de GHCR sin sesión (`linkvault-api:staging`) | `… failed to fetch anonymous token: … 401 Unauthorized` | 1 | **4** |
| Plataforma ausente del índice o manifiesto único de otra | (sale 0; la plataforma falta en la lista) | 0 | **3** |
| Cualquier otro error, incluido un `429` (no medido) | — | ≠0 | **4** |

- **El código de salida no discrimina**: `imagetools inspect` sale con 1 en todos los errores. Clasifica el stderr.
- **3** solo cuando la última línea es `ERROR: <ref>: not found`. Es como `buildx` presenta el «manifest unknown»/`404`
  de D9, y es lo único medido que dice que la referencia no existe.
- **Un repositorio inexistente no se distingue de uno privado.** Docker Hub lo dice en el propio mensaje («does not
  exist or may require authorization»). GHCR, sin sesión, contesta al token con un `403` para el inexistente y un `401`
  para el privado: los dos son un rechazo de la autorización, y ninguno afirma que la referencia no exista. Por D9
  («no se inventa una distinción que el registro no da») caen en **4**, junto a todo lo no clasificado.
- **No medido:** un repositorio inexistente de GHCR **con** sesión, que es como lo llamará el `deploy.sh` de 35b tras
  el login. No cambia la regla: solo `not found` es 3 y todo lo demás es 4.

**Plantillas elegidas** (las usan el script de la 2.15, la 7.1 y el `deploy.sh` de 35b):

```text
plataformas: PLATAFORMAS (arriba), leída línea a línea, ignorando unknown/unknown y comparando os/arch exacto
digest del índice: {{.Manifest.Digest}}
imagen del almacén: docker compose -f <compose> --env-file <env> config --images object-store
```

## Script de plataformas (tarea 2.15)

`infra/deploy/check-image-platforms.sh`, escrito con la clasificación de la 2.14 (tabla de arriba). Las seis
verificaciones de la tarea, el 2026-09-26 hacia las 21:50Z, con el mismo `DOCKER_CONFIG` aislado y un daemon `linux/amd64`. Las imágenes
de terceros del compose de producción salen de su `config --images` sin las de `ghcr.io/manuxd270516/`:

```text
$ bash -n infra/deploy/check-image-platforms.sh
exit=0
$ bash infra/deploy/check-image-platforms.sh redis:7.4.11 traefik:v3.3.5 mongo:7.0.43
ok: redis:7.4.11 (linux/amd64)
ok: traefik:v3.3.5 (linux/amd64)
ok: mongo:7.0.43 (linux/amd64)
exit=0
$ bash infra/deploy/check-image-platforms.sh --platform linux/arm64 ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z
no existe para linux/arm64: ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z (disponibles: linux/amd64)
exit=3
$ bash infra/deploy/check-image-platforms.sh --platform linux/arm64 mysql:5.7
no existe para linux/arm64: mysql:5.7 (disponibles: linux/amd64)
exit=3
$ bash infra/deploy/check-image-platforms.sh mongo:0.0.0-noexiste
no existe: mongo:0.0.0-noexiste (pedida linux/amd64): el registro no tiene esa etiqueta (ERROR: docker.io/library/mongo:0.0.0-noexiste: not found)
exit=3
$ bash infra/deploy/check-image-platforms.sh registry.invalid/x:1
no se pudo comprobar: registry.invalid/x:1: ERROR: failed to do request: Head "https://registry.invalid/v2/x/manifests/1": dial tcp: lookup registry.invalid: no such host
exit=4
$ bash infra/deploy/check-image-platforms.sh
check-image-platforms: faltan las imágenes
uso: infra/deploy/check-image-platforms.sh [--platform <os>/<arch>] (<imagen>... | --compose <fichero> --env-file <fichero>)
exit=2
```

Extra: variante en `--platform` (uso incorrecto), la imagen privada sin sesión (`401` → 4), una mezcla de 4 y 3 (sale
3: la ausencia demostrada es del artefacto y reintentar no la arregla) y las mismas imágenes de terceros en
`linux/arm64`:

```text
$ bash infra/deploy/check-image-platforms.sh --platform linux/arm/v7 mongo:7.0.43
check-image-platforms: plataforma no válida (solo <os>/<arch>, sin variante): linux/arm/v7
uso: infra/deploy/check-image-platforms.sh [--platform <os>/<arch>] (<imagen>... | --compose <fichero> --env-file <fichero>)
exit=2
$ bash infra/deploy/check-image-platforms.sh ghcr.io/manuxd270516/linkvault-api:staging
no se pudo comprobar: ghcr.io/manuxd270516/linkvault-api:staging: ERROR: failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://ghcr.io/token?scope=repository%3Amanuxd270516%2Flinkvault-api%3Apull&service=ghcr.io: 401 Unauthorized
exit=4
$ bash infra/deploy/check-image-platforms.sh --platform linux/arm64 registry.invalid/x:1 ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z
no se pudo comprobar: registry.invalid/x:1: ERROR: failed to do request: Head "https://registry.invalid/v2/x/manifests/1": dial tcp: lookup registry.invalid: no such host
no existe para linux/arm64: ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z (disponibles: linux/amd64)
exit=3
$ bash infra/deploy/check-image-platforms.sh --platform linux/arm64 redis:7.4.11 traefik:v3.3.5 mongo:7.0.43
ok: redis:7.4.11 (linux/arm64)
ok: traefik:v3.3.5 (linux/arm64)
ok: mongo:7.0.43 (linux/arm64)
exit=0
```

Falsación, sobre **copias** del script en el scratchpad (el del repositorio no se tocó):

```text
(a) comparación de plataforma rota ([ "$p" = "$platform" ] && found=1  →  found=1)
rota-a | --platform linux/arm64 ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z | exit=0 (sin romper: 3)
rota-a | --platform linux/arm64 mysql:5.7 | exit=0 (sin romper: 3)
rota-a | mongo:0.0.0-noexiste | exit=3 (sin romper: 3)
(b) clasificación de «not found» rota (la condición pasa a `false`)
rota-b | --platform linux/arm64 ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z | exit=3 (sin romper: 3)
rota-b | --platform linux/arm64 mysql:5.7 | exit=3 (sin romper: 3)
rota-b | mongo:0.0.0-noexiste | exit=4 (sin romper: 3)
```

El modo `--compose` contra el compose ya sustituido y la imagen publicada en `arm64` se verifica en la 10.1.

## Control MinIO (tareas 2.6-2.11)

Control del arnés: `docs/object-store-matrix/minio.compose.yml` (servicio `object-store`, imagen del espejo
`ghcr.io/manuxd270516/linkvault-minio:RELEASE.2025-09-07T16-13-09Z`, `MINIO_KMS_SECRET_KEY` desde
`OBJECT_STORE_SSE_KEY`, un solo volumen con nombre `object-store-data` sin `name:`, puerto S3 por `OBJECT_STORE_PORT`).
Todas las corridas de esta sección, el 2026-09-26, con el proyecto `os26-minio` en el puerto `19626` del host (el
`9000` es el MinIO de desarrollo, que no se tocó), credenciales y clave generadas en el scratchpad para la ocasión
(`OBJECT_STORE_SSE_KEY=lv-sse:<base64 de 32 bytes aleatorios>`), exportadas junto con
`S3_ENDPOINT=http://localhost:19626`, `S3_REGION=us-east-1`, `S3_BUCKET=cvs` y `S3_SNAPSHOTS_BUCKET=snapshots`, que
tienen precedencia sobre el `.env` (Nx no sobrescribe el entorno del proceso). Las salidas de Nx se recortan a lo que
imprime la orden.

### 2.6: target, punto de entrada y control

```text
$ pnpm nx run api:build            # redirigido a fichero
Successfully ran target build for project api
exit=0
$ node -e "…existsSync('dist/apps/api/object-store.js')…"
dist/apps/api/object-store.js existe, 278006 bytes
```

(La primera corrida de `api:build` cayó con `A required privilege is not held by the client. (os error 1314)` al
cachear: es la trampa conocida de `dist/apps/api/node_modules` —enlaces de un `api:prune` anterior—, no del cambio.
Se apartó fuera de `dist/` durante el apply y se restauró al terminar.)

```text
$ docker build -f docker/api.Dockerfile -t lv-api:os .
#21 naming to docker.io/library/lv-api:os done
exit=0
$ docker run --rm lv-api:os node object-store.js verify
[object-store] Invalid configuration, check these environment variables: S3_ENDPOINT (missing), S3_REGION (missing), S3_ACCESS_KEY (missing), S3_SECRET_KEY (missing), S3_BUCKET (missing), S3_SNAPSHOTS_BUCKET (missing)
exit=2
```

```text
$ docker compose -p os26-minio -f docs/object-store-matrix/minio.compose.yml up -d --wait
 Volume os26-minio_object-store-data Created
 Network os26-minio_default Created
 Container os26-minio-object-store-1 Started
 Container os26-minio-object-store-1 Healthy
exit=0
$ docker compose -p os26-minio -f docs/object-store-matrix/minio.compose.yml config --format json   # servicio object-store
{"volumes":[{"type":"volume","source":"object-store-data","target":"/data","volume":{}}],"ports":[{"mode":"ingress","target":9000,"published":"19626","protocol":"tcp"}],"env":["MINIO_KMS_SECRET_KEY","MINIO_ROOT_PASSWORD","MINIO_ROOT_USER"]}
volumes top: {"object-store-data":{"name":"os26-minio_object-store-data"}}
```

```text
$ pnpm nx run api:object-store -- provision        # primera
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0
$ pnpm nx run api:object-store -- provision        # segunda
ok    cvs: bucket already exists
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket already exists
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0
$ pnpm nx run api:object-store -- verify
ok    cvs: bucket exists
ok    snapshots: bucket exists
ok    cvs: no lifecycle rule
ok    cvs: default encryption (AES256)
ok    snapshots: no lifecycle rule
ok    snapshots: no snapshot older than 31 days (0 listed)
ok    cvs: anonymous GET of a missing object rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous listing rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous PUT rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous GET of a missing object rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous listing rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous PUT rejected (HTTP 403 AccessDenied)
verify: ok
exit=0
```

La primera `provision` crea los dos buckets: habló con el control y no con el MinIO de desarrollo, que ya los tiene.

**Medido de paso, para la 2.9:** `docker compose config --format json` pone `name: <proyecto>_<clave>` en todo volumen
con nombre aunque el fichero no declare `name:`, **y también con `--no-interpolate`**
(`{"object-store-data":{"name":"os26-minio_object-store-data"}}` en las dos). `c5.sh` no puede tomar «tiene `name`» por
«`name:` explícito».

### 2.7: suite de contrato de `api`

```text
$ pnpm nx run api:test -- s3.s3-contract --reporter=verbose          # sin S3_CONTRACT
 ↓ S3 contract of api (real store) > runs with the checksum policy it was asked for
 ↓ S3 contract of api (real store) > uploads a CV with the real adapter and the same bytes come back
 ↓ S3 contract of api (real store) > deletes a prefix of 1001 keys in two DeleteObjects batches and leaves it empty
 ↓ S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them
 Test Files  1 skipped (1)
      Tests  4 skipped (4)
exit=0

$ S3_CONTRACT=1 pnpm nx run api:test -- s3.s3-contract --reporter=verbose      # política por defecto (sin S3_CONTRACT_CHECKSUM)
 ✓ S3 contract of api (real store) > runs with the checksum policy it was asked for 1ms
 ✓ S3 contract of api (real store) > uploads a CV with the real adapter and the same bytes come back 46ms
 ✓ S3 contract of api (real store) > deletes a prefix of 1001 keys in two DeleteObjects batches and leaves it empty 891ms
 ↓ S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them
 Test Files  1 passed (1)
      Tests  3 passed | 1 skipped (4)
exit=0

$ S3_CONTRACT=1 S3_BUCKET=no-existe pnpm nx run api:test -- s3.s3-contract --reporter=verbose
 ✓ S3 contract of api (real store) > runs with the checksum policy it was asked for 1ms
 × S3 contract of api (real store) > uploads a CV with the real adapter and the same bytes come back 35ms
   → The specified bucket does not exist
 × S3 contract of api (real store) > deletes a prefix of 1001 keys in two DeleteObjects batches and leaves it empty 27ms
   → The specified bucket does not exist
 ↓ S3 contract of api (real store) > C5 mode: …
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed | 1 skipped (4)
exit=1

$ S3_CONTRACT=1 S3_CONTRACT_C5_DIR=<scratchpad>\c5-2p7 pnpm nx run api:test -- s3.s3-contract --reporter=verbose
 ✓ S3 contract of api (real store) > runs with the checksum policy it was asked for 1ms
 ✓ S3 contract of api (real store) > uploads a CV with the real adapter and the same bytes come back 44ms
 ✓ S3 contract of api (real store) > deletes a prefix of 1001 keys in two DeleteObjects batches and leaves it empty 892ms
 ✓ S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them 87ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
exit=0

$ node -e "…tamaños esperados y sha256 de A1, A2, B1, B2…"     # en <scratchpad>\c5-2p7
A1.bin 1048576 ok 4bac0a6cdeef9259
A2.bin 1024 ok 9ed7d59b4032d0ff
B1.bin 1048576 ok bc6721d922b49b2d
B2.bin 1024 ok 92387266662660ad
cuatro distintos: true
manifest: endpoint,checksumPolicy,objects
node -e exit=0
```

`manifest.json` de esa corrida: `checksumPolicy: when_supported`; A1 y A2 en `cvs` con
`serverSideEncryptionReported: AES256` (el cifrado por defecto del bucket, sin cabeceras SSE en la petición); B1 y B2 en
`snapshots` con `none reported`.

### 2.8: suite de contrato de `worker`

```text
$ pnpm nx run worker:test -- s3.s3-contract --reporter=verbose       # sin S3_CONTRACT
 ↓ S3 contract of worker (real store) > reads the bytes that were written
 ↓ S3 contract of worker (real store) > deletes, and deleting again is still a success
 ↓ S3 contract of worker (real store) > tells a missing object (null) apart from a store that is down (error)
 ↓ S3 contract of worker (real store) > stores a gzipped snapshot in the snapshots bucket
 Test Files  1 skipped (1)
      Tests  4 skipped (4)
exit=0

$ S3_CONTRACT=1 pnpm nx run worker:test -- s3.s3-contract --reporter=verbose
 ✓ S3 contract of worker (real store) > reads the bytes that were written 39ms
 ✓ S3 contract of worker (real store) > deletes, and deleting again is still a success 17ms
 ✓ S3 contract of worker (real store) > tells a missing object (null) apart from a store that is down (error) 165ms
 ✓ S3 contract of worker (real store) > stores a gzipped snapshot in the snapshots bucket 16ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
exit=0

$ S3_CONTRACT=1 S3_BUCKET=no-existe pnpm nx run worker:test -- s3.s3-contract --reporter=verbose
 × S3 contract of worker (real store) > reads the bytes that were written 44ms
   → The specified bucket does not exist
 × S3 contract of worker (real store) > deletes, and deleting again is still a success 4ms
   → The specified bucket does not exist
 ✓ S3 contract of worker (real store) > tells a missing object (null) apart from a store that is down (error) 239ms
 ✓ S3 contract of worker (real store) > stores a gzipped snapshot in the snapshots bucket 19ms
 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
exit=1

$ S3_CONTRACT=1 S3_SNAPSHOTS_BUCKET=no-existe pnpm nx run worker:test -- s3.s3-contract --reporter=verbose
 ✓ S3 contract of worker (real store) > reads the bytes that were written 37ms
 ✓ S3 contract of worker (real store) > deletes, and deleting again is still a success 16ms
 ✓ S3 contract of worker (real store) > tells a missing object (null) apart from a store that is down (error) 237ms
 WARN [S3SnapshotStore] snapshot not stored for link e92eb1fd561dfbd31c678791: NoSuchBucket
 × S3 contract of worker (real store) > stores a gzipped snapshot in the snapshots bucket 10ms
   → expected null to be 'e92eb1fd561dfbd31c678791/1.html.gz' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
exit=1

$ git ls-files -z | node -e "…busca CV_MINIO_LOCAL…"
CV_MINIO_LOCAL en ficheros versionados: openspec/changes/object-store/design.md, openspec/changes/object-store/tasks.md
fuera de este change: ninguno
node -e exit=0
```

**Hallazgo (registrado en la 7.5 y la 7.5b):** con `S3_BUCKET=no-existe`, el caso «objeto ausente (`null`)» **pasa**:
el lector del `worker` trata `NoSuchBucket` (y cualquier `404`) como objeto ausente (`meansMissingObject`). Una sonda
que solo exija `null` pasaría con el bucket de CV sin crear.

### 2.11: falsación del acceso anónimo y `list-buckets.mjs`

```text
$ node docs/object-store-matrix/list-buckets.mjs
buckets (2):
cvs
snapshots
exit=0

$ node -e "…PutBucketPolicyCommand (lectura pública, la de 'mc anonymous set download') en S3_BUCKET y GetBucketPolicy…"
PutBucketPolicy cvs: ok; política leída: {"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetBucketLocation","s3:ListBucket"],"Resource":["arn:aws:s3:::cvs"]},{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::cvs/*"]}]}
exit=0

$ pnpm nx run api:object-store -- verify
ok    cvs: bucket exists
ok    snapshots: bucket exists
ok    cvs: no lifecycle rule
ok    cvs: default encryption (AES256)
ok    snapshots: no lifecycle rule
ok    snapshots: no snapshot older than 31 days (2 listed)
FAIL  cvs: anonymous GET of an existing object: access granted (HTTP 200)
FAIL  cvs: anonymous listing: access granted (HTTP 200)
ok    cvs: anonymous PUT rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous GET of an existing object rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous listing rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous PUT rejected (HTTP 403 AccessDenied)
verify: FAILED (2): cvs: anonymous GET of an existing object: access granted (HTTP 200); cvs: anonymous listing: access granted (HTTP 200)
exit=1

$ pnpm nx run api:object-store -- provision
ok    cvs: bucket already exists
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: bucket policy removed
ok    snapshots: bucket already exists
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0

$ pnpm nx run api:object-store -- verify
ok    cvs: bucket exists
ok    snapshots: bucket exists
ok    cvs: no lifecycle rule
ok    cvs: default encryption (AES256)
ok    snapshots: no lifecycle rule
ok    snapshots: no snapshot older than 31 days (2 listed)
ok    cvs: anonymous GET of an existing object rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous listing rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous PUT rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous GET of an existing object rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous listing rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous PUT rejected (HTTP 403 AccessDenied)
verify: ok
exit=0
```

Con los objetos del modo C5 de la 2.7 ya en los buckets, `verify` prueba el `GET` anónimo sobre un objeto **existente**
(«of an existing object»): con la política pública lo concede con `200` y `verify` lo nombra sin imprimir sus bytes. La
política la quita `provision` («bucket policy removed») y `verify` vuelve a 0.

Al terminar: `docker compose -p os26-minio -f docs/object-store-matrix/minio.compose.yml down -v` (contenedor, red y
volumen `os26-minio_object-store-data` borrados). La 2.9 y la 2.10 levantan el control de nuevo, desde un volumen vacío.

### 2.9: `find-plaintext.mjs`, `c5.sh` y lectura del disco

Scripts: `docs/object-store-matrix/find-plaintext.mjs` (tres ventanas de 64 bytes de cada buffer, en el principio, la
mitad y el final, y la clave en tres formas: textual, contenido codificado y decodificada; un resultado por buffer y
otro por la clave), `docs/object-store-matrix/c5.sh`, y sus dos módulos `c5-helpers.mjs` (compose, contenedor, K2,
`GET` por bytes, clasificación) y `c5-key.mjs` (formas de la clave y K2 con el mismo formato que K1). `c5.sh` lanza
el modo C5 de la suite con `vitest` directamente (sin Nx: ni caché ni el `.env`; las `S3_*` son las exportadas).

Corridas del 2026-09-26 con el proyecto `os29-minio` en el puerto `19629` (el `9000` es el MinIO de desarrollo, que no
se tocó), credenciales y `OBJECT_STORE_SSE_KEY=lv-sse:<base64 de 32 bytes aleatorios>` generadas en el scratchpad y
exportadas con `COMPOSE_PROJECT_NAME=os29-minio`, `S3_ENDPOINT=http://localhost:19629`, `S3_REGION=us-east-1`,
`S3_BUCKET=cvs` y `S3_SNAPSHOTS_BUCKET=snapshots`. Control levantado desde un volumen vacío (`up -d --wait`) y
aprovisionado con `pnpm nx run api:object-store -- provision` (`provision: ok`, `cvs: default encryption set
(AES256)`). Se omiten las líneas `↓` (tests saltados) de la suite.

**Lectura del disco y (b)-(c) sobre el control** (la misma corrida cierra la 2.10):

```text
$ C5_WORKDIR=<scratchpad>/r3-main bash docs/object-store-matrix/c5.sh docs/object-store-matrix/minio.compose.yml object-store-data
c5: mode server, compose docs/object-store-matrix/minio.compose.yml, volume object-store-data, workdir <scratchpad>/r3-main
c5: project os29-minio, docker volume os29-minio_object-store-data, key entry MINIO_KMS_SECRET_KEY (from OBJECT_STORE_SSE_KEY)
container ok: one volume (os29-minio_object-store-data), no writable bind
c5: 1. contract suite, C5 server mode (vitest, output in <scratchpad>/r3-main/suite.log)
   ✓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them 73ms
   Test Files  1 passed (1)
   Tests  1 passed | 4 skipped (5)
   A1 cvs 1048576 bytes, lo que dice el almacén: AES256
   A2 cvs 1024 bytes, lo que dice el almacén: AES256
   B1 snapshots 1048576 bytes, lo que dice el almacén: none reported
   B2 snapshots 1024 bytes, lo que dice el almacén: none reported
c5: 2. docker compose stop object-store
c5:    tar of volume os29-minio_object-store-data with alpine:3
c5: 3. find-plaintext
   find-plaintext: vol.tar, 4309504 bytes leídos
   A1 0/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   A2 0/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   B1 3/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   B2 3/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   clave 0/3  (textual no; contenido no; decodificada (base64, 32 bytes) no)
c5: 4. disk reading
c5:    disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3)
c5:    (c) ok: la clave, 0/3 formas en el volumen (textual; contenido; decodificada (base64, 32 bytes))
c5: (b) copy project c5copy-d659aa: container created with K2 (same format as K1), volume c5copy-d659aa_object-store-data restored from vol.tar
   K2 MINIO_KMS_SECRET_KEY of the container: the expected key
c5: (b) K2 on the copy
c5:    original object-store still stopped: the endpoint reaches the copy
   almacén listo en 0.0 s
c5:    K2: started
   K2 A1: rechazado sin bytes (HTTP 400 kms:InvalidCiphertextException)
   K2 B1: igual por bytes (1048576 bytes, sha256 2c07445245d6f332)
c5: (b) K1 on the same copy (the compose's own key: OBJECT_STORE_SSE_KEY as the compose resolves it)
   K1 MINIO_KMS_SECRET_KEY of the container: the expected key
   almacén listo en 0.0 s
c5:    K1: started
   K1 A1: igual por bytes (1048576 bytes, sha256 f8a7b10698b3a666)
   K1 B1: igual por bytes (1048576 bytes, sha256 2c07445245d6f332)
c5: copy project c5copy-d659aa removed (container, network and volume)
c5: original object-store started again (up -d --no-deps object-store)
c5: (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos)
c5: (a) with the key in the environment the product uses that key: shown by (b) and (c)
c5: resultado: nativo (disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3); (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos); (c) ok: la clave, 0/3 formas en el volumen (textual; contenido; decodificada (base64, 32 bytes)))
exit=0
```

**Negativas: `c5.sh` sale con 2 nombrando la causa**, con copias de `minio.compose.yml` en el scratchpad que añaden un
segundo volumen al servicio, un bind escribible (`./bind-dir:/bind`), `name: os29-explicit-name` en el volumen, o
cambian la entrada de la clave por `MINIO_KMS_SECRET_KEY: ${OBJECT_STORE_SSE_KEY:-}` y se ejecuta sin la variable. Las
cuatro, con el control en marcha: salen en la lectura del compose, antes de `ps`, `stop` o la suite (`docker ps`
después: `os29-minio-object-store-1 Up About a minute (healthy)`).

```text
$ c5.sh <scratchpad>/variants/minio.two-volumes.compose.yml object-store-data
c5: mode server, compose <scratchpad>/variants/minio.two-volumes.compose.yml, volume object-store-data, workdir <scratchpad>/r2-two-volumes
c5: refused: 2 volumes mounted (object-store-data, extra-data); exactly one is required
exit=2
$ c5.sh <scratchpad>/variants/minio.writable-bind.compose.yml object-store-data
c5: mode server, compose <scratchpad>/variants/minio.writable-bind.compose.yml, volume object-store-data, workdir <scratchpad>/r2-writable-bind
c5: refused: writable bind mount <scratchpad>\variants\bind-dir -> /bind
exit=2
$ c5.sh <scratchpad>/variants/minio.explicit-name.compose.yml object-store-data
c5: mode server, compose <scratchpad>/variants/minio.explicit-name.compose.yml, volume object-store-data, workdir <scratchpad>/r2-explicit-name
c5: refused: volume "object-store-data" declares an explicit name: (the copy of test (b) would mount the original)
exit=2
$ env -u OBJECT_STORE_SSE_KEY c5.sh <scratchpad>/variants/minio.empty-key.compose.yml object-store-data
c5: mode server, compose <scratchpad>/variants/minio.empty-key.compose.yml, volume object-store-data, workdir <scratchpad>/r2-empty-key
c5: refused: the key entry MINIO_KMS_SECRET_KEY resolves empty (K1)
exit=2
```

El `name:` explícito se lee del **YAML crudo** (paquete `yaml` del repositorio): el JSON de `config`, también con
`--no-interpolate`, pone `name: <proyecto>_<clave>` en todo volumen con nombre (medido en la 2.6), así que el compose
sin `name:` pasa (corrida de arriba) y el que lo declara se rechaza.

**Compose con un servicio extra** (`extra`: `alpine:3` con `sleep 86400`), proyecto `os29-extra` en el puerto `19630`
(`S3_ENDPOINT=http://localhost:19630`), levantado entero con `up -d --wait` y aprovisionado (`provision: ok`). La
lectura sale igual y el servicio extra queda intacto:

```text
$ docker inspect -f 'extra {{.Id}} StartedAt={{.State.StartedAt}} Running={{.State.Running}}' <extra>     # antes
extra 4047b6708dfa82d75fdd29c5be4e3de30e8c8eb6d24c2de7bfa325418c538ec4 StartedAt=2026-09-26T22:57:48.028831456Z Running=true
$ C5_WORKDIR=<scratchpad>/r3-extra bash docs/object-store-matrix/c5.sh <scratchpad>/variants/minio.extra-service.compose.yml object-store-data
c5: mode server, compose <scratchpad>/variants/minio.extra-service.compose.yml, volume object-store-data, workdir <scratchpad>/r3-extra
c5: project os29-extra, docker volume os29-extra_object-store-data, key entry MINIO_KMS_SECRET_KEY (from OBJECT_STORE_SSE_KEY)
container ok: one volume (os29-extra_object-store-data), no writable bind
c5: 1. contract suite, C5 server mode (vitest, output in <scratchpad>/r3-extra/suite.log)
   ✓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them 128ms
   Test Files  1 passed (1)
   Tests  1 passed | 4 skipped (5)
   A1 cvs 1048576 bytes, lo que dice el almacén: AES256
   A2 cvs 1024 bytes, lo que dice el almacén: AES256
   B1 snapshots 1048576 bytes, lo que dice el almacén: none reported
   B2 snapshots 1024 bytes, lo que dice el almacén: none reported
c5: 2. docker compose stop object-store
c5:    tar of volume os29-extra_object-store-data with alpine:3
c5: 3. find-plaintext
   find-plaintext: vol.tar, 4256256 bytes leídos
   A1 0/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   A2 0/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   B1 3/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   B2 3/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   clave 0/3  (textual no; contenido no; decodificada (base64, 32 bytes) no)
c5: 4. disk reading
c5:    disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3)
c5:    (c) ok: la clave, 0/3 formas en el volumen (textual; contenido; decodificada (base64, 32 bytes))
c5: (b) copy project c5copy-ebacd8: container created with K2 (same format as K1), volume c5copy-ebacd8_object-store-data restored from vol.tar
   K2 MINIO_KMS_SECRET_KEY of the container: the expected key
c5: (b) K2 on the copy
c5:    original object-store still stopped: the endpoint reaches the copy
   almacén listo en 0.0 s
c5:    K2: started
   K2 A1: rechazado sin bytes (HTTP 400 kms:InvalidCiphertextException)
   K2 B1: igual por bytes (1048576 bytes, sha256 00e6db8df789bbaa)
c5: (b) K1 on the same copy (the compose's own key: OBJECT_STORE_SSE_KEY as the compose resolves it)
   K1 MINIO_KMS_SECRET_KEY of the container: the expected key
   almacén listo en 0.0 s
c5:    K1: started
   K1 A1: igual por bytes (1048576 bytes, sha256 22e6d227e4f37f81)
   K1 B1: igual por bytes (1048576 bytes, sha256 00e6db8df789bbaa)
c5: copy project c5copy-ebacd8 removed (container, network and volume)
c5: original object-store started again (up -d --no-deps object-store)
c5: (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos)
c5: (a) with the key in the environment the product uses that key: shown by (b) and (c)
c5: resultado: nativo (disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3); (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos); (c) ok: la clave, 0/3 formas en el volumen (textual; contenido; decodificada (base64, 32 bytes)))
exit=0
$ docker inspect -f 'extra {{.Id}} StartedAt={{.State.StartedAt}} Running={{.State.Running}}' <extra>     # después
extra 4047b6708dfa82d75fdd29c5be4e3de30e8c8eb6d24c2de7bfa325418c538ec4 StartedAt=2026-09-26T22:57:48.028831456Z Running=true
$ node -e "…compara las dos líneas…"
servicio extra intacto (mismo id y StartedAt): true
```

(La primera corrida sobre esta copia salió `no ejecutado` por un error de sintaxis de la comprobación «el original
sigue detenido» recién añadida —un `[` sin cerrar—, antes de pedir nada a la copia; el original volvió a arrancar, la
copia se borró y el servicio extra quedó con el mismo id y `StartedAt`. Corregida, la de arriba es la segunda. Otro
defecto visto al escribir el script: con `MSYS_NO_PATHCONV=1`, Docker recibía la ruta POSIX del compose sin convertir;
`c5.sh` la pasa ahora como ruta del host.)

**Falsación del método: el mismo control sin cifrado por defecto en `cvs`.** Un `DeleteBucketEncryption` de `cvs`
con el SDK; `c5.sh` tiene que ver el texto en claro y cortar en el disco. Se restauró con `provision` y `verify`:

```text
$ node --input-type=module -e "…DeleteBucketEncryptionCommand cvs y GetBucketEncryption…"
DeleteBucketEncryption cvs: ok; GetBucketEncryption: ServerSideEncryptionConfigurationNotFoundError
exit=0
$ C5_WORKDIR=<scratchpad>/r3-falsify bash docs/object-store-matrix/c5.sh docs/object-store-matrix/minio.compose.yml object-store-data
c5: mode server, compose docs/object-store-matrix/minio.compose.yml, volume object-store-data, workdir <scratchpad>/r3-falsify
c5: project os29-minio, docker volume os29-minio_object-store-data, key entry MINIO_KMS_SECRET_KEY (from OBJECT_STORE_SSE_KEY)
container ok: one volume (os29-minio_object-store-data), no writable bind
c5: 1. contract suite, C5 server mode (vitest, output in <scratchpad>/r3-falsify/suite.log)
   ✓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them 130ms
   Test Files  1 passed (1)
   Tests  1 passed | 4 skipped (5)
   A1 cvs 1048576 bytes, lo que dice el almacén: none reported
   A2 cvs 1024 bytes, lo que dice el almacén: none reported
   B1 snapshots 1048576 bytes, lo que dice el almacén: none reported
   B2 snapshots 1024 bytes, lo que dice el almacén: none reported
c5: 2. docker compose stop object-store
c5:    tar of volume os29-minio_object-store-data with alpine:3
c5: 3. find-plaintext
   find-plaintext: vol.tar, 6386176 bytes leídos
   A1 3/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   A2 3/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   B1 3/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   B2 3/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   clave 0/3  (textual no; contenido no; decodificada (base64, 32 bytes) no)
c5: 4. disk reading
c5:    disco: falla: texto en claro del CV en el volumen (A1, A2); A1 3/3, A2 3/3, B1 3/3, B2 3/3
c5: resultado: falla (disco: texto en claro del CV; no se ejecutan (a)-(c))
c5: original object-store started again (up -d --no-deps object-store)
exit=1
$ pnpm nx run api:object-store -- provision
ok    cvs: default encryption set (AES256)
provision: ok
exit=0
$ pnpm nx run api:object-store -- verify
ok    cvs: default encryption (AES256)
verify: ok
exit=0
```

**El método acierta sobre el cifrado conocido:** con el cifrado por defecto del bucket, A1 y A2 0/3 y B1 y B2 3/3 (el
control aparece entero, así que la lectura vale para MinIO de un solo disco); sin él, A1 y A2 3/3 y `falla` sin
ejecutar (a)-(c). Los dos caminos de escritura salen en el `tar`: el objeto de 1 MiB va a un `part.1` y el de 1 KiB, en
línea dentro de `xl.meta` (listado del `tar` de `r3-main`, objetos B de una corrida anterior sobre el mismo volumen):

```text
$ tar tvf <scratchpad>/r3-main/vol.tar      # entradas de snapshots/c5-*
-rw-r--r-- root/root       393 2026-09-26 18:55 ./snapshots/c5-1a0dfee80a3-05c04af1/B1.bin/xl.meta
-rw-r--r-- root/root   1048608 2026-09-26 18:55 ./snapshots/c5-1a0dfee80a3-05c04af1/B1.bin/eaaae045-7e11-4820-a115-63270fb6bb91/part.1
-rw-r--r-- root/root      1488 2026-09-26 18:55 ./snapshots/c5-1a0dfee80a3-05c04af1/B2.bin/xl.meta
```

### 2.10: (a), (b) y (c) en el control

Salida en la corrida principal de la 2.9 (`r3-main`, arriba), que encadena (c) y (b) sobre el `tar` de esa misma
lectura:

- **(b) = b1, no b2.** Con K2 (`lv-sse:<otro base64 de 32 bytes>`: mismo nombre de clave y formato, contenido
  distinto) sobre la copia restaurada desde el `tar`, MinIO **arranca**; el `GET` de A1 se rechaza sin bytes
  (`HTTP 400 kms:InvalidCiphertextException`) y B1 vuelve idéntico; con K1 sobre **la misma copia**, A1 y B1 vuelven
  idénticos por bytes. La copia monta su propio volumen (`c5copy-<hex>_object-store-data`, en otro proyecto de
  Compose), el original sigue detenido mientras tanto (comprobado con `docker inspect`) y el contenedor de la copia
  lleva K2 y después K1 en `MINIO_KMS_SECRET_KEY` (comprobado con `docker inspect` antes de cada arranque). Design D2
  esperaba b2 (que no arrancara) y admite b1: esta versión de MinIO no sella con la clave del KMS nada que necesite para
  arrancar, y sí la clave de cada objeto. **No es la parada de la 2.10** (que era «ni b1 ni b2»).
- **(c)** la clave, 0/3 formas en el `tar` (textual `lv-sse:…`, su base64 y los 32 bytes decodificados).
- **(a)** con `MINIO_KMS_SECRET_KEY` en el entorno, MinIO usa **esa**: lo demuestran (b) —cambiarla deja A1 ilegible y
  volver a ella lo devuelve— y (c) —no hay otra clave suya en el volumen que la sustituya—.
- **Resultado del control: `nativo`** (disco, (b) b1, (c)). Repetido en la copia con servicio extra: `nativo`, b1.

**Observación de (a), que no decide:** MinIO **sin** la clave, con una copia de `minio.compose.yml` sin la línea de
`MINIO_KMS_SECRET_KEY`, proyecto `os29-nokey` en el puerto `19631` y un volumen **vacío** nuevo
(`os29-nokey_object-store-data`), `up -d --wait` sano (`environment: MINIO_ROOT_PASSWORD, MINIO_ROOT_USER`):

```text
$ pnpm nx run api:object-store -- provision
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
FAIL  cvs: default encryption: NotImplemented (HTTP 501)
ok    cvs: no bucket policy
ok    snapshots: bucket created
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: FAILED (1): cvs: default encryption: NotImplemented (HTTP 501)
exit=1
```

Sin clave, MinIO arranca y rechaza el cifrado por defecto del bucket con `NotImplemented` (501), y `provision` lo
nombra y sale 1: no queda un bucket de CV sin cifrar que parezca aprovisionado. En los composes, el
`${OBJECT_STORE_SSE_KEY:?…}` ya impide arrancar así.

Al terminar: `down -v` de `os29-minio`, `os29-extra` y `os29-nokey`; los proyectos `c5copy-*` los borra `c5.sh`
(`copy project … removed`). `docker ps -a`, `docker volume ls` y `docker network ls` sin `os29` ni `c5copy`: 0, 0 y 0.

## SSE-C y TLS (tareas 2.9b y 3.7b)

Medido el día 2 (design D2, «SSE-C y TLS»), el 2026-09-26, con `@aws-sdk/client-s3` 3.1134.0.

**(iii) El SDK instalado por `http://` envía SSE-C; no lanza.** Test permanente de `api`,
`apps/api/src/infrastructure/storage/s3-sse-c-over-http.spec.ts`, contra el servidor HTTP en proceso de la 2.5 (movido a
`apps/api/src/test-support/fake-store-server.ts`, que ahora registra las cabeceras de cada petición): un `PutObject`
con SSE-C del cliente de la fábrica llega al servidor por `http://127.0.0.1:<puerto>` con las tres cabeceras
`x-amz-server-side-encryption-customer-*` (algoritmo `AES256`, la clave en base64 y su MD5). Falsación: invertir la
afirmación (`expect(thrown).toBeDefined()` y ningún `PUT` recibido), verla caer y restaurar:

```text
$ pnpm nx run api:test --skip-nx-cache -- s3-sse-c-over-http --reporter=verbose      # afirmación invertida
× |api| src/infrastructure/storage/s3-sse-c-over-http.spec.ts > SSE-C over http:// with the installed SDK > sends a PutObject with the three SSE-C headers instead of throwing without sending 37ms
→ expected undefined to be defined
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
Test Files  1 failed (1)
Tests  1 failed (1)
exit=1
$ pnpm nx run api:test --skip-nx-cache -- s3-sse-c-over-http --reporter=verbose      # restaurada
✓ |api| src/infrastructure/storage/s3-sse-c-over-http.spec.ts > SSE-C over http:// with the installed SDK > sends a PutObject with the three SSE-C headers instead of throwing without sending 34ms
Test Files  1 passed (1)
Tests  1 passed (1)
exit=0
```

**La salida SSE-C existe por el lado del SDK**: la 3.8 no se cierra por el SDK; que exista contra un candidato depende
de su servidor.

**(i) Modo SSE-C de la suite de contrato de `api`** (`S3_CONTRACT_C5_SSE_C=1` con `S3_CONTRACT_C5_DIR` y la clave de
prueba en `S3_CV_SSE_C_KEY`, base64 de 32 bytes, que genera `c5.sh --sse-c`): A1 y A2 con SSE-C por el cliente de la
fábrica, y cada respuesta tiene que traer `SSECustomerKeyMD5` igual al MD5 de la clave; si el `PUT` se rechaza, deja
`sse-c-error.json` (lado, código, estado y mensaje). Contra el control por `http://` no pasa del primer `PUT` (salida de
abajo): el eco solo se podrá ver con TLS, en el control positivo de la 3.7b, si la 3.8 llega a ejecutarse.

**(ii) y (iv) `c5.sh --sse-c` contra el control de MinIO por `http://`: `falla: TLS del servidor`** (control negativo
de la clasificación). El rechazo llega en el primer `PUT`, antes de detener nada:

```text
$ C5_WORKDIR=<scratchpad>/r3-ssec bash docs/object-store-matrix/c5.sh --sse-c docs/object-store-matrix/minio.compose.yml object-store-data
c5: mode sse-c, compose docs/object-store-matrix/minio.compose.yml, volume object-store-data, workdir <scratchpad>/r3-ssec
c5: project os29-minio, docker volume os29-minio_object-store-data
container ok: one volume (os29-minio_object-store-data), no writable bind
c5: 1. contract suite, C5 sse-c mode (vitest, output in <scratchpad>/r3-ssec/suite.log)
   × |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 SSE-C mode: writes A1/A2 with SSE-C and requires the SSECustomerKeyMD5 echo, B1/B2 without SSE, and dumps them 36ms
   → Requests specifying Server Side Encryption with Customer provided keys must be made over a secure connection.
   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
   Test Files  1 failed (1)
   Tests  1 failed | 4 skipped (5)
SSE-C: rechazado por el servidor (HTTP 400 InvalidRequest): Requests specifying Server Side Encryption with Customer provided keys must be made over a secure connection.
SSE-C: falla: TLS del servidor
c5: resultado: falla: TLS del servidor (el almacén rechaza SSE-C por http://localhost:19629)
exit=1
$ cat <scratchpad>/r3-ssec/objects/sse-c-error.json
{
  "side": "server",
  "name": "InvalidRequest",
  "code": "InvalidRequest",
  "httpStatus": 400,
  "message": "Requests specifying Server Side Encryption with Customer provided keys must be made over a secure connection."
}
```

`c5.sh --sse-c` clasifica como `falla: TLS del servidor` un rechazo **del servidor** (con respuesta HTTP) cuyo código o
mensaje nombra TLS, SSL, HTTPS o una conexión segura; uno del SDK sin respuesta, como `falla (TLS)` del SDK. Si el
`PUT` pasa, sigue como el modo `server`: lectura del disco con la clave SSE-C de 32 bytes y su base64 como formas de
(c), y (b) sobre el original rearrancado (A1 sin clave y con otra clave, rechazados sin bytes; B1 leído; A1 con la
clave, idéntico); resultado `salida`.
