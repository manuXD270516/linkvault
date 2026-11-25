# Capturas de la guía de uso

Genera las capturas de [`docs/guia-de-uso/README.md`](../../docs/guia-de-uso/README.md) y el resultado de cada caso
(`resultados.json`). Recorre la interfaz con Playwright sobre la **pila aislada de la suite e2e** (web 4300, API 3100,
Mailpit 8125). Todos los datos son inventados (`@example.test`, ofertas en el dominio reservado `.invalid`) y cada
captura enmascara contraseñas, el código de invitación, las claves de IA y el texto del CV.

## Ficheros

| Fichero           | Para qué                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `capture.mts`     | Los casos, una función por sección y un `rec.run(...)` por paso. Escribe `NNN-descripcion.png` en `docs/guia-de-uso/img/`. |
| `lib.mts`         | Registro de casos, capturas con máscaras, lectura de Mailpit y estado compartido.                                          |
| `serve-en.mts`    | Sirve el build en inglés de `web` (puerto 4301) con un proxy de `/api`; la pila solo sirve el español.                     |
| `meta.mts`        | Datos a mano de cada caso: ruta, qué se escribe, qué se espera y qué prueba automatizada lo cubre.                         |
| `build-guide.mts` | Arma `docs/guia-de-uso/README.md` con `resultados.json` y `meta.mts`.                                                      |
| `resultados.json` | OK/FALLO y lo visto en cada caso de la última corrida.                                                                     |

## Cómo correrlo

Desde la raíz del checkout, con las dependencias instaladas (`pnpm install --frozen-lockfile`) y el Chromium de
Playwright (`pnpm exec playwright install chromium`).

1. Pila nueva (el límite de altas es de 10 cada 15 minutos por IP; una pila nueva parte de cero). Con
   `--keep-stack` y sin tests que ejecutar (`--list`), el runner levanta todo y lo deja en pie. En Windows no uses
   `pnpm nx run`: Nx termina las aplicaciones al salir del runner.

   ```bash
   TSX_TSCONFIG_PATH=apps/web-e2e/scripts/tsconfig.json \
     node --import tsx apps/web-e2e/scripts/e2e-stack.ts --keep-stack --list
   ```

2. Build en inglés, opcional (sin él, fallan los casos `W01` a `W09`):

   ```bash
   pnpm nx run web:build:production --localize=en --output-path=dist/guia-web-en --skip-nx-cache
   node --import tsx tools/guia-de-uso/serve-en.mts      # http://localhost:4301/en/
   ```

3. Capturas y resultados (tarda unos 25 minutos: espera varias lecturas de ofertas que fallan a propósito):

   ```bash
   TSX_TSCONFIG_PATH=tsconfig.base.json node --import tsx tools/guia-de-uso/capture.mts
   ```

   Opciones: `--only=seccion,seccion` (por nombre de sección: `sin-sesion`, `registro`, `verificacion`, `sesion`,
   `perfil`, `grupos`, `invitado`, `links`, `postulaciones`, `cv`, `encaje`, `comentarios`, `publico`, `solo`,
   `descubrir`, `notificaciones`, `ia`, `admin`, `movil`, `idiomas`, `borrar`), `--out=carpeta` (otra carpeta de
   salida) y `--start=N` (primer número de captura). Una corrida parcial necesita el estado de las anteriores
   (`tools/guia-de-uso/.state.json`, que no se versiona: bórralo al terminar) y la misma pila.

4. Armar la guía y darle formato:

   ```bash
   node --import tsx tools/guia-de-uso/build-guide.mts --sha=<commit probado> --date=<fecha> "--unit=<resumen de web:test>"
   pnpm exec prettier --write docs/guia-de-uso tools/guia-de-uso
   ```

5. Apagar lo que se levantó:

   ```bash
   TSX_TSCONFIG_PATH=apps/web-e2e/scripts/tsconfig.json node --import tsx apps/web-e2e/scripts/e2e-stack.ts --down
   ```

   y parar `serve-en.mts` (su PID queda en `dist/guia-web-en/serve-en.pid`).

## Qué no hace

- No edita `apps/web-e2e/e2e.env` ni lee ningún `.env`: la configuración es la de la suite (IA en `mock`/`replay`,
  búsqueda, descubrimiento, frescura y resumen semanal apagados, sin claves VAPID ni `AI_VAULT_KEY`).
- El único acceso a Mongo es el del caso `P04` (oferta cerrada), que siembra `closedAt` en la base **de la pila** porque
  la frescura automática está apagada; el resto es solo la interfaz.
- Un caso que falla se anota como `FALLO` en `resultados.json` y el script sigue con el siguiente.
