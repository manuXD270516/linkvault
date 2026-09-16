---
description: Implementa tasks.md del change activo delegando por etiqueta a los subagentes
argument-hint: [nombre-del-change]
---
Change: "$ARGUMENTS" (si vacío, el activo). Ejecuta /opsx:apply sobre él con estas reglas:
- Delegación por etiqueta: [infra]→devops, [backend]→backend-dev, [frontend]→frontend-dev, [ai]→ai-engineer.
- Si hay tareas [backend] y [frontend] independientes, primero fija el contrato en libs/shared y luego ejecútalas en paralelo.
- Una tarea a la vez por agente; marca cada una en tasks.md al terminar; commit por grupo de tareas con Conventional Commits.
- Si una tarea requiere decidir algo que no está en docs/ ni en el change, detente y pregúntame en lugar de asumir.
- Al final corre `pnpm nx affected -t lint,typecheck,test --base=main` y reporta el resultado. No hagas /opsx:archive.
