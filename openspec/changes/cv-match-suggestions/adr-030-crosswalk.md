# ADR-030 ↔ tasks — lectura cruzada (tarea 17.4)

**Para el PR de `cv-match-suggestions`.** ADR-030 no se reescribe; esta tabla anota que cada una de sus catorce
decisiones tiene al menos una tarea que la ejecuta. Referencias: `proposal.md`, `design.md` y
`openspec-changes.yaml` (manifiesto) citan ADR-030.

| § | Decisión (resumen) | Tarea(s) que la ejecutan |
|---|-------------------|--------------------------|
| 1 | Resultado de tarea `personal` no se cachea nunca | 3.1, 3.2, 3.7 |
| 2 | Huecos conocidos de redacción fuera del suelo duro | 6.6 (+ métricas del eval en grupo 6) |
| 3 | Motivo de degradación por falta de consentimiento | 1.5, 3.3, 4.1 |
| 4 | Borrar un CV borra sus análisis en la misma transacción | 11.2 |
| 5 | `fitScore` se deriva al leer; nadie lo escribe | 1.12, 12.4–12.5 (grupo aplicaciones) |
| 6 | Como mucho un envío externo por análisis pedido | 2.7, 13.13 |
| 7 | Plazo API > worker; vencido es terminal | 2.2–2.4, 8.3, 13.4, 13.12 |
| 8 | Cuota derivada del historial; sin contador que devolver | 8.7, 9.7 |
| 9 | SSE `analysis.step` diferido; paso vía sondeo | diseño + GET en 1.7 / 9.10; UI sondeo grupo 15 |
| 10 | Consentimiento honesto; `redactName` activado de fábrica | 7.1 (+ textos grupo 16) |
| 11 | Diálogo no dispara solo; sugerencias usables | 15.1 (+ copiar/ordenar grupo 15) |
| 12 | Promesa desmentida → identificador de traducción nuevo | 16.11 |
| 13 | Espera del cliente del plazo del servidor; escritura tardía no crea | `maxAgeMs` en 1.7/9.10; 13.4 (sin upsert) |
| 14 | Apellido = ciudad → prevalece la ciudad | 5.12 |

**Pendiente abierto del ADR (no cerrado por esta tabla):** modelo `:free` concreto + pasada manual OpenRouter
(`data_collection: "deny"`) — tarea **17.8**, puerta humana del change.
