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

Resuelto en la 7.5b: ver «Configuración entregada», sección 7.5b (con SeaweedFS, además, un `PutObject` crea el
bucket; design D17).

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

### Corrección posterior de `c5.sh`: el log de (b) se guarda después de los `GET` (grupo 4)

**Defecto**, encontrado al cerrar la 3.4: en el modo `server`, `c5.sh` guardaba el log de la copia con K2
(`copy-k2.log`) **antes** de los `GET` de A1 y B1, así que en b1 ese log no podía contener el rechazo de A1 y no
respaldaba lo que la salida decía (y lo mismo el de K1, `copy-k1.log`). La clasificación no dependía de él: b1 se
decide con los `GET`, y el log solo decide en b2, donde no hay `GET`. **Corrección:** con K2 y con K1, el log se guarda
después de los `GET`; en b1, `c5.sh` imprime además, **como información que no decide (b)**, las líneas del log de la
copia con K2 que nombran la clave o el descifrado (`c5-helpers.mjs log-key-error`, que ahora tapa las credenciales y
las claves del entorno antes de imprimir). Las salidas ya pegadas de la 2.9, la 2.10 y la 3.4 **no se reescriben**: se
tomaron con la versión anterior.

**Comprobación, sin repetir la matriz:** una corrida de `c5.sh` sobre el control de MinIO, como en la 2.9, el
2026-09-26, proyecto `os4-minio` en el puerto `19653`, volumen vacío, credenciales y clave nuevas en el scratchpad y
`provision` en 0. Sigue dando `nativo` con b1, y el log de (b) contiene el rechazo:

```text
$ C5_WORKDIR=<scratchpad>/g4/c5-minio-fix bash docs/object-store-matrix/c5.sh docs/object-store-matrix/minio.compose.yml object-store-data
c5: mode server, compose docs/object-store-matrix/minio.compose.yml, volume object-store-data, workdir <scratchpad>/g4/c5-minio-fix
c5: project os4-minio, docker volume os4-minio_object-store-data, key entry MINIO_KMS_SECRET_KEY (from OBJECT_STORE_SSE_KEY)
container ok: one volume (os4-minio_object-store-data), no writable bind
c5: 1. contract suite, C5 server mode (vitest, output in <scratchpad>/g4/c5-minio-fix/suite.log)
   ✓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them 81ms
   Test Files  1 passed (1)
   Tests  1 passed | 4 skipped (5)
   A1 cvs 1048576 bytes, lo que dice el almacén: AES256
   A2 cvs 1024 bytes, lo que dice el almacén: AES256
   B1 snapshots 1048576 bytes, lo que dice el almacén: none reported
   B2 snapshots 1024 bytes, lo que dice el almacén: none reported
c5: 2. docker compose stop object-store
c5:    tar of volume os4-minio_object-store-data with alpine:3
c5: 3. find-plaintext
   find-plaintext: vol.tar, 2152448 bytes leídos
   A1 0/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   A2 0/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   B1 3/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   B2 3/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   clave 0/3  (textual no; contenido no; decodificada (base64, 32 bytes) no)
c5: 4. disk reading
c5:    disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3)
c5:    (c) ok: la clave, 0/3 formas en el volumen (textual; contenido; decodificada (base64, 32 bytes))
c5: (b) copy project c5copy-0660c0: container created with K2 (same format as K1), volume c5copy-0660c0_object-store-data restored from vol.tar
   K2 MINIO_KMS_SECRET_KEY of the container: the expected key
c5: (b) K2 on the copy
c5:    original object-store still stopped: the endpoint reaches the copy
   almacén listo en 0.0 s
c5:    K2: started
   K2 A1: rechazado sin bytes (HTTP 400 kms:InvalidCiphertextException)
   K2 B1: igual por bytes (1048576 bytes, sha256 59d4777820386db0)
   K2 log: object-store-1  | Error: Unable to initialize config, some features may be missing: failed to decrypt ciphertext (*fmt.wrapError)
   K2 log: object-store-1  | Error: IAM sub-system is partially initialized, unable to write the IAM format: failed to decrypt ciphertext (*fmt.wrapError)
   K2 log: object-store-1  | Error: failed to decrypt ciphertext (kms.Error)
c5: (b) K1 on the same copy (the compose's own key: OBJECT_STORE_SSE_KEY as the compose resolves it)
   K1 MINIO_KMS_SECRET_KEY of the container: the expected key
   almacén listo en 0.0 s
c5:    K1: started
   K1 A1: igual por bytes (1048576 bytes, sha256 da0e5d38b4cd3c65)
   K1 B1: igual por bytes (1048576 bytes, sha256 59d4777820386db0)
c5: copy project c5copy-0660c0 removed (container, network and volume)
c5: original object-store started again (up -d --no-deps object-store)
c5: (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos)
c5: (a) with the key in the environment the product uses that key: shown by (b) and (c)
c5: resultado: nativo (disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3); (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos); (c) ok: la clave, 0/3 formas en el volumen (textual; contenido; decodificada (base64, 32 bytes)))
exit=0
```

Las dos primeras líneas del log son del arranque de la copia con K2 (`SYSTEM.config` y `SYSTEM.iam`, 23:46:09Z:
MinIO arranca aunque no pueda descifrar su configuración, que es por lo que sale b1 y no b2). La tercera es **el
rechazo del `GET` de A1**, dos segundos después y con la pila del manejador de `GetObject` (`copy-k2.log`, líneas
34-47, leídas con `node` y con las credenciales tapadas):

```text
object-store-1  | API: SYSTEM.encryption
object-store-1  | Time: 23:46:11 UTC 09/26/2026
object-store-1  | DeploymentID: 5a524015-0bad-4ebb-86e2-c009d2ad6258
object-store-1  | Error: failed to decrypt ciphertext (kms.Error)
object-store-1  |       10: internal/logger/logger.go:271:logger.LogIf()
object-store-1  |        9: cmd/logging.go:152:cmd.encLogIf()
object-store-1  |        8: cmd/encryption-v1.go:1104:cmd.(*ObjectInfo).decryptPartsChecksums()
object-store-1  |        7: cmd/erasure-metadata.go:177:cmd.FileInfo.ToObjectInfo()
object-store-1  |        6: cmd/erasure-object.go:244:cmd.erasureObjects.GetObjectNInfo()
object-store-1  |        5: cmd/erasure-sets.go:735:cmd.(*erasureSets).GetObjectNInfo()
object-store-1  |        4: cmd/erasure-server-pool.go:924:cmd.(*erasureServerPools).GetObjectNInfo()
object-store-1  |        3: cmd/object-handlers.go:405:cmd.objectAPIHandlers.getObjectHandler()
object-store-1  |        2: cmd/object-handlers.go:742:cmd.objectAPIHandlers.GetObjectHandler()
object-store-1  |        1: net/http/server.go:2294:http.HandlerFunc.ServeHTTP()
```

`copy-k1.log` (10 líneas, también tras los `GET`) no tiene ningún error: con K1, A1 y B1 se leen. Al terminar: `down
-v` de `os4-minio`; la copia `c5copy-0660c0` la borró `c5.sh`.

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

**3.7b: no aplica: el puntero tiene C5 `nativo`** (SeaweedFS, tarea 3.4, abajo). La 3.8 no se ejecuta, así que el
control positivo de SSE-C tampoco: `minio-tls.compose.yml` y la opción `--ca` de `c5.sh` no existen.

## Cribado C3-C5, candidato a candidato (grupo 3)

Orden de design D1: SeaweedFS → RustFS → Garage, deteniéndose en el primero que pasa C1-C4 con C5 `nativo`. Corridas
del 2026-09-26 entre 23:22Z y 23:30Z con SeaweedFS 4.47 (`chrislusf/seaweedfs:4.47`, la versión fijada en la 1.2),
proyecto `os3-sw` en el puerto `19640` del host (el `9000` es el MinIO de desarrollo, que no se tocó), credenciales y
`OBJECT_STORE_SSE_KEY` (64 caracteres hexadecimales de 32 bytes aleatorios) generadas en el scratchpad y exportadas con
`COMPOSE_PROJECT_NAME=os3-sw`, `S3_ENDPOINT=http://localhost:19640`, `S3_REGION=us-east-1`, `S3_BUCKET=cvs` y
`S3_SNAPSHOTS_BUCKET=snapshots`. Las salidas de Nx se recortan a lo que imprime la orden.

### 3.1: compose, C3 y C4 de SeaweedFS

**Compose:** `docs/object-store-matrix/seaweedfs.compose.yml`, con la forma de design D1: servicio `object-store`;
credenciales solo por variables (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, desde `S3_ACCESS_KEY`/`S3_SECRET_KEY`,
sin valor por defecto); la KEK de SSE-S3 desde `OBJECT_STORE_SSE_KEY`, mapeada a `WEED_S3_SSE_KEK` (256 bits en
hexadecimal); puerto S3 (`8333`) en `OBJECT_STORE_PORT`; todo el estado en el volumen `object-store-data`, en `/data`,
sin `name:` ni binds, y sin fichero de configuración. Orden: `weed mini -dir=/data` (la de la imagen) con WebDAV, la
interfaz web de administración, Iceberg, Lance y la telemetría apagados. Ningún paso de CLI ni de API de
administración.

```text
$ docker compose -p os3-sw -f docs/object-store-matrix/seaweedfs.compose.yml up -d --wait
 Volume os3-sw_object-store-data Created
 Network os3-sw_default Created
 Container os3-sw-object-store-1 Started
 Container os3-sw-object-store-1 Healthy
exit=0
$ docker compose -p os3-sw -f docs/object-store-matrix/seaweedfs.compose.yml config --format json   # servicio object-store
{"image":"chrislusf/seaweedfs:4.47","command":["mini","-dir=/data","-webdav=false","-admin.ui=false","-s3.port.iceberg=0","-s3.port.lance=0","-master.telemetry=false"],"volumes":[{"type":"volume","source":"object-store-data","target":"/data","volume":{}}],"ports":[{"mode":"ingress","target":8333,"published":"19640","protocol":"tcp"}],"env":["AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","WEED_S3_SSE_KEK"]}
volumes top: {"object-store-data":{"name":"os3-sw_object-store-data"}}
$ docker inspect os3-sw-object-store-1 --format '{{json .Mounts}}'
[{"Type":"volume","Name":"os3-sw_object-store-data","Source":"/var/lib/docker/volumes/os3-sw_object-store-data/_data","Destination":"/data","Driver":"local","Mode":"rw","RW":true,"Propagation":""}]
$ docker diff os3-sw-object-store-1          # lo que el contenedor escribe fuera del volumen: solo sockets
C /tmp
A /tmp/seaweedfs-admin-grpc-33646.sock
A /tmp/seaweedfs-filer-8888.sock
A /tmp/seaweedfs-filer-grpc-18888.sock
A /tmp/seaweedfs-master-grpc-19333.sock
A /tmp/seaweedfs-s3-8333.sock
A /tmp/seaweedfs-s3-grpc-18333.sock
A /tmp/seaweedfs-volume-grpc-19340.sock
$ docker compose -p os3-sw -f docs/object-store-matrix/seaweedfs.compose.yml logs object-store   # líneas de la identidad y la KEK
auth_credentials.go:578 Added admin identity from AWS environment variables: name=admin-<…>, accessKey=<…>
s3_sse_s3.go:529 SSE-S3 KeyManager: Loaded KEK from s3.sse.kek config
```

(La imagen no declara `HEALTHCHECK` y el compose no lleva uno —el de solo lectura es la C8, tarea 4.3—, así que `up
--wait` da por sano el contenedor en marcha; `provision` responde a la primera.)

**C3: pasa.** Credenciales por variables, buckets creados por la API S3 con `object-store provision` (dos veces, las
dos en 0) y cifrado por defecto del bucket de CV aceptado por `PutBucketEncryption`, sin CLI ni API de administración.
Los objetos los ejercita la escritura de la 3.4 (A1, A2, B1 y B2 escritos y leídos de vuelta por la API S3).

```text
$ node docs/object-store-matrix/list-buckets.mjs          # recién arrancado
buckets (0):
exit=0
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
```

**C4: pasa.** `verify` sobre la configuración aprovisionada, recién aprovisionada y otra vez tras la escritura de la
3.4 (con objetos existentes en los dos buckets):

```text
$ pnpm nx run api:object-store -- verify           # recién aprovisionado
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
$ pnpm nx run api:object-store -- verify           # tras la 3.4
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
$ node docs/object-store-matrix/list-buckets.mjs
buckets (2):
cvs
snapshots
exit=0
```

**Arranque sin identidades: `verify` sale ≠0 nombrando el acceso anónimo.** Copia de `seaweedfs.compose.yml` en el
scratchpad sin las dos líneas de identidad (`AWS_ACCESS_KEY_ID: ${S3_ACCESS_KEY:?…}` y `AWS_SECRET_ACCESS_KEY:
${S3_SECRET_KEY:?…}`; `environment` queda con `WEED_S3_SSE_KEK` solo), proyecto `os3-swopen` en el puerto `19642`
(`S3_ENDPOINT=http://localhost:19642`), volumen vacío. SeaweedFS queda en su modo abierto: `provision` pasa con
cualquier firma y `verify` falla en las seis peticiones sin firmar; la sonda de escritura aceptada se borra con firma:

```text
$ pnpm nx run api:object-store -- provision
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
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
FAIL  cvs: anonymous GET of a missing object: HTTP 404 NoSuchKey: the store let the anonymous request look for it
FAIL  cvs: anonymous listing: access granted (HTTP 200)
FAIL  cvs: anonymous PUT: access granted (HTTP 200)
note  cvs: the anonymous probe object .verify-probe/1e3adb94-1d6d-48f5-bb55-9257668e0ba0 was deleted with a signed request
FAIL  snapshots: anonymous GET of a missing object: HTTP 404 NoSuchKey: the store let the anonymous request look for it
FAIL  snapshots: anonymous listing: access granted (HTTP 200)
FAIL  snapshots: anonymous PUT: access granted (HTTP 200)
note  snapshots: the anonymous probe object .verify-probe/dbca9b65-b3cd-4ae2-a8bc-c21773577ecc was deleted with a signed request
verify: FAILED (6): cvs: anonymous GET of a missing object: HTTP 404 NoSuchKey: the store let the anonymous request look for it; cvs: anonymous listing: access granted (HTTP 200); cvs: anonymous PUT: access granted (HTTP 200); snapshots: anonymous GET of a missing object: HTTP 404 NoSuchKey: the store let the anonymous request look for it; snapshots: anonymous listing: access granted (HTTP 200); snapshots: anonymous PUT: access granted (HTTP 200)
exit=1
$ docker compose -p os3-swopen -f <scratchpad>/variants/seaweedfs.open.compose.yml down -v
exit=0
```

Con la identidad por entorno, SeaweedFS sale de su modo abierto (C4 de arriba); sin ella, `verify` lo detecta. El
defecto no es de `verify`.

**Observación fuera de C4, que no decide la celda (para la 4.1 y la 5.3).** C4 juzga la pasarela S3. `weed mini`
arranca además el filer, cuyo HTTP (`8888`, sin publicar) sirve los objetos **sin autenticación** a cualquier
contenedor de la red del compose. Medido desde un contenedor `alpine` en la red `os3-sw_default`, tras la 3.4:

```text
$ docker run --rm --network os3-sw_default alpine:3 sh -c 'wget -q -O /tmp/o http://object-store:8888/buckets/<bucket>/<clave> …'
/buckets/cvs/757639ab08ccf9d5d450f084/8a42c4ae3c50d665b21ecbde HTTP 200, 1048576 bytes, sha256 7b8788b59514fb9d
/buckets/snapshots/c5-1a0e0086a17-5b75485e/B1.bin HTTP 200, 1048576 bytes, sha256 5906bdd4b314d887
```

A1 (`sha256 705b97ab82d72b5d` escrito) vuelve **cifrado** (otro hash: el filer entrega los bytes del volumen, que la
3.4 muestra cifrados); B1 (`sha256 5906bdd4b314d887`) vuelve **idéntico**. El log del filer dice además `Registered IAM
gRPC service on filer (unauthenticated; set jwt.filer_signing.key in security.toml to require admin Bearer token)`. Ni
design D1 ni D6 dicen qué hacer con los puertos internos sin autenticación de un candidato: no se decide aquí.

### 3.4: C5 de SeaweedFS

**`nativo`, con (b) = b1.** `provision` puso el cifrado por defecto de `cvs` por la API S3 (3.1), así que C5 no se
corta en «no disponible» y `c5.sh` corre entero:

```text
$ C5_WORKDIR=<scratchpad>/g3/c5-sw bash docs/object-store-matrix/c5.sh docs/object-store-matrix/seaweedfs.compose.yml object-store-data
c5: mode server, compose docs/object-store-matrix/seaweedfs.compose.yml, volume object-store-data, workdir <scratchpad>/g3/c5-sw
c5: project os3-sw, docker volume os3-sw_object-store-data, key entry WEED_S3_SSE_KEK (from OBJECT_STORE_SSE_KEY)
container ok: one volume (os3-sw_object-store-data), no writable bind
c5: 1. contract suite, C5 server mode (vitest, output in <scratchpad>/g3/c5-sw/suite.log)
   ✓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them 522ms
   Test Files  1 passed (1)
   Tests  1 passed | 4 skipped (5)
   A1 cvs 1048576 bytes, lo que dice el almacén: AES256
   A2 cvs 1024 bytes, lo que dice el almacén: AES256
   B1 snapshots 1048576 bytes, lo que dice el almacén: none reported
   B2 snapshots 1024 bytes, lo que dice el almacén: none reported
c5: 2. docker compose stop object-store
c5:    tar of volume os3-sw_object-store-data with alpine:3
c5: 3. find-plaintext
   find-plaintext: vol.tar, 2318336 bytes leídos
   A1 0/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   A2 0/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   B1 3/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   B2 3/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   clave 0/3  (textual no; decodificada (hex, 32 bytes) no; decodificada (base64, 48 bytes) no)
c5: 4. disk reading
c5:    disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3)
c5:    (c) ok: la clave, 0/3 formas en el volumen (textual; decodificada (hex, 32 bytes); decodificada (base64, 48 bytes))
c5: (b) copy project c5copy-2be6b8: container created with K2 (same format as K1), volume c5copy-2be6b8_object-store-data restored from vol.tar
   K2 WEED_S3_SSE_KEK of the container: the expected key
c5: (b) K2 on the copy
c5:    original object-store still stopped: the endpoint reaches the copy
   almacén listo en 0.0 s
c5:    K2: started
   K2 A1: rechazado sin bytes (HTTP 500 InternalError)
   K2 B1: igual por bytes (1048576 bytes, sha256 5906bdd4b314d887)
c5: (b) K1 on the same copy (the compose's own key: OBJECT_STORE_SSE_KEY as the compose resolves it)
   K1 WEED_S3_SSE_KEK of the container: the expected key
   almacén listo en 0.0 s
c5:    K1: started
   K1 A1: igual por bytes (1048576 bytes, sha256 705b97ab82d72b5d)
   K1 B1: igual por bytes (1048576 bytes, sha256 5906bdd4b314d887)
c5: copy project c5copy-2be6b8 removed (container, network and volume)
c5: original object-store started again (up -d --no-deps object-store)
c5: (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos)
c5: (a) with the key in the environment the product uses that key: shown by (b) and (c)
c5: resultado: nativo (disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3); (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos); (c) ok: la clave, 0/3 formas en el volumen (textual; decodificada (hex, 32 bytes); decodificada (base64, 48 bytes)))
exit=0
```

- **Disco:** A1 y A2 0/3, B1 y B2 3/3: el control aparece entero, así que la lectura vale para SeaweedFS de un nodo.
  En el `tar`, los objetos de cada bucket van a su propio fichero de volumen (`cvs_2.dat`, 1049720 bytes;
  `snapshots_3.dat`, 1049704 bytes: el de 1 MiB y el de 1 KiB juntos) y los metadatos, a `filerldb2/`.
- **(b) = b1.** Con K2 (64 hexadecimales, mismo formato) sobre la copia restaurada desde el `tar`, SeaweedFS arranca,
  el `GET` de A1 se rechaza sin bytes (`HTTP 500 InternalError`) y B1 vuelve idéntico; con K1 sobre **la misma
  copia**, A1 y B1 vuelven idénticos. La copia lleva K2 y después K1 en `WEED_S3_SSE_KEK` (comprobado con `docker
  inspect`) y el original sigue detenido mientras tanto.
- **(c)** la clave, 0/3 formas (textual; los 32 bytes; y su lectura como base64, 48 bytes).
- **(a)** con `WEED_S3_SSE_KEK` en el entorno, SeaweedFS usa **esa**: lo demuestran (b) y (c). En el volumen hay un
  `.mini_kek_passphrase` de 64 bytes que `weed mini` crea al arrancar; la copia de (b) lo lleva, y aun así con K2 A1
  no se lee: no es la clave que protege el CV.

**Observación de (a), que no decide:** SeaweedFS **sin** la clave, con una copia de `seaweedfs.compose.yml` sin la
línea de `WEED_S3_SSE_KEK`, proyecto `os3-swnokey` en el puerto `19643` y un volumen **vacío** nuevo
(`os3-swnokey_object-store-data`), `up -d --wait` sano (`environment keys: [ 'AWS_ACCESS_KEY_ID',
'AWS_SECRET_ACCESS_KEY' ]`):

```text
$ pnpm nx run api:object-store -- provision
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0
$ docker compose -p os3-swnokey … logs object-store       # sin WEED_S3_SSE_KEK en el entorno del contenedor
s3_sse_s3.go:529 SSE-S3 KeyManager: Loaded KEK from s3.sse.kek config
$ node <PUT de 1 MiB a cvs sin cabeceras SSE; GET; restart del contenedor; GET>
PUT cvs/nokey/A1.bin: ok, lo que dice el almacén: AES256, sha256 b292b1e439506fbb
GET cvs/nokey/A1.bin: igual por bytes, lo que dice el almacén: AES256, sha256 b292b1e439506fbb
GET cvs/nokey/A1.bin: igual por bytes, lo que dice el almacén: AES256, sha256 b292b1e439506fbb     # tras el restart
$ tar tvf <tar del volumen os3-swnokey_object-store-data> y búsqueda con node
-rw------- 1000/1000        64 2026-09-26 19:24 ./.mini_sse_kek
-rw------- 1000/1000        64 2026-09-26 19:24 ./.mini_kek_passphrase
nokey A1 en el volumen: 0/3
```

Sin clave, `weed mini` **genera una KEK y la guarda en el propio volumen** (`/data/.mini_sse_kek`), acepta el cifrado
por defecto y cifra con ella: el disco no tiene el texto en claro, pero la clave vive junto a los datos y `provision`
sale 0, así que desde fuera no se distingue de la configuración medida. Es el caso que (c) existe para detectar. En el
volumen medido, con la clave en el entorno, no hay `.mini_sse_kek` (listado del `tar` de la 3.4). En los composes lo
impide el `${OBJECT_STORE_SSE_KEY:?…}` (design D6); prelectura.md decía «no la autogenera», y en `weed mini` 4.47 sí
lo hace.

**C3-C4 en verde y C5 `nativo`: el puntero queda fijado en SeaweedFS** (design D1). El cribado se detiene aquí.

### 3.2, 3.3, 3.5 y 3.6: RustFS y Garage

**No ejecutado: puntero fijado en SeaweedFS.** Los dos pasaron C1 y C2 (1.4), pero van detrás de SeaweedFS en la
lista, que pasa C1-C4 con C5 `nativo`: ninguno puede adelantarlo. `rustfs.compose.yml` y `garage.compose.yml` no se
escriben. Si SeaweedFS cae en la 4.2 o la 4.3, el cribado se reanuda con RustFS (3.2 y 3.5) y estas celdas se
sustituyen por su resultado.

### 3.8: SSE-C

**No aplica: el puntero tiene C5 `nativo`** (SeaweedFS, 3.4). La 3.8 solo se ejecuta cuando el puntero llega a un
candidato sin C5 `nativo`.

### 3.7: tabla C1-C5 y puntero

| Candidato | C1 | C2 | C3 | C4 | C5 |
|---|---|---|---|---|---|
| SeaweedFS 4.47 | pasa (1.4) | pasa (1.4) | pasa (3.1) | pasa (3.1) | nativo (3.4: disco, (b) b1, (c)) |
| RustFS 1.0.0 | pasa (1.4) | pasa (1.4) | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS |
| Garage v2.4.1 | pasa (1.4) | pasa (1.4) | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS |

**Puntero: SeaweedFS.** Entre los que pasan C1-C4 (solo SeaweedFS entre los cribados), primero los de C5 `nativo`
(SeaweedFS) y después el orden de la lista. La parada de la 3.7 («ninguno pasa C1-C4») no se cumple. Siguen C7-C9 en
SeaweedFS (4.2-4.4), y la 4.1 informa sin bloquear porque un candidato da C5 `nativo`.

Comprobación de un solo uso (`node <scratchpad>/g3/check-37.js [matriz]`: lee la tabla de esta sección; exige en cada
celda un resultado, «no ejecutado: puntero fijado en <candidato>» o «no aplica: …»; recalcula el puntero de D1 con
las celdas ejecutadas y lo compara con el escrito; y exige «no ejecutado» exactamente en C3-C5 de los que van detrás
del fijado con C5 `nativo`):

```text
$ node <scratchpad>/g3/check-37.js
SeaweedFS pasa | pasa | pasa | pasa | nativo
RustFS    pasa | pasa | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS
Garage    pasa | pasa | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS
puntero escrito: SeaweedFS | puntero de D1: SeaweedFS
3.7: ok
exit=0
$ node <scratchpad>/g3/check-37.js <copia con «**Puntero: RustFS.**»>
FALLA:
puntero escrito RustFS, D1 da SeaweedFS
exit=1
$ node <scratchpad>/g3/check-37.js <copia con la C3 de RustFS en «pendiente»>
FALLA:
RustFS C3: «pendiente» sin resultado ni anotación
RustFS C3: «no ejecutado» falta
exit=1
$ node <scratchpad>/g3/check-37.js <copia con la C5 de SeaweedFS en «no disponible»>
FALLA:
RustFS C3: «no ejecutado» sobra
RustFS C4: «no ejecutado» sobra
RustFS C5: «no ejecutado» sobra
Garage C3: «no ejecutado» sobra
Garage C4: «no ejecutado» sobra
Garage C5: «no ejecutado» sobra
exit=1
```

Al terminar el grupo: `down -v` de `os3-sw`, `os3-swopen` y `os3-swnokey`; los proyectos `c5copy-*` los borra `c5.sh`
(`copy project … removed`). `docker ps -a`, `docker volume ls` y `docker network ls` sin `os3` ni `c5copy`: 0, 0 y 0.

## Punto de revisión (tarea 4.1)

**Fecha de presentación: 2026-09-26.** Se presenta al quedar **fijado el puntero** (3.7, el mismo 2026-09-26), antes de
los 7 días naturales desde la 2.1 (design D1, «Punto de revisión»). **No bloquea:** un candidato da C5 `nativo`; se
informa y se sigue con 4.2-4.4 sin esperar respuesta.

1. **Quién da C5 `nativo` entre los cribados.** **SeaweedFS 4.47**: C5 `nativo` (3.4: disco A1 y A2 0/3, B1 y B2 3/3;
   (b) = b1; (c) la clave 0/3 formas), con C1-C4 en verde. **RustFS 1.0.0** y **Garage v2.4.1**: C3-C5 «no ejecutado:
   puntero fijado en SeaweedFS» (3.2, 3.3, 3.5 y 3.6); no se sabe si darían `nativo`, porque la regla de D1 detiene el
   cribado en el primero que lo da. **Ningún candidato quedó en `falla (TLS)`**: la 3.8 (SSE-C) no se ejecutó («no
   aplica: el puntero tiene C5 `nativo`»), así que no hay coste de TLS interno que presentar.
2. **Qué costaría SSE-C si hiciera falta** (solo si SeaweedFS cayera en C7-C8 y el cribado llegara a un candidato sin
   C5 `nativo`; hoy no aplica):
   - **Tareas 8.1-8.4:** `S3_CV_SSE_C_KEY` obligatoria en los esquemas de `api` y `worker` (error de zod que no repite el
     valor) y declarada en `docker-compose.prod.yml`, `infra/ci/verify.env` y `.env.example` (8.1); el middleware SSE-C
     en la fábrica de `api` con un test por comando y uno de registros (8.2); lo mismo en la de `worker`, con el test de
     `s3-probe` y el test de inventario permanente de `new S3Client(` (8.3); y la demostración sobre la configuración
     entregada, `c5.sh --sse-c docker-compose.yml`, que tiene que salir `salida` (8.4). Además, antes, el control
     positivo con TLS (3.7b) y la 3.8 en el candidato.
   - **La clave a custodiar:** `S3_CV_SSE_C_KEY` (base64 de 32 bytes), junto a `AI_VAULT_KEY` en el fichero de entorno
     del host y en `infra/README.md`: **perderla es perder los CV**, porque el almacén no la guarda (design D7). Con el
     modo nativo también hay una clave que custodiar, `OBJECT_STORE_SSE_KEY` (la KEK de SeaweedFS), con la misma
     consecuencia si se pierde (3.4 (b): con otra clave, A1 no se lee).
   - **Si la salida existe (2.9b):** por el lado del SDK, **sí**: `@aws-sdk/client-s3` 3.1134.0 **envía** SSE-C por
     `http://` con las tres cabeceras, sin lanzar (2.9b (iii), test permanente `s3-sse-c-over-http.spec.ts`). Por el
     lado del servidor depende de cada candidato: el control de MinIO la **rechaza sin TLS** (`HTTP 400
     InvalidRequest`, «…must be made over a secure connection.», 2.9b (iv)), y en ningún candidato se ha medido.
3. **Fecha estimada de cierre** (tabla de design D1, «Peor caso en cifras», fila «Caso probable»: SeaweedFS con C5
   `nativo`, la 4.1 informa sin bloquear y C7-C9 solo en él): **veredicto el día 4 y cierre en unos 10-11 días
   naturales desde la 1.1**. Con la 1.1 el 2026-09-26 (día 1), **cierre hacia el 2026-10-05 o el 2026-10-06**, sin
   contar la espera de la ventana de fusión (13.4). Los grupos 1-4 han ido por delante de la tabla (todos el día 1); la
   estimación no se recorta por eso. Sigue pendiente de decisión del usuario cómo medir los minutos del corredor `arm64`
   (1.2, «Minutos: no concluyente»), que afecta a D11 y a la 9.4.

### Preguntas abiertas al usuario (no deciden ninguna celda)

Hallazgos del grupo 3 que ni design D1 ni D6 resuelven. No cambian C3, C4 ni C5 de SeaweedFS (C4 juzga la pasarela S3;
C5 ya salió `nativo`) ni el puntero; se presentan para que el usuario decida si hace falta algo más.

**(i) Puertos internos de `weed mini` sin autenticación.** Dentro de la red del compose, el filer (`8888`, no
publicado) sirve los objetos **sin autenticación** (3.1: A1 vuelve cifrado, B1 idéntico) y registra `Registered IAM
gRPC service on filer (unauthenticated; set jwt.filer_signing.key in security.toml to require admin Bearer token)`. En
producción, la red del almacén es solo `internal` (D6), donde están `api` y `worker`. **Pregunta:** ¿se acepta así, o
se quiere cerrar? Cerrarlo sería **otra configuración** del servicio `object-store`, que exigiría repetir sobre ella
C3-C5 y C7-C9 antes de adoptarla.

**Medición, como dato para esa decisión (no adoptada: `seaweedfs.compose.yml` no la lleva).** ¿Tiene `weed mini` una
opción para que solo el filer (y su gRPC) escuchen en loopback dentro del contenedor? Leído de `weed mini -h` en 4.47
(el volcado de la 3.1, `mini-help.txt` del scratchpad): **no hay opción de enlace por componente** (no existe
`-filer.ip.bind`; los `-filer.*` son puertos, límites y comportamiento); solo la **global** `-ip.bind`:

```text
  -ip string
    	ip or server name, also used as identifier (default "172.17.0.2")
  -ip.bind string
    	ip address to bind to. If empty, default to same as -ip option. (default "0.0.0.0")
  -disableHttp
    	disable http requests, only gRPC operations are allowed.
```

Medido el 2026-09-26 con **copias** de `seaweedfs.compose.yml` en el scratchpad (proyecto `os4-swbind`, puerto
`19651`, volumen vacío, credenciales y KEK de prueba), que solo añaden una opción a `command`; el listado de puertos
con `netstat -tln` dentro del contenedor y las peticiones desde un contenedor `alpine:3` en la red del proyecto:

```text
# Base (seaweedfs.compose.yml tal cual, proyecto os4-sw): todo escucha en todas las interfaces
$ docker exec os4-sw-object-store-1 netstat -tln
:::23646 :::19333 :::19340 :::18888 :::8888 :::33646 :::8333 :::18333 :::9333 :::9340
$ docker run --rm --network os4-sw_default alpine:3 sh -c 'wget -q -T 5 -O /dev/null http://object-store:<puerto>/ …'
8888: HTTP 2xx
18888: wget: error getting response: Connection reset by peer        # conecta (gRPC no habla HTTP/1.1)
8333: wget: server returned error: HTTP/1.1 403 Forbidden

# Copia con '-ip.bind=127.0.0.1': todo pasa a loopback, también la pasarela S3
$ docker exec os4-swbind-object-store-1 netstat -tln
127.0.0.1:19333 127.0.0.1:19340 127.0.0.1:18888 127.0.0.1:18333 127.0.0.1:9333 127.0.0.1:9340 127.0.0.1:8888 127.0.0.1:8333 127.0.0.1:23646 :::33646
$ pnpm nx run api:object-store -- provision          # desde el host, por el puerto publicado 19651
FAIL  cvs: create bucket: TimeoutError
FAIL  snapshots: create bucket: TimeoutError
provision: FAILED (2): cvs: create bucket: TimeoutError; snapshots: create bucket: TimeoutError
exit=1
$ docker run --rm --network os4-swbind_default alpine:3 sh -c '…'
8888: wget: can't connect to remote host (172.28.0.2): Connection refused
18888: wget: can't connect to remote host (172.28.0.2): Connection refused
8333: wget: can't connect to remote host (172.28.0.2): Connection refused
9333: wget: can't connect to remote host (172.28.0.2): Connection refused
33646: wget: error getting response: Connection reset by peer        # el gRPC del servidor de administración sigue abierto
$ docker exec os4-swbind-object-store-1 sh -c 'wget … http://127.0.0.1:8333/; wget … http://127.0.0.1:8888/'
  HTTP/1.1 403 Forbidden                                             # la pasarela, solo desde dentro
filer-loopback-ok
```

**Con `-ip.bind=127.0.0.1` el filer deja de ser alcanzable desde la red, pero la pasarela S3 también**: `provision`
sale 1 por tiempo y ningún otro contenedor llega al `8333`. **No cumple** lo pedido (filer en loopback y pasarela
sirviendo); `verify` no se ejecutó. No hay en 4.47 una opción de `weed mini` que lo consiga.

Dato adicional, que **no** es de loopback: la copia con `-disableHttp` (mismo proyecto, volumen vacío nuevo) deja la
pasarela funcionando y el filer sin servir objetos por HTTP, pero **sigue escuchando todo** en todas las interfaces,
incluido el gRPC del filer:

```text
$ docker exec os4-swbind-object-store-1 netstat -tln
:::18888 :::19333 :::19340 :::9333 :::9340 :::18333 :::8333 :::33646 :::8888 :::23646
$ pnpm nx run api:object-store -- provision   →  provision: ok, exit=0
$ pnpm nx run api:object-store -- verify      →  verify: ok, exit=0 (las seis peticiones sin firmar, 403 AccessDenied)
$ node <PUT firmado de 64 KiB a cada bucket y GET de vuelta>
cvs/probe/e05a7e2c.bin PUT ok, GET igual por bytes, sha256 271eb1db570dabef
snapshots/probe/b8561dc5.bin PUT ok, GET igual por bytes, sha256 ecb4d41df2b41c25
$ docker run --rm --network os4-swbind_default alpine:3 sh -c '…'
/buckets/cvs/probe/e05a7e2c.bin: wget: server returned error: HTTP/1.1 404 Not Found
/buckets/snapshots/probe/b8561dc5.bin: wget: server returned error: HTTP/1.1 404 Not Found
/buckets/: wget: server returned error: HTTP/1.1 404 Not Found
POST /buckets/snapshots/probe/anon.bin: wget: server returned error: HTTP/1.1 404 Not Found
18888: wget: error getting response: Connection reset by peer        # el gRPC del filer sigue aceptando conexiones
9333: HTTP 2xx                                                       # el HTTP del maestro sigue respondiendo
9340: wget: server returned error: HTTP/1.1 400 Bad Request          # el HTTP del volumen sigue respondiendo
```

No medido: si el gRPC del filer, el HTTP del maestro o el del volumen (por identificador de fichero) entregan o aceptan
datos sin autenticación con `-disableHttp`, ni la vía de `security.toml` con JWT que nombra el propio log (sería un
fichero de configuración con un secreto, que la forma de D1 y C3 no admiten montado).

**(ii) Sin clave, `weed mini` autogenera una KEK en el volumen.** Sin `WEED_S3_SSE_KEK`, sobre un volumen vacío,
`weed mini` 4.47 genera una KEK, la guarda en `/data/.mini_sse_kek` y cifra con ella; `provision` sale 0, así que desde
fuera no se distingue de la configuración medida, pero la clave vive junto a los datos (3.4, «Observación de (a)»;
`prelectura.md` decía lo contrario). Lo impide el `${OBJECT_STORE_SSE_KEY:?…}` de los composes (D6): sin la variable,
Compose no arranca el servicio. **Pregunta:** ¿basta con esa guarda del compose, o se quiere que algo más lo detecte
(p. ej., que la verificación del artefacto o el despliegue lo compruebe)? Cualquier comprobación nueva sería un guardia
permanente que habría que ver caer (ADR-048 §7), fuera de lo que hoy piden las tareas.

**Respondidas por el usuario el 2026-09-27** (ADR-052, «Decisiones del usuario tras el punto de revisión»): (i) el
almacén se aísla en una red de Docker propia con solo `object-store`, `api` y `worker` (design D14; tareas 7.1, 7.3 y
7.3b); (ii) se resuelve y se documenta: el servicio se niega a arrancar sin una clave de 64 hexadecimales o sobre un
volumen con `.mini_sse_kek` (design D16; tareas 7.1b, 12.1 y 12.2). Ninguna de las dos cambia la configuración medida
de `weed mini`.

Verificación de la sección, con un `node -e` de un solo uso: ver «Comprobación de la 4.1», al final del grupo 4.

## Celdas del candidato señalado: SeaweedFS (grupo 4)

Corridas del 2026-09-26 con SeaweedFS 4.47 (`chrislusf/seaweedfs:4.47`), `docs/object-store-matrix/seaweedfs.compose.yml`
**con el healthcheck de la 4.3**, proyecto `os4-sw` en el puerto `19650` del host (el `9000` es el MinIO de
desarrollo, que no se tocó), credenciales y `OBJECT_STORE_SSE_KEY` nuevas generadas en el scratchpad y exportadas con
`COMPOSE_PROJECT_NAME=os4-sw`, `S3_ENDPOINT=http://localhost:19650`, `S3_REGION=us-east-1`, `S3_BUCKET=cvs` y
`S3_SNAPSHOTS_BUCKET=snapshots`. El orden de ejecución fue C8 (sobre el almacén recién arrancado y sin aprovisionar),
C7 sobre ese mismo almacén ya aprovisionado, y C9. Las salidas de Nx se recortan a lo que imprime la orden.

### 4.3: C8, healthcheck de solo lectura: pasa

**Endpoint de salud real en 4.47.** La imagen es Alpine con `curl` y `wget` (busybox) y no declara `HEALTHCHECK`
(`docker image inspect … {{json .Config.Healthcheck}}` → `null`). La issue #8243 de SeaweedFS («Health check for S3
service not working», `curl -I …/healthz` → `404` en 4.09, porque la pasarela tomaba `healthz` por un bucket) está
cerrada el 2026-02-09 (`gh api repos/seaweedfs/seaweedfs/issues/8243`). En 4.47, dentro del contenedor recién arrancado
y sin aprovisionar:

```text
$ docker exec os4-sw-object-store-1 sh -c 'for p in /healthz /status /readyz /health; do curl … http://127.0.0.1:8333$p; curl -I …; done'      # salida resumida: código y bytes del GET, código del HEAD
== GET /healthz   200 0B        == HEAD /healthz   200
== GET /status    200 0B        == HEAD /status    200
== GET /readyz    200 0B        == HEAD /readyz    200
== GET /health    403 218B (<Code>AccessDenied</Code> … <BucketName>health</BucketName>)   == HEAD /health   403
```

`/healthz`, `/status` y `/readyz` responden `200` sin credenciales ni cuerpo; `/health` la pasarela lo toma por un
bucket y lo rechaza. Se elige **`/healthz`** en forma `CMD`, sin shell, con `curl -f` (sale ≠0 ante cualquier respuesta
≥ 400), y va al compose de la matriz:

```yaml
    healthcheck:
      test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', '--max-time', '3', 'http://127.0.0.1:8333/healthz']
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 60s
      start_interval: 1s
```

Los parámetros son los de la medición de C9 (`start_interval: 1s` da la resolución de un segundo); los de la pila
salen de C9 y de la medición en `arm64` (design D5 y D8).

**C8**, sobre el almacén recién arrancado (`down -v` y `up -d --wait` con el healthcheck: `Container
os4-sw-object-store-1 Healthy`) y **sin aprovisionar**:

```text
$ node docs/object-store-matrix/list-buckets.mjs          # antes
buckets (0):
exit=0
$ docker exec os4-sw-object-store-1 curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:8333/healthz      # x10, la orden del healthcheck
run 1: exit=0
run 2: exit=0
run 3: exit=0
run 4: exit=0
run 5: exit=0
run 6: exit=0
run 7: exit=0
run 8: exit=0
run 9: exit=0
run 10: exit=0
$ docker exec os4-sw-object-store-1 curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:18399/healthz      # puerto sin servicio
curl: (7) Failed to connect to 127.0.0.1:18399 after 0 ms: Could not connect to server
exit=7
$ docker exec os4-sw-object-store-1 netstat -tln      # 18399 sin servicio
11 puertos en LISTEN; 18399: no
$ node docs/object-store-matrix/list-buckets.mjs          # después
buckets (0):
exit=0
$ docker inspect os4-sw-object-store-1 --format '{{json .State.Health}}'      # los sondeos del propio healthcheck
Status healthy, FailingStreak 0
23:41:50.459 exit=0 output=""
23:42:00.486 exit=0 output=""
$ docker exec os4-sw-object-store-1 curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:8333/health      # ruta que la pasarela toma por bucket: 403
curl: (22) The requested URL returned error: 403
exit=22
```

Sale 0 con el almacén sirviendo, ≠0 (7) contra un puerto sin servicio y ≠0 (22) ante un rechazo; tras diez
ejecuciones (y los sondeos del propio healthcheck), la lista de buckets sigue **vacía**. **C8: pasa.**

### 4.2: C7, tests reales de la app: pasa con la política por defecto

SDK instalado y aprovisionamiento del almacén de la 4.3:

```text
$ node -e "console.log(require('@aws-sdk/client-s3/package.json').version)"
3.1134.0
$ pnpm nx run api:object-store -- provision
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0
```

Suites de contrato de la 2.7 y la 2.8 con la **política de checksums por defecto** (`S3_CONTRACT_CHECKSUM` sin
definir, ni en la shell ni en `.env`; el primer test de `api` comprueba que la política es `when_supported`):

```text
$ S3_CONTRACT=1 pnpm nx run api:test --skip-nx-cache -- s3.s3-contract --reporter=verbose
 ✓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > runs with the checksum policy it was asked for 1ms
 ✓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > uploads a CV with the real adapter and the same bytes come back 247ms
 ✓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > deletes a prefix of 1001 keys in two DeleteObjects batches and leaves it empty 1206ms
 ↓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them
 ↓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 SSE-C mode: writes A1/A2 with SSE-C and requires the SSECustomerKeyMD5 echo, B1/B2 without SSE, and dumps them
 Test Files  1 passed (1)
      Tests  3 passed | 2 skipped (5)
exit=0
$ S3_CONTRACT=1 pnpm nx run worker:test --skip-nx-cache -- s3.s3-contract --reporter=verbose
 ✓ |worker| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of worker (real store) > reads the bytes that were written 37ms
 ✓ |worker| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of worker (real store) > deletes, and deleting again is still a success 16ms
 WARN [S3CvFileReader] CV file not read: Error
 ✓ |worker| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of worker (real store) > tells a missing object (null) apart from a store that is down (error) 114ms
 ✓ |worker| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of worker (real store) > stores a gzipped snapshot in the snapshots bucket 214ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
exit=0
```

(Los dos modos C5 de `api` los salta la suite sin `S3_CONTRACT_C5_DIR`: el modo `server` ya se ejecutó en la 3.4 y el
SSE-C no aplica. El `WARN` es el del caso «almacén caído», que apunta a un puerto sin servicio a propósito.)

Las peticiones llegaron a SeaweedFS y no al MinIO de desarrollo: su log (`docker logs os4-sw-object-store-1`, filtrado
por el manejador de borrado) registra los borrados de las suites en esos minutos, y `verify` después las encuentra
limpias:

```text
I0926 23:42:44.294728 s3api_object_handlers_delete.go:209 DeleteObjectHandler cvs 999a14e37cffd34adeb0e9df/3b513a53d2e132f8ebe90076
I0926 23:42:51.149213 s3api_object_handlers_delete.go:209 DeleteObjectHandler cvs 74a00572aaf776f0cc3d9344/09b7c828430f7ec6ac2612fd
I0926 23:42:51.159889 s3api_object_handlers_delete.go:209 DeleteObjectHandler cvs ca9d1351f8603adfbd7c3fd6/f7875b91d4c8af03b6c912fb
I0926 23:42:51.166243 s3api_object_handlers_delete.go:209 DeleteObjectHandler cvs ca9d1351f8603adfbd7c3fd6/f7875b91d4c8af03b6c912fb
I0926 23:42:51.495094 s3api_object_handlers_delete.go:209 DeleteObjectHandler snapshots b94459f45a629197b1f1f21f/1.html.gz
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

**C7: pasa, con la política de checksums por defecto (`when_supported`)**, incluido el borrado por prefijo de 1001
claves en dos lotes de `DeleteObjects` con el prefijo vacío al final. No hizo falta `WHEN_REQUIRED`.

### 4.4: C9, tiempo hasta sano

Tres arranques en frío (`down -v` entre ellos) con el healthcheck de la 4.3; tiempo hasta `healthy` = fin del primer
sondeo con salida 0 de `.State.Health.Log` menos `.State.StartedAt`, leídos de `docker inspect` con `node`
(`<scratchpad>/g4/c9-read.cjs`), justo después de `up -d --wait`, y un `list-buckets.mjs` en cuanto queda sano:

```text
run 1: down -v exit=0 (0 volúmenes os4-sw)
run 1: up -d --wait exit=0, reloj 2.3 s
run 1: Status healthy; StartedAt 2026-09-26T23:44:06.225921416Z; primer sondeo con 0: 2026-09-26T23:44:07.418598152Z; sondeos fallidos antes: 0; tiempo hasta healthy: 1.19 s
run 1: list-buckets tras healthy: buckets (0):
run 2: down -v exit=0 (0 volúmenes os4-sw)
run 2: up -d --wait exit=0, reloj 2.3 s
run 2: Status healthy; StartedAt 2026-09-26T23:44:12.615292897Z; primer sondeo con 0: 2026-09-26T23:44:13.785721627Z; sondeos fallidos antes: 0; tiempo hasta healthy: 1.17 s
run 2: list-buckets tras healthy: buckets (0):
run 3: down -v exit=0 (0 volúmenes os4-sw)
run 3: up -d --wait exit=0, reloj 2.3 s
run 3: Status healthy; StartedAt 2026-09-26T23:44:18.800807065Z; primer sondeo con 0: 2026-09-26T23:44:19.973502057Z; sondeos fallidos antes: 0; tiempo hasta healthy: 1.17 s
run 3: list-buckets tras healthy: buckets (0):
```

**C9 (local, `amd64`): 1,19 s, 1,17 s y 1,17 s; peor, 1,19 s.** En los tres, el **primer** sondeo (a 1 s del arranque,
`start_interval`) ya sale 0: el tiempo real es como mucho ese, y la medición no puede bajar de la resolución del
sondeo. Informa D8, no aprueba ni suspende: la ventana de la matriz (`start_period` 60 s + 6 × 10 s = 120 s) es mucho
más de tres veces el peor; la de la pila se fija con este dato y las tres corridas en el corredor `arm64`.

Al terminar el grupo: `down -v` de `os4-sw` y `os4-swbind` (las dos variantes de la 4.1) y de `os4-minio` (la
corrección de `c5.sh`, en «Control MinIO»); los `c5copy-*` los borró `c5.sh`. `docker ps -a`, `docker volume ls` y
`docker network ls` sin `os4` ni `c5copy`: 0, 0 y 0.

### Comprobación de la 4.1

`node <scratchpad>/g4/check-41.js [matriz]`: lee la sección «Punto de revisión (tarea 4.1)» y exige la fecha de la
presentación, que no bloquea, los tres puntos (quién da C5 `nativo` con RustFS y Garage como «no ejecutado»; el coste
de SSE-C con 8.1-8.4, la clave y la 2.9b; la fecha estimada de cierre según D1), que no hay `falla (TLS)` y las dos
preguntas abiertas con la medición del filer. Contra este fichero y contra una copia sin la fecha de presentación y con
«Algún candidato quedó en `falla (TLS)`»:

```text
$ node <scratchpad>/g4/check-41.js
ok   fecha de presentación 2026-09-26
ok   no bloquea
ok   1. quién da C5 nativo: SeaweedFS
ok   1. RustFS y Garage «no ejecutado: puntero fijado en SeaweedFS»
ok   falla (TLS): ninguno
ok   2. coste SSE-C: tareas 8.1-8.4
ok   2. clave a custodiar S3_CV_SSE_C_KEY
ok   2. la salida existe según la 2.9b (SDK envía; MinIO rechaza sin TLS)
ok   3. fecha estimada de cierre según la tabla de D1
ok   pregunta (i): filer sin autenticación
ok   medición del filer en loopback (-ip.bind)
ok   pregunta (ii): KEK autogenerada
4.1: ok
exit=0
$ node <scratchpad>/g4/check-41.js <copia falsada>      # solo las líneas que fallan
FALTA fecha de presentación 2026-09-26
FALTA falla (TLS): ninguno
4.1: FALLA (2)
exit=1
```

## Veredicto (tarea 5.3)

Regla de parada de design D1 (sección «Regla de parada», arriba), aplicada el 2026-09-26 a las celdas ejecutadas en
los grupos 1, 3 y 4. Cada resultado cita la tarea cuya salida está pegada en este fichero. Las celdas sin resultado
llevan «no ejecutado: <motivo de D1>», y C6 lleva la anotación de la decisión del usuario, sin renumerar C7-C9.

| Candidato | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | Veredicto |
|---|---|---|---|---|---|---|---|---|---|---|
| SeaweedFS 4.47 | pasa (1.4) | pasa (1.4) | pasa (3.1) | pasa (3.1) | nativo (3.4: disco, (b) b1, (c)) | no medido: retención por barrido, decisión del usuario 2026-09-26 | pasa (4.2: política de checksums por defecto, `when_supported`) | pasa (4.3: `curl -fsS … /healthz` en forma `CMD`) | 1,19 s, 1,17 s y 1,17 s (4.4: medida, no decide) | cumple todo |
| RustFS 1.0.0 | pasa (1.4) | pasa (1.4) | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no medido: retención por barrido, decisión del usuario 2026-09-26 | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no evaluado |
| Garage v2.4.1 | pasa (1.4) | pasa (1.4) | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no medido: retención por barrido, decisión del usuario 2026-09-26 | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no evaluado |

- **SeaweedFS 4.47: cumple todo.** Pasa todas las celdas duras: C1 y C2 (1.4), C3 y C4 (3.1), C7 (4.2) y C8 (4.3).
  Además, C5 sale `nativo` (3.4). C6 no interviene porque no se mide. C9 informa D8 y no aprueba ni suspende.
- **RustFS 1.0.0 y Garage v2.4.1: no evaluado.** Pasan C1 y C2 (1.4) y no tienen ninguna celda en falla. No se
  ejecutaron más celdas por dos reglas de D1. El cribado se detiene en el primero que pasa C1-C4 con C5 `nativo`, así
  que C3-C5 quedan sin ejecutar (3.2, 3.3, 3.5 y 3.6). C7-C9 solo se ejecutan en el candidato que señala el puntero, y
  se pasa al siguiente solo si ese falla una celda dura; SeaweedFS no falló ninguna. No están descartados: no se sabe
  si cumplirían.
- **Elegido: SeaweedFS.** El puntero de D1 pone primero, entre los que pasan C1-C4, a los de C5 `nativo`, y después
  sigue el orden de la lista. Da SeaweedFS (3.7). Es el primero del puntero y cumple todo, así que se elige y se deja de
  buscar. «Apto con salida» no entra en juego, porque solo cuenta si nadie cumple todo, y la 3.8 (SSE-C) no se ejecutó.
  **Modo de cifrado que da la matriz: `server`**, el cifrado por defecto del bucket de CV (C5 `nativo`). La 6.2 lo fija
  en `object-store-modes.ts`.
- **Parada de la 5.3 («ningún candidato apto»): no se cumple.** Ningún candidato quedó en `falla (TLS)`: la 3.8 «no
  aplica», así que no hay que presentar al usuario el coste de meter TLS interno.
- **Abierto, y no decide el veredicto.** Siguen sin respuesta las dos preguntas al usuario de la 4.1. La primera es el
  filer y su gRPC sin autenticación dentro de la red del compose. La segunda es la KEK que `weed mini` autogenera en el
  volumen cuando no tiene clave. Ninguna es una celda de D1: C4 juzga la pasarela S3, y C5 salió `nativo` con la clave
  en el entorno. Si el usuario pide cerrar el filer, eso sería otra configuración del servicio, y antes de adoptarla
  habría que repetir sobre ella C3-C5 y C7-C9 (4.1). También sigue pendiente cómo medir los minutos del corredor
  `arm64` (1.2), que afecta a D11 y a la 9.4 y no a ninguna celda.

### Comprobación de la 5.3

`node <scratchpad>/g5/check-53.js [matriz]` lee la tabla de esta sección y comprueba cuatro cosas:

- Cada fila tiene sus nueve celdas y el veredicto. Cada celda lleva un resultado que cita su tarea, o «no
  ejecutado: puntero fijado en <candidato>», o «no aplica: …». C6 lleva el texto de la decisión del usuario en las tres.
- Cada resultado tiene salida pegada que lo respalda. La comprobación busca en los bloques de código de la sección de
  la tarea citada lo que decide la celda: los pulls y plataformas de C1 por imagen; `archived=false` y `C2: pasa`;
  `provision` y `verify`, con las seis peticiones sin firmar rechazadas, y el arranque sin identidades en ≠0; `c5:
  resultado: nativo` con b1; las dos suites con SDK 3.1134.0; las diez ejecuciones en 0, el 7 y la lista vacía; y
  los tres tiempos de C9, iguales a los de la celda.
- La regla de D1 recalculada sobre las celdas da el veredicto de cada fila, el puntero, el elegido, la parada y el
  modo de cifrado escritos.
- Las «no ejecutado» son exactamente las de D1: C3-C5 de los que van detrás del fijado en el cribado, y C7-C9 de los
  que el puntero no alcanzó, cada una con su motivo.

Contra este fichero:

```text
$ node <scratchpad>/g5/check-53.js
SeaweedFS pasa | pasa | pasa | pasa | nativo | no medido: retención por barrido, decisión del usuario 2026-09-26 | pasa | pasa | 1,19 s, 1,17 s y 1,17 s => cumple todo
RustFS    pasa | pasa | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no medido: retención por barrido, decisión del usuario 2026-09-26 | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no ejecutado: puntero fijado en SeaweedFS, que cumple todo => no evaluado
Garage    pasa | pasa | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no ejecutado: puntero fijado en SeaweedFS | no medido: retención por barrido, decisión del usuario 2026-09-26 | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no ejecutado: puntero fijado en SeaweedFS, que cumple todo | no ejecutado: puntero fijado en SeaweedFS, que cumple todo => no evaluado
puntero de D1: SeaweedFS | elegido por la regla: SeaweedFS | escrito: SeaweedFS
comprobaciones: 89 ok, 0 fallan
5.3: ok
exit=0
```

Falsación (`node <scratchpad>/g5/falsify-53.js`): ocho copias de este fichero en el scratchpad, cada una con una
alteración, y `check-53.js` contra cada una. Se muestran solo las líneas que fallan.

```text
$ node <scratchpad>/g5/falsify-53.js
== veredicto de SeaweedFS cambiado a «apto con salida»
SeaweedFS: veredicto escrito = regla de D1 (cumple todo): escrito «apto con salida»
exit=1
== C6 de Garage sin el texto de la decisión
Garage C6: resultado o motivo: «no medido»
Garage C6: «no medido: retención por barrido, decisión del usuario 2026-09-26»: «no medido»
exit=1
== salida de C8 alterada (run 10 con exit=1)
SeaweedFS C8: salida pegada que respalda «pasa»: sin salida pegada que lo respalde
exit=1
== salida de C5 alterada (resultado: no concluyente)
SeaweedFS C5: salida pegada que respalda «nativo»: sin salida pegada que lo respalde
exit=1
== salida de C9 alterada (1.17 → 1.71 en la corrida 2)
SeaweedFS C9: salida pegada que respalda «medida»: sin salida pegada que lo respalde
exit=1
== elegido cambiado a RustFS
elegido escrito = regla de D1 (SeaweedFS): escrito «RustFS»
exit=1
== C7 de RustFS con «pasa (4.2)» sin salida propia
RustFS C7: salida pegada que respalda «pasa»: sin salida pegada que lo respalde
RustFS C7: «no ejecutado» donde lo pide D1: falta
exit=1
== fila de Garage sin la celda C9
Garage: nueve celdas y el veredicto: 9 columnas
Garage C9: resultado o motivo: «no evaluado»
Garage: veredicto válido: «undefined»
Garage: veredicto escrito = regla de D1 (no evaluado): escrito «undefined»
Garage C9: «no ejecutado» donde lo pide D1: falta
exit=1
falsación: todas las copias salen ≠0
exit=0
```

## Configuración entregada (tareas 7.1, 7.1b, 7.2, 7.2b, 7.3, 7.3b, 7.5b, 7.5c, 7.5, 7.4, 7.6, 7.7 y 7.8)

El servicio `object-store` de `docker-compose.yml` está **copiado** del de `seaweedfs.compose.yml`, el que midió la
matriz (design D2, «Lo que se entrega es lo que se midió»; D6, D14 y D16). Esta sección tiene lo que lo demuestra:
la lista cerrada de lo que puede diferir, la comparación de servicios, el guardia de arranque de la clave y C5 repetida
sobre el compose entregado. Todas las corridas usan un proyecto de Compose propio (`os7-*`) y puertos del bloque
19700-19799 (`OBJECT_STORE_PORT=19740` y los demás por sus variables): la pila de desarrollo por defecto no se toca.

### Lista cerrada de claves de `environment` que pueden tener otro valor

Solo las mapeadas desde las variables del fichero de entorno (`S3_ACCESS_KEY`, `S3_SECRET_KEY` y, porque el modo es
`server`, `OBJECT_STORE_SSE_KEY`). En `docker-compose.yml` llevan valores de desarrollo por defecto (`:-`); en el
compose de la matriz, `:?`. Cada una tiene que referenciar su variable en los dos composes (`config --no-interpolate`).

- `AWS_ACCESS_KEY_ID` ← `S3_ACCESS_KEY`
- `AWS_SECRET_ACCESS_KEY` ← `S3_SECRET_KEY`
- `WEED_S3_SSE_KEK` ← `OBJECT_STORE_SSE_KEY`

Rutas del servicio que la comparación quita antes de comparar, y ninguna más: `ports`, `healthcheck`, `networks`
(design D14; su forma la comprueba la 7.3b), el `source` del volumen con nombre y los valores de las claves de la lista
de arriba; desde la 7.1b, también `entrypoint` (el guardia de design D16, que se comprueba aparte). El `source` de un
fichero montado se compara por el sha256 de su contenido (el servicio no monta ninguno).

### 7.1: servicio copiado, red propia y comparación

**(1) Digest.** `node <scratchpad>/g7/check-image.js docker-compose.yml`: `docker compose -f docker-compose.yml config
--images object-store`, sin `OBJECT_STORE_IMAGE`/`OBJECT_STORE_IMAGE_TAG` en el entorno, volcado a fichero y leído con
`node`, que exige **exactamente una línea**; después `docker buildx imagetools inspect <imagen> --format
'{{.Manifest.Digest}}'` (la plantilla de la 2.14) contra el digest de la 1.2/1.4:

```text
$ node <scratchpad>/g7/check-image.js docker-compose.yml
config --images object-store (docker-compose.yml): 1 línea(s)
imagen: chrislusf/seaweedfs:4.47
digest del índice (imagetools inspect --format '{{.Manifest.Digest}}'): sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882
digest anotado en la 1.4 (matriz.md):                              sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882
7.1 (1): ok
exit=0
```

**(2) Desde volúmenes vacíos, el `up` no crea buckets** (escenario «El healthcheck del almacén no crea buckets»):

```text
$ COMPOSE_PROJECT_NAME=os7-a docker compose -f docker-compose.yml up -d --wait     # sin volúmenes os7-a_* previos
 Volume os7-a_redis-data Created
 Volume os7-a_object-store-data Created
 Volume os7-a_mongo-data Created
 Network os7-a_default Created
 Network os7-a_object-store-net Created
 Container os7-a-mailpit-1 Healthy
 Container os7-a-redis-1 Healthy
 Container os7-a-object-store-1 Healthy
 Container os7-a-mongo-1 Healthy
exit=0
$ docker compose … ps --format '{{.Service}} {{.State}} {{.Health}}'
mailpit running healthy
mongo running healthy
object-store running healthy
redis running healthy
$ S3_ENDPOINT=http://localhost:19740 node docs/object-store-matrix/list-buckets.mjs
buckets (0):
exit=0
```

**(3) Comparación de servicios** (`node <scratchpad>/g7/compare-service.js <matriz> <entregado>`): lee la lista cerrada
de arriba, vuelca `config --format json` y `config --no-interpolate --format json` de los dos composes a ficheros del
scratchpad (el de la matriz, con valores de relleno en sus tres variables obligatorias), comprueba las referencias y
compara el objeto del servicio entero tras quitar solo las rutas de arriba. No imprime valores de `environment`.

```text
$ node <scratchpad>/g7/compare-service.js docs/object-store-matrix/seaweedfs.compose.yml docker-compose.yml
lista cerrada (matriz.md): AWS_ACCESS_KEY_ID <- S3_ACCESS_KEY, AWS_SECRET_ACCESS_KEY <- S3_SECRET_KEY, WEED_S3_SSE_KEK <- OBJECT_STORE_SSE_KEY
rutas quitadas: ports, healthcheck, networks, volumes[].source (volumen con nombre), environment.<lista cerrada>
referencias (config --no-interpolate): las 3 claves referencian su variable en los dos composes
claves comparadas del servicio: command, entrypoint, environment, image, volumes
comparación de servicios: ok (idénticos salvo la lista cerrada)
exit=0
```

Falsación: una variable más en el servicio de `docker-compose.yml` (`S3_EXTRA_FALSIFICATION: '1'`), y restaurado
(fichero idéntico a la copia de antes, `cmp`):

```text
$ node <scratchpad>/g7/compare-service.js docs/object-store-matrix/seaweedfs.compose.yml docker-compose.yml
(…)
FALLA environment.S3_EXTRA_FALSIFICATION: solo en el entregado
comparación de servicios: FALLA (1)
exit=1
$ node <scratchpad>/g7/compare-service.js …          # restaurado
comparación de servicios: ok (idénticos salvo la lista cerrada)
exit=0
```

**(4) `object-store` sin `depends_on`** (`bash <scratchpad>/g7/check-no-depends.sh docker-compose.yml`: `config
--format json` volcado a fichero y un `node -e` sobre él). Falsación con `depends_on: [redis]` en el servicio: falla
ese `node -e` **y** la lectura de (1) sale ≠0 nombrando las dos líneas; restaurado, las dos en verde:

```text
$ bash <scratchpad>/g7/check-no-depends.sh docker-compose.yml
7.1 (4): object-store sin depends_on: ok
exit=0
--- falsación: depends_on: [redis]
$ bash <scratchpad>/g7/check-no-depends.sh docker-compose.yml
FALLA: el servicio object-store tiene depends_on: redis
exit=1
$ node <scratchpad>/g7/check-image.js docker-compose.yml
config --images object-store (docker-compose.yml): 2 línea(s)
FALLA: se exige exactamente una línea; hay 2: redis:7.4.11, chrislusf/seaweedfs:4.47
exit=1
--- restaurado
$ bash <scratchpad>/g7/check-no-depends.sh docker-compose.yml
7.1 (4): object-store sin depends_on: ok
exit=0
$ node <scratchpad>/g7/check-image.js docker-compose.yml
(…)
7.1 (1): ok
```

### 7.1b: guardia de arranque de la clave

**`Entrypoint` y `Cmd` de la imagen fijada**, leídos antes de escribir el guardia (termina en `exec` de ese
`Entrypoint` con los mismos argumentos; el `Cmd` de la imagen no se usa, porque el servicio fija su `command`):

```text
$ docker image inspect --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}' chrislusf/seaweedfs:4.47
["/entrypoint.sh"] ["mini","-dir=/data"]
exit=0
```

**Listado del `tar` de un volumen arrancado con clave**, uno nuevo: el de la 7.1 (2) (`os7-a_object-store-data`,
arrancado con la clave de desarrollo por defecto de `docker-compose.yml`), después de `object-store provision` y de
un `PUT` al bucket de CV sin cabeceras SSE (`lo que dice el almacén: AES256`), con `object-store` detenido. Entradas
de la raíz (el `tar` tiene 112) y la búsqueda de los dos ficheros con `node`:

```text
$ docker run --rm -v os7-a_object-store-data:/d:ro alpine:3 sh -c 'cd /d && tar -cf - . | tar -tvf -'
-rw-r--r-- 1000/1000       194 2026-09-27 02:02:34 ./cvs_1.vif
drwxr-xr-x 1000/1000         0 2026-09-27 02:02:02 ./worker/
-rw-r--r-- 1000/1000        16 2026-09-27 02:02:34 ./cvs_1.idx
-rw------- 1000/1000        64 2026-09-27 02:02:01 ./.mini_kek_passphrase
drwxr-xr-x 1000/1000         0 2026-09-27 02:02:01 ./admin/
-rw-r--r-- 1000/1000      1080 2026-09-27 02:02:34 ./cvs_1.dat
-rw-r--r-- 1000/1000        36 2026-09-27 02:02:01 ./vol_dir.uuid
-rw-r--r-- 1000/1000        32 2026-09-27 02:02:46 ./2.idx
drwxr-xr-x 1000/1000         0 2026-09-27 02:02:01 ./filerldb2/
-rw-r--r-- 1000/1000       361 2026-09-27 02:02:02 ./mini.options
-rw-r--r-- 1000/1000      7768 2026-09-27 02:02:46 ./2.dat
-rw-r--r-- 1000/1000       194 2026-09-27 02:02:45 ./2.vif
drwxr-xr-x 1000/1000         0 2026-09-27 02:02:01 ./m9333/
exit=0
$ node <búsqueda en el listado>
112 entradas
.mini_sse_kek: no existe
.mini_kek_passphrase: existe
```

Con clave **no existe `.mini_sse_kek`** y **sí existe `.mini_kek_passphrase`** (64 bytes, creado al arrancar, como en
la 3.4, donde la copia de (b) lo llevaba y con K2 A1 no se leía). Así que el guardia rechaza **solo**
`/data/.mini_sse_kek`: rechazar también `.mini_kek_passphrase` impediría arrancar cualquier volumen con clave.

El guardia, en `entrypoint` del servicio de `docker-compose.yml` con `command` intacto (en el YAML, cada `$` va
escrito `$$`; `docker compose config` conserva ese escape en su salida, y el contenedor recibe un solo `$`, visto con
`docker inspect` abajo): sale con 64 si `WEED_S3_SSE_KEK` no son exactamente 64 caracteres `[0-9a-f]` (un `case` con
`*[!0-9a-f]*` y `${#WEED_S3_SSE_KEK}`), con 65 si existe `/data/.mini_sse_kek`, y si no, `exec /entrypoint.sh "$@"`.
Ninguna de sus dos líneas de error lleva el valor de la clave.

**(1) Comparación de servicios con `entrypoint` en la lista cerrada, y el guardia aparte.** `check-guard.js` vuelca
`docker compose -f docker-compose.yml config --format json` a fichero y exige `entrypoint` = `/bin/sh`, `-c`, el
guardia, `object-store-guard`; que el guardia (sin el escape `$$` de `config`) termine en `exec` + el `Entrypoint`
pegado arriba + `"$@"`; y `command` idéntico, elemento a elemento, al de `seaweedfs.compose.yml`:

```text
$ node <scratchpad>/g7/check-guard.js docker-compose.yml
Entrypoint pegado: ["/entrypoint.sh"]
entrypoint: "/bin/sh", "-c", <guardia de 13 líneas>, "object-store-guard"
última línea del guardia (tras quitar el escape $$ de config): exec /entrypoint.sh "$@"
command (7 elementos, igual elemento a elemento al de la matriz: sí): ["mini","-dir=/data","-webdav=false","-admin.ui=false","-s3.port.iceberg=0","-s3.port.lance=0","-master.telemetry=false"]
7.1b (1) guardia: ok
exit=0
$ node <scratchpad>/g7/compare-service.js docs/object-store-matrix/seaweedfs.compose.yml docker-compose.yml --strip-entrypoint
lista cerrada (matriz.md): AWS_ACCESS_KEY_ID <- S3_ACCESS_KEY, AWS_SECRET_ACCESS_KEY <- S3_SECRET_KEY, WEED_S3_SSE_KEK <- OBJECT_STORE_SSE_KEY
rutas quitadas: ports, healthcheck, networks, entrypoint, volumes[].source (volumen con nombre), environment.<lista cerrada>
referencias (config --no-interpolate): las 3 claves referencian su variable en los dos composes
claves comparadas del servicio: command, environment, image, volumes
comparación de servicios: ok (idénticos salvo la lista cerrada)
exit=0
$ node <scratchpad>/g7/compare-service.js docs/object-store-matrix/seaweedfs.compose.yml docker-compose.yml   # sin quitar entrypoint
(…)
FALLA entrypoint: valor distinto
comparación de servicios: FALLA (1)
exit=1
```

**(2) Caso bueno**, desde volúmenes vacíos (proyecto `os7-g`, sin volúmenes previos), con la clave de desarrollo por
defecto. El proceso que queda es `weed` con los argumentos de la matriz (el `-logtostderr=true` lo añade
`/entrypoint.sh`, como en la matriz):

```text
$ COMPOSE_PROJECT_NAME=os7-g docker compose -f docker-compose.yml up -d --wait object-store
exit=0
$ docker inspect --format '{{json .State.Health}}' <contenedor>      # leído con node
State.Health.Status: healthy | FailingStreak: 0
$ docker inspect --format '{{json .Config.Entrypoint}}' <contenedor>  # leído con node
Config.Entrypoint del contenedor: "/bin/sh" "-c" <guardia> "object-store-guard" | última línea: exec /entrypoint.sh "$@"
$ docker top <contenedor> -o pid,user,args
PID                 USER                COMMAND
48732               1000                /usr/bin/weed -logtostderr=true mini -dir=/data -webdav=false -admin.ui=false -s3.port.iceberg=0 -s3.port.lance=0 -master.telemetry=false
$ docker compose -p os7-g -f docker-compose.yml down -v
exit=0
```

**(3) Tres falsaciones** (`bash <scratchpad>/g7/falsify.sh <etiqueta> <código> <modo>`), cada una en su proyecto
desde volúmenes vacíos y con `down -v` al terminar: `up -d --wait --wait-timeout 60 object-store` sale ≠0, `docker
inspect` no da `healthy` y da el código esperado, los logs del servicio (volcados a fichero) tienen la línea del
guardia y, buscado con `node`, **no** contienen el valor de la clave. (a) con `-f docker-compose.yml -f
<scratchpad>/kek-empty.yml`, que pone `WEED_S3_SSE_KEK: ''`; (b) con `OBJECT_STORE_SSE_KEY` de 63 hexadecimales y,
aparte, de 64 caracteres con una `g`; (c) `up --no-start object-store`, `docker run --rm -v
os7-fc_object-store-data:/data alpine:3 touch /data/.mini_sse_kek` y la clave por defecto, que es correcta:

```text
== (a) proyecto os7-fa, volúmenes previos: ninguno
$ docker compose … up -d --wait --wait-timeout 60 object-store
 container os7-fa-object-store-1 exited (64)
exit=1
docker inspect: Status=exited, ExitCode=64, Health=unhealthy
línea del guardia en los logs: object-store-guard: WEED_S3_SSE_KEK (OBJECT_STORE_SSE_KEY) must be exactly 64 characters [0-9a-f]; refusing to start (see docs/RUNBOOK.md)
valor de la clave en los logs: no
(a) ok: up ≠0, no healthy, ExitCode 64, línea del guardia, sin la clave
down -v exit=0

== (b63) proyecto os7-fb63, volúmenes previos: ninguno
$ docker compose … up -d --wait --wait-timeout 60 object-store
 container os7-fb63-object-store-1 exited (64)
exit=1
docker inspect: Status=exited, ExitCode=64, Health=unhealthy
línea del guardia en los logs: object-store-guard: WEED_S3_SSE_KEK (OBJECT_STORE_SSE_KEY) must be exactly 64 characters [0-9a-f]; refusing to start (see docs/RUNBOOK.md)
valor de la clave en los logs: no
(b63) ok: up ≠0, no healthy, ExitCode 64, línea del guardia, sin la clave
down -v exit=0

== (b64g) proyecto os7-fb64g, volúmenes previos: ninguno
$ docker compose … up -d --wait --wait-timeout 60 object-store
 container os7-fb64g-object-store-1 exited (64)
exit=1
docker inspect: Status=exited, ExitCode=64, Health=unhealthy
línea del guardia en los logs: object-store-guard: WEED_S3_SSE_KEK (OBJECT_STORE_SSE_KEY) must be exactly 64 characters [0-9a-f]; refusing to start (see docs/RUNBOOK.md)
valor de la clave en los logs: no
(b64g) ok: up ≠0, no healthy, ExitCode 64, línea del guardia, sin la clave
down -v exit=0

== (c) proyecto os7-fc, volúmenes previos: ninguno
up --no-start exit=0
touch /data/.mini_sse_kek exit=0
$ docker compose … up -d --wait --wait-timeout 60 object-store
 container os7-fc-object-store-1 exited (65)
exit=1
docker inspect: Status=exited, ExitCode=65, Health=unhealthy
línea del guardia en los logs: object-store-guard: /data/.mini_sse_kek exists: this volume was started without WEED_S3_SSE_KEK and may hold objects encrypted with a key SeaweedFS generated; refusing to start (see docs/RUNBOOK.md before touching the file)
valor de la clave en los logs: no
(c) ok: up ≠0, no healthy, ExitCode 65, línea del guardia, sin la clave
down -v exit=0
```

La clave que recibió cada contenedor, leída de `docker inspect` (solo su forma): (a) 0 caracteres; (b63) 63, solo
`[0-9a-f]`; (b64g) 64, con otro carácter; (c) 64, solo `[0-9a-f]`, la de desarrollo por defecto.

### 7.2: `pnpm infra:up`

Script `infra:up` del `package.json` raíz: `docker compose up -d --wait && pnpm nx run api:object-store -- provision`.
Proyecto `os7-u` desde volúmenes vacíos, con `COMPOSE_PROJECT_NAME`, los puertos del bloque y las `S3_*` (con
`S3_ENDPOINT=http://localhost:19740`) exportados en el entorno de la orden: `.env` no se toca, y Nx no sobrescribe una
variable del entorno cuyo valor difiere del de `.env`. Salida de Compose resumida a una línea por recurso:

```text
$ pnpm infra:up                                   # 1.ª vez, sin volúmenes os7-u_* previos
$ docker compose up -d --wait && pnpm nx run api:object-store -- provision
Volume os7-u_redis-data Created
Volume os7-u_mongo-data Created
Volume os7-u_object-store-data Created
Network os7-u_object-store-net Created
Network os7-u_default Created
Container os7-u-mailpit-1 Healthy
Container os7-u-object-store-1 Healthy
Container os7-u-redis-1 Healthy
Container os7-u-mongo-1 Healthy
> nx run api:object-store provision
> node apps/api/src/object-store.cjs provision
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
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
$ pnpm infra:up                                   # 2.ª vez
Container os7-u-object-store-1 Healthy
(…)
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
ok    cvs: no lifecycle rule
ok    snapshots: no lifecycle rule
(… las mismas doce líneas `ok` que la 1.ª vez)
verify: ok
exit=0
$ node <DeleteBucket del bucket de CV con el SDK>
DeleteBucket cvs: ok
exit=0
$ node docs/object-store-matrix/list-buckets.mjs
buckets (1):
snapshots
exit=0
$ pnpm infra:up                                   # 3.ª vez: volumen que ya existía, sin el bucket de CV
(…)
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket already exists
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0
$ node docs/object-store-matrix/list-buckets.mjs
buckets (2):
cvs
snapshots
exit=0
$ pnpm nx run api:object-store -- verify
verify: ok
exit=0
$ docker compose -p os7-u -f docker-compose.yml down -v
exit=0
```

### 7.2b: C5 sobre la configuración entregada

**Orden de generación de la clave** (la del formato que pide SeaweedFS, `WEED_S3_SSE_KEK`: 32 bytes en 64
hexadecimales en minúscula, los que exige el guardia de la 7.1b; la copia la 6.1 a ADR-052 «Elección», y de ahí la
12.2):

```text
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

K1 se generó con esa orden, se guardó solo en un `.env` del scratchpad (no se imprime ni se versiona) y se exportó como
`OBJECT_STORE_SSE_KEY`. Con ella, `pnpm infra:up` desde volúmenes vacíos (proyecto `os7-c5`, sin volúmenes previos;
la red propia de la 7.1 y el guardia de la 7.1b ya en el servicio): los cuatro servicios `healthy` y `provision: ok`
(`cvs: bucket created`, `cvs: default encryption set (AES256)`, `snapshots: bucket created`). `docker inspect` del
contenedor: su `WEED_S3_SSE_KEK` es K1 y no la de desarrollo por defecto. Después, `c5.sh` con `docker-compose.yml`
como compose y el volumen de desarrollo del almacén (`object-store-data` del proyecto, `os7-c5_object-store-data`); lee
K1 del compose resuelto y solo detiene y arranca `object-store`. La K2 de la copia de (b) tiene el formato de K1 y pasa
el guardia (arranca):

```text
$ COMPOSE_PROJECT_NAME=os7-c5 C5_WORKDIR=<scratchpad>/g7/c5-delivered bash docs/object-store-matrix/c5.sh docker-compose.yml object-store-data
c5: mode server, compose docker-compose.yml, volume object-store-data, workdir <scratchpad>/g7/c5-delivered
c5: project os7-c5, docker volume os7-c5_object-store-data, key entry WEED_S3_SSE_KEK (from OBJECT_STORE_SSE_KEY)
container ok: one volume (os7-c5_object-store-data), no writable bind
c5: 1. contract suite, C5 server mode (vitest, output in <scratchpad>/g7/c5-delivered/suite.log)
   ↓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > runs with the checksum policy it was asked for
   ↓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > uploads a CV with the real adapter and the same bytes come back
   ↓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > deletes a prefix of 1001 keys in two DeleteObjects batches and leaves it empty
   ✓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them 501ms
   ↓ |api| src/infrastructure/storage/s3.s3-contract.spec.ts > S3 contract of api (real store) > C5 SSE-C mode: writes A1/A2 with SSE-C and requires the SSECustomerKeyMD5 echo, B1/B2 without SSE, and dumps them
   Test Files  1 passed (1)
   Tests  1 passed | 4 skipped (5)
   A1 cvs 1048576 bytes, lo que dice el almacén: AES256
   A2 cvs 1024 bytes, lo que dice el almacén: AES256
   B1 snapshots 1048576 bytes, lo que dice el almacén: none reported
   B2 snapshots 1024 bytes, lo que dice el almacén: none reported
c5: 2. docker compose stop object-store
c5:    tar of volume os7-c5_object-store-data with alpine:3
c5: 3. find-plaintext
   find-plaintext: vol.tar, 2293760 bytes leídos
   A1 0/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   A2 0/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   B1 3/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
   B2 3/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
   clave 0/3  (textual no; decodificada (hex, 32 bytes) no; decodificada (base64, 48 bytes) no)
c5: 4. disk reading
c5:    disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3)
c5:    (c) ok: la clave, 0/3 formas en el volumen (textual; decodificada (hex, 32 bytes); decodificada (base64, 48 bytes))
c5: (b) copy project c5copy-51de37: container created with K2 (same format as K1), volume c5copy-51de37_object-store-data restored from vol.tar
   K2 WEED_S3_SSE_KEK of the container: the expected key
c5: (b) K2 on the copy
c5:    original object-store still stopped: the endpoint reaches the copy
   almacén listo en 0.0 s
c5:    K2: started
   K2 A1: rechazado sin bytes (HTTP 500 InternalError)
   K2 B1: igual por bytes (1048576 bytes, sha256 f248c804dd574771)
   K2 log: object-store-1  | E0927 02:17:07.541641 s3api_object_handlers.go:883 GetObjectHandler: failed to stream cvs/28e6850670ec2d8e76b05964/7f372d1e05101ae2047a72fb from volume servers: failed to decrypt DEK: failed to decrypt DEK: cipher: message authentication failed
c5: (b) K1 on the same copy (the compose's own key: OBJECT_STORE_SSE_KEY as the compose resolves it)
   K1 WEED_S3_SSE_KEK of the container: the expected key
   almacén listo en 0.0 s
c5:    K1: started
   K1 A1: igual por bytes (1048576 bytes, sha256 56492b6653bebd0b)
   K1 B1: igual por bytes (1048576 bytes, sha256 f248c804dd574771)
c5: copy project c5copy-51de37 removed (container, network and volume)
c5: original object-store started again (up -d --no-deps object-store)
c5: (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos)
c5: (a) with the key in the environment the product uses that key: shown by (b) and (c)
c5: resultado: nativo (disco: ok (A1 0/3, A2 0/3, B1 3/3, B2 3/3); (b) b1 (K2: arranca, A1 rechazado sin bytes, B1 leído; K1 sobre la misma copia: A1 y B1 idénticos); (c) ok: la clave, 0/3 formas en el volumen (textual; decodificada (hex, 32 bytes); decodificada (base64, 48 bytes)))
exit=0
```

- **Disco:** A1 y A2 0/3, B1 y B2 3/3.
- **(b) = b1**, como en la 3.4: con K2 sobre la copia restaurada desde el `tar`, SeaweedFS arranca (el guardia la
  deja pasar), el `GET` de A1 se rechaza sin bytes (`HTTP 500 InternalError`; el log de la copia dice `failed to
  decrypt DEK … cipher: message authentication failed`) y B1 vuelve idéntico; con K1 sobre la misma copia, A1 y B1
  vuelven idénticos.
- **(c)** la clave, 0/3 formas en el volumen.
- **Resultado: `nativo`** sobre `docker-compose.yml`, con la red propia y el guardia de arranque: la configuración
  entregada es la que se midió. La parada de la 7.2b no se cumple.
- Al terminar, `docker compose -p os7-c5 -f docker-compose.yml down -v`; la copia `c5copy-51de37` la borró `c5.sh`.

Comprobación (`node <scratchpad>/g7/check-72b.js [matriz]`), contra este fichero y contra una copia con el resultado
cambiado a `no concluyente` y B2 a 0/3 (solo las líneas que fallan):

```text
$ node <scratchpad>/g7/check-72b.js
ok   sección 7.2b dentro de «Configuración entregada»
ok   orden de generación
ok   c5.sh con docker-compose.yml como compose
ok   lectura del disco: A1 0/3
ok   lectura del disco: A2 0/3
ok   lectura del disco: B1 3/3
ok   lectura del disco: B2 3/3
ok   resultado de (b): b1 o b2
ok   resultado de (c)
ok   resultado nativo
7.2b: ok
exit=0
$ node <scratchpad>/g7/check-72b.js <copia falsada>
FALTA lectura del disco: B2 3/3
FALTA resultado nativo
7.2b: FALLA (2)
exit=1
```

### 7.3: servicio de producción y comparación desarrollo ↔ producción

En `docker-compose.prod.yml`, el servicio `minio` y su montaje de `infra/minio/ensure-buckets.sh` (borrado) se
sustituyen por `object-store`, **copiado** del de `docker-compose.yml`: misma imagen por defecto
(`${OBJECT_STORE_IMAGE:-chrislusf/seaweedfs}:${OBJECT_STORE_IMAGE_TAG:-4.47}`), el mismo guardia de arranque de la
7.1b en `entrypoint`, la misma `command`, las mismas tres claves de `environment` (aquí `${S3_ACCESS_KEY:?}`,
`${S3_SECRET_KEY:?}` y `${OBJECT_STORE_SSE_KEY:?…}`, sin valor por defecto), el volumen `object-store-data` y el mismo
healthcheck. Lo que cambia es lo de la lista cerrada de la 7.3: sin `ports`, `restart: unless-stopped` y la red propia
`object-store-net` con `internal: true`, de la que es el único servicio además de `api` y `worker` (design D14). `api` y
`worker` pasan a `S3_ENDPOINT: http://object-store:8333`, a `depends_on: object-store: service_healthy` y a las redes
`internal` y `object-store-net`. Mongo, redis, `web` y Traefik no cambian.

**`infra/ci/verify.env` en esta misma tarea.** La 7.3 se verifica con `docker compose -f docker-compose.prod.yml
--env-file infra/ci/verify.env config`, y con `${OBJECT_STORE_SSE_KEY:?…}` en el compose esa orden solo sale 0 si el
fichero de relleno da la variable. Por eso la sustitución de `MINIO_KMS_SECRET_KEY` que enumera la 7.4 se hace aquí:
`OBJECT_STORE_SSE_KEY` con un valor de relleno de 64 hexadecimales (el hexadecimal del texto
`linkvault-ci-only-sse-kek-000000`, no una clave), que pasa el guardia. El resto de la 7.4 (`verify-artifact.sh`)
sigue pendiente, así que hasta la 7.4 la verificación del artefacto no puede levantar esta pila: su lista de servicios
aún nombra `minio`.

```text
$ docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config > <scratchpad>/73-config.yml
exit=0
365 líneas; minio: false; ensure-buckets: false
$ docker compose -f docker-compose.prod.yml --env-file <verify.env de 52a681f, con MINIO_KMS_SECRET_KEY> config
error while interpolating services.object-store.environment.WEED_S3_SSE_KEK: required variable OBJECT_STORE_SSE_KEY is missing a value: set OBJECT_STORE_SSE_KEY to 64 hex characters (ADR-052)
exit=1
$ bash infra/ci/repo-checks.sh                     # líneas de las comprobaciones que leen el compose de producción
check(compose-env-contract): OK — 55 variables obligatorias de 'api' y 'worker' tienen valor en su servicio de docker-compose.prod.yml; las condicionales de correo se pasan en los dos. La comprobación es unidireccional: el compose puede declarar opcionales de más
check(compose-healthchecks): OK — 7 servicios de docker-compose.prod.yml con healthcheck: traefik, mongo, redis, object-store, api, worker, web
check(stale-defaults): OK — 212 valores por defecto inspeccionados en .env.example, docker-compose.prod.yml y libs/ai/src/infrastructure/config/ai-config.schema.ts; 1 recurso(s) muerto(s) y 1 espacio(s) de nombres ajeno(s) en el registro. Los ficheros de test quedan fuera a propósito (ver stale-defaults.registry.mjs)
ok: 5 comprobaciones de repositorio ejecutadas
exit=0
```

`docs-stack-up` sigue en verde porque compara el bloque de `infra/README.md` con `verify-artifact.sh`, y los dos siguen
nombrando `minio` hasta la 7.4 y la 7.6.

**Imagen, `depends_on`, comparación y referencias** (`node <scratchpad>/g8/check-73.js`): `config --images
object-store` de los dos composes, sin `OBJECT_STORE_IMAGE`/`OBJECT_STORE_IMAGE_TAG` en el entorno (el de producción con
`--env-file infra/ci/verify.env`), volcado a fichero y exigiendo **exactamente una línea** en cada uno; `object-store`
de producción sin `depends_on` (`config --format json`); la comparación de servicios de la 7.1 entre desarrollo y
producción con la lista cerrada de la 7.3 (`ports`, `networks`, `depends_on`, `restart`, `logging`, el `source` del
volumen con nombre y los valores de las claves de la lista de arriba), con `healthcheck` y `entrypoint` comparados; y,
con `config --no-interpolate --format json`, que en producción las tres claves son exactamente `${VAR:?…}`. No imprime
valores de `environment`.

```text
$ node <scratchpad>/g8/check-73.js
lista cerrada (matriz.md): AWS_ACCESS_KEY_ID <- S3_ACCESS_KEY, AWS_SECRET_ACCESS_KEY <- S3_SECRET_KEY, WEED_S3_SSE_KEK <- OBJECT_STORE_SSE_KEY
(1) config --images object-store (docker-compose.yml): 1 línea(s): chrislusf/seaweedfs:4.47
(1) config --images object-store (docker-compose.prod.yml --env-file infra/ci/verify.env): 1 línea(s): chrislusf/seaweedfs:4.47
(1) la misma referencia con versión exacta en los dos: chrislusf/seaweedfs:4.47
(2) object-store de producción sin depends_on: ok
(4) producción (config --no-interpolate): las 3 claves son ${VAR:?...} sin :-, y desarrollo referencia las mismas variables
(3) rutas quitadas: ports, networks, depends_on, restart, logging, volumes[].source (volumen con nombre), environment.<lista cerrada>; healthcheck y entrypoint se comparan
(3) claves comparadas del servicio: command, entrypoint, environment, healthcheck, image, volumes
(3) comparación de servicios desarrollo <-> producción: ok (idénticos salvo la lista cerrada; healthcheck y entrypoint iguales)
7.3: ok
exit=0
```

Falsación (`node <scratchpad>/g8/falsify-73.js`): seis copias de `docker-compose.prod.yml` en el scratchpad, cada una
con una alteración, y `check-73.js` contra cada una (solo las líneas que fallan):

```text
== healthcheck distinto (interval 10s -> 15s en el almacén)
FALLA (3) healthcheck.interval: valor distinto
exit=1
== guardia distinto (exit 64 -> 63)
FALLA (3) entrypoint.2: valor distinto
exit=1
== clave con valor por defecto (:-)
FALLA (4) producción: environment.WEED_S3_SSE_KEK no es exactamente ${OBJECT_STORE_SSE_KEY:?...}
exit=1
== variable de más en el almacén
FALLA (3) environment.S3_EXTRA_FALSIFICATION: solo en producción
exit=1
== depends_on: [redis] en el almacén
FALLA (1) producción: se exige exactamente una línea; hay 2: chrislusf/seaweedfs:4.47, redis:7.4.11
FALLA (2) object-store de producción tiene depends_on: redis
exit=1
== otra versión de la imagen (4.46)
FALLA (1) imagen distinta: chrislusf/seaweedfs:4.47 / chrislusf/seaweedfs:4.46
FALLA (3) image: valor distinto
exit=1
falsación: todas las copias salen ≠0
```

### 7.3b: aislamiento de red del almacén

La red no cambia la configuración del producto (mismas flags, entorno y volumen), así que C3-C5 y C7-C9 no se repiten:
C3-C4 las cubre la 7.2 (`provision` y `verify`) y C5 la 7.2b. Las pilas de esta sección usan proyectos de Compose
`os8-*`: la de producción no publica ningún puerto (Traefik no se levanta) y la de desarrollo usa el bloque
19800-19899. La pila de desarrollo por defecto (`linkvault`) no se toca.

**(1) Forma** (`node <scratchpad>/g8/check-73b-shape.js --profiles`): vuelca `docker compose -f docker-compose.yml
config --format json` y `docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env config --format
json` a ficheros del scratchpad. Con `--profiles` lee además el de desarrollo con sus tres perfiles activos, porque
`config` sin perfiles no lista `ollama` ni `meilisearch`.

```text
$ node <scratchpad>/g8/check-73b-shape.js --profiles
producción: object-store-net internal=true; miembros: api, object-store, worker
producción: object-store en object-store-net; ports: ninguno
producción: api en internal, object-store-net
producción: worker en internal, object-store-net
desarrollo: servicios mailpit, mongo, object-store, redis
desarrollo: object-store-net internal=(sin clave); miembros: object-store
desarrollo: object-store en object-store-net; puertos publicados: 9000:8333
desarrollo (todos los perfiles): servicios mailpit, meilisearch, mongo, object-store, ollama, redis
desarrollo (todos los perfiles): object-store-net internal=(sin clave); miembros: object-store
desarrollo (todos los perfiles): object-store en object-store-net; puertos publicados: 9000:8333
7.3b (1) forma: ok
exit=0
```

Falsación: una copia de `docker-compose.prod.yml` en el scratchpad con `redis` añadido a `object-store-net`:

```text
$ node <scratchpad>/g8/check-73b-shape.js <scratchpad>/g8/prod.redis-in-osnet.yml
producción: object-store-net internal=true; miembros: api, object-store, redis, worker
(…)
FALLA producción: miembros de object-store-net distintos de object-store, api y worker; de más: redis
7.3b (1): FALLA (1)
exit=1
```

**(2) Producción.** La pila de `docker-compose.prod.yml` con `infra/ci/verify.env` se levanta como en la 7.7: mismas
imágenes de terceros, las tres propias construidas en local desde el árbol de `e7c371a` (`apps/`, `libs/`, `docker/` y el lockfile, iguales en `73e3023`)
(`docker build -f docker/<app>.Dockerfile -t os8-<app>:local .`, con `API_IMAGE=os8-api`, `WORKER_IMAGE=os8-worker`,
`WEB_IMAGE=os8-web` e `IMAGE_TAG=local`), los mismos servicios y banderas que `verify-artifact.sh`, y `object-store` en
lugar de `minio`. `verify-artifact.sh` todavía nombra `minio` (la 7.4 lo cambia), así que el `up` va a mano, en el
proyecto `os8-p`. Al terminar se ejecuta el `down -v` de `teardown-artifact.sh`, también en ese proyecto: el script
apunta al proyecto por defecto (`linkvault-prod`).

```text
$ docker compose -p os8-p -f docker-compose.prod.yml --env-file infra/ci/verify.env up -d --wait --wait-timeout 360 --pull never mongo redis object-store api worker web
 Network os8-p_internal Created
 Network os8-p_object-store-net Created
 Volume os8-p_object-store-data Created
 (…)
 Container os8-p-object-store-1 Healthy
 Container os8-p-mongo-1 Healthy
 Container os8-p-redis-1 Healthy
 Container os8-p-api-1 Healthy
 Container os8-p-worker-1 Healthy
 Container os8-p-web-1 Healthy
exit=0
$ timeout 180 docker compose -p os8-p … run --rm --no-deps api node object-store.js provision
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0
$ timeout 180 docker compose -p os8-p … run --rm --no-deps api node object-store.js verify
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
$ docker network ls --format '{{.Name}} {{.Internal}}'      # las de os8-p
os8-p_internal true
os8-p_object-store-net true
$ docker network inspect --format '{{range .Containers}}{{.Name}} {{end}}' <red>
os8-p_object-store-net: os8-p-object-store-1 os8-p-api-1 os8-p-worker-1
os8-p_internal: os8-p-redis-1 os8-p-mongo-1 os8-p-web-1 os8-p-api-1 os8-p-worker-1
$ docker run --rm --network os8-p_internal alpine:3 sh -c 'wget -S -T 5 -O /dev/null http://object-store:8888/; wget -S -T 5 -O /dev/null http://object-store:8333/'
wget: bad address 'object-store:8888'
wget 8888 exit=1
wget: bad address 'object-store:8333'
wget 8333 exit=1
```

Desde la red de mongo y redis, `object-store` no se resuelve: `bad address` en los dos puertos y ningún estado HTTP.
Desde `api`, en cambio, `verify` sale 0.

**Falsación:** un contenedor `alpine:3` con `sleep` en `os8-p_internal` no llega al filer. Unido a
`os8-p_object-store-net`, sí llega. Además, se prueba la IP del almacén desde `internal`: no hay ruta.

```text
$ docker run -d --name os8-probe --network os8-p_internal alpine:3 sleep 600
exit=0
$ docker exec os8-probe wget -S -T 5 -O /dev/null http://object-store:8888/
wget: bad address 'object-store:8888'
exit=1
IP del almacén en os8-p_object-store-net: 172.28.0.2
$ docker exec os8-probe wget -S -T 5 -O /dev/null http://172.28.0.2:8888/
Connecting to 172.28.0.2:8888 (172.28.0.2:8888)
wget: can't connect to remote host (172.28.0.2): Network unreachable
exit=1
$ docker network connect os8-p_object-store-net os8-probe
exit=0
$ docker exec os8-probe wget -S -T 5 -O /dev/null http://object-store:8888/
Connecting to object-store:8888 (172.28.0.2:8888)
  HTTP/1.1 200 OK
  Server: SeaweedFS 30GB 4.47
  (…)
'/dev/null' saved
exit=0
$ docker rm -f os8-probe
exit=0
$ docker compose -p os8-p -f docker-compose.prod.yml --env-file infra/ci/verify.env down -v --remove-orphans --timeout 30
exit=0
```

**(3) Desarrollo.** `pnpm infra:up` en el proyecto `os8-d`, desde volúmenes vacíos. Se exportan `COMPOSE_PROJECT_NAME`,
los puertos del bloque (`OBJECT_STORE_PORT=19840` y los demás) y `S3_ENDPOINT=http://localhost:19840`. Las
credenciales y la clave de prueba están en un `.env` del scratchpad: la clave se generó con la orden de ADR-052
«Elección» y no se imprime. `docker inspect` confirma que las tres claves del contenedor son las de ese fichero.

```text
$ pnpm infra:up
$ docker compose up -d --wait && pnpm nx run api:object-store -- provision
 Network os8-d_default Created
 Network os8-d_object-store-net Created
 (…)
 Container os8-d-object-store-1 Healthy
provision: ok
exit=0
$ docker inspect --format '{{json .Config.Env}}' os8-d-object-store-1      # comparado con node, sin imprimir valores
AWS_ACCESS_KEY_ID: el valor del .env del scratchpad
AWS_SECRET_ACCESS_KEY: el valor del .env del scratchpad
WEED_S3_SSE_KEK: el valor del .env del scratchpad
$ docker port os8-d-object-store-1
8333/tcp -> 0.0.0.0:19840
8333/tcp -> [::]:19840
$ docker run --rm --network os8-d_default alpine:3 sh -c 'wget -S -T 5 -O /dev/null http://object-store:8888/; wget -S -T 5 -O /dev/null http://object-store:8333/'
wget: bad address 'object-store:8888'
wget 8888 exit=1
wget: bad address 'object-store:8333'
wget 8333 exit=1
$ pnpm nx run api:object-store -- verify           # desde el host, por el puerto publicado
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
$ docker run --rm --network os8-d_default alpine:3 sh -c 'wget -S -T 5 -O /dev/null http://172.28.0.2:8888/'   # IP del almacén en os8-d_object-store-net
Connecting to 172.28.0.2:8888 (172.28.0.2:8888)
wget: download timed out
exit=1
$ docker network inspect --format '{{range .Containers}}{{.Name}} {{end}}' <red>
os8-d_object-store-net: os8-d-object-store-1
os8-d_default: os8-d-redis-1 os8-d-mailpit-1 os8-d-mongo-1
$ docker compose -p os8-d -f docker-compose.yml down -v --timeout 30
exit=0
```

Al terminar, no queda ningún contenedor, volumen ni red `os8`: `docker ps -a`, `docker volume ls` y
`docker network ls` filtrados por `os8` dan 0.

### 7.5b: bucket de CV ausente = error reintentable

Lector del `worker`: solo `NoSuchKey` y `NotFound` son «objeto ausente»; `NoSuchBucket` y cualquier otro `404` se
relanzan en `read` y en `remove` (design D15). Proyecto `os9-b` desde volúmenes vacíos, con `COMPOSE_PROJECT_NAME`, los
puertos del bloque 19900-19999 y las `S3_*` (`S3_ENDPOINT=http://localhost:19940`) exportados en el entorno de la
orden, sin tocar `.env`; `pnpm infra:up` sale 0 con «provision: ok».

**Hallazgo (design D17).** SeaweedFS 4.47 **crea el bucket** al recibir un `PutObject` firmado en uno que no existe, y
lo crea **sin cifrado por defecto**; `HeadBucket`, `GetObject` y `DeleteObject` no lo crean. Medido con el SDK
(`autocreate.mjs` del scratchpad; un bucket que nunca existió, `os9-never-b3`; `os9-never-b2` es el que creó la suite
completa de más abajo):

```text
$ node autocreate.mjs os9-never-b3
buckets before: cvs,os9-never-b2,snapshots
HeadBucket os9-never-b3: error name=NotFound HTTP 404
GetObject os9-never-b3/k: error name=NoSuchBucket HTTP 404
DeleteObject os9-never-b3/k: error name=NoSuchBucket HTTP 404
buckets after get+delete: cvs,os9-never-b2,snapshots
PutObject os9-never-b3/k: ok HTTP 200 {"ETag":"\"9dd4e461268c8034f5c8564e155c67a6\"","ChecksumCRC32":"jNwWgw=="}
buckets after put: cvs,os9-never-b2,os9-never-b3,snapshots
HeadObject os9-never-b3/k: ok HTTP 200 {"AcceptRanges":"bytes","LastModified":"2026-09-27T07:54:22.000Z","ContentLength":1,"ETag":"\"9dd4e461268c8034f5c8564e155c67a6\"","ContentType":"application/octet-stream","Metadata":{}}
GetBucketEncryption os9-never-b3: error name=ServerSideEncryptionConfigurationNotFoundError HTTP 404
GetBucketEncryption cvs: ok HTTP 200 {"ServerSideEncryptionConfiguration":{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":false}]}}
PutObject cvs/k: ok HTTP 200 {"ETag":"\"9dd4e461268c8034f5c8564e155c67a6\"","ChecksumCRC32":"jNwWgw==","ServerSideEncryption":"AES256"}
HeadObject cvs/k: ok HTTP 200 {"AcceptRanges":"bytes","LastModified":"2026-09-27T07:54:22.000Z","ContentLength":1,"ETag":"\"9dd4e461268c8034f5c8564e155c67a6\"","ContentType":"application/octet-stream","ServerSideEncryption":"AES25
DeleteObject cvs/k: ok HTTP 204 {}
exit=0
```

(`autocreate.mjs` recorta cada respuesta a 200 caracteres; por eso la línea de `HeadObject cvs/k` termina en `AES25`.)

Por eso la suite completa con un `S3_BUCKET` inexistente **no** puede mostrar el caso de `null` fallando: su primer
test sube un CV y crea el bucket. La verificación, reescrita por decisión del usuario del 2026-09-27, es el caso aislado
con un bucket que nunca existió:

```text
$ S3_CONTRACT=1 pnpm nx run worker:test --skip-nx-cache -- s3.s3-contract --reporter=verbose
 ✓ S3 contract of worker (real store) > reads the bytes that were written 251ms
 ✓ S3 contract of worker (real store) > deletes, and deleting again is still a success 22ms
WARN [S3CvFileReader] CV file not read: Error
 ✓ S3 contract of worker (real store) > tells a missing object (null) apart from a store that is down (error) 137ms
 ✓ S3 contract of worker (real store) > stores a gzipped snapshot in the snapshots bucket 219ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
exit=0

$ S3_CONTRACT=1 S3_BUCKET=os9-never-b1 pnpm nx run worker:test --skip-nx-cache -- s3.s3-contract --reporter=verbose -t "missing object"
WARN [S3CvFileReader] CV file not read: NoSuchBucket
 ↓ S3 contract of worker (real store) > reads the bytes that were written
 ↓ S3 contract of worker (real store) > deletes, and deleting again is still a success
 × S3 contract of worker (real store) > tells a missing object (null) apart from a store that is down (error) 36ms
   → promise rejected "NoSuchBucket: The specified bucket does n… { …(9) }" instead of resolving
 ↓ S3 contract of worker (real store) > stores a gzipped snapshot in the snapshots bucket
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  1 failed | 3 skipped (4)
exit=1

$ S3_CONTRACT=1 S3_BUCKET=os9-never-b2 pnpm nx run worker:test --skip-nx-cache -- s3.s3-contract --reporter=verbose   # suite completa: no vale como verificación
 ✓ S3 contract of worker (real store) > reads the bytes that were written 279ms
 ✓ S3 contract of worker (real store) > deletes, and deleting again is still a success 21ms
WARN [S3CvFileReader] CV file not read: Error
 ✓ S3 contract of worker (real store) > tells a missing object (null) apart from a store that is down (error) 170ms
 ✓ S3 contract of worker (real store) > stores a gzipped snapshot in the snapshots bucket 15ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
exit=0
```

- Con el bucket correcto, 4/4 en verde. El aviso `CV file not read: Error` es el del almacén caído (puerto cerrado) del
  mismo caso.
- Caso aislado con un bucket que nunca existió: **falla** con `NoSuchBucket` (en la 2.8, con MinIO, pasaba), y el aviso
  lleva solo el nombre del error, sin la clave.
- Suite completa con `os9-never-b2`: 4/4 en verde, porque el primer test creó el bucket (aparece en «buckets before» de
  la medición de arriba).

Falsación de los tests unitarios: con `NoSuchBucket` de vuelta en `MISSING_OBJECT`, `pnpm nx run worker:test -- s3-cv-file.reader`
sale 1 con 3 fallos, los de `NoSuchBucket` («does not confuse a missing CV bucket (NoSuchBucket, 404) with a missing
object», «NoSuchBucket (404): read and remove throw, so the queue retries», «NoSuchBucket: the warning names the error
and never the key»); restaurado, `pnpm nx run worker:test` completo sale 0 (64 ficheros, 628 tests, 1 fichero y 4 tests
saltados: la suite de contrato sin `S3_CONTRACT`).

`docker compose -p os9-b -f docker-compose.yml down -v --timeout 30` sale 0, y no queda ningún contenedor, volumen ni
red `os9`: `docker ps -a`, `docker volume ls` y `docker network ls` filtrados por `os9` dan 0.

### 7.5c: cabecera de cifrado en cada subida de CV

`createS3CvFileUploader` (`apps/api/src/modules/cv/infrastructure/s3-cv-file.store.ts`) manda
`ServerSideEncryption: 'AES256'` en cada `PutObjectCommand` (design D17). El modo C5 de la suite de contrato de `api`
escribe A1 y A2 con el cliente de la fábrica, sin cabeceras SSE, y sigue comprobando que no las llevan.

**Test y falsación.**

```text
$ pnpm nx run api:test --skip-nx-cache -- s3-cv-file.store             # antes de poner la cabecera
     × asks for server-side encryption (AES256) on every CV upload
-   "ServerSideEncryption": "AES256",
      Tests  1 failed | 4 passed (5)
exit=1
$ pnpm nx run api:test --skip-nx-cache -- s3-cv-file.store             # con la cabecera
      Tests  5 passed (5)
exit=0
$ pnpm nx run api:test --skip-nx-cache -- s3-cv-file.store             # falsación: cabecera quitada
     × asks for server-side encryption (AES256) on every CV upload
      Tests  1 failed | 4 passed (5)
exit=1
$ pnpm nx run api:test --skip-nx-cache                                  # restaurada
 Test Files  275 passed | 2 skipped (277)
      Tests  3665 passed | 16 skipped (3681)
exit=0
```

**Medición contra SeaweedFS.** Proyecto `os9-c` desde volúmenes vacíos, con `COMPOSE_PROJECT_NAME`, los puertos del
bloque 19900-19999 y las `S3_*` exportados en el entorno de la orden (sin tocar `.env`); `pnpm infra:up` sale 0 con
«provision: ok». `measure-75c.cjs` (scratchpad) borra `cvs` con el SDK, sube A1 (1 MiB) y A2 (1 KiB) con la
cabecera (el mismo `PutObject` que el adaptador; A1, el primero, es el que recrea el bucket) y, como falsación, B1 y B2,
distintos y de los mismos tamaños, sin ella, todos al bucket de CV:

```text
$ node measure-75c.cjs <dir>
buckets: cvs,snapshots
DeleteBucket cvs: ok HTTP 204
HeadBucket cvs: error name=NotFound HTTP 404
buckets: snapshots
PutObject A1 (1048576 bytes, ServerSideEncryption: 'AES256'): ok HTTP 200 ServerSideEncryption=AES256
PutObject A2 (1024 bytes, ServerSideEncryption: 'AES256'): ok HTTP 200 ServerSideEncryption=AES256
PutObject B1 (1048576 bytes, no SSE header): ok HTTP 200 ServerSideEncryption=(none)
PutObject B2 (1024 bytes, no SSE header): ok HTTP 200 ServerSideEncryption=(none)
buckets: cvs,snapshots
GetBucketEncryption cvs: error name=ServerSideEncryptionConfigurationNotFoundError HTTP 404
HeadObject A1: ok HTTP 200 ContentLength=1048576 ServerSideEncryption=AES256
GetObject A1: same bytes
HeadObject A2: ok HTTP 200 ContentLength=1024 ServerSideEncryption=AES256
GetObject A2: same bytes
HeadObject B1: ok HTTP 200 ContentLength=1048576 ServerSideEncryption=(none)
GetObject B1: same bytes
HeadObject B2: ok HTTP 200 ContentLength=1024 ServerSideEncryption=(none)
GetObject B2: same bytes
measure-75c: ok
exit=0
```

`cvs` se recreó con la primera subida y **sin cifrado por defecto**, y aun así A1 y A2 vuelven con `AES256`; B1 y B2,
sin la cabecera, sin él. El disco, con el método de `c5.sh` (almacén detenido, `tar` del volumen con `alpine`,
`find-plaintext.mjs` con la clave del almacén por el entorno):

```text
$ docker compose -f docker-compose.yml stop object-store                      # COMPOSE_PROJECT_NAME=os9-c
exit=0
$ docker run --rm -v os9-c_object-store-data:/data:ro -v <dir>:/out alpine:3 tar -C /data -cf /out/c-vol.tar .
exit=0
$ C5_KEY_TEXT=<OBJECT_STORE_SSE_KEY> node docs/object-store-matrix/find-plaintext.mjs <dir>/c-vol.tar <dir>
find-plaintext: c-vol.tar, 2293760 bytes leídos
A1 0/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
A2 0/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
B1 3/3  (1048576 bytes; ventanas de 64 bytes en 0, 524256, 1048512)
B2 3/3  (1024 bytes; ventanas de 64 bytes en 0, 480, 960)
clave 0/3  (textual no; decodificada (hex, 32 bytes) no; decodificada (base64, 48 bytes) no)
exit=0
```

**Con la cabecera, A1 y A2 no aparecen en claro (0/3); sin ella, B1 y B2 sí (3/3)**, en el mismo volumen y el mismo
bucket autocreado. Así B1 y B2 son a la vez la falsación y el control que hace concluyente la lectura. La clave no está
en el volumen.

**El almacén de nuevo arriba, `provision`, `verify` y la suite de contrato de `api` con el modo C5:**

```text
$ docker compose -f docker-compose.yml up -d --wait object-store
exit=0
$ pnpm nx run api:object-store -- provision
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
ok    cvs: anonymous GET of an existing object rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous listing rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous PUT rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous GET of a missing object rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous listing rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous PUT rejected (HTTP 403 AccessDenied)
verify: ok
exit=0
$ S3_CONTRACT=1 S3_CONTRACT_C5_DIR=<dir>/c-c5 pnpm nx run api:test --skip-nx-cache -- s3.s3-contract --reporter=verbose
 ✓ S3 contract of api (real store) > runs with the checksum policy it was asked for 1ms
 ✓ S3 contract of api (real store) > uploads a CV with the real adapter and the same bytes come back 46ms
 ✓ S3 contract of api (real store) > deletes a prefix of 1001 keys in two DeleteObjects batches and leaves it empty 1444ms
 ✓ S3 contract of api (real store) > C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them 330ms
 ↓ S3 contract of api (real store) > C5 SSE-C mode: writes A1/A2 with SSE-C and requires the SSECustomerKeyMD5 echo, B1/B2 without SSE, and dumps them
 Test Files  1 passed (1)
      Tests  4 passed | 1 skipped (5)
exit=0
$ node -e "…manifest.json del modo C5…"                   # objeto, bucket, bytes, ServerSideEncryption que informa el almacén
A1 cvs 1048576 AES256
A2 cvs 1024 AES256
B1 snapshots 1048576 none reported
B2 snapshots 1024 none reported
mode server
```

`provision` vuelve a poner el cifrado por defecto en el `cvs` recreado, y `verify` sale 0. El `GET` anónimo a `cvs` es
«of an existing object» porque el bucket ya tiene objetos (los de la medición). En modo C5, A1 y A2, subidos **sin**
cabecera, vuelven con `AES256` por el cifrado por defecto del bucket: C5 sigue midiendo lo que medía.

`docker compose -p os9-c -f docker-compose.yml down -v --timeout 30` sale 0, y no queda ningún contenedor, volumen ni
red `os9`: `docker ps -a`, `docker volume ls` y `docker network ls` filtrados por `os9` dan 0.

### 7.5: sonda `s3-probe` del `worker`

Punto de entrada adicional del build de webpack de `worker` (`additionalEntryPoints`, `dist/apps/worker/s3-probe.js`).
Con la fábrica de cliente S3 del `worker` (un solo cliente) hace un `HeadBucket` firmado del bucket de CV; si falla,
sale ≠0 nombrando el bucket y no lee. Después lee, con el lector de CV del `worker` (`S3CvFileReader` sobre ese mismo
cliente), una clave ausente de `.verify-probe/` y exige `null`; cualquier error o un objeto con bytes sale ≠0.
Configuración: solo las `S3_*` que usa, con los campos del esquema del `worker`; si no es válida, sale 2 nombrando las
variables, sin sus valores. Modo de cifrado `server` (6.2), así que no hay middleware SSE-C que llevar (8.3 no aplica).

**Tests y falsación.** `pnpm nx run worker:test` completo, redirigido a fichero: 0 (65 ficheros, 640 tests). La sonda
tiene 12 tests:
- con dobles: lector que da `null` con el bucket presente → 0; lector que lanza → 1; lector que lanza `NoSuchBucket`
  → 1; clave con bytes → 1; `HeadBucket` con `NoSuchBucket`, `NotFound` o un `404` sin nombre conocido → 1 con
  «cvs: CV bucket does not exist» y sin lectura; `HeadBucket` con `403` → 1 con «could not be checked» y sin lectura;
  configuración inválida → 2;
- con el cliente real de la fábrica y `send` falso: `HeadBucket {Bucket: cvs}` y `GetObject` de `.verify-probe/…` en
  `cvs`, `NoSuchKey` → 0; `NoSuchBucket` en el `GetObject` → 1; `NotFound` en el `HeadBucket` → 1 sin `GetObject`.

Falsación: con el fallo del `HeadBucket` convertido en no fatal (la sonda sigue a la lectura), caen los cinco tests
del `HeadBucket`; restaurado:

```text
$ pnpm nx run worker:test --skip-nx-cache -- s3-probe                  # HeadBucket no fatal
     × HeadBucket with NoSuchBucket (404): exits non-zero naming the bucket, without reading 5ms
     × HeadBucket with NotFound (404): exits non-zero naming the bucket, without reading 1ms
     × HeadBucket with a 404 without a known name: exits non-zero naming the bucket, without reading 1ms
     × HeadBucket refused (403): exits non-zero naming the bucket, without reading 1ms
     × HeadBucket NotFound with the real client: non-zero naming the bucket, and no GetObject 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  1 failed (1)
      Tests  5 failed | 7 passed (12)
exit=1
```

**Ejecución del paquete, fuera del contenedor.** Contra el almacén local, proyecto `os9-p` desde volúmenes vacíos con
`pnpm infra:up` (0, «provision: ok»), `pnpm nx run worker:build` (0) y `node dist/apps/worker/s3-probe.js` con las
`S3_*` exportadas. Son el equivalente local de las falsaciones que la tarea pide **contra la pila de la 7.7**, con
`dc run --rm --no-deps worker node s3-probe.js`, que siguen pendientes:

```text
$ node dist/apps/worker/s3-probe.js                                   # bucket presente
ok    cvs: CV bucket exists (signed HeadBucket)
ok    cvs: a missing key under .verify-probe/ reads as null with the CV reader
s3-probe: ok
exit=0
$ S3_SECRET_KEY=incorrecta node dist/apps/worker/s3-probe.js
FAIL  cvs: CV bucket could not be checked (Unknown, HTTP 403)
s3-probe: failed
exit=1
$ S3_BUCKET= node dist/apps/worker/s3-probe.js                         # configuración inválida
[s3-probe] Invalid configuration, check these environment variables: S3_BUCKET (missing)
exit=2
$ node delete-cvs.cjs                                                  # borra el bucket de CV con el SDK
buckets: cvs,snapshots
DeleteBucket cvs: HTTP 204
buckets: snapshots
exit=0
$ node dist/apps/worker/s3-probe.js                                   # bucket de CV borrado
FAIL  cvs: CV bucket does not exist (HeadBucket: NotFound, HTTP 404)
s3-probe: failed
exit=1
$ pnpm nx run api:object-store -- provision
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket already exists
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0
$ node dist/apps/worker/s3-probe.js                                   # tras provision
ok    cvs: CV bucket exists (signed HeadBucket)
ok    cvs: a missing key under .verify-probe/ reads as null with the CV reader
s3-probe: ok
exit=0
```

Sin la línea en `verify-artifact.sh`: la tarea la pone «tras `verify`», y `verify-artifact.sh` todavía no tiene
`provision` ni `verify` (los añade la 7.4) y sigue nombrando `minio`. La línea, «en 7.7, la línea en 0» y las dos
falsaciones con `dc run` (`-e S3_SECRET_KEY=incorrecta`, y borrar el bucket → ≠0 → `provision` → 0) quedan para la
7.4 y la 7.7. **Hechas:** ver «7.4, 7.5 y 7.7», más abajo.

`docker compose -p os9-p -f docker-compose.yml down -v --timeout 30` sale 0, y no queda ningún contenedor, volumen ni
red `os9`: `docker ps -a`, `docker volume ls` y `docker network ls` filtrados por `os9` dan 0.

### 7.4, 7.5 y 7.7: el almacén en la verificación del artefacto

**Qué cambia en `infra/ci/verify-artifact.sh` (7.4 y la línea de la 7.5).** `SERVICES` y `THIRD_PARTY_SERVICES`
nombran `object-store` en lugar de `minio`. Después del `up`, el script imprime el tiempo hasta `healthy` de cada
servicio y ejecuta tres órdenes, cada una con `timeout 180` y un `|| fail` de clase `artifact`:
`run --rm --no-deps api node object-store.js provision`, la misma con `verify` y, tras `verify`,
`run --rm --no-deps worker node s3-probe.js`. `timeout` ejecuta un programa, no una función de la shell, así que no
puede envolver a `dc`: las tres van por `dc_bounded`, que es la misma orden de Compose con el plazo delante
(`RUN_TIMEOUT=180`). `infra/ci/verify.env` no cambia aquí: la sustitución de `MINIO_KMS_SECRET_KEY` por
`OBJECT_STORE_SSE_KEY` se adelantó a la 7.3.

El tiempo hasta `healthy` sale del mismo método que C9 (4.4): el fin del primer sondeo con salida 0 de
`.State.Health.Log` menos `.State.StartedAt`, leídos con `docker inspect` y una plantilla Go, sin `node` ni `jq`. Docker
guarda solo los cinco últimos sondeos, y no guarda los fallidos dentro de `start_period` (medido al escribirlo, con un
contenedor `alpine` cuyo sondeo falla los tres primeros segundos: el registro solo tenía los sondeos con 0). Por eso,
con el registro lleno, el primer sondeo sano puede haberse perdido, y la línea da una cota superior («<=») y lo dice.

```text
$ bash -n infra/ci/verify-artifact.sh
exit=0
```

**7.7 en local (`amd64`).** Imágenes construidas desde un árbol limpio de `4bc29ec` (un `git worktree` aparte en el
scratchpad, para que ningún cambio sin confirmar entrara en el contexto de build): `docker build -f
docker/<app>.Dockerfile -t os10-<app>:local .`, las tres en 0. El proyecto de Compose es `os10-v`, fijado con
`COMPOSE_PROJECT_NAME`, que gana al `name: linkvault-prod` del compose (`config --format json` da `"name": "os10-v"`),
y así `verify-artifact.sh` y `teardown-artifact.sh` corren **sin tocarlos**. La pila no publica puertos (Traefik fuera),
así que no choca con ninguna otra.

```text
$ COMPOSE_PROJECT_NAME=os10-v API_IMAGE=os10-api WORKER_IMAGE=os10-worker WEB_IMAGE=os10-web IMAGE_TAG=local \
    VERIFY_FAIL_CLASS_FILE=<scratchpad>/fail-class.txt bash infra/ci/verify-artifact.sh
=== Imágenes cargadas en el daemon del corredor
  os10-api:local -> sha256:de73bbf4e4e3757d1ffa46da0b50c9914171e359ab334417a5b3ed886c43739c
  os10-worker:local -> sha256:6311a8746818bcfc0af367cbdf0b5f81606195ed69618ab91a4bf80db1a02d58
  os10-web:local -> sha256:031cb01bf906a650370cc1aee093eed3b47c0e64bd7ca704525037699872e309

=== Imágenes que resuelve el compose
traefik:v3.3.5
mongo:7.0.43
redis:7.4.11
chrislusf/seaweedfs:4.47
os10-api:local
os10-worker:local
os10-web:local

=== pull de las imágenes de terceros (mongo redis object-store)
 (…)
=== up -d --wait --wait-timeout 360 --pull never mongo redis object-store api worker web
 (…)
 Container os10-v-object-store-1 Healthy
 Container os10-v-redis-1 Healthy
 Container os10-v-mongo-1 Healthy
 Container os10-v-web-1 Healthy
 Container os10-v-worker-1 Healthy
 Container os10-v-api-1 Healthy

=== Estado tras el up
 (…)
=== Tiempo hasta healthy de cada servicio (docker inspect)
  mongo        estado healthy; hasta healthy: 5.04 s (sondeos guardados: 3)
  redis        estado healthy; hasta healthy: 5.03 s (sondeos guardados: 2)
  object-store estado healthy; hasta healthy: 1.19 s (sondeos guardados: 2)
  api          estado healthy; hasta healthy: 5.34 s (sondeos guardados: 1)
  worker       estado healthy; hasta healthy: 5.30 s (sondeos guardados: 1)
  web          estado healthy; hasta healthy: 5.17 s (sondeos guardados: 1)

=== object-store: provision (run --rm --no-deps api node object-store.js provision)
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok

=== object-store: verify (run --rm --no-deps api node object-store.js verify)
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

=== worker: lectura del bucket de CV (run --rm --no-deps worker node s3-probe.js)
ok    cvs: CV bucket exists (signed HeadBucket)
ok    cvs: a missing key under .verify-probe/ reads as null with the CV reader
s3-probe: ok
traefik no se levantó (correcto: el borde queda fuera del alcance)

=== mongo: replica set de un nodo y primario escribible
rs0 con 1 miembro, estado PRIMARY, primario escribible: mongo:27017

=== api: GET /health con mongo y redis
{"status":"up","service":"api","version":"0.0.0","checks":{"mongo":{"status":"up"},"redis":{"status":"up"}}}

=== worker: GET /health con mongo y redis
{"status":"up","service":"worker","version":"0.0.0","checks":{"mongo":{"status":"up"},"redis":{"status":"up"}}}
 (…)
web sirve el documento del SPA (<lv-root> presente)
 (…)
=== Artefacto verificado
api, worker y web arrancan y responden con la configuración de producción real.
exit=0 (32 s); fichero de clase: no se escribió
```

Los tiempos son de un portátil `amd64` y solo informan: el plazo lo recalcula la 11.1 con tres corridas `arm64`. Esta
es la segunda corrida; la primera, sobre la misma pila y antes de retocar el texto de la sección de tiempos, salió
igual (0, `object-store` sano en 2.24 s).

**Falsaciones de la 7.5 con `dc run`, contra esta pila** (antes de su `teardown-artifact.sh`). `dc` es
`docker compose -f docker-compose.prod.yml --env-file infra/ci/verify.env`, con el mismo `COMPOSE_PROJECT_NAME`. El
bucket de CV se borra con un `node -e` del SDK que corre en un contenedor de `api` (la pila no publica el almacén: solo
se llega por `object-store-net`), con sus propias `S3_*`:

```text
$ timeout 180 dc run --rm --no-deps -e S3_SECRET_KEY=incorrecta worker node s3-probe.js
FAIL  cvs: CV bucket could not be checked (Unknown, HTTP 403)
s3-probe: failed
exit=1
$ timeout 180 dc run --rm --no-deps api node -e "<DeleteBucket del bucket de CV con el SDK>"
buckets: cvs,snapshots
DeleteBucket cvs: HTTP 204
buckets: snapshots
exit=0
$ timeout 180 dc run --rm --no-deps worker node s3-probe.js
FAIL  cvs: CV bucket does not exist (HeadBucket: NotFound, HTTP 404)
s3-probe: failed
exit=1
$ timeout 180 dc run --rm --no-deps api node object-store.js provision
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket already exists
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0
$ timeout 180 dc run --rm --no-deps worker node s3-probe.js
ok    cvs: CV bucket exists (signed HeadBucket)
ok    cvs: a missing key under .verify-probe/ reads as null with the CV reader
s3-probe: ok
exit=0
```

**Falsación de los tres pasos nuevos del script** (guardias permanentes, ADR-048 §7), sobre la misma pila de la
primera corrida y con tres copias del script en el scratchpad, rotas a mano, ejecutadas desde la raíz del repositorio
con `VERIFY_FAIL_CLASS_FILE`; el script del repositorio no se tocó:

```text
$ bash <scratchpad>/broken-verify.sh           # 'object-store.js verify' → 'verify-broken'
provision: ok
usage: object-store <provision|verify>
[FAIL/artifact] object-store verify salió ≠0 (o superó 180 s): el almacén no está como se entrega
exit=1 class=artifact
$ bash <scratchpad>/broken-probe.sh            # la sonda con '-e S3_SECRET_KEY=incorrecta'
verify: ok
FAIL  cvs: CV bucket could not be checked (Unknown, HTTP 403)
s3-probe: failed
[FAIL/artifact] worker s3-probe salió ≠0 (o superó 180 s): el worker no alcanza el bucket de CV con su configuración
exit=1 class=artifact
$ bash <scratchpad>/broken-timeout.sh          # RUN_TIMEOUT=1
provision: ok
[FAIL/artifact] object-store provision salió ≠0 (o superó 1 s): el almacén no quedó aprovisionado
exit=1 class=artifact
```

En la del plazo, `provision` llega a imprimir `provision: ok` y `timeout` mata a Compose antes de que termine de
retirar el contenedor de un solo uso: el `run` sale ≠0 y el script falla, que es lo que se quería ver. No quedó ningún
contenedor `os10-v-api-run-*` detrás (`docker ps -a`).

**Derribo.**

```text
$ COMPOSE_PROJECT_NAME=os10-v bash infra/ci/teardown-artifact.sh
 Container os10-v-web-1 Removed
 Container os10-v-worker-1 Removed
 Container os10-v-api-1 Removed
 Container os10-v-redis-1 Removed
 Container os10-v-mongo-1 Removed
 Container os10-v-object-store-1 Removed
 Volume os10-v_object-store-data Removed
 Volume os10-v_redis-data Removed
 Volume os10-v_mongo-data Removed
 Network os10-v_object-store-net Removed
 Network os10-v_internal Removed
exit=0
```

`docker ps -a`, `docker volume ls` y `docker network ls` filtrados por `os10`: 0, 0 y 0.

**Pendiente en el script, de otras tareas:** los comentarios que aún nombran MinIO (la cabecera y la tabla del plazo)
los corrige la 12.3, y la tabla con los números nuevos, la 11.1.

### 7.6: `docs-stack-up` con las órdenes `run` de después del `up`

`tools/repo-checks/src/docs-stack-up.check.mjs` lee, en cada lado, las órdenes `run` que van **después** de su `up`
(desde `run` hasta el final de la orden) y añade dos comprobaciones (design D5, ADR-052 §5): la **absoluta**, que en
cada lado por separado exige `run --rm --no-deps api node object-store.js provision` y después la de `verify`; y la
**relativa**, que exige las mismas órdenes en el mismo orden en los dos. En el README, además, cada `run` tiene que usar
el mismo fichero de compose que su `up`. El bloque marcado de `infra/README.md` levanta `object-store`, genera
`OBJECT_STORE_SSE_KEY` con la orden de ADR-052 «Elección» en vez de `MINIO_KMS_SECRET_KEY`, y añade las tres órdenes
`run` del script con `timeout 180`.

```text
$ bash infra/ci/repo-checks.sh
check(docs-stack-up): OK — el 'up' documentado en infra/README.md y el de infra/ci/verify-artifact.sh coinciden: docker-compose.prod.yml, 6 servicios (api, mongo, object-store, redis, web, worker), --wait --wait-timeout 360 --pull never, sin traefik; y después del 'up', en los dos, provision y después verify, con las mismas 3 órdenes 'run' en el mismo orden
repo-checks: 5 comprobaciones ejecutadas (…)
exit=0
```

Falsación (`<scratchpad>/falsify-76.cjs`: modifica los dos ficheros, ejecuta la comprobación y restaura siempre):

```text
--- (a) sin provision ni verify en los dos lados
check(docs-stack-up): FALLA — 4 hallazgo(s)
  - infra/README.md no ejecuta, después de su 'up', 'run --rm --no-deps api node object-store.js provision': el almacén quedaría sin buckets ni cifrado del bucket de CV
  - infra/README.md no ejecuta, después de su 'up', 'run --rm --no-deps api node object-store.js verify': nada comprobaría el almacén que se entrega
  - infra/ci/verify-artifact.sh no ejecuta, después de su 'up', 'run --rm --no-deps api node object-store.js provision': el almacén quedaría sin buckets ni cifrado del bucket de CV
  - infra/ci/verify-artifact.sh no ejecuta, después de su 'up', 'run --rm --no-deps api node object-store.js verify': nada comprobaría el almacén que se entrega
exit=1
--- (b) provision y verify intercambiados solo en el README
check(docs-stack-up): FALLA — 2 hallazgo(s)
  - infra/README.md ejecuta 'verify' antes que 'provision': el orden es up → provision → verify
  - las órdenes 'run' tras el 'up' no son las mismas o no van en el mismo orden: infra/README.md documenta [run --rm --no-deps api node object-store.js verify ; run --rm --no-deps api node object-store.js provision ; run --rm --no-deps worker node s3-probe.js] y infra/ci/verify-artifact.sh ejecuta [run --rm --no-deps api node object-store.js provision ; run --rm --no-deps api node object-store.js verify ; run --rm --no-deps worker node s3-probe.js]
exit=1
--- restaurado
check(docs-stack-up): OK — (…)
exit=0
```

En (a) los dos lados siguen siendo iguales entre sí (solo queda la sonda del `worker`), así que falla solo la absoluta,
nombrando cada fichero. En (b) falla la relativa y, además, la absoluta del README, porque `verify` va antes.

### 7.8: `cd-staging` en modo de prueba desde la rama (`amd64`)

**Antes de lanzarla**, leído en `.github/workflows/cd-staging.yml` de la rama: con `workflow_dispatch` y
`dry_run: true`, el paso «Publish verified artifact to GHCR» no se ejecuta (`if: github.event_name !=
'workflow_dispatch' || inputs.dry_run != true`), y `deploy-staging` solo corre con `needs.preflight.outputs.state ==
'full'`; `gh secret list` no da ningún secreto de repositorio, así que el preflight da `none`. El workflow ya está en
la rama por defecto, así que se lanza con `gh workflow run` sin tocarlo (sin commit temporal).

```text
$ gh workflow run cd-staging.yml --ref change/object-store -f dry_run=true
https://github.com/manuXD270516/linkvault/actions/runs/36306343252
$ gh run view 36306343252 --json conclusion,jobs,headSha,event,url > <scratchpad>/run-78.json   # leído con node
conclusion: success | headSha: 9bd0708df2cb381fc0f8ecff621d077f31c3366a | event: workflow_dispatch
job: preflight (¿hay destino de staging configurado?) | success
job: verify (lint, specs, typecheck, test, build) | success
job: build, verify and publish artifact | success
   step: Verify artifact (docker-compose.prod.yml stack in the runner) | success
   step: Publish verified artifact to GHCR (docker push of the loaded image) | skipped
   step: Tear down verification stack | success
job: resultado: artefacto verificado — NO desplegado (sin destino de staging) | success
job: deploy staging (solo si hay destino configurado) | skipped
$ gh api repos/manuXD270516/linkvault/actions/jobs/108584921159      # labels del job, leído con node
labels: ubuntu-24.04
```

Del log del paso de verificación (`gh run view 36306343252 --log --job 108584921159`, volcado a fichero y leído con
`node`; sin las líneas `Creating`/`Created` de los contenedores de un solo uso):

```text
=== up -d --wait --wait-timeout 360 --pull never mongo redis object-store api worker web
 (…)
 Container linkvault-prod-object-store-1  Healthy
 Container linkvault-prod-worker-1  Healthy
 Container linkvault-prod-api-1  Healthy

=== Tiempo hasta healthy de cada servicio (docker inspect)
  mongo        estado healthy; hasta healthy: 5.33 s (sondeos guardados: 3)
  redis        estado healthy; hasta healthy: 5.37 s (sondeos guardados: 2)
  object-store estado healthy; hasta healthy: 1.37 s (sondeos guardados: 2)
  api          estado healthy; hasta healthy: 5.49 s (sondeos guardados: 1)
  worker       estado healthy; hasta healthy: 5.53 s (sondeos guardados: 1)
  web          estado healthy; hasta healthy: 5.41 s (sondeos guardados: 1)

=== object-store: provision (run --rm --no-deps api node object-store.js provision)
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok

=== object-store: verify (run --rm --no-deps api node object-store.js verify)
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

=== worker: lectura del bucket de CV (run --rm --no-deps worker node s3-probe.js)
ok    cvs: CV bucket exists (signed HeadBucket)
ok    cvs: a missing key under .verify-probe/ reads as null with the CV reader
s3-probe: ok
traefik no se levantó (correcto: el borde queda fuera del alcance)
 (…)
=== Artefacto verificado
api, worker y web arrancan y responden con la configuración de producción real.
```

Del job de reporte: estado de commit `success` en `9bd0708`, «Artefacto verificado. NO desplegado: no hay destino de
staging configurado (ADR-048 §3).». Y nada publicado: en el log del job no hay `docker push` ni `publish-artifact`, y
`gh api user/packages/container/<paquete>/versions --paginate`, leído con `node`, no da ninguna versión con el tag
`sha-9bd0708df2cb` en `linkvault-api`, `linkvault-worker` ni `linkvault-web`.

Es la primera corrida en el corredor con el almacén: `amd64`, sin `TARGET_PLATFORM`. Los tiempos hasta `healthy` no
cuentan para la 11.1, que pide tres corridas `arm64`.

## Retención por barrido (tarea 8.7)

Barrido de snapshots (8.5) ejecutado contra el almacén elegido, **SeaweedFS 4.47** con la configuración entregada
(`docker-compose.yml` de la 7.1, `pnpm infra:up` de la 7.2), con el reloj adelantado 31 días. Es la evidencia «barrido
de snapshots ejecutado contra el almacén elegido» de `platform/object-store`. La retención es `sweep` desde la 2.3:
`provision` no pone regla de ciclo de vida y quita la que haya.

**Qué se adelanta y cómo.** No hay forma de escribir en el almacén un objeto con `LastModified` de hace más de 31 días,
así que se adelanta el reloj **inyectado**, no el del proceso: el `CLOCK` del caso de uso `SweepExpiredSnapshots` y el
`now` de `object-store verify` (`runObjectStoreCli`, el mismo que usa `object-store.ts`). Adelantar el reloj del proceso
movería también la fecha de la firma SigV4 y el almacén rechazaría las peticiones. Los dos lados miden la antigüedad con
el mismo reloj adelantado, así que un snapshot escrito un momento antes tiene, para los dos, 31 días y unos segundos:
más de 30 para el barrido y más de 31 para `verify`.

**Punto de entrada.** No existía uno para lanzar el barrido a mano con el reloj adelantado, y no se añade ninguno al
producto (un barrido con el reloj desplazado dentro de la imagen del `worker` sería una forma de borrar todos los
snapshots). Se usa este script, fuera del repo, que carga el **código fuente real** de `api` y `worker` con el registro
SWC del repo (`apps/api/register-nest-cli.cjs`, el de `object-store.cjs`) y solo inyecta el reloj; todo lo demás
—fábricas de cliente S3, adaptadores `S3SnapshotStore` y `S3SnapshotBucket`, caso de uso, `verify`— es el del
producto. El barrido corre sin el `ScheduleModule`: la programación diaria y el cableado en `EnrichmentModule` los
comprueba la 8.6.

```js
'use strict';
// Tarea 8.7 de `object-store`: barrido de snapshots contra el almacén con el reloj adelantado.
// Carga el código fuente real (api y worker) con el registro SWC del repo; solo el reloj se inyecta.
//   node sweep-31d.cjs write               -> S3SnapshotStore.save (worker) de un snapshot de prueba
//   node sweep-31d.cjs verify <días>       -> runObjectStoreCli(['verify']) (api) con now = ahora + días
//   node sweep-31d.cjs sweep <días>        -> SweepExpiredSnapshots + S3SnapshotBucket (worker) con now = ahora + días
//   node sweep-31d.cjs list                -> ListObjectsV2 del bucket de snapshots (fábrica del worker)
const root = 'D:/projects/linkvault';
require(`${root}/apps/api/register-nest-cli.cjs`);
const DAY_MS = 86_400_000;
const [step, daysArg] = process.argv.slice(2);
const offsetDays = Number(daysArg ?? '0');
const shiftedNow = () => new Date(Date.now() + offsetDays * DAY_MS);
const env = process.env;
const settings = {
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  accessKey: env.S3_ACCESS_KEY,
  secretKey: env.S3_SECRET_KEY,
};
const w = `${root}/apps/worker/src`;

async function main() {
  if (step === 'write') {
    const { createS3SnapshotUploader, S3SnapshotStore } = require(`${w}/modules/enrichment/infrastructure/storage/s3-snapshot.store.ts`);
    const store = new S3SnapshotStore(createS3SnapshotUploader({ ...settings, bucket: env.S3_SNAPSHOTS_BUCKET }));
    const linkId = require('node:crypto').randomBytes(12).toString('hex');
    const key = await store.save(linkId, 1, '<html><body>snapshot 8.7</body></html>');
    process.stdout.write(`written: ${key}\n`);
    return key === null ? 1 : 0;
  }
  if (step === 'verify') {
    process.stdout.write(`verify clock: ${shiftedNow().toISOString()} (now + ${offsetDays} days)\n`);
    const { runObjectStoreCli } = require(`${root}/apps/api/src/infrastructure/storage/object-store/object-store.cli.ts`);
    return runObjectStoreCli(['verify'], {
      env,
      now: shiftedNow,
      io: { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) },
    });
  }
  if (step === 'sweep') {
    process.stdout.write(`sweep clock: ${shiftedNow().toISOString()} (now + ${offsetDays} days)\n`);
    const { SweepExpiredSnapshots } = require(`${w}/modules/enrichment/application/sweep-expired-snapshots.usecase.ts`);
    const { S3SnapshotBucket, createS3SnapshotBucketClient } = require(`${w}/modules/enrichment/infrastructure/storage/s3-snapshot.bucket.ts`);
    const sweep = new SweepExpiredSnapshots(
      new S3SnapshotBucket(createS3SnapshotBucketClient(settings)),
      { now: shiftedNow },
      { snapshotsBucket: env.S3_SNAPSHOTS_BUCKET, cvBucket: env.S3_BUCKET },
    );
    const result = await sweep.execute();
    process.stdout.write(`result: ${JSON.stringify(result)}\n`);
    return result.status === 'swept' && result.failed === 0 ? 0 : 1;
  }
  if (step === 'list') {
    const { ListObjectsV2Command } = require(require.resolve('@aws-sdk/client-s3', { paths: [root] }));
    const { createS3Client } = require(`${w}/infrastructure/storage/s3-client.factory.ts`);
    const out = await createS3Client(settings).send(new ListObjectsV2Command({ Bucket: env.S3_SNAPSHOTS_BUCKET }));
    const objects = (out.Contents ?? []).map((o) => `${o.Key} ${o.LastModified.toISOString()}`);
    process.stdout.write(`${env.S3_SNAPSHOTS_BUCKET}: ${objects.length} object(s)${objects.map((o) => `\n  ${o}`).join('')}\n`);
    return 0;
  }
  process.stderr.write('usage: sweep-31d.cjs <write|verify <days>|sweep <days>|list>\n');
  return 2;
}
main().then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`failed: ${e && e.name}: ${e && e.message}\n`); process.exitCode = 1; });
```

**Ejecución.** Proyecto `os11-s` desde volúmenes vacíos, puertos del bloque 19950-19999 y `S3_ACCESS_KEY`,
`S3_SECRET_KEY` y `OBJECT_STORE_SSE_KEY` de prueba exportados en la orden (sin tocar `.env`). `pnpm infra:up` sale 0:

```text
$ docker compose -p os11-s ps --format '{{.Service}} {{.Image}} {{.Status}}'
mailpit axllent/mailpit:v1.27.7 Up About a minute (healthy)
mongo mongo:7.0.43 Up About a minute (healthy)
object-store chrislusf/seaweedfs:4.47 Up About a minute (healthy)
redis redis:7.4.11 Up About a minute (healthy)
$ pnpm infra:up                                    # final de la salida
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
ok    snapshots: no lifecycle configuration (removed if there was one)
ok    snapshots: no bucket policy
provision: ok
exit=0
```

Secuencia, con `NO_COLOR=1` y las `S3_*` del proyecto exportadas. Además de lo que pide la tarea (`verify 31` ≠0
nombrando el snapshot → `sweep 31` → `verify 31` en 0), dos controles con el reloj **sin** adelantar: `verify 0` en 0 con
el snapshot presente (lo que hace fallar a `verify` es la antigüedad, no que haya un snapshot) y `sweep 0`, que lista el
snapshot y no lo borra (lo que lo borra es el reloj, no el barrido en sí):

```text
$ node sweep-31d.cjs write
written: 703586067d106b5ac8bafc53/1.html.gz
exit=0

$ node sweep-31d.cjs list
snapshots: 1 object(s)
  703586067d106b5ac8bafc53/1.html.gz 2026-09-27T08:19:08.000Z
exit=0

$ node sweep-31d.cjs verify 0
verify clock: 2026-09-27T08:19:08.420Z (now + 0 days)
ok    cvs: bucket exists
ok    snapshots: bucket exists
ok    cvs: no lifecycle rule
ok    cvs: default encryption (AES256)
ok    snapshots: no lifecycle rule
ok    snapshots: no snapshot older than 31 days (1 listed)
ok    cvs: anonymous GET of a missing object rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous listing rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous PUT rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous GET of an existing object rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous listing rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous PUT rejected (HTTP 403 AccessDenied)
verify: ok
exit=0

$ node sweep-31d.cjs verify 31
verify clock: 2026-10-28T08:19:09.036Z (now + 31 days)
ok    cvs: bucket exists
ok    snapshots: bucket exists
ok    cvs: no lifecycle rule
ok    cvs: default encryption (AES256)
ok    snapshots: no lifecycle rule
FAIL  snapshots: snapshot 703586067d106b5ac8bafc53/1.html.gz is 31 days old (more than 31); is the worker sweep running?
ok    cvs: anonymous GET of a missing object rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous listing rejected (HTTP 403 AccessDenied)
ok    cvs: anonymous PUT rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous GET of an existing object rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous listing rejected (HTTP 403 AccessDenied)
ok    snapshots: anonymous PUT rejected (HTTP 403 AccessDenied)
verify: FAILED (1): snapshots: snapshot 703586067d106b5ac8bafc53/1.html.gz is 31 days old (more than 31); is the worker sweep running?
exit=1

$ node sweep-31d.cjs sweep 0
sweep clock: 2026-09-27T08:19:09.742Z (now + 0 days)
[Nest] 79724  - 09/27/2026, 4:19:10 AM     LOG [SweepExpiredSnapshots] snapshot sweep: listed 1, expired 0, deleted 0, already gone 0, failed 0
result: {"status":"swept","listed":1,"expired":0,"deleted":0,"alreadyGone":0,"failed":0}
exit=0

$ node sweep-31d.cjs list
snapshots: 1 object(s)
  703586067d106b5ac8bafc53/1.html.gz 2026-09-27T08:19:08.000Z
exit=0

$ node sweep-31d.cjs sweep 31
sweep clock: 2026-10-28T08:19:10.556Z (now + 31 days)
[Nest] 34828  - 09/27/2026, 4:19:10 AM     LOG [SweepExpiredSnapshots] snapshot sweep: listed 1, expired 1, deleted 1, already gone 0, failed 0
result: {"status":"swept","listed":1,"expired":1,"deleted":1,"alreadyGone":0,"failed":0}
exit=0

$ node sweep-31d.cjs verify 31
verify clock: 2026-10-28T08:19:11.057Z (now + 31 days)
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

$ node sweep-31d.cjs list
snapshots: 0 object(s)
exit=0
```

Resultado: antes del barrido, `verify` con el reloj adelantado sale 1 nombrando el snapshot
(`snapshots: snapshot 703586067d106b5ac8bafc53/1.html.gz is 31 days old (more than 31)`); el barrido con el mismo reloj
lo borra (`listed 1, expired 1, deleted 1, already gone 0, failed 0`); después, `verify` sale 0 con «no lifecycle rule»
en los dos buckets y «no snapshot older than 31 days (0 listed)», y el listado del bucket de snapshots está vacío.

`docker compose -p os11-s down -v` sale 0, y no queda ningún contenedor, volumen ni red `os11`: `docker ps -a`,
`docker volume ls` y `docker network ls` filtrados por `os11` dan 0.

## `build-verify-publish` en `arm64` (tarea 9.1)

**Qué cambia en `.github/workflows/cd-staging.yml`** (commit `e346581`). En el job `build-verify-publish`:
`runs-on: ubuntu-24.04-arm` y `env: TARGET_PLATFORM: linux/arm64` a nivel de job; `platforms: ${{ env.TARGET_PLATFORM }}`
en los tres `docker/build-push-action` (que siguen con `load: true`); caché `scope=api-arm64`, `worker-arm64` y
`web-arm64`; y `TARGET_PLATFORM: ${{ env.TARGET_PLATFORM }}` en el `env` del paso de verificación. El resto de jobs,
igual. Un comentario sobre el job lo explica (design D10).

Comprobación sobre el YAML parseado (`<scratchpad>/check-91.cjs`, con el paquete `yaml` del repositorio), contra la
versión de `HEAD` anterior para los demás jobs:

```text
$ node check-91.cjs .github/workflows/cd-staging.yml <git show 0f3e766:.github/workflows/cd-staging.yml>
ok    1 runs-on: ubuntu-24.04-arm
ok    2 env.TARGET_PLATFORM (job): linux/arm64
ok    builds: 3
ok    3 api platforms=${{ env.TARGET_PLATFORM }} load=true
ok    4 api cache: type=gha,scope=api-arm64 | type=gha,mode=max,scope=api-arm64
ok    3 worker platforms=${{ env.TARGET_PLATFORM }} load=true
ok    4 worker cache: type=gha,scope=worker-arm64 | type=gha,mode=max,scope=worker-arm64
ok    3 web platforms=${{ env.TARGET_PLATFORM }} load=true
ok    4 web cache: type=gha,scope=web-arm64 | type=gha,mode=max,scope=web-arm64
ok    5 verify step env.TARGET_PLATFORM: ${{ env.TARGET_PLATFORM }}
ok    other job verify runs-on: ubuntu-24.04 (before ubuntu-24.04)
ok    other job preflight runs-on: ubuntu-24.04 (before ubuntu-24.04)
ok    other job deploy-staging runs-on: ubuntu-24.04 (before ubuntu-24.04)
ok    other job report runs-on: ubuntu-24.04 (before ubuntu-24.04)
ok    same jobs: verify,build-verify-publish,preflight,deploy-staging,report
RESULT: ok
exit=0
$ node check-91.cjs <versión de 0f3e766> <versión de 0f3e766>      # la misma comprobación sobre el YAML anterior
RESULT: FAIL (9)
```

**Antes de lanzar la corrida**, leído otra vez en el workflow del commit empujado (`git show e346581:…`): el paso de
publicación lleva `if: ${{ github.event_name != 'workflow_dispatch' || inputs.dry_run != true }}` (con `dry_run: true`
no se ejecuta) y `deploy-staging` solo corre con `needs.preflight.outputs.state == 'full'`; `gh secret list` no da
ningún secreto de repositorio (preflight `none`) y el único entorno del repositorio es `production-preflight`, que
`cd-staging` no usa.

```text
$ gh workflow run cd-staging.yml --ref change/object-store -f dry_run=true
https://github.com/manuXD270516/linkvault/actions/runs/36307691093
$ gh run view 36307691093 --json conclusion,jobs,headSha,event,url,createdAt,updatedAt > <scratchpad>/run-91.json   # leído con node
conclusion: success | headSha: e346581db12558cdd05630f5bbe99feb44a26dfa | event: workflow_dispatch | 2026-09-27T08:54:46Z → 2026-09-27T09:12:29Z
job: preflight (¿hay destino de staging configurado?) | success
job: verify (lint, specs, typecheck, test, build) | success
job: build, verify and publish artifact | success | id 108589406398 | 2026-09-27T09:07:58Z → 2026-09-27T09:12:13Z
   step: Verify artifact (docker-compose.prod.yml stack in the runner) | success
   step: Publish verified artifact to GHCR (docker push of the loaded image) | skipped
   step: Tear down verification stack | success
job: resultado: artefacto verificado — NO desplegado (sin destino de staging) | success
job: deploy staging (solo si hay destino configurado) | skipped
$ gh api repos/manuXD270516/linkvault/actions/jobs/108589406398 > <scratchpad>/job-91.json   # leído con node
labels: ubuntu-24.04-arm | runner_name: GitHub Actions 1000000344 | runner_group: GitHub Actions
```

Del log del job (`gh run view 36307691093 --log --job 108589406398`, volcado a fichero y leído con `node`):

```text
Image: ubuntu-24.04-arm
Server: Docker Engine - Community
  Version:          28.0.4
  OS/Arch:          linux/arm64
Platforms:             linux/arm64, linux/arm/v7, linux/arm/v6
/usr/bin/docker buildx build --cache-from type=gha,scope=api-arm64 --cache-to type=gha,mode=max,scope=api-arm64 --file docker/api.Dockerfile … --platform linux/arm64 --tag ghcr.io/manuxd270516/linkvault-api:sha-e346581db125 --load …
 (lo mismo para worker y web, con sus scope -arm64)
=== Tiempo hasta healthy de cada servicio (docker inspect)
  mongo        estado healthy; hasta healthy: 5.03 s (sondeos guardados: 3)
  redis        estado healthy; hasta healthy: 5.27 s (sondeos guardados: 2)
  object-store estado healthy; hasta healthy: 1.21 s (sondeos guardados: 2)
  api          estado healthy; hasta healthy: 5.33 s (sondeos guardados: 1)
  worker       estado healthy; hasta healthy: 5.31 s (sondeos guardados: 1)
  web          estado healthy; hasta healthy: 5.22 s (sondeos guardados: 1)
provision: ok
verify: ok
s3-probe: ok
=== Artefacto verificado
api, worker y web arrancan y responden con la configuración de producción real.
```

Es la **primera corrida `arm64` con la verificación en verde** que cuenta para la 11.1 (tiempos hasta `healthy` de
arriba; `object-store` 1,21 s). La corrida es anterior a la 10.2, así que el log aún no tiene la sección de plataforma
del script; el daemon `linux/arm64` sale del `docker version` que imprime `docker/setup-buildx-action`.

Nada publicado: en el log no hay `docker push` ni `publish-artifact`, y `gh api user/packages/container/<paquete>/versions
--paginate`, leído con `node`, no da ninguna versión con el tag `sha-e346581db125` en `linkvault-api` (5 versiones),
`linkvault-worker` (5) ni `linkvault-web` (3). `gh api …/runs/36307691093/timing`:
`{"billable":{"UBUNTU":{"total_ms":0,"jobs":5,…}},"run_duration_ms":1063000}` (el campo sigue sin discriminar, como en
la 1.2).

## Corrida real en `arm64` (tarea 9.2)

**Antes de lanzarla**, leído en el workflow del commit empujado (`git show 83afb67:.github/workflows/cd-staging.yml`,
parseado con el paquete `yaml` del repositorio): `deploy-staging` solo corre con `needs.preflight.outputs.state ==
'full'` y no declara `environment`; el preflight lee los cuatro `STAGING_*` de los secretos del repositorio y
`gh secret list` no da ninguno (estado `none`); el único entorno del repositorio es `production-preflight`, que
`cd-staging` no usa; y `MOVING_TAG` solo lleva valor desde `main`, así que la corrida no mueve `:staging`.

```text
deploy-staging.if: needs.preflight.outputs.state == 'full' | environment: undefined
publish.if: ${{ github.event_name != 'workflow_dispatch' || inputs.dry_run != true }} | MOVING_TAG: ${{ github.ref == 'refs/heads/main' && 'staging' || '' }}
$ gh workflow run cd-staging.yml --ref change/object-store -f dry_run=false
https://github.com/manuXD270516/linkvault/actions/runs/36344930563
$ gh run view 36344930563 --json conclusion,jobs,headSha,event,url,createdAt,updatedAt > <scratchpad>/g13/run-92.json   # leído con node
conclusion: success | headSha: 83afb67b1fe83179a2c353d8b3b7874e9511627b | event: workflow_dispatch | 2026-09-27T19:35:45Z → 2026-09-27T19:53:33Z
job: verify (lint, specs, typecheck, test, build) | success
job: preflight (¿hay destino de staging configurado?) | success
job: build, verify and publish artifact | success | id 108694291588
   step: Verify artifact (docker-compose.prod.yml stack in the runner) | success
   step: Publish verified artifact to GHCR (docker push of the loaded image) | success
   step: Tear down verification stack | success
job: resultado: artefacto verificado — NO desplegado (sin destino de staging) | success
job: deploy staging (solo si hay destino configurado) | skipped
$ gh api repos/manuXD270516/linkvault/actions/jobs/108694291588 > <scratchpad>/g13/job-92.json   # leído con node
labels: ubuntu-24.04-arm | runner: GitHub Actions 1000000358
```

Del log del job (`gh run view 36344930563 --log --job 108694291588`, volcado a fichero y leído con `node`), la
verificación y después `publish-artifact.sh`:

```text
  daemon: linux/arm64
  TARGET_PLATFORM: linux/arm64 (igual que el daemon)
  ok: ghcr.io/manuxd270516/linkvault-api:sha-83afb67b1fe8 (linux/arm64)
  ok: ghcr.io/manuxd270516/linkvault-worker:sha-83afb67b1fe8 (linux/arm64)
  ok: ghcr.io/manuxd270516/linkvault-web:sha-83afb67b1fe8 (linux/arm64)
ok: chrislusf/seaweedfs:4.47 (linux/arm64)
ok: mongo:7.0.43 (linux/arm64)
ok: redis:7.4.11 (linux/arm64)
=== Tiempo hasta healthy de cada servicio (docker inspect)
  mongo        estado healthy; hasta healthy: 4.99 s (sondeos guardados: 3)
  redis        estado healthy; hasta healthy: 5.20 s (sondeos guardados: 2)
  object-store estado healthy; hasta healthy: 1.24 s (sondeos guardados: 2)
  api          estado healthy; hasta healthy: 5.32 s (sondeos guardados: 1)
  worker       estado healthy; hasta healthy: 5.34 s (sondeos guardados: 1)
  web          estado healthy; hasta healthy: 5.28 s (sondeos guardados: 1)
provision: ok
verify: ok
s3-probe: ok
=== Artefacto verificado
=== Publicación del artefacto verificado
tag inmutable: sha-83afb67b1fe8
tag móvil    : (ninguno: esta corrida no mueve ningún canal)
=== Publicar ghcr.io/manuxd270516/linkvault-api:sha-83afb67b1fe8
  artefacto verificado en este daemon: sha256:5acbf462ac9f138f824e84838d38a621e36e748e4ecdecc05b5d22db8866a2db
sha-83afb67b1fe8: digest: sha256:d94fb5fdf0c395c8c7d628ac46acfe5419f8072388e7fca7d0d19ba5a2a96ce8 size: 1783
  verificado (digest de repositorio local): sha256:d94fb5fdf0c395c8c7d628ac46acfe5419f8072388e7fca7d0d19ba5a2a96ce8
  publicado  (digest del registro)        : sha256:d94fb5fdf0c395c8c7d628ac46acfe5419f8072388e7fca7d0d19ba5a2a96ce8
  identidad confirmada: lo publicado es el artefacto verificado
  tag móvil: no se mueve en esta corrida (MOVING_TAG vacío)
=== Publicar ghcr.io/manuxd270516/linkvault-worker:sha-83afb67b1fe8
  (…) verificado y publicado: sha256:64304c31b1dc39cec82279a40f7e0b0742be0f7db3a5425729b3fd60528612e0; identidad confirmada
=== Publicar ghcr.io/manuxd270516/linkvault-web:sha-83afb67b1fe8
  (…) verificado y publicado: sha256:c5a47499e3232283204aa58f6e08e4648964f70a35b4e7fe3d571e77ccb66000; identidad confirmada
=== Artefacto publicado
api, worker y web publicados con el digest del artefacto que se verificó en este mismo job.
```

**Tag publicado desde la rama: `sha-83afb67b1fe8`** (commit `83afb67`), en los tres paquetes y sin tag móvil. Listado
de versiones después de la corrida (`gh api user/packages/container/linkvault-<p>/versions --paginate`, volcado a
fichero y leído con `node`):

```text
linkvault-api: 6 versiones; con sha-83afb67b1fe8: 1302218905 sha256:d94fb5fdf0c395c8c7d628ac46acfe5419f8072388e7fca7d0d19ba5a2a96ce8 tags=["sha-83afb67b1fe8"]
linkvault-worker: 6 versiones; con sha-83afb67b1fe8: 1302219216 sha256:64304c31b1dc39cec82279a40f7e0b0742be0f7db3a5425729b3fd60528612e0 tags=["sha-83afb67b1fe8"]
linkvault-web: 4 versiones; con sha-83afb67b1fe8: 1302219449 sha256:c5a47499e3232283204aa58f6e08e4648964f70a35b4e7fe3d571e77ccb66000 tags=["sha-83afb67b1fe8"]
```

`gh api …/runs/36344930563/timing`: `{"billable":{"UBUNTU":{"total_ms":0,"jobs":5,…}},"run_duration_ms":1068000}`. Es la
**segunda corrida `arm64` con la verificación en verde** que cuenta para la 11.1.

**Pendiente: `docker buildx imagetools inspect --raw`.** Los tres paquetes son privados y en esta máquina no hay sesión
de Docker en `ghcr.io` (el almacén de credenciales solo tiene Docker Hub y `dhi.io`), así que el registro rechaza la
lectura antes de llegar al manifiesto:

```text
$ docker buildx imagetools inspect --raw ghcr.io/manuxd270516/linkvault-api:sha-e86d3755a525
ERROR: failed to authorize: failed to fetch anonymous token: unexpected status from GET request to https://ghcr.io/token?scope=repository%3Amanuxd270516%2Flinkvault-api%3Apull&service=ghcr.io: 401 Unauthorized
```

La comprobación de «un manifiesto único (no un índice) de `linux/arm64`» queda para cuando la sesión esté iniciada; no
se hizo `docker login` con credenciales nuevas. La 9.2 sigue abierta solo por eso.

## `--compose` contra la pila sustituida (tarea 10.1)

**No ejecutada:** pide la sesión de `ghcr.io` iniciada (las imágenes propias del compose son privadas; ver la 9.2) y no
la hay. Se ejecuta con el tag de la 9.2, `sha-83afb67b1fe8`, en cuanto esté.

## Comprobación de plataformas en la verificación del artefacto (tarea 10.2)

**Qué cambia en `infra/ci/verify-artifact.sh`.** Una sección nueva, «Plataforma del daemon y de las imágenes propias»,
justo después de comprobar que las tres imágenes están cargadas y antes de nada más: lee la plataforma del daemon
(`docker version --format '{{.Server.Os}}/{{.Server.Arch}}'`); con `TARGET_PLATFORM`, exige que sean iguales y, si no,
`fail` de clase `artifact` sin levantar nada; sin ella, la plataforma exigida es la del daemon. Después, cada imagen
propia, **en el daemon**, con `docker image inspect --format '{{.Os}}/{{.Architecture}}'`: una distinta es `fail` de
clase `artifact` nombrando la imagen, su plataforma y la del destino. Las de terceros se comprueban en el registro con
`infra/deploy/check-image-platforms.sh --platform <la exigida>` sobre `dc config --images mongo redis object-store`,
**dentro** del bucle de tres intentos del `pull`: salida 0 → `pull`; 3 → `fail` de clase `artifact` sin reintentar; 4 →
se reintenta como un `pull` fallido y, agotados los tres intentos, `fail` de clase `environment` («no se pudieron
comprobar o descargar…»); cualquier otra (2, uso incorrecto) → `fail` de clase `artifact`.

Verificación en local, en el daemon `amd64` de esta máquina (Docker Desktop con el almacén de imágenes de containerd),
con las tres imágenes construidas desde un árbol limpio de `0f3e766` (`git worktree` en el scratchpad; `docker build -f
docker/<app>.Dockerfile -t os12-<app>:local .`, las tres en 0), proyecto de Compose `os12-v` (`COMPOSE_PROJECT_NAME`) y
`VERIFY_FAIL_CLASS_FILE` en el scratchpad. `bash -n infra/ci/verify-artifact.sh`: 0.

**(1) `TARGET_PLATFORM=linux/arm64`: falla antes de levantar nada, con clase `artifact`.**

```text
$ COMPOSE_PROJECT_NAME=os12-v API_IMAGE=os12-api WORKER_IMAGE=os12-worker WEB_IMAGE=os12-web IMAGE_TAG=local \
    TARGET_PLATFORM=linux/arm64 VERIFY_FAIL_CLASS_FILE=<scratchpad>/class-a.txt bash infra/ci/verify-artifact.sh
=== Imágenes cargadas en el daemon del corredor
  os12-api:local -> sha256:cfc198427cc8410116f274fb63d0c96723f315b7b11803e19808a2551b9b1e90
  os12-worker:local -> sha256:8bc3f16e326605346545125202f1e1323aeaf42991ec151998830e393db2f4e6
  os12-web:local -> sha256:171a973976fcc803399ec78c37c457d7c2b0159639e3d6a36e5f08bbfe753e37

=== Plataforma del daemon y de las imágenes propias
  daemon: linux/amd64

[FAIL/artifact] el daemon es linux/amd64 y TARGET_PLATFORM pide linux/arm64: este corredor no es de la arquitectura del destino y aquí no se emula

=== Diagnóstico: estado de los servicios
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
exit=1 class=artifact; contenedores os12: 0
```

**(2) `TARGET_PLATFORM=linux/amd64` con la imagen de `api` sustituida por un `alpine` `arm64`: falla con clase
`artifact` nombrando esa imagen.** Medido al hacerlo: en este daemon, `docker pull --platform linux/arm64 alpine`
seguido de `docker tag alpine <nombre>` **no** deja una imagen `arm64`: con el almacén de containerd la etiqueta apunta
al índice y `docker image inspect` responde por la plataforma del host (`linux/amd64`), así que la verificación siguió
(las tres imágenes `ok`) y la pila se levantó hasta que `api` (un `alpine` sin proceso) salió `unhealthy`. Pila
derribada con `teardown-artifact.sh` (0 contenedores, volúmenes y redes `os12`). Para tener de verdad una imagen solo
`arm64` en el daemon se descarga y se etiqueta **el manifiesto `linux/arm64`** del índice de `alpine`, leído con
`imagetools inspect`:

```text
$ docker buildx imagetools inspect alpine --format '{{range .Manifest.Manifests}}{{.Digest}} {{.Platform.OS}}/{{.Platform.Architecture}}{{"\n"}}{{end}}'
sha256:d56c381f961d307a21b3ca004cf1e3910f106644aefb1f43e654c8a56c4fd395 linux/amd64
sha256:260479a1cfaf304c4c20da7f8405d3ce313513dcd534bb743257bdd2fe0f3e2d linux/arm64
$ docker pull -q --platform linux/arm64 alpine@sha256:260479a1cfaf304c4c20da7f8405d3ce313513dcd534bb743257bdd2fe0f3e2d
$ docker tag alpine@sha256:260479a1… os12-api-alt:local
$ docker image inspect os12-api-alt:local --format '{{.Os}}/{{.Architecture}}'
linux/arm64
$ COMPOSE_PROJECT_NAME=os12-v API_IMAGE=os12-api-alt WORKER_IMAGE=os12-worker WEB_IMAGE=os12-web IMAGE_TAG=local \
    TARGET_PLATFORM=linux/amd64 VERIFY_FAIL_CLASS_FILE=<scratchpad>/class-b.txt bash infra/ci/verify-artifact.sh
=== Plataforma del daemon y de las imágenes propias
  daemon: linux/amd64
  TARGET_PLATFORM: linux/amd64 (igual que el daemon)

[FAIL/artifact] la imagen os12-api-alt:local es linux/arm64 y el destino es linux/amd64: no existe para la arquitectura del destino
exit=1 class=artifact; contenedores os12: 0
```

**(3) `OBJECT_STORE_IMAGE=registry.invalid/x`: falla tras tres intentos con clase `environment`.**

```text
$ COMPOSE_PROJECT_NAME=os12-v API_IMAGE=os12-api WORKER_IMAGE=os12-worker WEB_IMAGE=os12-web IMAGE_TAG=local \
    OBJECT_STORE_IMAGE=registry.invalid/x VERIFY_FAIL_CLASS_FILE=<scratchpad>/class-c.txt bash infra/ci/verify-artifact.sh
=== Plataforma del daemon y de las imágenes propias
  daemon: linux/amd64
  TARGET_PLATFORM: sin definir; se exige la del daemon, linux/amd64
  ok: os12-api:local (linux/amd64)
  ok: os12-worker:local (linux/amd64)
  ok: os12-web:local (linux/amd64)
 (…)
=== pull de las imágenes de terceros (mongo redis object-store)
no se pudo comprobar: registry.invalid/x:4.47: ERROR: failed to do request: Head "https://registry.invalid/v2/x/manifests/4.47": dial tcp: lookup registry.invalid: no such host
ok: mongo:7.0.43 (linux/amd64)
ok: redis:7.4.11 (linux/amd64)
  intento 1 de 3: no se pudo comprobar la plataforma de las imágenes de terceros en su registro; reintentando en 15s
 (… lo mismo en el intento 2 …)
  intento 2 de 3: no se pudo comprobar la plataforma de las imágenes de terceros en su registro; reintentando en 30s
 (… lo mismo en el intento 3 …)
  intento 3 de 3: no se pudo comprobar la plataforma de las imágenes de terceros en su registro; reintentando en 45s

[FAIL/environment] no se pudieron comprobar o descargar las imágenes de terceros (mongo redis object-store) tras 3 intentos. Esto NO es un fallo del artefacto de LinkVault: es el registro del que se descargan (limitación de peticiones anónimas o caída). Reintentar la corrida suele bastar.
exit=1 (122 s) class=environment; contenedores os12: 0
```

**(4) Sin `TARGET_PLATFORM`: pasa la comprobación y sigue** hasta el final.

```text
$ COMPOSE_PROJECT_NAME=os12-v API_IMAGE=os12-api WORKER_IMAGE=os12-worker WEB_IMAGE=os12-web IMAGE_TAG=local \
    VERIFY_FAIL_CLASS_FILE=<scratchpad>/class-d.txt bash infra/ci/verify-artifact.sh
=== Plataforma del daemon y de las imágenes propias
  daemon: linux/amd64
  TARGET_PLATFORM: sin definir; se exige la del daemon, linux/amd64
  ok: os12-api:local (linux/amd64)
  ok: os12-worker:local (linux/amd64)
  ok: os12-web:local (linux/amd64)
=== pull de las imágenes de terceros (mongo redis object-store)
ok: mongo:7.0.43 (linux/amd64)
ok: redis:7.4.11 (linux/amd64)
ok: chrislusf/seaweedfs:4.47 (linux/amd64)
=== up -d --wait --wait-timeout 360 --pull never mongo redis object-store api worker web
=== Tiempo hasta healthy de cada servicio (docker inspect)
  mongo        estado healthy; hasta healthy: 5.24 s (sondeos guardados: 3)
  redis        estado healthy; hasta healthy: 5.03 s (sondeos guardados: 2)
  object-store estado healthy; hasta healthy: 1.22 s (sondeos guardados: 2)
  api          estado healthy; hasta healthy: 5.37 s (sondeos guardados: 1)
  worker       estado healthy; hasta healthy: 5.36 s (sondeos guardados: 1)
  web          estado healthy; hasta healthy: 5.21 s (sondeos guardados: 1)
provision: ok
verify: ok
s3-probe: ok
=== Artefacto verificado
api, worker y web arrancan y responden con la configuración de producción real.
exit=0 (49 s); fichero de clase: no se escribió
$ COMPOSE_PROJECT_NAME=os12-v bash infra/ci/teardown-artifact.sh
exit=0
```

`docker ps -a`, `docker volume ls` y `docker network ls` filtrados por `os12`: 0, 0 y 0 tras cada caso.

## Falsación de la comprobación de plataformas en `arm64` (tarea 10.3)

Commit temporal `de3f854` («chore(ci): TEMPORARY …»): en el `env` del paso de verificación de `cd-staging.yml`,
`OBJECT_STORE_IMAGE: docker.io/library/mysql` y `OBJECT_STORE_IMAGE_TAG: "5.7"`, la imagen de la 1.3 cuyo índice no
incluye `linux/arm64`. Antes de lanzarla, leído en el commit empujado: el paso de publicación sigue con su `if` de
`dry_run` y `deploy-staging` con el estado `full`; `gh secret list`, vacío. Una sola corrida, en modo de prueba:

```text
$ gh workflow run cd-staging.yml --ref change/object-store -f dry_run=true
https://github.com/manuXD270516/linkvault/actions/runs/36308803112
$ gh run view 36308803112 --json conclusion,jobs,headSha,event > <scratchpad>/run-103.json   # leído con node
conclusion: failure | headSha: de3f854c78960d7f377382e814288f92d495c7ff | event: workflow_dispatch
job: preflight (¿hay destino de staging configurado?) | success
job: verify (lint, specs, typecheck, test, build) | success
job: build, verify and publish artifact | failure
   step: Build api (load, no push) | success
   step: Build worker (load, no push) | success
   step: Build web (load, no push) | success
   step: Verify artifact (docker-compose.prod.yml stack in the runner) | failure
   step: Publish verified artifact to GHCR (docker push of the loaded image) | skipped
   step: Tear down verification stack | success
   step: Upload artifact failure class | success
job: resultado: el artefacto NO pasó la verificación | failure
job: deploy staging (solo si hay destino configurado) | skipped
```

Del log del paso de verificación (`gh run view 36308803112 --log --job 108592645023`, volcado a fichero y leído con
`node`; el log intercala stdout y stderr, así que la línea `[FAIL/artifact]` sale tras la cabecera del diagnóstico): la
plataforma se comprueba **antes** del `pull`, sin reintentos, y no se levanta nada.

```text
=== Plataforma del daemon y de las imágenes propias
  daemon: linux/arm64
  TARGET_PLATFORM: linux/arm64 (igual que el daemon)
  ok: ghcr.io/manuxd270516/linkvault-api:sha-de3f854c7896 (linux/arm64)
  ok: ghcr.io/manuxd270516/linkvault-worker:sha-de3f854c7896 (linux/arm64)
  ok: ghcr.io/manuxd270516/linkvault-web:sha-de3f854c7896 (linux/arm64)
=== Imágenes que resuelve el compose
 (…)
docker.io/library/mysql:5.7
=== pull de las imágenes de terceros (mongo redis object-store)
ok: mongo:7.0.43 (linux/arm64)
ok: redis:7.4.11 (linux/arm64)
no existe para linux/arm64: docker.io/library/mysql:5.7 (disponibles: linux/amd64)
=== Diagnóstico: estado de los servicios
[FAIL/artifact] alguna imagen de terceros no existe para linux/arm64 (la línea de arriba nombra la imagen y las plataformas que existen): es un defecto del compose, no del registro, y reintentar no lo arregla
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
```

Del job de reporte (`--log --job 108592818907`) y del estado de commit (`gh api
repos/manuXD270516/linkvault/commits/de3f854c78960d7f377382e814288f92d495c7ff/statuses`, volcado a fichero y leído con
`node`):

```text
clase del fallo: artifact
  verificación del artefacto : failure (clase del fallo: artifact)
  preflight                  : success (estado: none)
  estado de commit           : failure
  nombre (lista de checks)   : resultado: el artefacto NO pasó la verificación
  descripción                : El artefacto no se construyó, no arrancó o no existe para la arquitectura del destino: no se publicó ni desplegó nada.
cd-staging/artifact | failure | "El artefacto no se construyó, no arrancó o no existe para la arquitectura del destino: no se publicó ni desplegó nada." | 118 car. | 122 bytes | https://github.com/manuXD270516/linkvault/actions/runs/36308803112
contiene «registro de terceros»: false | contiene «reintentar»: false
```

La descripción es el texto de la 2.16 (118 caracteres, 122 bytes). Revertido en `ec1753a` («chore(ci): revert …»):
`git diff b90786a ec1753a` vacío, el workflow queda como antes del commit temporal.

## Plazo de arranque (tarea 11.1)

**Tres corridas `arm64` con la verificación en verde:** la 9.1 (36307691093, modo de prueba, `e346581`), la 9.2
(36344930563, real, `83afb67`) y una más en modo de prueba sobre `83afb67`, lanzada para esto:

```text
$ gh workflow run cd-staging.yml --ref change/object-store -f dry_run=true
https://github.com/manuXD270516/linkvault/actions/runs/36345047743
$ gh run view 36345047743 --json conclusion,jobs,headSha,event,createdAt,updatedAt > <scratchpad>/g13/run-111a.json   # leído con node
conclusion: success | headSha: 83afb67b1fe83179a2c353d8b3b7874e9511627b | event: workflow_dispatch | 2026-09-27T19:37:41Z → 2026-09-27T20:05:34Z
job: build, verify and publish artifact | success | id 108696942860 | labels: ubuntu-24.04-arm
   step: Verify artifact (docker-compose.prod.yml stack in the runner) | success
   step: Publish verified artifact to GHCR (docker push of the loaded image) | skipped
job: deploy staging (solo si hay destino configurado) | skipped
  daemon: linux/arm64
  mongo        estado healthy; hasta healthy: 4.99 s (sondeos guardados: 3)
  redis        estado healthy; hasta healthy: 5.20 s (sondeos guardados: 2)
  object-store estado healthy; hasta healthy: 1.24 s (sondeos guardados: 2)
  api          estado healthy; hasta healthy: 5.23 s (sondeos guardados: 1)
  worker       estado healthy; hasta healthy: 5.24 s (sondeos guardados: 1)
  web          estado healthy; hasta healthy: 5.24 s (sondeos guardados: 1)
provision: ok
verify: ok
s3-probe: ok
```

| servicio | 9.1 | 9.2 | 36345047743 | C9 local (`amd64`) | peor | ventana | ¿cambia? |
|---|---|---|---|---|---|---|---|
| mongo | 5,03 s | 4,99 s | 4,99 s | — | 5,03 s | 90 s | no |
| redis | 5,27 s | 5,20 s | 5,20 s | — | 5,27 s | 55 s | no |
| object-store | 1,21 s | 1,24 s | 1,24 s | 1,19 / 1,17 / 1,17 s | 1,24 s | 120 s ≥ 3 × 1,24 s | no |
| api | 5,33 s | 5,32 s | 5,23 s | — | 5,33 s | 180 s (mitad: 90 s) | no |
| worker | 5,31 s | 5,34 s | 5,24 s | — | 5,34 s | 180 s (mitad: 90 s) | no |
| web | 5,22 s | 5,28 s | 5,24 s | — | 5,28 s | 100 s | no |

**Healthchecks:** los del almacén se quedan como están en los dos composes (`start_period` 60 s, `interval` 10 s,
`retries` 6: 120 s, los de C9, que es además lo que comparan la 7.1 y la 7.3 con el compose de la matriz): la regla de
design D8 pide una ventana de **al menos** tres veces el peor tiempo (3,72 s) y 120 s la cumple. Ni `api` ni `worker`
pasan de la mitad de su ventana, así que no se amplían. **Plazo:** suelo = 120 s (el almacén, la mayor de las
dependencias) + 180 s (`api`/`worker`) = 300 s; × 1,10 = 330 s, que ya es múltiplo de 30: **330 s** (antes, 360 s con
los números de MinIO). Cambian la tabla del comentario y la línea de `infra/ci/verify-artifact.sh` y el bloque de la
pila de `infra/README.md` (`--wait-timeout 330` y el cálculo, sin `minio`). No se tocan las copias conocidas de design D8
(el `--wait-timeout 360` de los pasos de despliegue de `cd-staging.yml` y `cd-prod.yml`, que sustituyen 35b y 35c).

Comprobación (`<scratchpad>/g13/check-111.cjs`: recalcula el plazo desde los healthchecks de `docker-compose.prod.yml`
parseado con `yaml`, en aritmética entera, y lo compara con la línea del script y con el `up` del bloque del README):

```text
$ node check-111.cjs docker-compose.prod.yml infra/ci/verify-artifact.sh infra/README.md      # antes del cambio
suelo = max(deps) 120 + max(api,worker) 180 = 300 s; plazo = ceil(300 × 1,10 / 30) × 30 = 330 s
línea: WAIT_TIMEOUT="${VERIFY_WAIT_TIMEOUT:-360}"
valor 360 casa con ^[0-9]{2,4}$: true
valor del script = plazo recalculado: false
README, bloque de la pila: --wait-timeout 360 = plazo: false
RESULT: FAIL (2)
$ node check-111.cjs docker-compose.prod.yml infra/ci/verify-artifact.sh infra/README.md      # después
  mongo        start_period 30 s + retries 12 × interval 5 s = 90 s
  redis        start_period 5 s + retries 10 × interval 5 s = 55 s
  object-store start_period 60 s + retries 6 × interval 10 s = 120 s
  api          start_period 60 s + retries 12 × interval 10 s = 180 s
  worker       start_period 60 s + retries 12 × interval 10 s = 180 s
  web          start_period 10 s + retries 6 × interval 15 s = 100 s
suelo = max(deps) 120 + max(api,worker) 180 = 300 s; plazo = ceil(300 × 1,10 / 30) × 30 = 330 s
línea: WAIT_TIMEOUT="${VERIFY_WAIT_TIMEOUT:-330}"
valor 330 casa con ^[0-9]{2,4}$: true
valor del script = plazo recalculado: true
README, bloque de la pila: --wait-timeout 330 = plazo: true
RESULT: ok
exit=0
$ bash infra/ci/repo-checks.sh
check(docs-stack-up): OK — el 'up' documentado en infra/README.md y el de infra/ci/verify-artifact.sh coinciden: docker-compose.prod.yml, 6 servicios (api, mongo, object-store, redis, web, worker), --wait --wait-timeout 330 --pull never, sin traefik; y después del 'up', en los dos, provision y después verify, con las mismas 3 órdenes 'run' en el mismo orden
repo-checks: 5 comprobaciones ejecutadas (check-claims-registry, check-compose-env-contract, check-compose-healthchecks, check-docs-stack-up, check-stale-defaults)
exit=0
```

**Corrida con el plazo nuevo**, en modo de prueba sobre `f1415d2`:

```text
$ gh workflow run cd-staging.yml --ref change/object-store -f dry_run=true
https://github.com/manuXD270516/linkvault/actions/runs/36347012639
$ gh run view 36347012639 --json conclusion,jobs,headSha,event,createdAt,updatedAt > <scratchpad>/g13/run-111b.json   # leído con node
conclusion: success | headSha: f1415d2d4492a054602adc397108da3358548250 | event: workflow_dispatch | 2026-09-27T20:09:55Z → 2026-09-27T20:25:19Z
job: build, verify and publish artifact | success | id 108700589627 | labels: ubuntu-24.04-arm
   step: Verify artifact (docker-compose.prod.yml stack in the runner) | success
   step: Publish verified artifact to GHCR (docker push of the loaded image) | skipped
job: deploy staging (solo si hay destino configurado) | skipped
job: resultado: artefacto verificado — NO desplegado (sin destino de staging) | success
  daemon: linux/arm64
=== up -d --wait --wait-timeout 330 --pull never mongo redis object-store api worker web
  mongo        estado healthy; hasta healthy: 5.09 s (sondeos guardados: 3)
  redis        estado healthy; hasta healthy: 5.23 s (sondeos guardados: 2)
  object-store estado healthy; hasta healthy: 1.29 s (sondeos guardados: 1)
  api          estado healthy; hasta healthy: 5.35 s (sondeos guardados: 1)
  worker       estado healthy; hasta healthy: 5.37 s (sondeos guardados: 1)
  web          estado healthy; hasta healthy: 5.29 s (sondeos guardados: 1)
provision: ok
verify: ok
s3-probe: ok
=== Artefacto verificado
```

Sus tiempos (almacén 1,29 s; ventana 120 s ≥ 3 × 1,29 s) no cambian ninguna ventana ni el plazo. Nada publicado: ninguna
versión con `sha-f1415d2d4492` en los tres paquetes (`gh api user/packages/container/linkvault-<p>/versions --paginate`,
leído con `node`).

## Documentación que protege los CV (grupo 12)

### 12.1: RUNBOOK, «Operar los CV»

En «Paso 6 octies — Operar los CV»: la comprobación de configuración pasa a `object-store verify`, con la orden local
(`pnpm nx run api:object-store -- verify`) y la de producción (`docker compose -f docker-compose.prod.yml --env-file
.env.prod run --rm --no-deps api node object-store.js verify`); el mismo párrafo explica que `pnpm infra:up` crea los
buckets y que `docker compose up` solo ya no; la retención por barrido con su **riesgo residual**; una viñeta nueva,
«El almacén se niega a arrancar: la clave del cifrado», con los dos mensajes del guardia de la 7.1b, sus códigos (`64` y
`65`) y qué hacer en cada caso; y la marca «**Pendiente:** no aplicable al almacén actual; lo reescribe un change
posterior (`object-store`, design D12).» al principio de la sonda de escritura («Comprobar el almacén a mano»), de la
recogida de huérfanos, del borrado manual de lo de una persona y de la sección «GC de objetos huérfanos (CV)». La
«tabla de síntomas» del RUNBOOK (Paso 8) no usa `mc`: su fila del snapshot nombraba el almacén anterior y decía que el
`up` crea los buckets con su regla de 30 días; se corrigió (`pnpm infra:up` y `verify`) en vez de marcarla, porque esa
operación sí es válida con el almacén actual. También se corrigió la viñeta «Qué queda pendiente de `deploy-prod`»,
que daba el cifrado en reposo por pendiente.

`verify` ejecutado una vez contra el almacén local: el `object-store` de `docker-compose.yml`, en un proyecto aparte
(`COMPOSE_PROJECT_NAME=os12-l`, `OBJECT_STORE_PORT=19612`), con las `S3_*` de desarrollo exportadas y
`S3_ENDPOINT=http://localhost:19612`:

```text
$ docker compose up -d --wait object-store
exit=0
$ pnpm nx run api:object-store -- provision
ok    cvs: bucket created
ok    cvs: no lifecycle configuration (removed if there was one)
ok    cvs: default encryption set (AES256)
ok    cvs: no bucket policy
ok    snapshots: bucket created
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
$ docker compose down -v
exit=0     # 0 contenedores, volúmenes y redes os12
```

Comprobación de un solo uso (`<scratchpad>/check-121.cjs`; «sección» es la viñeta de primer nivel o el título más
cercanos hacia arriba, fuera de los bloques de código):

```text
$ node check-121.cjs docs/RUNBOOK.md
ok    sin «mc anonymous»
ok    sin «mc ilm»
ok    línea 859 con «mc »: en viñeta de la línea 853 («- **Pendiente:** no aplicable al almacén actual; …»), que empieza con la marca
ok    línea 860 con «mc »: en viñeta de la línea 853 (…), que empieza con la marca
ok    línea 861 con «mc »: en viñeta de la línea 853 (…), que empieza con la marca
ok    línea 964 con «mc »: en viñeta de la línea 955 (…), que empieza con la marca
ok    línea 974 con «mc »: en viñeta de la línea 955 (…), que empieza con la marca
ok    línea 988 con «mc »: en viñeta de la línea 980 (…), que empieza con la marca
ok    línea 996 con «mc »: en viñeta de la línea 980 (…), que empieza con la marca
      (7 líneas con «mc »)
ok    «GC de objetos huérfanos (CV)» empieza con la marca
ok    `worker`, `verify` y «31 días» en un mismo párrafo
ok    en «Operar los CV»: OBJECT_STORE_SSE_KEY
ok    en «Operar los CV»: .mini_sse_kek
ok    en «Operar los CV»: nunca borr
ok    en «Operar los CV»: `64`
ok    en «Operar los CV»: `65`
RESULT: ok
exit=0
$ node check-121.cjs <git show HEAD:docs/RUNBOOK.md>      # antes del grupo 12
RESULT: FAIL (21)
```

### 12.2: `infra/README.md`, lo que protege los CV

Sección nueva «Almacén de objetos (CV y snapshots)», en lugar de la que operaba MinIO con `mc`: el producto y los
enlaces a esta matriz y a ADR-052 (digest del índice, fecha, tabla resumen y la regla de repetir la matriz antes de
cambiar el producto o su versión mayor); los dos buckets; la orden que genera `OBJECT_STORE_SSE_KEY`, **copiada de
ADR-052 «Elección»** por el propio script de edición (lee el bloque de código de esa sección); guardarla y copiarla fuera
del host junto a `AI_VAULT_KEY`, con la advertencia de que perderla es perder los CV; que es obligatoria y el almacén no
arranca sin ella, con otro formato ni sobre un volumen que arrancó sin ella (códigos `64` y `65`), con el enlace a la
sección del RUNBOOK; y `object-store.js verify`. Además: la fila de la clave en la tabla del contrato de variables (en
lugar de la del almacén anterior), las piezas (`object-store.js` y `check-image-platforms.sh` en lugar del script de
buckets retirado), `provision` y `verify` tras el `up` en «Arranque», y lo que la verificación del artefacto sí cubre
ahora del almacén y de la plataforma.

```text
$ node check-122.cjs infra/README.md
      orden en ADR-052 «Elección»: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ok    la variable de la clave: OBJECT_STORE_SSE_KEY
ok    una línea idéntica, carácter a carácter, a la orden de ADR-052 «Elección»
ok    OBJECT_STORE_SSE_KEY, `AI_VAULT_KEY`, «fuera del host» y la advertencia «perder la clave es perder los CV» en un mismo párrafo
ok    «obligatoria», «no arranca» y «64» en un mismo párrafo
ok    `object-store.js verify`
ok    enlace a la sección del RUNBOOK de la 12.1
ok    enlace ../docs/object-store-matrix/matriz.md y el fichero existe (true)
ok    enlace ../docs/adr/ADR-052.md y el fichero existe (true)
RESULT: ok
exit=0
$ node check-122.cjs <git show HEAD:infra/README.md>      # antes del grupo 12
RESULT: FAIL (6)
```

El bloque «Lo que se vio al escribir esto» de «Levantar la pila entera en tu máquina» pegaba una salida con el almacén
anterior. Se repitió el procedimiento del bloque (pasos 2 a 6 y «Qué mirar») con las imágenes `os12-*:local` de la 10.2,
el fichero de entorno en el scratchpad y `COMPOSE_PROJECT_NAME=os12-r`, y se pegó la salida nueva: `config` 0, `up` 0,
`provision: ok`, `verify: ok`, `s3-probe: ok`, los seis servicios `healthy` (con `object-store`), los dos `/health` en
`200` y el documento del SPA; `down -v --remove-orphans` 0 y 0 contenedores, volúmenes y redes `os12`.

### 12.3 y 12.4: búsqueda de referencias

`<scratchpad>/check-123-124.cjs`. «minio» se busca sin distinguir mayúsculas **y sin una letra delante**: la palabra
«dominio» contiene «minio» (16 líneas de estos ficheros, todas sobre dominios de correo o de bolsas), y una búsqueda de
la subcadena las daría como apariciones.

```text
=== 12.3: minio (sin distinguir mayúsculas) y \bmc\b en 15 ficheros
  .claude/commands/lv/smoke.md:6: 1) `docker compose up -d --wait`; espera a mongo (rs0 iniciado), redis, minio. …
  infra/ci/verify-artifact.sh:70: #   minio  start_period 20 s + retries 12 × interval 10 s = 140 s   ← el más lento de las dependencias
  infra/ci/verify-artifact.sh:75: # `api` y `worker` dependen de `service_healthy` de mongo, redis y minio, así que su ventana …
  apariciones: 3
=== 12.4: \bmc\b, minio y linkvault-minio en docker-compose.yml, docker-compose.prod.yml, README.md, infra/README.md, docs/RUNBOOK.md
  FUERA   infra/README.md:334 [minio] sección «Levantar la pila entera en tu máquina (…)»: compose, encadenadas (`minio` 20 s + 12×10 s = 140 s …
  marcada docs/RUNBOOK.md:855 [minio] sección «Paso 6 octies — Operar los CV» / viñeta «**Pendiente:** …»: que prueba que MinIO responde …
  marcada docs/RUNBOOK.md:859 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio sh -c '… mc cp …'
  marcada docs/RUNBOOK.md:860 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc ls --recursive admin/cvs/probe/
  marcada docs/RUNBOOK.md:861 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc rm --recursive --force admin/cvs/probe/
  marcada docs/RUNBOOK.md:964 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec -T minio mc find admin/cvs …
  marcada docs/RUNBOOK.md:974 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc rm admin/cvs/<userId>/<cvId>
  marcada docs/RUNBOOK.md:988 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc ls --recursive admin/cvs/<userId>/
  marcada docs/RUNBOOK.md:996 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc rm --recursive --force admin/cvs/<userId>/
  marcada docs/RUNBOOK.md:1562 [minio] sección «GC de objetos huérfanos (CV)»: `docker-compose.prod.yml` y el alias MinIO del contenedor prod. …
  fuera de las secciones marcadas: 1; dentro: 9; líneas con «minio» solo dentro de otra palabra («dominio»): 16
$ node check-123-124.cjs HEAD      # antes del grupo 12
  apariciones: 41
  fuera de las secciones marcadas: 47; dentro: 0
```

**Lo que queda, y por qué no se tocó aquí.** Las dos líneas de `verify-artifact.sh` son la tabla del plazo y su
párrafo, y la de `infra/README.md` es el cálculo del plazo del bloque de la pila: los reescribe la 11.1 con los números
medidos en `arm64`, y cambiar solo el nombre dejaría una tabla que atribuye al almacén nuevo la ventana del anterior
(el healthcheck de `object-store` es hoy 60 s + 6 × 10 s). `.claude/commands/lv/smoke.md` es la definición de un
comando de Claude Code: no se edita sin el visto bueno del usuario. Con esas tres, la 12.3 y la 12.4 siguen abiertas.
`pnpm nx run shared:lint` (0 errores) y `pnpm nx run api:test` (275 ficheros, 3665 tests) en verde con los cambios de
la 12.3.

**Repetida tras la 11.1** (`f1415d2`, que reescribió la tabla del plazo de `verify-artifact.sh` y el cálculo del bloque
de la pila de `infra/README.md`; `.claude/commands/lv/smoke.md` se corrigió en `83afb67` con el visto bueno del
usuario):

```text
$ node check-123-124.cjs
=== 12.3: minio (sin distinguir mayúsculas) y \bmc\b en 15 ficheros
  apariciones: 0
=== 12.4: \bmc\b, minio y linkvault-minio en docker-compose.yml, docker-compose.prod.yml, README.md, infra/README.md, docs/RUNBOOK.md
  marcada docs/RUNBOOK.md:855 [minio] sección «Paso 6 octies — Operar los CV» / viñeta «**Pendiente:** …»: que prueba que MinIO responde …
  marcada docs/RUNBOOK.md:859 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio sh -c '… mc cp …'
  marcada docs/RUNBOOK.md:860 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc ls --recursive admin/cvs/probe/
  marcada docs/RUNBOOK.md:861 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc rm --recursive --force admin/cvs/probe/
  marcada docs/RUNBOOK.md:964 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec -T minio mc find admin/cvs …
  marcada docs/RUNBOOK.md:974 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc rm admin/cvs/<userId>/<cvId>
  marcada docs/RUNBOOK.md:988 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc ls --recursive admin/cvs/<userId>/
  marcada docs/RUNBOOK.md:996 [mc,minio] … / viñeta «**Pendiente:** …»: docker compose exec minio mc rm --recursive --force admin/cvs/<userId>/
  marcada docs/RUNBOOK.md:1562 [minio] sección «GC de objetos huérfanos (CV)»: `docker-compose.prod.yml` y el alias MinIO del contenedor prod. …
  fuera de las secciones marcadas: 0; dentro: 9; líneas con «minio» solo dentro de otra palabra («dominio»): 16
exit=0
$ pnpm nx run shared:lint      # redirigido a fichero
✖ 20 problems (0 errors, 20 warnings)
 NX   Successfully ran target lint for project shared
$ pnpm nx run api:test         # redirigido a fichero
 Test Files  275 passed | 2 skipped (277)
      Tests  3665 passed | 16 skipped (3681)
 NX   Successfully ran target test for project api
```

La 12.3 y la 12.4 quedan cerradas: cero apariciones en los ficheros de la 12.3 y cero fuera de las secciones del
RUNBOOK marcadas en la 12.1.
