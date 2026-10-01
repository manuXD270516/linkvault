## 1. Filtro de rutas

- [x] 1.1 [infra] `.github/workflows/cd-staging.yml`: añadir `paths-ignore` al `push` a `main` con `openspec/**`,
  `docs/**`, `.claude/**`, `.cursor/**`, `*.md`, `infra/**/*.md`, `tools/**/*.md` y `**/README.md`, con un comentario
  que diga por qué `**/*.md` no está (prompts de `libs/ai`). Verificar leyendo el YAML con `node` y el paquete `yaml`:
  `on.push.branches` sigue siendo `[main]`, `on.push.paths-ignore` es exactamente esa lista y `on.workflow_dispatch`
  conserva el input `dry_run`.
- [x] 1.2 [infra] Comprobar con `node` que ningún fichero versionado que entre en las imágenes queda cubierto por la
  lista: recorrer `git ls-files`, aplicar los patrones con la semántica de GitHub (`*` no cruza `/`, `**` sí) y
  verificar que ninguno de `libs/**`, `apps/**`, `docker/**`, `docker-compose*.yml` ni `infra/ci/**` (salvo `.md`)
  coincide, y que los seis prompts de `libs/ai/src/infrastructure/prompts/` **no** coinciden.

## 2. Cierre

- [x] 2.1 [infra] `bash infra/ci/repo-checks.sh`, `pnpm exec openspec validate --all --no-interactive` y
  `pnpm nx affected -t lint,typecheck,test,i18n-check --base=main` en verde en local.
- [ ] 2.2 [infra] **[tras fusionar el PR de este change]** Fusionar el archivo de este change (solo `openspec/`) y
  verificar con `gh run list --workflow cd-staging.yml --commit <sha del merge>` volcado a fichero que **no** hay
  ninguna corrida para ese commit. Es la prueba del filtro y no gasta minutos.
