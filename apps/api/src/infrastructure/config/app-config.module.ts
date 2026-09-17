import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from './api-config.schema';

/** Token de la configuración ya validada. Se inyecta con `@Inject(APP_CONFIG)`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Expone como provider global la configuración validada en `main.ts`. No usa `@nestjs/config`: la
 * validación ocurre antes de crear la aplicación (D8) y la carga de `.env` la hace Nx al ejecutar la tarea.
 */
@Module({})
export class AppConfigModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: AppConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
