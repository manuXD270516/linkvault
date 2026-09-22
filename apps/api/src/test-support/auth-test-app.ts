import { randomUUID } from 'node:crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import { AppModule } from '../app/app.module';
import { configureApp } from '../app/create-app';
import type { ApiConfig } from '../infrastructure/config/api-config.schema';
import { REDIS_APP_CLIENT } from '../infrastructure/redis/redis-app-client';
import { CLOCK } from '../modules/auth/application/ports/clock.port';
import type { Clock } from '../modules/auth/domain/clock';
import {
  AUTH_SESSION_MODEL_NAME,
  REFRESH_TOKEN_MODEL_NAME,
} from '../modules/auth/infrastructure/session.schemas';
import { REFRESH_COOKIE_NAME } from '../modules/auth/presentation/refresh-cookie';
import { USER_MODEL_NAME } from '../modules/users/infrastructure/user.schema';
import { apiTestAiConfig, apiTestConfig } from './test-config';

// App completa de `api` para los tests de integración de auth (D12 de auth-users): el `AppModule` real con el mismo
// `configureApp` que `createApp`, una base de datos propia en el Mongo del preset y el doble de Redis. Solo sustituye el
// reloj de `auth`, para mover el tiempo sin esperar (ventana de conflicto de 10 s, caducidades).

/** Reloj real desplazable: `advance` adelanta el tiempo que ven `auth` y sus adaptadores. */
export class OffsetClock implements Clock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  advance(ms: number): void {
    this.offsetMs += ms;
  }
}

export interface AuthTestApp {
  readonly app: NestFastifyApplication;
  readonly config: ApiConfig;
  readonly clock: OffsetClock;
  readonly connection: Connection;
  close(): Promise<void>;
}

export interface AuthTestAppOptions {
  /** URI del replica set de test (`getMongoTestUri()`); se usa una base de datos nueva. */
  readonly mongoUri: string;
  /** URL del doble de Redis. */
  readonly redisUrl: string;
  readonly config?: Partial<ApiConfig>;
}

export async function createAuthTestApp(
  options: AuthTestAppOptions,
): Promise<AuthTestApp> {
  const mongoUrl = new URL(options.mongoUri);
  mongoUrl.pathname = `/auth-${randomUUID()}`;
  const config = await apiTestConfig({
    MONGO_URI: mongoUrl.toString(),
    REDIS_URL: options.redisUrl,
    ...options.config,
  });
  const clock = new OffsetClock();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config, apiTestAiConfig())],
  })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: config.TRUST_PROXY === true }),
    { logger: false },
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const connection = app.get<Connection>(getConnectionToken());
  await connection.asPromise();
  // Los índices se construyen en segundo plano: sin esperarlos, un alta duplicada puede colarse antes de que exista el
  // único de `email` y el test de "Email ya registrado" vería un 201.
  await Promise.all(
    [USER_MODEL_NAME, AUTH_SESSION_MODEL_NAME, REFRESH_TOKEN_MODEL_NAME].map(
      (model) => connection.model(model).init(),
    ),
  );
  // Sin esperar a Redis, el limitador fallaría abierto y los tests de límites pasarían sin probar nada.
  const redis = app.get<Redis>(REDIS_APP_CLIENT);
  if (redis.status !== 'ready') {
    await new Promise<void>((resolve) => redis.once('ready', () => resolve()));
  }

  return {
    app,
    config,
    clock,
    connection,
    async close() {
      await connection.dropDatabase();
      await app.close();
    },
  };
}

export const CSRF_HEADERS = { 'x-requested-with': 'linkvault' } as const;

export interface AuthPostOptions {
  readonly body?: unknown;
  readonly refreshToken?: string;
  readonly accessToken?: string;
  readonly remoteAddress?: string;
  /** `false` omite `X-Requested-With`. */
  readonly csrf?: boolean;
}

/** `POST /api/auth/<path>` como lo hace el SPA: cabecera CSRF, JSON y, si se indican, cookie y Bearer. */
export function authPost(
  app: NestFastifyApplication,
  path: string,
  options: AuthPostOptions = {},
): ReturnType<NestFastifyApplication['inject']> {
  const headers: Record<string, string> = {
    ...(options.csrf === false ? {} : CSRF_HEADERS),
  };
  if (options.accessToken !== undefined) {
    headers['authorization'] = `Bearer ${options.accessToken}`;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  return app.inject({
    method: 'POST',
    url: `/api/auth/${path}`,
    headers,
    remoteAddress: options.remoteAddress ?? '127.0.0.1',
    cookies:
      options.refreshToken === undefined
        ? {}
        : { [REFRESH_COOKIE_NAME]: options.refreshToken },
    ...(options.body === undefined
      ? {}
      : { payload: JSON.stringify(options.body) }),
  });
}

/** Cabecera `Set-Cookie` de `lv_refresh`, o `undefined` si la respuesta no la fija. */
export function refreshSetCookie(
  headers: Record<string, string | string[] | number | undefined>,
): string | undefined {
  const raw = headers['set-cookie'];
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return values.find((value) => value.startsWith(`${REFRESH_COOKIE_NAME}=`));
}

/** Valor de `lv_refresh` fijado por la respuesta, o `undefined`. */
export function refreshTokenFrom(
  headers: Record<string, string | string[] | number | undefined>,
): string | undefined {
  const cookie = refreshSetCookie(headers);
  if (cookie === undefined) {
    return undefined;
  }
  const value = cookie.slice(REFRESH_COOKIE_NAME.length + 1).split(';')[0];
  return value === undefined || value === '' ? undefined : decodeURIComponent(value);
}
