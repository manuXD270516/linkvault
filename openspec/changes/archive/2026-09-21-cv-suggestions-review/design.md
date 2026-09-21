## Context

`cv-match-suggestions` deja un análisis de un solo `match-cv` y progreso solo por sondeo. design-v0.2 §4.8 y ADR-030 §9 dejan juez y SSE para este change. Ver `proposal.md`. La privacidad (consentimiento, redacción hacia externos) no se rediseña; sí se acota qué ve el juez.

Debate critic/business (iteración 1): se cerraron 4 P0 y 2 V0 —pasos del bucle, sondeo vs SSE, PII al juez, Δ mal tipado, aceptar/rechazar vacío, juez de 2 vueltas sin señal—.

## Goals / Non-Goals

**Goals:**

- Un análisis `done` no degradado puede llevar `judgeScore` y `judgeModel` tras **como máximo una** crítica y **como máximo una** revisión.
- Pasos `critiquing-suggestions` / `revising-suggestions` visibles (sondeo y, si llega, SSE).
- «No me convence» persistido e exportable; Copiar sigue.

**Non-Goals:**

- Aceptar/rechazar diff en el diálogo (cortado: sin rastro ni siguiente paso claro).
- Dos vueltas de juez (MVP = una).
- Reescribir el archivo del CV; cambiar consentimiento/cuota de análisis; meter feedback al golden solo; BYOK; roadmap.

## Decisions

### 1. El bucle vive en el caso de uso, no en `runTask`

Igual que antes: el worker orquesta `match-cv` → `critique-suggestions` → (opcional) `match-cv` otra vez.

### 2. Tope MVP: una crítica, una revisión

Tras el primer informe, como máximo **una** crítica. Si el juez pide revisión y el presupuesto de vueltas lo permite, como máximo **una** revisión. Parada anticipada si `judgeScore ≥ 0.8` o si el `score` entero del nuevo informe no supera al anterior en al menos 1. Se guarda el par `(informe, judgeScore, judgeModel)` de la iteración del mejor `score` (empate → mayor `judgeScore`).

### 3. El juez no ve PII del CV

Input de `critique-suggestions`: oferta + informe **sin** `evidence.cvFragment` ni `before`. Los `after` permanecen con marcadores (sin reinyectar antes del juez). La reinyección al usuario ocurre al persistir/responder el GET, no al llamar al juez.

### 4. Juez distinto si hay dos proveedores

Sin cambio. Si el juez falla: `done` con el informe del generador, sin `judgeScore`.

### 5. Pasos nombrados del bucle

El conjunto cerrado de pasos añade `critiquing-suggestions` y `revising-suggestions` entre `drafting-suggestions` y el final. El diálogo muestra rótulos claros («Revisando sugerencias…», «Mejorando sugerencias…»).

### 6. SSE encima del sondeo

Se MODIFICA la regla «el sondeo es la única vía»: el sondeo sigue siendo obligatorio y suficiente; el SSE **puede adelantar** el mismo paso. Sin canal, el comportamiento es idéntico al change anterior. Payload: solo `analysisId`, `linkId`, paso. Routing por `userId` del análisis.

### 7. Cuota y «presupuesto»

Cuota de **análisis** = 1 si el informe no está degradado (sin cambio). Cada `runTask` cuenta en el ledger (`match-cv` hasta 2, `critique-suggestions` hasta 1). Si a mitad del bucle hay `quota_exceeded`, se guarda el mejor informe ya obtenido (como fallo de juez), no se deja `running`. No hay un «presupuesto» abstracto aparte: el tope es el de vueltas (máx. 3 `runTask` por ejecución: 2× match + 1× critique).

### 8. Plazos

`MATCH_ANALYSIS_TIMEOUT_MS` / `MAX_AGE` deben absorber ~3 llamadas; factor inicial ×2 respecto a los valores actuales, medido luego con el eval. Documentar en RUNBOOK al implementar.

### 9. Feedback

Identidad de sugerencia: `suggestionIndex` del informe final + hash corto de `after`.

### 10. Aceptar/rechazar

**Fuera de alcance.** Solo Copiar + «no me convence».

## Risks / Trade-offs

- [Una sola vuelta puede no bastar] → métrica de correlación y coste; subir el tope en un change posterior si el eval lo pide.
- [SSE filtra metadatos laborales] → routing por dueño + test Ana/Beto.
- [ADR-030 §6 decía un envío] → ADR-031.

## Migration Plan

Informes viejos sin `judgeScore` se leen igual. Sin migración de datos.

## Open Questions

Ninguna abierta que bloquee implementación tras el debate.

## Reflect (debate iteración 1)

| Hallazgo | Origen | Decisión | Motivo |
| --- | --- | --- | --- |
| Pasos del bucle sin nombre en el conjunto cerrado | P0 critic | Aceptado | `critiquing-suggestions` / `revising-suggestions` en design §5 y specs |
| «Sondeo única vía» vs SSE | P0 critic | Adaptado | SSE encima del sondeo (§6); sondeo sigue siendo suficiente |
| Juez ve `cvFragment` / `before` | P0 critic | Aceptado | Input del juez sin PII del CV (§3); reinyección solo al GET |
| Δ 0.05 vs `score` entero | P0 critic | Aceptado | Parada: Δ score &lt; 1 (§2) |
| Aceptar/rechazar sin siguiente paso | V0 business | Aceptado (corte) | Fuera de alcance MVP (§10); solo Copiar + «no me convence» |
| Dos vueltas de juez sin señal de eval | V0 business | Aceptado (corte) | Tope MVP = 1 crítica + 1 revisión (§2) |

ADRs: `docs/adr/ADR-031.md`.

**CONVERGENCIA: SI**
