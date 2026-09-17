---
description: Construye el golden set de vacantes reales anonimizadas para el eval harness
argument-hint: [cantidad, por defecto 20]
---
Cantidad: "$ARGUMENTS" (por defecto 20). Objetivo: libs/ai/src/evals/extract-job/golden.jsonl y libs/ai/src/evals/match-cv/golden.jsonl.
0) Requisito: cada tarea objetivo (`extract-job`, `match-cv`) debe estar registrada como evaluable en
   libs/ai/src/evals/evaluable-tasks.ts, con su `expectedSchema`. Si alguna no lo está, no escribas su golden: termina con
   "GOLDEN: FALLO (tarea no registrada: <task>)".
1) Usa WebSearch/WebFetch para encontrar vacantes tecnológicas públicas en bolsas de Bolivia y LatAm (Computrabajo, Trabajopolis,
   Get on Board, Bumeran, Indeed, Remote OK), mezcla ES/EN, seniority variado, remoto/híbrido/presencial. Solo páginas públicas sin login.
2) Por cada vacante guarda el texto relevante y construye una línea `{ id, input, expected, tags, outputLanguage? }` cuyo `expected`
   cumple el `expectedSchema` registrado de la tarea (JobPreview de libs/shared: title, company, location, modality, seniority, salary,
   skills[], languages[], summary). Anonimiza: reemplaza nombre de empresa por "Empresa {N}", quita emails, teléfonos y URLs.
   Conserva el idioma original del texto.
3) Para match-cv crea 3 CVs sintéticos (junior backend, mid fullstack, senior data) en libs/ai/src/evals/match-cv/cv-*.txt y empareja
   cada uno con 3 vacantes, etiquetando `expected.scoreBand` en {low, mid, high} con una línea de justificación.
4) Valida cada golden con el cargador JSONL del harness (libs/ai/src/evals/golden.schema.ts) mediante un script tsx
   (`node --import tsx <script>.ts` con `TSX_TSCONFIG_PATH=libs/ai/tsconfig.lib.json`); corrige y repite hasta que no haya errores.
5) Commit `chore(ai): golden set inicial (N vacantes, 3 CVs)`. Termina con tabla fuente/idioma/seniority y la línea "GOLDEN: OK (N)".
