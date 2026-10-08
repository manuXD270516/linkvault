## Context

La guía de uso del 2026-09-28 (`docs/guia-de-uso/README.md`, «Hallazgos») dejó siete defectos de producto, H1-H7. Este
design localiza cada uno en el código (lectura del 2026-10-08 sobre `origin/main`) y en la spec que lo gobierna, y
decide cómo corregirlo. El change es una **excepción a la precedencia de la fila 35** decidida por el owner el
2026-10-08 (ADR-055 §1); su alcance temporal es la pregunta Q1.

**Alcance tras la iteración 1 del debate (2026-10-08):** entran **H1, H2, H4, H5 y H6**, más el selector vacío de
«Grupo para avisos de estado» (Q2 = a). **H3 y H7 salen** (B2, B3; ver proposal «Fuera de alcance» y la sección
«Debate — iteración 1»).

| Hallazgo | Código responsable | Spec vigente |
| --- | --- | --- |
| H1 | `apps/api/src/modules/links/application/link.mapper.ts` (`toResolvedPreviewSources`, `displayNameIdsOf`) y sus llamadas en nueve casos de uso; `apps/web/src/app/features/links/link-preview.ts` (`originText`, `latestPaste`) | `links/enrichment` «Preview con procedencia por campo» (exige el nombre a cualquier lector); `users/profile` «Consulta del perfil propio» (lo restringe a miembros de sus grupos) |
| H2 | `apps/web/src/app/features/notifications/notifications.page.html` (`mat-hint` de dos líneas en un `mat-form-field` con subíndice de alto fijo; `mat-option [value]="null"` que Material no pinta) | `web/notifications` «Preferencias en el perfil» |
| H4 | `apps/web/src/app/features/links/save-link.form.ts` (`savedUnread` es una foto de la respuesta de guardar que nadie actualiza) y `link-list.component.ts` (`copyPublicLink`, que mira solo `pending`) | `web/links` «Guardar un link desde el SPA»; `web/public-preview` «Interruptor del enlace público en la tarjeta del grupo» |
| H5 | `save-link.form.ts` (`this.form.reset()` no limpia el `submitted` de `FormGroupDirective`; el `ErrorStateMatcher` por defecto pinta el campo vacío e inválido) | `web/links` «Guardar un link desde el SPA» |
| H6 | `apps/web/src/app/features/applications/share-invitation.ts` y `share-notice.component.ts` (el aviso vive en el `MatSnackBar` raíz, sin relación con la ruta) | `web/applications` «Invitación a compartir tras el gesto» |

## Goals / Non-Goals

**Goals:** cumplir la regla de `users/profile` en **toda** respuesta de la API que lleve procedencia (el nombre de
otra persona, solo para quien comparte un grupo con ella), y con ella la promesa «no se verá el grupo ni tu nombre»
**para quien no comparte ningún grupo con el autor** (para quien sí lo comparte, ver Q7); dejar los defectos de
pantalla H2, H4, H5 y H6 corregidos y cubiertos por un test que caería si volvieran, sin que ninguna verificación
obligatoria dependa de un E2E sin `@lot1` (C1).

**Non-Goals:** H3 y H7 (diferidos, ver proposal «Fuera de alcance»); H8-H17 (pruebas y configuración de la pila);
rediseñar la procedencia (ADR-010 sigue igual: qué se guarda no cambia, solo quién lo lee); decidir si alguien de fuera
de un grupo debe poder corregir un preview que ese grupo ve (Q8, change posterior); publicar la interfaz en inglés
(fila 37).

## Decisions

### D1. H1: el nombre del autor de un campo solo lo ve quien comparte grupo con él

**Regla.** Al leerse la procedencia, el autor de un campo `manual` o `pasted` (y el de su entrada `replaced`) se
resuelve a `{ userId, displayName }` **solo si** quien lee es el propio autor o comparte con él al menos un grupo en el
momento de la lectura (Q3 = a, cualquier grupo en común). En cualquier otro caso la API devuelve `by: null`: ni nombre
ni identificador.

**De dónde sale la regla (la promesa existente).** No se inventa una política nueva; se aplica la que ya está escrita
y que el código contradice:

1. `openspec/specs/users/profile/spec.md`, «Consulta del perfil propio»: «de otro usuario solo SHALL ser visible su
   `displayName`, y únicamente para los miembros de sus grupos (spec `groups/membership`). Ningún otro campo […] SHALL
   exponerse a terceros». El `userId` también es un campo: por eso `by: null` y no un nombre genérico con el id.
2. La interfaz, al guardar en un grupo que comparte en público: «Cualquiera con este enlace verá la oferta; no se verá
   el grupo ni tu nombre» (`apps/web/src/app/features/links/save-link.form.html:68`, exigido por `web/links` «Guardar
   un link desde el SPA»).
3. La confirmación de encender el enlace público: «No se verá el grupo, ni tu nombre, ni los comentarios»
   (`link-list.component.ts:569`, `web/public-preview` «Interruptor del enlace público en la tarjeta del grupo»).

La página pública ya cumple (`links/public-share` «Qué no sale nunca en la página pública» excluye la procedencia).
Lo que falla es lo que pasa **después**: quien guarda desde el enlace público recibe el `JobLink` canónico, cuya
procedencia es compartida por todos los que tienen esa vacante, y la API le resuelve el nombre de Ana. Y no solo a
él: cualquiera que guarde la misma URL por su cuenta (dedupe de ADR-008) también lo ve.

**Lo que la regla no cubre (C5, Q7).** Quien comparte **algún** grupo con Ana e importa la oferta desde el enlace
público de otro grupo de Ana ve «Escrito por Ana»: la regla de `users/profile` se lo permite, pero las promesas 2 y 3
dicen «no se verá tu nombre» sin matiz. O se ajusta el texto de la promesa, o se acepta por escrito: es la **Q7**,
bloqueante para `/opsx:apply`.

**Qué se muestra en vez del nombre.** Se conserva el **tipo** de origen, que es lo que da valor a la procedencia
(`link-preview.ts`: «"Escrito por Ana" es una persona que se hace responsable. Confundirlos es lo que convierte un
salario inventado en un salario creído»), y se sustituye solo la persona (Q5: «otra persona»):

| Origen | Con autor visible | Con autor oculto (`by: null`) |
| --- | --- | --- |
| `manual` | «Escrito por Ana» | **«Escrito por otra persona»** / EN «Written by someone else» |
| `pasted` | «Descripción pegada por Beto» | **«Descripción pegada por otra persona»** / EN «Description pasted by someone else» |
| deshacer pegado | «Deshacer lo que pegó Beto» | **«Deshacer lo que pegó otra persona»** / EN «Undo what someone else pasted» |

«Otra persona» es exacto: el lector nunca es un autor oculto (uno mismo siempre es visible). La regla es simétrica
(B4): si Carla, que tiene la vacante en privado, corrige el preview canónico, Beto —que la ve en un grupo donde Carla
no está y no comparte ninguno con ella— lee «Escrito por otra persona».

**Alternativas descartadas.**
- *Ocultar solo en la lista privada.* Bob, que guarda por su cuenta una URL que Ana editó en un grupo de Bob, sí
  comparte grupo con Ana; y Carla, que la tiene en un grupo suyo donde Ana no está, no. La regla es de personas, no de
  pantallas: la lista privada no la resuelve.
- *Nombre solo para quien comparte un grupo **que contenga ese link*** (más estricta, Q3 = b). Requiere cruzar
  `group_links` × membresías por página y no la exige ninguna spec vigente. Descartada en el debate (Q3 = a); puede
  venir después sin cambiar el contrato.
- *Nombre genérico con el `userId`* («Usuario», como el respaldo `UNKNOWN_SHARER_NAME`): sigue exponiendo un
  identificador estable entre contextos, que `users/profile` no permite.
- *Copiar la procedencia al guardar desde el enlace público.* El preview es canónico por diseño (ADR-010, ADR-008);
  bifurcarlo rompe las correcciones compartidas y no arregla el caso de quien guarda la URL por su cuenta.

### D2. H1: una sola regla, en el mapeo único, con un tipo que solo construye el ayudante

Los nombres se resuelven hoy en nueve casos de uso (`list-my-links`, `list-group-links`, `save-link`, `import-links`,
`paste-description`, `update-link-preview`, `reopen-job-link`, `request-link-enrichment`, `deliver-link-enriched`),
todos con el mismo patrón: `displayNameIdsOf(links)` → `directory.displayNamesOf(ids)` → `toJobLinkSummary(link,
{ names })`. Se corrige en el punto común:

- **Puerto nuevo (C2).** `GroupMembership` (`links/application/ports/group-membership.port.ts`) gana
  `peersAmong(userId: string, candidateIds: readonly string[]): Promise<Set<string>>`: de los candidatos, los que
  comparten al menos un grupo con `userId`. El adaptador `groups-facade-membership.ts` lo resuelve con un método nuevo
  de `GroupsFacade` que **solo delega** en un método nuevo del puerto `GroupRepository`
  (`groups/application/ports/group-repository.port.ts`), con sus dos implementaciones, Mongo y en memoria (N6). La de
  Mongo hace **una sola consulta indexada** a las membresías y **reutiliza `groupsOfUserStages`** —o su
  `$lookup`+`$unwind` contra `groups`— tanto para las membresías del lector como para las de los candidatos (N5): una
  membresía huérfana (su grupo ya no existe) no cuenta como grupo en común, igual que no cuenta en la lista de grupos
  ni en el límite de 20. Usa los índices de membresía existentes: el de `(groupId, userId)` ya existe
  (`MEMBERSHIP_KEY`), así que no se añade ninguno. La implementación en memoria del repositorio hace lo mismo y
  **cuenta las consultas**. Las pruebas que cuentan comandos del driver van en `mongo-group.repository.spec.ts`
  (replset, con el contador copiado de `mongo-group-link.comments.spec.ts`), no en la fachada (tareas 1.2a-i y 1.2a-ii).
- **Doble de pruebas de `links` (P1-A).** Los specs de `links` no usan el repositorio de `groups`: usan
  `InMemoryGroupMembership.peersAmong`, en `links/application/testing/links-test-doubles.ts`, que devuelve los
  co-miembros a partir de membresías sembradas y **cuenta sus llamadas**. Es el contador al que se refieren
  «issues exactly one query…» y «issues no query…» de la 1.2b y «issues one peersAmong per distinct author» de la 1.7
  (tarea 1.2a-iii).
- **Tipo con marca (C3).** `VisibleAuthors` = `ReadonlySet<string> & { readonly [visibleAuthorsBrand]: true }`, con la
  marca como `unique symbol` no exportado del módulo del ayudante: solo el ayudante puede construirlo.
  `toJobLinkSummary` / `toResolvedPreviewSources` reciben `visibleAuthors: VisibleAuthors` como campo **obligatorio**
  de `SummaryContext`. Un autor fuera del conjunto sale `by: null`. Al ser obligatorio y de tipo marcado, el compilador
  señala cada llamada y ningún caso de uso puede pasar un `new Set(...)` a mano. **Falla cerrado:** un conjunto vacío
  oculta a todos los autores.
- **Ayudante.** `visibleAuthorsFor(membership, viewerId, candidateIds): Promise<VisibleAuthors>` en
  `links/application/visible-authors.ts`: quita al lector de los candidatos; si no queda nadie (candidatos ∅ o solo el
  lector), devuelve `{viewerId}` **sin ninguna consulta**; si no, `peersAmong(viewerId, resto)` ∪ `{viewerId}`.
  **Las excepciones se propagan**: no hay `catch` con respaldo («todos visibles» o «ninguno») y la petición falla como
  falla cualquier lectura de Mongo.
- **Nombres solo de lo visible (C3, N3).** Los autores de procedencia **ocultos** no se piden al directorio: de los
  ids de autores, `displayNamesOf` recibe solo los del conjunto visible. `sharedBy` y los autores de comentarios
  siguen igual que hoy (se piden y se resuelven como ahora).
- **Coste (corrige lo afirmado en la versión anterior):** **una** consulta por petición cuando hay autores ajenos al
  lector; **cero** cuando no los hay. Ninguna por campo ni por link.
- Los nombres de `sharedBy` y de los comentarios **no cambian**: solo salen en el listado de un grupo, donde quien lee
  es miembro por definición (`links/sharing`, `links/group-comments`). **Excepción heredada (N4):** por la decisión
  humana 4 de `group-comments`, quien salió del grupo sigue nombrado en `sharedBy` y en sus comentarios; este change no
  la toca y lo anota en ADR-055 §Consecuencias. La regla de D1 es solo sobre `previewSources`.

### D3. H1: en los avisos en tiempo real, por destinatario

`DeliverLinkEnriched` compone hoy el resumen **por destinatario** con `summaryFor(link, seenThrough, names)`: cada uno
lleva su `sharedAt` y su `sharedBy` (la fecha de su lista privada o la del grupo por el que lo ve, y quién lo compartió
en ese grupo). Eso **se mantiene** (N1): no se agrupan destinatarios en un resumen común, porque dos destinatarios con
el mismo conjunto visible pueden tener `sharedAt`/`sharedBy` distintos.

Lo que cambia es que `summaryFor` recibe además el `VisibleAuthors` de ese destinatario. Para calcularlo, por cada
autor distinto del link (pocos: quien escribió o pegó algún campo) se llama **una vez** a `peersAmong(autor,
destinatarios)`, que devuelve los destinatarios que comparten grupo con ese autor; el `VisibleAuthors` de cada
destinatario son los autores cuyo resultado lo contiene, más él mismo si es autor. El ayudante ofrece para esto
`visibleAuthorsByRecipient(membership, authorIds, recipientIds): Promise<Map<string, VisibleAuthors>>`, el único otro
constructor del tipo. Como mucho, se cachea `toResolvedPreviewSources` por conjunto visible distinto (la procedencia
resuelta solo depende del conjunto); el resumen sigue siendo uno por destinatario. `displayNamesOf` recibe, de los
autores de procedencia, solo la unión de los visibles para algún destinatario; los `sharedBy`, como hoy.

Coste añadido por aviso: **una consulta por autor distinto**, ninguna si el link no tiene autores humanos. Se acepta:
el reparto ya hace una consulta por grupo y no ocurre cuando nadie escucha. **Un fallo de `peersAmong` se propaga y el
aviso no se reparte (N2).** No hay cola ni reintento: `LinkEnrichedSubscription` recibe el aviso por pub/sub, el fallo
se descarta y se registra, y las pantallas abiertas se ponen al día al recargar o al volver a la pestaña (como cuando
el aviso se pierde por cualquier otro motivo). Nunca se reparte un resumen sin filtrar.

### D4. H1: contrato — autor anulable en la lectura, nunca en lo guardado

- `libs/shared/src/schemas/preview.schema.ts`: la procedencia **resuelta** (`previewSourcesSchemaWith(previewAuthorSchema)`)
  pasa a `previewAuthorSchema.nullable()`, también en `replaced`. La procedencia **guardada** (`previewAuthorIdSchema`)
  no cambia: el worker y la base de datos siguen guardando el autor.
- SPA: `PreviewFieldOrigin` admite `by: PreviewAuthor | null`; `originText` y el texto de deshacer usan las cadenas de
  D1 cuando es `null`. `latestPaste` agrupa los campos de un mismo pegado por `at` y por «mismo autor», donde dos
  `null` cuentan como el mismo autor. Riesgo aceptado: dos pegados de dos autores ocultos con el mismo `at` al
  milisegundo se ofrecerían deshacer juntos; deshacer devuelve cada campo a lo anterior, así que no se pierde nada que
  no se pueda rehacer.

### D5. H2: el subíndice del selector crece con su texto, y el selector dice qué está elegido

- El `mat-form-field` de «Grupo para avisos de estado» lleva `subscriptSizing="dynamic"`: el alto del subíndice pasa a
  ser el de su contenido, y lo que viene detrás («Preferencias guardadas», el error, el botón) baja en vez de quedar
  debajo. Se descarta acortar el texto (la explicación es necesaria y en inglés es más larga) y sacar la ayuda del
  campo a un párrafo (pierde la asociación `aria-describedby` que da `mat-hint`).
- **Q2 = (a).** Con la preferencia en `null` («Todos mis grupos (unión del link)») el campo se ve vacío: `mat-option`
  con valor `null` es la opción de reinicio de Material y no se pinta. El formulario usa un valor centinela
  (`ALL_GROUPS = '__all__'`, constante del componente) para esa opción y lo traduce a `null` al guardar y desde `null`
  al cargar. La API no cambia.

### D6. H4: el aviso de «sin datos» depende solo de que la tarjeta no tenga puesto (B1, G1)

**Cuándo hay aviso.** Una función pura, `emptyCardNotice(link, now): 'reading' | 'empty' | 'notAJob' | null` en
`features/links/empty-card-notice.ts`, decide el aviso de copiar el enlace de una oferta publicada, igual en el
formulario de guardar y en «Copiar enlace» de la tarjeta (`link-list.component.ts:633`). El aviso depende **solo de
que no haya puesto** (`preview.title` vacío), no del nombre del estado (G1). Los estados reales de `previewStatusSchema`
son `pending`, `enriched`, `partial`, `failed` y `manual`; no existe `ready` (N7).

- **Con puesto** (leído, pegado o escrito a mano), en cualquier estado → ninguno.
- **Sin puesto y la tarjeta aún dice «Leyendo la oferta…»** → `reading`. Es la misma condición con la que
  `linkCardStatus` (`link-status.ts`) pinta «Leyendo la oferta…»: sin error de lectura, sin ningún dato y pedida hace
  menos de `READING_GRACE_MS`. Se extrae a un predicado compartido (`isStillReading(link, now)`) para que tarjeta y
  aviso no puedan divergir.
- **Sin puesto y `lastEnrichmentError.reason === 'not_a_job'`** → `notAJob`, con texto propio y sin «Complétala»: no
  hay nada que completar en algo que no es una oferta.
- **Sin puesto en cualquier otro caso** —`failed` por otro motivo, `partial` sin puesto, `manual` sin puesto, `pending`
  caducado o `pending` con otros datos pero sin puesto— → `empty`.

| Estado del link | Puesto (`title`) | Aviso |
| --- | --- | --- |
| cualquiera | con valor | ninguno |
| `pending`, sin datos, dentro de `READING_GRACE_MS` | vacío | `reading`: «Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos» (texto actual) |
| `pending` fuera de `READING_GRACE_MS` (caducado) | vacío | `empty` |
| `pending` con otros datos (la tarjeta dice «Faltan datos de esta oferta») | vacío | `empty` |
| `failed` por `not_a_job` | vacío | `notAJob`: **«Esto no parece una oferta: si lo envías, la tarjeta saldrá sin datos»** / EN «This does not look like a job offer: if you send it, the preview will be empty» |
| `failed` por cualquier otro motivo | vacío | `empty` |
| `partial` | vacío | `empty` |
| `manual` | vacío | `empty` |

Texto `empty` (G2): **«La tarjeta todavía no tiene el puesto: si lo envías ahora, saldrá sin datos. Complétala antes
desde la tarjeta»** / EN «This card doesn't have the job title yet: if you send it now, it will show an empty
preview. Fill it in from the card first». Id nuevo, `@@links.public.copyFailedEmpty`. El de `notAJob` también es nuevo,
`@@links.public.copyNotAJob`. Los dos avisos nuevos van **sin punto final**, en ES y en EN, como el `copyUnread` que
ya existe.

Completar a mano el puesto hace desaparecer el aviso en los dos sitios. Esto responde la antigua Q6. `now` es la hora
de cada evaluación, como en `linkCardStatus` de la tarjeta (`new Date()` dentro del `computed`). **Cuándo se evalúa
(P1-E):** el aviso se evalúa al cambiar el link (formulario) o al pulsar (tarjeta); el paso del tiempo sin cambios no
lo reevalúa, igual que el estado de la tarjeta.

**De dónde sale el estado (formulario, P1-B).** `savedUnread` deja de ser una señal escrita una vez y pasa a ser un
`computed` con `emptyCardNotice` sobre `latestSaved`, una señal **acumulada** (`linkedSignal` o `effect`) que guarda la
instantánea más reciente del link recién guardado y **solo avanza** si llega una con `previewVersion` mayor (a igual
versión, la de `LinksStore` sustituye a la guardada). La alimentan tres fuentes:

1. `LinksStore`, si el link está en la lista cargada (el mismo dato que usa la tarjeta);
2. el último `LinkEnrichedMessage` de `EventsChannel.linkEnriched` cuyo `link.id` es el id guardado (C12): el formulario
   se suscribe filtrando por ese id, así que con filtros activos —el link fuera de la lista— el aviso tampoco queda
   fijo;
3. la respuesta de guardar.

Se toma **la instantánea más reciente por `previewVersion`** que haya llegado (N8), no la primera por orden de fuente,
y se **acumula**: que una fuente desaparezca no hace retroceder `latestSaved`. Si una recarga de la lista deja fuera
el link (filtros), la fuente 1 desaparece pero `latestSaved` conserva la versión ya vista —venga del último
`linkEnriched` o de la propia lista, por ejemplo un link completado a mano—, y el aviso ya superado no vuelve. Un
`computed` que solo mirase las fuentes presentes sí lo devolvería. A igual `previewVersion` gana `LinksStore` (es lo
que pinta la tarjeta).

**Carrera con el guardado (P1-B).** El id no se conoce hasta que responde `store.save`, y el worker puede emitir
`link_enriched` antes. Por eso el formulario se suscribe a `linkEnriched` **antes** de llamar a `store.save`, guarda
los mensajes que lleguen durante el guardado y, cuando llega la respuesta, los filtra por el id guardado y los entrega
a `latestSaved` (que se queda con el de mayor `previewVersion`); a partir de ahí filtra por id en vivo.

La tarjeta ya tiene el link actual; solo cambia la condición (`emptyCardNotice` en lugar de `=== 'pending'`).

### D7. H5: reiniciar el formulario entero, también su envío

Tras un guardado correcto se reinicia con `FormGroupDirective.resetForm()` (vía `viewChild`) en lugar de
`FormGroup.reset()`: además de los valores limpia `submitted`, que es lo que el `ErrorStateMatcher` por defecto mira para
pintar un campo vacío como error. Con `invalid_url` el campo **conserva** lo escrito, como hoy. Con `shared`
`already_there` la nota «Ya estaba aquí, lo compartió <nombre>» se conserva tras el reinicio (C13). Se descarta un
`ErrorStateMatcher` propio: arreglaría el síntoma en un campo y dejaría el formulario en un estado «enviado» falso.

### D8. H6: el aviso pertenece a la página del grupo

1. **Primero se reproduce, con límite (C8).** El aviso «Compartido · Deshacer» siguió visible en capturas tomadas muy
   por encima de 10 s después (037 a 046), sin que la causa esté clara en la lectura del código (`ShareNotice` programa
   el cierre a los 10 s si el foco no está dentro). La tarea 6.1 dedica **como mucho una hora**: primero con
   temporizadores simulados en el spec del componente; si ahí pasa, en un navegador real por el camino antiguo (un
   spec sin `@lot1` con `page.clock`). Si se reproduce, se corrige la causa; si no, se anota en la tarea que no se
   reprodujo y se cierra: el punto 2 cubre el síntoma visible de la guía.
2. **Al salir de la página, se cierra.** `ShareInvitation` cierra el aviso abierto en cuanto el router empieza una
   navegación cuyo **path** es distinto del de la ruta donde se abrió (`/grupos/:id`); un cambio solo de query o de
   fragmento no lo cierra (los filtros del grupo cambian la query). El desenlace es el mismo que si se hubiera dejado
   ir: la invitación sin pulsar deja la postulación **privada**, y «Compartido» sin pulsar «Deshacer» la deja
   **compartida**; «Deshacer» sigue disponible en el interruptor del panel de la postulación. La regla de «no antes de
   10 s ni con el foco dentro» sigue rigiendo mientras la persona está en la página: salir es una acción explícita.
   El aviso se cierra en `NavigationStart` con path distinto y, además, en `NavigationEnd` si el path final ya no es el
   del gesto (N9): cubre un aviso que se abrió entre los dos eventos. Una navegación cancelada también cierra el
   aviso; se acepta porque el desenlace es el de dejarlo ir (P1-D).
3. **No abrir tarde (C7, N9).** Antes de cada `show()` —la invitación tras el gesto y «Compartido» tras
   `setVisibility`, que espera a la API— se comprueba que el path actual sigue siendo el del gesto **y** que no hay una
   navegación en curso hacia otro path (la señal `router.currentNavigation()` nula, o con destino del mismo path,
   comparando el path de `finalUrl ?? extractedUrl`; P1-C); si la
   persona ya navegó o está navegando, no se abre. Cubre la respuesta de la API que llega entre `NavigationStart` y
   `NavigationEnd`, cuando la URL todavía es la del grupo.

Se descarta darle duración fija al aviso (rompe la regla de accesibilidad de 10 s con foco, business 4 de
`applications-tracking`) y anclarlo dentro de la tarjeta (cambia el patrón de aviso del SPA para un solo caso).

### D9. Textos e i18n

Cada texto nuevo lleva id `@@…` explícito, ES por defecto en la plantilla o en `$localize`, y su traducción en
`apps/web/src/locale/messages.en.xlf`. `messages.xlf` se regenera con `pnpm nx run web:extract-i18n` en el mismo
commit, nunca a mano, y `pnpm nx run web:i18n-check` tiene que pasar (ADR-050). Ids nuevos: `links.origin.pastedHidden`,
`links.origin.manualHidden`, `links.paste.undoHidden`, `links.public.copyFailedEmpty` (texto `empty` de G2) y
`links.public.copyNotAJob`. Si Q7 = (a), cambian además el texto ES y la traducción EN (con su `source`) de los ids
existentes de las promesas, sin cambiar el id.

### D10. Cómo se verifica sin depender de E2E no admitidos (C1)

Solo `critical-path.spec.ts` lleva `@lot1`; un spec sin esa etiqueta no cuenta como verificado
(`apps/web-e2e/README.md`). Por eso:

- **H1** se verifica con la prueba de integración de la API (tareas 1.8 y 1.9, `mongodb-memory-server` replset), que
  recorre las rutas y un suscriptor de avisos en tiempo real.
- **H2, H4, H5 y H6** se verifican con specs de componente en `TestBed` con **Angular Material real** (no stubs):
  `subscriptSizing`, el `ErrorStateMatcher` por defecto, el `MatSnackBar` y el router son los de producción.
- **H2, sustituto aceptado de la geometría (N10).** `TestBed` sobre jsdom no maqueta: no hay cajas que medir ni orden
  visual fiable. Lo verificable es que el subíndice del selector crece con su contenido, y eso lo dice la clase
  `mat-mdc-form-field-subscript-dynamic-size` que Material pone con `subscriptSizing="dynamic"`. Esa clase es el
  **sustituto aceptado** de comprobar la geometría (que nada se solape a 1280 px ni a 412 px); no se añade un test de
  orden en el DOM, que no probaría nada sobre el solape.
- Las E2E que se quieran añadir viven en el camino antiguo, **sin `@lot1`**, y se anotan como **evidencia
  informativa**: no son la verificación de ninguna tarea.
- El cierre exige `critical-path` (`@lot1`) sin regresión.

## Risks / Trade-offs

- **[Riesgo] Un caso de uso que construya resúmenes fuera de `toJobLinkSummary`.** → D2 hace obligatorio un tipo que
  solo construye el ayudante; la tarea 1.3 busca con `grep` cualquier otra construcción de `previewSources` resuelto,
  también la forma abreviada (`{ previewSources }`), y cualquier `as VisibleAuthors` fuera de `visible-authors.ts`
  (N11); las pruebas de integración 1.8 y 1.9 recorren todas las rutas que devuelven links y el aviso en tiempo real.
- **[Riesgo] Un fallo al calcular la visibilidad que «se arregle» mostrando todo.** → las excepciones se propagan, sin
  respaldo, y un test lo exige (1.2b).
- **[Trade-off] Un autor que sale de los grupos que compartía con alguien pasa a «otra persona» en sus tarjetas.** Es
  la regla de `users/profile` aplicada en el tiempo, y coincide con lo que ya pasa con su nombre en la lista de miembros.
- **[Trade-off] Quien comparte un grupo con el autor sí ve su nombre al importar desde el enlace público.** → Q7.
- **[Riesgo] Coste de D3 en grupos grandes.** Una consulta por autor distinto y aviso, sobre índice; los autores por
  link son pocos. Si se mide un problema, se cachea por aviso, no se relaja la regla.
- **[Riesgo] H6 puede tener una causa distinta a la supuesta.** → D8.1: se reproduce antes de corregir, con una hora
  como límite.
- **[Riesgo] Conflictos con 35b.** Ningún delta de este change toca `platform/*`; el código de `apps/web` que 35b
  cambia (textos de verificación de correo, su tarea 7.13) no se solapa con estos ficheros, **salvo el catálogo**:
  los dos añaden ids a `messages.xlf` y `messages.en.xlf`. Los dos tocan también `openspec-changes.yaml` y
  `docs/design-v0.2.md` §6. El de `messages.xlf` se resuelve re-extrayendo (ADR-050); los demás, conservando las
  entradas de los dos. Se comprueba antes del PR (tarea 9.3).

## Migration Plan

Sin migración de datos. API y SPA salen en el mismo despliegue (un solo artefacto). **Aceptado (C6):** una pestaña
abierta durante el despliegue conserva el SPA anterior, que no espera `by: null` y puede fallar al pintar la
procedencia de un autor oculto; se resuelve recargando la página. No se añade compatibilidad hacia atrás para ese
intervalo. Vuelta atrás: revertir el PR.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`]. Alcance temporal de la excepción del 2026-10-08, sobre el alcance recortado
  (H1, H2, H4, H5, H6 y el selector de Q2).** «Abramos el change» decide abrirlo; no dice si puede aplicarse y
  fusionarse antes de que termine la fila 35.
  - (a) Abrir, debatir, aplicar y fusionar ya, **antes de invitar en 35b**, en paralelo a 35b como `e2e-suite`:
    fusionar antes de la 6.3 de 35b, o repetir la 10.7 de 35b tras fusionar.
  - (b) Abrir y debatir ahora; aplicar y fusionar al terminar 35c.
  - (c) Aplicar ahora solo H1 (privacidad) y dejar H2, H4, H5 y H6 para después de 35c.
  - **Recomendación: (a).** H1 rompe una promesa de privacidad a exactamente las personas que 35b va a invitar; el
    resto son defectos que esas personas verían el primer día. El change no toca nada de lo que 35b y 35c modifican.
- **Q7 [bloqueante para `/opsx:apply`]. La promesa «no se verá tu nombre» y quien comparte grupo con el autor (C5).**
  Con D1, quien comparte algún grupo con Ana e importa desde el enlace público de otro grupo de Ana ve «Escrito por
  Ana». Las dos superficies que hacen la promesa —el formulario de guardar (`save-link.form.html:68`) y la confirmación
  del interruptor (`link-list.component.ts:569`, `@@links.public.shareMessage`)— y las specs que las exigen
  (`web/links`, `web/public-preview`) la formulan sin matiz. (Reflect habló de tres superficies; en el código hay dos
  textos y sus dos specs. Si el owner cuenta una tercera, recibe el mismo ajuste.)
  - (a) **Ajustar el texto** para que diga la verdad. Propuesta exacta (texto de business, G3, iteración 2):
    - Formulario, ES: «Cualquiera con este enlace verá la oferta, pero no el grupo; tu nombre solo lo verá quien ya
      comparta un grupo contigo.» EN: «Anyone with this link can see the job, but not the group; only people who
      already share a group with you will see your name.»
    - Confirmación, ES: «Cualquiera con este enlace podrá ver la oferta sin entrar en LinkVault. No verá el grupo ni
      los comentarios, y tu nombre solo lo verá quien ya comparta un grupo contigo. Puedes dejar de compartirlo cuando
      quieras.» EN: «Anyone with this link can see the job without signing in to LinkVault. They won't see the group or
      the comments, and only people who already share a group with you will see your name. You can stop sharing
      whenever you like.»
    - Coste: dos textos (ids sin cambiar), dos requirements más con MODIFIED de texto y la re-extracción del catálogo;
      una tarea de < 1 h (8.2).
  - (b) **Mantener el texto** y aceptar por escrito en ADR-055 que la promesa no se cumple frente a quien comparte un
    grupo con el autor.
  - **Recomendación (de reflect): (a)**, porque dice la verdad sin cambiar la regla.
- **Q8 [no bloqueante; para un change posterior]. ¿Puede alguien de fuera de un grupo corregir el preview que ese grupo
  ve?** Es anterior a este change (el preview es canónico, ADR-008/ADR-010): Carla, con la vacante en privado, puede
  corregir lo que lee el grupo de Beto. Este change solo garantiza que Beto lea «Escrito por otra persona» (B4).

**Resueltas en el debate (iteración 1, 2026-10-08):** Q2 = (a), entra el selector (D5). Q3 = (a), cualquier grupo en
común. Q4 sin objeto (H3 fuera del change). Q5 = «Escrito por otra persona». Q6 respondida por B1 (D6).

**Formato de las respuestas del owner (N12).** Q1 y Q7 se anotan en ADR-055 (§1 y §3) con una línea que empieza por
«Respuesta del owner (Q1), AAAA-MM-DD:» y «Respuesta del owner (Q7), AAAA-MM-DD:», con la fecha real; la tarea 0.1 las
busca con ese patrón.

## Debate — iteración 1

Fecha: 2026-10-08. Participantes: `critic` (C*), `business` (B*), reflect (sesión principal).

| Id | Origen | Decisión | Motivo |
| --- | --- | --- | --- |
| B1 (V0) | business | aceptado | El aviso depende de que la tarjeta no tenga datos (pendiente, o fallida sin puesto), en el formulario y en «Copiar enlace» de la tarjeta (D6); responde Q6. |
| B2 | business | aceptado (recorte) | Con `AI_VAULT_KEY` obligatoria en producción nadie verá el error de H3: H3 se difiere a `e2e-suite-lot-2` con H11. |
| B3 | business | aceptado (recorte) | H7 es caro, empeora el selector nativo del móvil y puede depender del idioma del sistema: se difiere a un change con datos reales de 35b. |
| B4 | business | aceptado | Escenario «un miembro ve la corrección de alguien de fuera como "Escrito por otra persona"» y línea en ADR-055; la edición desde fuera queda como Q8. |
| C1 (P0) | critic | aceptado | Ninguna verificación obligatoria depende de E2E sin `@lot1`: integración API para H1 y specs de componente con Material real para el resto (D10). |
| C2 | critic | aceptado | Puerto `peersAmong` sobre `GroupsFacade` con una consulta indexada, atajo sin consultas y test que cuenta consultas; se corrige el coste afirmado (D2, D3). |
| C3 | critic | aceptado | Tipo con marca `VisibleAuthors`, excepciones sin respaldo, `displayNamesOf` solo para visibles y `grep` que detecta la forma abreviada (D2, 1.3). |
| C4 | critic | aceptado | La integración cubre importar y un suscriptor SSE, y aserta el `displayName` exacto y el `userId` con nombres sin subcadenas comunes. |
| C5 | critic | diferido al owner | La promesa queda rota frente a quien comparte grupo con el autor: Q7, bloqueante para apply. |
| C6 | critic | aceptado | Pestañas abiertas durante el despliegue: se recarga; escrito en el Migration Plan. |
| C7 | critic | aceptado | Antes de cada `show()` se comprueba que la ruta sigue siendo la del gesto (D8.3). |
| C8 | critic | aceptado | 6.1 con límite de una hora y reproducción en navegador real; la spec distingue cambio de path y de query (D8). |
| C9 | critic | sin objeto | Era de H3 o H7, que salen del change. |
| C10 | critic | sin objeto | Era de H3 o H7, que salen del change. |
| C11 | critic | sin objeto | Era de H3 o H7, que salen del change. |
| C12 | critic | aceptado | El formulario escucha `EventsChannel.linkEnriched` filtrado por el id guardado (D6). |
| C13 | critic | aceptado | Caso «already_there keeps the note after resetForm» en 5.2 (D7). |
| C14 | critic | adaptado | Q1(a) con la condición sobre 6.3/10.7 de 35b; 9.3 ampliada a `openspec-changes.yaml` y `design-v0.2.md` §6 con `git branch -r`; el punto (d) queda sin objeto por el recorte de H3. |
| C15 | critic | aceptado | 1.8 partida en dos bloques por rutas y ninguna tarea de más de una hora; la 7.1 queda sin objeto por el recorte. |
| Q2 | design | aceptado (a) | Entra el selector «Grupo para avisos de estado», con su escenario en `web/notifications`. |
| Q3 | design | aceptado (a) | Cualquier grupo en común: es la regla escrita en `users/profile`. |
| Q4 | design | sin objeto | H3 sale del change. |
| Q5 | design | aceptado | «Escrito por otra persona». |
| Q6 | design | resuelto por B1 | Texto propio para lectura fallida sin datos (D6). |

## Debate — iteración 2

Fecha: 2026-10-08. Participantes: `critic` (N*, P0 0), `business` (G*, V0 1), reflect (sesión principal). Q1 y Q7
siguen pendientes del owner.

| Id | Origen | Decisión | Motivo |
| --- | --- | --- | --- |
| G1 (V0) | business | aceptado | El aviso depende solo de que no haya puesto: `reading` mientras la tarjeta dice «Leyendo la oferta…», `notAJob` con texto propio, `empty` en el resto (D6). |
| G2 | business | aceptado | Texto `empty` nuevo en ES y EN con id nuevo, `@@links.public.copyFailedEmpty` (D6, specs, 8.1). |
| G3 | business | aceptado | La opción (a) de Q7 usa el texto de business; Q7 sigue pendiente del owner (Q7, ADR-055 §3, 8.2). |
| G4 | business | aceptado | Se elimina la E2E opcional 2.3: no verificaba nada. |
| N1 | critic | aceptado | Se mantiene `summaryFor` por destinatario con su `VisibleAuthors`, porque `sharedAt`/`sharedBy` son de cada uno; como mucho se cachea la procedencia por conjunto (D3, 1.7). |
| N2 | critic | aceptado | No hay cola: un fallo del reparto se descarta y se registra, y la pantalla se pone al día al recargar o al volver a la pestaña (D3). |
| N3 | critic | aceptado | Solo los autores de procedencia ocultos dejan de pedirse al directorio; `sharedBy` y comentarios siguen igual (D2, 1.3, 1.4). |
| N4 | critic | aceptado (a) | B4 acotado a `previewSources`; la excepción heredada de `group-comments` (quien salió sigue nombrado en `sharedBy` y comentarios) va a ADR-055 §Consecuencias. |
| N5 | critic | aceptado | `peersAmong` reutiliza `groupsOfUserStages` para lector y candidatos: las membresías huérfanas no cuentan (D2, 1.2a-ii). |
| N6 | critic | aceptado | Método nuevo en el puerto `GroupRepository` (Mongo y memoria); el conteo de comandos va en `mongo-group.repository.spec.ts` y la fachada delega (D2, 1.2a-i a 1.2a-iii). |
| N7 | critic | resuelto por G1 | `ready` no existe; los estados son `pending`, `enriched`, `partial`, `failed` y `manual` (D6). |
| N8 | critic | aceptado | `savedUnread` toma la instantánea más reciente por `previewVersion` entre las tres fuentes (D6, 5.3). |
| N9 | critic | aceptado | Antes de `show()` se mira también la señal `router.currentNavigation()` (path de `finalUrl ?? extractedUrl`; corregido en P1-C), y el aviso se cierra además en `NavigationEnd` (D8, 6.2). |
| N10 | critic | aceptado | Requirement de notifications reducido a lo verificable (subíndice dinámico); la clase es el sustituto aceptado de la geometría y sale el test de orden (D10, 3.1). |
| N11 | critic | aceptado | `grep` de `as VisibleAuthors` que solo admite `visible-authors.ts`; los specs construyen el tipo con `visibleAuthorsFor` (1.3). |
| N12 | critic | aceptado | El patrón de la 0.1 agrupa la alternativa Q1/Q7 dentro del paréntesis y exige dos coincidencias; hoy da 0 (0.1). |
| N13 | critic | aceptado | 1.8 añade a Dani, que comparte con Ana otro grupo y guarda la URL en privado: su `/mine` sí trae «Ana Quiroga». |

## Debate — iteración 3

Fecha: 2026-10-08. Participantes: `critic` (P1-*, P0 0), `business` (V0 0), reflect (sesión principal). Última
iteración. Q1 y Q7 siguen pendientes del owner.

| Id | Origen | Decisión | Motivo |
| --- | --- | --- | --- |
| P1-A | critic | aceptado | Se nombra el doble `InMemoryGroupMembership.peersAmong` (`links/application/testing/links-test-doubles.ts`), con contador de llamadas, y su caso en `links-test-doubles.spec.ts` (D2, 1.2a-iii). |
| P1-B | critic | aceptado | `latestSaved` es una señal acumulada que solo avanza con un `previewVersion` mayor; suscripción a `linkEnriched` antes de `store.save`, con los mensajes del guardado filtrados por id al llegar la respuesta; caso del link completado a mano que los filtros dejan fuera (D6, 5.3). |
| P1-C | critic | aceptado | `router.getCurrentNavigation()` pasa a la señal `router.currentNavigation()`, comparando el path de `finalUrl ?? extractedUrl` (D8.3, 6.2, N9). |
| P1-D | critic | aceptado | Una navegación cancelada también cierra el aviso; se acepta porque el desenlace es el de dejarlo ir (D8.2). |
| P1-E | critic | aceptado | El aviso se evalúa al cambiar el link o al pulsar; el paso del tiempo no lo reevalúa. El escenario de la lectura pendiente que ya no se espera parte de un link que llega ya caducado (D6, `web/links`). |
| P1-F | critic | aceptado | 1.2a partida en 1.2a-i (puerto de `groups` y memoria), 1.2a-ii (Mongo, replset, contador; falsación sin `$unwind`) y 1.2a-iii (fachada, puerto y adaptador de `links`, doble); 1.2b depende de 1.2a-iii; fuera el índice, que ya existe (`MEMBERSHIP_KEY`). |
| Textos EN | business | aceptado | `copyNotAJob` = «This does not look like a job offer: if you send it, the preview will be empty»; `copyFailedEmpty` = «This card doesn't have the job title yet: if you send it now, it will show an empty preview. Fill it in from the card first» (D6, 8.1). |
| Puntuación | business | aceptado | `copyNotAJob` y `copyFailedEmpty` sin punto final en ES y EN, como `copyUnread` (D6, specs, proposal, 8.1). |
| Ids | business | aceptado | `copyFailedEmpty` es un id nuevo, no uno que se conserva (D6, G2). |

Convergencia: SI (critic P0 0, business V0 0; Q1 y Q7 pendientes del owner)
