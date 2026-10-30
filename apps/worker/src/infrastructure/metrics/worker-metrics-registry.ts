import { Registry } from 'prom-client';

/**
 * Registro de Prometheus del worker (D6 / ADR-033). `GET /metrics` lo sirve; los módulos registran aquí sus
 * instrumentos. Vive fuera de `presentation/` para que `infrastructure/` pueda registrar sin importar un controlador.
 */
export const workerMetricsRegistry = new Registry();
