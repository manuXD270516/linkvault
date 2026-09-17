## 1. Doble de Redis

- [x] 1.1 [testing] `RedisPingDouble.accept`: `socket.setNoDelay(true)` y una sola escritura por tanda de comandos
  recibidos; verificar con `pnpm nx run testing:test` (el doble sigue respondiendo lo mismo a comandos sueltos y a
  `MULTI/EXEC`) y con el tiempo del escenario `Logins correctos no agotan el límite por IP` del limitador.

## 2. Tests de límites de intentos

- [x] 2.1 [api] `redis-attempt-limiter.spec.ts`: hacer determinista `starts a new window once the previous one expires`
  (ventana real, caducidad adelantada desde el inspector y espera hasta `PTTL` = -2) y dar `{ timeout: 30_000 }` al
  escenario `Logins correctos no agotan el límite por IP`; verificar que el archivo pasa 5 veces seguidas.
- [x] 2.2 [api] `auth.controller.password.spec.ts`: `{ timeout: 30_000 }` en `Logins correctos no agotan el límite por
  IP`, sin tocar los 51 logins ni el hasher; verificar que el archivo pasa 5 veces seguidas.
- [x] 2.3 [api] `pnpm nx run api:test --skip-nx-cache` completo en verde.
