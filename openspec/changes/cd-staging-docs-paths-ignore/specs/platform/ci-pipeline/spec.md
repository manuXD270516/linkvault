## ADDED Requirements

### Requirement: CD a staging omitido en fusiones solo de documentación

Un push a `main` cuyos ficheros cambiados estén **todos** en `openspec/**`, `docs/**`, `.claude/**`, `.cursor/**`, los
`*.md` de la raíz, `infra/**/*.md`, `tools/**/*.md` o `**/README.md` NO SHALL lanzar el CD a staging, porque no cambia
el artefacto. Un push con al menos un fichero fuera de esa lista SHALL lanzarlo como exige "CD a staging en main". La
lista NO SHALL cubrir ningún fichero que entre en una imagen: en particular, los prompts `.md` de `libs/ai` SHALL seguir
lanzando el CD. El lanzamiento manual del workflow SHALL seguir disponible sea cual sea el último commit.

Las comprobaciones que el CD hace sobre documentación y specs (`repo-checks` y `openspec validate`) SHALL ejecutarse en
local antes de fusionar un cambio solo de documentación, y el PR SHALL decirlo. El commit publicado en staging SHALL
leerse como el último de `main` con el estado `cd-staging/artifact`, no como el `HEAD`.

#### Scenario: Archivo de un change

- **GIVEN** un merge a `main` que solo mueve ficheros de `openspec/changes/` y actualiza `openspec/specs/`
- **WHEN** GitHub evalúa los workflows del push
- **THEN** NO SHALL existir ninguna corrida de `cd-staging` para ese commit

#### Scenario: Cambio de un prompt de IA

- **GIVEN** un merge a `main` que solo cambia `libs/ai/src/infrastructure/prompts/match-cv.v2.md`
- **WHEN** GitHub evalúa los workflows del push
- **THEN** SHALL lanzarse `cd-staging` y aplicarse "CD a staging en main"

#### Scenario: Fusión mixta

- **GIVEN** un merge a `main` que cambia `docs/RUNBOOK.md` y un fichero de `apps/api/src/`
- **WHEN** GitHub evalúa los workflows del push
- **THEN** SHALL lanzarse `cd-staging`

#### Scenario: Lanzamiento manual tras un commit de documentación

- **GIVEN** que el `HEAD` de `main` es un commit solo de documentación
- **WHEN** alguien lanza `cd-staging` a mano sobre `main`
- **THEN** el workflow SHALL ejecutarse como en cualquier lanzamiento manual
