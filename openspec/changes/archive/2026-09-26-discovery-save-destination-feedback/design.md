## Context

Ver `proposal.md` (Why). Hoy `DiscoveryStore.save` ya captura `groupId` al inicio del handler (ADR-045 §5) y lo
usa para la petición, pero solo guarda en `saveOutcomes[url]` el resultado (`created` / `already` / `error`), no
el destino. La plantilla pinta `@@discovery.save.created` con el texto fijo «Guardada en «Solo para mí».» y
`@@discovery.save.already` con «Ya la tenías guardada.». En un grupo, la API responde `already_there` cuando el
link ya estaba en G (`save-one-link.ts`, `shareInGroup`), a menudo compartido por otro miembro.
Los grupos los tiene `GroupsStore` (root), que la página carga en `ngOnInit`; el selector solo ofrece esos.

## Goals / Non-Goals

**Goals:** las confirmaciones de creado y ya existía dicen la verdad sobre el destino, en ES y EN, sin tocar API ni
`libs/shared`.

**Non-Goals:** reescribir el feedback de error; nombrar a quien compartió (`sharedBy`); destino por hit; persistir
el feedback al salir de la página (el store se destruye con ella, como hoy).

## Decisions

### D1 — El store registra el destino junto al resultado, en la misma escritura

Nuevo estado `saveDestinations: Record<url, DiscoverySaveDestination>` en `DiscoveryStore`. `save` lo escribe con
la constante `groupId` capturada antes del primer `await`, **en el mismo `patchState` que el resultado**, tanto en
el `try` como en el `catch`; esa escritura solo ocurre si se pasó la guarda de `savingUrls`, así que un segundo
clic en vuelo no lo cambia. `run` lo limpia junto a `saveOutcomes`, y el reintento de una URL borra su entrada junto a la del
resultado.

Escribirlo en la misma operación garantiza que no existe un resultado sin destino: si `run` limpia el estado con un
guardado en vuelo y ese guardado termina después, vuelve a escribir ambos (critic C1).

**Alternativa descartada:** que la plantilla lea `saveDestination()` (el selector). Cambiar el selector tras
guardar reescribiría confirmaciones ya mostradas y volvería a mentir, justo lo que ADR-045 §5 evita para la
petición. **También descartado:** escribir el destino al empezar `save` y el resultado al final: deja una ventana
con resultado sin destino, que la página leería como privado.

### D2 — El store guarda el id; la página resuelve el nombre

El store guarda `groupId | null` (lo que se envió). La página resuelve el nombre con `GroupsStore.groups()` al
pintar. Así `DiscoveryStore` no se acopla a `GroupsStore` ni cambia la firma de `save(hit)`.

**Alternativa descartada:** capturar `{ id, name }` en el store: obliga al store a conocer los grupos o a recibir
un nombre desde la vista.

### D3 — Un texto por resultado y tipo de destino

| Resultado | Privado | Grupo con nombre | Grupo sin nombre en la lista |
|---|---|---|---|
| creado | `@@discovery.save.created` «Guardada en «Solo para mí».» (id y texto sin cambios) | `@@discovery.save.createdInGroup` «Guardada en «{{ nombre }}».» | `@@discovery.save.createdInUnknownGroup` «Guardada en el grupo.» |
| ya existía | `@@discovery.save.already` «Ya la tenías guardada.» (sin cambios) | `@@discovery.save.alreadyInGroup` «Ya estaba en «{{ nombre }}».» | `@@discovery.save.alreadyInUnknownGroup` «Ya estaba en el grupo.» |

El nombre va por interpolación (placeholder `INTERPOLATION` en el XLF), no concatenado. Cada fila conserva su
`data-testid` actual (`discovery-save-created` / `discovery-save-already`), así los tests existentes y los
nuevos seleccionan la confirmación por resultado, sea cual sea el destino.

El caso «sin nombre» solo se da si `GroupsStore` (root) se recarga sin G con la página montada. En la misma
pestaña, la única recarga es el `load()` de `ngOnInit`: si el store raíz traía una lista de una visita anterior que
aún incluía G, el usuario puede guardar en G antes de que termine y la lista nueva ya no lo trae (salió del grupo o
se borró desde otra sesión). Es raro, pero decir «Solo para mí» ahí sería volver al bug.

**Alternativa descartada:** un ICU `select` sobre el destino. El nombre del grupo es texto libre, no una clave de
`select`: seguiría haciendo falta interpolación y un caso de reserva; mensajes planos son más legibles para quien
traduce.

### D4 — Catálogo i18n según ADR-050

`messages.xlf` se regenera con `pnpm nx run web:extract-i18n`; las cuatro entradas nuevas se traducen en
`messages.en.xlf` con el mismo `source` que el extraído. En las dos con nombre, el `target` lleva el marcador
literal del XLF, no `{{name}}` (critic C2: ninguna comprobación actual lo detectaría):

- `createdInGroup`: `Saved to “<x id="INTERPOLATION" equiv-text="…"/>”.` (el `equiv-text` copiado del `source`)
- `createdInUnknownGroup`: `Saved to the group.`
- `alreadyInGroup`: `Already in “<x id="INTERPOLATION" equiv-text="…"/>”.`
- `alreadyInUnknownGroup`: `Already in the group.`

## Risks / Trade-offs

- [El grupo se renombra con la página montada y `GroupsStore` se recarga] → se ve el nombre nuevo; es el mismo
  grupo, no es mentira.
- [Nombre de grupo largo] → cabe en la línea de feedback con wrap (flex-wrap ya existe); sin truncado en v1.
- [Un `target` EN con placeholders distintos al `source` no lo detecta ningún check] → se verifica con grep en la
  tarea; comprobarlo en `translations.spec.ts` queda diferido (fuera de alcance).

## Migration Plan

Solo SPA, sin datos persistidos. Rollback: revertir el PR.
