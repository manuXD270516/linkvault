import { randomUUID } from 'node:crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../app/app.module';
import { configureApp } from '../app/create-app';
import {
  FIXED_WINDOW_COUNTER,
  type FixedWindowCounter,
} from '../infrastructure/limits/fixed-window-counter';
import { InMemoryFixedWindowCounter } from '../infrastructure/limits/testing/in-memory-fixed-window-counter';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../modules/auth/application/ports/access-token-signer.port';
import { UsersFacade } from '../modules/users/application/users.facade';
import { USER_MODEL_NAME } from '../modules/users/infrastructure/user.schema';
import { apiTestAiConfig, apiTestConfig } from './test-config';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

export type InjectResponse = Awaited<
  ReturnType<NestFastifyApplication['inject']>
>;

export interface DiscoveryTestMember {
  readonly userId: string;
  readonly authorization: string;
}

export interface DiscoveryTestApp {
  readonly app: NestFastifyApplication;
  authenticated(displayName?: string): Promise<DiscoveryTestMember>;
  request(
    method: 'GET',
    url: string,
    options?: { authorization?: string },
  ): Promise<InjectResponse>;
  close(): Promise<void>;
}

export interface DiscoveryTestAppOptions {
  readonly featureDiscovery?: boolean;
  readonly counter?: FixedWindowCounter;
}

/**
 * App completa con discovery mock (FEATURE_DISCOVERY + DISCOVERY_CHAIN=mock).
 * Contador en memoria: la suite no levanta Redis.
 */
export async function createDiscoveryTestApp(
  name: string,
  mongoUri: string,
  options: DiscoveryTestAppOptions = {},
): Promise<DiscoveryTestApp> {
  const config = await apiTestConfig({
    MONGO_URI: withDatabase(mongoUri, `${name}-${randomUUID()}`),
    FEATURE_DISCOVERY: options.featureDiscovery ?? true,
    DISCOVERY_CHAIN: 'mock',
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config, apiTestAiConfig())],
  })
    .overrideProvider(FIXED_WINDOW_COUNTER)
    .useValue(options.counter ?? new InMemoryFixedWindowCounter())
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  await configureApp(app, {
    extensionCorsOrigins: config.EXTENSION_CORS_ORIGINS,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const connection = app.get<Connection>(getConnectionToken());
  await connection.asPromise();
  await connection.model(USER_MODEL_NAME).init();

  const users = app.get(UsersFacade, { strict: false });
  const signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, {
    strict: false,
  });

  return {
    app,
    async authenticated(displayName = 'Ana') {
      const profile = await users.createWithPassword({
        email: `${randomUUID()}@example.com`,
        passwordHash: HASH,
        displayName,
      });
      const { accessToken } = await signer.sign({
        userId: profile.id,
        sessionId: randomUUID(),
      });
      return {
        userId: profile.id,
        authorization: `Bearer ${accessToken}`,
      };
    },
    request(method, url, opts = {}) {
      return app.inject({
        method,
        url,
        headers: {
          ...(opts.authorization === undefined
            ? {}
            : { authorization: opts.authorization }),
        },
      });
    },
    async close() {
      await connection.dropDatabase();
      await app.close();
    },
  };
}

function withDatabase(mongoUri: string, dbName: string): string {
  const url = new URL(mongoUri);
  url.pathname = `/${dbName}`;
  return url.toString();
}
