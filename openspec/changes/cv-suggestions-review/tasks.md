## 1. Contrato

- [x] 1.1 [ai] Declarar la salida de `critique-suggestions` (score 0–1 e issues) y el input sin `cvFragment`/`before` en `libs/shared`; verificar con tests de schema.
- [x] 1.2 [backend] Añadir `judgeScore` y `judgeModel` opcionales al informe y al GET; verificar informes viejos sin ellos.
- [x] 1.3 [backend] Definir `analysis.step` (analysisId, linkId, paso) y los pasos `critiquing-suggestions` / `revising-suggestions`; verificar que un payload con campos de más no valida.
- [x] 1.4 [infra] Escribir ADR-031 (hasta dos envíos del CV en una ejecución; juez sin PII reinyectada) y referenciarlo desde design.md.

## 2. Juez

- [x] 2.1 [ai] Prompt versionado `critique-suggestions` y tarea no cacheable; verificar rechazo si se declara cacheable.
- [x] 2.2 [ai] Bucle en el worker: máx. 1 crítica + 1 revisión; parada a judgeScore ≥ 0.8 o Δ score entero < 1; se guarda el mejor par; verificar los cortes.
- [x] 2.3 [ai] El juez no recibe CV/PII reinyectada y, con dos proveedores, no repite al generador; verificar input y proveedor.
- [x] 2.4 [ai] Si el juez falla o hay `quota_exceeded` a mitad, `done` con el mejor informe ya obtenido (sin `judgeScore` si no hubo crítica válida).

## 3. Progreso en vivo

- [x] 3.1 [backend] Publicar `analysis.step` al cambiar de paso (incluidos los del bucle), sin bloquear si no hay suscriptores; verificar payload cerrado.
- [x] 3.2 [backend] Repartir solo al `userId` del análisis; verificar Ana/Beto.
- [x] 3.3 [frontend] Diálogo: rótulos de los pasos nuevos; SSE adelanta el paso de su análisis; sin canal el sondeo basta. Verificar store.
- [x] 3.4 [infra] Subir `MATCH_ANALYSIS_TIMEOUT_MS` / `MAX_AGE` (factor ×2 inicial) en `.env.example` y RUNBOOK.

## 4. Feedback

- [x] 4.1 [backend] Persistir «no me convence» con índice + hash de `after`, solo análisis propio; verificar el caso ajeno.
- [x] 4.2 [frontend] Acción «no me convence» junto a Copiar; sin aceptar/rechazar; i18n ES/EN.
- [x] 4.3 [infra] Export a `candidates.jsonl` sin tocar golden; verificar que los golden no cambian.
  <!-- CLI `nx run ai:export-feedback-candidates` → `libs/ai/src/evals/match-cv/candidates.jsonl`; la API solo persiste (4.1). -->

## 5. Eval y cierre

- [x] 5.1 [ai] Reporte de eval: correlación score/etiqueta 1–5 y coste por vuelta; verificar con mock.
- [ ] 5.2 [infra] `pnpm nx affected -t lint,typecheck,test --base=main` y `openspec validate --all` en verde.
