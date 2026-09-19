## Why

El smoke de `groups-ownership-join-limit` (`reports/smoke/groups-ownership-join-limit/REPORT.md` §4) encontró un código
de invitación en claro en el log de peticiones de `api`: una llamada a `/api/auth/refresh` hecha desde la página de la
SPA `http://localhost:4200/unirse?codigo=XXXXXXXX`. El serializador de peticiones de `pino-http` registra todas las
cabeceras, y el navegador manda en `referer` la URL completa de la página, con su query string.

Desde `job-links` un código de invitación da acceso a los links que compartieron terceros (ADR-021), y con
`applications-tracking` también a los estados que cada quien comparta: es un secreto al nivel de un token, y CLAUDE.md
prohíbe registrar datos sensibles. La query string de la página de origen puede llevar además cualquier otro parámetro
futuro que no controlamos desde `api`.

## What Changes

- **`referer` sin query ni fragmento**: los parámetros de logger de `api` y de `worker` (`buildLoggerParams`) reducen
  `req.headers.referer` al origen más la ruta (`http://localhost:4200/unirse`) antes de escribir la línea. Se hace con
  el mismo mecanismo de redacción de pino que ya protege `authorization` y `cookie`, con un `censor` que solo transforma
  la ruta exacta del `referer` y deja `[Redacted]` para el resto. Si la cabecera no es una URL `http`/`https` absoluta,
  se corta en el primer `?` o `#`; si no es una cadena, se redacta entera. El origen y la ruta se conservan porque sirven para depurar de qué pantalla vino una petición.
- **`worker` también**: solo sirve su salud por HTTP, pero registra sus peticiones con el mismo `pino-http`; se aplica
  la misma regla para que las dos apps no diverjan.
- **Tests**: los `logger-redaction.spec.ts` de `api` y `worker` registran una petición con
  `referer: http://localhost:4200/unirse?codigo=…#…` y comprueban que la línea conserva `http://localhost:4200/unirse`
  y que ni el código ni el fragmento aparecen en la salida.

## Capabilities

### New Capabilities
Ninguna.

### Modified Capabilities
- `platform/runtime-health`: "Logs sin secretos" pasa a exigir que la cabecera `referer` se registre sin query string
  ni fragmento, con un escenario nuevo.

## Impact

- **Código**: `apps/api/src/infrastructure/logging/logger-params.ts` y
  `apps/worker/src/infrastructure/logging/logger-params.ts`, con sus `logger-redaction.spec.ts`.
- **API, datos, eventos**: sin cambios. No cambia ningún contrato HTTP ni el formato del resto de la línea de log.
- **ADRs**: coherente con ADR-021 y con las specs `groups/membership` y `links` (el código de invitación da acceso a
  lo compartido en el grupo). La decisión es local y no crea ADR nuevo.
- **Riesgo residual**: se conserva la ruta, así que un secreto que viajara en un segmento de ruta de la SPA (p. ej. un
  futuro `/unirse/:codigo`) volvería a registrarse. Hoy el código solo viaja en la query (`/unirse?codigo=`,
  `returnUrl`); quien cambie eso debe revisar este requisito.
- **Fuera de alcance**: los logs del proxy inverso, que siguen en el alcance de `deploy-prod`; y la URL de la propia
  petición (`req.url`), porque ninguna ruta de `api` recibe el código por query string (`POST /api/groups/join` lo lleva
  en el cuerpo, que no se registra).
