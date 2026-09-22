import { Controller, Get, Header, Res } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';

/**
 * `GET /metrics` Prometheus en el worker (D6 / ADR-033). Sin auth de aplicación; solo métricas de proceso
 * por defecto, sin labels con PII ni secretos.
 */
export const workerMetricsRegistry = new Registry();

let defaultsRegistered = false;

function ensureDefaultMetrics(): void {
  if (defaultsRegistered) {
    return;
  }
  collectDefaultMetrics({ register: workerMetricsRegistry });
  defaultsRegistered = true;
}

interface MetricsReply {
  header(name: string, value: string): unknown;
}

@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  async metrics(
    @Res({ passthrough: true }) reply: MetricsReply,
  ): Promise<string> {
    ensureDefaultMetrics();
    reply.header('Content-Type', workerMetricsRegistry.contentType);
    return await workerMetricsRegistry.metrics();
  }
}
