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
  `core/auth/session-restore.ts:46-55` aborta la petición a los 10 s. `logout.usecase.ts` revoca la sesión también con
  un token ya rotado.

La premisa de ADR-020 §3 («un token rotado hace < 10 s es un refresh concurrente del mismo navegador, que ya tiene la
cookie del sucesor») no se cumple cuando la respuesta de la rotación se pierde. Ningún reintento del cliente puede
recuperar esa sesión: la cookie sigue siendo el token viejo y el servidor no puede volver a entregar el sucesor.

## Goals / Non-Goals

**Goals:**

- Una respuesta de rotación perdida no cuesta la sesión si el cliente vuelve dentro de la ventana de 10 s.
- La detección de reuso no se debilita fuera de la ventana; dentro de la ventana, el riesgo nuevo queda acotado y
  escrito (R1, ADR-072).
- Seguir guardando solo hashes; ningún secreto nuevo en Mongo ni en logs.
- Test que reproduce el bug antes de cada arreglo, en dominio, repositorio (replset de `mongodb-memory-server`), HTTP y
  navegador.

**Non-Goals:**

- Recuperar respuestas perdidas pasada la ventana (cerrar la pestaña y volver al minuto): Q2.
- Cambiar la política de reintentos del SPA o de la extensión, la ventana de 10 s, el TTL o la cookie.
- Que la restauración del SPA deje terminar su propia petición al agotar los 10 s: Q3.
- Diferenciar en el aviso de reuso un sucesor nunca usado de uno usado: Q4.

## Decisions

### D1. El arreglo va en la API; el SPA no cambia

El bug no es del cliente: aborta peticiones por motivos legítimos (navegación, cierre, red) y el servidor confirma igual.
Reintentar más o con otro backoff ante `409` no sirve (la cookie no cambia entre intentos) y, al agotar, el logout
revoca la sesión. El SPA y la extensión ya tratan `200` tras `409` como éxito; con D2 dejan de ver ese `409` en el caso
del bug sin tocar su código. Sí se agrega una regresión de punta a punta en `apps/web-e2e` (D8).

### D2. Reemisión: un token rotado hace menos de 10 s cuyo sucesor no se usó emite un hermano nuevo

`RefreshSessionPolicy.decide` gana el resultado `reissue`. Para un token rotado hace menos de 10 s:

- si **ni su sucesor ni ningún hermano de ese sucesor se usó** (`advanced = false`) y lleva menos de
  `REFRESH_REISSUE_LIMIT` reemisiones → `reissue`: se inserta un refresh token nuevo de la misma sesión, hijo del token
  presentado, y se responde `200` como una rotación (cookie nueva en web, `refreshToken` en el cuerpo en extensión);
- si no → `conflict` (`409`, como hoy).

Fuera de la ventana nada cambia: `reuse`, revocación y aviso. El token presentado conserva `rotatedAt` y `replacedByHash`
(primer hijo); la reemisión suma 1 a `reissueCount` y escribe sobre él (D3).

**Por qué un hermano y no el mismo sucesor:** el servidor solo tiene el hash del sucesor. Reenviar el mismo par exigiría
guardar el token en claro o cifrado (alternativa B), contra ADR-020 §1 y el escenario «Refresh token no guardado en claro».

### D3. El primer hermano usado deja superados a los demás, y las dos escrituras chocan en el padre

Cada refresh token nuevo guarda `parentHash` (hash del token que lo originó). Al **rotar** un token `C` con padre `P`:

1. se escribe siempre en `P` (`$set: { advancedAt: now }`; `advancedAt` = «la familia ya avanzó más allá de este
   token»);
2. los hermanos de `C` sin rotar (`parentHash = P`, `rotatedAt = null`, distinto de `C`) quedan **superados**:
   `rotatedAt = now` y `advancedAt = now`, sin sucesor;
3. sigue la rotación normal de `C`.

Un hermano superado se comporta como un token rotado cuyo sucesor ya se usó: `409` dentro de 10 s desde que se superó y,
después, reuso con revocación de la sesión. Nunca se reemite (`advanced = true`).

**Serialización.** La reemisión sobre `P` hace `updateOne({ tokenHash: P, advancedAt: null, reissueCount < límite },
{ $inc: { reissueCount: 1 } })` dentro de la misma transacción que inserta el hermano; la rotación de un hijo escribe
`P` en el paso 1. Las dos transacciones escriben el mismo documento, así que una recibe `WriteConflict`, `withTransaction`
la reintenta y relee: o la reemisión ve `advancedAt` y devuelve `conflict`, o la rotación ve al hermano nuevo y lo supera.
Sin esa escritura común, el `updateMany` del paso 2 no vería un hermano insertado en paralelo (fantasma de snapshot) y
quedarían dos hojas vivas. La escritura del paso 1 tiene que modificar el documento (un `$set` con el mismo valor no
genera conflicto); por eso usa `now`, y el filtro de la reemisión debe aceptar documentos sin el campo.

**Invariante:** una vez usado un token de una generación, la sesión tiene como mucho una hoja viva por cadena. Lo
verifica 1.6 con carreras repetidas.

### D4. Ventana anclada a la primera rotación y tope de 3 reemisiones

`rotatedAt` no se mueve al reemitir: la reemisión no extiende los 10 s que ADR-020 ya aceptó. `REFRESH_REISSUE_LIMIT = 3`
(constante de dominio, sin variable de entorno): en el patrón observado (una carga cada 1,5 s) bastan 1 o 2; 3 deja
margen para recargas repetidas y acota a 4 los hermanos vivos de un token. Pasado el tope, `409` como hoy.

### D5. Modelo de datos sin migración

`RefreshTokenDocument` suma tres campos opcionales: `parentHash: string | null`, `advancedAt: Date | null` y
`reissueCount: number` (ausente ≡ `null`/`0`). Índice no único `{ parentHash: 1 }` para el paso 2 de D3.
`StoredRefreshToken` los expone; `RefreshTokenState` del dominio recibe `advanced: boolean` y `reissueCount`, que calcula
el repositorio.

**Documentos anteriores al despliegue.** Un token sin `parentHash` no tiene hermanos. Para un padre anterior al despliegue
cuyo primer hijo ya se usó, `advanced` se calcula también leyendo `replacedByHash`: si ese hijo tiene `rotatedAt`, la
familia avanzó. Al rotar un hijo sin `parentHash`, el padre se busca por `replacedByHash` para el paso 1. Así ningún
token legacy se reemite después de que su sucesor se usara.

### D6. Mismas reglas para web y extensión

`rotate` es compartido (`expectedClient`). La extensión pierde respuestas por el mismo motivo (el service worker se
suspende a mitad de la petición) y su spec ya dice «mismas reglas de TTL y reuso que `auth/sessions`». El aislamiento de
cliente se comprueba antes de decidir, como hoy.

### D7. Resultado y aviso operativo

`RotationResult` `rotated` suma `reissued: boolean`; `RefreshSession` responde igual en los dos casos y, si
`reissued`, llama a `AuthSecurityLog.refreshTokenReissued({ userId, sessionId })`, que el adaptador de Nest escribe con
nivel `info`. Sin tokens, hashes ni IP (mismo contrato que `refreshTokenReused`). Sirve para ver en staging cuántas
respuestas se pierden (dato para Q2) y para distinguir un `200` reemitido de una rotación.

### D8. Reproducción antes que arreglo, en cuatro niveles

Cada tarea de `[backend]` empieza con un test que falla en `main` por el bug: dominio («token rotado hace 2 s con
sucesor sin usar» devuelve hoy `conflict`), repositorio sobre el replset del preset (rotar, descartar el sucesor,
volver a presentar el token), HTTP con la app completa (dos `POST /api/auth/refresh` con la misma cookie) y extensión.
La regresión de navegador (`[frontend]`) intercepta el refresh con `page.route`, deja que llegue a la API con
`route.fetch()` y retiene la respuesta mientras recarga, que es exactamente el aborto de la guía sin depender de ella.

## Alternativas descartadas

- **A. Reintentar más o con otro backoff en el SPA ante `409`.** No cambia la cookie entre intentos; sólo retrasa el
  logout o el reuso. El SPA ya reintenta (ADR-020 §3).
- **B. Respuesta idempotente con el mismo par.** Exige guardar el sucesor en claro o cifrado con una clave del servidor:
  rompe el hash-only de ADR-020 §1 y suma gestión de claves. Tiene el mismo riesgo R1 que D2.
- **C. Que el SPA no aborte (`keepalive`, no cancelar al navegar).** No cubre cierre de pestaña, red caída ni el
  service worker de la extensión, y el soporte de cookies en respuestas `keepalive` no es uniforme entre navegadores.
- **D. Rotación diferida sin ventana (el token viejo vale hasta que se use el sucesor).** Recupera también las respuestas
  perdidas hace horas, pero un token robado cuyo sucesor no se usó serviría hasta el próximo refresh legítimo: debilita
  la detección mucho más que D2. Queda como opción de Q2.
- **E. Reemitir reemplazando al sucesor anterior (invalidarlo al reemitir).** Con dos respuestas en vuelo, el navegador
  aplica la última que llega; si es la del sucesor invalidado, el siguiente refresh pierde la sesión. D3 difiere la
  invalidación hasta el primer uso.
- **F. Alargar la ventana de conflicto.** No arregla nada: el token viejo nunca vuelve a rotar, sólo tarda más en caer.
- **G. Ligar la reemisión a IP o User-Agent.** Una IP móvil cambia entre peticiones y el User-Agent se copia: da falsa
  seguridad.

## Risks / Trade-offs

- **R1. Carrera de un atacante dentro de la ventana.** Hoy, si quien tiene una copia del token y la persona legítima lo
  presentan con menos de 10 s de diferencia, el segundo recibe `409` y el SPA, al agotar los reintentos, revoca la sesión
  en unos 2 s. Con D2, el segundo recibe un hermano y la revocación llega recién cuando el perdedor vuelve a refrescar
  (el hermano superado cae en reuso pasada la ventana). Precondiciones: copia del valor de una cookie `httpOnly`
  (dispositivo o red comprometidos, no XSS) y carrera de menos de 10 s antes de que se use el sucesor. Fuera de esa
  carrera, la detección es la de hoy. Mitigación: tope de 3, ventana anclada, D3, aviso D7. **Requiere aceptación del
  owner (Q1).**
- **R2. Concurrencia.** El invariante de D3 depende de la escritura común en el padre. Mitigación: test de carreras
  repetidas (1.6) con falsación quitando esa escritura.
- **R3. Despliegue con familias a medias.** D5 cubre los padres legacy por `replacedByHash`. Durante los 10 s alrededor
  del despliegue no hay estado que pueda dejar dos hojas vivas: los hijos legacy no tienen hermanos.
- **R4. Respuestas perdidas pasada la ventana siguen costando la sesión** (y dejan un aviso de reuso falso). Se acepta en
  este change; Q2 y Q4.
- **R5. Una escritura más por rotación** (el padre) y un índice nuevo. Coste despreciable frente a Argon2 o al login.
- **R6. Orden de las cookies sin Web Locks.** Si dos pestañas de un navegador sin Web Locks refrescan a la vez, una
  puede recibir un hermano que la otra supera un instante después; si su `Set-Cookie` llega último, el siguiente
  refresh de ese navegador cae en `409` o en reuso. Hoy esa pestaña recibe `409` y reintenta con la cookie buena. Web
  Locks está en todos los navegadores que soporta Angular 22, así que se acepta; el escenario «Reemisión y uso de un
  hermano a la vez» fija lo que la API garantiza (una sola hoja utilizable).
- **R7. La regresión de navegador depende de tiempos.** Se evita con una compuerta explícita (promesa) en `page.route`,
  sin `sleep`.

## Migration Plan

Sin migración de datos ni configuración. Despliegue normal de `api`; rollback = revertir el commit (los campos nuevos
quedan como datos inertes y los hermanos vivos caducan con su TTL o caen como reuso).

## Open Questions

- **Q1 [bloqueante]** ¿Se aceptan R1 y R6 (ADR-072)? Opciones: (a) aceptar D2–D4 tal cual; (b) aceptar con tope 1 en vez de 3;
  (c) rechazar y documentar el bug como riesgo aceptado (la sesión se pierde cuando se pierde una respuesta de refresh).
  **Recomendación: (a).** El riesgo nuevo exige copia de una cookie `httpOnly` y una carrera de 10 s, y el bug actual
  expulsa a personas reales en redes lentas.
- **Q2 [no bloqueante]** Respuestas perdidas pasada la ventana (cerrar la pestaña a mitad del refresh y volver más tarde).
  Opciones: (a) no hacer nada y medir con D7 en staging; (b) una ventana de reemisión más larga sólo para sucesores nunca
  usados (por ejemplo, el TTL del access token, 15 min); (c) alternativa D. **Recomendación: (a)**, decidir con datos.
- **Q3 [no bloqueante]** La restauración del SPA cancela su propia petición a los 10 s (`session-restore.ts:47`). Opciones:
  (a) dejarla así: con D2, una recarga dentro de 10 s la recupera; (b) change aparte para dejar de esperar sin cancelar
  la petición, de modo que el navegador aplique la cookie si la respuesta llega tarde. **Recomendación: (a)** en este
  change; (b) si Q2 muestra pérdidas en la restauración.
- **Q4 [no bloqueante]** ¿El aviso de reuso debe decir si el sucesor se había usado («probable respuesta perdida» frente a
  «probable robo»)? **Recomendación:** sí, en un change posterior junto con Q2; aquí no se toca el aviso de reuso.
- **Q5 [bloqueante]** Precedencia: la fila 35 (ADR-048/ADR-051) no admite changes de otra fila entre medias. ¿Se
  autoriza aplicar este arreglo de seguridad de sesión fuera de esa secuencia, como se hizo con las filas 38 y 39?
  Opciones: (a) sí, en su rama, sin alterar la precedencia de la 35; (b) esperar a cerrar 35c. **Recomendación: (a)**:
  afecta a las personas que 35b va a invitar.
