import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import type { AiConfig } from '@linkvault/ai';
import { CV_MAX_FILE_BYTES } from '@linkvault/shared';
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
 * `404` JSON de la API. Por eso van las tres formas, las mismas que declara el controlador.
 *
 * El comodín se escribe **`p/{*splat}`**, la forma de Nest 11 sobre `path-to-regexp` 8, que es quien resuelve este
 * `exclude`. En el **controlador** va como `p/*`, porque las rutas de un controlador las registra el router de Fastify,
 * que rechaza `{*splat}` con "Wildcard must be the last character in the route" y **no arranca**. Son dos routers
 * distintos y cada uno quiere su sintaxis; un test de integración comprueba que la combinación sirve la página.
 */
export const PUBLIC_PAGE_ROUTES = ['p', 'p/:slug', 'p/{*splat}'] as const;

/**
 * Límites del cuerpo multipart (D2 de cv-upload-extract). La única ruta que lee partes es `POST /api/cv`, y el SPA
 * manda **solo** la parte del archivo:
 *
 * - `fileSize`: el tope del contrato. El plugin corta el flujo en cuanto se pasa, así que ni siquiera se llega a
 *   acumular 5 MiB de un archivo de 500 MB.
 * - `files: 1` y `fields: 0`: cortan antes y con mejor mensaje que cualquier comprobación nuestra. Con `fields: 0`,
 *   un campo de texto de más —lo más fácil de provocar desde un formulario que añade un campo oculto— dispara
 *   `FST_FIELDS_LIMIT`, que la traducción convierte en un `400` nombrando `file`.
 * - `parts: 2`: una parte de margen sobre la única esperada. No sirve para colar nada, porque los otros dos límites
 *   cortan antes, y evita que un cliente que manda un epílogo raro acabe en un error que no dice nada.
 */
export const CV_MULTIPART_LIMITS = {
  fileSize: CV_MAX_FILE_BYTES,
  files: 1,
  fields: 0,
  parts: 2,
} as const;

/**
 * Rutas bajo `/api` salvo la salud y la página pública, para que web y API compartan origen en desarrollo (D10 de
 * bootstrap-monorepo). Registra `@fastify/cookie` (cookie de refresh), `@fastify/multipart` con los límites de la
 * subida de CV, el hook de cabeceras de `POST /api/auth/*` (D5 de auth-users) y el filtro global de errores
 * `{ code, message, fields? }` (D8). Debe ejecutarse antes de `app.init()`, que es cuando Nest registra las rutas.
 *
 * Registrar el plugin de multipart es **global**, y eso hay que decirlo: solo actúa cuando el `Content-Type` es
 * `multipart/form-data`, y cualquier otra ruta que reciba uno sigue fallando en su pipe de zod con
 * `400 validation_error`, porque su cuerpo no será el objeto que espera. **Solo `POST /api/cv` lee partes.**
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    exclude: ['health', 'health/live', ...PUBLIC_PAGE_ROUTES],
  });
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { ...CV_MULTIPART_LIMITS } });
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
