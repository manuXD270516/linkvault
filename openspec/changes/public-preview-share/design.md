## Context

ADR-013 decidió que **la API sirve `/p/:slug`**: HTML mínimo con etiquetas Open Graph para los bots de los chats y un
redirect a la SPA para las personas, sin SSR de Angular. design-v0.2 §5.5 lo concreta en tres pasos (bot → HTML con OG;
humano → mismo HTML + redirect; SPA → preview completo + CTA "Guardar en LinkVault") y añade que el link solo se expone
si tiene `sharePublic`, "true por defecto para links de grupo, false para privados".

Lo que ya existe y este change aprovecha:

- **La relación link-grupo.** `group_links` es `{ groupId, linkId, sharedBy, sharedAt, note?, commentCount,
  commentsRevision }`, con tres índices: único `(groupId, linkId)`, el del listado `(groupId, sharedAt, _id)` y el del
  reparto `{ linkId: 1 }`. `MongoGroupLinkRepository` es su único dueño y el único que abre transacciones sobre ella
  (ADR-026 §2).
- **Permisos de "quien compartió o el propietario".** `RemoveGroupLink` y `RemoveShareNote` ya lo resuelven con
  `membershipOf`, que devuelve el rol.
- **Secretos cortos e irrepetibles.** `groups` genera el código de invitación con un alfabeto sin caracteres ambiguos y
  se apoya en un **índice único** para la unicidad, no en una consulta previa (`RandomInviteCodeGenerator`,
  `duplicateKeyIs`).
- **Límites.** `FIXED_WINDOW_COUNTER` de plataforma, detrás de `LINK_LIMITER` (`CounterLinkLimiter`), con `consume`,
  `refund` y la elección explícita de fallar abierto o cerrado por tipo de clave.
- **Rutas fuera del prefijo.** `configureApp` ya excluye `health` y `health/live` de `/api`, y `@Public()` marca las
  rutas que el guard global no protege.
- **Preview con procedencia por campo** (ADR-010, ADR-022, ADR-023): cada campo guarda quién lo puso. `outputLanguage`
  del preview es fijo `es` porque el preview es compartido (ADR-023 §1).
- **SPA.** Rutas en español y perezosas, `authGuard`/`guestGuard`, `safeReturnUrl`, `LinksStore` y `LinkCard`, y
  `linkLabel(url)`, la etiqueta legible de un link sin título.

Motivación y alcance: proposal.md; comportamiento: las specs; decisiones no triviales: **ADR-027**.

### Decisiones humanas previas (2026-09-19)

1. **El `slug` es opaco y por link**, como el código de invitación: una cadena aleatoria corta, sin título ni empresa
   dentro y sin colisiones. **No hace falta el `slug` de grupo** que el manifiesto dejaba heredado de `groups`: esta
   página no tiene URL de grupo, así que la herencia queda **resuelta sin crear el campo** (D1).
2. **La página muestra solo la vacante**: título, empresa, ubicación, modalidad, nivel, salario y fechas, con enlace a
   la oferta original. Nada de quién la compartió, ni comentarios, ni notas, ni postulaciones (D6).
3. **`defaultVisibility` del grupo aplica solo a los links que se compartan después**, y viene **activada**. Los ya
   compartidos no cambian nunca al tocarla, y cada link conserva su propio interruptor (D3).
4. **Publica o despublica quien compartió el link o el propietario del grupo**, como en la nota y los comentarios (D2).

## Goals / Non-Goals

**Goals:**

- Que un enlace pegado en WhatsApp llegue con la oferta puesta —título, empresa, dónde y cuánto— y no como una URL
  pelada.
- Que quien lo recibe sin cuenta entienda la oferta y tenga un solo botón para quedársela.
- Que publicar sea el gesto por defecto del grupo y aun así siga siendo **una decisión por link**, reversible y sin
  sorpresas retroactivas.
- Que la página pública no filtre nada que la persona no eligió publicar: ni el grupo, ni su nombre, ni el texto que
  alguien pegó.
- Que un bot que pide la página mil veces no nos cueste una lectura de la bolsa, una llamada a la IA ni una escritura.

**Non-Goals:**

- **Publicar un link de la lista privada.** design-v0.2 §5.5 fija `sharePublic` en `false` para los privados, la
  decisión humana 4 describe un permiso que presupone grupo (quien compartió **o el propietario**) y
  `defaultVisibility` es un ajuste **de grupo**. El camino futuro está escrito en D1 y no exige rehacer nada.
- **`slug` de grupo, páginas públicas de grupo y URLs "bonitas"** con el puesto o la empresa dentro (decisión humana 1).
- **Indexación en buscadores.** La página va con `noindex` (D5).
- **Imagen OG generada por oferta.** Una imagen de marca fija (D5).
- **SSR de Angular** (ADR-013).
- **Métricas de adquisición**: contador de visitas, de importaciones desde la página o atribución por slug. Cambiaría el
  "ninguna escritura" de D7 y pide su propio diseño.
- **i18n de la página servida por la API**: va en español, igual que el preview (D4).
- **Caducidad del enlace, enlaces con contraseña o revocación masiva** ("despublicar todo mi grupo").
- **Avisar en vivo del cambio de interruptor**: como la nota, se escribe y se ve al recargar (ADR-026, Non-Goals).

## Decisions

### D1 — Dónde vive el enlace público: la relación link-grupo

Opciones, con la votación del debate y el desempate de arquitectura:

| Opción | A favor | En contra |
|--------|---------|-----------|
| **A. En `group_links`** (`publicShare?` con el slug) | El permiso de la decisión humana 4 —quien compartió **o** el propietario— es exactamente el de `RemoveGroupLink` y `RemoveShareNote`, y solo existe sobre una relación. Quitar el link o borrar el grupo se llevan el enlace **sin un hook nuevo** (ADR-021 §6, ADR-024). `defaultVisibility` es del grupo, y lo que nace de ella nace en la relación. El listado del grupo ya proyecta la relación: el interruptor viaja **sin una lectura más**. Un solo `findOne` por slug resuelve la página. | Un mismo `JobLink` en dos grupos puede tener dos enlaces públicos distintos. |
| B. En `job_links` (la vacante canónica) | Una vacante, una URL pública. | Un `JobLink` no tiene dueño: quien lo guardó primero puede no estar en el grupo. Publicarlo en un grupo lo publicaría para **todos** los grupos y para las listas privadas de terceros, que nunca lo pidieron. `defaultVisibility` de un grupo decidiría por los demás. No hay a quién dar el permiso de despublicar. |
| C. Colección propia `public_link_shares` | Un índice único limpio y un sitio para métricas futuras. | Una escritura y un borrado más que coordinar con la relación, o huérfanos que resucitan al volver a compartir —la carrera que ADR-026 §2 cerró—; una lectura más por página del listado para pintar el interruptor; y un hook nuevo para el borrado de grupo. |

Votación: privacidad y consentimiento → A; coste por lectura → A; unicidad de la URL por vacante → B; sitio para
métricas → C. **Gana A**, 2 a 1 a 1. El desempate de arquitectura confirma A: la invariante de este change es "el enlace
público existe mientras exista el permiso de quien lo publicó", y ese permiso **es** la relación. Con B el consentimiento
de una persona publicaría datos de otras; con C habría dos dueños de una sola invariante, que es justo lo que ADR-026 §2
prohibió para los comentarios.

**El `slug` de grupo no se crea.** El manifiesto lo dejaba heredado "si este change lo necesita". No lo necesita: la
única URL pública que nace aquí identifica **un link compartido**, no un grupo, y la decisión humana 1 pide además que
sea opaca —un slug derivado del nombre del grupo diría a qué grupo pertenece, que es justo lo que D6 prohíbe—. Queda
**resuelto sin crear el campo**, y así se anota en el manifiesto.

Estructura dentro de `links` (clean architecture, puertos por token):

- **`domain/`** (sin `@nestjs/*` ni `mongoose`):
  - `public-share.ts`: la entidad `PublicShare` (`slug`, `publishedBy`, `publishedAt`), `mayPublish(requesterId, role)`
    —quien compartió o `owner`— y `isValidPublicSlug(slug)`;
  - `public-slug.ts`: `PUBLIC_SLUG_ALPHABET`, `PUBLIC_SLUG_LENGTH` y el patrón;
  - errores `PublicShareForbidden` (`forbidden`), `PublicShareNotFound` (`link_not_found`) y
    `PublicSlugExhausted` (interno, `internal_error`);
  - `limits.ts` gana `PUBLIC_PAGE_VIEWS_PER_IP`.
- **`application/`**:
  - puerto `PUBLIC_SLUG_GENERATOR` (`next(): string`), con su doble determinista en `testing/`;
  - casos de uso `PublishGroupLink`, `UnpublishGroupLink` y `GetPublicPreview`;
  - cambian `SaveLink`, `ImportLinks` y `ListGroupLinks`.
- **`infrastructure/`**: `random-public-slug.generator.ts`, `publicShare` en `link.schemas.ts` con su índice, y
  `MongoGroupLinkRepository` con `publish`, `unpublish` y `findByPublicSlug`.
- **`presentation/`**: `public-page.controller.ts` (`/p/:slug`, fuera de `/api`), `public-previews.controller.ts`
  (`/api/public/previews/:slug`), `public-page.html.ts` (plantilla pura) y la ruta del interruptor en
  `GroupLinksController`.

Entre módulos, solo lo que ya existe: `GROUP_MEMBERSHIP` sobre `GroupsFacade`. `LinksFacade` no cambia.

### D2 — El slug: forma, unicidad y quién enciende el interruptor

**Forma.** 12 caracteres de un alfabeto de 30 símbolos en minúscula, `23456789abcdefghjkmnpqrstvwxyz` (Crockford sin
`0`, `1`, `i`, `l`, `o` ni `u`): 30¹² ≈ 5,3·10¹⁷, unos 59 bits. Minúsculas porque un slug se copia y se pega dentro de
una URL, no se teclea en mayúsculas como el código de invitación; la comparación es **exacta y sensible a
mayúsculas**, sin normalizar: un slug con otra caja es un slug que no existe. Nada del contenido entra en él (decisión
humana 1): ni el título, ni la empresa, ni el grupo, ni el `linkId`.

**Unicidad por índice, no por consulta.** Índice **único parcial** sobre `group_links`:
`{ 'publicShare.slug': 1 }` con `partialFilterExpression: { 'publicShare.slug': { $exists: true } }`. La publicación
intenta escribir y, si choca con ese índice (`duplicateKeyIs`), genera otro slug y reintenta hasta **5** veces; a la
sexta lanza `PublicSlugExhausted` (`500`). Es el patrón de `groups` con el código de invitación, y es lo único que cierra
la carrera de dos publicaciones simultáneas. Los tres índices actuales de `group_links` **no se tocan**.

**Publicar** (`PUT /api/groups/:id/links/:linkId/public`), en este orden:

1. pertenencia (`membershipOf`): quien no es miembro recibe `404 group_not_found`;
2. relación (`find`): un link que no está en el grupo recibe `404 link_not_found`;
3. permiso (`mayPublish`): quien no compartió el link y no es `owner` recibe `403 forbidden`, **esté o no publicado**;
4. si **ya** está publicado, responde `200` con el mismo slug, sin generar otro (idempotente: dos pestañas no dejan dos
   enlaces vivos);
5. si no, genera slug y escribe con `updateOne({ groupId, linkId, 'publicShare': { $exists: false } }, { $set })`. Si no
   modifica nada, relee: publicado por otra pestaña → `200` con el slug de esa, relación ya no está →
   `404 link_not_found`.

**Despublicar** (`DELETE /api/groups/:id/links/:linkId/public`): las mismas tres comprobaciones y después
`$unset: { publicShare: 1 }`, con `204` estuviera o no publicado. El orden es el mismo que el del `DELETE` de la nota
(ADR-026 §3) y por el mismo motivo: la respuesta no revela a quien no puede tocarlo si el link estaba publicado.

**El slug se quema.** Despublicar borra el slug; volver a publicar genera **uno nuevo**. Quien tuviera la URL vieja
recibe `404` para siempre. Se descarta conservarlo: "despublicar" tiene que significar "este enlace deja de funcionar",
y devolverle el acceso a un tercero porque el dueño volvió a activar el interruptor sería exactamente lo contrario.
Se acepta el coste: quien vuelve a publicar tiene que volver a repartir la URL.

**Permisos, en tabla:**

| Acción | Quién | Si no |
|--------|-------|-------|
| Ver que un link del grupo está publicado y su URL | miembro actual | `404 group_not_found` |
| Publicar y despublicar | quien compartió el link o el `owner`, siendo miembros | `403 forbidden` |
| Ver la página pública | cualquiera con el enlace, sin sesión | `404` si el slug no existe o se quemó |

**Cualquier miembro ve la URL pública** aunque no pueda cambiar el interruptor: ya está publicada, la URL no dice a qué
grupo pertenece y esconderla solo obligaría a pedírsela a quien la publicó. Queda como riesgo aceptado que cualquier
miembro pueda repartirla.

**Alternativas descartadas:** un slug derivado del título o de la empresa (dice de qué va el grupo y colisiona); usar el
`linkId` como slug (revela el identificador interno y publica todas las relaciones del mismo link a la vez); comprobar
la unicidad con un `findOne` previo (no cierra la carrera); un slug por persona y link (multiplicaría las URLs de la
misma oferta sin que nadie lo pida).

### D3 — `defaultVisibility` del grupo: solo hacia adelante

`groups.settings.defaultVisibility` toma `'public' | 'private'`, **por defecto `'public'`** (decisión humana 3). Un
grupo sin `settings` se lee como `'public'`: los grupos que ya existen se comportan como los nuevos, y aun así **ningún
link ya compartido se publica** (D11), porque el ajuste solo decide qué pasa **al entrar** un link.

- **Lo cambia el `owner`** con `PATCH /api/groups/:id/settings { defaultVisibility }`; un miembro recibe `403 forbidden`.
  Ruta propia en vez de ampliar `PATCH /api/groups/:id`, que hoy exige `name`: hacer `name` opcional debilitaría el
  renombrado y obligaría a un "al menos un campo" en un contrato bien probado.
- **`GET /api/groups/:id` devuelve `defaultVisibility`** a cualquier miembro (no solo al `owner`): quien comparte un link
  tiene derecho a saber si va a nacer público. `GET /api/groups` no lo lleva: la lista no comparte nada.
- **Cambiarla no escribe en ningún link.** Ni sube ninguna revisión, ni despublica, ni publica. Es una decisión humana y
  además la única segura: apagarla y que se despublicaran cien links repartidos por WhatsApp, o encenderla y publicar
  de golpe lo que un grupo llevaba meses guardando en privado, son daños irreversibles hechos por un clic.
- **Cómo llega a `links`.** `links` no lee las colecciones de `groups`: `UserGroup` (el tipo que devuelve
  `GROUP_MEMBERSHIP.groupsOf`) gana `defaultVisibility`. `SaveLink` ya llama a `groupsOf(userId)` para
  `alreadyInGroups`, así que lo obtiene **sin una lectura más**; `ImportLinks` cambia su `membershipOf(groupId, userId)`
  por el mismo `groupsOf`, que le da a la vez la pertenencia y el ajuste, también en una sola lectura.
- **Importar también publica.** Los 50 links de un chat entran igual que uno suelto. Es lo contrario que la nota, y a
  propósito: la nota es un texto escrito para **un** link y por eso la importación no la admite (ADR-026 §3), mientras
  que la visibilidad por defecto es una política del grupo sobre **todo** lo que entra. Publicar solo lo guardado uno a
  uno dejaría el ajuste diciendo algo que no cumple.
- **Solo al crear la relación.** Si el link ya estaba en el grupo, no se publica ni se despublica nada, igual que la nota
  del primero no cambia.

**Alternativas descartadas:** aplicarla también a lo ya compartido (decisión humana 3); un valor por defecto `private`
(design-v0.2 §5.5 fija "true por defecto para links de grupo" y este change lo cumple); un ajuste por miembro; que la
importación no publique; guardarla como un booleano `publicByDefault` (un enum deja sitio a un tercer valor —"solo con
enlace y con contraseña"— sin migrar nada).

### D4 — Cómo sirve la API el HTML, sin SSR y sin distinguir bots

**La ruta.** `GET /p/:slug`, **fuera del prefijo `/api`**, añadida al `exclude` de `setGlobalPrefix` junto a `health`.
Motivos: la URL se pega en un chat y tiene que ser corta; y `/api/...` es, por contrato, JSON con sesión.

**Una sola respuesta para todo el mundo.** No se mira el `User-Agent` ni el `Accept`. Bots y personas reciben el **mismo
`200`** con el mismo HTML; lo que separa a unos de otros es que el navegador ejecuta el redirect y el bot no:

```
<meta http-equiv="refresh" content="0; url=https://…/oferta/<slug>">
<script>location.replace("https://…/oferta/<slug>")</script>
<a href="https://…/oferta/<slug>">Ver la oferta en LinkVault</a>
```

El `<meta refresh>` cubre al navegador sin JavaScript; `location.replace` no deja entrada en el historial, así que
"atrás" no vuelve a la página que redirige; y el enlace visible cubre a quien tiene los dos desactivados. Los bots no
corren JavaScript ni siguen el `refresh`: leen las etiquetas del `<head>`, que están antes del `<body>` y no dependen de
nada.

Por qué no se distingue (es la pregunta que abría este change):

| Opción | A favor | En contra |
|--------|---------|-----------|
| **A. Misma respuesta, redirect en el cliente (ADR-013)** | Cero heurística que mantener. Cachéable sin `Vary`. Un bot nuevo funciona el día que aparece. Es lo que ADR-013 y design-v0.2 §5.5 ya decidieron. | Una persona ve una milésima de página en blanco antes del salto. |
| B. Lista de `User-Agent` de bots → HTML; el resto → `302` | El humano no ve nada intermedio. | La lista caduca: cada bolsa, cada app de mensajería y cada versión cambian su `User-Agent`. Fallar hacia un lado deja a una persona en una página muerta; hacia el otro, deja el enlace **sin tarjeta** en el chat, que es justo lo que este change entrega. Obliga a `Vary: User-Agent`, que multiplica las entradas de caché. |
| C. Heurística por `Accept` (`text/html` vs `*/*`) | Sin listas. | `curl`, los bots y muchos navegadores mandan cosas parecidas; distingue peor que B y falla igual. |

**Gana A**, por unanimidad y por ADR.

**La plantilla.** Una función pura en `presentation/public-page.html.ts` que devuelve una cadena. Sin motor de
plantillas: añadir Mustache o Handlebars a `api` por una página sería una dependencia más y un segundo juego de reglas
de escapado que mantener; Mustache ya se usa en `libs/ai` para los prompts, donde **no** se escapa HTML, y mezclar los
dos usos invita a un error. El escapado lo hace `escapeHtml(text)`, que sustituye `& < > " '` por sus entidades y se
aplica **a todo** valor que entra en el HTML, esté en un texto o en un atributo; la URL de la oferta original pasa
además por `safeHttpUrl(url)`, que solo deja `http:` y `https:` (un `javascript:` guardado como `displayUrl` no llegaría
a existir, pero el enlace público no es sitio para confiar en eso). El JSON del `location.replace` se serializa con
`JSON.stringify` y después se escapa `<` como `<`, para que un `</script>` no pueda cerrar el bloque.

**Cabeceras y forma.** `Content-Type: text/html; charset=utf-8`, `<!doctype html>`, `<html lang="es">`,
`<meta charset="utf-8">`, `<meta name="viewport">`, `<meta name="robots" content="noindex">`, CSS mínimo en línea y
**nada más**: ni fuentes, ni scripts externos, ni analítica. Menos de 4 kB.

**Idioma.** Español, fijo. El contenido es el preview, que se extrae siempre en español (`outputLanguage` fijo,
ADR-023 §1), y el texto propio de la página son tres frases. Negociar por `Accept-Language` obligaría a `Vary` y a
traducir un HTML que nadie mantiene. El SPA, que sí está traducido, es donde la persona acaba.

**Un slug que no existe o que se despublicó** responde **`404` con el mismo HTML** —cabecera, `noindex`, sin OG, sin
redirect— y el texto "Este enlace ya no está disponible" con un enlace a LinkVault. Nunca un JSON: quien pide esta URL
es un navegador o un bot que espera HTML, y el cuerpo `{ code, message }` del filtro global sería basura en pantalla.
Para lograrlo, el controlador **devuelve** la respuesta con su código en vez de lanzar: así `ApiExceptionFilter` no
interviene. Un test comprueba que la ruta nunca responde `application/json`, tampoco ante un error inesperado (hay un
`catch` que devuelve el mismo HTML con `500`).

**Alternativas descartadas:** un motor de plantillas; `@fastify/static` con un HTML precompilado (el contenido es
dinámico); `res.redirect(302)` directo para todos (deja el chat sin tarjeta); servir la página desde el SPA con SSR
(ADR-013); responder `410 Gone` en vez de `404` al despublicar (distingue "existió" de "no existió" y filtra información
a quien prueba slugs).

### D5 — Etiquetas Open Graph

En el `<head>`, en este orden y todas escapadas:

| Etiqueta | Valor | Límite |
|----------|-------|--------|
| `og:site_name` | `LinkVault` | — |
| `og:type` | `website` | — |
| `og:locale` | `es_ES` | — |
| `og:url` | `${PUBLIC_PAGE_BASE_URL}/p/<slug>` | — |
| `og:title`, `<title>` | título del preview; si no lo hay, `linkLabel(displayUrl)` | 100 code points |
| `og:description` | los campos de D6 que existan, unidos por " · ": empresa, ubicación, modalidad, nivel, salario, "Cierra el <fecha>". Si no hay ninguno: "Oferta guardada en LinkVault" | 200 code points |
| `og:image`, `og:image:width|height|alt` | `${WEB_BASE_URL}/assets/og-default.png`, 1200×630 | — |
| `twitter:card` | `summary_large_image` | — |
| `twitter:title`, `twitter:description` | los mismos valores | — |

**De dónde salen los valores.** Del `JobLink` leído en la petición, no de una copia: si la oferta se enriquece después,
la página mejora sola. Un link todavía `pending` o `failed` —que es el estado normal en el instante en que alguien
comparte y reparte la URL— se publica igual, con la etiqueta derivada de la URL y la descripción de respaldo. Esperar a
que esté enriquecido para publicar haría impredecible el ajuste del grupo y retrasaría minutos justo el gesto que este
change existe para servir.

**Cortes.** Se miden **code points**, se corta en el último espacio anterior al límite y se añade `…`. WhatsApp muestra
alrededor de 65 caracteres del título y unos 150 de la descripción, pero cada app corta distinto: cortamos por arriba,
holgado, y dejamos que cada una recorte lo suyo.

**Sin imagen propia de la oferta.** No hay ningún campo de imagen en `JobPreview` (design-v0.2 §4.7) y descargar el
logotipo de la empresa desde la bolsa sería volver a pedirle la página, que es lo que ADR-003 acota. Las opciones eran:

| Opción | A favor | En contra |
|--------|---------|-----------|
| a) Sin `og:image` | Cero trabajo. | En WhatsApp la tarjeta queda como una línea de texto; es lo que ya se ve hoy y no justifica el change. |
| **b) Una imagen de marca fija** | Una tarjeta con imagen; mismo coste para todas; se sirve desde `WEB_BASE_URL/assets`, donde ya hay estáticos, **sin tocar la API**. | Todas las ofertas se ven iguales. |
| c) Imagen generada por oferta | La más atractiva. | Un renderizador (SVG→PNG), una caché de imágenes y un sitio donde guardarlas, para una página. |

**Gana b.** La imagen vive en el SPA (`apps/web/src/assets/og-default.png`), no en la API: la API no sirve estáticos hoy
y añadirle `@fastify/static` y una copia de assets en su webpack por un PNG no se paga.

`og:url` sale de **configuración**, nunca de la cabecera `Host` de la petición: un `Host` falsificado acabaría dentro de
una etiqueta que los chats muestran y cachean.

### D6 — Privacidad: qué sale, qué no, y por qué `summary` no sale

**Sale** (decisión humana 2), y nada más:

`platform`, `displayUrl` (el enlace a la oferta original), `title?`, `company?`, `location?`, `modality?`, `seniority?`,
`salary?`, `postedAt?`, `expiresAt?`.

**No sale, nunca:**

| Fuera | Por qué |
|-------|---------|
| `summary` | Es el campo más largo y el único que puede arrastrar texto que **pegó una persona**. ADR-023 §2 dice por escrito que lo pegado "trae lo que había alrededor: el nombre del reclutador, trozos del chat, mensajes de terceros, sus propias notas"; el prompt pide no reproducir nombres, pero eso es mejor esfuerzo, no una garantía. ADR-026 §5 fijó que el texto que escriben las personas "nunca sale en la página pública", y este es el mismo tipo de texto por otra puerta. Sin `summary`, la página no puede filtrar prosa ajena aunque la extracción se equivoque. |
| `skills`, `languages` | No están en la decisión humana 2, engordan la tarjeta y salen de la misma extracción que `summary`. |
| `previewSources`, `previewStatus`, `previewVersion`, `lastEnrichmentError` | Dicen **quién** escribió o pegó cada campo (ADR-010): nombres de personas en una página sin sesión. Y "Faltan datos de esta oferta" es información para quien la gestiona, no para quien la recibe. |
| `note`, `comments`, cualquier postulación | ADR-026 ("`public-preview-share` NO debe exponer comentarios ni notas") y ADR-024 §7 (el estado compartido es solo para los miembros del grupo). |
| `sharedBy`, `sharedAt`, `groupId`, nombre del grupo, `linkId`, `normalizedUrl` | La decisión humana 2 y "que no se filtre a qué grupo pertenece". El slug es opaco, la página no nombra el grupo y el `404` es idéntico para un slug inexistente, uno quemado y uno mal formado. |

**Un preview `manual` o `pasted` sale igual.** Los valores son datos de la vacante, los publicó quien tenía permiso y la
página no dice de dónde vienen ni quién los escribió. Lo que se protege es el **texto libre** (`summary`), no los campos
cortos y estructurados. Queda como riesgo aceptado que alguien escriba algo privado dentro de `company` y lo publique:
la palanca es el interruptor, que apaga la página entera.

**Cómo se garantiza.** El contrato `publicJobPreviewSchema` es un `strictObject` con exactamente esos campos, y un test
tabular comprueba que rechaza `summary`, `skills`, `languages`, `previewSources`, `sharedBy`, `note`, `comments` y
`groupId`. El mapeo de `GetPublicPreview` parte de una lista explícita de campos, no de un `...preview`. La plantilla
HTML solo recibe ese objeto, así que no puede pintar lo que no le llega.

**Alternativas descartadas:** publicar `summary` recortado a dos líneas (recortar no quita el nombre del reclutador, que
suele ir al principio); publicarlo pasándolo por `scrubContactDetails` (quita emails y teléfonos, no nombres ni frases de
chat, y ADR-023 §2 es explícito en que esa higiene existe para otra cosa); publicar `summary` solo si todos sus campos
son de origen `auto` (una regla sutil que el día que falle, falla publicando).

### D7 — Cachés, coste por petición y trabajo que no se dispara

**Trabajo por petición: dos lecturas indexadas y ninguna escritura.**

1. `group_links.findOne({ 'publicShare.slug': slug })` por el índice único parcial de D2;
2. `job_links.findById(linkId)`.

Y se acabó. La petición **no** resuelve nombres (`LINK_USER_DIRECTORY`), **no** lee miembros, **no** cuenta nada en
Mongo, **no** pide enriquecimiento aunque el link esté `pending` o `failed`, **no** toca el outbox, **no** publica
avisos y **no** llama a la IA. Un bot que pida la página mil veces cuesta mil pares de lecturas indexadas, y ni una sola
petición a la bolsa: es exactamente lo que ADR-003 protege. Un test de integración cuenta las operaciones contra Mongo
de una petición y otro comprueba que no se encola nada.

**Cabeceras de caché:**

- `200` → `Cache-Control: public, max-age=60`. Un minuto es suficiente para absorber a los diez bots que piden la misma
  URL cuando el enlace se pega en un grupo, y bastante poco para que despublicar se note casi enseguida en lo que sea
  que haya por delante. Sin `Vary`, porque no se mira ninguna cabecera de la petición (D4).
- `404` → `Cache-Control: no-store`. Un `404` no tiene por qué ser permanente desde fuera (un despliegue a medias, una
  base que no responde) y cachearlo dejaría muerta una URL que sí existe.
- `429` → `Cache-Control: no-store` y `Retry-After`.
- Sin `ETag` ni `Last-Modified`: el cuerpo cambia cuando el preview se enriquece y no hay nada que revalidar que cueste
  menos que las dos lecturas.

Lo que un chat cachea de su propia tarjeta (WhatsApp guarda la suya días) **no lo controlamos**: despublicar mata la
página, no la tarjeta que ya se pintó en una conversación. Queda escrito en el aviso del interruptor y en los riesgos.

### D8 — Límite de peticiones a `/p/:slug` por IP

`LINK_LIMITER` gana la clave `{ kind: 'public-page', ipHash }`, con contador `links:public:<ipHash>` y
`PUBLIC_PAGE_VIEWS_PER_IP = 300` en `LINK_LIMIT_WINDOW_MS` (15 min), sobre el `FIXED_WINDOW_COUNTER` de plataforma.

- **La IP no se guarda en claro.** La clave lleva los 16 primeros caracteres hexadecimales de `sha256(ip)`. Una IP es un
  dato personal y no hay ninguna razón para que aparezca en Redis ni en un log; el hash sirve igual para contar. Tampoco
  se registra en los logs (CLAUDE.md, ADR-020 §5).
- **Falla abierto**, como la importación y los comentarios. Con el contador caído, lo que se permite de más son dos
  lecturas indexadas por petición; negarlo, en cambio, dejaría **sin tarjeta** todos los enlaces repartidos por WhatsApp
  mientras dure la avería, que es el daño que este change existe para evitar. Un test cubre "el contador no responde".
- **Superado**, responde `429` **en HTML** —no en JSON: la regla de D4 vale también aquí— con `Retry-After` en segundos
  y el texto "Demasiadas peticiones. Inténtalo en un momento.". El controlador lo devuelve; no lanza.
- **De dónde sale la IP.** `request.ip` de Fastify. Detrás de un proxy, eso es la IP del proxy y **todo el mundo
  compartiría un contador**, que es peor que no tener límite. Por eso entra la variable **`TRUST_PROXY`** (`true|false`),
  que se pasa a `FastifyAdapter({ trustProxy })`. Va a `false` en `.env.example`: con `trustProxy` activado y sin proxy
  delante, cualquiera falsifica su `X-Forwarded-For` y salta el límite. `deploy-prod` hereda ponerla en `true`.
- El límite **no** cuenta las peticiones a `GET /api/public/previews/:slug`: son del SPA, ya vienen de alguien que pasó
  por la página, y contar dos veces la misma visita agotaría la ventana a la mitad. Si hiciera falta, tendría su propia
  clave.

**Alternativas descartadas:** límite por slug (un bot cambia de slug; y el slug popular es justo el que queremos servir);
fallar cerrado; no poner límite (una página sin sesión es la única puerta abierta de la API); guardar la IP en claro;
resolver la IP leyendo `X-Forwarded-For` a mano sin `trustProxy` (dos verdades sobre la misma cosa).

### D9 — El CTA "Guardar en LinkVault" y `?import=<slug>`

**La vista pública del SPA** es `/oferta/:slug`, sin guard, cargada perezosamente. Ruta en español como todas las demás
(D11 de auth-users) y **distinta de `/p/:slug`** a propósito: hoy el SPA y la API se sirven aparte, pero en producción
pueden acabar tras el mismo dominio, y dos rutas con el mismo path —una de la API y otra del router de Angular— serían
imposibles de repartir. Lee `GET /api/public/previews/:slug`, un endpoint **sin sesión** bajo `/api/public/*`, un
prefijo reservado para rutas marcadas `@Public()`; devuelve el mismo objeto de D6 y un `404 link_not_found` idéntico en
todos los casos.

**El recorrido completo:**

1. **Sin sesión.** "Guardar en LinkVault" → `/registro?import=<slug>`. La página de registro conserva el parámetro en su
   enlace "¿Ya tienes cuenta?" hacia `/login`, y `/login` lo conserva hacia `/registro`.
2. **Tras registrarse o entrar** con un `import` que tiene forma de slug, el SPA navega a **`/mis-links?import=<slug>`**.
   Un `import` con cualquier otra forma se ignora y se navega al inicio, como hace `safeReturnUrl` con un `returnUrl`
   ajeno.
3. **Con sesión**, el CTA de `/oferta/:slug` navega directamente a `/mis-links?import=<slug>`. Y si alguien con sesión
   abre `/registro?import=<slug>`, `guestGuard` le lleva a `/mis-links?import=<slug>` en vez de al inicio, para no
   perder el gesto.
4. **`/mis-links` con `import`** hace, una sola vez: pide el preview público (ya cacheado por el navegador), llama a
   `POST /api/links { url: displayUrl }` **sin `groupId`**, quita el parámetro de la URL con `replaceUrl` —para que
   recargar no vuelva a guardar— y muestra el resultado.

**Cae en la lista privada**, no en un grupo. Quien llega desde un chat no tiene contexto de grupo, y meter en un grupo
una oferta ajena sin preguntar la volvería a compartir con gente que no la pidió. La confirmación lo dice y deja el
siguiente paso a mano: "Guardada en «Solo para mí». Compártela en un grupo cuando quieras.".

**Si ya la tenía**, `POST /api/links` responde `201` con `shared: already_there` y el SPA muestra "Ya la tenías
guardada", dejándola visible en la lista. Si la tiene en un grupo suyo, `alreadyInGroups` lo dice: "Ya la tienes en:
Backend Bolivia". No se crea nada duplicado: es el comportamiento que `links/sharing` ya garantiza.

**Si el enlace se despublicó** entre que se abrió la página y se pulsó el botón, la importación **funciona igual**: el
SPA ya tiene el `displayUrl`. Si el `404` llega al abrir `/oferta/:slug`, se muestra "Este enlace ya no está disponible"
con las acciones de entrar o registrarse, sin CTA.

**Cómo se guarda: con la URL, no con el slug.** Opciones:

| Opción | A favor | En contra |
|--------|---------|-----------|
| a) `POST /api/links { fromSlug }` (design-v0.2 §5.5) | Deja medir cuántas altas vienen de una página pública. | Amplía el endpoint más usado de la API con una unión "url **o** slug", y mete el vocabulario del enlace público en el camino de escritura de `links`. La métrica no está en el alcance. |
| b) `POST /api/links/from-slug` | No toca el alta normal. | Una ruta más que hace lo mismo. |
| **c) El SPA guarda con `url: displayUrl`, que ya recibió** | Cero superficie nueva; hereda dedupe, `alreadyInGroups`, límites y avisos sin escribir una línea; el slug no entra en `links`. | Sin métrica de origen. |

**Gana c**, 2 a 1. Se deja escrito que el día que haga falta medir la adquisición, el camino es (a).

**Alternativas descartadas:** guardar en el último grupo visitado; preguntar el destino en un diálogo antes de tener
cuenta (fricción justo en el momento de convertir); un "guardar sin cuenta" con sesión anónima.

### D10 — Contratos en `libs/shared`

Se fijan **antes** que backend y frontend (grupo 1):

- **`links/public-slug.ts`**: `PUBLIC_SLUG_ALPHABET`, `PUBLIC_SLUG_LENGTH = 12`, `publicSlugSchema` (patrón exacto) e
  `isValidPublicSlug`.
- **`links/link-label.ts`**: `linkLabel(url)` **movido tal cual** desde `apps/web/.../link-preview.ts`, con sus tests; el
  SPA lo reexporta desde donde estaba. Lo necesitan a la vez la plantilla de la API y la tarjeta del SPA, y dos copias
  darían dos títulos distintos para la misma oferta.
- **`schemas/public-preview.schema.ts`**:
  - `publicJobPreviewSchema` (`strictObject` con los campos de D6);
  - `publicPreviewResponseSchema` (`{ slug, link }`);
  - `OG_TITLE_MAX_LENGTH = 100` y `OG_DESCRIPTION_MAX_LENGTH = 200`.
- **`schemas/link.schema.ts`**: `publicShareSchema` (`slug`, `url`, `publishedAt`) y `jobLinkSummarySchema` con
  `publicShare?`, que **solo** rellena el listado de un grupo, como `note` y `comments`.
- **`schemas/group.schema.ts`**: `groupVisibilitySchema` (`'public' | 'private'`),
  `updateGroupSettingsRequestSchema` y `groupDetailSchema` con `defaultVisibility`.
- **`apiErrorCodeSchema` no cambia.** `link_not_found` (404), `group_not_found` (404), `forbidden` (403) y
  `too_many_attempts` (429) cubren todo lo nuevo. Un código propio como `public_link_not_found` solo serviría para
  distinguir desde fuera "el slug no existe" de "el link no está en tu grupo", que es justo lo que D6 no quiere contar.
  No tocar ese enum evita además el conflicto de rebase que ya se pagó en `group-comments`.

**Filtro HTTP.** Una rama nueva por la de `LinksError`: `PublicShareForbidden` → `forbidden` (403) y
`PublicShareNotFound` → `link_not_found` (404). `/p/:slug` **no pasa por el filtro** (D4).

### D11 — Migración

- **`group_links` gana `publicShare?`.** Los documentos existentes no lo tienen y se leen como "no publicado": **no hay
  backfill**. Es lo que pide la decisión humana 3 y, sobre todo, lo único honesto: esos links se compartieron cuando
  "compartir en el grupo" significaba "lo ven los miembros", y publicarlos de golpe —sin que nadie lo pidiera y sin que
  quien los compartió se entere— expondría en la web ofertas que alguien guardó pensando que se quedaban dentro. Que
  `defaultVisibility` venga activada no los alcanza: el ajuste decide lo que pasa **al entrar** un link, no lo que ya
  entró.
- **Índice nuevo**: único parcial `{ 'publicShare.slug': 1 }` sobre `group_links`, construido al arrancar `api`
  (`autoIndex`). Es el único índice que añade este change. Los tres actuales no se tocan y un test tabular lo comprueba.
- **`groups` gana `settings?.defaultVisibility`.** Ausente se lee `'public'`; el primer `PATCH` crea el campo. Sin
  índices.
- **Configuración**: `PUBLIC_PAGE_BASE_URL`, `WEB_BASE_URL` y `TRUST_PROXY` son obligatorias, así que un `.env` ya
  existente tiene que copiarlas de `.env.example` antes de arrancar `api` (mismo caso que
  `PASTE_EXTRACTION_TIMEOUT_MS`, ADR-023).
- **Volver atrás**: desplegar la versión anterior. Ignora `publicShare` y `settings`, y `/p/:slug` deja de existir, con
  lo que las URLs repartidas dejan de responder. Para despublicar todo a mano, el RUNBOOK trae el `$unset` masivo y el
  comando para tirar el índice.

### D12 — Frontend

- **Datos.**
  - `core/public/public-preview.api.ts`: `preview(slug)` sobre `/api/public/previews/:slug`, **sin** el interceptor de
    sesión (marca `SKIP_BEARER`): una página pública no debe disparar un refresh ni un `401`.
  - `core/links/links.api.ts` gana `publishGroupLink(groupId, linkId)` y `unpublishGroupLink(groupId, linkId)`.
  - `core/groups/groups.api.ts` gana `updateSettings(groupId, defaultVisibility)`.
  - `LinksStore` guarda `publicShare` en los items del grupo y, como con `note` y `comments`, **toda sustitución** de una
    tarjeta lo conserva si el link nuevo no lo trae (ADR-026, F3).
- **Vista pública** (`features/public/public-preview.page.ts`, ruta `/oferta/:slug`, lazy, sin guard):
  - cabecera con el título o la etiqueta derivada, y debajo empresa, ubicación, modalidad, nivel, salario y fechas, con
    los mismos formateadores que la tarjeta;
  - "Ver la oferta original" (abre `displayUrl` en otra pestaña, `rel="noopener noreferrer"`);
  - CTA principal "Guardar en LinkVault" y, debajo, "Entrar" para quien ya tiene cuenta;
  - `404` → "Este enlace ya no está disponible", sin CTA de guardar;
  - **nunca** pide nada más a la API: ni la sesión, ni la lista de grupos.
- **Interruptor** en `LinkCard`, solo en contexto de grupo, en el menú donde ya viven "Quitar la nota" y "Quitar":
  - apagado, para quien compartió el link y para el `owner`: "Compartir con un enlace público";
  - encendido: una marca "Enlace público" visible **para cualquier miembro**, y para esos dos "Copiar enlace" y "Dejar
    de compartir";
  - al encender, una confirmación que dice el alcance: "Cualquiera con este enlace podrá ver la oferta sin entrar en
    LinkVault. No se verá el grupo, ni tu nombre, ni los comentarios. Puedes dejar de compartirlo cuando quieras.";
  - al apagar: "El enlace dejará de funcionar para todo el mundo, también para quien ya lo tenga. Si vuelves a
    activarlo, se creará un enlace nuevo. Las vistas previas ya enviadas en un chat pueden seguir viéndose ahí.";
  - un `403` muestra "No puedes cambiar esto" y un `404` recarga la lista.
- **Ajuste del grupo** en `/grupos/:id`, solo para el `owner`: un interruptor "Los links nuevos se comparten con un
  enlace público", con la aclaración "Solo afecta a lo que se guarde a partir de ahora; los links que ya están no
  cambian." Un miembro no lo ve.
- **Importación** en `/mis-links`, según D9, con `replaceUrl` y una sola ejecución por navegación.
- **Quitar un link** añade una frase a su confirmación cuando el link está publicado ("Su enlace público dejará de
  funcionar."), por el mismo criterio con el que ya dice cuántos comentarios se pierden: lo que se destruye se nombra
  antes de destruirlo.
- **Textos** (ES fuente, EN en `messages.en.xlf`):

| ES | EN |
|----|----|
| Guardar en LinkVault | Save to LinkVault |
| Ver la oferta original | View the original posting |
| Esta oferta se compartió desde LinkVault | This job was shared from LinkVault |
| Este enlace ya no está disponible | This link is no longer available |
| Entrar | Log in |
| Guardada en «Solo para mí». Compártela en un grupo cuando quieras. | Saved to "Just for me". Share it with a group whenever you like. |
| Ya la tenías guardada | You already had it saved |
| No pudimos guardar esta oferta. Inténtalo de nuevo. | We couldn't save this job. Please try again. |
| Compartir con un enlace público / Dejar de compartir | Share with a public link / Stop sharing |
| Enlace público | Public link |
| Copiar enlace / Enlace copiado | Copy link / Link copied |
| Cualquiera con este enlace podrá ver la oferta sin entrar en LinkVault. No se verá el grupo, ni tu nombre, ni los comentarios. Puedes dejar de compartirlo cuando quieras. | Anyone with this link can see the job without signing in to LinkVault. The group, your name and the comments stay hidden. You can stop sharing whenever you like. |
| El enlace dejará de funcionar para todo el mundo, también para quien ya lo tenga. Si vuelves a activarlo, se creará un enlace nuevo. Las vistas previas ya enviadas en un chat pueden seguir viéndose ahí. | The link will stop working for everyone, including people who already have it. Turning it back on creates a new link. Previews already sent in a chat may still be visible there. |
| Los links nuevos se comparten con un enlace público | New links get a public link |
| Solo afecta a lo que se guarde a partir de ahora; los links que ya están no cambian. | It only affects what gets saved from now on; links already here don't change. |
| No puedes cambiar esto | You can't change this |
| Su enlace público dejará de funcionar. | Its public link will stop working. |

Los textos de la página servida por la API (D4) **no** se marcan para i18n: van en español dentro de la plantilla, y su
test comprueba el literal.

### D13 — Pruebas

- **Dominio y casos de uso.** Unitarios con repositorios en memoria: `mayPublish` (quien compartió, owner, otro
  miembro), el orden de comprobaciones de publicar y despublicar, la idempotencia, el reintento por colisión de slug,
  que el ajuste del grupo solo se aplica al crear la relación, y que `GetPublicPreview` no llama a ningún puerto más que
  a los dos repositorios.
- **Plantilla HTML.** Unitarios tabulares: un título con `</title><script>`, comillas en la empresa, un `displayUrl` con
  `javascript:`, un preview vacío, cortes de 100 y 200 code points, y que el cuerpo lleva el redirect y el enlace de
  respaldo.
- **Integración** (`createApp` con `inject` sobre `mongodb-memory-server` en replica set):
  - `/p/:slug` con `200` y sus cabeceras, con `404` en HTML para un slug inexistente, uno quemado y uno mal formado, y
    que **ninguna** respuesta de esa ruta es `application/json`;
  - las dos lecturas y ninguna escritura, con un espía sobre el driver y con el outbox vacío;
  - el `429` en HTML y el contador caído;
  - publicar, despublicar, volver a publicar (slug distinto) y dos publicaciones concurrentes (un solo slug vivo);
  - guardar e importar en un grupo con la visibilidad encendida y apagada;
  - cambiar `defaultVisibility` y comprobar que **ningún** link existente cambia;
  - que la respuesta pública no contiene `summary`, `skills`, `previewSources`, `sharedBy` ni nada del grupo, con un
    preview que sí los tiene;
  - que el slug no aparece en los logs junto a ninguna IP.
- **Web.** TestBed con `HttpTestingController`: la API pública sin `Authorization`, la página con y sin datos, el `404`,
  el CTA con y sin sesión, `guestGuard` con `import`, `/mis-links?import=`, el interruptor y sus confirmaciones, y el
  store que conserva `publicShare` al sustituir una tarjeta.
- **E2E Playwright** en `apps/web-e2e/src/public-share.spec.ts`, con la franja `public: 4` en `JOB_ID_SLOTS` y
  `resetRegisterLimit()` como el resto.

## Risks / Trade-offs

- **Lo que un chat ya pintó no se puede borrar.** Despublicar mata la página, no la tarjeta que WhatsApp guardó en una
  conversación. Se dice en el texto del interruptor.
- **Cualquier miembro del grupo puede repartir la URL pública** de un link publicado por otro (D2). Es una URL ya
  pública; quien la publicó puede apagarla.
- **La misma vacante puede tener dos páginas** si está publicada en dos grupos (D1). No filtran nada la una de la otra y
  la alternativa era publicar para todos desde un solo grupo.
- **Un preview `manual` o `pasted` se publica con lo que alguien escribió** en los campos cortos (D6). Sin `summary`, el
  riesgo se reduce a un campo de una línea, y el interruptor lo apaga.
- **`TRUST_PROXY` mal puesto** rompe el límite en una dirección u otra: a `false` tras un proxy, todo el tráfico cuenta
  en un solo contador; a `true` sin proxy, cualquiera lo esquiva con una cabecera. Va documentado en `.env.example` y en
  el RUNBOOK, y `deploy-prod` lo hereda.
- **`defaultVisibility` activada por defecto** hace que, en un grupo que nunca miró el ajuste, cada link nuevo nazca con
  una URL pública. Es la decisión humana 3 y lo que fija design-v0.2 §5.5; lo compensan que la página no dice nada del
  grupo ni de quien comparte, el interruptor por link y que el owner puede apagarlo para todo lo que venga.
- **Cinco reintentos de slug** podrían agotarse con la base llena. Con 59 bits y el volumen de este producto es
  inalcanzable; si pasara, es un `500` con su log, no una colisión silenciosa.
- **Dos variables de URL pública** (`PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL`) que en producción pueden apuntar al mismo
  origen. Deducirlas de la petición sería más cómodo y falsificable.
- **Sin métrica de adquisición** (D9): no sabremos cuántas altas vienen de una página pública hasta que se añada
  `fromSlug`.

## Migration Plan

1. Desplegar `api` con las tres variables nuevas ya presentes en el entorno: sin ellas el proceso **no arranca**
   (`platform/runtime-health`).
2. `autoIndex` crea el índice único parcial de `publicShare.slug` al arrancar. La colección no tiene ningún documento con
   ese campo, así que se construye en milisegundos.
3. **No hay backfill** ni script de migración (D11). Ningún link ya compartido se publica, y ningún grupo cambia: los que
   no tienen `settings` se leen como `public` y eso solo afecta a lo que se comparta después.
4. Para volver atrás basta con desplegar la versión anterior; el RUNBOOK trae el `$unset` masivo de `publicShare` y el
   `dropIndex`.

## Open Questions

- **Publicar un link de la lista privada.** design-v0.2 §5.5 dice "false para privados", que este change cumple no
  ofreciéndolo. Un usuario sin grupos que quiera repartir una oferta con tarjeta no tiene hoy cómo.
  - **Recomendación:** no añadirlo aquí. El día que se pida, el camino es el mismo `publicShare` sobre `user_links`, un
    segundo `findOne` por slug en paralelo y el permiso trivial (su dueño). No exige rehacer nada de D1 ni de D4.
- **Qué hace el borrado de cuenta con los enlaces públicos de esa persona.** Hoy no existe el borrado de cuenta.
  - **Recomendación:** que lo herede `deploy-prod`, en el mismo apartado donde ya hereda los `group_link_comments`:
    despublicar (`$unset publicShare`) las relaciones que esa persona publicó, además de lo que decida sobre la relación
    en sí. Se anota en el `scope` del manifiesto.
- **Medir la adquisición desde la página pública.** D9 eligió guardar con la URL, que no deja rastro del origen.
  - **Recomendación:** dejarlo fuera y, cuando se quiera medir, añadir `POST /api/links { fromSlug }` con su propio
    change; un contador de visitas en la página pública cambiaría el "ninguna escritura" de D7 y necesita decidir antes
    qué se guarda de quien visita.
- **Imagen OG por oferta.** D5 eligió una imagen de marca fija.
  - **Recomendación:** medir primero si la tarjeta con imagen fija convierte; una imagen por oferta es un renderizador y
    un almacén, y solo se paga si el número lo pide.
