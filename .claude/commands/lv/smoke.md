---
description: Prueba end-to-end automática del change activo (docker compose + health + flujo HTTP + smoke UI)
argument-hint: [nombre-del-change]
---
Change: "$ARGUMENTS" (si vacío, el último archivado o el activo).
1) `docker compose up -d --wait`; espera a mongo (rs0 iniciado), redis, minio. Arranca api, worker y web en segundo plano
   (`pnpm nx run-many -t serve --parallel=3 &`) y espera a que /health de api y worker respondan 200.
2) Deriva del proposal.md y de specs/ del change los flujos HTTP que demuestra (ej. registro → login → crear grupo → importar links → esperar
   SSE link.enriched → cambiar estado). Ejecútalos con curl/httpie contra AI_CHAIN=mock, verificando códigos y campos clave.
3) Si apps/web tiene rutas del change, corre un smoke con Playwright (instálalo en apps/web-e2e si no existe): carga la ruta, verifica el
   texto principal y un clic relevante. Guarda screenshots en reports/smoke/<change>/.
4) Apaga los procesos que arrancaste. Escribe reports/smoke/<change>/REPORT.md con pasos, resultados y capturas.
Termina con la línea exacta "SMOKE: OK" o "SMOKE: FALLO (paso, evidencia)".
