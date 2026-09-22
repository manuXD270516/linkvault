import { Controller, Get, Header, Res } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { Public } from './auth-context/public.decorator';

/**
 * `GET /metrics` Prometheus (D6 / ADR-033). Fuera de `/api`, sin auth de aplicación. Solo series de proceso por
 * defecto: sin labels con PII ni secretos.
 */
export const metricsRegistry = new Registry();

let defaultsRegistered = false;

function ensureDefaultMetrics(): void {
  if (defaultsRegistered) {
    return;
  }
  collectDefaultMetrics({ register: metricsRegistry });
  defaultsRegistered = true;
}

interface MetricsReply {
  header(name: string, value: string): unknown;
}

@Public()
@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  async metrics(
    @Res({ passthrough: true }) reply: MetricsReply,
  ): Promise<string> {
    ensureDefaultMetrics();
    reply.header('Content-Type', metricsRegistry.contentType);
    return await metricsRegistry.metrics();
  }
}
