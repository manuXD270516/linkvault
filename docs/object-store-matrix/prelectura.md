# Pre-lectura de candidatos al almacén de objetos (35a)

**Qué es y qué no es.** Lectura previa, solo de documentación oficial y del código fuente, hecha el 2026-09-26 por otra
sesión («Resincronizar el catálogo i18n de web»), en solo lectura. **Sirve para ordenar el cribado y anticipar
dificultades; no aprueba ni suspende ninguna celda.** Toda celda de la matriz se ejecuta igualmente. «(código)» =
sacado del código fuente, no documentado. «no verificado» = la fuente no lo deja claro.

## C2 (ejecutada el 2026-09-26T06:59Z)

| Candidato | archived | Última estable | Licencia |
|---|---|---|---|
| SeaweedFS (`seaweedfs/seaweedfs`) | false | 4.47, 2026-09-14 (4.46 el 09-08, 4.45 el 08-31) | Apache-2.0 |
| RustFS (`rustfs/rustfs`) | false | **1.0.0, 2026-09-16: única estable**; prereleases casi diarias (1.0.1-preview.11 el 09-24) | Apache-2.0 |
| Garage (`Deuxfleurs/garage` en git.deuxfleurs.fr, API Forgejo) | false | v2.4.1, 2026-09-08 (v2.4.0 el 09-06, v2.3.0 el 04-16) | AGPL-3.0 (leída del fichero `LICENSE`: la API de esa forja no expone el campo) |

Órdenes: `gh api repos/<o>/<r>` y `.../releases/latest` y `.../releases?per_page=3` para GitHub; `curl -s
https://git.deuxfleurs.fr/api/v1/repos/Deuxfleurs/garage` y `/releases/latest` y `/releases?limit=3` para Garage.
Ojo: `releases/latest` excluye prereleases.

## Lo que documenta cada uno

| Celda | SeaweedFS | RustFS | Garage |
|---|---|---|---|
| **SSE-S3 / cifrado por defecto** | Sí, por bucket vía Put/Get/DeleteBucketEncryption. **Solo con KEK configurada**; sin KEK, las peticiones `AES256` fallan. [wiki SSE](https://github.com/seaweedfs/seaweedfs/wiki/Server-Side-Encryption#features) | Sí por bucket, documentado solo con `rc bucket encryption set … --mode sse-s3`; `PutBucketEncryption` por S3: no verificado. [docs](https://docs.rustfs.com/en/security-compliance/encryption/sse-s) | **No**: «we did not implement server-side encryption». [s3-compat](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/#server-side-encryption) |
| **SSE-C** | Sí («Full support»); esos objetos no se descifran en `filer.backup`/`filer.replicate`. [wiki SSE-C](https://github.com/seaweedfs/seaweedfs/wiki/Server-Side-Encryption-SSE-C) | Sí; **no exige TLS por defecto** (`RUSTFS_SSE_C_REQUIRE_TLS=false`). [docs](https://docs.rustfs.com/en/security-compliance/encryption/sse-c) · [repo](https://github.com/rustfs/rustfs/blob/main/docs/operations/kms-backend-security.md#sse-c-requires-a-secure-transport) | Sí; descarta la clave al terminar la petición. [cookbook](https://garagehq.deuxfleurs.fr/documentation/cookbook/encryption/) |
| **Expiración** | Sí vía S3 (Expiration Days/Date, Noncurrent, AbortIncompleteMultipartUpload; Transition → NotImplemented). **Necesita un worker `s3_lifecycle` corriendo**: «a bucket with rules but no worker silently retains data past its declared expiration». Cadencia 24 h. Si `weed mini` lo incluye: no verificado. [Lifecycle](https://github.com/seaweedfs/seaweedfs/wiki/S3-Lifecycle) · [Operator guide](https://github.com/seaweedfs/seaweedfs/wiki/S3-Lifecycle-Operator-Guide) | Sí (Expiration, Transition, Noncurrent) por un scanner de fondo; `PutBucketLifecycleConfiguration` directo: no verificado. [lifecycle](https://docs.rustfs.com/en/administration/data/lifecycle-management) | Parcial: solo `AbortIncompleteMultipartUpload` y `Expiration` (sin `ExpiredObjectDeleteMarker`); worker diario a medianoche UTC. [s3-compat](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/#versioning-lifecycle-endpoints) |
| **Anónimo por defecto** | **Público total sin identidades** («Allow-All Mode»); con una identidad, la autenticación pasa a ser global. El compose oficial de ejemplo crea una identidad `anonymous` con `Read`. [Credentials](https://github.com/seaweedfs/seaweedfs/wiki/S3-Credentials#allow-all-mode) | Siempre hay root (**por defecto `rustfsadmin`**); lo anónimo se evalúa contra la bucket policy; rechazo sin policy: no verificado. [policy](https://docs.rustfs.com/en/administration/data/bucket/policy) | Rechazado: sin policies ni ACL; en código `Error::forbidden("Garage does not support anonymous access yet")`. [s3-compat](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/#acl-policies-endpoints) |
| **Credenciales por variables, sin CLI** | Sí como último recurso: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (acceso global, no por bucket, sin recarga en caliente); CreateBucket con ella: no verificado. [Credentials](https://github.com/seaweedfs/seaweedfs/wiki/S3-Credentials) | Sí: `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` (o `_FILE`) son la root; CreateBucket por S3: no verificado. [env](https://docs.rustfs.com/en/reference/environment-variables) | Parcial: `GARAGE_DEFAULT_ACCESS_KEY`/`SECRET_KEY`/`BUCKET` con `--single-node --default-access-key` (desde v2.3.0), **pero exige un `garage.toml`** (puede ir sin secretos con `GARAGE_RPC_SECRET`); el `CMD` de la imagen hay que sobrescribirlo. [quick-start](https://garagehq.deuxfleurs.fr/documentation/quick-start/) |
| **Healthcheck en la imagen** | Alpine con shell y `curl`; en código `/status`, `/healthz`, `/readyz` en el gateway S3; issue #8243 (404 en `/healthz`) sin comprobar en 4.47. | Documentado: `/health`, `/health/live`, `/health/ready` sin autenticación en el 9000; Alpine con `curl`. [status](https://docs.rustfs.com/en/operations/status-check) | `GET /health` en la admin API (3903); imagen **`FROM scratch`, sin shell ni curl**; `garage health` como HEALTHCHECK: no verificado. |
| **Imágenes `arm64`** | `chrislusf/seaweedfs`: amd64, arm64, 386, arm/v7 | `rustfs/rustfs`: amd64, arm64 | `dxflrs/garage:v2.4.1`: amd64, arm64, arm, 386. **Sin tag `latest`.** |
| **Dónde guarda la clave** | **Del entorno**: `WEED_S3_SSE_KEK` (hex 256 bits) o `WEED_S3_SSE_KEY` (HKDF), o `security.toml`. Un mecanismo antiguo la leía de `/etc/s3/sse_kek` dentro del filer; si no coincide con `security.toml`, el servidor no arranca. **No la autogenera.** Si cifra metadatos o configuración: no verificado. Aparte, `-encryptVolumeData` guarda claves por chunk **sin cifrar en la metadata del filer**. [KEK](https://github.com/seaweedfs/seaweedfs/wiki/Server-Side-Encryption#kek-configuration) | (a) sin KMS, `RUSTFS_SSE_S3_MASTER_KEY` **en el entorno**, sin rotación; (b) KMS local con ficheros de claves cifrados en `RUSTFS_KMS_KEY_DIR` (en el volumen) y una clave creada **tras arrancar** con `rc admin kms key create` (paso de CLI de admin). **La web y el repo se contradicen** sobre si SSE-S3 exige KMS. Issue **#1397 «Data is stored unencrypted on disk despite SSE»**, estado no comprobado. [repo](https://github.com/rustfs/rustfs/blob/main/docs/operations/kms-backend-security.md#no-kms-configured-the-sse-s3-local-master-key) | **No hay cifrado en reposo**: «stores data in plain text … or encrypted using customer keys (SSE-C)». [cookbook](https://garagehq.deuxfleurs.fr/documentation/cookbook/encryption/) |

## Qué anticipa para el cribado (no aprueba celdas)

- **SeaweedFS** es el candidato con más papeletas para C5 `nativo` con (a) y (b1), porque la KEK viene del entorno y
  no se autogenera. **C4 tiene que comprobar que la identidad por entorno desactiva de verdad el modo público.**
  **C6 depende de que el worker `s3_lifecycle` esté corriendo**; si no se puede lanzar sin CLI, C6 caerá en la salida
  del barrido, que la regla de parada admite.
- **RustFS**: C5 es la celda que decide, por la contradicción KMS/sin KMS, el paso de CLI (C3) y la issue #1397. Las
  credenciales por defecto hacen obligatorio fijarlas por entorno.
- **Garage**: C5 solo puede salir `salida` (SSE-C); C8 (healthcheck) es difícil con una imagen `scratch`; necesita
  proxy para TLS. Queda como último recurso, en el orden ya fijado.
- **Transversal, a confirmar en la matriz: SSE-C y TLS.** Algunos servidores rechazan SSE-C sobre HTTP (MinIO lo
  exige), y la red interna del compose habla HTTP. Si la salida SSE-C llega a hacer falta, hay que medir si el
  candidato la acepta sin TLS o si obliga a meter TLS dentro del compose.
