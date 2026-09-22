## ADDED Requirements

### Requirement: CD a staging en main

Tras un push o merge a `main`, el pipeline SHALL ejecutar la verificación existente (lint, specs, typecheck, tests, eval
cuando aplique, build) y, **solo si esa verificación pasa**, SHALL desplegar a **staging**. El fallo de cualquier etapa
de verificación NO SHALL disparar el despliegue a staging.

El despliegue a staging SHALL seguir el mecanismo cerrado: publicar imágenes en **GHCR**, luego actualizar el target
compose de staging (placeholders de host documentados) con **ssh + `docker compose pull` + `up`** (o equivalente
documentado con el mismo efecto), y ejecutar un smoke post-deploy de `GET /health` **contra el servicio `api` en la
red host/Docker** (no contra el origen HTTPS público de Traefik). El smoke SHALL exigir respuesta de readiness de Nest
(p. ej. checks de mongo/redis), no HTML del SPA. Un job que solo realiza dry-run **NO SHALL** satisfacer este
requirement.

#### Scenario: Merge a main verde despliega staging

- **GIVEN** un merge a `main` cuya verificación completa termina con éxito
- **WHEN** termina el workflow de CI/CD
- **THEN** SHALL haberse publicado imagen(es) en GHCR y actualizado el compose de staging
- **AND** el smoke post-deploy de `/health` SHALL haber corrido contra `api` en red interna/Docker
- **AND** el smoke NO SHALL haberse limitado a curl del entrypoint público Traefik
- **AND** el despliegue NO SHALL haberse iniciado antes de que verify terminara en éxito

#### Scenario: Verify fallido no despliega staging

- **GIVEN** un push a `main` cuya etapa de tests falla
- **WHEN** termina el workflow
- **THEN** NO SHALL desplegarse a staging
- **AND** NO SHALL contarse un dry-run como despliegue exitoso

### Requirement: CD a producción por tag semver

Al publicar un tag `v*` con forma semver (p. ej. `v1.2.3`), el pipeline SHALL ejecutar la verificación y, **solo si
pasa**, SHALL desplegar a **producción** con el mismo mecanismo (GHCR → compose pull+up del target prod → smoke
`/health` interno contra `api`, no Traefik público). Un tag que no cumpla el patrón documentado NO SHALL desplegar a
prod. El fallo de verify NO SHALL desplegar a producción. Dry-run **NO SHALL** satisfacer este requirement.

#### Scenario: Tag v* verde despliega prod

- **GIVEN** el tag `v1.0.0` publicado y la verificación en verde
- **WHEN** termina el workflow de release
- **THEN** SHALL haberse desplegado a producción vía GHCR + compose del target prod
- **AND** el smoke de `/health` SHALL haber corrido contra `api` en red interna/Docker

#### Scenario: Verify fallido no despliega prod

- **GIVEN** el tag `v1.0.1` y una etapa de verify fallida
- **WHEN** termina el workflow
- **THEN** NO SHALL desplegarse a producción

#### Scenario: Push a main no despliega prod

- **GIVEN** un merge a `main` en verde
- **WHEN** termina el CD de staging
- **THEN** NO SHALL haberse desplegado a producción por ese solo evento
- **AND** el despliegue a prod SHALL quedar reservado al tag `v*`
