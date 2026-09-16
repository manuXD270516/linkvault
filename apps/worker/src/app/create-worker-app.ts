import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import type { WorkerConfig } from '../infrastructure/config/worker-config.schema';
import { AppModule } from './app.module';

/**
 * El worker se crea como aplicación HTTP sobre Fastify solo para servir su salud en `WORKER_HEALTH_PORT`
 * (D9); no registra más controladores que los de salud. Crea la aplicación sin escuchar.
 */
export async function createWorkerApp(
  config: WorkerConfig,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  return app;
}
