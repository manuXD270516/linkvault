## 1. Carreras de LinksStore

- [x] 1.1 [frontend] `links.store.ts`: contador `listLoad` con `stillCurrent` y `stillOn(scope)` por valor (design D1);
  helper interno de primera página que incrementa `listLoad` antes del `await`, pone `loadingMore: false`, descarta
  respuesta, error y `finally` si ya no es la última y devuelve su número (o `null` sin ámbito o si falló); `reload()`
  público lo envuelve; `close()` incrementa `listLoad` (D2, D3).
- [x] 1.2 [frontend] `links.store.ts`: `loadMore()` captura `listLoad` y descarta la página, el error y el `finally` si
  cambió (D3); `save`, `importText` y `remove` capturan el ámbito y no recargan si `!stillOn`, e `importText` abre
  `reading` solo si su carga terminó bien y sigue siendo la última (D4); `updatePreview`, `pasteDescription`,
  `undoPaste` y `retryEnrichment` solo llaman a `replace()` si `stillOn` (D5). Ninguna promesa rechaza por un descarte
  (D2).
- [x] 1.3 [frontend] Ampliar `links.store.spec.ts` (TestBed + `HttpTestingController`) con un test por Scenario de
  "La lista mostrada es la del ámbito abierto": abrir A, abrir B antes de la respuesta de A, responder A y luego B → en
  medio B sin links de A y cargando, al final solo los de B; B antes que A → B; error tardío de A → sin `failure` y
  cargando; error de B → `failure` y sin carga; `loadMore` en A y abrir B → la página no se añade y `loadingMore` en
  `false`; `loadMore` y `visibilitychange` en el mismo grupo → sin repetidos; `close()` antes de la respuesta → vacío y
  sin carga; dos recargas del mismo grupo desordenadas (`http.match`) → gana la segunda; `save` cuya recarga queda
  superada → resuelve con la respuesta del guardado; importación en A que responde con B abierto → el `POST` llevó el
  grupo A, no sale recarga de B y no hay contador; importación en A que responde tras A→B→A → recarga A y abre el
  contador; importación cuya recarga falla → `failure` y sin contador; `save` y `remove` que responden con B abierto → no sale recarga de B; edición
  que responde en B → tarjeta de B intacta; edición en la misma lista → la tarjeta se reemplaza.

## 2. Detalle de grupo

- [ ] 2.1 [frontend] `group-detail.page.ts`: flag `destroyed` con `DestroyRef.onDestroy`; `enter()` no llama a
  `LinksStore.open` si está puesto (D6). Test en `group-detail.page.spec.ts`: destruir la página antes de que responda
  `listMembers` → no sale `GET /api/groups/<id>/links` y el ámbito del store no cambia.

## 3. Verificación

- [ ] 3.1 [frontend] `pnpm nx affected -t lint,typecheck,test` en verde.
