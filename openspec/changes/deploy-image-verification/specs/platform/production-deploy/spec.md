## MODIFIED Requirements

### Requirement: Imágenes multi-stage publicables

El repositorio SHALL incluir Dockerfiles multi-stage para `api`, `worker` y `web` que produzcan imágenes publicables en
**GHCR**. Las imágenes de `api` y `worker` SHALL declarar un `HEALTHCHECK` de imagen sobre `GET /health/live`
(**liveness** únicamente). La **readiness** (`GET /health`) SHALL ser responsabilidad del orquestador (p. ej. el
`healthcheck` de servicio en `docker-compose.prod.yml`), no del `HEALTHCHECK` embebido en la imagen. La imagen de `api`
SHALL incluir los prompts de IA en la ruta documentada para `AI_PROMPTS_DIR`.

**El build SHALL completarse de verdad**, y esto SHALL comprobarse en cada corrida, no darse por supuesto: durante un
mes el escenario "Build de imágenes" se dio por cumplido mientras las imágenes de `api` y `worker` **no se habían
construido ni una sola vez**.

- **Las dependencias de producción SHALL resolverse de forma reproducible**: la instalación que prepara el artefacto
  SHALL usar exactamente las versiones bloqueadas y NO SHALL permitirse que resuelva contra el registro lo que hubiera
  publicado el día del build. Aflojar el bloqueo para que el build pase NO SHALL considerarse una solución.
- **El manifiesto generado para el artefacto y su bloqueo SHALL ser coherentes entre sí**: ninguno de los dos SHALL
  declarar algo que obligue al otro a cambiar durante una instalación bloqueada. Es exactamente lo que ocurría —el
  manifiesto pedía una versión del gestor de paquetes que el bloqueo no registraba—, y el efecto no era un aviso sino
  la imposibilidad de construir.
- **Las imágenes SHALL arrancar.** Que el código compile y que la imagen se construya no implica que el proceso
  levante: hasta hoy nada comprobaba lo tercero.

#### Scenario: Build de imágenes

- **WHEN** se construyen las tres imágenes con los Dockerfiles del repositorio
- **THEN** el build SHALL terminar con éxito sin secretos embebidos en capas
- **AND** las imágenes de `api` y `worker` SHALL declarar `HEALTHCHECK` sobre `/health/live` (liveness)
- **AND** el compose / orquestador de producción SHALL usar `/health` para readiness

#### Scenario: Prompts en la imagen de api

- **GIVEN** la imagen de `api` construida
- **WHEN** se inspecciona el filesystem de la imagen en la ruta de `AI_PROMPTS_DIR`
- **THEN** SHALL existir el árbol de prompts versionados necesarios para `runTask` en producción

#### Scenario: Las dependencias de producción se instalan con el bloqueo intacto

- **GIVEN** el artefacto compilado de `api` con su manifiesto y su bloqueo generados
- **WHEN** se instalan sus dependencias de producción exigiendo el bloqueo
- **THEN** la instalación SHALL terminar con éxito
- **AND** NO SHALL haber hecho falta relajar ni regenerar el bloqueo para conseguirlo

#### Scenario: Un manifiesto que obliga a tocar el bloqueo rompe el build

- **GIVEN** un manifiesto generado que declara una versión del gestor de paquetes ausente del bloqueo
- **WHEN** se instalan las dependencias de producción exigiendo el bloqueo
- **THEN** el build SHALL fallar señalando esa incoherencia
- **AND** NO SHALL resolverse permitiendo que la instalación reescriba el bloqueo

#### Scenario: La imagen de api arranca y responde

- **GIVEN** la imagen de `api` recién construida y sus dependencias de infraestructura disponibles
- **WHEN** se ejecuta el contenedor
- **THEN** el proceso SHALL quedar escuchando
- **AND** `GET /health` SHALL responder readiness con sus comprobaciones de mongo y redis

### Requirement: Documentación del camino canónico compose+Traefik

`infra/README.md` SHALL documentar cómo operar el compose de producción (arranque, secretos, TLS, escalado de `worker`,
relay del outbox, placeholders de host **staging** vs **prod** como dos targets de deploy). Otros hosts (VPS genérico
sin este compose, Fly, Railway, Render, k3s+Helm, Cloud Run, etc.) **NO SHALL** presentarse como soportados en este
change: una sola línea MAY indicar que no están soportados y que el camino canónico es compose+Traefik. NO SHALL
exigirse manifiestos Helm ni configs de esos hosts como entregable.

**La documentación operativa NO SHALL contradecir lo que el producto ya hace.** En particular, NO SHALL instruir a
nadie para que haga a mano lo que existe como operación del producto: hacerlo a mano es más lento, no es atómico y
deja fuera las partes de la cascada que quien escribe el procedimiento no recordó. Cuando exista una operación del
producto para un fin, el procedimiento manual SHALL presentarse como el camino excepcional —para cuando esa operación
no se pueda usar— y SHALL nombrar la operación que sustituye.

Un procedimiento que afirme que una capacidad **no existe** SHALL quedar cubierto por una comprobación automatizada,
de modo que implementarla obligue a corregir el texto. Sin eso, la documentación envejece en la dirección más
peligrosa: manda trabajo manual sobre datos de personas mucho después de que deje de hacer falta.

#### Scenario: README cubre el camino canónico

- **WHEN** un operador abre `infra/README.md`
- **THEN** SHALL encontrar el procedimiento del compose prod con Traefik y los placeholders de staging/prod
- **AND** NO SHALL interpretarse una lista larga de alternativas como soporte entregado de este change

#### Scenario: Alternativas sin código obligatorio

- **WHEN** se revisa el repositorio de este change
- **THEN** NO SHALL exigirse manifiestos Helm, configs Fly/Railway/Render ni Cloud Run como entregable
- **AND** la ausencia de esos archivos NO SHALL invalidar el compose prod documentado

#### Scenario: El borrado de cuenta ya no se manda hacer a mano

- **GIVEN** que el producto ofrece una operación de borrado de cuenta con su cascada
- **WHEN** un operador busca en la documentación cómo borrar todo lo de una persona
- **THEN** SHALL encontrar primero esa operación
- **AND** NO SHALL leer que el borrado de cuenta no existe
- **AND** el procedimiento manual SHALL quedar como camino excepcional, diciendo qué operación sustituye

#### Scenario: Afirmar que algo no existe se comprueba

- **GIVEN** un procedimiento del RUNBOOK que afirma que una capacidad todavía no existe
- **WHEN** esa capacidad existe en el código
- **THEN** una comprobación automatizada SHALL fallar nombrando el procedimiento
- **AND** NO SHALL bastar con que alguien recuerde actualizar el texto
