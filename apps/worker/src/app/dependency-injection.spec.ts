import { randomUUID } from 'node:crypto';
import {
  AiModule,
  PROVIDER_ELIGIBILITY,
  type ProviderEligibility,
} from '@linkvault/ai';
import { getMongoTestUri } from '@linkvault/testing';
import { Global, Injectable, Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workerTestAiConfig } from '../test-support/test-config';

// Sonda de infraestructura de tests: ProbeConsumer recibe ProbeDependency por constructor sin @Inject,
// así que Nest solo puede resolverla si el transformador emitió design:paramtypes.
// Tarea 4.4: el token PROVIDER_ELIGIBILITY también se resuelve en el worker.

@Injectable()
class ProbeDependency {
  readonly id = 'probe-dependency';
}

@Injectable()
class ProbeConsumer {
  constructor(readonly dependency: ProbeDependency) {}
}

@Module({ providers: [ProbeDependency, ProbeConsumer] })
class ProbeModule {}

function mongoConnectionModule(conn: Connection) {
  @Global()
  @Module({
    providers: [{ provide: getConnectionToken(), useValue: conn }],
    exports: [getConnectionToken()],
  })
  class TestMongoConnectionModule {}
  return TestMongoConnectionModule;
}

describe('Nest dependency injection under Vitest', () => {
  it('injects a constructor dependency resolved from decorator metadata', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();

    const consumer = moduleRef.get(ProbeConsumer);

    expect(consumer.dependency).toBeInstanceOf(ProbeDependency);
    expect(consumer.dependency).toBe(moduleRef.get(ProbeDependency));
    expect(consumer.dependency.id).toBe('probe-dependency');

    await moduleRef.close();
  });
});

describe('PROVIDER_ELIGIBILITY in the worker process', () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await mongoose
      .createConnection(getMongoTestUri(), {
        dbName: `worker-di-eligibility-${randomUUID()}`,
      })
      .asPromise();
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await connection.close();
  });

  it('resolves the eligibility query exported by AiModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        mongoConnectionModule(connection),
        AiModule.forRootAsync({
          useFactory: () => ({
            config: workerTestAiConfig(),
            redisUrl: 'redis://127.0.0.1:1',
          }),
        }),
      ],
    }).compile();
    await moduleRef.init();

    const eligibility =
      moduleRef.get<ProviderEligibility>(PROVIDER_ELIGIBILITY);
    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: {} },
        aiConsent: { externalProviders: false },
      }),
    ).resolves.toMatchObject({ status: 'ready' });

    await moduleRef.close();
  });
});
