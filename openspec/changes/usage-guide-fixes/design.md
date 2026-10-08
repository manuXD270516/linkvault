## Context

La guía de uso del 2026-09-28 (`docs/guia-de-uso/README.md`, «Hallazgos») dejó siete defectos de producto, H1-H7. Este
design localiza cada uno en el código (lectura del 2026-10-08 sobre `origin/main`) y en la spec que lo gobierna, y
decide cómo corregirlo. El change es una **excepción a la precedencia de la fila 35** decidida por el owner el
2026-10-08 (ADR-055 §1); su alcance temporal es la pregunta Q1.

| Hallazgo | Código responsable | Spec vigente |
| --- | --- | --- |
| H1 | `apps/api/src/modules/links/application/link.mapper.ts` (`toResolvedPreviewSources`, `displayNameIdsOf`) y sus llamadas en nueve casos de uso; `apps/web/src/app/features/links/link-preview.ts` (`originText`, `latestPaste`) | `links/enrichment` «Preview con procedencia por campo» (exige el nombre a cualquier lector); `users/profile` «Consulta del perfil propio» (lo restringe a miembros de sus grupos) |
| H2 | `apps/web/src/app/features/notifications/notifications.page.html` (`mat-hint` de dos líneas en un `mat-form-field` con subíndice de alto fijo) | `web/notifications` «Preferencias en el perfil» |
| H3 | `apps/web/src/app/shared/ui/request-error.ts` (todo lo que no es `429`/sin conexión es «Algo salió mal») usado por la sección BYOK de `features/profile/profile.page.html` | `web/byok` «Gestión de claves en perfil»; `ai/byok` (el `503 vault_unavailable`) |
| H4 | `apps/web/src/app/features/links/save-link.form.ts` (`savedUnread` es una foto de la respuesta de guardar que nadie actualiza) | `web/links` «Guardar un link desde el SPA» |
| H5 | `save-link.form.ts` (`this.form.reset()` no limpia el `submitted` de `FormGroupDirective`; el `ErrorStateMatcher` por defecto pinta el campo vacío e inválido) | `web/links` «Guardar un link desde el SPA» |
| H6 | `apps/web/src/app/features/applications/share-invitation.ts` y `share-notice.component.ts` (el aviso vive en el `MatSnackBar` raíz, sin relación con la ruta) | `web/applications` «Invitación a compartir tras el gesto» |
| H7 | `<input type="date">` nativos en `features/links/edit-preview.dialog.html`, `features/links/reopen-expires.dialog.html` y `features/applications/applied-date-question.component.ts` (el formato lo decide el navegador, no `<html lang="es">`) | ninguna; se añade a `web/i18n` |

## Goals / Non-Goals

**Goals:** cumplir la promesa «no se verá el grupo ni tu nombre» y la regla de `users/profile` en **toda** respuesta
de la API que lleve procedencia; dejar los seis defectos de pantalla corregidos y cubiertos por un test que caería si
volvieran.

**Non-Goals:** H8-H17 (pruebas y configuración de la pila, ver proposal «Fuera de alcance»); rediseñar la procedencia
(ADR-010 sigue igual: qué se guarda no cambia, solo quién lo lee); publicar la interfaz en inglés (fila 37).

## Decisions

### D1. H1: el nombre del autor de un campo solo lo ve quien comparte grupo con él

**Regla.** Al leerse la procedencia, el autor de un campo `manual` o `pasted` (y el de su entrada `replaced`) se
resuelve a `{ userId, displayName }` **solo si** quien lee es el propio autor o comparte con él al menos un grupo en el
momento de la lectura. En cualquier otro caso la API devuelve `by: null`: ni nombre ni identificador.

**De dónde sale la regla (la promesa existente).** No se inventa una política nueva; se aplica la que ya está escrita
en tres sitios y que el código contradice:

1. `openspec/specs/users/profile/spec.md`, «Consulta del perfil propio»: «de otro usuario solo SHALL ser visible su
   `displayName`, y únicamente para los miembros de sus grupos (spec `groups/membership`). Ningún otro campo […] SHALL
   exponerse a terceros». El `userId` también es un campo: por eso `by: null` y no un nombre genérico con el id.
2. La interfaz, al guardar en un grupo que comparte en público: «Cualquiera con este enlace verá la oferta; no se verá
   el grupo ni tu nombre» (`apps/web/src/app/features/links/save-link.form.html:68`, exigido por `web/links` «Guardar
   un link desde el SPA»).
3. La confirmación de encender el enlace público: «No se verá el grupo, ni tu nombre, ni los comentarios»
   (`web/public-preview` «Interruptor del enlace público en la tarjeta del grupo»).

La página pública ya cumple (`links/public-share` «Qué no sale nunca en la página pública» excluye la procedencia).
Lo que falla es lo que pasa **después**: quien guarda desde el enlace público recibe el `JobLink` canónico, cuya
procedencia es compartida por todos los que tienen esa vacante, y la API le resuelve el nombre de Ana. Y no solo a
él: cualquiera que guarde la misma URL por su cuenta (dedupe de ADR-008) también lo ve.

**Qué se muestra en vez del nombre.** Se conserva el **tipo** de origen, que es lo que da valor a la procedencia
(`link-preview.ts`: «"Escrito por Ana" es una persona que se hace responsable. Confundirlos es lo que convierte un
salario inventado en un salario creído»), y se sustituye solo la persona:

| Origen | Con autor visible | Con autor oculto (`by: null`) |
| --- | --- | --- |
| `manual` | «Escrito por Ana» | **«Escrito por otra persona»** / EN «Written by someone else» |
| `pasted` | «Descripción pegada por Beto» | **«Descripción pegada por otra persona»** / EN «Description pasted by someone else» |
| deshacer pegado | «Deshacer lo que pegó Beto» | **«Deshacer lo que pegó otra persona»** / EN «Undo what someone else pasted» |

«Otra persona» es exacto: el lector nunca es un autor oculto (uno mismo siempre es visible).

**Alternativas descartadas.**
- *Ocultar solo en la lista privada.* Bob, que guarda por su cuenta una URL que Ana editó en un grupo de Bob, sí
  comparte grupo con Ana; y Carla, que la tiene en un grupo suyo donde Ana no está, no. La regla es de personas, no de
  pantallas: la lista privada no la resuelve.
- *Nombre solo para quien comparte un grupo **que contenga ese link*** (más estricta). Evitaría que Bob, que comparte
  con Ana el grupo G2, sepa que Ana corrigió una oferta que solo está en G1. Requiere cruzar `group_links` × membresías
  por página y no la exige ninguna spec ni promesa vigente. Queda como **Q3** (no bloqueante).
- *Nombre genérico con el `userId`* («Usuario», como el respaldo `UNKNOWN_SHARER_NAME`): sigue exponiendo un
  identificador estable entre contextos, que `users/profile` no permite.
- *Copiar la procedencia al guardar desde el enlace público.* El preview es canónico por diseño (ADR-010, ADR-008);
  bifurcarlo rompe las correcciones compartidas y no arregla el caso de quien guarda la URL por su cuenta.

### D2. H1: una sola regla, en el mapeo único, con parámetro obligatorio

Los nombres se resuelven hoy en nueve casos de uso (`list-my-links`, `list-group-links`, `save-link`, `import-links`,
`paste-description`, `update-link-preview`, `reopen-job-link`, `request-link-enrichment`, `deliver-link-enriched`),
todos con el mismo patrón: `displayNameIdsOf(links)` → `directory.displayNamesOf(ids)` → `toJobLinkSummary(link,
{ names })`. Se corrige en el punto común:

- `toJobLinkSummary` / `toResolvedPreviewSources` reciben `visibleAuthorIds: ReadonlySet<string>` como campo
  **obligatorio** del contexto (`SummaryContext`). Un autor fuera del conjunto sale `by: null`. Al ser obligatorio, el
  compilador señala cada llamada; no hay valor por defecto que «olvide» filtrar. **Falla cerrado:** un conjunto vacío
  oculta a todos los autores.
- Un ayudante de aplicación, `visibleAuthorIdsFor(viewerId, candidateIds)` en `links/application`, calcula el
  conjunto con los puertos que ya existen: `GroupMembership.groupsOf(viewerId)` y `memberIdsOf(groupIds)`, más el
  propio lector. Dos consultas por petición, ninguna por campo ni por link.
- Los nombres de `sharedBy` y de los comentarios **no cambian**: solo salen en el listado de un grupo, donde quien lee
  es miembro por definición (`links/sharing`, `links/group-comments`).

### D3. H1: en los avisos en tiempo real, por destinatario

`DeliverLinkEnriched` compone **un** resumen y lo manda a todos los que ven el link (miembros de sus grupos y quienes
lo guardaron en privado). Con D1, el resumen depende de quién lo recibe. Se calcula, **por autor** del link (pocos:
quien escribió o pegó algún campo), el conjunto de personas con quien comparte grupo (`groupsOf(autor)` +
`memberIdsOf`), una vez por aviso; para cada destinatario, `visibleAuthorIds` es el de los autores cuyo conjunto lo
contiene (o que son él). Coste añadido por aviso: dos consultas por autor distinto. Se acepta: el reparto ya hace una
consulta por grupo y no ocurre cuando nadie escucha.

### D4. H1: contrato — autor anulable en la lectura, nunca en lo guardado

- `libs/shared/src/schemas/preview.schema.ts`: la procedencia **resuelta** (`previewSourcesSchemaWith(previewAuthorSchema)`)
  pasa a `previewAuthorSchema.nullable()`, también en `replaced`. La procedencia **guardada** (`previewAuthorIdSchema`)
  no cambia: el worker y la base de datos siguen guardando el autor.
- SPA: `PreviewFieldOrigin` admite `by: PreviewAuthor | null`; `originText` y el texto de deshacer usan las cadenas de
  D1 cuando es `null`. `latestPaste` agrupa los campos de un mismo pegado por `at` y por «mismo autor», donde dos
  `null` cuentan como el mismo autor. Riesgo aceptado: dos pegados de dos autores ocultos con el mismo `at` al
  milisegundo se ofrecerían deshacer juntos; deshacer devuelve cada campo a lo anterior, así que no se pierde nada que
  no se pueda rehacer.

### D5. H2: el subíndice del selector crece con su texto

El `mat-form-field` de «Grupo para avisos de estado» lleva `subscriptSizing="dynamic"`: el alto del subíndice pasa a
ser el de su contenido, y lo que viene detrás («Preferencias guardadas», el error, el botón) baja en vez de quedar
debajo. Se descarta acortar el texto (la explicación es necesaria y en inglés es más larga) y sacar la ayuda del campo
a un párrafo (pierde la asociación `aria-describedby` que da `mat-hint`).

### D6. H3: la bóveda ausente se dice como tal

En la sección «Tus claves de IA», un `503` con código `vault_unavailable` al guardar muestra **«Las claves propias no
están disponibles en esta instancia ahora mismo. Tu clave no se ha guardado.»** (EN «Your own AI keys aren't available
on this instance right now. Your key wasn't saved.») en lugar del genérico, y **vacía el campo de la clave**: no hay
reintento útil a corto plazo y no se deja un secreto en el DOM. Cualquier otro error sigue por `lv-request-error`. Se
resuelve en el perfil (que ya distingue errores propios antes de delegar, como hace el cambio de contraseña), no en
`RequestError`, que es común a todo el SPA. Saber la disponibilidad de la bóveda **antes** de escribir la clave
requeriría cambiar `GET /api/users/me/ai-keys` (`ai/byok`): es la **Q4**, no entra.

### D7. H4: el aviso de lectura sale del estado actual del link

`savedUnread` deja de ser una señal escrita una vez y pasa a ser un `computed` sobre el link recién guardado **tal como
está en `LinksStore`** (el mismo dato que actualizan los avisos en tiempo real y que usa la tarjeta para su propio
«Copiar enlace», `link-list.component.ts`): visible solo mientras su `previewStatus` sea `pending`. Si el link no está
en la lista cargada (filtrado), se usa el último estado conocido, el de la respuesta. Se mantiene la regla de la spec
(«cuando la oferta todavía no se ha leído»); lo que cambia es que «todavía» se evalúa ahora, no al guardar. Qué decir
de una oferta que terminó en `failed` sin datos es la **Q6**.

### D8. H5: reiniciar el formulario entero, también su envío

Tras un guardado correcto se reinicia con `FormGroupDirective.resetForm()` (vía `viewChild`) en lugar de
`FormGroup.reset()`: además de los valores limpia `submitted`, que es lo que el `ErrorStateMatcher` por defecto mira para
pintar un campo vacío como error. Con `invalid_url` el campo **conserva** lo escrito, como hoy. Se descarta un
`ErrorStateMatcher` propio: arreglaría el síntoma en un campo y dejaría el formulario en un estado «enviado» falso.

### D9. H6: el aviso pertenece a la página del grupo

1. **Primero se reproduce.** El aviso «Compartido · Deshacer» siguió visible en capturas tomadas muy por encima de
   10 s después (037 a 046 incluyen subir y leer un CV), sin que la causa esté clara en la lectura del código
   (`ShareNotice` programa el cierre a los 10 s si el foco no está dentro). La tarea 6.1 lo reproduce con temporizadores
   simulados, en los dos tipos de aviso, antes de cambiar nada; si el cierre a los 10 s no ocurre, se corrige esa causa.
2. **Al salir de la página, se cierra.** `ShareInvitation` cierra el aviso abierto en cuanto el router empieza una
   navegación que abandona la ruta donde se abrió (`/grupos/:id`). El desenlace es el mismo que si se hubiera dejado
   ir: la invitación sin pulsar deja la postulación **privada**, y «Compartido» sin pulsar «Deshacer» la deja
   **compartida**; «Deshacer» sigue disponible en el interruptor del panel de la postulación. La regla de «no antes de
   10 s ni con el foco dentro» sigue rigiendo mientras la persona está en la página: salir es una acción explícita.

Se descarta darle duración fija al aviso (rompe la regla de accesibilidad de 10 s con foco, business 4 de
`applications-tracking`) y anclarlo dentro de la tarjeta (cambia el patrón de aviso del SPA para un solo caso).

### D10. H7: selector de fecha con el formato del idioma de la interfaz

El formato de `<input type="date">` lo decide el navegador (en Chromium, su idioma de interfaz); `<html lang="es">` no
lo cambia. Los tres campos de fecha del SPA pasan a `matDatepicker` con un adaptador propio, `LocaleDateAdapter`
(`apps/web/src/app/core/dates/`), que extiende `NativeDateAdapter`:

- se provee una vez en `app.config.ts` con `MAT_DATE_LOCALE` = `LOCALE_ID`;
- muestra `dd/mm/aaaa` en `es` y `mm/dd/yyyy` en `en`, con `Intl.DateTimeFormat` del locale;
- **interpreta** lo tecleado con ese mismo orden (estricto: día, mes y año de cuatro cifras; un día que no existe es
  inválido) y acepta también `AAAA-MM-DD`;
- en el borde del formulario, dos funciones puras convierten `Date` ↔ `YYYY-MM-DD` con los componentes **locales**
  (nunca `toISOString()`, que mueve el día en zonas al oeste de UTC). `appliedAt` sigue enviándose como la medianoche
  local en ISO, como exige `web/applications` «Pregunta por la fecha de postulación»; `expiresAt` sigue siendo de solo
  fecha (ADR-041).
- Placeholder «dd/mm/aaaa» (EN «mm/dd/yyyy»); el tope de fecha («no admite días futuros») pasa a `[max]` del datepicker.

Descartadas: dejar el control nativo y documentarlo (H7 está en el alcance obligatorio y el usuario no controla el
idioma del navegador); añadir `@angular/material-date-fns-adapter` o Luxon (dependencia nueva para tres campos).

### D11. Textos e i18n

Cada texto nuevo lleva id `@@…` explícito, ES por defecto en la plantilla o en `$localize`, y su traducción en
`apps/web/src/locale/messages.en.xlf`. `messages.xlf` se regenera con `pnpm nx run web:extract-i18n` en el mismo
commit, nunca a mano, y `pnpm nx run web:i18n-check` tiene que pasar (ADR-050). Ids nuevos: `links.origin.pastedHidden`,
`links.origin.manualHidden`, `links.paste.undoHidden`, `profile.byok.vaultUnavailable`, `dates.placeholder`.

## Risks / Trade-offs

- **[Riesgo] Un caso de uso que construya resúmenes fuera de `toJobLinkSummary`.** → D2 hace obligatorio el conjunto
  visible y la tarea 1.3 busca con `grep` cualquier otra construcción de `previewSources` resuelto; el test de integración
  de 1.8 recorre todas las rutas que devuelven links.
- **[Trade-off] Un autor que sale de los grupos que compartía con alguien pasa a «otra persona» en sus tarjetas.** Es
  la regla de `users/profile` aplicada en el tiempo, y coincide con lo que ya pasa con su nombre en la lista de miembros.
- **[Riesgo] Coste de D3 en grupos grandes.** Dos consultas por autor distinto y aviso; los autores por link son pocos.
  Si se mide un problema, se cachea por aviso, no se relaja la regla.
- **[Riesgo] El adaptador de fechas y las zonas horarias.** → Vitest del adaptador con `TZ` al oeste y al este de UTC
  (tarea 7.1).
- **[Riesgo] H6 puede tener una causa distinta a la supuesta.** → D9.1: se reproduce antes de corregir.
- **[Riesgo] Conflictos con 35b.** Ningún delta de este change toca `platform/*`; el código de `apps/web` que 35b
  cambia (textos de verificación de correo, su tarea 7.13) no se solapa con estos ficheros, **salvo el catálogo**:
  los dos añaden ids a `messages.xlf` y `messages.en.xlf`. El de `messages.xlf` se resuelve re-extrayendo (ADR-050);
  el de `messages.en.xlf`, conservando las unidades de los dos. Se comprueba con `git diff --stat` contra la rama de
  35b antes del PR (tarea 9.3).

## Migration Plan

Sin migración de datos. El contrato cambia de forma compatible para el SPA si API y SPA salen en el mismo despliegue
(un solo artefacto). Vuelta atrás: revertir el PR.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`]. Alcance temporal de la excepción del 2026-10-08.** «Abramos el change» decide
  abrirlo; no dice si puede aplicarse y fusionarse antes de que termine la fila 35.
  - (a) Abrir, debatir, aplicar y fusionar ya, **antes de invitar en 35b**, en paralelo a 35b como `e2e-suite`.
  - (b) Abrir y debatir ahora; aplicar y fusionar al terminar 35c.
  - (c) Aplicar ahora solo H1 (privacidad) y dejar H2-H7 para después de 35c.
  - **Recomendación: (a).** H1 rompe una promesa de privacidad a exactamente las personas que 35b va a invitar; el
    resto son defectos que esas personas verían el primer día. El change no toca nada de lo que 35b y 35c modifican.
- **Q2 [no bloqueante]. ¿Incluir el selector «Grupo para avisos de estado» que aparece vacío?** En la captura 076,
  con «Todos mis grupos (unión del link)» elegido (`null`), el campo se ve vacío: `mat-option` con valor `null` es la
  opción de reinicio de Angular Material y no se pinta. No figura entre H1-H17. Opciones: (a) incluirlo aquí —un valor
  centinela en el formulario, traducido a `null` al guardar, con su escenario en «Preferencias en el perfil»—; (b)
  dejarlo para otro change. **Recomendación: (a)**, es el mismo campo que H2, mismo tipo de defecto y < 1 h.
- **Q3 [no bloqueante]. ¿Regla de D1 o la estricta?** (a) Nombre visible si se comparte **cualquier** grupo (la de
  `users/profile`); (b) solo si se comparte un grupo **que contenga ese link**. **Recomendación: (a)**: es la regla
  escrita, cumple la promesa de la interfaz y cierra H1; (b) puede venir después sin cambiar el contrato.
- **Q4 [no bloqueante]. ¿Avisar de la bóveda ausente antes de escribir la clave?** Exigiría que `GET
  /api/users/me/ai-keys` dijera si hay bóveda (MODIFIED de `ai/byok`). **Recomendación: no**: en producción la bóveda
  es obligatoria y el caso solo existe en entornos de prueba; D6 basta.
- **Q5 [no bloqueante]. Copia de H1.** ¿«Escrito por otra persona» o una alternativa («Escrito a mano», «Escrito por
  alguien de otro grupo»)? **Recomendación:** «Escrito por otra persona»: mantiene la forma «… por <quién>» de los
  otros orígenes y no afirma nada sobre grupos que el lector no puede comprobar.
- **Q6 [no bloqueante]. ¿Qué dice el formulario de una oferta publicada que terminó en `failed` sin datos?** Hoy (y
  tras D7) no dice nada. Opciones: (a) nada; (b) «No pudimos leer la oferta: si lo envías, la tarjeta saldrá sin datos
  hasta que alguien la complete». **Recomendación: (a)** en este change: la tarjeta ya ofrece «Completar a mano», y un
  texto nuevo sobre el enlace público merece pasar por el debate de producto.
