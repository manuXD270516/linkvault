## Context

> **Ventana autónoma autorizada (2026-09-19, ~3 h de ausencia del autor).** Autorizó ejecutar sin él el ciclo completo
> de este change (debate → apply → QA → smoke → PR → merge → archivo) y, si sobra tiempo, dejar planificado
> `cv-upload-extract` sin implementarlo. Los PRs se fusionan con squash **solo con el CI en verde**, esperando a que
> termine y fusionando a mano (nunca `gh pr merge --auto`). Ante una decisión no documentada se elige la opción
> recomendada y se deja constancia aquí o en el ADR; si cambia el alcance o es irreversible, el change se detiene con
> un informe. Si otra sesión ocupa los puertos 3000/3001/4200, se espera y se reintenta, sin matar esos procesos.

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
- **Límites por dirección IP y configuración del proxy** (`trustProxy`). Siguen siendo de `deploy-prod` (ADR-020), y
  activarlos a ciegas debilitaría los límites de `auth` y `groups` (D8).
- **Métricas de adquisición**: contador de visitas, de importaciones desde la página o atribución por slug. Cambiaría el
  "ninguna escritura" de D7 y pide su propio diseño. Lo que sí entra es el log estructurado `{ slug, status }` de las
  dos rutas públicas (D4), que no escribe nada en la base.
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
  - `limits.ts` gana `PUBLIC_PAGE_VIEWS` y `PUBLIC_PREVIEW_VIEWS`.
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
`{ 'publicShare.slug': 1 }` con `partialFilterExpression: { 'publicShare.slug': { $exists: true } }`. La escritura
intenta guardar y, si choca con ese índice, genera otro slug y reintenta hasta **5** veces; a la sexta lanza
`PublicSlugExhausted` (`500`). Es el patrón de `groups` con el código de invitación, y es lo único que cierra la carrera
de dos publicaciones simultáneas. Los tres índices actuales de `group_links` **no se tocan**.

**El reintento vive en el repositorio**, junto a `share`, y no en el caso de uso. Un `E11000` no es un concepto de
aplicación: quien sabe qué índice rechazó la escritura es quien la hizo. El adaptador distingue la clave del slug
(`PUBLIC_SLUG_KEY`) de la de la relación (`GROUP_LINK_KEY`) con `duplicateKeyIs`: un choque del slug se reintenta con
otro, y uno de `(groupId, linkId)` —que en `share` significa "ya estaba compartido"— se resuelve como siempre, sin
reintentar. Confundirlos haría que compartir dos veces a la vez generara cinco slugs inútiles antes de rendirse. El
caso de uso solo ve `AddedPublicShare | null` o `PublicSlugExhausted`.

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

El `exclude` se declara como **`p/:slug`**, no como `'p'`. `setGlobalPrefix` compara rutas, no prefijos de cadena: con
`'p'` la única ruta excluida sería `/p` —que no existe— y `/p/<slug>` acabaría bajo `/api/p/<slug>`, es decir, el
enlace repartido por WhatsApp respondería `404` de la API en formato JSON. Un test de integración pide `/p/<slug>` al
puerto de la API y comprueba que responde HTML.

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

Las **tres** respuestas de la ruta (`200`, `404` y `429`) llevan además:

- `Referrer-Policy: no-referrer`. Sin ella, al pulsar "Ver la oferta original" el navegador mandaría a la bolsa un
  `Referer` con el slug dentro, y ese slug es la llave de una página que cualquiera puede abrir. Acabaría en los logs
  de un tercero.
- `X-Content-Type-Options: nosniff`, para que ningún navegador reinterprete el cuerpo como otra cosa.
- `Content-Security-Policy: default-src 'none'; img-src ${WEB_BASE_URL} data:; style-src 'unsafe-inline';
  script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`. El `script-src` y el
  `style-src` admiten lo inline porque el redirect y el CSS de la página lo son, y **no** admiten ningún origen
  externo ni `eval`. Es defensa en profundidad sobre el escapado: si algún día un valor se colara sin escapar, no
  podría cargar nada de fuera. Un `nonce` sería más estricto pero obligaría a generar uno por petición y a renunciar
  a cachear la respuesta.

**El log.** Cada petición deja `{ slug, status }` en el log estructurado y nada más: sin dirección de origen, sin
`User-Agent` y sin referente. Es lo que permite contar cuántas páginas se sirven y cuántas acaban en `404` sin guardar
un solo dato de quien visita.

**Idioma.** Español, fijo. El contenido es el preview, que se extrae siempre en español (`outputLanguage` fijo,
ADR-023 §1), y el texto propio de la página son tres frases. Negociar por `Accept-Language` obligaría a `Vary` y a
traducir un HTML que nadie mantiene. El SPA, que sí está traducido, es donde la persona acaba.

**Un slug que no existe o que se despublicó** responde **`404` con el mismo HTML** —cabecera, `noindex`, sin OG, sin
redirect— y el texto "Este enlace ya no está disponible" seguido de "Pídeselo de nuevo a quien te lo envió", con un
enlace a LinkVault. Esa segunda frase es la única acción útil que le queda a quien llega: la persona no sabe que existe
un interruptor, y "vuelve más tarde" sería mentira porque el slug está quemado. Nunca un JSON: quien pide esta URL es un
navegador o un bot que espera HTML, y el cuerpo `{ code, message }` del filtro global sería basura en pantalla. Para
lograrlo, el controlador **devuelve** la respuesta con su código en vez de lanzar: así `ApiExceptionFilter` no
interviene.

**Las formas raras de la URL también son HTML.** `/p/` (sin slug) y `/p/a/b` (con segmentos de más) no casan con la ruta
y hoy caerían en el 404 genérico de la API, que es JSON. Se registran las dos como rutas propias del mismo controlador
—`/p` y `/p/*`— que devuelven el mismo HTML de error. Un test pide las cinco formas —válida, inexistente, mal formada,
sin slug y con segmentos de más— y comprueba que ninguna responde `application/json`, tampoco ante un error inesperado
(hay un `catch` que devuelve el mismo HTML con `500`).

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
| `og:description` | los campos de D6 que existan, unidos por " · ", **en este orden**: empresa, ubicación, salario, modalidad, nivel, "Cierra el <fecha>". Si no hay ninguno: "Oferta guardada en LinkVault" | 200 code points |
| `og:image`, `og:image:width|height|alt` | `${WEB_BASE_URL}/assets/og-default.png`, 1200×630 | — |
| `twitter:card` | `summary_large_image` | — |
| `twitter:title`, `twitter:description` | los mismos valores | — |

**De dónde salen los valores.** Del `JobLink` leído en la petición, no de una copia: si la oferta se enriquece después,
la página mejora sola. Un link todavía `pending` o `failed` —que es el estado normal en el instante en que alguien
comparte y reparte la URL— se publica igual, con la etiqueta derivada de la URL y la descripción de respaldo. Esperar a
que esté enriquecido para publicar haría impredecible el ajuste del grupo y retrasaría minutos justo el gesto que este
change existe para servir.

**Cortes y orden.** Se miden **code points**, se corta en el último espacio anterior al límite y se añade `…`. WhatsApp
muestra alrededor de 65 caracteres del título y unos 150 de la descripción, pero cada app corta distinto: cortamos por
arriba, holgado, y dejamos que cada una recorte lo suyo. **El salario va antes que la modalidad y el nivel** porque es
lo que más decide si alguien abre una oferta en un chat, y porque lo que va al final es justo lo que cada app se come al
recortar: dejar el sueldo detrás de "Remoto · Senior" equivale a no publicarlo.

**Sin imagen propia de la oferta.** No hay ningún campo de imagen en `JobPreview` (design-v0.2 §4.7) y descargar el
logotipo de la empresa desde la bolsa sería volver a pedirle la página, que es lo que ADR-003 acota. Las opciones eran:

| Opción | A favor | En contra |
|--------|---------|-----------|
| a) Sin `og:image` | Cero trabajo. | En WhatsApp la tarjeta queda como una línea de texto; es lo que ya se ve hoy y no justifica el change. |
| **b) Una imagen de marca fija** | Una tarjeta con imagen; mismo coste para todas; se sirve desde `WEB_BASE_URL/assets`, donde ya hay estáticos, **sin tocar la API**. | Todas las ofertas se ven iguales. |
| c) Imagen generada por oferta | La más atractiva. | Un renderizador (SVG→PNG), una caché de imágenes y un sitio donde guardarlas, para una página. |

**Gana b.** La imagen vive en el SPA, en **`apps/web/public/assets/og-default.png`** —la carpeta de estáticos que el
build de Angular copia tal cual a la raíz, y de donde sale también el `robots.txt`—, no en la API: la API no sirve
estáticos hoy y añadirle `@fastify/static` y una copia de assets en su webpack por un PNG no se paga.

`og:url` sale de **configuración**, nunca de la cabecera `Host` de la petición: un `Host` falsificado acabaría dentro de
una etiqueta que los chats muestran y cachean.

### D6 — Privacidad: qué sale, qué no, y por qué `summary` no sale

**Sale** (decisión humana 2), y nada más:

`platform`, `displayUrl` (el enlace a la oferta original), `title?`, `company?`, `location?`, `modality?`, `seniority?`,
`salary?`, `postedAt?`, `expiresAt?`.

**El `displayUrl` sale saneado.** Es la URL tal y como la escribió una persona y nunca se normalizó (ADR-021: es
inmutable a propósito), así que puede llevar credenciales embebidas —`https://ana:secreto@bolsa.example/…`, que algunos
sistemas generan— y un fragmento con lo que el navegador tuviera. La función pura `publicHttpUrl(url)` de `libs/shared`
devuelve la URL sin `username`, sin `password` y sin `hash`, y `null` si el esquema no es `http(s)`; con `null`, la
página se pinta **sin** enlace a la oferta original en vez de con un enlace que no se puede confiar. No se toca el
`displayUrl` guardado: esto es solo lo que se publica.

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

### D8 — Límite de las rutas públicas: global, no por IP

**Por qué no por IP.** El primer borrador contaba por dirección de origen. Para que eso signifique algo detrás de un
proxy habría que activar `trustProxy` en Fastify, y **`trustProxy: true` convierte `request.ip` en un dato que envía el
cliente**: a partir de ahí, cualquiera con un `X-Forwarded-For` inventado esquivaría no solo este límite, sino los que
ya protegen el **login**, el **registro** y el **unirse a un grupo**. Un change de una página pública no puede debilitar
la autenticación. Configurar el proxy y decidir en qué confía es trabajo de `deploy-prod` (ADR-020); mientras no exista,
los límites por IP de `auth` y `groups` siguen exactamente como están y este change **no los toca**.

**Lo que entra en su lugar.** Dos contadores **globales de ruta**, sobre el `FIXED_WINDOW_COUNTER` de plataforma:

| Clave | Ruta | Umbral |
|-------|------|--------|
| `links:public-page` | `GET /p/:slug` | `PUBLIC_PAGE_VIEWS = 6000` por `LINK_LIMIT_WINDOW_MS` (15 min) |
| `links:public-preview` | `GET /api/public/previews/:slug` | `PUBLIC_PREVIEW_VIEWS = 6000` por la misma ventana |

Propiedades, todas buscadas:

- **No distinguen clientes.** La clave es fija: no entra la IP, ni ninguna cabecera, ni nada derivado de ellas. No hay
  nada que falsificar y no hace falta ninguna variable de configuración para que funcione.
- **Independientes.** Agotar la página no cierra el endpoint del SPA, ni al revés: una avalancha de bots no deja sin
  ver la oferta a quien ya está en `/oferta/:slug`.
- **Se consumen antes de leer.** Superar el límite no cuesta ni una consulta, que es justo lo que un tope contra abuso
  tiene que garantizar.
- **Fallan abiertos**, como la importación y los comentarios. Con el contador caído, lo que se permite de más son dos
  lecturas indexadas por petición; negarlo dejaría **sin tarjeta** todos los enlaces repartidos por WhatsApp mientras
  dure la avería, que es el daño que este change existe para evitar.
- **Superado**, `/p/:slug` responde `429` **en HTML** —la regla de D4 vale también aquí— con `Retry-After` y
  "Demasiadas peticiones. Inténtalo en un momento."; el endpoint JSON responde `429 too_many_attempts` con
  `Retry-After`. El controlador los devuelve; no lanza.

**Lo que este límite es y lo que no.** Es un tope de coste para que un bucle no nos haga escanear Mongo, no un control
de abuso por cliente: un atacante decidido puede agotar la ventana y dejar la página con `429` para todos durante unos
minutos. Con un umbral de 6000 cada 15 min —muy por encima de cualquier tráfico real de este producto— eso exige un
esfuerzo sostenido, y el daño es que unas tarjetas de WhatsApp salgan sin previsualización, no que se pierda nada.
Queda en Risks. El día que haya proxy, `deploy-prod` puede añadir el límite por IP donde corresponde, delante.

**Alternativas descartadas:** límite por IP aquí (arrastra `TRUST_PROXY` y debilita `auth` y `groups`); límite por slug
(un bot cambia de slug, y el slug popular es el que queremos servir); fallar cerrado; no poner ningún límite (la página
sin sesión es la única puerta abierta de la API); un solo contador para las dos rutas (una avalancha de bots apagaría
la vista del SPA).

### D9 — El CTA "Guardar en LinkVault" y `?import=<slug>`

**La vista pública del SPA** es `/oferta/:slug`, sin guard, cargada perezosamente. Ruta en español como todas las demás
(D11 de auth-users) y **distinta de `/p/:slug`** a propósito: hoy el SPA y la API se sirven aparte, pero en producción
pueden acabar tras el mismo dominio, y dos rutas con el mismo path —una de la API y otra del router de Angular— serían
imposibles de repartir. Lee `GET /api/public/previews/:slug`, un endpoint **sin sesión** bajo `/api/public/*`, un
prefijo reservado para rutas marcadas `@Public()`; devuelve el mismo objeto de D6 y un `404 link_not_found` idéntico en
todos los casos.

**No se restaura la sesión al arrancar en una ruta pública.** Hoy `session-restore.ts` corre en un
`provideAppInitializer`: antes de la primera navegación intenta un refresh y espera hasta 10 s. Quien llega desde un
chat no tiene cookie de refresh, así que pagaría "Conectando…" y una llamada inútil antes de ver la oferta —y con la
API lenta, hasta diez segundos mirando una pantalla vacía, justo en la primera impresión que este change existe para
cuidar—. El inicializador pasa a **no restaurar** cuando el `location.pathname` de arranque es una ruta pública
(`/oferta/…`), y la sesión se resuelve **cuando hace falta**, al pulsar el CTA: ahí sí se espera al refresh, porque el
destino depende de si hay sesión. `authGuard` y `guestGuard` siguen llamando a `restore()` como hasta ahora, así que
navegar desde la vista pública a cualquier otra ruta se comporta igual que siempre.

**La ruta pública no se indexa.** El `<meta name="robots" content="noindex">` se pone y se quita con la vista, y
`apps/web/public/robots.txt` añade `Disallow: /oferta/`. Es la misma razón que en la página de la API: la oferta es de
la bolsa que la publicó y LinkVault no la duplica en los buscadores. Aquí sí se puede usar `robots.txt`, porque a esta
ruta no llegan los bots de las tarjetas: los que leen OG piden `/p/:slug`, que no está desautorizado.

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
   recargar no vuelva a guardar— y muestra el resultado. Si falla, el mensaje trae **"Reintentar"**: la persona ya está
   en `/mis-links` y sin ese botón tendría que volver al chat a buscar el enlace.

**Precedencia entre `import` y `returnUrl`.** Pueden llegar juntos: alguien sin sesión abre `/perfil`, va a `/login` con
`returnUrl`, y desde otra pestaña pega un enlace público y pulsa el CTA, que añade `import`. **Gana `import`**, porque
es el gesto más reciente y el explícito —pulsó "Guardar en LinkVault", no "llévame a mi perfil"—, y porque perder la
oferta es irreversible desde el SPA (hay que volver al chat) mientras que `/perfil` está a un clic. `import` se valida
con `isValidPublicSlug`, igual que `returnUrl` pasa por `safeReturnUrl`: cualquier otra forma se ignora y se navega al
inicio.

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
  `isValidPublicSlug`, que usan también el SPA (para juzgar un `import`) y la plantilla.
- **`links/public-http-url.ts`**: `publicHttpUrl(url)` de D6, con su tabla de casos.
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

**`duplicateKeyIs` sube a infraestructura compartida.** Hoy vive en `groups/infrastructure/group.schemas.ts` y hay una
copia en `applications`. Este change necesitaría una tercera en `links`, y tres copias de "cómo se reconoce qué índice
rechazó una escritura" acaban divergiendo justo cuando importa. Se mueve a
`apps/api/src/infrastructure/mongo/duplicate-key.ts`, y `groups` y `applications` pasan a importarla de ahí, con sus
tests en el sitio nuevo. Es el mismo movimiento que ADR-025 §8 hizo con `ipLimitGroup`: infraestructura de plataforma
que usan varios módulos, sin que ninguno dependa de otro. No cambia ningún comportamiento observable.

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
- **Configuración**: `PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL` son obligatorias, así que un `.env` ya existente tiene que
  copiarlas de `.env.example` antes de arrancar `api` (mismo caso que `PASTE_EXTRACTION_TIMEOUT_MS`, ADR-023). **No**
  entra ninguna variable de proxy.
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
    tarjeta lo conserva si el link nuevo no lo trae (ADR-026, F3). Al **despublicar** lo borra **explícitamente**, con
    la misma operación con la que hoy quita la nota: "conservar si no viene" y "quitar" son cosas distintas, y sin el
    borrado explícito la tarjeta seguiría diciendo "Enlace público" hasta recargar.
- **Vista pública** (`features/public/public-preview.page.ts`, ruta `/oferta/:slug`, lazy, sin guard):
  - cabecera con el título o la etiqueta derivada, y debajo empresa, ubicación, modalidad, nivel, salario y fechas, con
    los mismos formateadores que la tarjeta;
  - "Ver la oferta original" (abre `displayUrl` en otra pestaña, `rel="noopener noreferrer"`);
  - CTA principal "Guardar en LinkVault", con "Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas."
    debajo —quien llega no conoce el producto y un botón sin promesa no se pulsa— y, después, "Entrar" para quien ya
    tiene cuenta;
  - `404` → "Este enlace ya no está disponible" y "Pídeselo de nuevo a quien te lo envió", sin CTA de guardar;
  - **nunca** pide nada más a la API: ni la sesión, ni la lista de grupos.
- **Interruptor** en `LinkCard`, solo en contexto de grupo, en el menú donde ya viven "Quitar la nota" y "Quitar":
  - apagado, para quien compartió el link y para el `owner`: "Compartir con un enlace público";
  - encendido: una marca "Enlace público" visible **para cualquier miembro**, y para esos dos "Copiar enlace" y "Dejar
    de compartir";
  - al encender, una confirmación que dice el alcance: "Cualquiera con este enlace podrá ver la oferta sin entrar en
    LinkVault. No se verá el grupo, ni tu nombre, ni los comentarios. Puedes dejar de compartirlo cuando quieras.";
  - al apagar: "El enlace dejará de funcionar para todo el mundo, también para quien ya lo tenga. Si vuelves a
    activarlo, se creará un enlace nuevo. Las vistas previas ya enviadas en un chat pueden seguir viéndose ahí.";
  - **"Copiar enlace" sobre una oferta que aún no se ha leído** avisa con "Todavía estamos leyendo la oferta: si lo
    envías ahora, la tarjeta saldrá sin datos" y **deja copiar igualmente**. Es el caso normal —se comparte y se
    reparte en el mismo minuto—, y una tarjeta sin datos en WhatsApp no se puede rehacer: el chat la cachea. Avisar y
    no bloquear respeta que la persona sepa lo que hace;
  - un `403` muestra "Solo quien compartió la oferta o el propietario del grupo puede cambiar esto" —decir quién sí
    puede evita que alguien lo lea como un fallo— y un `404` recarga la lista.
- **Al guardar en un grupo que comparte en público**, la confirmación del formulario añade la línea "Cualquiera con
  este enlace verá la oferta; no se verá el grupo ni tu nombre" y un "Copiar enlace" sobre el `publicShare` que **ya
  viene en la respuesta** de `POST /api/links`: sin endpoint nuevo y sin una segunda petición. Es el momento en que la
  persona está a punto de pegar algo en el chat, y el único en que enterarse del alcance sirve de algo; el mismo aviso
  de "todavía estamos leyendo la oferta" vale aquí.
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
| Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas. | Keep the jobs people send you on WhatsApp, so you don't lose them. |
| Pídeselo de nuevo a quien te lo envió | Ask whoever sent it to you for a new one |
| Reintentar | Try again |
| Cualquiera con este enlace verá la oferta; no se verá el grupo ni tu nombre | Anyone with this link can see the job; the group and your name stay hidden |
| Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos | We're still reading the job: if you send it now, the preview will be empty |
| Solo quien compartió la oferta o el propietario del grupo puede cambiar esto | Only the person who shared the job or the group owner can change this |
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
| Su enlace público dejará de funcionar. | Its public link will stop working. |

Los textos de la página servida por la API (D4) **no** se marcan para i18n: van en español dentro de la plantilla, y su
test comprueba el literal.

### D13 — Pruebas

- **Dominio y casos de uso.** Unitarios con repositorios en memoria: `mayPublish` (quien compartió, owner, otro
  miembro), el orden de comprobaciones de publicar y despublicar, la idempotencia, el reintento por colisión de slug,
  que el ajuste del grupo solo se aplica al crear la relación, y que `GetPublicPreview` no llama a ningún puerto más que
  a los dos repositorios.
- **Plantilla HTML.** Unitarios tabulares: un título con `</title><script>`, comillas en la empresa, un `displayUrl` con
  `javascript:`, con credenciales y con fragmento, un preview vacío, cortes de 100 y 200 code points, el orden de la
  descripción con el salario antes que la modalidad, y que el cuerpo lleva el redirect, el enlace de respaldo y la
  línea bajo el CTA.
- **`publicHttpUrl`.** Tabla: `http`, `https`, con usuario y contraseña, con fragmento, con los dos, `javascript:`,
  `ftp:` y una cadena que no es una URL.
- **Integración** (`createApp` con `inject` sobre `mongodb-memory-server` en replica set):
  - `/p/:slug` con `200` y sus cabeceras (`Cache-Control`, `Referrer-Policy`, `nosniff`, CSP y sin `Vary`), con `404`
    en HTML para un slug inexistente, uno quemado, uno mal formado, `/p/` y `/p/a/b`, y que **ninguna** respuesta de esa
    ruta es `application/json`;
  - las dos lecturas y ninguna escritura, con un espía sobre el driver y con el outbox vacío;
  - el `429` en HTML sin ninguna lectura, el `429` del endpoint JSON, que los dos contadores son independientes y que
    cambiar `X-Forwarded-For` no cambia de contador; el contador caído deja pasar los dos;
  - que el log de las dos rutas lleva `{ slug, status }` y nada de quien pide;
  - publicar, despublicar, volver a publicar (slug distinto) y dos publicaciones concurrentes (un solo slug vivo);
  - guardar e importar en un grupo con la visibilidad encendida y apagada;
  - cambiar `defaultVisibility` y comprobar que **ningún** link existente cambia;
  - que la respuesta pública no contiene `summary`, `skills`, `previewSources`, `sharedBy` ni nada del grupo, con un
    preview que sí los tiene, y que el `displayUrl` sale sin credenciales ni fragmento;
  - que `duplicateKeyIs`, ya en infraestructura compartida, sigue distinguiendo los índices de `groups` y de
    `applications` con sus tests de siempre.
- **Web.** TestBed con `HttpTestingController`: la API pública sin `Authorization`, la página con y sin datos, el `404`,
  el CTA con y sin sesión, `guestGuard` con `import`, la precedencia `import` sobre `returnUrl`, el inicializador que no
  restaura sesión en una ruta pública, `/mis-links?import=` con su "Reintentar", el interruptor con sus confirmaciones y
  su aviso de oferta sin leer, el `403` con su texto, y el store que conserva `publicShare` al sustituir una tarjeta y
  lo borra al despublicar.
- **E2E Playwright** en `apps/web-e2e/src/public-share.spec.ts`, con la franja `public: 4` en `JOB_ID_SLOTS` y
  `resetRegisterLimit()` como el resto. La petición a `/p/:slug` va **al origen de la API**, no al del SPA: en el e2e
  son dos orígenes distintos y pedirla al del SPA devolvería el `index.html` de Angular y el test pasaría sin probar
  nada.

## Risks / Trade-offs

- **Lo que un chat ya pintó no se puede borrar.** Despublicar mata la página, no la tarjeta que WhatsApp guardó en una
  conversación. Se dice en el texto del interruptor.
- **Cualquier miembro del grupo puede repartir la URL pública** de un link publicado por otro (D2). Es una URL ya
  pública; quien la publicó puede apagarla.
- **La misma vacante puede tener dos páginas** si está publicada en dos grupos (D1). No filtran nada la una de la otra y
  la alternativa era publicar para todos desde un solo grupo.
- **Un preview `manual` o `pasted` se publica con lo que alguien escribió** en los campos cortos (D6). Sin `summary`, el
  riesgo se reduce a un campo de una línea, y el interruptor lo apaga.
- **El límite global se puede agotar a propósito** (D8): un atacante sostenido deja `/p/:slug` en `429` para todos unos
  minutos y las tarjetas de WhatsApp salen sin previsualización. No se pierde ni se expone nada, el umbral está muy por
  encima del tráfico real y el `429` no cuesta ninguna lectura. El límite por cliente exige un proxy configurado, que
  es de `deploy-prod`.
- **Mientras no haya proxy configurado, los límites por IP siguen siendo los que ya existen** en `auth` y `groups`, con
  el comportamiento de hoy. Este change **no** activa `trustProxy` precisamente para no convertir `request.ip` en un
  dato que manda el cliente, que debilitaría esos límites de login, registro y unión a un grupo.
- **Una oferta publicada antes de leerse sale con una tarjeta pobre** en el chat, y el chat la cachea durante días. Se
  avisa al copiar, no se bloquea, y la página mejora sola en cuanto llega el enriquecimiento (para quien la abra
  después).
- **`defaultVisibility` activada por defecto** hace que, en un grupo que nunca miró el ajuste, cada link nuevo nazca con
  una URL pública. Es la decisión humana 3 y lo que fija design-v0.2 §5.5; lo compensan que la página no dice nada del
  grupo ni de quien comparte, el interruptor por link y que el owner puede apagarlo para todo lo que venga.
- **Cinco reintentos de slug** podrían agotarse con la base llena. Con 59 bits y el volumen de este producto es
  inalcanzable; si pasara, es un `500` con su log, no una colisión silenciosa.
- **Dos variables de URL pública** (`PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL`) que en producción pueden apuntar al mismo
  origen. Deducirlas de la petición sería más cómodo y falsificable.
- **`duplicateKeyIs` se mueve de sitio** y toca `groups` y `applications` sin cambiar su comportamiento. Es refactor
  dentro de un change de feature; lo acotan que sea un solo símbolo, que sus tests se muevan con él y que el
  `typecheck` de `api` lo detecte entero.
- **Sin métrica de adquisición** (D9): no sabremos cuántas altas vienen de una página pública hasta que se añada
  `fromSlug`.

## Migration Plan

1. Desplegar `api` con las dos variables nuevas ya presentes en el entorno: sin ellas el proceso **no arranca**
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

## Debate (iteración 1)

Critic: 3 P0. Business: 3 V0. Tras aplicar esta tabla no queda ningún P0/V0 abierto.

| # | Hallazgo | Decisión | Motivo |
|---|----------|----------|--------|
| critic 1 (P0) + business 4 | El límite por IP arrastraba `TRUST_PROXY`, y `trustProxy: true` convierte `request.ip` en un dato del cliente: debilitaría los límites de login, registro y unión a un grupo | **Adaptado**: límite **global por ruta**, sin IP y sin variable de proxy, consumido antes de leer y con fallo abierto; `TRUST_PROXY` sale del change (D8) | Una página pública no puede debilitar la autenticación; el proxy es de `deploy-prod` (ADR-020) |
| critic 2 (P0) | `web/auth` no recogía la tercera ruta pública, el destino del `guestGuard` con `import` ni la excepción de la restauración | Aceptado: delta `specs/web/auth/spec.md` con los tres requisitos MODIFIED y el proposal actualizado | Un comportamiento del SPA que no está en su spec no existe |
| critic 3 (P0) | El `provideAppInitializer` restauraba sesión también en la vista pública: "Conectando…" y hasta 10 s de espera para quien llega sin cookie | Aceptado: no se restaura al arrancar en una ruta pública; la sesión se resuelve al pulsar el CTA (D9, tarea 7.5) | La primera impresión del producto es esa pantalla |
| critic 4 | El `exclude` con `'p'` habría dejado `/p/:slug` bajo `/api` | Aceptado: `exclude` con la ruta `p/:slug` y test de integración (D4, tarea 6.3) | `setGlobalPrefix` compara rutas, no prefijos |
| critic 5 | El endpoint JSON se quedaba sin tope | Aceptado: contador global propio, independiente del de la página (D8) | Es la otra puerta sin sesión |
| critic 6 | `sha256(ip)` como clave | Sin efecto: ya no hay ninguna clave por cliente | — |
| critic 7 | El `displayUrl` podía llevar credenciales y fragmento y se publicaba tal cual | Aceptado: `publicHttpUrl` en `libs/shared`, con su tabla; sin URL válida, la página va sin enlace (D6, tarea 1.4) | Es una URL que nunca se normalizó (ADR-021) |
| critic 8 | Sin `Referrer-Policy`, el slug viajaba a la bolsa en el `Referer` | Aceptado: `no-referrer` en las tres respuestas, con escenario (D4) | El slug es la llave de la página |
| critic 9 | Sin CSP ni `nosniff` | Aceptado: CSP restrictiva sin orígenes externos ni `eval`, y `nosniff`, con su fila de test (D4) | Defensa en profundidad sobre el escapado |
| critic 10 | La imagen iba a `src/assets`, que no es la carpeta de estáticos | Aceptado: `apps/web/public/assets/og-default.png` (D5, tarea 7.12) | Es lo que el build copia a la raíz |
| critic 11 | El reintento por colisión de slug vivía en el caso de uso y no distinguía índices | Aceptado: vive en el repositorio junto a `share`, distinguiendo `PUBLIC_SLUG_KEY` de `GROUP_LINK_KEY` (D2, tareas 3.5, 4.3 y 4.4) | Un `E11000` no es un concepto de aplicación |
| critic 12 | El `exclude` llegaba después de las pruebas de la página | Aceptado: sube al grupo 3, antes de la presentación | Sin él, esos tests probarían otra ruta |
| critic 13 | Una tercera copia de `duplicateKeyIs` | Aceptado: sube a `infrastructure/mongo/`, y `groups` y `applications` la importan (D10, tarea 3.3) | Mismo movimiento que ADR-025 §8 con `ipLimitGroup` |
| critic 14 | Despublicar dejaba la marca puesta hasta recargar | Aceptado: el store borra `publicShare` explícitamente, como con la nota (D12) | "Conservar si no viene" no es "quitar" |
| critic 15 | La ruta pública del SPA se podía indexar | Aceptado: `noindex` en la vista y `Disallow: /oferta/` en su `robots.txt` (D9) | Misma razón que en la página de la API; los bots de OG piden `/p/`, que no se desautoriza |
| critic 16 | `import` y `returnUrl` juntos no tenían precedencia | Aceptado: gana `import`, validado con `isValidPublicSlug`, con escenario en `web/auth` (D9) | Es el gesto más reciente y el único irreversible |
| critic 17 | El contador se consumía después de leer, y `/p/` y `/p/a/b` caían en el 404 JSON | Aceptado: se consume antes de leer y las dos formas raras devuelven el mismo HTML (D4, D8) | Un tope que cuesta una consulta no es un tope |
| critic 18 | El e2e pedía `/p/:slug` al origen del SPA | Aceptado: el e2e usa el origen de la API (D13, tarea 8.2) | Al otro origen contesta el `index.html` de Angular |
| critic 19 | Tareas de más de 1 h (5.3, 7.8, 4.4) | Aceptado: partidas | Tareas verificables en menos de una hora |
| business 1 (V0) | Nadie se enteraba de que su link nacía público justo cuando iba a repartirlo | Aceptado: la confirmación de guardar dice el alcance y ofrece "Copiar enlace" con el dato que ya trae la respuesta (D12, spec `web/links`) | Es el único momento en que enterarse sirve de algo, y no cuesta una petición |
| business 2 (V0) | Copiar el enlace de una oferta sin leer manda al chat una tarjeta vacía que se cachea | Aceptado: aviso "Todavía estamos leyendo la oferta…" y se deja copiar (D12, Risks) | Avisar sin bloquear; la persona sabe lo que hace |
| business 3 (V0) | El salario iba al final de `og:description`, que es lo que cada app recorta | Aceptado: empresa · ubicación · salario · modalidad · nivel · cierre (D5) | El sueldo es lo que decide si se abre la oferta |
| business 5 | No había forma de saber si la página sirve para algo | Aceptado: log estructurado `{ slug, status }` en las dos rutas públicas, sin datos personales y sin escrituras (D4) | Observabilidad sin tocar el "ninguna escritura" de D7 |
| business 6 | Un fallo al importar obligaba a volver al chat | Aceptado: "Reintentar" en el mensaje (D9, spec `web/public-preview`) | La persona ya está en `/mis-links` |
| business 7 | — | Es el mismo punto que critic 2 | — |
| business 8 | El CTA no decía qué gana quien no conoce LinkVault | Aceptado: "Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas." (D12) | Un botón sin promesa no se pulsa |
| business 9 | El `404` no daba salida y el `403` parecía un fallo | Aceptado: "Pídeselo de nuevo a quien te lo envió" y "Solo quien compartió la oferta o el propietario del grupo puede cambiar esto" (D4, D12) | Cada callejón sin salida tiene que decir qué hacer |
| business 10 | — | Sin cambios | — |
