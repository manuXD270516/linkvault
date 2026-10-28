## Context

El SPA autenticado se enmarca en `Shell` (`apps/web/src/app/layout/shell/`): una `mat-toolbar` con la marca
(«LinkVault», que lleva a `/grupos`, `HOME_ROUTE`), seis enlaces fijos —Buscar, Descubrir, Postulaciones, Solo para
mí, Mi CV, Perfil— y «Cerrar sesión». No hay entrada «Grupos»: el inicio es la marca. Desde `e2e-suite` (5.4b) la
barra hace `flex-wrap` para que en un móvil nada quede tapado; en un Pixel 7 eso son tres filas
(`docs/guia-de-uso/img/088-movil-grupos.png`).

Tres funciones dependen de la configuración del proceso `api` y hoy el SPA no lo sabe hasta que falla:

| Función | Condición en la API | Lo que ve hoy quien la usa apagada |
|---|---|---|
| Búsqueda (`/buscar`) | `FEATURE_SEARCH=true` (por defecto `false`) y `MEILI_HOST` no vacío; si no, `GET /api/search` → `503 search_unavailable` | «La búsqueda no está disponible en este momento. Inténtalo más tarde.» tras enviar la consulta |
| Descubrir (`/descubrir`) | `FEATURE_DISCOVERY=true` (por defecto `false`); si no, `503 discovery_disabled` | «El descubrimiento de vacantes no está disponible en este momento.» tras buscar |
| Push | `VAPID_PUBLIC_KEY` no vacía; si no, `GET /api/notifications/push-vapid-public-key` → `503` | «El push no está disponible ahora.» tras pulsar «Activar push» |

`docker-compose.prod.yml` (el de staging) no pasa `FEATURE_SEARCH`, `MEILI_*`, `FEATURE_DISCOVERY` ni `VAPID_*`: en
staging las tres están apagadas, y así seguirán (D13 de `staging-host`). `apps/web-e2e/e2e.env` también las apaga, de
modo que el camino crítico (`@lot1`) corre en las mismas condiciones que staging.

Lo que se mide en 35b (D15 de `staging-host`): *activación* = primer link guardado en menos de 48 h desde el alta. Las
personas invitadas entran por el enlace de invitación de un grupo y caen en su detalle, donde está el formulario de
guardar; o en `/grupos`. Lo que importa de la barra para esa métrica es que no empuje ese contenido fuera de la
pantalla y que no ofrezca primero entradas rotas.

## Goals / Non-Goals

**Goals:**
- Que ninguna entrada de la barra lleve a una función que el despliegue no tiene.
- Que quien llegue por un enlace directo a una función apagada lea la verdad («no está activada en este entorno») y
  tenga adónde ir, sin un formulario que no puede funcionar.
- Que en el móvil la barra ocupe una fila.
- Un contrato de capacidades que no filtre configuración y que pueda crecer sin romper SPAs ya cargados.

**Non-Goals:**
- Salud en vivo de Meilisearch o de las bolsas: una avería transitoria sigue cayendo en el `503` honesto de cada página.
- Capacidades por usuario (consentimiento, BYOK, cuota). El contrato es global al despliegue en esta versión.
- Activar nada en staging; selector de idioma (fila 37); atajo global «Guardar link» (Q3).

## Decisions

### D1. `GET /api/capabilities`, con sesión, contrato en `libs/shared`

Ruta nueva `GET /api/capabilities` protegida por el guard global de access token (sin `@Public()`), que responde
`200` con `{ search: boolean, discovery: boolean, push: boolean }`. Contrato `capabilitiesResponseSchema` en
`libs/shared/src/schemas/capabilities.schema.ts`, exportado desde el índice. El controlador vive en
`apps/api/src/presentation/http/` junto a `health` y `metrics`: no es un bounded context, solo lee `APP_CONFIG`, y no
importa ningún módulo de dominio (así no acopla `search`, `discovery` ni `notifications` entre sí).

*Alternativas descartadas:*
- **Público.** No hay ningún consumidor sin sesión (la barra solo existe con sesión), y exponerlo sin sesión le
  cuenta a cualquiera qué tiene activado el despliegue. Con sesión deja además la puerta abierta a capacidades por
  usuario sin cambiar la ruta.
- **Dentro de la respuesta de sesión** (`SessionResponse` de login/refresh). Acopla `auth` a banderas de otros
  módulos, cambia un contrato que también usa la extensión (`/api/auth/extension/*`) y obliga a rehacer el refresh
  para enterarse de un cambio.
- **Variables en el build del SPA.** La misma imagen web sirve staging y producción (ADR-033/ADR-048); las banderas
  son de tiempo de ejecución de la API.
- **En `/health`.** Es pública, de infraestructura, y su contrato dice explícitamente que no lleva detalles.

### D2. Cada capacidad dice qué está configurado, no si responde ahora

Una función pura `deriveCapabilities(config: ApiConfig): CapabilitiesResponse` (en
`apps/api/src/infrastructure/config/capabilities.ts`) es la única definición:

- `search` = `FEATURE_SEARCH === true` **y** `MEILI_HOST` no vacío. Con la bandera encendida y sin host la búsqueda no
  puede funcionar; decir `true` sería mentir.
- `discovery` = `FEATURE_DISCOVERY === true`. `DISCOVERY_CHAIN=mock` cuenta como activo (es lo que usa la CI).
- `push` = `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` no vacíos tras `trim()` (las tres que lee
  `vapidFromConfig` de `notifications.module.ts`). Es más estricto que el `GET` de la clave pública, que solo mira la
  pública: sin la privada la suscripción se guardaría y nunca llegaría un aviso.

Una avería transitoria (Meilisearch caído, una bolsa que no responde) no cambia la capacidad: la página sigue
mostrando su `503` de «en este momento», que en ese caso sí es verdad.

*Descartado:* sondear Meilisearch o las bolsas en cada petición o con un temporizador. Encarece la ruta, hace que la
barra parpadee con cada intermitencia y duplicaría el `503` que ya existe.

### D3. Solo booleanos, y un guardia que lo comprueba

La respuesta se construye con el schema **estricto** (`.strict()`) y el test del controlador comprueba que las claves
son exactamente `search`, `discovery` y `push`, y que los tres valores son booleanos. Así no puede colarse un host,
una clave, un nombre de proveedor ni un modelo. Falsación: añadir `meiliHost: config.MEILI_HOST` a la respuesta y ver
caer el test; restaurar.

### D4. Caché: inmutable por proceso en la API, una petición por carga en el SPA, contrato aditivo

- **API.** La configuración no cambia sin reiniciar el proceso, así que el objeto se calcula una vez (en el
  constructor del controlador) y se sirve con `Cache-Control: private, max-age=300`: el navegador puede reutilizarlo
  al recargar durante cinco minutos; ningún intermediario lo guarda.
- **SPA.** `CapabilitiesStore` (`providedIn: 'root'`, signals) hace **una** petición por carga de la aplicación y
  reparte la misma promesa a quien llame mientras está en vuelo (la barra y una página abierta por enlace directo
  piden a la vez). No se borra al cerrar sesión: no depende del usuario.
- **Aditivo.** El SPA parsea la respuesta con el schema **no estricto** (zod por defecto descarta claves
  desconocidas), de modo que añadir una capacidad nueva en la API no rompe un SPA ya cargado. Quitar o renombrar una
  sí sería un cambio incompatible y necesitaría su propio change.

*Riesgo aceptado:* tras cambiar una bandera y redesplegar, una pestaña abierta conserva lo que sabía hasta recargar.
Un despliegue ya implica recargar para recibir el SPA nuevo.

### D5. Estados del store: desconocido oculta, fallo abre

| Estado | Entradas condicionales | Enlace directo a la página |
|---|---|---|
| `loading` (aún no responde) | ocultas | la página se comporta como hoy |
| `ready` | según cada booleano | si es `false`, estado «no activada» (D7) |
| `failed` (red, 5xx, respuesta que no valida) | visibles, como hoy | se comporta como hoy |

Ocultar mientras carga evita mostrar «Buscar» y quitarlo un instante después (lo peor para quien ya iba a pulsarlo).
Fallar abierto vuelve exactamente al comportamiento actual, que ya tiene un `503` honesto en cada página: esto es
navegación, no un control de acceso, y la API sigue respondiendo `503` a una función apagada. El fallo no se reintenta
hasta la siguiente carga.

### D6. En la barra, ocultar; no deshabilitar

Una entrada apagada **no aparece**. *Descartado:* mostrarla deshabilitada con un tooltip «No disponible en este
entorno»: en táctil no hay tooltip, una entrada gris invita a pulsarla y no explica nada, y es ruido en la barra
compacta. La explicación vive donde alguien llega sin pasar por la barra: la propia página (D7).

### D7. Enlace directo a una función apagada: la página carga y lo dice

Con la capacidad en `false`, `/buscar` y `/descubrir` **no redirigen**: la ruta carga y la página, en lugar del
formulario, muestra un estado con `role="status"`:

- búsqueda: «La búsqueda no está activada en este entorno.» y un enlace «Ver Solo para mí» a `/mis-links`;
- Descubrir: «Descubrir vacantes no está activado en este entorno. Puedes guardar una oferta pegando su enlace en Solo
  para mí o en un grupo.» y el mismo enlace.

La página no llama a `GET /api/search` ni a `GET /api/discovery/search` (sí puede cargar lo que ya cargaba al construirse,
como los grupos). Mientras el store está en `loading` o `failed`, la página es la de hoy y su `503` sigue valiendo. Las
frases de «en este momento» se quedan para el `503` transitorio.

*Descartado:* un `canActivate` que redirige a `/grupos`. La persona pierde lo que buscaba sin saber por qué, y el
guard tendría que esperar a la petición de capacidades antes de resolver la navegación (un enlace directo en frío
tardaría más). *Descartado:* una página 404; no existe (la ruta `**` redirige al inicio) y una función apagada no es
una dirección inexistente.

### D8. Modo compacto: una fila con la marca y «Menú», que despliega un `<nav>`

Por debajo de **1024 px** de ancho la barra muestra una sola fila: la marca a la izquierda y, a la derecha, un botón
de texto «Menú» (`aria-expanded`, `aria-controls`). Al pulsarlo se despliega **debajo de la barra, empujando el
contenido** (no superpuesto), un `<nav aria-label="Navegación principal">` con una lista de enlaces y «Cerrar sesión»
al final. Se cierra al terminar una navegación (`NavigationEnd`), con Escape (devolviendo el foco al botón) y al volver
a pulsar el botón. Por encima de 1024 px, la barra de siempre, con el `flex-wrap` de 5.4b como red de seguridad.

El modo se decide con `BreakpointObserver` de `@angular/cdk/layout` (ya usado en `comments.dialog.ts`) convertido en
signal, y no con una media query de CSS, porque así los specs de componente pueden fijarlo con un doble y comprobar el
DOM de cada modo (jsdom no evalúa media queries).

El umbral sale de la barra ancha: marca + siete entradas + «Cerrar sesión» en texto no caben en una fila por debajo de
~1000 px. Se verifica con capturas a 1024 y a 1280 px (tarea 3.6).

*Alternativas descartadas:*
- **`mat-menu`.** Pone `role="menu"`/`menuitem` a enlaces de navegación: un lector de pantalla anuncia un menú de
  aplicación y cambia el modo de teclado, y las pruebas que buscan `link` dejarían de encontrarlos.
- **`mat-sidenav`.** Obliga a envolver todo el layout en un contenedor de sidenav, que cambia el scroll de todas las
  páginas y lo que miden sus pruebas, para un panel de ocho enlaces.
- **Barra inferior de pestañas.** No hay set de iconos en el proyecto (ni `mat-icon` ni fuente), caben cinco
  destinos, y una barra fija abajo compite con el snackbar «Compartido · Deshacer» y con el teclado del móvil.
- **Una fila con scroll horizontal.** Las entradas que no se ven no se descubren.
- **Mantener el `flex-wrap` reordenando.** Siguen siendo dos o tres filas.

### D9. Una sola lista de entradas, con «Grupos» y en este orden

`NAV_ENTRIES` (en `layout/shell/nav-entries.ts`) es la única fuente de las dos presentaciones: ruta, texto i18n y
capacidad requerida (opcional). Orden: **Grupos** (`/grupos`), **Solo para mí**, **Postulaciones**, **Mi CV**,
**Buscar** (`search`), **Descubrir** (`discovery`), **Perfil**; «Cerrar sesión» queda fuera de la lista, al final.

- «Grupos» es nueva. En la barra ancha la marca ya lleva al inicio, pero en el panel compacto la marca queda fuera y
  «volver a mis grupos» tiene que ser una entrada explícita; con una sola lista, aparece en los dos modos.
- Lo que lleva a guardar y seguir ofertas va primero; las funciones opcionales, después. Hoy «Buscar» es lo primero.
- Una sola lista evita que los dos modos diverjan y es el sitio único donde `web-english-locale` pondrá el selector.

### D10. Lo que esto cambia para la activación de 35b

La barra pasa de tres filas a una (~56-64 px) en el móvil, de modo que lo primero visible en `/grupos` y en el detalle
del grupo es su contenido (crear o unirse; el formulario de guardar). No se añade un atajo global «Guardar link»: el
formulario ya está en el detalle del grupo, donde aterriza quien acepta una invitación, y en «Solo para mí»; añadirlo
antes de tener los datos del día 7 sería adivinar (Q3).

### D11. Push apagado: «Activar push» deshabilitado con su explicación

En Notificaciones, con `push === false`, «Activar push» se muestra **deshabilitado** y debajo, con `role="status"`,
«Las notificaciones push no están activadas en este entorno. Los avisos por email siguen activos.», sin pedir permiso
al navegador ni la clave VAPID. Aquí se deshabilita y no se oculta (al revés que D6) porque la sección explica el push
en su propio contexto y desaparecer dejaría a la persona preguntándose dónde estaba. Si ya hay una suscripción en el
dispositivo, «Desactivar push» sigue funcionando. Con `loading` o `failed`, como hoy.

### D12. Textos ES/EN según ADR-050

Unidades nuevas, con id explícito: `shell.groups`, `shell.menu`, `shell.navLabel`, `search.notEnabled`,
`search.notEnabled.myLinks`, `discovery.notEnabled`, `discovery.notEnabled.myLinks`, `notifications.push.notEnabled`.
`messages.xlf` se regenera con `pnpm nx run web:extract-i18n`; las traducciones van en `messages.en.xlf`; lo comprueba
`pnpm nx run web:i18n-check`. Textos ingleses propuestos: «Groups», «Menu», «Main navigation», «Search isn't enabled
in this environment.», «Go to Just for me», «Job discovery isn't enabled in this environment. You can save a job by
pasting its link in Just for me or in a group.», «Push notifications aren't enabled in this environment. Email
notifications are still on.» (el texto inglés de «Solo para mí» se toma del catálogo vigente, no se inventa).

### D13. Verificación: specs de componente, integración de la API y el camino crítico re-admitido

Solo `critical-path.spec.ts` lleva `@lot1`, y un spec sin esa etiqueta no cuenta como verificación (ADR-053;
`apps/web-e2e/README.md`; D10 de `usage-guide-fixes`). Por eso:

- **Web:** specs de componente en `TestBed` con Angular Material real, `HttpTestingController` y un doble de
  `BreakpointObserver` que fija el modo. Cubren cada fila de D5, D6, D7, D8 y D11.
- **API:** test unitario de `deriveCapabilities` (una fila por caso de D2) y test de la app Nest con el guard real:
  `401` sin token, `200` con token, cuerpo exacto (D3) y `Cache-Control`.
- **Camino crítico:** el recorrido navega hoy con `getByRole('link', { name: 'Postulaciones' | 'Mi CV' | 'LinkVault' })`;
  en el proyecto `mobile` (Pixel 7, 412 px) esos enlaces pasan al panel. Un ayudante `navigateByShell(page, name)` en
  `apps/web-e2e/src/support/` pulsa «Menú» si está visible y luego el enlace (en los dos modos el rol sigue siendo
  `link`). Además, en el paso de abrir Postulaciones, el recorrido captura la respuesta de `GET /api/capabilities`
  que recibe el propio SPA (`page.waitForResponse`, armado antes de cargar) y afirma que «Buscar» y «Descubrir»
  aparecen en la barra o en el panel **si y solo si** su capacidad es `true`. No añade un paso declarado ni cambia el
  requirement de `e2e-suite`: es una afirmación dentro de un paso existente, y vale en `local` y en `remote` porque
  compara contra lo que el destino declara, no contra un valor fijo. No usa Mongo, Redis ni Mailpit: sigue siendo
  `@remote-safe`.
- **Re-admisión:** al cambiar un spec admitido, se repite la admisión con carga de `apps/web-e2e/README.md` (cinco de
  cinco, una invocación por proyecto y perfil, pila nueva) y se anota con fecha en «Admisiones».
- Las pruebas antiguas sin `@lot1` que pulsan la barra (`byok`, `deploy-prod`, `match`, `auth`, `cv`, `links`) corren
  en escritorio, donde la barra conserva enlaces con el mismo nombre; si alguna se rompe, se anota como evidencia
  informativa, no bloquea.

### D14. Fase: excepción ∥ 35b, pendiente del owner

Ver «Fase y excepción a la fila 35» en `proposal.md` y ADR-059 §1. Condiciones de diseño (si el debate las rompe,
vuelve al owner): no cambia el orden 35b → 35c; no toca composes, workflows ni variables de entorno; no modifica
requirements de `platform/ci-pipeline`, `platform/email` ni `platform/production-deploy`. Decisión del owner: **Q1**.

## Risks / Trade-offs

- **[Riesgo] La capacidad dice `true` y la función falla igual** (Meilisearch caído, el `worker` sin las claves VAPID
  que sí tiene la API). → D2 lo acepta: la página conserva su `503` honesto; la diferencia de claves entre `api` y
  `worker` la evita el compose, que pasa las mismas variables a los dos.
- **[Riesgo] Fallar abierto vuelve a mostrar entradas rotas si la petición de capacidades falla.** → Es el
  comportamiento de hoy, no uno peor; un fallo de esa petición casi siempre es la API caída, y entonces nada funciona.
- **[Riesgo] Romper el camino crítico en `mobile`** justo antes de invitar, cuando la 9.4 de `e2e-suite` es
  precondición. → El cambio de barra y el del recorrido van en el mismo PR y la re-admisión es tarea de cierre
  (grupo 5).
- **[Trade-off] Una pestaña abierta no se entera de una bandera nueva hasta recargar** (D4).
- **[Trade-off] El umbral de 1024 px manda al modo compacto a tabletas en vertical** que quizá cabrían en dos filas.
  Una fila con menú es aceptable allí, y es un único número a ajustar.
- **[Riesgo] Accesibilidad del panel.** → Botón con `aria-expanded`/`aria-controls`, `<nav>` con `aria-label`, Escape
  devuelve el foco al botón; los specs lo comprueban (3.3, 3.4).

## Migration Plan

Sin datos ni configuración que migrar. Orden de despliegue indiferente: un SPA viejo no llama a la ruta nueva; un SPA
nuevo contra una API vieja recibe `404` en `GET /api/capabilities`, cae en `failed` y se comporta como hoy (D5).
Rollback: revertir el PR.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] ¿Excepción a la precedencia de la fila 35?**
  (a) Sí: se aplica y se fusiona antes de invitar en 35b (antes de su 6.3, o repitiendo su 10.7 y la 9.4 de
  `e2e-suite` tras fusionar), con las condiciones de D14. (b) No: el change espera a archivar 35c y entra como fila
  propia. (c) Sí, pero solo capacidades y ocultar entradas (sin la barra compacta, tareas 3.3-3.6 y 6.1), y la barra
  compacta después de 35c.
  **Recomendación: (a).** Las personas invitadas entran por el móvil, y la activación que mide 35b depende de lo que
  ven primero; (c) deja la barra de tres filas justo durante la medición. La respuesta se anota en ADR-059 §1 en una
  línea que empiece por «Respuesta del owner (Q1), AAAA-MM-DD:».
- **Q2 [no bloqueante] ¿Añadir `externalAi` y `byokVault` al contrato?** (a) No en esta versión; se añaden cuando
  haya un consumidor, sin romper el contrato (D4). (b) Sí, ya. **Recomendación: (a).** Ninguna pantalla los usaría
  hoy: la bóveda BYOK es obligatoria en producción (H3 vive en `e2e-suite-lot-2` solo por las pilas de prueba) y el
  permiso de IA externa ya lo gestiona el perfil.
- **Q3 [no bloqueante] ¿Atajo global «Guardar link» en la barra compacta?** (a) No hasta ver los datos del día 7 de
  35b. (b) Sí, en esta versión. **Recomendación: (a)** (D10).
- **Q4 [no bloqueante] ¿Se toca el aviso de invitación de 35b** («la búsqueda no está disponible»)? (a) No: sigue
  siendo cierto y ahora la interfaz es coherente con él. (b) Quitar la línea. **Recomendación: (a).** Es un artefacto
  de `staging-host`; este change no lo edita.
