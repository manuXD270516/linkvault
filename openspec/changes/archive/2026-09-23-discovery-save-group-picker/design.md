## Context

See `proposal.md`. Hoy `DiscoveryStore.save` llama `LinksApi` sin `groupId`.
La extensión ya implementa destino privado + selector de grupo sobre el mismo
`POST /api/links`. La SPA tiene listado de grupos del usuario vía API de
groups.

## Goals / Non-Goals

**Goals:** paridad UX con extensión en `/descubrir`; un destino de página;
feedback honesto; cero API nueva.

**Non-Goals:** default=grupo; picker por hit; crear grupo inline; multi-share;
cambios en discovery adapters.

## Decisions

### D1 — Destino a nivel de página (como extensión)

Un control «Guardar en: Privado | Grupo X» arriba de resultados (o junto al
hint). Todos los CTA Guardar de hits usan ese destino. Cambiar destino no
re-guarda hits previos.

**Alternativa:** picker por fila — más clics y UI densa; diferido.

### D2 — Default privado

Sin `groupId` por defecto (ADR-043 / save privado v1). Elegir grupo es opt-in.

### D3 — Fuente de grupos

Reutilizar el listado de membresía que ya usa el SPA (mismo que shell/grupos).
Si la lista está vacía → solo Privado. Si falla la carga → Privado + aviso no
bloqueante (sigue pudiendo guardar privado).

### D4 — Sin API discovery/save

`POST /api/links` únicamente. No outbox extra desde discovery UI.
`groupId` inválido / no miembro → `404` existente → feedback `error` en SPA.

### D5 — Feedback y captura al click

Mantener `created` / `already` / `error`. `already_there` → `already`.
Cada `save` SHALL leer y fijar `groupId` (o ausencia) **al inicio** del handler
(antes de `await`), para no mezclar destino si el usuario cambia el selector
mid-flight.

### D5b — Carga de grupos

No bloquear la página en `GroupsStore.loaded` si hubo `failure`: tras un intento
fallido, destino = solo Privado + aviso. Tras reload exitoso, si el `groupId`
seleccionado ∉ lista → reset a Privado.

### D6 — Plan

Fila **31** `discovery-save-group-picker`. **ADR-045** (enmienda guardar de
ADR-043).

## Risks / Trade-offs

- [Usuario olvida cambiar destino] → default privado explícito en copy.
- [Muchos grupos] → select nativo / Material; sin búsqueda v1.
- [Race cambio destino mid-save] → cada save captura el `groupId` al click.

## Migration Plan

Solo SPA. Rollback: ocultar selector y omitir `groupId`.
