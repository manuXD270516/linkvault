## Context

La guía de uso del 2026-11-25 dejó tres hallazgos de producto, H1-H3 (`docs/guia-de-uso/README.md`, «Hallazgos»;
casos M01, V03 y F03). Este design localiza cada uno en el código (lectura del 2026-11-25 sobre `main` en `a6e943be`)
y en la spec que lo gobierna, y decide cómo corregirlo. H4-H8 quedan fuera (proposal, «Fuera de alcance»).

| Hallazgo | Causa raíz en el código | Spec vigente |
| --- | --- | --- |
| H1 | `apps/web/src/app/features/match/match.dialog.ts`, `matchProblem`: compara `job_not_ready`, `no_cv`, `cv_not_ready` y `cv_not_readable` con `isApiFailure(failure, 422, …)`, pero `apps/api/src/presentation/http/api-error.ts` los mapea a `409` (como exige `cv/match`). Ningún caso coincide y el fallo cae en la rama final `{ kind: 'server' }` → «No pudimos analizar ahora.». Los tests de `match.dialog.spec.ts` simulan `apiError('no_cv', 422)`, un status que la API nunca envía, y por eso pasaban. Además `phase` nunca mira la lista de CV: con la lista cargada y vacía sigue en `idle` y ofrece «Analizar». | `web/cv-match` «Falta tu CV»; `cv/match` (los cuatro rechazos son `409`) |
| H2 | `apps/web/src/app/features/auth/verify-email.page.ts`, `verify()`: tras el `POST /api/auth/verify-email` decide con `session.isAuthenticated()` **en ese instante**. Con la carga completa que provoca abrir el enlace del correo, `SessionRestore` (`core/auth/session-restore.ts`) arranca el refresh en el initializer sin bloquear, y `/verificar-email` no tiene guard que lo espere, así que el refresh y la verificación corren en paralelo. Si la verificación responde primero, la sesión aún está en `unknown`, la página no pide el perfil, y el refresh llega después con el `user` que el servidor leyó **antes** de confirmar la verificación (`emailVerified` `false`): `needsEmailVerification` sigue en `true` hasta recargar. Aparte, si el `GET /api/users/me` posterior falla, el `catch` común convierte una verificación correcta en la fase `error`. | `web/email-auth` «Página de verificación por enlace»; `web/auth` «Aviso de email no verificado» |
| H3 | `apps/web/src/app/features/profile/profile.page.ts`, `changePassword()`: si el formulario es inválido, hace `markAllAsTouched()` y **vuelve antes** de `passwordFailure.set(null)`, así que «La contraseña actual no es correcta» del intento anterior queda en pantalla junto al error nuevo. En `profile.page.html`, los dos `mat-form-field` de contraseña usan el subíndice de alto fijo de Material: el `mat-error` «La nueva contraseña debe tener al menos 10 caracteres y no puede ser tu email» ocupa dos líneas a ese ancho y desborda sobre el `<p role="alert">` viejo que viene justo detrás (captura `040-perfil-contrasena-nueva-corta`). | `web/auth` «Perfil, cambio de contraseña y logout» |

Auditoría hecha para acotar H1 (y repetida por el crítico en la ronda 1): todas las llamadas a
`isApiFailure`/`hasApiErrorCode` de `apps/web/src` se compararon con `API_ERROR_STATUS` de la API; las únicas que no
coinciden son estas cuatro del diálogo de encaje.

## Goals / Non-Goals

**Goals:** que el diálogo de encaje llegue a los estados de CV y de oferta sin leer que ya tiene, y que sin CV lo diga
desde que se abre; que verificar el email quite el aviso sin recargar en la pestaña que abre el enlace, sea cual sea
el orden en que respondan el refresh y la verificación; que el formulario de contraseña muestre solo el resultado del
último intento, sin textos superpuestos. Cada arreglo con un test que reproduce el defecto antes de corregirlo y cae si
vuelve.

**Non-Goals:** H4-H10 (proposal); cambiar el contrato de la API o los status de `cv/match`; rediseñar el diálogo de
encaje o la página de verificación; refrescar el perfil en otras pestañas (PO-3, proposal «Fuera de alcance»); textos
nuevos; E2E nuevos obligatorios.

**Orden de recorte (PO-4).** Si el apply se atrasa, H3 (grupo 3 de tasks) es lo primero que sale: lo verán pocas de
las personas invitadas. H1 y H2 están en el camino de primera vez de todas.

## Decisions

### D1. H1: el diálogo reconoce los rechazos del análisis por su código

**Decisión.** Un ayudante nuevo en `core/api/api-error.ts`, `isApiFailureCode(failure: RequestFailure | null, code:
ApiErrorCode)` (`failure?.kind === 'api' && failure.code === code`), en paralelo a `isApiFailure` (P2-9: el nombre no
se confunde con `hasApiErrorCode(error, status, code)`, que ya existe en el mismo fichero y recibe `unknown`).
`matchProblem` lo usa para `job_not_ready`, `no_cv`, `cv_not_ready` y `cv_not_readable`. `isApiFailure` no cambia y el
resto de llamadas tampoco. Los tests del diálogo pasan a simular el status real (`409`).

**Por qué el código y no el status.** El código es lo que el SPA traduce (`api-error.ts` de la API lo dice: «El SPA
traduce el código, no el mensaje»), cada código tiene un único significado y la tabla código → status vive solo en la
API. Repetir el status en el SPA es una segunda fuente de verdad que ya divergió una vez sin que ningún test lo viera.

**Alternativas descartadas.**

- (A) Cambiar `422` por `409` en las cuatro comparaciones: arregla hoy, pero deja la misma trampa para la próxima vez
  que cambie un status, y los tests seguirían fabricando el status a mano.
- (B) Mirar solo el status `409`: confundiría los cuatro códigos entre sí y con cualquier otro `409`.
- (C) Exportar la tabla código → status desde `libs/shared` y usarla en el SPA y en los tests: es lo más sólido contra
  la divergencia, pero toca la API y todos los códigos; fuera de alcance (proposal).

**Guardia.** Los tests de los cuatro estados simulan `409` y el de `no_cv` se repite con otro status (`422`) para fijar
que lo que manda es el código. Con D2, los dos casos de `no_cv` abren el diálogo con el `GET` de la lista de CV
respondiendo `500` o con un CV en la lista, para que «Analizar» exista (P1-1). El caso `cv_not_ready` usa un CV con
`extraction.status: 'pending'` (con `stopPolling` o fake timers para el sondeo del `CvStore`), no uno ya leído (P2-5).
El `500` → «No pudimos analizar ahora.» ya lo cubre el caso existente «Avería del servidor» y no se duplica (P2-5).
Falsación: volver a `isApiFailure(failure, 422, 'no_cv')` hace caer el caso de `409`.

### D2. H1: sin CV, el diálogo lo dice al abrirse y no ofrece «Analizar»

**Decisión.** Una fase local: si `cvs.isEmpty()` (que ya existe en `CvStore`: `loaded() && items().length === 0`,
P1-3) y **no hay informe ni fallo de la API** (`report() === null && failure() === null`), `phase` es `no_cv` y el
diálogo muestra el estado que ya existe (`data-testid="match-no-cv"`, «Necesitas un CV guardado para analizar tu
encaje.» con «Subir mi CV», que lleva a `/mi-cv` y cierra con `{ kind: 'change-cv' }`). No se pinta «Analizar» y no
se llama a la API.

- **Precedencia (P1-3).** Esta condición se evalúa **antes** que las del permiso (`consent_checking`,
  `consent_unknown`), y solo mientras no haya informe ni fallo de la API: sin CV no hay nada que mandar a ningún sitio,
  así que preguntar por el permiso no ayuda y «Subir mi CV» es la única salida útil. No tapa un informe ni un error ya
  en pantalla si el sondeo del `CvStore` vacía la lista con el diálogo abierto (CV borrado en otra pestaña). El `no_cv`
  que viene de la API (D1) conserva su lugar actual.
- **Lo que se ve en ese estado (P2-4).** La línea de enrutado (`match-routing`, «Se analizará con IA externa…» o
  «…dentro de LinkVault…») se oculta cuando `phase() === 'no_cv'`, venga de la fase local o de la API: sin CV no hay
  análisis que enrutar. «Ningún CV marcado» se mantiene (PO-2: redundante, pero coherente). No se añaden textos.
- **Por qué la lista y no `defaultCv`.** «Ningún CV marcado» se pinta con `defaultCv() === null`, pero `cv/documents`
  garantiza que mientras haya al menos un CV hay exactamente uno marcado; la lista vacía es el hecho que decide, y no
  depende de esa invariante.
- **Si la lista no cargó** (`loaded` en `false` por un fallo), `isEmpty()` es `false`: «Analizar» sigue disponible y,
  si la API responde `409 no_cv`, D1 lleva al mismo estado.
- **CV en lectura.** La lista trae ese CV, así que la fase local no se activa; «Analizar» llega a la API, que responde
  `409 cv_not_ready`, y D1 muestra «Estamos leyendo tu CV…» (lo que verán las personas invitadas justo después de
  subirlo, PO-1).
- **CV subido en otra pestaña.** Volver de `/mi-cv` reabre el diálogo con un `CvStore` nuevo (proveedor del propio
  diálogo), así que el estado se recalcula; sin pasar por `/mi-cv`, cerrar y reabrir basta.

**Alternativas descartadas.**

- (A) Dejar «Analizar» deshabilitado: un botón gris no dice por qué ni qué hacer, y `web/cv-match` exige que estos
  estados terminen siempre en una acción.
- (B) Dejar «Analizar» activo y confiar en el `409` (solo D1): obliga a un viaje inútil a la API para enseñar algo que
  el diálogo ya sabe al abrirse.
- (C) Ponerla primera en `phase`, por delante de todo: taparía un informe o un error ya en pantalla si la lista se
  vacía con el diálogo abierto (P1-3).

### D3. H2: la verificación espera a la restauración de la sesión

**Decisión.** `VerifyEmailPage.verify()` lanza en paralelo el `POST /api/auth/verify-email` y
`SessionRestore.restore()` (idempotente: devuelve la misma promesa si ya arrancó o ya terminó; nunca rechaza, porque
captura su error y deja la sesión en `anonymous`) y espera a los dos con `Promise.allSettled` (P2-1). Solo entonces
fija la fase:

- **Verificación con éxito y sesión `authenticated`:** pide `GET /api/users/me`. Esa petición sale cuando la
  verificación ya está confirmada en el servidor, así que el perfil que llega trae `emailVerified` `true` con cualquier
  orden de respuestas.
- **Verificación con éxito y sin sesión:** «Ir a iniciar sesión», sin pedir el perfil (como hoy).
- **Verificación fallida:** `invalid` o `error` como hoy, pero ya con la sesión resuelta, para que la pista para
  invitados de la fase `invalid` no aparezca y desaparezca (P2-1).

La espera añade, como mucho, lo que tarde el refresh ya en curso (tope de 10 s de `SESSION_RESTORE_TIMEOUT_MS`),
mientras la página dice «Comprobando el enlace…».

**El perfil falla después de verificar (P1-2).** La verificación ya ocurrió: la fase es `success` («Email
verificado») y el fallo no se presenta como error. Si `session.user()` no es `null`, se hace
`session.setUser({ ...user, emailVerified: true })`; si es `null` (por ejemplo, el perfil respondió `401`, el refresh
del interceptor falló y `auth.interceptor.ts` limpió la sesión), solo se fija la fase `success`, sin excepción y sin
fabricar un perfil.

**Alternativas descartadas.**

- (A) Marcar `emailVerified` `true` en local al terminar la verificación, sin esperar: un refresh que llega después
  pisa el `user` con el perfil viejo; es la misma carrera.
- (B) Que `setSession` no deje volver `emailVerified` de `true` a `false`: arregla el síntoma metiendo una regla de
  negocio en el store de sesión, y esconde cualquier otro desfase entre el perfil del refresh y el real.
- (C) Poner un guard en `/verificar-email`: la ruta es pública y sin `guestGuard` a propósito (`app.routes.ts`); un
  guard cambiaría a dónde redirige y qué ve quien no tiene sesión.
- (D) `Promise.all`: rechaza en cuanto falla el `POST`, sin esperar la restauración, y deja el parpadeo en la fase
  `invalid` (P2-1).

**Guardia.** Un test de la página, en un `describe` anidado con su propio `TestBed` (sin el `store.clear()` del
`beforeEach` exterior, así que la sesión arranca en `unknown`) y con `SessionRestore` sustituido por
`{ provide: SessionRestore, useValue: … }` con una promesa controlable (P2-2): responde primero la verificación y
después se resuelve la restauración con un perfil `emailVerified` `false`; se comprueba que el perfil se pide después
de la restauración y que el aviso no queda. Falsación: quitar `restore()` de la espera hace caer ese caso. **Este test
de componente es la prueba de H2** (P2-7): V03 en la guía es intermitente (2 de 6 corridas) y verlo en verde es solo
un indicio.

### D4. H3: cada intento de cambiar la contraseña borra el resultado anterior y el subíndice crece

**Decisión.**

1. `changePassword()` pone `passwordFailure` en `null` y `passwordChanged` en `false` **al principio**, antes de mirar
   la validez del formulario. Así un intento que el propio SPA rechaza también borra el aviso de la API del intento
   anterior, y el éxito de un cambio anterior no convive con un error nuevo.
2. Los dos `mat-form-field` de contraseña llevan `subscriptSizing="dynamic"`: el `mat-error` de dos líneas empuja el
   párrafo siguiente en vez de reservar un alto fijo que desborda. Es el mismo arreglo que `usage-guide-fixes` aplicó
   a «Grupo para avisos de estado» (su D5) y se verifica igual (su D10): con Angular Material real y la clase
   `mat-mdc-form-field-subscript-dynamic-size` como sustituto aceptado de la geometría, que jsdom no calcula.

Editar los campos **no** borra el aviso: el resultado se refiere al último envío, y se renueva al enviar de nuevo
(igual que el resto de formularios del perfil).

**Alternativas descartadas.**

- (A) Borrar el aviso en cada `valueChanges`: más suscripciones y un aviso que desaparece mientras se escribe, sin que
  el nuevo intento haya ocurrido.
- (B) Acortar el texto del error para que quepa en una línea: cambia un texto exigido por la spec y la traducción, y
  vuelve a romperse con otro ancho o en inglés.

### D5. Verificación sin E2E nuevos obligatorios

Los tres arreglos se verifican con specs de componente del SPA (`match.dialog.spec.ts`, `verify-email.page.spec.ts`,
`profile.page.spec.ts`) con `HttpTestingController` y Material real, cada uno con el test que reproduce el defecto
escrito y visto caer **antes** del arreglo. No se añade ningún E2E: el camino sin CV y el de verificación ya los
recorre la guía con su script, y sumar casos a `apps/web-e2e` exige la admisión de lote de la suite.

**Verificación manual del PR (Q3 de negocio y crítico, ronda 1).** Además de los tests, antes de pedir la fusión:

- una corrida acotada de la guía sobre la pila e2e con `--out=` a una carpeta temporal fuera del repo, **sin
  commitear capturas**: las secciones de M01 y F03 (`perfil` y `encaje`, más las anteriores que necesiten en
  `.state.json`; el filtro `--only=` de `capture.mts` es por nombre de sección, no por caso, así que «`--only=M01,F03`»
  no existe tal cual) y la de V03 (`verificacion`) **repetida 5 veces**, porque H2 era intermitente. El resultado se
  anota en la tarea 6.1;
- un recorrido a mano en staging antes de mandar invitaciones (registro → verificar el email → encaje sin CV → subir
  CV → encaje con el CV en lectura), **diferido a 35b**: staging no existe todavía.

### D6. La guía de uso

El README de la guía se genera con `tools/guia-de-uso/build-guide.mts` a partir de `resultados.json` y `meta.mts`, y
una corrida completa tarda unos 25 minutos y rehace todas las capturas. Este change:

- ajusta `capture.mts` para que la próxima pasada compruebe el comportamiento nuevo: en M01, el diálogo de Beto abre
  ya en `match-no-cv` y no tiene `match-analyze`; en F03, tras el intento con la nueva corta, «La contraseña actual no
  es correcta» ya no está; V03 no cambia (ya detecta el aviso que persiste). La captura de V03 en verde es solo un
  indicio de H2; la prueba es el test de componente de D3 (P2-7);
- mueve H1-H3 de «Hallazgos» a la línea de corregidos en `build-guide.mts`, y lo mismo, a mano, en el README de la
  guía, diciendo que están **corregidos por este change y pendientes de comprobar en la próxima pasada**. No marca
  como OK lo que nadie ha vuelto a mirar.

## Risks / Trade-offs

- **`isApiFailureCode` ignora el status.** Si un día dos status distintos llevan el mismo código con significados
  distintos, el diálogo no los distinguiría. Hoy la API garantiza un status por código (`API_ERROR_STATUS` es un
  `Record` sobre `ApiErrorCode`), así que el riesgo es teórico; la alternativa C de D1 lo cerraría del todo.
- **La verificación espera al refresh.** Con la API lenta, «Comprobando el enlace…» puede durar hasta el tope de 10 s
  del refresh, a la vez que «Conectando…» de la raíz. Es el mismo tope que ya paga cualquier ruta con guard al cargar.
- **Otra pestaña con la sesión abierta (PO-3).** Este change arregla la pestaña que abre el enlace. Quien se registró
  en una pestaña y abre el correo en otra nueva sigue viendo el aviso en la primera hasta recargar. Riesgo conocido,
  fuera de alcance (proposal).
- **Fase local `no_cv` y una lista de CV desfasada.** Si alguien sube un CV en otra pestaña con el diálogo abierto, el
  diálogo seguirá diciendo que falta hasta reabrirlo. «Subir mi CV» lleva a `/mi-cv`, donde ya está, y al volver el
  diálogo se reabre con la lista nueva.
- **`messages.xlf` puede no cambiar (P2-6).** `match.dialog.html` y `verify-email.page.html` no se tocan, y
  `subscriptSizing="dynamic"` puede ir en la misma línea del `<mat-form-field>`. Se re-extrae con
  `pnpm nx run web:extract-i18n`: si sale diff (solo `linenumber`), se commitea; si no, no hay commit. `web:i18n-check`
  lo comprueba (ADR-050). `messages.en.xlf` no cambia.
- **El script de la guía no corre en CI.** La tarea 5.1 modifica un script de Playwright que solo se comprueba con
  `tsc`; lo que no se ejecute en la verificación manual de D5 queda sin correr hasta la próxima pasada.

## ADR

No hace falta un ADR nuevo: las decisiones son locales al SPA, no cambian contratos, datos ni dependencias, y siguen
reglas ya escritas (`cv/match`, `web/cv-match`, `web/email-auth`, `web/auth`, el patrón de `usage-guide-fixes`
D5/D10). Si el owner concede la excepción de la Q1, su respuesta se anota con fecha en este design y en una línea de
ADR-055 §1 (que decía que su excepción no liberaba la precedencia para ningún otro change); si al anotarla hiciera
falta razonar algo más que la respuesta, el siguiente número libre en todas las ramas es **ADR-070** (ADR-069 existe en
`change/group-weekly-brief`).

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] Precedencia de la fila 35. Pendiente del owner.** Según ADR-048
  §Consecuencias y ADR-051 §1, ningún change de otra fila entra entre medias de la fila 35 (35b sigue abierta), y
  ADR-055 §1 dejó dicho que la excepción de `usage-guide-fixes` no liberaba la precedencia para ningún otro change.
  ¿Se aplica y fusiona este change antes de cerrar la fila?
  - (a) Sí, como excepción de la misma clase que ADR-055 §1: solo SPA, sin despliegue ni `platform/*`, y corrige
    pantallas que verán las personas invitadas en 35b.
  - (b) No: se prepara y espera a archivar la 35c.
  - (c) Sí, pero solo H1 (el único que la guía marcó como FALLO). En ese caso se quitan del change
    `specs/web/email-auth` y `specs/web/auth` y los grupos 2 y 3 de tasks (P2-8).
  - **Recomendación: (a)**, compartida por critic y business en la ronda 1 (business descarta (c): cada invitado
    pasaría por «Email verificado» y seguiría viendo el aviso). Respuesta anotada con fecha aquí y en ADR-055 §1
    (tarea 0.1).
- **Q2 [resuelta en la ronda 1] Fila en `docs/design-v0.2.md` §6.** Fila **40**, fuera de `openspec-changes.yaml` por
  el mismo motivo que las filas 37 y 38, comprobando antes en las ramas abiertas que nadie la use (al 2026-11-25 solo
  `change/group-weekly-brief` añade una fila, la 39).
- **Q3 [resuelta en la ronda 1] Repetir la guía.** No se repite la pasada completa en este PR: M01, V03 y F03 quedan
  como corregidos y pendientes de la próxima pasada (D6), con la verificación manual acotada de D5.

## Debate (ronda 1)

Ronda 1 del 2026-11-25: critic, 0 P0 (3 P1, 9 P2); business, 0 V0 (1 V1 de producto, PO-3, y la Q3 como V1).

| id | decisión | motivo |
| --- | --- | --- |
| P1-1 | Aceptado | Con D2 el caso «Sin CV» del spec del diálogo pulsaba un «Analizar» que ya no existe. En 1.1 los casos `no_cv` (409 y 422) abren con el `GET` de la lista de CV en `500` o con un CV en la lista; en 1.2 el test «Sin CV» se reescribe como «Sin CV al abrir» (D1, tasks 1.1 y 1.2). El escenario de la spec conserva su nombre «Sin CV» con el contenido nuevo: OpenSpec no deja que un MODIFIED retire un escenario vigente. |
| P1-2 | Aceptado | `session.user()` puede ser `null` si el perfil responde `401` y el refresh falla. Solo se hace `setUser({...user, emailVerified: true})` con usuario; sin él, solo la fase `success`. Caso nuevo «el perfil responde 401 y el refresh falla: Email verificado, sin excepción» (D3, spec, tarea 2.2). |
| P1-3 | Adaptado | Se usa `cvs.isEmpty()` y la fase local va antes del permiso, pero solo sin `report` ni fallo de la API, como dice la spec; no por delante de todo (D2, spec, tarea 1.2). |
| P2-1 | Aceptado | `Promise.allSettled` antes de fijar `invalid` o `error`, para que la pista de invitados no parpadee; con su caso (D3, spec, tarea 2.1). |
| P2-2 | Aceptado | El test de la carrera va en un `describe` anidado con su propio `TestBed`, sin `clear()`, y `SessionRestore` sustituido por `useValue` (D3, tarea 2.1). |
| P2-3 | Aceptado | «Sin CV gana al permiso desconocido» llega a `consentLoadStatus` `failed` con `setSession`, `reloadConsent()` con `500` en `/api/users/me` y después abrir el diálogo (tarea 1.2). |
| P2-4 | Aceptado | Se oculta `match-routing` cuando `phase() === 'no_cv'`; «Ningún CV marcado» se mantiene (D2, spec, tarea 1.2). |
| P2-5 | Aceptado | El `500` lo cubre el caso existente «Avería del servidor» y la spec lo cita; `cv_not_ready` se prueba con un CV `pending` y `stopPolling` o fake timers (D1, spec, tarea 1.1). |
| P2-6 | Aceptado | `messages.xlf` puede no cambiar: se re-extrae y se commitea solo si hay diff (Risks, proposal, tarea 4.1). |
| P2-7 | Aceptado | El test de componente es la prueba de H2; V03 en la guía es solo un indicio. La rama ya se llama `change/usage-guide-fixes-2` (D3, D6). |
| P2-8 | Aceptado | Si Q1 = (c), se quitan `specs/web/email-auth`, `specs/web/auth` y los grupos 2 y 3 (Q1, tarea 0.1). |
| P2-9 | Aceptado | El ayudante se llama `isApiFailureCode(failure, code: ApiErrorCode)`, para no confundirse con `hasApiErrorCode` (D1, tarea 1.1). |
| PO-1, PO-2 | Sin cambios | H1 completo (D1 + D2) cubre el camino de primera vez; la redundancia de «Ningún CV marcado» es coherente. |
| PO-3 | Aceptado | La otra pestaña que no refresca el perfil va como riesgo conocido en «Fuera de alcance», con el change chico propuesto (volver a pedir el perfil al recuperar el foco mientras `emailVerified` sea `false`) si alguien lo reporta en 35b (proposal, Risks). |
| PO-4 | Aceptado | H3 es el primer recorte si el apply se atrasa (Goals / Non-Goals). |
| PO-5 a PO-9 | Sin cambios | H4-H10 siguen fuera de alcance. |
| Q1 | Pendiente del owner | Critic y business recomiendan (a); si el owner elige (c), aplica P2-8. |
| Q2 | Resuelta | Fila 40, comprobando antes que nadie la use en las ramas abiertas (tarea 0.1). |
| Q3 | Resuelta | Sin pasada completa: la verificación manual del PR es la corrida acotada de M01 y F03 más V03 repetido 5 veces, sin commitear capturas, y un recorrido a mano en staging antes de invitar, diferido a 35b (D5, tarea 6.1). |

**Convergencia: SI (2026-11-25, ronda 1: 0 P0 / 0 V0)**

**Aprobación humana:** Pendiente.
