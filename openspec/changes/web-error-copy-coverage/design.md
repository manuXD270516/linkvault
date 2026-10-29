## Context

**Hoy.** `lv-request-error` (`apps/web/src/app/shared/ui/request-error.ts`) recibe un `RequestFailure`
(`core/api/api-error.ts`: `api` con `status`, `code` y `retryAfterMinutes`; `offline`; `unknown`) y elige entre tres
textos: `too_many_attempts` con `429`, sin conexión, y «Algo salió mal. Inténtalo de nuevo» para todo lo demás. Cada
pantalla muestra antes sus mensajes propios con `isApiFailure` / `hasApiErrorCode` y delega el resto. Hay 42 usos de
`<lv-request-error>` en 31 ficheros. No tiene spec propio: lo cubren de rebote los specs de las pantallas, ocho de los
cuales afirman el genérico con un `500` (ninguno con `502`-`504`).

**Inventario de códigos** (`apiErrorCodeSchema`, 48 valores en `origin/main` `5b92d28`; estado HTTP de cada uno en
`apps/api/src/presentation/http/api-error.ts`). Un código «aparece» si su literal está en algún `.ts` no spec o
`.html` de `apps/web/src/app`:

- **37 aparecen**, casi todos traducidos por la pantalla que los provoca. `internal_error` aparece en dos sitios y en
  ninguno como respuesta HTTP: en `match.dialog.ts` como `failureCode` de un análisis fallido y en
  `cv-card.component.html:29` como `failureReason` de la lectura de un CV.
- **11 no aparecen:** `invalid_refresh`, `csrf_header_missing`, `unsupported_media_type`, `member_not_found`,
  `owner_cannot_leave`, `already_owner`, `preview_field_unknown`, `consent_text_outdated`, `vault_unavailable`,
  `empty_query` y `search_purge_failed`.

**Otros changes en planificación** (ramas `spec/*`, sin aprobar, leídas el 2026-10-28):

- `paste-fallback-honest` (ADR-060) añade `409 ai_consent_required`, `503 ai_capacity_exhausted` y `503
  extraction_disabled`, con sus textos en el diálogo de pegado (su D6). Su Migration Plan ya anota que un SPA viejo
  los mostraría con el genérico de `lv-request-error`.
- `enrichment-egress-guard` (ADR-056) añade el **motivo de enriquecimiento** `unsafe_destination`. No es un
  `ApiErrorCode`: vive en `EnrichmentFailureReason` y lo pinta `failureText` de `features/links/link-status.ts`, cuyo
  `default` lo convierte en «No pudimos leer esta oferta». Sus textos propios son su Q2.
- `web-shell-capabilities` (ADR-059) no añade códigos: oculta Buscar y Descubrir según `GET /api/capabilities` y
  dice «no incluida» / «no está activada en este entorno» en esas páginas. `search_unavailable`, `discovery_disabled`
  y `vapid_unavailable` siguen siendo códigos que traducen sus páginas.

**H3 y H11** (`docs/guia-de-uso/README.md`). H3: guardar una clave BYOK con la API en `503 vault_unavailable` muestra
«Algo salió mal». H11: `e2e.env` no trae `AI_VAULT_KEY`, por eso falla `byok.spec.ts`. `usage-guide-fixes` difirió los
dos a `e2e-suite-lot-2` (iteración 1 de su debate, 2026-10-08) con el argumento de que, con `AI_VAULT_KEY` obligatoria
en producción (`docker-compose.prod.yml:236,297`), nadie lo verá.

**Encaje.** La fila 35 tiene precedencia sobre cualquier otro change (ADR-048 §Consecuencias, extendida a la fila
entera por ADR-051 §1). `e2e-suite` (ADR-053) y `usage-guide-fixes` (ADR-055 §1) fueron excepciones concedidas;
`paste-fallback-honest`, `enrichment-egress-guard` y `web-shell-capabilities` las piden ahora.

## Goals / Non-Goals

**Goals**

- Que un fallo pasajero (`502`/`503`/`504`) no se diga igual que un fallo del producto.
- Que quien reporta un fallo inesperado pueda copiar algo que identifique la causa.
- Que cada código de la API tenga una decisión de texto escrita y comprobada, y que un código nuevo no pueda llegar a
  `main` sin ella, venga del change que venga.
- Textos propios solo donde el genérico lleva a repetir algo que vuelve a fallar.

**Non-Goals**

- Cambiar la API, sus códigos, sus estados o `libs/shared`.
- Rehacer los textos que ya traduce cada pantalla, ni los de los otros changes en planificación.
- Cubrir los motivos de enriquecimiento (Q3).
- Pruebas E2E nuevas: las que no llevan `@lot1` no cuentan como verificación (ADR-053), y una E2E para un texto de
  error costaría una pila entera para probar lo que prueba un test de componente.

**Fuera de alcance**

- **Capa 2 del guardia** (`apps/web/scripts/check-error-copy.ts` como cuarto comando de `web:i18n-check`: cada
  fichero de una entrada `local` existe y compara el código). Pasa a **después de 35c** (V1-2, iteración 1); queda
  anotada en el manifiesto. La regla de ADR-062 §3 se cumple con las capas 0 y 1.
- **Aviso de invitación de 35b** (V2-3, para `staging-host`, que no se edita aquí). Recomendación para su texto: «si ves
  un código bajo el error, manda una captura». Es lo que convierte la referencia de D2 en algo que llega al autor.

## Decisions

### D1. Resolución en dos pasos: por código, después por clase de estado

`lv-request-error` decide así (requirement «Mensajes comunes de fallo de una petición»):

1. `offline` → sin conexión (sin cambio).
2. `api` con un código que tiene texto común (D3) → ese texto. **Por código, sin mirar el estado**: el estado de cada
   código es fijo (`API_ERROR_STATUS`), así que el estado no añade información y exigirlo obligaría a duplicar el mapa
   de la API en el SPA. `too_many_attempts` pasa a resolverse así también (hoy exige además `429`; da igual).
3. `api` con estado `502`, `503` o `504` y **`code === null` o con un código cuya entrada en `API_ERROR_COPY` es
   `fallback`** → **servicio no disponible**: «LinkVault no está disponible en este momento. Inténtalo en unos
   minutos» (`@@error.unavailable`). El componente importa la tabla para decidirlo.
4. Todo lo demás → **fallo inesperado**: «Algo salió mal. Inténtalo de nuevo», con el mismo id `@@error.unknown`.
   Incluye `500`, cualquier `4xx` sin texto, `unknown` y un `5xx` con un código `local`, `unreachable` o que no está
   en la tabla.

**Por qué un `5xx` `local` no es «no disponible» (C1).** Un código `local` lo traduce su pantalla; si llega al
componente común es porque otra pantalla lo recibió sin preverlo, y no sabemos si es pasajero: `search_unavailable`,
`vapid_unavailable` y `discovery_disabled` son `503` y dicen que algo falta por configuración, igual que
`extraction_disabled` de `paste-fallback-honest`. Prometer «en unos minutos» sería falso; el fallo inesperado con la
referencia es lo honesto y deja el código a la vista. Lo mismo vale para un código que la tabla no conoce (un SPA viejo
frente a una API nueva).

El fallo inesperado conserva texto e id a propósito: los ocho specs de pantalla que lo afirman con `500` siguen
valiendo, el catálogo no cambia esa unidad y la persona ya lo conoce. Lo que cambia es que deja de abarcar lo
pasajero, y entonces sí significa «algo falló en el producto».

`502` y `504` entran porque los da el proxy (Traefik) sin cuerpo de la API, típicamente mientras `up` reinicia los
contenedores en un despliegue de staging: es el fallo pasajero más probable durante la medición de 35b.

*Alternativas descartadas:*
- **Clasificar solo por estado.** `vault_unavailable` es `503` y no es pasajero: diría «inténtalo en unos minutos», que
  es falso. El código tiene que ganar al estado.
- **Mapa código → estado en el SPA para exigir los dos.** Duplica `API_ERROR_STATUS` sin aportar nada; moverlo a
  `libs/shared` toca la API y metería en el bundle inicial un import de valor de `@linkvault/shared`, que
  `api-error.ts` evita a propósito.
- **Un texto nuevo para el fallo inesperado** («Algo falló en LinkVault…»). Rompe ocho specs y una unidad del catálogo
  sin que la persona gane nada que no le dé la referencia (D2).

### D2. Referencia técnica bajo los mensajes por clase

Con servicio no disponible y con fallo inesperado, si hubo respuesta HTTP, el componente pinta debajo «Si lo
reportas, menciona: <estado> · <código>» (`@@error.reference`; EN «If you report it, mention: …»), o «Si lo reportas,
menciona: <estado>» (`@@error.referenceStatusOnly`), en un elemento hermano **fuera** del `<p role="alert">`. El
código solo se pinta si es una clave de `API_ERROR_COPY` (C2): un cuerpo que no es de la API o un código que la tabla
no conoce da la variante solo con el estado, para no mostrar texto arbitrario de un cuerpo. La etiqueta dice para qué
sirve la línea (V1-1): quien no es técnico no sabe qué hacer con «Referencia». Así el lector de pantalla anuncia solo el mensaje, y `alertText()` de los specs existentes (p. ej.
`login.page.spec.ts:134`, que usa `toBe`) no cambia. No se pinta sin conexión, con `unknown` ni con un texto común.

Es lo que hace útil «me salió un error» en la conversación del día 14: una captura con «Si lo reportas, menciona: 409 ·
already_owner» señala un hueco del SPA; con «500 · internal_error», un fallo de la API que se busca en los logs por la
hora. El código no es un secreto (lo devuelve la API en claro) y el `message` sigue sin mostrarse.

*Alternativas descartadas:* nada (la persona no tiene qué reportar); un desplegable «Detalles» (un control más en 42
sitios, para dos palabras); un identificador de correlación por petición (requiere cambiar la API y los logs; puede
venir después sin cambiar este texto).

### D3. Qué códigos tienen texto común: criterio y lista

**Criterio** (requirement «Textos comunes por código»): un código tiene texto común si (a) la persona puede recibirlo
por un camino que el SPA ofrece, sin un defecto del SPA, y (b) el mensaje por clase la llevaría a reintentar algo que
vuelve a fallar. Y un código que dice que algo falta **por configuración** nunca cae en «no disponible en este
momento».

| Código | Estado | Clase | Por qué |
| --- | --- | --- | --- |
| `too_many_attempts` | 429 | `common` | ya lo era |
| `member_not_found` | 404 | `common` | carrera: la persona salió desde otra sesión; reintentar expulsar o nombrar propietario falla igual |
| `owner_cannot_leave` | 409 | `common` | carrera: te nombraron propietario con la página abierta; el detalle muestra «Salir» hasta recargar |
| `consent_text_outdated` | 409 | `common` | tras un despliegue que cambia la versión del texto, el SPA viejo envía la anterior; solo recargar lo arregla |
| `vault_unavailable` | 503 | `common` | por configuración (H3, Q2); la clase de estado diría «en unos minutos», que es falso |
| `internal_error` | 500 | `fallback` | es exactamente el fallo inesperado, con su referencia |
| `search_purge_failed` | 503 | `fallback` | pasajero (Meilisearch); el diálogo de borrar cuenta sigue abierto y «en unos minutos» es verdad |
| `invalid_refresh` | 401 | `unreachable` | la renovación fallida cierra la sesión y lleva a `/login` (`core/auth`); ningún formulario lo muestra |
| `csrf_header_missing` | 403 | `unreachable` | el SPA siempre envía `X-Requested-With`; si llega es un defecto del SPA y la referencia lo delata |
| `unsupported_media_type` | 415 | `unreachable` | el SPA siempre envía JSON o `multipart`; ídem |
| `preview_field_unknown` | 400 | `unreachable` | el editor solo envía campos del schema; ídem |
| `already_owner` | 409 | `unreachable` | el SPA no ofrece nombrarse propietario a sí mismo (comentario de `apiErrorCodeSchema`) |
| `empty_query` | 400 | `unreachable` | `/buscar` no envía una consulta vacía (`search.page.ts:135-138`) |
| los 35 restantes de `main` | — | `local` | los traducen los ficheros donde aparecen (lista del Context) |

Los tres de `paste-fallback-honest` (`ai_consent_required`, `ai_capacity_exhausted`, `extraction_disabled`) entran
como `local` con `features/links/paste-description.dialog.ts`, cuando existan (D6). Si alguno llegara a otra pantalla,
los tres serían fallo inesperado con referencia (paso 4 de D1, por ser `local`), también los dos `503`: para
`extraction_disabled`, que es configuración, eso evita prometer «en unos minutos».

`vapid_unavailable` es `local` con `core/notifications/push-notifications.ts`, que lo reconoce por el `503` y devuelve el
aviso propio de `/notificaciones`. Hoy la página pinta además `lv-request-error` con el mismo fallo; con D1 diría «Algo
salió mal» debajo de «El push no está disponible ahora». La tarea 3.3 deja de pintarlo con ese aviso (C1).

Los textos (ES/EN) están en el requirement. Usan el vocabulario que ya tiene el SPA: «propietario» y «nombra
propietario a otro miembro» (`@@groups.detail.ownerLeaveHint`), «permiso» (perfil), «claves de IA propias».

*Alternativas descartadas:*
- **Texto común para todos los códigos sin texto.** Doce textos más para casos que el SPA no ofrece: cada uno sería
  una promesa sin camino que la pruebe. Para esos, el fallo inesperado con referencia es lo honesto.
- **`search_purge_failed` con texto propio** («No pudimos borrar tu cuenta ahora; no se borró nada»). Mejor texto,
  pero el diálogo ya deja claro que no se borró (sigue abierto) y la búsqueda no está en staging (D13 de 35b): nadie
  de la medición lo verá. Puede volver si el debate lo pide.

### D4. La tabla `API_ERROR_COPY` y el guardia en dos capas (la tercera, diferida)

```ts
// apps/web/src/app/shared/ui/api-error-copy.ts — solo `import type` de @linkvault/shared (sin zod en el bundle)
export type ApiErrorCopy =
  | { readonly copy: 'common' }
  | { readonly copy: 'local'; readonly files: readonly [string, ...string[]] } // rutas bajo apps/web/src/app
  | { readonly copy: 'fallback'; readonly reason: string }
  | { readonly copy: 'unreachable'; readonly reason: string };

export const API_ERROR_COPY = { /* una entrada por código */ } as const satisfies Readonly<
  Record<ApiErrorCode, ApiErrorCopy>
>;
```

- **Capa 0, tipos:** `satisfies Record<ApiErrorCode, …>` hace que `web:typecheck` falle si falta un código o sobra
  uno, y dice cuál.
- **Capa 1, `api-error-copy.spec.ts` (`web:test`):** recorre `apiErrorCodeSchema.options` (el spec sí puede importar
  zod) y comprueba: cada código tiene entrada; ninguna entrada sobra; cada `fallback`/`unreachable` lleva un motivo no
  vacío; y la **coherencia en los dos sentidos** con el componente: renderiza `RequestError` con `{ kind: 'api',
  status: 500, code }` para cada código y exige que los `common` den un texto distinto de los dos mensajes por clase y
  sin referencia, y que **ningún otro** lo haga (con `500` todos los demás dan el fallo inesperado). Así una entrada
  `common` sin texto, o un texto en el componente sin su entrada, fallan nombrando el código. Además, «a 503 renders
  unavailable only for fallback codes or no code» recorre **todos** los códigos con `503` (C1): da el texto de no
  disponible si y solo si la entrada es `fallback` o no hay código. Recorrer el enum entero en vez de una lista de los
  que la API devuelve con `503` evita copiar `API_ERROR_STATUS` en el SPA y no se desfasa. Es la prueba de que la tabla
  no miente sobre el componente.
- **Capa 2 (diferida a después de 35c, V1-2):** un script `apps/web/scripts/check-error-copy.ts` en `web:i18n-check`
  que compruebe que cada fichero de una entrada `local` existe y compara el código. No entra en este change: las capas
  0 y 1 ya impiden que un código llegue a `main` sin decisión, que es lo que justifica la excepción de Q1, y la capa 2
  solo mejora la calidad de una decisión ya escrita. Hasta entonces, que una entrada `local` nombre el fichero que
  **compara** el código (no uno que solo lo nombra) se cuida en la tarea 1.1 y en la revisión del PR que añade el
  código.

`local` es, sin la capa 2, una **afirmación revisada**, no comprobada: el diff del PR muestra el fichero nombrado y la
revisión puede abrirlo. Aun con la capa 2 sería una condición necesaria, no suficiente: lo suficiente lo dan los specs
de cada pantalla.

*Alternativas descartadas:*
- **Solo el `Record` tipado.** No detecta la incoherencia con el componente.
- **Tabla en JSON.** Pierde el tipado contra `ApiErrorCode`, que es la falla más rápida.
- **La capa 2 en este change** (la propuesta original, cuarto comando de `web:i18n-check`). Descartada en la
  iteración 1 (V1-2): añade un script y un target modificado a una excepción que debe ser mínima, para una garantía
  que no cambia lo que ve nadie en la medición de 35b.
- **Leer los ficheros desde el spec de Vitest.** El runner de `@angular/build:unit-test` empaqueta para el
  navegador; no hay ningún `node:fs` en specs de `apps/web` y no conviene estrenarlo aquí.
- **Comprobarlo en `infra/ci/repo-checks.sh`.** Es de 35c y del flujo de despliegue; la Q1 excluye `infra/ci/`.

### D5. Textos e i18n (ADR-050)

Ids nuevos: `@@error.unavailable`, `@@error.reference`, `@@error.memberNotFound`, `@@error.ownerCannotLeave`,
`@@error.consentTextOutdated`, `@@error.vaultUnavailable`. `messages.xlf` sale de `pnpm nx run web:extract-i18n`; las
traducciones van en `messages.en.xlf` con su `source` vigente; `pnpm nx run web:i18n-check` en verde. La referencia
usa interpolaciones (`{{ status }}`, `{{ code }}`), y la variante sin código es otra unidad
(`@@error.referenceStatusOnly`) para no componer frases. El build de producción solo genera ES (fila 37 de §6); el
inglés se comprueba en el catálogo y en un test con la traducción cargada, como el resto del SPA.

### D6. Orden frente a los otros changes: el que llega segundo completa la tabla

- **Si `paste-fallback-honest` se fusiona antes:** la tarea 1.1 construye la tabla desde `apiErrorCodeSchema.options`
  **del momento de aplicar**, no desde la lista de este design, y sus tres códigos entran como `local` con el
  diálogo de pegado.
- **Si este se fusiona antes:** la tarea de `paste-fallback-honest` que añade los códigos al enum deja en rojo
  `web:typecheck` y `web:test` hasta que añade sus tres entradas. Es el comportamiento buscado. La sesión principal
  añade a su tarea 4.1, antes de su `/opsx:apply`, la línea de la tarea 0.3 (a) —las tres entradas `local` y la
  actualización de la cabeza del PR si `main` cambió `messages.xlf`, `auth.schema.ts` o `api-error-copy.ts` (C4)—,
  anotada en su tabla de debate como cambio posterior a la aprobación y con la conformidad del owner (C3). No se edita
  aquí: es otra rama. La 0.3 se comprueba por el contenido del PR, no por el nombre de la rama.
- **`web-shell-capabilities`:** si mueve la comparación de `search_unavailable`, `discovery_disabled` o
  `vapid_unavailable` a otro fichero, su change actualiza la entrada; sin la capa 2 nada lo detecta solo, y lo cuida
  la revisión de su PR.
- **`enrichment-egress-guard`:** sin interacción (los motivos de enriquecimiento no entran en la tabla, Q3).

Los cuatro tocan `apps/web/src/locale/messages.xlf`; el segundo en fusionarse re-extrae (ADR-050 §5).

### D7. Pide una excepción a la precedencia de la fila 35 (Q1)

**Por qué antes de invitar.** Todo el valor está en la medición de 35b: la primera semana de los invitados es la que
llena la conversación del día 14, y es cuando más despliegues hay (cada fusión de una excepción despliega en staging;
cada `up` da `502`/`504` durante segundos). Después de 35c, la medición ya terminó y el change sigue siendo útil, pero
solo para un producto sin usuarios.

**Por qué es una excepción barata.** Solo `apps/web` (el componente común, la plantilla de `/notificaciones`, una
tabla, specs y catálogo). Sin
API, `libs/*`, composes, workflows ni `infra/ci/`, ni requirements de `platform/*`. El riesgo es de regresión de
textos en 42 sitios, y lo acotan los specs de pantalla existentes (el fallo inesperado no cambia de texto) y la
repetición de la 9.4 de `e2e-suite`.

**Por qué no la primera.** Aporta menos que `paste-fallback-honest` (lleva a la persona a completar a mano en vez de
bloquearla) y que `enrichment-egress-guard` (seguridad con registro abierto). Si la ventana no da para todas, este
es el primero que pasa a después de 35c.

**Reglas, si se concede (las ya convergidas en los otros changes):**

1. **Tres clases de fusión.** (1) La fusión del change y sus correcciones: solo **después de la 11.6 de 35b y antes
   de su 10.7**, nunca con una corrida `e2e-remote` en curso. (2) El PR de archivo, con las anotaciones posteriores:
   **después de la 10.7**. (3) Las vueltas atrás y la vuelta de una vuelta atrás. Las clases 2 y 3: nunca entre el
   PR-2 de 35b y su 11.6, nunca durante la 9.1-9.4 de `e2e-suite`, nunca los días 7 y 14 de la medición ni el día de
   una corrida `e2e-remote`.
2. **Confirmación escrita y fechada del owner en el PR**, con la fecha del día de la fusión (si es anterior, se pide de
   nuevo). Clase 1: «11.6 hecha el AAAA-MM-DD; PR-2 de 35b = #NNN; 10.7 no hecha; sin `e2e-remote` hoy». Clases 2 y 3:
   «10.7 hecha el AAAA-MM-DD; PR-2 de 35b = #NNN; 9.1-9.4 no en curso; sin `e2e-remote` hoy» (una vuelta atrás antes
   de la 10.7 usa la forma de la clase 1). Las casillas de `staging-host/tasks.md` son solo apoyo; si el owner declara
   la 10.7 hecha, la clase 1 está fuera de ventana y no se fusiona.
3. **Comprobaciones previas a invitar repetidas sobre el último commit desplegado.** Tras la fusión de clase 1 y su
   despliegue, y antes de la 10.7, se repite la 9.4 de `e2e-suite` sobre el commit desplegado. Si en la ventana se
   fusionan varias excepciones, **basta una repetición tras la última**, siempre sobre el commit que esté desplegado
   el día de invitar.
4. **Toda fusión antes de la 10.7, correctivas incluidas, es de clase 1** (C8): lleva su confirmación del día, repite
   las comprobaciones de la tarea 6.1 (merge del PR-2 de 35b en `git log`, ningún job `e2e-remote` del día por `gh run
   view`, cabeza del PR al día) y la 9.4 se repite sobre la última. Las tareas 6.1, 6.3 y 6.4 copian las verificaciones
   y falsaciones de las 6.3, 7.3 y 7.4 de `paste-fallback-honest`.

**Si no se concede:** el change espera a archivar 35c y se aplica sin ventana; su fila del manifiesto no cambia de
sitio (el manifiesto no tiene forma de marcarla, igual que las otras excepciones pedidas).

La respuesta va a ADR-062 §1 en una línea «Respuesta del owner (Q1), AAAA-MM-DD:».

### D8. H3 entra aquí; H11 se queda en `e2e-suite-lot-2` (Q2)

`vault_unavailable` necesita una decisión en la tabla sí o sí (D4). Sin texto propio, como `fallback` diría «no
disponible en este momento. Inténtalo en unos minutos», que es **peor** que hoy: promete que reintentar sirve; como
`unreachable` diría «Algo salió mal» con la referencia (paso 4 de D1), que es lo mismo que denuncia H3. Así que el texto
de H3 es el coste natural del guardia (un texto y dos tests), y dejarlo en lot-2 obligaría a una entrada `unreachable`
falsa —el camino existe en cualquier pila sin `AI_VAULT_KEY`— o a aceptar un texto engañoso.

H11 es otra cosa: configuración de la pila e2e (`e2e.env`) y un spec E2E sin `@lot1`, que no cuenta como verificación
(ADR-053). Su sitio sigue siendo `e2e-suite-lot-2`.

Que el argumento de `usage-guide-fixes` («con la bóveda obligatoria en producción nadie lo verá») siga siendo cierto
no cambia esto: staging y producción no lo verán, pero el guardia necesita una decisión verdadera.

Cambiar el reparto que hizo un debate aprobado lo decide el owner (Q2). Si dice que no, la tarea 3.1 sale, la entrada
de `vault_unavailable` pasa a `common` igualmente (el texto no depende de H3) o, si el owner tampoco quiere el texto, a
`unreachable` con el motivo «solo en pilas sin `AI_VAULT_KEY`; H3 en `e2e-suite-lot-2`», aceptando por escrito que
mostrará el fallo inesperado con la referencia (con C1, un `503` `unreachable` ya no dice «no disponible»).

## Risks / Trade-offs

- **[Un `503` que no es pasajero dice «en unos minutos»]** → el criterio de D3 lo prohíbe para los códigos conocidos
  y la tabla obliga a decidir cada uno; con C1 solo los `fallback` y el `503` sin código lo dicen, y la 2.5 lo
  comprueba código por código. Queda el `503` sin código de un proxy mal configurado, que se ve como pasajero hasta que
  alguien mira la referencia («Si lo reportas, menciona: 503»).
- **[Una entrada `local` que nombra un fichero que no la traduce]** → sin la capa 2 (diferida, D4) nada lo comprueba
  solo; lo cuidan la tarea 1.1 y la revisión del PR. Si otra pantalla recibe el código, cae en el fallo inesperado con
  referencia: honesto, no ideal.
- **[Un aviso propio y el componente común a la vez]** → visto en `/notificaciones` con `vapid_unavailable` (tarea
  3.3). Puede haber otros casos donde una pantalla pinta su texto y además pasa el fallo a `lv-request-error`; con D1
  añadirían «Algo salió mal» bajo el texto propio. Los specs de pantalla que afirman el texto propio no lo detectan si
  no afirman también la ausencia del común; la 3.4 lo anota si aparece.
- **[Regresión de textos en 42 sitios]** → el fallo inesperado conserva texto e id; la tarea 3.4 corre todos los specs
  de `web` y anota cuáles cambian (se espera ninguno: los que afirman el genérico usan `500`).
- **[La referencia confunde a quien no es técnico]** → va fuera del `role="alert"`, en letra secundaria, después del
  mensaje. El debate (business) puede pedir otro texto o retirarla; la regla de cobertura no depende de ella.
- **[Choque de catálogo con otros changes]** → `messages.xlf` se re-extrae en el segundo PR (ADR-050 §5).
- **[Un change futuro añade un código y marca `unreachable` para salir del paso]** → el motivo queda escrito en la
  tabla y en el diff; la revisión del PR lo ve. El guardia obliga a decidir, no a decidir bien.
- **[La excepción se suma a otras tres pedidas]** → D7 la pone la última en prioridad y comparte la repetición de la
  9.4.

## Migration Plan

Sin datos ni migraciones. Un PR. Orden: tabla y capa 1 (grupo 1), componente (grupo 2), pantallas (grupo 3), catálogo
(grupo 4). La capa 2 queda para después de 35c (Fuera de alcance). Rollback: revertir el PR (clase 3 de D7 si hay excepción);
la API no cambia, así que un SPA anterior frente a la API de hoy vuelve al comportamiento de hoy.

## Open Questions

- **Q1 [bloqueante para `/opsx:apply`] Excepción a la precedencia de la fila 35.**
  - (a) Sí: se aplica en paralelo a 35b y se fusiona en la ventana de D7 (después de la 11.6, antes de la 10.7), con
    las tres clases de fusión, la confirmación fechada en el PR y la 9.4 repetida sobre el último commit desplegado;
    prioridad por detrás de `paste-fallback-honest` y `enrichment-egress-guard`.
  - (b) No: después de archivar 35c.
  - (c) Se aplica ya y se fusiona después de 35c (el PR espera abierto).
  - **Recomendación: (a)**, y si la ventana no da para todas las excepciones, (b) antes que (c): un PR abierto semanas
    se desfasa del catálogo y del enum.
- **Q2 [bloqueante para `/opsx:apply`] H3 en este change.**
  - (a) Sí: H3 se corrige aquí (requirement de `web/byok`, tarea 3.1); H11 sigue en `e2e-suite-lot-2`, cuyo `scope`
    se recorta en la tarea 5.2, y la guía de uso anota H3 como corregido.
  - (b) No: H3 sigue en lot-2 y `vault_unavailable` recibe igualmente su texto común (D8), sin el requirement de
    `web/byok`.
  - (c) No, y sin texto: `unreachable`, aceptando por escrito que dirá «Algo salió mal» con la referencia (con D1
    tras C1; antes de la iteración 1 decía «no disponible en este momento»).
  - **Recomendación: (a)**. El texto lo exige el guardia de todas formas; (a) solo añade el test de pantalla y deja
    H3 cerrado donde se arregla.
- **Q3 [no bloqueante] Motivos de enriquecimiento.** ¿Se extiende la misma regla a `EnrichmentFailureReason`, cuyo
  `default` en `failureText` convierte cualquier motivo nuevo (p. ej. `unsafe_destination`) en «No pudimos leer esta
  oferta»?
  - (a) No aquí; que lo decida la Q2 de `enrichment-egress-guard` o un change posterior.
  - (b) Sí: una segunda tabla y el mismo guardia en este change.
  - **Recomendación: (a)**. Son otra superficie (la tarjeta, no el componente común) y otro dueño; quitar el
    `default` del `switch` basta para que TypeScript lo exija, y eso es una línea del change que añade el motivo.

## Debate — iteración 1

2026-10-28. `critic`: 1 P0 (C1) y 9 P1 (C2-C10). `business`: 0 V0, 2 V1 (V1-1, V1-2) y 4 V2 (V2-1 a V2-4). Decisiones de
`reflect`. Q1 y Q2 siguen pendientes del owner. Las tareas se renumeraron: la 1.3 sale; la 2.1 se parte en 2.1 y 2.2,
y las antiguas 2.2, 2.3 y 2.4 pasan a 2.3, 2.4 y 2.5; la 3.3 nueva es `/notificaciones` y la antigua 3.3 pasa a 3.4.

| Id | Origen | Decisión | Motivo |
| --- | --- | --- | --- |
| C1 | critic (P0) | Aceptado. El paso 3 de D1 aplica solo con `code === null` o una entrada `fallback`; un `5xx` `local`, `unreachable` o fuera de la tabla es fallo inesperado con referencia, y el componente importa la tabla. Caso «a 503 renders unavailable only for fallback codes or no code» en la 2.5, con `it.each` sobre todos los códigos con `503`. `/notificaciones` no pinta `lv-request-error` con el aviso `vapid_unavailable` (tarea 3.3). D3 corregido para `extraction_disabled`; Q2 (c) y D8 corregidos en consecuencia | `search_unavailable`, `vapid_unavailable`, `discovery_disabled` y `extraction_disabled` son `503` de configuración: «en unos minutos» era falso, y en `/notificaciones` habría salido «Algo salió mal» debajo del aviso propio |
| C2 | critic | Aceptado. La referencia pinta el código solo si es clave de `API_ERROR_COPY`; si no, `@@error.referenceStatusOnly`. Caso «an unknown body code shows only the status» en la 2.3 | No pintar texto arbitrario de un cuerpo que no controlamos |
| C3 | critic | Aceptado. La 0.3 se cumple con (a) una línea en la 4.1 de `paste-fallback-honest`, anotada en su tabla de debate como cambio posterior a la aprobación y con la conformidad del owner, o (b) paste ya en `main`; se verifica por el contenido del PR (`gh pr view <n> --json files`), no por la rama. La rama de paste no se edita aquí | El nombre de una rama no prueba nada; editar un change aprobado necesita registro y conformidad |
| C4 | critic | Aceptado. La 6.1 y la línea para paste exigen actualizar la cabeza del PR y esperar CI verde si `main` cambió `messages.xlf`, `auth.schema.ts` o `api-error-copy.ts` desde la última corrida | Dos PR verdes por separado pueden dejar `main` en rojo (ADR-050 §5, ampliado a la tabla y al enum) |
| C5 | critic | Aceptado en parte. La 1.1 busca en `*.ts` y `*.html`, y cada `local` anota el fichero que compara el código. Context corregido: `internal_error` también está en `cv-card.component.html:29`. La parte de C5 sobre la capa 2 queda sin objeto (V1-2) | Un fichero que solo nombra el código no prueba que lo traduzca; el recuento de 37/11 no cambia con `*.html` |
| C6 | critic | Aceptado. La falsación «clasificar solo por estado» pasa a la tarea de textos comunes (2.4); la 2.1 se falsa con «503 without own text shows unavailable»; la 2.1 se parte en 2.1 (no disponible) y 2.2 (fallo inesperado), y la 2.3 y la 2.4 llevan su propio comando de verificación | Cada falsación debe hacer caer un test de su propia tarea |
| C7 | critic | Sin objeto | Era sobre la capa 2, que sale del change (V1-2) |
| C8 | critic | Aceptado. La 6.1, 6.3 y 6.4 copian las verificaciones y falsaciones de las 6.3, 7.3 y 7.4 de `paste-fallback-honest`: merge del PR-2 de 35b en `git log`, falsación con la 10.7 hecha, job `e2e-remote` del día por `gh run view`, confirmación fechada en cada fusión. Toda fusión antes de la 10.7, correctivas incluidas, es de clase 1 y repite las comprobaciones sobre la última (regla 4 de D7) | Las reglas ya convergidas en otro change no se reescriben más débiles |
| C9 | critic | Aceptado. La 5.2 anota ADR-050 §2 sin depender de Q2: la cobertura se comprueba en `web:typecheck` y `web:test`, y la capa 2 queda diferida. La línea de ADR-050 ya refleja eso | La anotación decía que `web:i18n-check` corre un script que ya no existe en el change |
| C10 | critic | Aceptado. La verificación de la 5.2 cuenta `vault_unavailable` solo dentro del bloque de `e2e-suite-lot-2`, con `awk` | Un `grep -c` del fichero entero cuenta también la fila de este change |
| V1-1 | business | Aceptado. La etiqueta pasa a «Si lo reportas, menciona: 500 · internal_error» / «If you report it, mention: 500 · internal_error», en el mismo lugar y fuera del `role="alert"`; ajustados `@@error.reference`, `@@error.referenceStatusOnly`, el requirement y los títulos de los tests | «Referencia» no dice a quien no es técnico qué hacer con la línea |
| V1-2 | business | Aceptado (recorte). La capa 2 (antigua 1.3) pasa a después de 35c, anotada en «Fuera de alcance» y en el manifiesto; la excepción queda en las capas 0 y 1. C7 y la parte de capa 2 de C5 quedan sin objeto | Las capas 0 y 1 ya impiden un código sin decisión; la 2 no cambia nada visible en la medición y agranda la excepción |
| V2-1 | business | Aceptado. `consent_text_outdated`: «El texto del permiso cambió. Recarga la página para leer la versión vigente» / «The consent text changed. Reload the page to read the current version» | Texto propuesto por `business`; más corto y sin suponer cuándo cambió |
| V2-2 | business | Aceptado. `vault_unavailable`: «Las claves de IA propias no están activadas en LinkVault. No se guardó nada» (EN, de `reflect`: «Your own AI keys are not enabled in LinkVault. Nothing was saved») | Texto propuesto por `business`; «en este entorno» es vocabulario de quien desarrolla |
| V2-3 | business | Aceptado como recomendación para 35b, en «Fuera de alcance»: el aviso de invitación dice «si ves un código bajo el error, manda una captura». No se edita `staging-host` | El aviso de invitación es de 35b |
| V2-4 | business | Sin cambios | Decisión de `reflect` |
