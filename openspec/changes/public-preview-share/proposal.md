## Why

Hoy una oferta guardada en LinkVault solo la ve quien tiene cuenta y está en el grupo. El enlace sigue circulando por
WhatsApp como una URL pelada de la bolsa, sin título, sin empresa y sin nada que diga de dónde salió. design-v0.2 (B8,
§5.5) y ADR-013 cierran ese hueco con una **página pública por link**: la API devuelve HTML con etiquetas Open Graph
para que el chat pinte la tarjeta de la oferta, y a la persona la lleva al SPA, donde ve la vacante y encuentra el CTA
"Guardar en LinkVault". Cada link compartido pasa a ser una invitación, sin montar SSR de Angular para una sola página
(ADR-013, Critic C9).

Este change entrega el orden 10 de design-v0.2 §6 con las decisiones humanas del 2026-09-19: el `slug` es **opaco y por
link compartido**, la página enseña **solo la vacante**, `settings.defaultVisibility` del grupo **solo afecta a lo que se
comparta después** y publica o despublica **quien compartió el link o el propietario**, como ya ocurre con la nota y los
comentarios. De la herencia del manifiesto, el `slug` de grupo **no hace falta** y queda resuelto sin crearlo.

## What Changes

- **Enlace público por relación link-grupo** (`group_links.publicShare`): un `slug` aleatorio de 12 caracteres, sin
  título ni empresa dentro, único por índice. Publicar crea el slug; despublicar lo **quema**: quien tenga el enlace
  recibe `404` y volver a publicar crea uno nuevo. Quitar el link del grupo o borrar el grupo se lo llevan con la
  relación.
- **Quién manda**: publica y despublica quien compartió el link o el `owner` del grupo
  (`PUT|DELETE /api/groups/:id/links/:linkId/public`). Cualquier miembro ve que el link está publicado; solo esos dos
  cambian el interruptor.
- **Visibilidad por defecto del grupo** (`groups.settings.defaultVisibility`, `public` | `private`, **`public` por
  defecto**): decide si un link **que entra a partir de ahora** nace publicado, al guardarlo uno a uno o al importar un
  chat. Cambiarla **nunca** toca los links ya compartidos, y cada link conserva su propio interruptor. La cambia el
  `owner` con `PATCH /api/groups/:id/settings`.
- **`GET /p/:slug` servido por la API**, fuera del prefijo `/api` (como la salud): HTML mínimo en español, escapado a
  mano, `text/html; charset=utf-8`, con las etiquetas Open Graph y Twitter de la vacante y un redirect a la SPA
  (`<meta http-equiv="refresh">` + `location.replace` + enlace visible de respaldo). **No se distingue bot de humano**:
  la misma respuesta sirve a los dos (ADR-013). Un slug desconocido o despublicado responde `404` con HTML útil, nunca
  con un JSON.
- **Qué sale y qué no**: título, empresa, ubicación, modalidad, nivel, salario, fechas y el enlace a la oferta original.
  **Nunca** `summary`, habilidades, idiomas, procedencia por campo, quién la compartió, a qué grupo pertenece,
  comentarios, notas ni postulaciones (ADR-026, ADR-023 §2).
- **Vista pública en el SPA**: ruta `/oferta/:slug` sin sesión, que lee `GET /api/public/previews/:slug` y ofrece el CTA
  "Guardar en LinkVault", que navega siempre a `/registro?import=<slug>` sin esperar a nada; con sesión, el guard de
  invitado desvía a `/mis-links?import=<slug>`, que guarda la oferta **en la lista privada** y dice si ya la tenías. Un
  `404` dice que el enlace ya no está; un `429` o un `5xx` dicen que es una avería nuestra, con "Reintentar" y sin
  quitar el CTA.
- **Límite y coste**: contadores **globales de ruta** —uno para `/p/:slug`, otro para el endpoint JSON— más uno **por
  `slug`**, sin mirar la dirección de origen ni ninguna cabecera del cliente; se consumen tras validar el formato del
  `slug` y **antes** de leer, **fallan abiertos** y responden `429` en HTML (o `too_many_attempts` en el JSON) con
  `Retry-After`. La petición hace **dos lecturas indexadas y ninguna escritura**: ni enriquecimiento, ni IA, ni outbox,
  ni avisos, ni nombres. Los límites por IP y la configuración del proxy siguen siendo de `deploy-prod`: este change
  **no** toca `trustProxy`.
- **Cabeceras y saneado**: la página **no ejecuta JavaScript** (el salto va solo con `meta refresh`), y lleva
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` y una CSP con `default-src 'none'` en sus tres
  respuestas; el `displayUrl` se publica sin credenciales ni parámetros de campaña, conservando el fragmento; `noindex`
  también en la ruta pública del SPA, con `Disallow: /oferta/` en su `robots.txt`.
- **Interruptor en el SPA**: en la tarjeta del grupo, con el aviso "Cualquiera con este enlace podrá ver la oferta sin
  entrar en LinkVault…" y "Copiar enlace". Textos en ES y EN.

## Capabilities

### New Capabilities

- `links/public-share`: el enlace público por link compartido, quién lo enciende y lo apaga, la visibilidad por defecto
  del grupo al compartir, la página `/p/:slug` con sus etiquetas OG, qué no sale nunca, el `404` del enlace quemado, el
  endpoint público para el SPA, el límite global de las dos rutas y el ciclo de vida del enlace con la relación.
- `web/public-preview`: la vista pública `/oferta/:slug`, el CTA "Guardar en LinkVault" con y sin sesión, la importación
  desde `?import=<slug>`, el interruptor de la tarjeta con su aviso y sus textos.

### Modified Capabilities

- `links/sharing`: cambian "Guardar un link" (nace publicado según el grupo), "Compartir sin duplicar" (el enlace del
  primero no cambia), "Importar links desde un texto" (la misma regla), "Listado de links de un grupo" (`publicShare`),
  "Listado de links privados" (sin `publicShare`) y "Quitar un link de un grupo o de la lista privada" (quema el
  enlace).
- `groups/group-management`: cambia "Detalle de un grupo" (devuelve `defaultVisibility`) y se añade el requisito
  "Visibilidad por defecto de los links del grupo".
- `auth/sessions`: cambia "Rutas protegidas por defecto" (el prefijo `/api/public/*` no exige sesión).
- `web/auth`: cambian "Registro y login" (el `import` viaja entre las dos páginas y gana a la ruta pedida), "Rutas
  autenticadas y de invitado" (tercera ruta pública y destino del `guestGuard` con `import`) y "Restauración de la
  sesión al cargar" (en una ruta pública no se restaura sesión al arrancar).
- `platform/local-environment`: cambian "Web y API comparten origen en desarrollo" (`/p/:slug` fuera del prefijo) y
  "Configuración por entorno documentada" (`PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL`).
- `web/groups`: cambia "Detalle del grupo" (el interruptor de visibilidad por defecto, solo para el `owner`).
- `web/links`: cambian "Guardar un link desde el SPA" (la confirmación ofrece "Copiar enlace" y dice el alcance cuando
  el link nace publicado) y "Quitar un link desde el SPA" (la confirmación avisa de que el enlace público dejará de
  funcionar).

## Impact

- **Código**:
  - `apps/api/src/modules/links/`: dominio del enlace público y su generador, casos de uso de publicar, despublicar y
    leer la página, plantilla HTML con su escapado, controladores `/p/:slug` y `/api/public/previews/:slug`, `share` con
    `publicShare`, y el mapeo del listado.
  - `apps/api/src/modules/groups/`: `settings.defaultVisibility`, su `PATCH` y `GroupsFacade`.
  - `apps/api/src/app/create-app.ts` (excluir la ruta `p/:slug` del prefijo) y
    `apps/api/src/infrastructure/mongo/duplicate-key.ts` (`duplicateKeyIs` compartido).
  - `libs/shared/src/`: contratos del slug, del preview público y de los ajustes del grupo, `linkLabel` movido desde el
    SPA y la lista cerrada de parámetros de campaña que hoy vive en el dominio de `links`.
  - SPA: `core/links/`, `core/public/`, `features/public/`, `features/links/`, `features/groups/`, `features/auth/`,
    `app.routes.ts`, `auth.guards.ts`, `session-restore.ts`, `public/assets/` y `messages.*.xlf`.
- **API**:
  - nuevos: `GET /p/:slug` (HTML, fuera de `/api`), `GET /api/public/previews/:slug` (sin sesión),
    `PUT|DELETE /api/groups/:id/links/:linkId/public` y `PATCH /api/groups/:id/settings`;
  - cambian: `POST /api/links` y `POST /api/links/import` (pueden publicar), `GET /api/groups/:id/links`
    (`publicShare`) y `GET /api/groups/:id` (`defaultVisibility`).
- **Datos**:
  - `group_links` suma `publicShare?` (`slug`, `publishedBy`, `publishedAt`) con un índice **único parcial** sobre
    `publicShare.slug`; sus tres índices actuales no cambian;
  - `groups` suma `settings?.defaultVisibility`, sin índices nuevos;
  - **sin backfill**: un grupo sin `settings` se lee como `public` y una relación sin `publicShare` como no publicada,
    así que ningún link ya compartido se publica solo.
- **Configuración**: `PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL`, obligatorias como el resto, en `.env.example` y en el
  RUNBOOK. `deploy-prod` hereda fijarlas y, si algún día quiere límites por IP, configurar el proxy y `trustProxy`,
  que **no** entran aquí (ADR-020).
- **ADRs**: implementa ADR-013; cumple ADR-026 (nada de comentarios ni notas en la página) y ADR-023 §2 (`summary`
  fuera); respeta ADR-010 (la procedencia por campo no sale) y ADR-009 (nada se encola). Las decisiones no triviales se
  registran en **ADR-027**.
- **Manifiesto** (`openspec-changes.yaml`): `public-preview-share` pasa a `adrs: [013, 027]`; la herencia del `slug` de
  grupo queda **resuelta sin crearlo** y `deploy-prod` hereda las dos variables nuevas, el proxy con sus límites por IP
  y que el borrado de cuenta despublique los enlaces de esa persona.
- **Fuera de alcance**:
  - límites por IP y configuración del proxy (`trustProxy`), que siguen siendo de `deploy-prod`;
  - publicar un link de la lista privada (design-v0.2 §5.5: `sharePublic` false para los privados);
  - `slug` de grupo, páginas públicas de grupo y cualquier índice en buscadores (la página va con `noindex`);
  - imagen OG generada por oferta (una imagen de marca fija);
  - SSR de Angular (ADR-013);
  - métricas de adquisición, contador de visitas y analítica de la página;
  - caché en proceso del HTML por `slug`;
  - i18n de la página servida por la API (va en español, como el preview);
  - caducidad del enlace público y enlaces con contraseña.
