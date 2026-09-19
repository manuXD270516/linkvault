## Why

`LinksStore.reload()` espera la página y luego escribe `items`, `total`, `nextCursor`, `reading` y `failure` sin
comprobar que la lista abierta siga siendo la que pidió. Al pasar rápido del grupo A al grupo B, la respuesta tardía de A
puede llegar después de `open(B)` y pintar los links de A dentro de B hasta que llega la de B. `loadMore()` tiene el mismo
defecto: una página de A puede acabar pegada al final de la lista de B, y un `loadMore` en vuelo cuando la misma lista se
recarga añade la página siguiente de un cursor viejo, repitiendo links. Lo mismo pasa con la tarjeta que devuelven las
ediciones (`updatePreview`, `pasteDescription`, `undoPaste`, `retryEnrichment`): lleva `sharedBy`/`sharedAt` de la lista
donde se pidió, y si el link también está en la lista abierta ahora, la pisa con los datos de la otra.

No se guarda nada en el sitio equivocado (`save`/`importText` usan el ámbito abierto y rechazan sin él desde
`applications-tracking`, F17) y quien lo ve ya tiene acceso a esos links. Es un defecto hermano de F17: aquella decisión
evitó *guardar* en la lista equivocada; este change evita *pintar* en la lista abierta lo que se pidió para otra.

ADRs de referencia: ninguno nuevo ni afectado; parte de la decisión F17 de `applications-tracking` (archivado el
2026-09-19).

## What Changes

- **Solo la última carga escribe**: cada `reload()` (y por tanto cada `open()`) y cada `close()` inician una carga nueva;
  la respuesta, el error y el fin de `loading` de una carga que ya no es la última se descartan. Es la misma idea que
  `stillFor` en `ApplicationsStore`.
- **`loadMore()` también**: la página siguiente solo se añade si desde que se pidió no se abrió, cerró ni recargó la
  lista; si no, se descarta entera (sin tocar `failure` ni `loadingMore`). `reload()` pone `loadingMore: false`, porque
  deja sin efecto cualquier página siguiente en vuelo.
- **Contador de lectura de una importación**: `importText` solo abre el contador de lecturas si su recarga sigue siendo
  la última y no falló.
- **Tarjetas editadas**: la tarjeta que devuelve una edición solo reemplaza a la de la lista si esta sigue siendo la
  lista donde se pidió.
- **Acciones en la lista donde se hicieron**: `save`, `importText` y `remove` no recargan otra lista si el usuario
  cambió mientras respondía la API.
- **Detalle de grupo**: `GroupDetailPage` no abre la lista del grupo si la página ya se destruyó mientras esperaba el
  grupo y sus miembros.
- Tests de `LinksStore` y del detalle de grupo con TestBed que reproducen las carreras.

## Non-goals

- No cambia la API ni ningún endpoint; no se cancelan peticiones HTTP (se ignora su respuesta).
- No cambia `ApplicationsStore` ni otros stores, ni los avisos del canal de eventos (`applyEnriched`), que no nacen de
  una petición de esta lista.
- No cambia qué se guarda ni dónde: `save`/`importText`/`remove` siguen como quedaron en F17.
