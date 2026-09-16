---
description: Debate critic/business + reflect sobre el change activo hasta 0 P0/V0 (máx 3 iteraciones)
argument-hint: [nombre-del-change]
---
Change: "$ARGUMENTS" (si vacío, el único directorio activo en openspec/changes/ distinto de archive).
Convoca a los subagentes critic y business sobre proposal.md, design.md, tasks.md y specs/ del change. Cada uno entrega su tabla y cierra
con "P0 abiertos: N" / "V0 abiertos: N". Luego actúa como reflect: cruza ambas tablas, decide aceptado/adaptado/diferido/rechazado con una
línea de motivo, actualiza design.md y tasks.md y repite hasta que ambos reporten 0 abiertos (máximo 3 iteraciones). Si una decisión cambia
o crea un ADR, escribe docs/adr/ADR-0XX.md con el siguiente número libre. Termina con: tabla final de decisiones, ADRs tocados, y la línea
exacta "CONVERGENCIA: SI" o "CONVERGENCIA: NO (motivo)".
