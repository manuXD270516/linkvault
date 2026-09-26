## Why

En `/descubrir`, la confirmación de guardado dice siempre «Guardada en «Solo para mí».», también cuando el
usuario eligió un grupo como destino. El link sí llega al grupo (el `POST /api/links` lleva `groupId` desde
`discovery-save-group-picker`, fila 31, ADR-045), pero la pantalla afirma lo contrario: el usuario cree que no
lo compartió y lo vuelve a compartir a mano, o no sabe a quién llegó. Lo detectó el catálogo de uso
(`docs/catalogo-de-uso.md`, «No encontrado en el código») el 2026-09-26.

La spec vigente pide copy con «el destino actual» y confirmación «no silenciosa», pero no dice de forma explícita
que la confirmación nombre el destino; por eso la regresión pasó el QA de la fila 31. Este change lo hace
explícito y lo cumple.

## What Changes

- La confirmación de **creado** en `/descubrir` nombra el destino al que se guardó de verdad: el nombre del
  grupo, o «Solo para mí» si fue privado. ES y EN.
- El destino que se nombra es el capturado al pulsar Guardar (ADR-045 §5), no el que haya en el selector
  después: cambiar el selector no reescribe confirmaciones ya mostradas.
- La confirmación de **ya existía** con destino grupo dice que el link ya estaba en ese grupo («Ya estaba en
  «G».»). Hoy dice «Ya la tenías guardada.», que en un grupo es falso a menudo: `already_there` significa que el
  link ya estaba en G, muchas veces porque lo compartió otro miembro. Con destino privado se conserva el texto.
- Si el grupo capturado ya no está en la lista de grupos cargada, las dos confirmaciones usan un texto genérico
  de grupo («Guardada en el grupo.» / «Ya estaba en el grupo.») en vez de inventar un nombre o decir «Solo para mí».
- Tests de componente: guardar en un grupo nombra ese grupo; guardar en privado nombra «Solo para mí»; guardar en
  un grupo que ya la tenía dice que ya estaba en ese grupo.

**Fuera de alcance:**

- Nombrar en «ya existía» quién compartió el link (`sharedBy`): mejora aparte, sin fila.
- El texto de **error**: no afirma un destino.
- Cambios de API, de `libs/shared` o de la extensión.
- Publicar la interfaz en inglés (fila 37 candidata, ADR-050): aquí solo se mantiene el catálogo EN al día.

## Capabilities

### New Capabilities

_(ninguna)_

### Modified Capabilities

- `web/discovery`: las confirmaciones de creado y ya existía nombran el destino real capturado al pulsar Guardar.

## Impact

- **Código:** `apps/web` — `DiscoveryStore` (registrar el destino de cada guardado), `DiscoveryPage` (plantilla y
  resolución del nombre), `discovery.page.spec.ts` y `discovery.store.spec.ts`.
- **i18n:** `messages.xlf` regenerado con `pnpm nx run web:extract-i18n`; traducciones nuevas en
  `messages.en.xlf` (ADR-050).
- **API / shared:** sin cambios.
- **ADRs:** ADR-045 (§5 captura al click, §6 feedback) y ADR-050 (catálogo). Sin ADR nuevo.
- **Plan:** corrección de la fila 31 (`discovery-save-group-picker`); no abre fila nueva en §6 ni entra en
  `openspec-changes.yaml` (el manifiesto lo ejecuta `autopilot.sh` en orden y esto no es una fase del plan).
- **Docs:** retirar la fila correspondiente de «No encontrado en el código» en `docs/catalogo-de-uso.md`.
