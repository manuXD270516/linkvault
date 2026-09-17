import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { WorkerConfig } from '../config/worker-config.schema';
import { APP_CONFIG } from '../config/app-config.module';
import { buildLoggerParams } from './logger-params';

/** Logs JSON estructurados con pino y redacción de secretos (D11). */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: WorkerConfig) => buildLoggerParams(config),
    }),
  ],
})
export class AppLoggerModule {}
