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
