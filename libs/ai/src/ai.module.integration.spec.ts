import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { getMongoTestUri, RedisPingDouble } from '@linkvault/testing';
import { Redis } from 'ioredis';
import mongoose, { type Connection } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiModule } from './ai.module';
import { AI_CACHE_REDIS_CLIENT, RUN_TASK } from './ai.tokens';
import { executionKey } from './application/execution-key';
import type { RunTaskFn } from './application/run-task.usecase';
import type { RunContext } from './domain/run-context';
import type { AiConfig } from './infrastructure/config/ai-config.schema';
import {
  parseAiConfig,
  type AiEnv,
} from './infrastructure/config/parse-ai-config';
import { AI_USAGE_COLLECTION } from './infrastructure/persistence/ai-usage.schema';
import { classifySkillsTask } from './tasks/classify-skills.task';

// Tarea 10.5 (D8, D9 y D12 de ai-gateway-core): AiModule de punta a punta con el Mongo en memoria del preset y el doble
// RESP de @linkvault/testing. Replay con el mock (caché nula) y, aparte, un proveedor Ollama contra un servidor
// node:http local para ejercitar la caché real en Redis.

const PROMPTS_DIR = join(import.meta.dirname, 'infrastructure/prompts');
const FIXTURES_DIR = join(import.meta.dirname, 'infrastructure/fixtures');
const CTX: RunContext = {
  userId: 'integration-user',
  aiConsent: { externalProviders: false },
};
const INPUT = { text: 'TypeScript y NestJS' };
const OUTPUT = {
  skills: [
    { name: 'TypeScript', category: 'language' },
    { name: 'NestJS', category: 'framework' },
  ],
};

let connection: Connection;
let double: RedisPingDouble;
let moduleRef: TestingModule | undefined;
let server: Server | undefined;
let inspector: Redis | undefined;

function mongoConnectionModule(conn: Connection) {
  @Global()
  @Module({
    providers: [{ provide: getConnectionToken(), useValue: conn }],
    exports: [getConnectionToken()],
  })
  class TestMongoConnectionModule {}
  return TestMongoConnectionModule;
}

function configFor(env: AiEnv): AiConfig {
  const result = parseAiConfig({
    NODE_ENV: 'test',
    AI_PROMPTS_DIR: PROMPTS_DIR,
    AI_FIXTURES_DIR: FIXTURES_DIR,
    ...env,
  });
  if (!result.ok) {
    throw new Error(`invalid test config: ${JSON.stringify(result.problems)}`);
  }
  return result.config;
}

async function startAiModule(config: AiConfig): Promise<TestingModule> {
  // La conexión debe estar abierta: el ledger usa bufferCommands: false.
  await connection.asPromise();
  moduleRef = await Test.createTestingModule({
    imports: [
      mongoConnectionModule(connection),
      AiModule.forRootAsync({
        useFactory: () => ({ config, redisUrl: double.url }),
      }),
    ],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

function keyOf(input: unknown): string {
  return executionKey({
    taskName: classifySkillsTask.name,
    promptVersion: classifySkillsTask.promptVersion,
    outputLanguage: 'es',
    input,
  });
}

async function usageRecords(key: string): Promise<Record<string, unknown>[]> {
  return connection
    .collection(AI_USAGE_COLLECTION)
    .find({ key }, { projection: { _id: 0 } })
    .toArray();
}

/** Servidor que imita `POST /api/chat` de Ollama respondiendo la salida de classify-skills. */
async function startOllama(): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      requests.push(`${req.method ?? ''} ${req.url ?? ''}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'qwen2.5:7b',
          message: { role: 'assistant', content: JSON.stringify(OUTPUT) },
          prompt_eval_count: 90,
          eval_count: 20,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests };
}

beforeEach(async () => {
  connection = mongoose.createConnection(getMongoTestUri(), {
    dbName: `ai-module-it-${randomUUID()}`,
  });
  double = await RedisPingDouble.start('up');
});

afterEach(async () => {
  await moduleRef?.close();
  moduleRef = undefined;
  inspector?.disconnect();
  inspector = undefined;
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  await double.close();
  await connection.dropDatabase();
  await connection.close();
});

describe('AiModule integration', () => {
  it('runs classify-skills in replay and records a success in ai_usage', async () => {
    const app = await startAiModule(
      configFor({ AI_CHAIN: 'mock', AI_MOCK_MODE: 'replay' }),
    );
    const runTask = app.get<RunTaskFn>(RUN_TASK);

    const result = await runTask(classifySkillsTask, INPUT, CTX);

    expect(result).toEqual({
      status: 'success',
      output: OUTPUT,
      providerId: 'mock',
      model: 'handwritten',
      promptVersion: 'v1',
      cached: false,
    });
    // Con mock en la cadena no hay cliente de Redis: la caché es nula.
    expect(app.get(AI_CACHE_REDIS_CLIENT)).toBeNull();

    const key = keyOf(INPUT);
    await vi.waitFor(
      async () => {
        expect(await usageRecords(key)).toEqual([
          expect.objectContaining({
            userId: 'integration-user',
            task: 'classify-skills',
            providerId: 'mock',
            model: 'handwritten',
            outcome: 'success',
            promptVersion: 'v1',
            key,
          }),
        ]);
      },
      { timeout: 2_000, interval: 25 },
    );
  });

  it('uses the Redis cache with a real provider and records only the provider attempt', async () => {
    const ollama = await startOllama();
    const app = await startAiModule(
      configFor({ AI_CHAIN: 'ollama', OLLAMA_URL: ollama.url }),
    );
    const client = app.get<Redis>(AI_CACHE_REDIS_CLIENT);
    await vi.waitFor(() => expect(client.status).toBe('ready'), {
      timeout: 2_000,
      interval: 10,
    });
    const runTask = app.get<RunTaskFn>(RUN_TASK);
    const input = { text: 'Backend con TypeScript y NestJS' };
    const key = keyOf(input);

    const first = await runTask(classifySkillsTask, input, CTX);
    expect(first).toMatchObject({
      status: 'success',
      output: OUTPUT,
      providerId: 'ollama',
      model: 'qwen2.5:7b',
      cached: false,
    });

    await vi.waitFor(
      async () => {
        expect(await usageRecords(key)).toEqual([
          expect.objectContaining({
            providerId: 'ollama',
            outcome: 'success',
            inputTokens: 90,
            outputTokens: 20,
            estCost: 0,
          }),
        ]);
      },
      { timeout: 2_000, interval: 25 },
    );

    inspector = new Redis(double.url, {
      lazyConnect: true,
      enableReadyCheck: false,
    });
    const stored = await inspector.get(`ai:cache:v1:${key}`);
    expect(JSON.parse(stored ?? 'null')).toEqual({
      output: OUTPUT,
      providerId: 'ollama',
      model: 'qwen2.5:7b',
      promptVersion: 'v1',
    });

    const second = await runTask(classifySkillsTask, input, CTX);
    expect(second).toEqual({ ...first, cached: true });
    expect(ollama.requests).toEqual(['POST /api/chat']);

    // Un acierto de caché no se registra: sigue habiendo un único registro.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await usageRecords(key)).toHaveLength(1);

    // Al cerrar la app, onApplicationShutdown desconecta el cliente (el cambio de estado de ioredis es asíncrono).
    await app.close();
    moduleRef = undefined;
    await vi.waitFor(() => expect(client.status).toBe('end'), {
      timeout: 1_000,
      interval: 10,
    });
  });
});
