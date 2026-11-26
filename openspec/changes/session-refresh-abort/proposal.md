## Why

El 2026-11-25, una pasada de `tools/guia-de-uso/capture.mts` sobre la pila e2e dejó la sección `movil` sin sesión. El
contexto de Pixel 7 inicia sesión y navega con `page.goto` a una ruta distinta cada 1,5 s; cada navegación es una carga
completa del SPA y, por lo tanto, un `POST /api/auth/refresh` de la restauración de sesión. El `api.log` de esa pila
muestra, para las peticiones con `sec-ch-ua-platform: "Android"` emparejadas por `req.id`:

1. un refresh que termina en «request aborted» a los 167 ms;
2. siete `409 refresh_conflict` en 2,7 s (dos cargas seguidas: 3 peticiones en la primera, 4 en la segunda);
3. un `POST /api/auth/logout` con `204`;
4. desde ahí, todos los refresh responden `401`.

**Causa raíz (confirmada en el código).** La rotación se confirma en el servidor aunque el cliente nunca reciba la
respuesta:

- `apps/api/src/modules/auth/infrastructure/mongo-session.repository.ts:201-247` marca el token presentado como rotado
  e inserta el sucesor dentro de una transacción que no depende de que la respuesta llegue al navegador.
- `apps/api/src/modules/auth/application/refresh-token.ts:3` y `session.schemas.ts:29-30`: solo se guarda el hash del
  sucesor; el servidor no puede volver a entregar ese token.
- `apps/api/src/modules/auth/domain/refresh-session.ts:108-112`: un token rotado hace menos de 10 s devuelve `conflict`
  (409) **aunque su sucesor no se haya usado nunca**; a partir de 10 s, `reuse`, que revoca la sesión
  (`mongo-session.repository.ts:188-196`) y registra un aviso de reuso.
- `apps/api/src/modules/auth/presentation/auth.controller.ts:112-113` documenta la premisa que falla: «`refresh_conflict`
  (409) no la toca: otra petición del mismo navegador ya fijó la del sucesor». Con la respuesta abortada, nadie la fijó.
- En el SPA, `apps/web/src/app/core/auth/auth.api.ts:178-199` ya reintenta ante 409 (250/500/1000 ms con jitter,
  ADR-020 §3) y, al agotar, llama a logout, que revoca la sesión (`logout.usecase.ts:24-34`). Los reintentos no pueden
  funcionar: la cookie del navegador sigue siendo el token viejo, que ya nunca va a rotar.

La hipótesis del hallazgo queda confirmada con un matiz: en esta corrida la sesión no cayó por la detección de reuso sino
por el logout del SPA al agotar los reintentos; si la siguiente carga hubiera llegado después de 10 s, habría caído por
reuso, con un aviso de seguridad falso.

**Le pasa a personas reales.** Basta con que el servidor confirme la rotación y la respuesta no llegue: recargar o
navegar mientras se ve «Conectando…» en una red lenta, cerrar la pestaña a mitad del refresh, un móvil que cambia de red,
o el propio tiempo máximo de 10 s de la restauración (`session-restore.ts:47`), que cancela la petición en curso. En
todos los casos el resultado es el mismo: la sesión se pierde y hay que volver a iniciar sesión. Con dos pestañas, Web
Locks serializa los refresh, pero si la pestaña que tiene el lock se cierra a mitad del refresh, la otra hereda el token
viejo y termina igual.

**Qué cubre este change y qué no.** Cubre recargar o navegar con el refresh en vuelo cuando la carga siguiente llega
dentro de los 10 s de la rotación (el caso de la guía, y el de «Conectando…» en una red lenta) y la restauración del SPA
que agota sus 10 s, que deja de cancelar su propia petición. **No** cubre cerrar la pestaña a mitad del refresh y volver
más tarde, ni una respuesta perdida a la que el cliente vuelve pasados 10 s: siguen costando la sesión (se miden en 35b,
Q2).

## What Changes

- **Reemisión dentro de la ventana de conflicto** (API, cliente web y extensión): un refresh token rotado hace menos de
  10 s cuyo sucesor **no se usó todavía** ya no responde `409`: emite un refresh token hermano nuevo (y un access token)
  de la misma sesión y responde `200` como una rotación. Es la señal de que la respuesta anterior se perdió.
- **El primer hermano que se usa invalida a los demás**: al rotar un sucesor, sus hermanos sin usar quedan marcados como
  superados; presentarlos después responde `409` dentro de la ventana y `401` con revocación de la sesión pasada la
  ventana, igual que un token rotado hoy.
- **Tope de 3 reemisiones por token** y ventana anclada a la primera rotación: la reemisión no alarga los 10 s ya
  aceptados en ADR-020. Los tokens rotados antes del despliegue no se reemiten.
- **Restauración del SPA sin autoaborto**: al agotar los 10 s, el SPA sigue sin sesión como hoy, pero deja terminar la
  petición ya enviada para que el navegador aplique la cookie; ignora el cuerpo de esa respuesta, y login, registro y
  refresh esperan a que termine (como mucho 5 s) antes de enviar los suyos.
- **Sin cambios** en: ventana de 10 s, detección de reuso pasada la ventana, `409` cuando el sucesor ya se usó, logout,
  cookie, hash-only en Mongo, política de reintentos del SPA y de la extensión.
- **Aviso operativo** `refreshTokenReissued` (solo `userId`, `sessionId` y el número de reemisión; `info`, y `warn`
  desde la segunda) para distinguir en los logs una respuesta perdida de un conflicto y medir en 35b.
- **Regresión de punta a punta** en `apps/web-e2e`: recargar con el refresh de la restauración en vuelo conserva la
  sesión.
- **Plan de medición** para 35b (tarea diferida): reemisiones y reusos por persona, con umbral para reabrir Q2.
- Decisión de seguridad en **ADR-072** (enmienda ADR-020 §3), con el riesgo residual descrito sin atenuantes: dentro de
  la ventana, quien presenta segundo también obtiene acceso.

## Capabilities

### New Capabilities

_(ninguna)_

### Modified Capabilities

- `auth/sessions`: «Detección de reuso» distingue un sucesor sin usar (reemisión) de uno usado (`409`), con tope y
  hermanos superados.
- `auth/extension-sessions`: «Refresh de extensión por cuerpo» aplica la misma reemisión y aclara cuándo el token viejo
  deja de aceptarse.
- `web/auth`: «Restauración de la sesión al cargar» suma la recarga con el refresh en vuelo y la restauración agotada
  que no cancela su petición.

## Impact

- `apps/api/src/modules/auth/domain/refresh-session.ts` (nueva decisión `reissue`, tope), `application/ports/`
  (`StoredRefreshToken`, `RotationResult`, `AuthSecurityLog`), `refresh-session.usecase.ts`,
  `infrastructure/session.schemas.ts` (campos `parentHash`, `advancedAt`, `reissueCount`, opcionales),
  `mongo-session.repository.ts`, `nest-auth-security-log.ts` y el doble en memoria de
  `application/testing/auth-test-doubles.ts`.
- `apps/web/src/app/core/auth/session-restore.ts` y `auth.api.ts` (petición desprendida y espera de login, registro y
  refresh).
- `apps/web-e2e/src/auth-refresh-abort.spec.ts` (nuevo). Sin cambios en `apps/extension` (su parte de R6 va en un change
  aparte), `libs/`, contratos de `libs/shared`, configuración, despliegue ni CI.
- Sin migración: los documentos existentes se leen con los valores por defecto.
- Despliegue de la api sin mezclar versiones y con relojes sincronizados (R3 del design).
- Riesgo de seguridad descrito en ADR-072 (R1 del design): pendiente de aprobación del owner (Q1). Aplicar y fusionar
  antes de la primera invitación de 35b: pendiente del owner (Q5).
