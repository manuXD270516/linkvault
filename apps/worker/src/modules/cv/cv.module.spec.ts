import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppConfigModule } from '../../infrastructure/config/app-config.module';
import { MongoPersistenceModule } from '../../infrastructure/persistence/mongo-persistence.module';
import { workerTestConfig } from '../../test-support/test-config';
import { StubSearchIndexModule } from '../../test-support/stub-search-index.module';
import { DeleteCvFileUseCase } from './application/delete-cv-file.usecase';
import { ExtractCvUseCase } from './application/extract-cv.usecase';
import { CV_CLOCK } from './application/ports/clock.port';
import { CV_FILE_READER } from './application/ports/cv-file-reader.port';
import { CV_REPOSITORY } from './application/ports/cv-repository.port';
import { CV_TEXT_EXTRACTORS } from './application/ports/cv-text-extractors.port';
import { CvModule } from './cv.module';
import { DeleteCvFileConsumer } from './infrastructure/queue/delete-cv-file.consumer';
import { ExtractCvConsumer } from './infrastructure/queue/extract-cv.consumer';
import { MongoCvRepository } from './infrastructure/persistence/mongo-cv.repository';
import { S3CvFileReader } from './infrastructure/storage/s3-cv-file.reader';

// Cableado del módulo `cv` del worker (tarea 7.12). Con `NODE_ENV=test` los dos consumidores **no** se registran: un
// `Worker` de BullMQ abre conexión a Redis nada más crearse, y esta suite no tiene ninguno.

let moduleRef: TestingModule | undefined;

afterEach(async () => {
  await moduleRef?.close();
  moduleRef = undefined;
});

async function compile(): Promise<TestingModule> {
  const config = await workerTestConfig();
  return await Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot(config),
      // La conexión de Mongoose es perezosa: el módulo la necesita para su modelo, no para conectar.
      MongoPersistenceModule,
      CvModule.register(config, {
        module: StubSearchIndexModule,
      }),
    ],
  }).compile();
}

describe('CvModule wiring', () => {
  it('resolves every port with its adapter', async () => {
    moduleRef = await compile();

    expect(moduleRef.get(CV_REPOSITORY)).toBeInstanceOf(MongoCvRepository);
    expect(moduleRef.get(CV_FILE_READER)).toBeInstanceOf(S3CvFileReader);
    expect(moduleRef.get(CV_CLOCK)).toBeDefined();
    expect(moduleRef.get(getConnectionToken(), { strict: false })).toBeDefined();
  });

  it('brings one extractor per accepted format', async () => {
    moduleRef = await compile();

    const extractors = moduleRef.get<Record<string, unknown>>(
      CV_TEXT_EXTRACTORS,
    );

    expect(Object.keys(extractors).sort()).toEqual(['docx', 'pdf']);
  });

  it('resolves the two use cases', async () => {
    moduleRef = await compile();

    expect(moduleRef.get(ExtractCvUseCase)).toBeInstanceOf(ExtractCvUseCase);
    expect(moduleRef.get(DeleteCvFileUseCase)).toBeInstanceOf(
      DeleteCvFileUseCase,
    );
  });

  it('registers no consumer under NODE_ENV=test, so the suite opens no Redis', async () => {
    moduleRef = await compile();

    expect(() => moduleRef?.get(ExtractCvConsumer)).toThrow();
    expect(() => moduleRef?.get(DeleteCvFileConsumer)).toThrow();
  });
});

describe('the cv module and AI', () => {
  it('La extracción no usa inteligencia artificial: no file imports @linkvault/ai', () => {
    // Un `import` o un `require` de verdad; nombrarlo en un comentario para decir que **no** entra es lo contrario.
    const importsAi =
      /(?:^|\n)\s*(?:import|export)[^\n;]*from\s*['"]@linkvault\/ai['"]|require\(\s*['"]@linkvault\/ai['"]/;
    const offenders = filesUnder(import.meta.dirname).filter((file) =>
      importsAi.test(readFileSync(file, 'utf8')),
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
