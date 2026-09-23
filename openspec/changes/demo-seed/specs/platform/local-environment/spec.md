## ADDED Requirements

### Requirement: Profile demo para seed

El `docker-compose` SHALL asociar Meilisearch también al perfil `demo`
(`profiles: ['search', 'demo']`) además del perfil `search`. El RUNBOOK SHALL documentar:

1. `docker compose --profile demo up -d --wait` (infra + Meili)
2. `ALLOW_DEMO_SEED=true pnpm nx run api:seed-demo`
3. servir api/worker/web en el host con flags del tour

El profile `demo` NO SHALL arrancar `api`/`worker`/`web` como services permanentes.
NO SHALL implementar un segundo sembrador distinto del target Nx (mongosh crudo, etc.).

#### Scenario: Profile demo no arranca apps

- **GIVEN** infraestructura + profile `demo`
- **WHEN** se levanta compose con `--profile demo`
- **THEN** Meilisearch SHALL estar disponible
- **AND** NO SHALL haber services permanentes de `api`, `worker` ni `web`
- **AND** la documentación SHALL indicar `api:seed-demo` y credenciales demo