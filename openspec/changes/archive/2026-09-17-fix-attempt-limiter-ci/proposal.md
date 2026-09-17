## Why

Tras fusionar `auth-users`, el job de CI en `ubuntu-24.04` falla con tres tests de `api` que en Windows pasan
(`redis-attempt-limiter.spec.ts` ×2 y `auth.controller.password.spec.ts` ×1). La causa no está en el límite de intentos,
sino en el doble RESP de `@linkvault/testing`: sus sockets aceptados no desactivan Nagle y responden con un `write` por
comando, así que las respuestas que siguen a la primera de un `MULTI` esperan al ACK del cliente (hasta ~40 ms en Linux).
Cada `MULTI/EXEC` del limitador cuesta esa espera; en Windows el bucle local tarda 0,2 ms y por eso no se veía.

Consecuencias medidas en el log de CI:
- `Logins correctos no agotan el límite por IP` (limiter): 51 iteraciones × 3 `MULTI` ≈ 153 idas y vueltas × ~33 ms > 5 s.
- `Logins correctos no agotan el límite por IP` (HTTP): lo mismo, más Argon2id real por login.
- `starts a new window once the previous one expires`: los 5 consumos previos tardaban más que la ventana de 150 ms del
  test, la ventana caducaba antes de tiempo y el sexto intento salía permitido.

## What Changes

- **Doble RESP realista**: `RedisPingDouble` pone `TCP_NODELAY` en cada conexión aceptada (como `tcp-nodelay yes` de
  Redis) y agrupa en un solo `write` las respuestas de los comandos que llegan juntos, igual que el búfer de salida de
  Redis. Es la corrección de la causa: elimina la espera artificial de todas las pruebas que usan el doble.
- **Test de ventana determinista**: `starts a new window once the previous one expires` deja de depender de que N
  comandos quepan en una ventana corta; usa la ventana real de 15 minutos, adelanta el final de la ventana acortando la
  caducidad de la clave desde el inspector y espera a que Redis la dé por vencida (`PTTL` = -2).
- **Margen en los dos escenarios largos**: los `it` de `Logins correctos no agotan el límite por IP` declaran
  `{ timeout: 30_000 }`; siguen ejecutando 51 logins correctos sin 429, con Argon2id real y sin bajar su coste.

## Non-goals

- No cambia ninguna regla de negocio: la ventana fija de 15 minutos, los límites (5 por email, 50 por IP), el
  fail-open y la devolución del intento tras un login correcto se mantienen. Por eso este change no lleva deltas de
  spec: `openspec/specs/auth/credentials/spec.md` sigue igual y sus escenarios conservan los mismos tests.
- No se toca `ARGON2_OPTIONS` ni se introduce un coste de hash distinto para tests: el escenario HTTP vale precisamente
  por ejercitar el stack real.
