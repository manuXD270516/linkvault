import { randomUUID } from 'node:crypto';
import type { GroupDetail } from '@linkvault/shared';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { Logger } from 'nestjs-pino';
import { expect } from 'vitest';
import { AppModule } from '../app/app.module';
import { configureApp } from '../app/create-app';
import {
  FIXED_WINDOW_COUNTER,
  type AttemptOutcome,
  type FixedWindowCounter,
  type WindowLimit,
} from '../infrastructure/limits/fixed-window-counter';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../modules/auth/application/ports/access-token-signer.port';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MODEL_NAME,
} from '../modules/groups/infrastructure/group.schemas';
import { UsersFacade } from '../modules/users/application/users.facade';
import { USER_MODEL_NAME } from '../modules/users/infrastructure/user.schema';
import { apiTestAiConfig, apiTestConfig } from './test-config';

// App completa de `api` para las pruebas HTTP del límite de intentos del join (D4 y tarea 4.5a de
// groups-ownership-join-limit): el `AppModule` real con su propia base de datos y dos piezas controlables.
//
// - El **contador** de intentos es un doble que cuenta de verdad (ventana fija, sin reloj), y que por clave puede
//   rechazar siempre o no responder (`null`), como un Redis caído. Esta suite no levanta Redis (ADR-021 §4).
// - La **IP** de cada petición se indica con `remoteAddress`: sin `trustProxy`, es la que ve `request.ip`. Cada test
//   pide con `nextTest()` una dirección por defecto nueva, así que los contadores por IP de un test no se mezclan con
//   los del siguiente, y un mismo test puede simular dos IPs pasando `remoteAddress` a una petición concreta.
//
// La URI del replica set la pasa quien llama (`getMongoTestUri()`): este archivo no es un spec y no puede depender de
// `@linkvault/testing`.

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

export type InjectResponse = Awaited<
  ReturnType<NestFastifyApplication['inject']>
>;

/** Qué hace el contador con una clave: contar, rechazar siempre o no responder. */
export type CounterBehaviour = 'count' | 'reject' | 'unavailable';

export interface CounterCall {
  readonly op: 'consume' | 'giveBack';
  readonly key: string;
}

/**
 * Contador de intentos controlable. Cuenta como el real (N intentos caben en el límite, el siguiente se rechaza con el
 * `Retry-After` de la ventana entera) sin caducar nunca: un test no dura una ventana.
 */
export class ControllableCounter implements FixedWindowCounter {
  readonly calls: CounterCall[] = [];
  /** `Retry-After` de un rechazo forzado con `reject`. */
  rejectRetryAfterSeconds = 600;
  private readonly counts = new Map<string, number>();
  private readonly behaviours = new Map<string, CounterBehaviour>();
  private fallback: CounterBehaviour = 'count';

  /** Comportamiento de una clave concreta, o de todas si no se da clave. */
  behave(behaviour: CounterBehaviour, key?: string): void {
    if (key === undefined) {
      this.fallback = behaviour;
      this.behaviours.clear();
    } else {
      this.behaviours.set(key, behaviour);
    }
  }

  /** Intentos que cuentan ahora mismo en esa clave. */
  countOf(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  consume(key: string, limit: WindowLimit): Promise<AttemptOutcome | null> {
    this.calls.push({ op: 'consume', key });
    const behaviour = this.behaviourOf(key);
    if (behaviour === 'unavailable') {
      return Promise.resolve(null);
    }
    const count = this.countOf(key) + 1;
    this.counts.set(key, count);
    if (behaviour === 'reject') {
      return Promise.resolve({
        allowed: false,
        retryAfterSeconds: this.rejectRetryAfterSeconds,
      });
    }
    return Promise.resolve(
      count <= limit.limit
        ? { allowed: true, retryAfterSeconds: 0 }
        : {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil(limit.windowMs / 1000)),
          },
    );
  }

  reset(key: string): Promise<boolean> {
    this.counts.delete(key);
    return Promise.resolve(true);
  }

  giveBack(key: string): Promise<boolean> {
    this.calls.push({ op: 'giveBack', key });
    if (this.behaviourOf(key) === 'unavailable') {
      return Promise.resolve(false);
    }
    const count = this.countOf(key) - 1;
    if (count <= 0) {
      this.counts.delete(key);
    } else {
      this.counts.set(key, count);
    }
    return Promise.resolve(true);
  }

  private behaviourOf(key: string): CounterBehaviour {
    return this.behaviours.get(key) ?? this.fallback;
  }
}

export interface JoinTestMember {
  readonly userId: string;
  readonly authorization: string;
}

export interface JoinOptions {
  /** IP de la petición; por defecto, la del test en curso. */
  readonly remoteAddress?: string;
}

export interface GroupsJoinTestApp {
  readonly app: NestFastifyApplication;
  readonly connection: Connection;
  readonly counter: ControllableCounter;
  /** IP por defecto del test en curso. */
  readonly defaultAddress: string;
  /** Empieza un test: IP por defecto nueva y contador que vuelve a contar normalmente. */
  nextTest(): void;
  authenticated(displayName?: string): Promise<JoinTestMember>;
  createGroup(owner: JoinTestMember, name?: string): Promise<GroupDetail>;
  /** `POST /api/groups/join` con ese código, desde la IP indicada o la del test. */
  join(
    member: JoinTestMember,
    code: string,
    options?: JoinOptions,
  ): Promise<InjectResponse>;
  close(): Promise<void>;
}

export interface GroupsJoinTestAppOptions {
  /**
   * Otro contador en lugar del controlable, p. ej. el real sobre un Redis inalcanzable para probar el aviso de "almacén
   * caído", que es del contador y no del adaptador del join. `counter` sigue existiendo, pero no se usa.
   */
  readonly counter?: FixedWindowCounter;
}

export async function createGroupsJoinTestApp(
  mongoUri: string,
  options: GroupsJoinTestAppOptions = {},
): Promise<GroupsJoinTestApp> {
  const config = await apiTestConfig({
    MONGO_URI: withDatabase(mongoUri, `groups-join-${randomUUID()}`),
  });
  const counter = new ControllableCounter();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config, apiTestAiConfig())],
  })
    .overrideProvider(FIXED_WINDOW_COUNTER)
    .useValue(options.counter ?? counter)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const connection = app.get<Connection>(getConnectionToken());
  await connection.asPromise();
  for (const model of [
    USER_MODEL_NAME,
    GROUP_MODEL_NAME,
    GROUP_MEMBER_MODEL_NAME,
  ]) {
    await connection.model(model).init();
  }
  const users = app.get(UsersFacade, { strict: false });
  const signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, {
    strict: false,
  });

  let testIndex = 0;
  let defaultAddress = addressOf(testIndex);

  const inject = (
    method: 'POST',
    url: string,
    authorization: string,
    body: unknown,
    remoteAddress: string,
  ) =>
    app.inject({
      method,
      url,
      remoteAddress,
      headers: { authorization, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });

  return {
    app,
    connection,
    counter,
    get defaultAddress() {
      return defaultAddress;
    },
    nextTest() {
      testIndex += 1;
      defaultAddress = addressOf(testIndex);
      counter.behave('count');
    },
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
      return { userId: profile.id, authorization: `Bearer ${accessToken}` };
    },
    async createGroup(owner, name = 'Backend Bolivia') {
      const response = await inject(
        'POST',
        '/api/groups',
        owner.authorization,
        { name },
        defaultAddress,
      );
      expect(response.statusCode).toBe(201);
      return response.json<GroupDetail>();
    },
    join(member, code, options = {}) {
      return inject(
        'POST',
        '/api/groups/join',
        member.authorization,
        { code },
        options.remoteAddress ?? defaultAddress,
      );
    },
    async close() {
      await connection.dropDatabase();
      await app.close();
    },
  };
}

/** IPv4 de documentación distinta para cada test (198.18.0.0/15, reservada para pruebas). */
function addressOf(index: number): string {
  return `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
}

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}
