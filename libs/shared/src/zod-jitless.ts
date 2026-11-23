// zod sin JIT (D3 de edge-security-headers, ADR-057 §3 ampliado).
//
// zod 4 sondea `new Function('')` al construir cada esquema de objeto. Bajo una CSP sin `'unsafe-eval'` el navegador
// informa una violación de `script-src` por cada carga. Los esquemas de esta librería importan `z` de AQUÍ y no de
// 'zod': así la configuración corre antes de construir cualquiera de ellos por dependencia directa del módulo, sin
// depender del orden en que el bundler reparta los chunks (un `import './zod-jitless'` suelto en el índice no basta: el
// bundler de producción lo evalúa después de los esquemas). En api y worker `jitless` vale igual (solo cambia el camino de
// validación, no el resultado).
import { z } from 'zod';

z.config({ jitless: true });

export { z };
