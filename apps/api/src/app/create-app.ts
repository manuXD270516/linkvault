import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import type { ApiConfig } from '../infrastructure/config/api-config.schema';
import { AppModule } from './app.module';

export const API_GLOBAL_PREFIX = 'api';

/** Rutas bajo `/api` salvo la salud, para que web y API compartan origen en desarrollo (D10). */
export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    exclude: ['health', 'health/live'],
  });
}

/** Crea la aplicación sin escuchar. `main.ts` y los tests comparten este arranque. */
export async function createApp(
  config: ApiConfig,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config),
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  configureApp(app);
  return app;
}
