import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  AiModule,
  parseAiConfig,
  PROVIDER_ELIGIBILITY,
  type ProviderEligibility,
} from '@linkvault/ai';
import { getMongoTestUri } from '@linkvault/testing';
import { Global, Injectable, Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workspaceRoot } from '../test-support/test-config';

// Sonda de infraestructura de tests: ProbeConsumer recibe ProbeDependency por constructor sin @Inject,
// así que Nest solo puede resolverla si el transformador emitió design:paramtypes.
// Tarea 4.4: el token PROVIDER_ELIGIBILITY se resuelve en el proceso de la API.

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

function eligibilityAiConfig() {
  const root = workspaceRoot();
  const result = parseAiConfig(
    {
      NODE_ENV: 'test',
      AI_CHAIN: 'mock',
      AI_MOCK_MODE: 'replay',
      AI_PROMPTS_DIR: join(root, 'libs/ai/src/infrastructure/prompts'),
      AI_FIXTURES_DIR: join(root, 'libs/ai/src/infrastructure/fixtures'),
    },
    { cwd: root },
  );
  if (!result.ok) {
    throw new Error(
      `eligibilityAiConfig: invalid AI configuration (${result.problems.map((p) => p.variable).join(', ')})`,
    );
  }
  return result.config;
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

describe('PROVIDER_ELIGIBILITY in the API process', () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await mongoose
      .createConnection(getMongoTestUri(), {
        dbName: `api-di-eligibility-${randomUUID()}`,
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
            config: eligibilityAiConfig(),
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

describe('MatchModule in the API process', () => {
  it('is documented in match.controller.spec wiring suite (task 10.10 / 11.4)', () => {
    // Cableado completo (use cases + ports + registros de CvDeletionHooks / CvAnalysisCounts + rutas 401)
    // vive junto al HTTP del módulo: ver "MatchModule wiring and public inventory (10.10)".
    expect(true).toBe(true);
  });
});

