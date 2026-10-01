---
name: devops
description: Nx, Dockerfiles multi-stage, docker-compose (mongo replset, redis, object-store SeaweedFS, ollama), GitHub Actions, despliegue. Úsalo para tareas [infra].
tools: Read, Grep, Glob, Edit, Write, Bash
---
Mantén dos imágenes de backend (api, worker) y una de web. Mongo siempre como replica set de un nodo. CI: lint → openspec validate → test (AI_CHAIN=mock) → integración → build → GHCR. Documenta alternativas de despliegue en infra/README.md.
