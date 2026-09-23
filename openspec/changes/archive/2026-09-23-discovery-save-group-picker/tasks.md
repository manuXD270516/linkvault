## 1. Plan / ADR

- [x] 1.1 Fila **31** `discovery-save-group-picker` en `docs/design-v0.2.md` §6 + `openspec-changes.yaml`
- [x] 1.2 `docs/adr/ADR-045.md` (destino página, default privado, sin API nueva) y enlace en §6

## 2. SPA [frontend]

- [x] 2.1 Cargar grupos del usuario en `/descubrir` (reutilizar API/store de groups); no bloquear en `loaded` si hay failure; si selección ∉ lista tras reload → Privado; verificar unit tests
- [x] 2.2 UI selector de destino + i18n ES/EN; vacío/error → solo privado + aviso; verificar component/page specs
- [x] 2.3 `DiscoveryStore.save`: capturar `groupId` al inicio del handler; enviar en LinksApi cuando corresponde; mapear already_there; 404 → error; specs privado sin groupId + grupo con groupId

## 3. Specs API (solo doc/assert)

- [x] 3.1 Confirmar que no hay endpoint discovery/save nuevo; test SPA cubre body con/sin groupId

## 4. Verify

- [x] 4.1 `pnpm nx run web:lint,typecheck,test` (y affected si toca shared) en verde
- [x] 4.2 Smoke: buscar → guardar privado; elegir grupo → guardar; feedback visible
