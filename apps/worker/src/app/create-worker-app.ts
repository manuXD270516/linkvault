import type { AiConfig } from '@linkvault/ai';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import type { WorkerConfig } from '../infrastructure/config/worker-config.schema';
import { AppModule } from './app.module';

/**
 * Host en el que el `worker` sirve su salud: **todas las interfaces IPv4** (tarea 7.9 de `object-store`, ADR-052
 * «Decisiones del usuario tras el punto de revisión», 5). Con el adaptador Fastify, `listen(port)` sin host escucha en
 * `localhost`, y dentro de un contenedor ningún otro contenedor de la red alcanza `WORKER_HEALTH_PORT`, mientras los
 * healthchecks, que preguntan desde dentro por `127.0.0.1`, siguen en verde. Mismo valor y mismo motivo que en `api`
 * (`apps/api/src/app/create-app.ts`); no `::`, que en un host con IPv6 desactivado no arrancaría.
 */
export const LISTEN_HOST = '0.0.0.0';

/**
 * El worker se crea como aplicación HTTP sobre Fastify solo para servir su salud en `WORKER_HEALTH_PORT`
 * (D9); no registra más controladores que los de salud. Crea la aplicación sin escuchar.
 */
export async function createWorkerApp(
  config: WorkerConfig,
  ai: AiConfig,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, ai),
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  return app;
}

/** Pone la salud del `worker` a escuchar en `port` en {@link LISTEN_HOST}. `main.ts` arranca por aquí. */
export async function listenOnAllInterfaces(
  app: NestFastifyApplication,
  port: number,
): Promise<void> {
  await app.listen(port, LISTEN_HOST);
}
