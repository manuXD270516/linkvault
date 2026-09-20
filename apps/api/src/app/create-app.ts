import fastifyCookie from '@fastify/cookie';
import type { AiConfig } from '@linkvault/ai';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import type { ApiConfig } from '../infrastructure/config/api-config.schema';
import { authHeadersHook } from '../modules/auth/presentation/auth-headers';
import { ApiExceptionFilter } from '../presentation/http/api-exception.filter';
import { AppModule } from './app.module';

export const API_GLOBAL_PREFIX = 'api';

/**
 * Rutas fuera del prefijo `/api`: la salud y la **página pública** `/p/:slug` (D4 de public-preview-share). Esa URL se
 * pega en un chat, así que tiene que ser corta, y `/api/...` es por contrato JSON con sesión.
 *
 * `setGlobalPrefix` compara **rutas**, no prefijos de cadena: con `'p'` a secas la única ruta excluida sería `/p` —que
 * no existe— y `/p/<slug>` acabaría bajo `/api/p/<slug>`, es decir, el enlace repartido por WhatsApp respondería el
 * `404` JSON de la API. Por eso van las tres formas, las mismas que declara el controlador, y el comodín se escribe
 * `p/{*splat}`: Nest 11 va sobre `path-to-regexp` 8, donde `'p/*'` no es un comodín válido y **lanza al arrancar**.
 */
export const PUBLIC_PAGE_ROUTES = ['p', 'p/:slug', 'p/{*splat}'] as const;

/**
 * Rutas bajo `/api` salvo la salud y la página pública, para que web y API compartan origen en desarrollo (D10 de
 * bootstrap-monorepo). Registra `@fastify/cookie` (cookie de refresh), el hook de cabeceras de `POST /api/auth/*` (D5
 * de auth-users) y el filtro global de errores `{ code, message, fields? }` (D8). Debe ejecutarse antes de
 * `app.init()`, que es cuando Nest registra las rutas.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    exclude: ['health', 'health/live', ...PUBLIC_PAGE_ROUTES],
  });
  await app.register(fastifyCookie);
  app.getHttpAdapter().getInstance().addHook('onRequest', authHeadersHook);
  app.useGlobalFilters(new ApiExceptionFilter(app.getHttpAdapter()));
}

/** Crea la aplicación sin escuchar. `main.ts` y los tests comparten este arranque. */
export async function createApp(
  config: ApiConfig,
  ai: AiConfig,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, ai),
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  await configureApp(app);
  return app;
}
