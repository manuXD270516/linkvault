# web-e2e — suite end-to-end de LinkVault

> Documento en construcción: el change `e2e-suite` (ADR-053) lo completa en su tarea 6.4.

## El comando de la suite

```bash
pnpm nx run web-e2e:e2e-stack
```

Monta una pila **aislada** (proyecto de compose `linkvault-e2e-<hash8>` y bloque de puertos propio, design D4), sirve
`api`, `worker` y `web` desde el código del checkout, ejecuta Playwright y **apaga lo que arrancó**, también si falla o
se interrumpe.

La infraestructura se levanta con el comando de arranque local del repositorio, **`pnpm infra:up`** (35a,
`object-store`: `docker compose up -d --wait` + `api:object-store -- provision`), con el proyecto de compose de la suite
y `apps/web-e2e/e2e.env` como fichero de entorno. Mientras 35a no esté en `main`, el runner ejecuta en su lugar
`docker compose up -d --wait` sobre el compose anterior (con MinIO); la tarea 7.9 lo cambia a `pnpm infra:up`. Hay un
solo sitio en el runner que arranca la infraestructura: `startInfra` en `scripts/lib/infra.ts`.

## Admisiones

Cada admisión con carga (design D12): cinco de cinco por proyecto y perfil, una invocación del runner con pila nueva
cada una, y ningún intento de registro con `429` en `stack-logs/api.log`.

**Carga usada:** tantos procesos `node` en un bucle ocupado como núcleos (24 en la máquina de estas corridas), desde que
empieza Playwright hasta que termina la corrida. Con la carga desde antes de arrancar la pila, `nx serve api` no llegó
a cargar sus plugins de Nx en el plazo de Nx y la corrida cayó en la fase «aplicaciones», antes de ejecutar ninguna
prueba (medido el 2026-09-28).

### 2026-09-28 — `critical-path.spec.ts` en `chromium` (tarea 5.9a, sobre `e2d0cc5`)

| Invocación | Resultado | Registro |
|---|---|---|
| `pnpm nx run web-e2e:e2e-stack -- --project=chromium --repeat-each=5` | 5 de 5 en verde (3,9 min) | 10 `POST /api/auth/register` `201`, ningún `429` |
| `pnpm nx run web-e2e:e2e-stack -- --rehearse-remote --skip-local --project=chromium --repeat-each=5` | 5 de 5 en verde (2,6 min) | 1 (la siembra) `201`, ningún `429` |
