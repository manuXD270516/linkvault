## Why

El relevamiento de producto del 2026-10-28 encontró tres defectos en la barra del SPA autenticado
(`apps/web/src/app/layout/shell/shell.html`), y los tres los van a ver las 3-5 personas que invita 35b
(`staging-host`), que entran sobre todo desde el móvil:

- **Entradas que llevan a un error.** La barra muestra siempre «Buscar» y «Descubrir» (`shell.html:4-5`). En staging la
  búsqueda está apagada (D13 de `openspec/changes/staging-host/design.md`; el compose de producción no pasa
  `FEATURE_SEARCH` ni `MEILI_*`) y Descubrir depende de `FEATURE_DISCOVERY`, que vale `false` por defecto y que el
  compose de producción tampoco pasa. Quien pulsa cualquiera de las dos llega a una pantalla con formulario y, al
  enviarlo, lee «La búsqueda no está disponible en este momento. Inténtalo más tarde.» (`search_unavailable`) o «El
  descubrimiento de vacantes no está disponible en este momento.» (`discovery_disabled`). Las dos frases son falsas en
  ese entorno: no es «en este momento», es nunca. Lo mismo pasa con «Activar push» en Notificaciones cuando faltan las
  claves VAPID (el compose de producción tampoco las pasa); eso queda fuera de este change (iteración 1 del debate,
  B2) y puede sumarse al contrato por adición.
- **Nadie sabe qué está activo.** No hay ningún endpoint que lo diga; el SPA solo se entera por el `503` después de
  que la persona lo intentó.
- **En el móvil la barra se come la pantalla.** Desde `e2e-suite` (tarea 5.4b) la barra pasa las entradas que no caben
  a otra fila. En un Pixel 7 ocupa **tres filas**, alrededor del 15 % de la pantalla, y lo primero que se ve es
  «Buscar» (captura `docs/guia-de-uso/img/088-movil-grupos.png`, guía §27). El plan de medición de 35b mide la
  **activación** como «primer link guardado en menos de 48 h desde el alta»: la barra empuja hacia abajo justo lo que
  lleva a guardar ese primer link (los grupos, el detalle del grupo con su formulario).

## What Changes

- **Endpoint de capacidades** `GET /api/capabilities`, con sesión (guard global), que devuelve solo booleanos
  derivados de la configuración del proceso: `search` y `discovery`. Contrato zod en `libs/shared`, aditivo. Nada de
  hosts, claves, nombres de proveedores ni estado de salud. Se calcula una vez al arrancar y se sirve con
  `Cache-Control: private, no-store`; el SPA lo pide una vez por carga (design D1-D4).
- **El SPA oculta lo que no está activo:** «Buscar» y «Descubrir» solo aparecen en la barra si su capacidad es
  `true`. Mientras no se sabe, no aparecen; si la petición falla, aparecen como hoy (falla abierto: es navegación, no
  seguridad). La barra expone el estado en `data-capabilities` (D5, D6).
- **Enlaces directos honestos:** con la capacidad apagada, `/buscar` y `/descubrir` siguen cargando, pero sin
  formulario: dicen que la función no está incluida en esta versión de LinkVault y ofrecen ir a «Solo para mí» (y, en
  Descubrir, a «mis grupos»). Sin redirección y sin llamar a la API; mientras las capacidades no llegan, un estado
  neutro sin nada accionable (D5, D7).
- **Barra compacta en pantallas estrechas:** por debajo de 1024 px, una sola fila con la marca y un botón «Menú» que
  despliega la lista de navegación (patrón *disclosure*: botón con `aria-expanded` y un `<nav>` siempre presente con
  enlaces), que se cierra al navegar, con Escape y al pasar a modo ancho, con el foco gestionado. Por encima, la barra
  de siempre. Una sola lista de entradas para los dos modos, con lo
  que lleva a guardar y seguir ofertas primero: Grupos, Solo para mí, Postulaciones, Mi CV, y después Buscar, Descubrir
  y Perfil (D8-D10).
- **Textos ES/EN** con el catálogo re-extraído (ADR-050) (D12).
- **Camino crítico (`@lot1`) adaptado y re-admitido:** navega por la barra en los dos modos con un ayudante, y afirma
  que «Buscar» y «Descubrir» aparecen o no según la respuesta de capacidades que recibe el propio SPA (D13).

## Fase y excepción a la fila 35

La fila 35 (35b → 35c) no está cerrada y su precedencia (ADR-048 §Consecuencias, extendida a la fila entera por
ADR-051 §1) impide que entre un change de otra fila. ADR-055 §1 abrió una excepción **solo** para `usage-guide-fixes` y
dice expresamente que no la libera para ningún otro change.

Este change se propone como **∥ 35b**, segunda excepción a esa precedencia, con las mismas condiciones de diseño que
la primera: no cambia el orden de la fila, no toca ficheros de despliegue ni workflows, y no modifica ningún
requirement que 35b o 35c modifiquen (los suyos están en `platform/ci-pipeline`, `platform/email` y
`platform/production-deploy`; este change añade la capacidad nueva `platform/capabilities` y no toca esas tres).
**Abrirlo, aplicarlo y fusionarlo antes de invitar en 35b es decisión del owner: Q1 de `design.md`, bloqueante para
`/opsx:apply`**, registrada en **ADR-059** (Propuesto). El PR-1 de 35b ya está en `main` (#86) y 35b prohíbe fusionar
entre su PR-1 y su PR-2; `e2e-suite` (D15) prohíbe fusionar entre el PR-2 de 35b y su 11.6. La única ventana que
queda es **después de la 11.6 de 35b y antes de su 10.7**, repitiendo la 9.4 de `e2e-suite` sobre el commit desplegado
(design D14; recomendación). El PR de archivo y las posibles vueltas atrás tienen sus propias reglas: nunca entre el
PR-2 de 35b y su 11.6, ni durante su 9.1-9.4, ni los días 7 y 14 de la medición, ni el día de una corrida
`e2e-remote` (D14). La alternativa es que el owner autorice
expresamente una excepción a la regla «entre PR-1 y PR-2» de 35b, con riesgo para su 6.3 (Q1 (d)). Si el owner dice
que no, el change espera a que cierre la 35c y entra como fila propia.

## Capabilities

### New Capabilities

- `platform/capabilities`: endpoint autenticado que dice qué funciones opcionales están activas en el despliegue, sin
  exponer configuración sensible.
- `web/shell`: la barra de navegación del SPA autenticado, sus entradas según las capacidades y su modo compacto.

### Modified Capabilities

- `web/search`: «Ruta lazy de búsqueda» enlazada desde la barra solo con la búsqueda activa; nuevo requirement del
  estado «no incluida en esta versión».
- `web/discovery`: nuevo requirement del estado «no incluido en esta versión».

## Impact

- `libs/shared/src/schemas/capabilities.schema.ts` (+ spec) y su export.
- `apps/api`: función pura de derivación junto a la configuración, controlador `GET /api/capabilities` en
  `presentation/http` (fuera de los módulos de dominio: solo lee `APP_CONFIG`), su módulo y sus tests.
- `apps/web`: `core/capabilities/` (cliente y store), `layout/shell/` (lista de entradas, modo compacto, specs),
  `features/search`, `features/discovery`; `messages.xlf` re-extraído y `messages.en.xlf`.
- `apps/web-e2e/src/critical-path.spec.ts`, `search.spec.ts` y un ayudante de navegación en `src/support/`;
  re-admisión en un bloque propio de «Admisiones» de `README.md`.
- `docs/guia-de-uso/README.md` §27 y sus capturas del móvil.
- Ningún cambio en composes, workflows, variables de entorno ni requirements de `platform/*` existentes.

## Coordinación

- **`web-english-locale` (fila 37, candidata, fuera del manifiesto):** pondrá el selector de idioma en esta misma
  barra. Este change deja una sola lista de entradas y el panel compacto; el selector va al final de los dos, antes de
  «Cerrar sesión», sin otro rediseño. Los textos nuevos de este change ya llevan su traducción inglesa (ADR-050).
- **`staging-host` (35b):** su aviso de invitación dice que la búsqueda no está disponible; sigue siendo cierto y no
  hace falta tocarlo (Q4). La 10.7 de 35b y la 9.4 de `e2e-suite` se ejecutan sobre el commit desplegado: si este
  change se fusiona antes de invitar, prueban ya la barra nueva, y una 9.4 hecha antes de la fusión se repite.
- **`e2e-suite`** (activo): este change modifica `critical-path.spec.ts`, que es su lote 1, sin cambiar sus pasos
  declarados ni su requirement; por eso exige re-admitirlo (D13), también en `webkit` si su 9.9 ya está hecha, con
  las filas en un bloque propio para no chocar con su PR-2.
- **`e2e-suite-lot-2`:** H3 (bóveda BYOK ausente) sigue allí; si algún día se quiere resolver con una capacidad, se
  añade al contrato sin romperlo (D4, Q2).

## Fuera de alcance

- Capacidades `push`, `externalAi` y `byokVault`, y cualquier cambio en Notificaciones (Q2).
- Activar la búsqueda o Descubrir en staging (sigue siendo D13 de 35b y un change posterior a 35c).
- Un atajo global «Guardar link» en la barra (Q3).
- Estado de salud en vivo de Meilisearch o de las bolsas de Discovery: una avería transitoria sigue mostrando el `503`
  honesto que ya tienen las páginas.
- El selector de idioma (fila 37).
