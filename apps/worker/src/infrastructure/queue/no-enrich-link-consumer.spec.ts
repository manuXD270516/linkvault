import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ENRICH_LINK_QUEUE } from '@linkvault/shared';
import { getQueueToken } from '@nestjs/bullmq';
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app/app.module';
import {
  workerTestAiConfig,
  workerTestConfig,
} from '../../test-support/test-config';

// "Cola sin consumidor" (D7 de job-links, tarea 4.4): este change deja los jobs esperando en `enrich-link` a propósito.
// Un consumidor provisional que solo registrara un log consumiría el job y lo descartaría, así que todo lo guardado
// durante la vida de este change no se enriquecería nunca: justo la pérdida que el outbox existe para impedir. La
// comprobación es estructural porque no hay nada que ejecutar: lo que se verifica es que no exista.

const WORKER_SRC = resolve(import.meta.dirname, '../..');

let moduleRef: TestingModule | undefined;

afterEach(async () => {
  await moduleRef?.close();
  moduleRef = undefined;
});

/** Todos los `.ts` del worker con su ruta relativa, para poder nombrar al culpable si alguno registra un consumidor. */
function workerSources(): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        files.push({
          path: relative(WORKER_SRC, full),
          content: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(WORKER_SRC);
  return files;
}

function sourcesMatching(pattern: RegExp): string[] {
  return workerSources()
    .filter(({ path }) => path !== relative(WORKER_SRC, import.meta.filename))
    .filter(({ content }) => pattern.test(content))
    .map(({ path }) => path);
}

describe('Cola sin consumidor', () => {
  it('registers no consumer for the enrich-link queue', () => {
    // `@Processor` y `WorkerHost` son la forma en que `@nestjs/bullmq` declara un consumidor; `new Worker` es la de
    // BullMQ a pelo. Ninguna aparece en el worker hasta `link-enrichment`.
    expect(sourcesMatching(/@Processor\b|WorkerHost|new Worker\(/)).toEqual([]);
    expect(sourcesMatching(/registerQueue|ENRICH_LINK_QUEUE/)).toEqual([]);
  });

  it('does not even register the queue in its dependency injection graph', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register(await workerTestConfig(), workerTestAiConfig()),
      ],
    }).compile();

    // `get` de Nest 11 no admite `{ optional: true }`: un token ausente lanza `UnknownElementException`.
    expect(() =>
      moduleRef?.get(getQueueToken(ENRICH_LINK_QUEUE), { strict: false }),
    ).toThrow(UnknownElementException);
  });

  it('touches no preview state, so a published event leaves the link pending', () => {
    // El `previewStatus` solo lo cambia quien enriquezca el link, y aquí nadie lo hace: el worker no conoce ni la
    // colección de links ni su estado de preview.
    expect(sourcesMatching(/previewStatus|job_links/)).toEqual([]);
  });
});
