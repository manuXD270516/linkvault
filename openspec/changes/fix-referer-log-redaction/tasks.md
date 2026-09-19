## 1. Logger de `api`

- [x] 1.1 [backend] `apps/api/src/infrastructure/logging/logger-params.ts`: añadir `req.headers.referer` a las rutas de
  redacción y un `censor(value: unknown, path: string[])` que, solo para la ruta exacta `req.headers.referer`, deja
  origen más ruta si es una URL `http`/`https` absoluta, corta en el primer `?`/`#` si es otra cadena y devuelve
  `[Redacted]` si no es cadena; cualquier otra ruta devuelve `[Redacted]`; verificar con `logger-redaction.spec.ts`,
  con el nombre de cada escenario en el título de su `it`: "Petición desde la página de unirse con un código",
  "Referer con el código dentro de returnUrl", "Referer que no es una URL absoluta", "Petición sin referer", y los
  escenarios existentes sin cambios.

## 2. Logger de `worker`

- [x] 2.1 [backend] `apps/worker/src/infrastructure/logging/logger-params.ts`: la misma regla que 1.1, sin tocar los
  comodines `*.headers.authorization`; verificar con los mismos cuatro escenarios en su `logger-redaction.spec.ts` y los
  existentes sin cambios.

## 3. Cierre

- [x] 3.1 [infra] `pnpm nx affected -t lint,typecheck,test --base=main` y `openspec validate --all` en verde.
