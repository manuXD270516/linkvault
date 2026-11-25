## Context

La guía de uso del 2026-11-25 dejó tres hallazgos de producto, H1-H3 (`docs/guia-de-uso/README.md`, «Hallazgos»;
casos M01, V03 y F03). Este design localiza cada uno en el código (lectura del 2026-11-25 sobre `main` en `a6e943be`)
y en la spec que lo gobierna, y decide cómo corregirlo. H4-H8 quedan fuera (proposal, «Fuera de alcance»).

| Hallazgo | Causa raíz en el código | Spec vigente |
| --- | --- | --- |
| H1 | `apps/web/src/app/features/match/match.dialog.ts`, `matchProblem`: compara `job_not_ready`, `no_cv`, `cv_not_ready` y `cv_not_readable` con `isApiFailure(failure, 422, …)`, pero `apps/api/src/presentation/http/api-error.ts` los mapea a `409` (como exige `cv/match`). Ningún caso coincide y el fallo cae en la rama final `{ kind: 'server' }` → «No pudimos analizar ahora.». Los tests de `match.dialog.spec.ts` simulan `apiError('no_cv', 422)`, un status que la API nunca envía, y por eso pasaban. Además `phase` nunca mira la lista de CV: con `cvs.loaded()` y la lista vacía sigue en `idle` y ofrece «Analizar». | `web/cv-match` «Falta tu CV»; `cv/match` (los cuatro rechazos son `409`) |
| H2 | `apps/web/src/app/features/auth/verify-email.page.ts`, `verify()`: tras el `POST /api/auth/verify-email` decide con `session.isAuthenticated()` **en ese instante**. Con la carga completa que provoca abrir el enlace del correo, `SessionRestore` (`core/auth/session-restore.ts`) arranca el refresh en el initializer y `/verificar-email` no tiene guard que lo espere, así que el refresh y la verificación corren en paralelo. Si la verificación responde primero, la sesión aún está en `unknown`, la página no pide el perfil, y el refresh llega después con el `user` que el servidor leyó **antes** de confirmar la verificación (`emailVerified` `false`): `needsEmailVerification` sigue en `true` hasta recargar. Aparte, si el `GET /api/users/me` posterior falla, el `catch` común convierte una verificación correcta en la fase `error`. | `web/email-auth` «Página de verificación por enlace»; `web/auth` «Aviso de email no verificado» |
| H3 | `apps/web/src/app/features/profile/profile.page.ts`, `changePassword()`: si el formulario es inválido, hace `markAllAsTouched()` y **vuelve antes** de `passwordFailure.set(null)`, así que «La contraseña actual no es correcta» del intento anterior queda en pantalla junto al error nuevo. En `profile.page.html`, los dos `mat-form-field` de contraseña usan el subíndice de alto fijo de Material: el `mat-error` «La nueva contraseña debe tener al menos 10 caracteres y no puede ser tu email» ocupa dos líneas a ese ancho y desborda sobre el párrafo siguiente (captura `040-perfil-contrasena-nueva-corta`). | `web/auth` «Perfil, cambio de contraseña y logout» |

Auditoría hecha para acotar H1: todas las llamadas a `isApiFailure(…, status, code)` de `apps/web/src` se compararon
con `API_ERROR_STATUS` de la API; las únicas que no coinciden son estas cuatro del diálogo de encaje.

## Goals / Non-Goals

**Goals:** que el diálogo de encaje llegue a los estados de CV y de oferta sin leer que ya tiene, y que sin CV lo diga
desde que se abre; que verificar el email quite el aviso sin recargar, sea cual sea el orden en que respondan el
refresh y la verificación; que el formulario de contraseña muestre solo el resultado del último intento, sin textos
superpuestos. Cada arreglo con un test que reproduce el defecto antes de corregirlo y cae si vuelve.

**Non-Goals:** H4-H10 (proposal); cambiar el contrato de la API o los status de `cv/match`; rediseñar el diálogo de
encaje o la página de verificación; textos nuevos; E2E nuevos obligatorios.

## Decisions

### D1. H1: el diálogo reconoce los rechazos del análisis por su código

**Decisión.** Un ayudante nuevo en `core/api/api-error.ts`, `hasApiCode(failure, code)` (`failure.kind === 'api' &&
failure.code === code`), y `matchProblem` lo usa para `job_not_ready`, `no_cv`, `cv_not_ready` y `cv_not_readable`.
`isApiFailure` no cambia y el resto de llamadas tampoco. Los tests del diálogo pasan a simular el status real (`409`).

**Por qué el código y no el status.** El código es lo que el SPA traduce (`api-error.ts` de la API lo dice: «El SPA
traduce el código, no el mensaje»), cada código tiene un único significado y la tabla código → status vive solo en la
API. Repetir el status en el SPA es una segunda fuente de verdad que ya divergió una vez sin que ningún test lo viera.

**Alternativas descartadas.**

- (A) Cambiar `422` por `409` en las cuatro comparaciones: arregla hoy, pero deja la misma trampa para la próxima vez
  que cambie un status, y los tests seguirían fabricando el status a mano.
- (B) Mirar solo el status `409`: confundiría los cuatro códigos entre sí y con cualquier otro `409`.
- (C) Exportar la tabla código → status desde `libs/shared` y usarla en el SPA y en los tests: es lo más sólido contra
  la divergencia, pero toca la API y todos los códigos; fuera de alcance (proposal).

**Guardia.** Los tests de los cuatro estados simulan `409` y uno de ellos (`no_cv`) se repite con otro status (`422`)
para fijar que lo que manda es el código. Falsación: volver a `isApiFailure(failure, 422, 'no_cv')` hace caer el caso
de `409`.

### D2. H1: sin CV, el diálogo lo dice al abrirse y no ofrece «Analizar»

**Decisión.** Una fase local: si `cvs.loaded()` y la lista de CV está vacía, `phase` es `no_cv` y el diálogo muestra
el estado que ya existe (`data-testid="match-no-cv"`, «Necesitas un CV guardado para analizar tu encaje.» con «Subir
mi CV», que lleva a `/mi-cv` y cierra con `{ kind: 'change-cv' }`). No se pinta «Analizar» y no se llama a la API.

- **Precedencia.** Esta condición se evalúa **antes** que las del permiso (`consent_checking`, `consent_unknown`): sin
  CV no hay nada que mandar a ningún sitio, así que preguntar por el permiso no ayuda; «Subir mi CV» es la única salida
  útil y el diálogo nunca queda sin salida. El `no_cv` que viene de la API (D1) conserva su lugar actual.
- **Por qué la lista y no `defaultCv`.** «Ningún CV marcado» se pinta con `defaultCv() === null`, pero `cv/documents`
  garantiza que mientras haya al menos un CV hay exactamente uno marcado; la lista vacía es el hecho que decide, y no
  depende de esa invariante.
- **Si la lista no cargó** (`loaded` en `false` por un fallo), el diálogo no sabe nada: «Analizar» sigue disponible y,
  si la API responde `409 no_cv`, D1 lleva al mismo estado.
- **CV subido en otra pestaña.** Volver de `/mi-cv` reabre el diálogo con un `CvStore` nuevo (proveedor del propio
  diálogo), así que el estado se recalcula; sin pasar por `/mi-cv`, cerrar y reabrir basta.
- Borrar un CV borra sus análisis (`cv/match`, «Revocar el consentimiento y borrar el CV»), así que sin CV no hay
  informe anterior que la fase local pudiera tapar.

**Alternativas descartadas.**

- (A) Dejar «Analizar» deshabilitado: un botón gris no dice por qué ni qué hacer, y `web/cv-match` exige que estos
  estados terminen siempre en una acción.
- (B) Dejar «Analizar» activo y confiar en el `409` (solo D1): obliga a un viaje inútil a la API para enseñar algo que
  el diálogo ya sabe al abrirse.

### D3. H2: la verificación espera a la restauración de la sesión

**Decisión.** `VerifyEmailPage.verify()` lanza en paralelo el `POST /api/auth/verify-email` y
`SessionRestore.restore()` (idempotente: devuelve la misma promesa si ya arrancó o ya terminó) y espera a los dos.
Solo entonces, si la sesión está `authenticated`, pide `GET /api/users/me`. Esa petición sale cuando la verificación
ya está confirmada en el servidor, así que el perfil que llega trae `emailVerified` `true` con cualquier orden de
respuestas. La espera añade, como mucho, lo que tarde el refresh ya en curso (tope de 10 s de
`SESSION_RESTORE_TIMEOUT_MS`), mientras la página dice «Comprobando el enlace…».

- **El perfil falla después de verificar.** La verificación ya ocurrió: la página SHALL decir «Email verificado» y el
  perfil en memoria pasa a `emailVerified` `true` con `session.setUser({ ...user, emailVerified: true })`, en vez de
  la fase `error`. El fallo de la verificación en sí sigue como hoy (`invalid_token` → enlace no válido; otro → error).
- **Sin sesión** (la restauración termina en `anonymous`): igual que hoy, «Ir a iniciar sesión» y ninguna petición del
  perfil. Ya no se ve primero «Ir a iniciar sesión» y luego «Ir a la aplicación», porque la fase `success` se fija con
  la sesión ya resuelta.

**Alternativas descartadas.**

- (A) Marcar `emailVerified` `true` en local al terminar la verificación, sin esperar: un refresh que llega después
  pisa el `user` con el perfil viejo; es la misma carrera.
- (B) Que `setSession` no deje volver `emailVerified` de `true` a `false`: arregla el síntoma metiendo una regla de
  negocio en el store de sesión, y esconde cualquier otro desfase entre el perfil del refresh y el real.
- (C) Poner un guard en `/verificar-email`: la ruta es pública y sin `guestGuard` a propósito (`app.routes.ts`); un
  guard cambiaría a dónde redirige y qué ve quien no tiene sesión.

**Guardia.** Un test de la página con la sesión en `unknown` (store recién creado, sin `clear()`) que responde
primero la verificación y después el refresh con `emailVerified` `false`, y comprueba que se pide el perfil después
del refresh y que el aviso no queda. Falsación: quitar la espera de `restore()` hace caer ese caso.

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

### D6. La guía de uso

El README de la guía se genera con `tools/guia-de-uso/build-guide.mts` a partir de `resultados.json` y `meta.mts`, y
una corrida completa tarda unos 25 minutos y rehace todas las capturas. Este change:

- ajusta `capture.mts` para que la próxima pasada compruebe el comportamiento nuevo: en M01, el diálogo de Beto abre
  ya en `match-no-cv` y no tiene `match-analyze`; en F03, tras el intento con la nueva corta, «La contraseña actual no
  es correcta» ya no está; V03 no cambia (ya detecta el aviso que persiste);
- mueve H1-H3 de «Hallazgos» a la línea de corregidos en `build-guide.mts`, y lo mismo, a mano, en el README de la
  guía, diciendo que están **corregidos por este change y pendientes de comprobar en la próxima pasada**. No marca
  como OK lo que nadie ha vuelto a mirar.

Repetir la pasada entera ahora es la Q3.

## Risks / Trade-offs

- **`hasApiCode` ignora el status.** Si un día dos status distintos llevan el mismo código con significados distintos,
  el diálogo no los distinguiría. Hoy la API garantiza un status por código (`API_ERROR_STATUS` es un `Record` sobre
  `ApiErrorCode`), así que el riesgo es teórico; la alternativa C lo cerraría del todo.
- **La verificación espera al refresh.** Con la API lenta, «Comprobando el enlace…» puede durar hasta el tope de 10 s
  del refresh. Es el mismo tope que ya paga cualquier ruta con guard al cargar.
- **Fase local `no_cv` y una lista de CV desfasada.** Si alguien sube un CV en otra pestaña con el diálogo abierto, el
  diálogo seguirá diciendo que falta hasta reabrirlo. «Subir mi CV» lleva a `/mi-cv`, donde ya está, y al volver el
  diálogo se reabre con la lista nueva.
- **`messages.xlf` cambia sin cambiar textos.** Las plantillas tocadas mueven números de línea del catálogo; se
  regenera con `pnpm nx run web:extract-i18n` y `web:i18n-check` lo comprueba (ADR-050). `messages.en.xlf` no cambia.

## ADR

No hace falta un ADR nuevo: las cuatro decisiones son locales al SPA, no cambian contratos, datos ni dependencias, y
siguen reglas ya escritas (`cv/match`, `web/cv-match`, `web/email-auth`, `web/auth`, el patrón de `usage-guide-fixes`
D5/D10). Si el owner concede la excepción de la Q1, su respuesta se anota con fecha en este design y en una línea de
ADR-055 §1 (que decía que su excepción no liberaba la precedencia para ningún otro change); si al anotarla hiciera
falta razonar algo más que la respuesta, el siguiente número libre en todas las ramas es **ADR-070** (ADR-069 existe en
`change/group-weekly-brief`).

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] Precedencia de la fila 35.** Según ADR-048 §Consecuencias y ADR-051 §1,
  ningún change de otra fila entra entre medias de la fila 35 (35b sigue abierta), y ADR-055 §1 dejó dicho que la
  excepción de `usage-guide-fixes` no liberaba la precedencia para ningún otro change. ¿Se aplica y fusiona este change
  antes de cerrar la fila?
  - (a) Sí, como excepción de la misma clase que ADR-055 §1: solo SPA, sin despliegue ni `platform/*`, y corrige
    pantallas que verán las personas invitadas en 35b.
  - (b) No: se prepara y espera a archivar la 35c.
  - (c) Sí, pero solo H1 (el único que la guía marcó como FALLO).
  - **Recomendación: (a).** Respuesta anotada con fecha aquí y en ADR-055 §1 (tarea 0.1).
- **Q2 [no bloqueante] Fila en `docs/design-v0.2.md` §6.** La 39 la usa `group-weekly-brief` en su rama. Propuesta:
  fila **40**, con la marca de excepción a la precedencia según la Q1, y fuera de `openspec-changes.yaml` por el mismo
  motivo que las filas 37 y 38 (el manifiesto lo ejecuta todo en orden). **Recomendación:** así; si el owner prefiere
  la entrada en el manifiesto, se añade en la tarea 0.1.
- **Q3 [no bloqueante] Repetir la guía.** ¿Se repite la pasada completa de la guía en este PR para ver M01, V03 y F03
  en OK con capturas nuevas (unos 25 minutos más la pila, y un diff con todas las capturas rehechas), o se dejan
  marcados como corregidos y pendientes de la próxima pasada (D6)? **Recomendación:** la próxima pasada; este PR
  queda pequeño y los tests de componente fijan el comportamiento.
