## Context

B11 diferido hasta F2/F3; F2 ya shipped. Relación: `group_links`. Ver proposal.md.

## Goals / Non-Goals

**Goals:** flag por miembro; count + flaggedByMe; persistencia atómica en `group_links`;
limpieza en borrado de cuenta.

**Non-Goals:** nombres; notify; search; lista privada; CRM; campo contador denormalizado.

## Decisions

### D1 — Modelo

`knowSomeoneUserIds: string[]` en `group_links` (default ausente/`[]`). **Prohibido** un campo
`knowSomeoneCount` separado: `count = length` en proyección.

Mutaciones **atómicas**:
- `flagged=true` → `findOneAndUpdate` + `$addToSet: { knowSomeoneUserIds: userId }`
- `flagged=false` → `$pull`

Respuesta desde el documento **after**. Unshare / delete grupo: el doc muere (OK).

### D2 — API

`PUT /api/groups/:groupId/links/:linkId/know-someone`  
Body: `{ flagged: boolean }`.

**Respuesta fija (DTO slim):** `knowSomeoneStateSchema` =
`{ flaggedByMe: boolean, count: number }` en shared. SPA hace merge en el ítem de la lista.
**No** devolver `JobLinkSummary` completo (evitar perder note/comments/publicShare).

**ACL (pin):**
- no miembro / grupo id inválido → `404 group_not_found` (como list/comments)
- relación ausente → `404 link_not_found`
- sin `403` en el toggle propio

### D3 — Listado

`knowSomeone` **optional** en `jobLinkSummarySchema`. GET grupo: **siempre** presente.
Lista privada / saves privados: **omitir** (como `note`).

### D4 — Account deletion

Cascada: `$pull` del `userId` de todos los `knowSomeoneUserIds` en `group_links` (además de lo
ya existente). Delta en `users/account-deletion`.

### D5 — Ex-miembros

V0: el conteo **MAY** incluir userIds de quien ya no es miembro (no $pull en leave). Documentado;
V1 puede limpiar en leave/kick.

### D6 — SPA + plan

Card de grupo: control + badge si count>0. Fila **23**. Sin ADR nuevo.

## Risks / Trade-offs

- Grupos pasivos; conteo con ex-miembros (aceptable V0).

## Migration Plan

Campo nuevo. Deploy. Rollback: SPA deja de llamar.

## Open Questions

Ninguna.
