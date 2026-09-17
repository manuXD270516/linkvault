---
description: Graba automáticamente los fixtures del mock (modo record) para los tests que fallan con FixtureMissing
argument-hint: [proveedor: ollama|openrouter, por defecto ollama]
---
> Nota: hoy `AI_MOCK_MODE=record` se rechaza al arrancar; el modo `record` está diferido al change `ai-eval-harness` (ADR-018 §5). Hasta entonces, los fixtures de replay se escriben a mano con `"source": "handwritten"` y el paso 2 no es ejecutable.

Proveedor: "$ARGUMENTS" (por defecto ollama; si Ollama no responde en OLLAMA_URL, usa openrouter si hay OPENROUTER_API_KEY; si tampoco, detente y dímelo).
1) Corre `AI_CHAIN=mock AI_MOCK_MODE=replay pnpm nx run-many -t test` y recoge todos los `FixtureMissing(<key>)`.
2) Si hay alguno: `AI_MOCK_MODE=record AI_CHAIN=<proveedor> pnpm nx run-many -t test` para grabarlos en libs/ai/infrastructure/fixtures/.
3) Revisa cada fixture nuevo: JSON válido contra el outputSchema de su tarea, sin PII (emails, teléfonos), sin texto truncado.
   Los inválidos: repite la grabación una vez; si sigue mal, corrígelo a mano manteniendo coherencia con el input.
4) Vuelve a correr en replay: debe estar todo en verde. Commit `test(ai): fixtures grabados con <proveedor> (N)`.
Termina con la línea exacta "FIXTURES: OK (N)" o "FIXTURES: FALLO (motivo)".
