import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AiModule, parseAiConfig } from '@linkvault/ai';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppConfigModule } from '../../infrastructure/config/app-config.module';
import { MongoPersistenceModule } from '../../infrastructure/persistence/mongo-persistence.module';
import { workerTestConfig } from '../../test-support/test-config';
import { AnalyzeMatchUseCase } from './application/analyze-match.usecase';
import { ANALYSIS_REPOSITORY } from './application/ports/analysis-repository.port';
import { AI_CONTEXT_READER } from './application/ports/ai-context-reader.port';
import { MATCH_CLOCK } from './application/ports/clock.port';
import { CV_TEXT_READER } from './application/ports/cv-text-reader.port';
import { JOB_READER } from './application/ports/job-reader.port';
import { MongoAiContextReader } from './infrastructure/persistence/mongo-ai-context.reader';
import { MongoAnalysisRepository } from './infrastructure/persistence/mongo-analysis.repository';
import { MongoCvTextReader } from './infrastructure/persistence/mongo-cv-text.reader';
import { MongoJobReader } from './infrastructure/persistence/mongo-job.reader';
import { AnalyzeMatchConsumer } from './infrastructure/queue/analyze-match.consumer';
import { MatchModule } from './match.module';

let moduleRef: TestingModule | undefined;

afterEach(async () => {
  await moduleRef?.close();
  moduleRef = undefined;
});

function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('workspaceRoot: nx.json not found');
    }
    dir = parent;
  }
  return dir;
}

async function compile(): Promise<TestingModule> {
  const config = await workerTestConfig();
  const root = workspaceRoot();
  const ai = parseAiConfig(
    {
      NODE_ENV: 'test',
      AI_CHAIN: 'mock',
      AI_MOCK_MODE: 'replay',
      AI_PROMPTS_DIR: join(root, 'libs/ai/src/infrastructure/prompts'),
      AI_FIXTURES_DIR: join(root, 'libs/ai/src/infrastructure/fixtures'),
    },
    { cwd: root },
  );
  if (!ai.ok) {
    throw new Error('invalid AI config for MatchModule test');
  }
  const aiModule = AiModule.forRootAsync({
    useFactory: () => ({ config: ai.config, redisUrl: config.REDIS_URL }),
  });
  return await Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot(config),
      MongoPersistenceModule,
      MatchModule.register(config, aiModule),
    ],
  }).compile();
}

describe('MatchModule wiring', () => {
  it('resolves every port with its adapter', async () => {
    moduleRef = await compile();
    expect(moduleRef.get(ANALYSIS_REPOSITORY)).toBeInstanceOf(
      MongoAnalysisRepository,
    );
    expect(moduleRef.get(CV_TEXT_READER)).toBeInstanceOf(MongoCvTextReader);
    expect(moduleRef.get(JOB_READER)).toBeInstanceOf(MongoJobReader);
    expect(moduleRef.get(AI_CONTEXT_READER)).toBeInstanceOf(
      MongoAiContextReader,
    );
    expect(moduleRef.get(MATCH_CLOCK)).toBeDefined();
    expect(moduleRef.get(getConnectionToken(), { strict: false })).toBeDefined();
    expect(moduleRef.get(AnalyzeMatchUseCase)).toBeInstanceOf(
      AnalyzeMatchUseCase,
    );
  });

  it('registers no consumer under NODE_ENV=test', async () => {
    moduleRef = await compile();
    expect(() => moduleRef?.get(AnalyzeMatchConsumer)).toThrow();
  });
});

describe('match domain layer boundaries', () => {
  it('no domain file imports @linkvault/ai, @nestjs/*, bullmq or mongoose', () => {
    const domainDir = join(import.meta.dirname, 'domain');
    const banned =
      /(?:^|\n)\s*(?:import|export)[^\n;]*from\s*['"](@linkvault\/ai|@nestjs\/[^'"]+|bullmq|mongoose)['"]/;
    const offenders = filesUnder(domainDir).filter((file) =>
      banned.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(path));
    } else if (entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}
