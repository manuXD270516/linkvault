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
