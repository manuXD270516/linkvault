## Context

`LinksStore` (`apps/web/src/app/core/links/links.store.ts`) es un `signalStore` raíz compartido por el detalle de grupo y
`/mis-links`. `open(scope)` reinicia el estado y llama a `reload()`; `reload()` y `loadMore()` hacen `await` de
`LinksApi` y parchean el estado sin mirar si la lista cambió mientras tanto. Hay más fuentes de recarga concurrente de la
misma lista: `save`, `importText`, `remove` y el `visibilitychange` del `onInit`. Las ediciones (`updatePreview`,
`pasteDescription`, `undoPaste`, `retryEnrichment`) llaman a `replace()` tras su `await`, y `save`/`importText`/`remove`
recargan tras el suyo.

Fuera del store, `GroupDetailPage.enter()` espera `getGroup` y `listMembers` y luego llama a `open(A)`: si el usuario ya
salió de la página, ese `open(A)` llega el último y abre A en la pantalla siguiente.

`ApplicationsStore` ya resolvió el mismo problema para el cambio de sesión con `stillFor(owner)`: captura el dueño antes
del `await` y descarta si cambió.

## Decisions

### D1. Número de carga para las cargas, ámbito por valor para las acciones

En el cierre de `withMethods`:

- `listLoad`: sube en cada carga de la primera página y en `close()`. `const stillCurrent = (load: number) =>
  load === listLoad`. Dice "esta es la última carga".
- `stillOn(scope)`: `true` si el ámbito abierto tiene el mismo valor (`kind` y `groupId`) que el capturado. Dice "sigue
  abierta la misma lista", sin depender de la identidad del objeto `scope` (critic r1-7) y sin descartar lo que se pidió
  en A si el usuario salió y volvió a A (critic r2-2).

Comparar solo el ámbito arregla A→B, pero no dos recargas del mismo ámbito que responden desordenadas, ni un `loadMore`
que llega después de recargar la misma lista (añadiría la página 2 de un cursor viejo sobre la página 1 nueva y
repetiría links). Por eso las cargas usan `listLoad`; lo que solo debe no cruzar de lista (acciones, D4 y D5) usa
`stillOn`.

### D2. Qué se descarta, y que las promesas se resuelven igual

Si una carga de la primera página ya no es la última, no toca `items`, `total`, `nextCursor`, `loaded`, `reading`,
`failure` ni `loading`: el `loading` lo gestiona la carga vigente (o `close()`, que vuelve al estado inicial). Así un
error tardío de A no aparece como fallo en B y `loading` no se apaga antes de que llegue B. Un error de la carga vigente
se sigue mostrando como hoy.

Descartar es no parchear: las promesas de `open`, `reload`, `loadMore`, `save`, `importText` y `remove` se resuelven
igual y nunca rechazan por el descarte (critic r1-4). `save` e `importText` devuelven la respuesta de la API aunque su
recarga se descarte.

### D3. `loadMore()` captura el número sin incrementarlo

`loadMore` no deja sin efecto la carga vigente (no se ejecuta con `loading` activo), así que toma `const load = listLoad`
y, al volver, solo añade si `stillCurrent(load)`. Si no, descarta todo, incluido el `finally` de `loadingMore`; para que
no quede colgado, la carga de la primera página pone `loadingMore: false` al empezar (deja sin efecto cualquier página
siguiente en vuelo) y `open`/`close` ya lo hacen al volver al estado inicial.

### D4. `save`, `importText` y `remove`: la recarga es de la lista donde se actuó

Las tres capturan el ámbito antes del `await` de la API (critic r1-1). Al volver, si `!stillOn(scope)`, no recargan ni
abren el contador: la lista nueva ya la cargó su propio `open`. Si sigue abierta, recargan con el helper interno de
primera página, que devuelve su número de carga, o `null` si no había ámbito (critic r1-3) o si la carga falló (critic
r2-3: con la lista en error, los links nuevos no están en `items` y el contador se quedaría fijo). `reload()` público lo
envuelve y sigue devolviendo `void`. `importText` solo abre `reading` si el número no es `null` y `stillCurrent(load)`,
comprobado en el mismo tick que el parche.

### D5. Tarjetas editadas: solo en la lista donde se pidieron

`sharedBy` y `sharedAt` son de la relación con la lista donde se pidió la edición. Las cuatro ediciones capturan el
ámbito antes del `await` y solo llaman a `replace()` si `stillOn(scope)`. La acción sigue devolviendo la tarjeta a su
llamante (el diálogo) en ambos casos. Una recarga de la misma lista no invalida la edición: no se compara `listLoad`.

### D6. `GroupDetailPage` no abre la lista si ya se salió

`GroupDetailPage` marca `destroyed` con `DestroyRef.onDestroy` y `enter()` no llama a `open` si está marcado (critic
r1-2). Es el camino más frecuente del cambio rápido de grupo: la ventana está entre la navegación y la petición de la
lista, no solo en la respuesta. `/mis-links` abre en el constructor, sin `await` previo, y no lo necesita.

## Risks / Trade-offs

- Las peticiones descartadas siguen llegando al servidor; cancelarlas añadiría `AbortSignal` a `LinksApi` sin beneficio
  visible. Aceptado (business 5).
- Si una recarga válida R1 queda sin efecto por otra R2 de la misma lista y R2 falla, se ve el error de R2 sobre lo que
  había antes, no la respuesta de R1. Es lo mismo que pasa hoy con una sola recarga fallida y se corrige con la
  siguiente. Aceptado.
- Una recarga pedida *antes* de una edición que responde *después* de su `replace()` vuelve a pintar la tarjeta sin la
  edición (el servidor la leyó antes de escribir). Ya pasa hoy, es raro y lo corrige la siguiente recarga. Aceptado
  (critic r1-6).
- Si el foco vuelve entre la respuesta de una importación y el fin de su recarga, gana la recarga por foco y el contador
  lo decide `readingOf(page)`, que puede no contar las lecturas de esa importación. Aceptado (critic r1-8).
- Nadie cierra la lista al salir hacia una pantalla sin lista (`/postulaciones`): una respuesta tardía llena el store sin
  verse, y la siguiente pantalla con lista lo reinicia al entrar. Cerrar al destruir las páginas queda diferido; no es
  visible (critic r2-1).
- El contador vive en el cierre del store raíz, no en el estado: no es algo que la UI deba observar.
