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

Este change trata las dos primeras; el push queda fuera (iteración 1 del debate, B2): no está en la barra, su
defecto se ve en una sección secundaria de Notificaciones y el contrato admite sumarlo después sin romperse (D4).

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
- Que quien llegue por un enlace directo a una función apagada lea la verdad («no está incluida en esta versión de
  LinkVault») y tenga adónde ir, sin un formulario que no puede funcionar.
- Que en el móvil la barra ocupe una fila.
- Un contrato de capacidades que no filtre configuración y que pueda crecer sin romper SPAs ya cargados.

**Non-Goals:**
- Salud en vivo de Meilisearch o de las bolsas: una avería transitoria sigue cayendo en el `503` honesto de cada página.
- Capacidades por usuario (consentimiento, BYOK, cuota). El contrato es global al despliegue en esta versión.
- La capacidad `push` y cualquier cambio en Notificaciones (B2; candidata a sumarse por adición, Q2).
- Activar nada en staging; selector de idioma (fila 37); atajo global «Guardar link» (Q3).

## Decisions

### D1. `GET /api/capabilities`, con sesión, contrato en `libs/shared`

Ruta nueva `GET /api/capabilities` protegida por el guard global de access token (sin `@Public()`), que responde
`200` con `{ search: boolean, discovery: boolean }`. Contrato `capabilitiesResponseSchema` en
`libs/shared/src/schemas/capabilities.schema.ts`, exportado desde el índice. El controlador vive en
`apps/api/src/presentation/http/` junto a `health` y `metrics`: no es un bounded context, solo lee `APP_CONFIG`, y no
importa ningún módulo de dominio (así no acopla `search` ni `discovery` entre sí).

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

Una avería transitoria (Meilisearch caído, una bolsa que no responde) no cambia la capacidad: la página sigue
mostrando su `503` de «en este momento», que en ese caso sí es verdad.

*Descartado:* sondear Meilisearch o las bolsas en cada petición o con un temporizador. Encarece la ruta, hace que la
barra parpadee con cada intermitencia y duplicaría el `503` que ya existe.

### D3. Solo booleanos, y un guardia que lo comprueba

La respuesta se construye con el schema **estricto** (`.strict()`) y el test del controlador comprueba que las claves
son exactamente `search` y `discovery`, y que los dos valores son booleanos. Así no puede colarse un host, una clave,
un nombre de proveedor ni un modelo. Falsación: añadir `meiliHost: config.MEILI_HOST` a la respuesta y ver caer el
test; restaurar.

### D4. Caché: inmutable por proceso en la API, sin caché HTTP, una petición por carga en el SPA, contrato aditivo

- **API.** La configuración no cambia sin reiniciar el proceso, así que el objeto se calcula una vez (en el
  constructor del controlador) y se sirve con `Cache-Control: private, no-store` (C5). Con `max-age` el navegador
  reutilizaría la respuesta tras un cambio de sesión en el mismo navegador y durante minutos tras un redespliegue que
  cambió una bandera; la ruta devuelve un objeto ya calculado, así que la caché HTTP no ahorra nada.
- **SPA.** `CapabilitiesStore` (`providedIn: 'root'`, signals) hace **una** petición por carga de la aplicación y
  reparte la misma promesa a quien llame mientras está en vuelo (la barra y una página abierta por enlace directo
  piden a la vez). No se borra al cerrar sesión: no depende del usuario.
- **Aditivo.** El SPA parsea la respuesta con el schema **no estricto** (zod por defecto descarta claves
  desconocidas), de modo que añadir una capacidad nueva en la API (por ejemplo `push`, Q2) no rompe un SPA ya cargado.
  Quitar o renombrar una sí sería un cambio incompatible y necesitaría su propio change.

*Riesgo aceptado:* tras cambiar una bandera y redesplegar, una pestaña abierta conserva lo que sabía hasta recargar.
Un despliegue ya implica recargar para recibir el SPA nuevo.

### D5. Estados del store: desconocido oculta y no ofrece nada, fallo abre

| Estado | Entradas condicionales | Enlace directo a la página |
|---|---|---|
| `loading` (aún no responde) | ocultas | estado neutro: el título de la página y un contenedor `aria-busy="true"`, sin formulario, enlace ni botón (C4) |
| `ready` | según cada booleano | con `false`, estado «no incluida» (D7); con `true`, la página de hoy |
| `failed` (red, 5xx, respuesta que no valida) | visibles, como hoy | la página de hoy, con su `503` |

Ocultar mientras carga evita mostrar «Buscar» y quitarlo un instante después (lo peor para quien ya iba a pulsarlo);
por la misma razón la página no ofrece su formulario hasta saber si la función existe. Fallar abierto vuelve
exactamente al comportamiento actual, que ya tiene un `503` honesto en cada página: esto es navegación, no un control
de acceso, y la API sigue respondiendo `503` a una función apagada. El fallo no se reintenta hasta la siguiente carga.

**Estado observable (C3).** El `<mat-toolbar>` lleva `data-capabilities` con el estado del store (`loading`, `ready` o
`failed`). Mientras carga, «Buscar» y «Descubrir» tampoco están, de modo que una prueba que afirma su ausencia pasaría
sin haber recibido nada: el camino crítico espera `data-capabilities="ready"` antes de afirmar (D13). No es una API
pública ni se usa para estilos.

### D6. En la barra, ocultar; no deshabilitar

Una entrada apagada **no aparece**. *Descartado:* mostrarla deshabilitada con un tooltip «No disponible en este
entorno»: en táctil no hay tooltip, una entrada gris invita a pulsarla y no explica nada, y es ruido en la barra
compacta. La explicación vive donde alguien llega sin pasar por la barra: la propia página (D7).

### D7. Enlace directo a una función apagada: la página carga y lo dice

Con la capacidad en `false`, `/buscar` y `/descubrir` **no redirigen**: la ruta carga y la página, en lugar del
formulario, muestra un estado con `role="status"` (textos de la iteración 1, B1 y B3):

- búsqueda: «La búsqueda no está incluida en esta versión de LinkVault.» y un enlace «Ver Solo para mí» a
  `/mis-links`;
- Descubrir: «Descubrir vacantes no está incluido en esta versión de LinkVault. Puedes guardar una oferta pegando su
  enlace en Solo para mí o en un grupo.», un enlace «Ver Solo para mí» a `/mis-links` y otro «Ir a mis grupos» a
  `/grupos`.

La página no llama a `GET /api/search` ni a `GET /api/discovery/search` (sí puede cargar lo que ya cargaba al
construirse, como los grupos). Mientras el store está en `loading`, la página muestra el estado neutro de D5, sin nada
accionable; en `failed`, la página es la de hoy y su `503` sigue valiendo. Las frases de «en este momento» se quedan
para el `503` transitorio.

«Incluida en esta versión» y no «activada en este entorno» (B1): quien recibe la invitación no sabe qué es un entorno,
y «activada» sugiere que alguien podría encenderla para esa persona.

*Descartado:* un `canActivate` que redirige a `/grupos`. La persona pierde lo que buscaba sin saber por qué, y el
guard tendría que esperar a la petición de capacidades antes de resolver la navegación (un enlace directo en frío
tardaría más). *Descartado:* una página 404; no existe (la ruta `**` redirige al inicio) y una función apagada no es
una dirección inexistente. *Descartado (C4):* mostrar el formulario mientras carga; con la función apagada, la persona
podía empezar a escribir y ver el formulario sustituido por el aviso.

### D8. Modo compacto: una fila con la marca y «Menú», que despliega un `<nav>`

Por debajo de **1024 px** de ancho la barra muestra una sola fila: la marca a la izquierda y, a la derecha, un botón
de texto «Menú» (`aria-expanded`, `aria-controls`). Al pulsarlo se despliega **debajo de la barra, empujando el
contenido** (no superpuesto), un `<nav aria-label="Navegación principal">` con una lista de enlaces y «Cerrar sesión»
al final. Por encima de 1024 px, la barra de siempre, con el `flex-wrap` de 5.4b como red de seguridad.

**El panel (C6).**
- El `<nav>` con su `id` está **siempre en el DOM** en modo compacto y se oculta con `[hidden]` cuando está cerrado, de
  modo que `aria-controls` nunca apunta a un elemento inexistente.
- **Cierre por navegación** (`NavigationEnd`): el foco pasa a `<main tabindex="-1">` del Shell, el contenido nuevo; no
  queda en un enlace oculto ni cae al `<body>`.
- **Cierre con el botón o con Escape:** el foco queda en (o vuelve a) el botón «Menú».
- **Escape** se escucha solo con el panel abierto y solo dentro del `<header>` del Shell (nuevo: envuelve la barra y
  el panel; no en `document`), de modo
  que un Escape en un diálogo o en un campo de la página no cierra nada ni mueve el foco.
- **Paso a modo ancho** con el panel abierto (girar la tableta, agrandar la ventana): el panel se cierra.

**El modo (C7).** Se decide con `BreakpointObserver` de `@angular/cdk/layout` (ya usado en `comments.dialog.ts`)
convertido en signal, y no con una media query de CSS, porque así los specs de componente pueden fijarlo con un doble
y comprobar el DOM de cada modo (jsdom no evalúa media queries). El valor inicial se toma de forma síncrona con
`breakpointObserver.isMatched('(max-width: 1023.98px)')`, y `observe(...)` lo actualiza después: así el primer render
ya está en el modo correcto y no hay un fotograma con la barra ancha en el móvil.

**El umbral (C8, B5).** Sale de la barra ancha: marca + siete entradas + «Cerrar sesión» en texto no caben en una fila
por debajo de ~1000 px. Se verifica con capturas a 1024 y a 1280 px con **todas las entradas visibles** (búsqueda y
Descubrir encendidas), en ES y en EN (el inglés puede ser más largo), anotando el `scrollWidth` y el `clientWidth`
medidos del `<mat-toolbar>` (tarea 3.6). Si a 1024 px no entra en una fila (`scrollWidth > clientWidth` o más de una
fila), se sube el umbral y se anota el valor en la 3.6 y aquí.

*Alternativas descartadas:*
- **`mat-menu`.** Pone `role="menu"`/`menuitem` a enlaces de navegación: un lector de pantalla anuncia un menú de
  aplicación y cambia el modo de teclado, y las pruebas que buscan `link` dejarían de encontrarlos.
- **`mat-sidenav`.** Obliga a envolver todo el layout en un contenedor de sidenav, que cambia el scroll de todas las
  páginas y lo que miden sus pruebas, para un panel de ocho enlaces.
- **Barra inferior de pestañas.** No hay set de iconos en el proyecto (ni `mat-icon` ni fuente), caben cinco
  destinos, y una barra fija abajo compite con el snackbar «Compartido · Deshacer» y con el teclado del móvil.
- **Una fila con scroll horizontal.** Las entradas que no se ven no se descubren.
- **Mantener el `flex-wrap` reordenando.** Siguen siendo dos o tres filas.
- **Escape en `document`.** Cerraría el panel (y robaría el foco) con el Escape de un diálogo abierto encima.

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

### D11. (Retirada en la iteración 1, B2)

La propuesta de deshabilitar «Activar push» con su explicación sale de este change junto con la capacidad `push`. Se
conserva el número para no renumerar referencias. Si se retoma, entra por adición al contrato (D4, Q2) en un change
propio, con su delta de `web/notifications`.

### D12. Textos ES/EN según ADR-050

Unidades nuevas, con id explícito: `shell.groups`, `shell.menu`, `shell.navLabel`, `search.notEnabled`,
`search.notEnabled.myLinks`, `discovery.notEnabled`, `discovery.notEnabled.myLinks`, `discovery.notEnabled.groups`.
`messages.xlf` se regenera con `pnpm nx run web:extract-i18n`; las traducciones van en `messages.en.xlf`; lo comprueba
`pnpm nx run web:i18n-check`. Textos ingleses propuestos: «Groups», «Menu», «Main navigation», «Search isn't available
in this version of LinkVault.», «Go to Just for me», «Job discovery isn't available in this version of LinkVault. You
can save a job by pasting its link in Just for me or in a group.», «Go to my groups» (el texto inglés de «Solo para
mí» se toma del catálogo vigente, «Just for me», no se inventa). Los ids `*.notEnabled` se conservan aunque el texto
hable de «versión»: son identificadores, no texto visible.

### D13. Verificación: specs de componente, integración de la API y el camino crítico re-admitido

Solo `critical-path.spec.ts` lleva `@lot1`, y un spec sin esa etiqueta no cuenta como verificación (ADR-053;
`apps/web-e2e/README.md`; D10 de `usage-guide-fixes`). Por eso:

- **Web:** specs de componente en `TestBed` con Angular Material real, `HttpTestingController` y un doble de
  `BreakpointObserver` (con `isMatched` y `observe`) que fija el modo. Cubren cada fila de D5, D6, D7 y D8.
- **API:** test unitario de `deriveCapabilities` (una fila por caso de D2) y test de la app Nest con el guard real:
  `401` sin token, `200` con token, cuerpo exacto (D3) y `Cache-Control: private, no-store`.
- **Camino crítico, navegación (C7).** El recorrido navega hoy con `getByRole('link', { name: 'Postulaciones' |
  'Mi CV' | 'LinkVault' })`; en el proyecto `mobile` (Pixel 7, 412 px) las entradas pasan al panel. Un ayudante
  `navigateByShell(page, name)` en `apps/web-e2e/src/support/` decide el modo por `page.viewportSize().width < 1024`
  (no por si «Menú» está visible, que depende del primer render): en compacto pulsa «Menú» y busca el enlace dentro del
  `<nav>` «Navegación principal»; en ancho, dentro de la barra. La vuelta al grupo (`backToGroup`) pasa de la marca a
  `navigateByShell(page, 'Grupos')`, que existe en los dos modos.
- **Camino crítico, capacidades (C2, C3).** La espera de `GET /api/capabilities` (`page.waitForResponse`) se arma en
  `register()`, `enterWithTestAccount()` y `joinByInvitation()`, **antes del clic** que lleva al Shell («Crear
  cuenta» o «Entrar»), porque es entonces cuando el Shell se crea y pide las capacidades. La promesa se guarda en
  `Entry` (A) y se pasa con la de B a sus pasos 3-7; en el **paso 5**, antes de pulsar «Postulaciones», se espera esa
  promesa (sin recargar la página), se espera `data-capabilities="ready"` en el `<mat-toolbar>` y se afirma que
  «Buscar» y «Descubrir» aparecen en la barra o en el panel **si y solo si** su capacidad es `true`. No añade un paso
  declarado ni cambia el requirement de `e2e-suite`: es una afirmación dentro de un paso existente, y vale en `local`
  y en `remote` porque compara contra lo que el destino declara, no contra un valor fijo. No usa Mongo, Redis ni
  Mailpit: sigue siendo `@remote-safe`.
- **Re-admisión (C11).** Al cambiar un spec admitido, se repite la admisión con carga de `apps/web-e2e/README.md`
  (cinco de cinco, una invocación por proyecto y perfil, pila nueva) en `chromium` y `mobile`, y también en `webkit` si
  la 9.9 de `e2e-suite` ya lo añadió cuando se aplique este change. Las filas van en un **bloque propio con fecha**
  dentro de «Admisiones» («`web-shell-capabilities`, AAAA-MM-DD»), separado de las filas de `e2e-suite`, cuyo PR-2
  edita la misma sección.
- **Pruebas antiguas sin `@lot1` (C10).** Las que pulsan la barra (`byok`, `deploy-prod`, `match`, `auth`, `cv`,
  `links`, `search`) corren en escritorio, donde la barra conserva enlaces con el mismo nombre. `search.spec.ts` es la
  excepción: pulsa «Buscar», que con la búsqueda apagada ya no está; pasa a navegar con `page.goto('/buscar')`. Si
  alguna otra se rompe, se anota como evidencia informativa, no bloquea.

### D14. Fase: excepción ∥ 35b y ventana de fusión, pendiente del owner

Ver «Fase y excepción a la fila 35» en `proposal.md` y ADR-059 §1. Condiciones de diseño (si el debate las rompe,
vuelve al owner): no cambia el orden 35b → 35c; no toca composes, workflows ni variables de entorno; no modifica
requirements de `platform/ci-pipeline`, `platform/email` ni `platform/production-deploy`.

**Ventana de fusión (C1).** Hechos al 2026-10-28:
- el PR-1 de 35b está en `main` (#86, 2026-10-28);
- la cabecera de `openspec/changes/staging-host/tasks.md` dice «Entre PR-1 y PR-2 no se fusiona nada a `main`». Después
  de #86 se fusionaron #88, #89 y #91; eso es asunto de 35b y del owner, no de este change, y no abre ninguna ventana;
- D15 de `e2e-suite` prohíbe fusionar entre el PR-2 de 35b y su 11.6 (la 11.6 relanza los despliegues de la corrida de
  6.3 y de la del PR-2, y una fusión en medio desplegaría otro commit entre los dos).

La única ventana válida que queda sin tocar reglas ajenas es **después de la 11.6 de 35b y antes de su 10.7** (invitar),
y, como toda fusión a `main` despliega a staging, con dos condiciones: **repetir la 9.4 de `e2e-suite`** (precondición
de invitar) sobre el commit desplegado tras la fusión, y **nunca los días 7 y 14 de la medición** de 35b (si la 10.7
se adelantara a lo previsto, la fusión ya no está en la ventana y vuelve al owner). Si este change se fusiona después
de una 9.4 ya ejecutada, esa 9.4 no vale para invitar y se repite. La tarea 7.4 lo comprueba antes de fusionar.

Alternativa que solo el owner puede abrir: una **excepción expresa a la regla «entre PR-1 y PR-2»** de 35b (Q1 (d)),
con el riesgo descrito allí. Decisión del owner: **Q1**.

## Risks / Trade-offs

- **[Riesgo] La capacidad dice `true` y la función falla igual** (Meilisearch caído, una bolsa sin respuesta). → D2 lo
  acepta: la página conserva su `503` honesto.
- **[Riesgo] Fallar abierto vuelve a mostrar entradas rotas si la petición de capacidades falla.** → Es el
  comportamiento de hoy, no uno peor; un fallo de esa petición casi siempre es la API caída, y entonces nada funciona.
- **[Riesgo] Una afirmación de ausencia que pasa sin datos** (el store en `loading` también oculta). → El camino
  crítico espera `data-capabilities="ready"` antes de afirmar, con su falsación «store atascado en `loading`» (6.2).
- **[Riesgo] Romper el camino crítico en `mobile`** justo antes de invitar, cuando la 9.4 de `e2e-suite` es
  precondición. → El cambio de barra y el del recorrido van en el mismo PR, la re-admisión es tarea de cierre
  (grupo 6) y la 9.4 se repite tras fusionar (D14).
- **[Riesgo] La ventana de fusión no llega a tiempo** (la 11.6 y la 10.7 de 35b pueden quedar muy juntas, o la 11.6
  bloqueada por el servidor). → Q1 lo deja explícito: sin ventana, el change espera (b) o el owner abre (d); nunca se
  fusiona fuera de ella (7.4).
- **[Trade-off] Una pestaña abierta no se entera de una bandera nueva hasta recargar** (D4).
- **[Trade-off] El umbral de 1024 px manda al modo compacto a tabletas en vertical** que quizá cabrían en dos filas.
  Una fila con menú es aceptable allí, y es un único número a ajustar.
- **[Trade-off] Un enlace directo en frío muestra un instante el estado neutro** antes del formulario (D5). Es una
  petición pequeña y sin caché que ya está en vuelo desde la creación del Shell.
- **[Riesgo] Accesibilidad del panel.** → Botón con `aria-expanded`/`aria-controls` hacia un `<nav>` siempre presente,
  foco gestionado en cada forma de cierre, Escape acotado al header; los specs lo comprueban (3.3b, 3.4).

## Migration Plan

Sin datos ni configuración que migrar. Orden de despliegue indiferente: un SPA viejo no llama a la ruta nueva; un SPA
nuevo contra una API vieja recibe `404` en `GET /api/capabilities`, cae en `failed` y se comporta como hoy (D5).
Rollback: revertir el PR.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] ¿Excepción a la precedencia de la fila 35, y en qué ventana se fusiona?**
  (a) Sí, fusionando **después de la 11.6 de 35b y antes de su 10.7**, repitiendo la 9.4 de `e2e-suite` sobre el
  commit desplegado tras la fusión, nunca los días 7 y 14 de la medición, con las condiciones de D14.
  (b) No: el change espera a archivar 35c y entra como fila propia.
  (c) Sí, pero solo capacidades y ocultar entradas (sin la barra compacta: tareas 3.3a-3.6, 5.2 y 6.1), en la misma
  ventana que (a), y la barra compacta después de 35c.
  (d) Sí, y además el owner autoriza **expresamente una excepción a la regla «entre PR-1 y PR-2 no se fusiona nada a
  `main`»** de 35b para fusionar antes de su PR-2. *Riesgo para la 6.3 de 35b:* la 6.3 hace el primer despliegue real
  relanzando la corrida del push de PR-1; una fusión intermedia deja en `main` un commit posterior que, con los secretos
  de la 6.1 configurados, `cd-staging` despliega por sí solo, de modo que el primer despliegue real podría no ser el
  de PR-1, el ensayo de reconstrucción (9.1-9.4 de 35b) correría sobre otro commit y la 11.6 compararía otro par de
  commits. Exige que el owner lo anote en 35b y, si la 6.1 ya está hecha, hacerlo antes de la 6.3 o aceptar repetirla.
  **Recomendación: (a).** Respeta las reglas de 35b y de `e2e-suite` tal como están, y las personas invitadas siguen
  viendo la barra nueva desde el primer día. (c) deja la barra de tres filas durante la medición; (d) toca la
  secuencia de despliegues de 35b, que no es de este change. La respuesta se anota en ADR-059 §1 en una línea que
  empiece por «Respuesta del owner (Q1), AAAA-MM-DD:».
- **Q2 [no bloqueante] ¿Añadir `push`, `externalAi` o `byokVault` al contrato?** (a) No en esta versión; se añaden
  cuando haya un consumidor, sin romper el contrato (D4). (b) Sí, ya. **Recomendación: (a).** `push` salió de este
  change en la iteración 1 (B2); la bóveda BYOK es obligatoria en producción (H3 vive en `e2e-suite-lot-2` solo por
  las pilas de prueba) y el permiso de IA externa ya lo gestiona el perfil.
- **Q3 [no bloqueante] ¿Atajo global «Guardar link» en la barra compacta?** (a) No hasta ver los datos del día 7 de
  35b. (b) Sí, en esta versión. **Recomendación: (a)** (D10).
- **Q4 [no bloqueante] ¿Se toca el aviso de invitación de 35b** («la búsqueda no está disponible»)? (a) No: sigue
  siendo cierto y ahora la interfaz es coherente con él. (b) Quitar la línea. **Recomendación: (a).** Es un artefacto
  de `staging-host`; este change no lo edita.

## Debate — iteración 1

Fecha: 2026-10-28. Resultado de entrada: `critic` P0 1 (C1-C12), `business` V0 0 (B1-B5). Decisiones de `reflect`
aplicadas en este documento, en `tasks.md`, en los specs, en `proposal.md` y en ADR-059. Q1 sigue abierta y bloqueante.

| Id | Origen | Decisión | Motivo |
|---|---|---|---|
| C1 (P0) | critic | Aceptado. Q1(a), D14 y ADR-059 §1 reescritos: única ventana después de la 11.6 de 35b y antes de su 10.7, repitiendo la 9.4 de `e2e-suite`, nunca días 7 y 14; Q1(d) para una excepción expresa del owner a «entre PR-1 y PR-2»; tarea 7.4 | El PR-1 de 35b ya está en `main` (#86); «antes de la 6.3» caía entre PR-1 y PR-2, que 35b prohíbe, y D15 de `e2e-suite` prohíbe entre el PR-2 y la 11.6 |
| C2 | critic | Aceptado. Espera de `/api/capabilities` armada en `register()`, `enterWithTestAccount()` y `joinByInvitation()` antes del clic; promesa en `Entry`, esperada en el paso 5 sin recargar (D13, 6.2) | La petición sale al crearse el Shell; armarla en el paso 5 llegaba tarde o forzaba una recarga |
| C3 | critic | Aceptado. `data-capabilities` en el `<mat-toolbar>`, espera de `ready` antes de afirmar y falsación «store atascado en `loading`» (D5, 3.2a, 6.2) | En `loading` las entradas también se ocultan: la afirmación de ausencia pasaba sin datos |
| C4 | critic | Aceptado. En `loading`, estado neutro sin nada accionable (D5, D7, specs de búsqueda y Descubrir, 4.1, 4.2) | El formulario podía usarse y desaparecer al llegar `false` |
| C5 | critic | Aceptado. `Cache-Control: private, no-store` (D4, spec de capacidades, 1.3, 1.4) | `max-age` reutilizaba la respuesta tras cambiar de sesión o redesplegar, sin ahorro real |
| C6 | critic | Aceptado. `<nav id>` siempre presente con `[hidden]`; foco a `<main tabindex="-1">` al navegar y al botón con Escape o botón; cierre al pasar a ancho; Escape solo abierto y dentro del header; tres casos más en 3.4 (D8, spec de shell) | `aria-controls` apuntaba a un elemento que no existía, el foco se perdía y Escape robaba el de los diálogos |
| C7 | critic | Aceptado. Modo inicial con `isMatched`; el ayudante e2e decide por `viewportSize().width < 1024` (D8, D13, 3.3a, 6.1) | Sin valor síncrono hay un primer render en modo ancho; «Menú visible» como criterio era una carrera |
| C8 | critic | Aceptado. Capturas a 1024 y 1280 px con todas las entradas visibles, ES y EN, con `scrollWidth`/`clientWidth` anotados; si no entra, se sube el umbral (D8, 3.6) | La evidencia anterior medía con las entradas condicionales ocultas y solo en español |
| C9 | critic | Aceptado. Tarea 5.2: §27 de la guía y capturas 088-090 | La guía describe la barra de tres filas |
| C10 | critic | Aceptado. `search.spec.ts` en la lista de D13, navegando con `page.goto('/buscar')` (tarea 6.6) | Pulsa «Buscar», que con la búsqueda apagada ya no está |
| C11 | critic | Aceptado. Tarea 6.5 condicional para `webkit` si la 9.9 de `e2e-suite` está hecha; 9.4 repetida si se fusiona después; bloque propio con fecha en «Admisiones» (D13, D14) | Coordinación con el PR-2 de `e2e-suite`, que toca el mismo recorrido y la misma sección |
| C12 | critic | Aceptado. 3.2 y 3.3 partidas en a/b; la 4.4 guarda capturas nombradas | Tareas de más de una hora; evidencia sin nombre no se puede revisar |
| B1 | business | Aceptado. «… no está incluida en esta versión de LinkVault.» (búsqueda), «… no está incluido en esta versión de LinkVault. …» (Descubrir) y «isn't available in this version of LinkVault» en EN; «en este momento» solo para el `503` (D7, D12, specs) | «Activada en este entorno» es jerga para quien recibe la invitación |
| B2 | business | Aceptado (recorte). `push` fuera del contrato, D11 y tarea 4.3 retiradas, delta de `web/notifications` quitado; candidata por adición (Q2) | El contrato es aditivo; el push no está en la barra ni en el camino a la activación |
| B3 | business | Aceptado. Descubrir apagado ofrece también «Ir a mis grupos» (D7, D12, spec de Descubrir, 4.2) | Guardar en un grupo es lo que la página sugiere; el enlace tiene que llevar allí |
| B4 | business | Sin decisión de `reflect` registrada en esta iteración; no se aplica ningún cambio | Pendiente de confirmar por la sesión principal si era informativo |
| B5 | business | Aceptado; cubierto por C8 | Mismo pedido: comprobar el umbral con el inglés y con todas las entradas |
