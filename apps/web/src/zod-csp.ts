// zod sin JIT en el navegador (D3 de edge-security-headers, ADR-057).
//
// zod 4 sondea `new Function('')` dentro de un `try` para decidir si compila sus validadores. Bajo una CSP sin
// `'unsafe-eval'` cae al camino sin JIT, pero el navegador informa una violación de `script-src` en cada carga y
// ensucia la señal del barrido y de la pasada de staging. Este módulo se importa en la PRIMERA línea de `main.ts`,
// antes de cualquier esquema.
import { z } from 'zod';

z.config({ jitless: true });
