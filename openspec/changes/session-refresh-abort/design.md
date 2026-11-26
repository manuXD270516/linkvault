## Context

Hallazgo del 2026-11-25 en la guía de uso (sección `movil`, Pixel 7, `page.goto` cada 1,5 s). Evidencia del `api.log`
de la pila e2e, peticiones con `sec-ch-ua-platform: "Android"` emparejadas por `req.id`:

| `req.id` | Ruta | Resultado | Tiempo |
| --- | --- | --- | --- |
| `req-al` | `login` | `200` | 250 ms |
| `req-an` | `refresh` | «request aborted» | 167 ms |
| `req-ao` … `req-aq` | `refresh` | `409` ×3 (primera carga: intento + 2 reintentos) | `req-ao` 502 ms |
| `req-ar` … `req-au` | `refresh` | `409` ×4 (segunda carga: intento + 3 reintentos) | — |
| `req-av` | `logout` | `204` (reintentos agotados) | 23 ms después de `req-au` |
| `req-aw` … `req-b3` | `refresh` | `401` ×9 | — |

El `409` de `req-ao` solo es posible si `req-an` llegó a confirmar la rotación (`rotatedAt` no nulo): el servidor rotó, el
navegador abortó la petición al navegar y nunca aplicó el `Set-Cookie` del sucesor. Los 502 ms de `req-ao` son coherentes
con el reintento de `withTransaction` mientras la transacción de `req-an` terminaba.

Estado actual del código (`main` bed83af6):

- `domain/refresh-session.ts:108-112`: token rotado → `conflict` si hace menos de `REFRESH_CONFLICT_WINDOW_MS` (10 s),
  `reuse` si no. No mira si el sucesor se usó.
- `infrastructure/mongo-session.repository.ts:188-196`: `reuse` revoca la sesión; `:201-247` marca el token e inserta el
  sucesor en una transacción que no depende de que la respuesta llegue.
- Solo se guarda `sha256` del sucesor (`application/refresh-token.ts`, spec «Refresh token no guardado en claro»): no se
  puede reenviar el mismo token.
- `presentation/auth.controller.ts:112-113`: el comentario asume que un `409` significa que otra petición del mismo
  navegador ya fijó la cookie del sucesor.
- SPA: `core/auth/auth.api.ts:178-199` reintenta 3 veces ante `409` y llama a logout al agotar (ADR-020 §3);
  `core/auth/session-restore.ts:46-55` **aborta su propia petición** a los 10 s, de modo que una rotación confirmada
  tarde tampoco llega a la cookie. `logout.usecase.ts` revoca la sesión también con un token ya rotado.

La premisa de ADR-020 §3 («un token rotado hace < 10 s es un refresh concurrente del mismo navegador, que ya tiene la
cookie del sucesor») no se cumple cuando la respuesta de la rotación se pierde. Ningún reintento del cliente puede
recuperar esa sesión: la cookie sigue siendo el token viejo y el servidor no puede volver a entregar el sucesor.

## Goals / Non-Goals

**Goals:**

- Una respuesta de rotación perdida no cuesta la sesión si el cliente vuelve dentro de la ventana de 10 s (recargar o
  navegar con el refresh en vuelo).
- La restauración del SPA que agota sus 10 s deja de cancelar su propia petición, para que una rotación tardía llegue a
  la cookie (D9).
- La detección de reuso no cambia fuera de la ventana; dentro de la ventana, el riesgo nuevo queda escrito con
  honestidad (R1, ADR-072) y lo aprueba el owner (Q1).
- Seguir guardando solo hashes; ningún secreto nuevo en Mongo ni en logs.
- Test que reproduce el bug antes de cada arreglo, en dominio, repositorio (replset de `mongodb-memory-server`), HTTP,
  SPA y navegador.

**Non-Goals (fuera de alcance):**

- Recuperar respuestas perdidas pasada la ventana (cerrar la pestaña a mitad del refresh y volver más tarde): Q2, se
  mide en 35b (tarea 4.1).
- Cambiar la política de reintentos del SPA o de la extensión, la ventana de 10 s, el TTL o la cookie.
- Atar el refresh token al cliente (prueba de posesión): es la mitigación de fondo de R1 y queda para otro change.
- `apps/extension`: guardar el `refreshToken` recibido solo si el almacenado sigue siendo el que se presentó
  (compare-and-set en `chrome.storage`), para cerrar R6 en la extensión. Change aparte (H4).
- Diferenciar en el aviso de reuso un sucesor nunca usado de uno usado: Q4, diferida.

## Decisions

### D1. El arreglo de fondo va en la API; el SPA solo deja de abortar su restauración

El bug no es del cliente: aborta peticiones por motivos legítimos (navegación, cierre, red) y el servidor confirma igual.
Reintentar más o con otro backoff ante `409` no sirve (la cookie no cambia entre intentos) y, al agotar, el logout
revoca la sesión. El SPA y la extensión ya tratan `200` tras `409` como éxito; con D2 dejan de ver ese `409` en el caso
del bug sin tocar su lógica de reintentos. En el SPA cambia una sola cosa, que sí es suya: la restauración que agota los
10 s deja de cancelar la petición (D9). Regresión de punta a punta en `apps/web-e2e` (D8).

### D2. Reemisión: un token rotado hace menos de 10 s cuyo sucesor no se usó emite un hermano nuevo

`RefreshSessionPolicy.decide` gana el resultado `reissue`. Para un token rotado hace menos de 10 s:

- si **ni su sucesor ni ningún hermano de ese sucesor se usó** (`advanced = false`), el token se rotó con esta versión
  (D5) y lleva menos de `REFRESH_REISSUE_LIMIT` reemisiones → `reissue`: se inserta un refresh token nuevo de la misma
  sesión, hijo del token presentado, y se responde `200` como una rotación (cookie nueva en web, `refreshToken` en el
  cuerpo en extensión);
- si no → `conflict` (`409`, como hoy).

Fuera de la ventana nada cambia: `reuse`, revocación y aviso. El token presentado conserva `rotatedAt` y `replacedByHash`
(primer hijo); la reemisión suma 1 a `reissueCount` y escribe sobre él (D3).

**Por qué un hermano y no el mismo sucesor:** el servidor solo tiene el hash del sucesor. Reenviar el mismo par exigiría
guardar el token en claro o cifrado (alternativa B), contra ADR-020 §1 y el escenario «Refresh token no guardado en claro».

### D3. El primer hermano usado deja superados a los demás, y las dos escrituras chocan en el padre

Cada refresh token nuevo guarda `parentHash` (hash del token que lo originó). Al **rotar** un token `C` con `parentHash`
`P`:

1. se escribe siempre en `P` (`$set: { advancedAt: now }`; `advancedAt` = «la familia ya avanzó más allá de este
   token»);
2. los hermanos de `C` sin rotar (`parentHash = P`, `rotatedAt = null`, distinto de `C`) quedan **superados**:
   `rotatedAt = now` y `advancedAt = now`, sin sucesor;
3. sigue la rotación normal de `C`.

Un token sin `parentHash` (emitido por login, registro o una versión anterior) no tiene hermanos y no escribe padre.

Un hermano superado se comporta como un token rotado cuyo sucesor ya se usó: `409` dentro de 10 s desde que se superó y,
después, reuso con revocación de la sesión. Nunca se reemite (`advanced = true`).

**Serialización.** La reemisión sobre `P` hace `updateOne({ tokenHash: P, advancedAt: null, reissueCount: { $exists:
true, $lt: límite } }, { $inc: { reissueCount: 1 } })` dentro de la misma transacción que inserta el hermano; la rotación
de un hijo escribe `P` en el paso 1. Las dos transacciones escriben el mismo documento, así que una recibe
`WriteConflict`, `withTransaction` la reintenta y relee: o la reemisión ve `advancedAt` y devuelve `conflict`, o la
rotación ve al hermano nuevo y lo supera. Sin esa escritura común, el `updateMany` del paso 2 no vería un hermano
insertado en paralelo (fantasma de snapshot) y quedarían dos hojas vivas. La escritura del paso 1 tiene que modificar el
documento (un `$set` con el mismo valor no genera conflicto); por eso usa `now`.

**Invariante:** una vez usado un token de una generación, la sesión tiene como mucho una hoja viva por cadena. Lo
prueban 1.5 y 1.6 intercalando dos transacciones de forma determinista en los dos órdenes (H3), con un punto de pausa
inyectable solo en tests; la carrera repetida con `Promise.all` queda como prueba complementaria.

### D4. Ventana anclada a la primera rotación y tope de 3 reemisiones

`rotatedAt` no se mueve al reemitir: la reemisión no extiende los 10 s que ADR-020 ya aceptó. `REFRESH_REISSUE_LIMIT = 3`
(constante de dominio, sin variable de entorno): en el patrón observado (una carga cada 1,5 s) bastan 1 o 2; 3 deja
margen para recargas repetidas y acota a 4 los hermanos vivos de un token. Pasado el tope, `409` como hoy.

**El tope no es la palanca de R1** (H9): a quien gana la carrera le basta una reemisión, así que un tope de 1 lo deja
igual de expuesto. El tope solo limita cuántos hermanos vivos puede acumular un token. Lo que reduce R1 es la duración
de la ventana o atar el token al cliente, y las dos cosas quedan fuera de este change.

### D5. Modelo de datos sin migración y sin recuperación para tokens rotados antes del despliegue

`RefreshTokenDocument` suma tres campos opcionales: `parentHash: string | null`, `advancedAt: Date | null` y
`reissueCount: number`. Índice no único `{ parentHash: 1 }` para el paso 2 de D3. `StoredRefreshToken` los expone;
`RefreshTokenState` del dominio recibe `advanced` (`advancedAt` no nulo) y `reissueCount` (`null` si falta).

**Regla simple para los documentos anteriores (H2):** la rotación nueva escribe `reissueCount: 0` en el token que marca
como rotado, y la reemisión exige que el campo exista. Un token rotado por la versión anterior no tiene el campo y
responde `409` como hoy. Se renuncia al respaldo por `replacedByHash`: no hay que razonar sobre familias a medias. Coste
aceptado: durante unos 10 s alrededor del despliegue, una respuesta perdida se pierde como hoy.

### D6. Mismas reglas para web y extensión

`rotate` es compartido (`expectedClient`). La extensión pierde respuestas por el mismo motivo (el service worker se
suspende a mitad de la petición) y su spec ya dice «mismas reglas de TTL y reuso que `auth/sessions`». El aislamiento de
cliente se comprueba antes de decidir, como hoy. La parte del cliente de la extensión (R6) va en un change aparte.

### D7. Resultado y aviso operativo

`RotationResult` `rotated` suma `reissued: boolean` y `reissueCount: number`; `RefreshSession` responde igual en los dos
casos y, si `reissued`, llama a `AuthSecurityLog.refreshTokenReissued({ userId, sessionId, reissueCount })`.
`SecurityLogWriter` suma `log(message)` (el `Logger` de Nest lo cumple y pino lo escribe con nivel `info`); el adaptador
escribe `info` con la primera reemisión y `warn` desde la segunda (`reissueCount ≥ 2`), que en el patrón normal no
debería darse. Sin tokens, hashes ni IP (mismo contrato que `refreshTokenReused`). `docker-compose.prod.yml` arranca la
api con `LOG_LEVEL` por defecto `info`, así que el aviso llega a los logs de staging y producción; la tarea 1.7 lo
comprueba. Sirve para medir en 35b cuántas respuestas se pierden (tarea 4.1, dato para Q2).

### D8. Reproducción antes que arreglo, en cinco niveles

Cada tarea empieza con un test que falla en `main` por el bug: dominio («token rotado hace 2 s con sucesor sin usar»
devuelve hoy `conflict`), repositorio sobre el replset del preset (rotar, descartar el sucesor, volver a presentar el
token), HTTP con la app completa (dos `POST /api/auth/refresh` con la misma cookie), extensión, SPA (la restauración
cancela su petición al agotarse) y navegador. La regresión de navegador intercepta el refresh con `page.route`, deja que
llegue a la API con `route.fetch()` y retiene la respuesta mientras recarga, que es exactamente el aborto de la guía sin
depender de ella.

### D9. La restauración que se agota deja de esperar sin cancelar su petición (H8, Q3 = b)

Hoy `SessionRestore` aborta con su `AbortController` la espera del lock, la petición en curso y los reintentos. Con este
change, al cumplirse los 10 s:

- la restauración resuelve como hoy (sesión `anonymous`, sin logout, la navegación sigue);
- se cancelan la espera del lock y los reintentos pendientes, pero **una petición ya enviada sigue hasta que responda**;
- si esa respuesta tardía es `200`, el navegador aplica su `Set-Cookie`, el SPA **ignora el cuerpo** (no restaura la
  sesión en silencio en mitad de `/login`) y no reintenta ni llama a logout; si es `409` o error, no hace nada más.

`AuthApi.refresh` gana una opción para ese modo (por ejemplo, `{ detachOnAbort: true }`) y guarda la petición
desprendida. **Login y registro esperan a que esa petición termine** (como mucho 5 s; pasado ese tiempo la cancelan)
antes de enviar la suya. Sin esa espera, la cookie tardía de la sesión vieja podría llegar después y pisar la de la
sesión recién iniciada, mezclando sesiones o cuentas. Un refresh nuevo también espera a la desprendida antes de leer la
cookie.

## Alternativas descartadas

- **A. Reintentar más o con otro backoff en el SPA ante `409`.** No cambia la cookie entre intentos; solo retrasa el
  logout o el reuso. El SPA ya reintenta (ADR-020 §3).
- **B. Respuesta idempotente con el mismo par.** Exige guardar el sucesor en claro o cifrado con una clave del servidor:
  rompe el hash-only de ADR-020 §1 y suma gestión de claves. Tiene el mismo riesgo R1 que D2.
- **C. Que el SPA no aborte al navegar (`keepalive`).** No cubre cierre de pestaña, red caída ni el service worker de la
  extensión, y el soporte de cookies en respuestas `keepalive` no es uniforme entre navegadores. (D9 sí cubre el caso que
  depende solo del SPA: su propio tiempo máximo.)
- **D. Rotación diferida sin ventana (el token viejo vale hasta que se use el sucesor).** Recupera también las respuestas
  perdidas hace horas, pero un token copiado cuyo sucesor no se usó serviría hasta el próximo refresh legítimo: debilita
  la detección mucho más que D2. Queda como opción de Q2.
- **E. Reemitir reemplazando al sucesor anterior (invalidarlo al reemitir).** Con dos respuestas en vuelo, el navegador
  aplica la última que llega; si es la del sucesor invalidado, el siguiente refresh pierde la sesión. D3 difiere la
  invalidación hasta el primer uso.
- **F. Alargar la ventana de conflicto.** No arregla nada: el token viejo nunca vuelve a rotar, solo tarda más en caer.
- **G. Ligar la reemisión a IP o User-Agent.** Una IP móvil cambia entre peticiones y el User-Agent se copia: da falsa
  seguridad.
- **H. Respaldo por `replacedByHash` para tokens anteriores al despliegue.** Más código y más casos para recuperar unos
  10 s una sola vez (H2).

## Risks / Trade-offs

- **R1. Dentro de la ventana, quien presenta segundo también obtiene acceso.** Hoy, si dos clientes presentan el mismo
  refresh token con menos de 10 s de diferencia, el segundo recibe `409` y no obtiene nada. Con D2, si el sucesor
  todavía no se usó, el segundo recibe un refresh token y un access token válidos. Consecuencias, sin atenuantes:
  - quien tenga una copia del valor de la cookie y logre presentarla en esa ventana obtiene una sesión;
  - el access token que recibe no se puede revocar durante su TTL (15 min, ADR-020 §2: sin lista negra), aunque la
    sesión se revoque después;
  - la detección deja de ser inmediata: la revocación llega cuando el perdedor de la carrera vuelve a refrescar, y eso
    no tiene una cota fija (puede ser en minutos o, si el navegador legítimo queda cerrado, mucho después);
  - la mitigación de fondo (atar el token al cliente) queda fuera de este change.

  Fuera de la ventana, la detección es la de ADR-020. El tope de 3 no reduce este riesgo (D4). **Requiere aprobación del
  owner sobre esta descripción (Q1).**
- **R2. Concurrencia.** El invariante de D3 depende de la escritura común en el padre. Mitigación: pruebas deterministas
  en los dos órdenes (1.5, 1.6) con falsación quitando esa escritura.
- **R3. Despliegue y relojes.** (a) No se pueden mezclar versiones de la api: una instancia vieja responde `409` donde la
  nueva reemite y no escribe el padre ni supera hermanos, y rompe el invariante de D3. El despliegue tiene que reemplazar
  todas las instancias de una vez (hoy hay una sola réplica; el rollback también es completo). (b) La ventana se calcula
  con el reloj de la api que atiende cada petición (`Clock`); con más de una réplica se asume NTP en los hosts, y una
  deriva de segundos acorta o alarga la ventana. (c) Tokens rotados por la versión anterior no se reemiten (D5): unos
  10 s sin recuperación alrededor del despliegue.
- **R4. Respuestas perdidas pasada la ventana siguen costando la sesión** (cerrar la pestaña a mitad del refresh y volver
  más tarde) y dejan un aviso de reuso falso. Se acepta; se mide en 35b (tarea 4.1) antes de reabrir Q2.
- **R5. Una escritura más por rotación** (el padre) y un índice nuevo. Coste despreciable frente a Argon2 o al login.
- **R6. Orden de las respuestas en clientes sin serialización.** Si dos peticiones del mismo cliente refrescan a la vez
  sin serializarse, una puede recibir un hermano que la otra supera un instante después; si esa respuesta es la que el
  cliente guarda último, el siguiente refresh cae en `409` o en reuso. Hoy esa petición recibe `409` y reintenta con el
  token bueno. En el SPA, Web Locks (presente en todos los navegadores que soporta Angular 22) evita la carrera entre
  pestañas y el single-flight la evita en cada una. En la extensión, el mutex del service worker la evita, pero la
  extensión escribe en `chrome.storage` cualquier token que reciba: el arreglo (guardar solo si el token almacenado sigue
  siendo el presentado) va en un change aparte. El escenario «Reemisión y uso de un hermano a la vez» fija lo que la API
  garantiza (una sola hoja utilizable).
- **R7. La regresión de navegador depende de tiempos.** Se evita con una compuerta explícita (promesa) en `page.route`,
  sin `sleep`.
- **R8. Petición desprendida de la restauración (D9).** Mientras siga en vuelo, login, registro y refresh esperan hasta
  5 s. Con la api caída, el login tarda hasta 5 s más antes de fallar. Se acepta: es el mismo escenario en que hoy la
  restauración ya tardó 10 s.

## Migration Plan

Sin migración de datos ni configuración. Despliegue de `api` reemplazando todas las instancias de una vez (R3) y del SPA
en el mismo despliegue (el SPA nuevo funciona igual contra la api vieja). Rollback = revertir el commit completo; los
campos nuevos quedan como datos inertes y los hermanos vivos caducan con su TTL o caen como reuso.

## Debate (ronda 1)

Crítico: 0 P0. Negocio: 1 V0 (B1). Fecha: 2026-11-25.

| id | decisión | motivo |
| --- | --- | --- |
| H1 | Aceptado: R1 y ADR-072 §Consecuencias reescritos en abstracto (acceso para el segundo, access token no revocable 15 min, latencia de detección sin cota fija, mitigación de fondo fuera); Q1 pide aprobación sobre esa descripción | La versión anterior minimizaba el riesgo |
| H2 | Aceptado con la regla simple: la rotación nueva escribe `reissueCount: 0`, la reemisión exige el campo; fuera el respaldo por `replacedByHash` y la tarea 1.5 anterior | Menos casos; el coste es una recuperación de unos 10 s alrededor del despliegue (R3 c) |
| H3 | Aceptado: invariante de D3 probado intercalando dos transacciones en los dos órdenes con una pausa inyectable solo en tests; la carrera repetida queda como complemento; tarea partida en 1.5 y 1.6 | Una carrera con `Promise.all` no garantiza cubrir el intercalado peligroso |
| H4 | Adaptado: documentado en R6 y en ADR-072; el compare-and-set de `apps/extension` va en un change aparte («Fuera de alcance») | La extensión guarda cualquier token recibido; arreglarlo toca otro cliente |
| H5 | Aceptado: R3 (a) y ADR-072 prohíben mezclar versiones de la api | Una instancia vieja rompe el invariante de D3 |
| H6 | Aceptado: R3 (b) y ADR-072 escriben el supuesto de NTP | La ventana depende del reloj de cada réplica |
| H7 | Aceptado: `SecurityLogWriter.log`, `info` en la primera reemisión, `warn` desde `reissueCount ≥ 2`; la tarea 1.7 comprueba que `info` llega a los logs de producción | Sin eso, el aviso podría no verse en staging |
| H8 | Aceptado dentro del change (Q3 = b): D9, la restauración que se agota deja de esperar sin abortar su petición; login, registro y refresh esperan a la desprendida | El SPA provocaba él mismo el bug con su tiempo máximo |
| H9 | Tope 3; D4 explica que la palanca de R1 no es el tope | Una reemisión basta para la carrera |
| B1 (V0) | Aceptado: Q5 reformulada a «aplicar y fusionar antes de la primera invitación de 35b, sin alterar la precedencia 35a→35b→35c»; tarea 0.2 ajustada | Las primeras personas invitadas no deben toparse con el bug |
| B2 | Aceptado: proposal, ADR-072 y fila 42 dicen qué cubre (recargar o navegar dentro de 10 s, restauración agotada) y qué no (cerrar la pestaña y volver tarde) | La redacción anterior prometía de más |
| B3 | Aceptado: tarea 4.1 [infra] diferida a 35b con el plan de medición; no se edita `staging-host` | Q2 se decide con datos |
| B4 | Q1 (a) con tope 3 como recomendación al owner | — |
| B5 | Q2 (a), medida con B3 | — |
| B6 | Q4 diferida | — |
| B7 | Alcance sin recortes | — |

Convergencia: SI (2026-11-25, ronda 1: 0 P0 / 0 V0)

## Aprobación humana

**Aprobado por el owner el 2026-11-25.** Cita literal: «aprobado», en respuesta a la presentación tras «Convergencia: SI»
que pedía responder Q1 (recomendación (a), tope 3, con R1 y R6 tal como están descritos) y Q5 (recomendación (a)).
- **Q1 = (a):** R1 y R6 aceptados tal como los describe ADR-072, con tope de 3 reemisiones.
- **Q5 = (a):** aplicar **y fusionar** antes de la primera invitación de 35b, en la ventana de fusión que abra el owner;
  no altera la precedencia 35a→35b→35c.

## Open Questions

- **Q1 [bloqueante]** ¿Aprueba el riesgo R1 tal como está descrito (dentro de la ventana de 10 s, quien presenta segundo
  obtiene acceso; su access token no se puede revocar durante 15 min; la detección pasa a tener una latencia sin cota
  fija; atar el token al cliente queda fuera) y R6 (ADR-072)? Opciones: (a) aprobar con tope 3; (b) aprobar con tope 1,
  que no reduce R1 (D4); (c) rechazar y documentar el bug como riesgo aceptado (una respuesta de refresh perdida cuesta
  la sesión). **Recomendación del debate: (a).**
- **Q5 [bloqueante]** Precedencia: ¿autoriza **aplicar y fusionar** este change antes de la primera invitación de 35b,
  sin alterar la precedencia 35a→35b→35c (ADR-048/ADR-051)? Opciones: (a) sí, en su rama y con fusión en una ventana
  autorizada antes de invitar; (b) esperar a cerrar 35c e invitar con el bug. **Recomendación: (a).**
- **Q2 [no bloqueante, decidida en el debate: (a)]** Respuestas perdidas pasada la ventana: no se hace nada ahora; se
  mide en 35b (tarea 4.1) y se reabre con el umbral de esa tarea. Opciones que quedan para entonces: una ventana de
  reemisión más larga solo para sucesores nunca usados, o la alternativa D.
- **Q3 [decidida en el debate: (b)]** La restauración deja de cancelar su propia petición: D9.
- **Q4 [no bloqueante, diferida]** Que el aviso de reuso diga si el sucesor se había usado («probable respuesta perdida»
  frente a «probable robo»). Change posterior, junto con lo que salga de Q2.
