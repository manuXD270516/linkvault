---
description: /opsx:verify + qa-reviewer en bucle hasta verde sobre el change activo
argument-hint: [nombre-del-change]
---
Change: "$ARGUMENTS" (si vacío, el activo). 1) Ejecuta /opsx:verify. 2) Convoca a qa-reviewer; que entregue la tabla
criterio/estado/evidencia/acción. 3) Corrige cada fallo (delegando al agente correspondiente) y vuelve a correr qa-reviewer.
Máximo 3 ciclos. Termina con la tabla final y la línea exacta "QA: VERDE" o "QA: ROJO (pendientes: ...)".
