## Why

B11 (design-v0.2): en grupos de búsqueda el referido es el canal con mejor conversión. Hoy el
grupo es carpeta + comentarios; no hay señal de “alguien aquí conoce gente en esa empresa”.

## What Changes

- **Flag por miembro** en la relación grupo↔link: cada miembro puede marcar/desmarcar “conozco a
  alguien ahí”.
- **API:** toggle autenticado (miembro del grupo); listados de grupo incluyen `knowSomeone`
  (conteo + `flaggedByMe`).
- **SPA:** control en la card del link en vista de grupo + badge visible a miembros.
- Fila **23** en `docs/design-v0.2.md` §6 + `openspec-changes.yaml`.

**Fuera de alcance:**

- Notificar al grupo al marcar; búsqueda/Meili; mensaje libre “a quién”; CRM de contactos;
  flag en lista privada (solo contexto de grupo).

## Capabilities

### New Capabilities

- `groups/know-someone`: dominio del flag, API y reglas de membresía.
- `users/account-deletion`: `$pull` de `knowSomeoneUserIds` al borrar cuenta.

### Modified Capabilities

- `web/links`: UI card de grupo.
- Contrato de listado de links de grupo (`knowSomeone` optional en summary).

## Impact

- **Código:** shared schemas; GroupLink persistencia; API toggle; SPA link-card grupo.
- **ADRs:** ninguno nuevo previsto (o nota corta si debate lo pide).
- **Agentes:** backend-dev, frontend-dev.
- **Dependencias:** groups + job-links en main.
