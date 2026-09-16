---
description: Construye el golden set de vacantes reales anonimizadas para el eval harness
argument-hint: [cantidad, por defecto 10]
---
Cantidad: "$ARGUMENTS" (por defecto 10). Objetivo: libs/ai/evals/extract-job/golden.jsonl y libs/ai/evals/match-cv/golden.jsonl.
1) Usa WebSearch/WebFetch para encontrar vacantes tecnológicas públicas en bolsas de Bolivia y LatAm (Computrabajo, Trabajopolis,
   Get on Board, Bumeran, Indeed, Remote OK), mezcla ES/EN, seniority variado, remoto/híbrido/presencial. Solo páginas públicas sin login.
2) Por cada vacante guarda el texto relevante y construye el `expected` con el schema JobPreview de libs/shared (title, company, location,
   modality, seniority, salary, skills[], languages[], summary). Anonimiza: reemplaza nombre de empresa por "Empresa {N}", quita emails,
   teléfonos y URLs. Conserva el idioma original del texto.
3) Para match-cv crea 3 CVs sintéticos (junior backend, mid fullstack, senior data) en libs/ai/evals/fixtures/cv-*.txt y empareja cada uno
   con 3 vacantes, etiquetando `expected.scoreBand` en {low, mid, high} con una línea de justificación.
4) Valida cada línea contra los schemas zod con un script rápido (`pnpm nx run ai:eval --validate` si existe; si no, un tsx inline).
5) Commit `chore(ai): golden set inicial (N vacantes, 3 CVs)`. Termina con tabla fuente/idioma/seniority y la línea "GOLDEN: OK (N)".
