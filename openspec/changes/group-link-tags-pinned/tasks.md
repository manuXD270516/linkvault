## 1. Specs y plan

- [x] 1.1 Añadir fila **30** `group-link-tags-pinned` en `docs/design-v0.2.md` §6 y entrada en `openspec-changes.yaml`; verificar que el orden queda tras `job-discovery` (29)
- [x] 1.2 Redactar `docs/adr/ADR-044.md` (ACL miembro, pin-flag, caps, non-goals) y referenciarlo desde design/proposal; verificar enlace en §6

## 2. Shared + persistencia [backend]

- [x] 2.1 Schemas zod request/response tags y pinned + campos opcionales en `JobLinkSummary` de grupo; verificar tests en `libs/shared`
- [x] 2.2 Extender `GroupLink` document/repo (defaults `[]`/`false`, `$set` tags, set pinned, list filters `pinned`/`tag` + count alineado); verificar unit tests in-memory
- [x] 2.3 Documentar en ADR-044 índice tag diferido (collscan OK); no crear índice en este change salvo que CI/perf lo exija

## 3. API [backend]

- [x] 3.1 Use cases `SetGroupLinkTags` / `SetGroupLinkPinned` (ACL 404 como know-someone, sin outbox) + controller PUT; verificar specs de aplicación
- [x] 3.2 Schema query **de grupo** aparte (`pinned` enum string, `tag`); list+count mismo filter; privado sin esos params; verificar 400/`"false"` no coerce
- [x] 3.3 Exponer `tags`/`pinned` en listado de grupo; asserts de que public/digest/Meili mappers no los incluyen; verificar typecheck/lint api

## 4. SPA [frontend]

- [x] 4.1 API client + store: PUT tags/pinned y merge local slim; verificar unit tests
- [x] 4.2 Card de grupo: pin, chips, editor tags; lista privada sin controles; i18n ES/EN (copy “fijado” = shortlist, no “arriba”); verificar component specs
- [x] 4.3 Filtros “solo fijados” / por tag → query API; al cambiar filtro resetear cursor; verificar page/spec

## 5. Verify

- [x] 5.1 `pnpm nx affected -t lint,typecheck,test` en verde
- [x] 5.2 Smoke manual o e2e mínimo: fijar + tag + filtrar en grupo demo
