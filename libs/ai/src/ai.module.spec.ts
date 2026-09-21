import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiModule } from './ai.module';
import { PROVIDER_ELIGIBILITY, RUN_TASK } from './ai.tokens';
import type { ProviderEligibility } from './application/provider-eligibility';
import type { RunTaskFn } from './application/run-task.usecase';
import type { AiConfig } from './infrastructure/config/ai-config.schema';
import { parseAiConfig } from './infrastructure/config/parse-ai-config';
import { InvalidPrompt } from './infrastructure/prompt-registry/file-prompt-registry';
import { classifySkillsTask } from './tasks/classify-skills.task';

// Tarea 10.4 (D12 de ai-gateway-core): AiModule compila con una configuración mock/replay sobre la conexión Mongoose
// de la app y resuelve RUN_TASK; el arranque falla si falta el prompt de una tarea registrada.

const PROMPTS_DIR = join(import.meta.dirname, 'infrastructure/prompts');
const FIXTURES_DIR = join(import.meta.dirname, 'infrastructure/fixtures');

let connection: Connection;
let emptyPromptsDir: string;

/** Sustituye a `MongooseModule.forRoot` de la app: expone la conexión por defecto de forma global. */
function mongoConnectionModule(conn: Connection) {
  @Global()
  @Module({
    providers: [{ provide: getConnectionToken(), useValue: conn }],
    exports: [getConnectionToken()],
  })
  class TestMongoConnectionModule {}
  return TestMongoConnectionModule;
}

function mockReplayConfig(promptsDir = PROMPTS_DIR): AiConfig {
  const result = parseAiConfig({
    NODE_ENV: 'test',
    AI_CHAIN: 'mock',
    AI_MOCK_MODE: 'replay',
    AI_PROMPTS_DIR: promptsDir,
    AI_FIXTURES_DIR: FIXTURES_DIR,
  });
  if (!result.ok) {
    throw new Error(`invalid test config: ${JSON.stringify(result.problems)}`);
  }
  return result.config;
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `ai-module-${randomUUID()}`,
    })
    .asPromise();
  emptyPromptsDir = await mkdtemp(join(tmpdir(), 'lv-ai-no-prompts-'));
});

afterAll(async () => {
  await rm(emptyPromptsDir, { recursive: true, force: true });
  await connection.dropDatabase();
  await connection.close();
});

describe('AiModule', () => {
  it('compiles with a mock/replay config and resolves RUN_TASK', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        mongoConnectionModule(connection),
        AiModule.forRootAsync({
          useFactory: () => ({
            config: mockReplayConfig(),
            redisUrl: 'redis://127.0.0.1:1',
          }),
        }),
      ],
    }).compile();
    await moduleRef.init();

    const runTask = moduleRef.get<RunTaskFn>(RUN_TASK);
    expect(typeof runTask).toBe('function');

    const eligibility = moduleRef.get<ProviderEligibility>(PROVIDER_ELIGIBILITY);
    await expect(
      eligibility.hasEligibleProvider({
        task: { requires: {} },
        aiConsent: { externalProviders: false },
      }),
    ).resolves.toMatchObject({ status: 'ready', hasEligible: true });

    const result = await runTask(
      classifySkillsTask,
      { text: 'TypeScript y NestJS' },
      { aiConsent: { externalProviders: false } },
    );
    expect(result).toMatchObject({
      status: 'success',
      providerId: 'mock',
      cached: false,
    });

    await moduleRef.close();
  });

  it('resolves the options through inject from an imported module', async () => {
    const OPTIONS = Symbol('TEST_AI_OPTIONS');
    @Module({
      providers: [
        {
          provide: OPTIONS,
          useValue: { config: mockReplayConfig(), redisUrl: 'redis://x:1' },
        },
      ],
      exports: [OPTIONS],
    })
    class ConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        mongoConnectionModule(connection),
        AiModule.forRootAsync({
          imports: [ConfigModule],
          inject: [OPTIONS],
          useFactory: (options: { config: AiConfig; redisUrl: string }) =>
            options,
        }),
      ],
    }).compile();

    expect(typeof moduleRef.get(RUN_TASK)).toBe('function');
    await moduleRef.close();
  });

  it('fails to start when the prompts directory lacks the classify-skills prompt', async () => {
    const compiling = Test.createTestingModule({
      imports: [
        mongoConnectionModule(connection),
        AiModule.forRootAsync({
          useFactory: () => ({
            config: mockReplayConfig(emptyPromptsDir),
            redisUrl: 'redis://127.0.0.1:1',
          }),
        }),
      ],
    }).compile();

    const error = await compiling.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(InvalidPrompt);
    expect(error).toMatchObject({
      taskName: 'classify-skills',
      promptVersion: 'v1',
    });
  });
});
