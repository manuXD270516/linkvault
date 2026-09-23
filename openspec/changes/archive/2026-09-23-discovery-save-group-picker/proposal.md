## Why

Discovery v1 guarda solo en lista privada. El valor del vault es el grupo: sin
picker, el usuario busca → guarda → vuelve a compartir, y el inbound de
discovery no entra al feed colaborativo.

## What Changes

- En `/descubrir`, selector de destino: **privado** (default) o un grupo del
  que el usuario es miembro (mismo contrato que la extensión).
- Guardar hit: `POST /api/links` con `{ url }` o `{ url, groupId }` según el
  destino actual (API ya existe; sin endpoint discovery/save).
- Feedback existente (creado / ya existía / error) coherente con destino grupo
  (`shared` / `already_there` cuando aplique).
- Plan §6 fila **31** + nota en ADR-043 o ADR-045 corto.

**Fuera de alcance:**

- Multi-grupo en un click; crear grupo desde discovery.
- Picker por hit (v1 = destino de página, no por fila).
- Más bolsas / headless.
- Cambiar default a grupo (sigue privado).

## Capabilities

### New Capabilities

_(ninguna — reutiliza save de links y listado de grupos)_

### Modified Capabilities

- `web/discovery`: destino privado|grupo + save con `groupId` opcional.
- `discovery/search`: aclarar que el cliente MAY incluir `groupId` en el save
  vía `POST /api/links` (sin endpoint propio).

## Impact

- **Código:** SPA discovery (store/page) + carga de grupos del usuario; i18n.
- **API:** sin cambios de contrato (saveLink ya acepta `groupId`).
- **ADRs:** ADR-045 (o enmienda ADR-043 §guardar).
- **Agentes:** frontend-dev (backend solo si falta facade de grupos en web).
- **Dependencias:** job-discovery + groups en main.
