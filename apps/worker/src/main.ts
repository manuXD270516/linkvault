import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

// Contexto de aplicación sin HTTP. La creación con FastifyAdapter en WORKER_HEALTH_PORT
// y la conexión de BullMQ llegan en la tarea 5.5 de bootstrap-monorepo.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('Worker started', 'Bootstrap');
}

void bootstrap();
