import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type DynamicModule, Module } from '@nestjs/common';
import { UnknownElementException } from '@nestjs/core/errors/exceptions/unknown-element.exception';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app/app.module';
import { EnrichmentModule } from '../../modules/enrichment/enrichment.module';
import { EnrichLinkConsumer } from '../../modules/enrichment/infrastructure/queue/enrich-link.consumer';
import {
  workerTestAiConfig,
  workerTestConfig,
} from '../../test-support/test-config';

// Este archivo sustituye a `no-enrich-link-consumer.spec.ts`, que comprobaba lo contrario. Durante `job-links` la cola
// `enrich-link` se llenaba a propósito sin nadie que la consumiera: un consumidor provisional habría descartado los
// jobs y todo lo guardado durante la vida de aquel change no se habría enriquecido nunca. `link-enrichment` es quien
// registra ese consumidor, así que lo que hay que comprobar ahora es que exista **y** que la suite siga sin abrir
// Redis, que es la otra mitad de lo que aquel test protegía.

const WORKER_SRC = resolve(import.meta.dirname, '../..');

let moduleRef: TestingModule | undefined;

afterEach(async () => {
  await moduleRef?.close();
  moduleRef = undefined;
});

/** Todos los `.ts` del worker con su ruta relativa, para poder nombrar dónde está lo que se busca. */
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
    .filter(({ path }) => !path.endsWith('.spec.ts'))
    .filter(({ content }) => pattern.test(content))
    .map(({ path }) => path);
}

/** Módulo vacío en el lugar del de IA: construir la definición no instancia nada. */
@Module({})
class NoAiModule {}

const noAi: DynamicModule = { module: NoAiModule };

/** Tokens de los providers de una definición de módulo, sin llegar a instanciarlos. */
function providerTokens(dynamic: DynamicModule): unknown[] {
  return (dynamic.providers ?? []).map((provider) =>
    typeof provider === 'object' && 'provide' in provider
      ? provider.provide
      : provider,
  );
}

describe('Consumidor de enrich-link', () => {
  it('exists, and in exactly one place', () => {
    // `new Worker(` es cómo se construye un consumidor de BullMQ a pelo, que es lo que los módulos hacen para poder
    // configurar `concurrency` y `lockDuration` desde la configuración. Desde `cv-upload-extract` hay dos sitios: el
    // de `enrichment` y la fábrica que comparten los dos consumidores de `cv`, y ninguno más.
    expect(sourcesMatching(/new Worker\(/).sort()).toEqual(
      [
        join(
          'modules',
          'enrichment',
          'infrastructure',
          'queue',
          'enrich-link.consumer.ts',
        ),
        join('modules', 'cv', 'infrastructure', 'queue', 'worker-factory.ts'),
      ].sort(),
    );
    expect(sourcesMatching(/ENRICH_LINK_QUEUE/)).toContain(
      join(
        'modules',
        'enrichment',
        'infrastructure',
        'queue',
        'enrich-link.consumer.ts',
      ),
    );
  });

  it('is registered when the process exists to consume', async () => {
    const dynamic = EnrichmentModule.register(
      await workerTestConfig({ NODE_ENV: 'production' }),
      noAi,
    );

    expect(providerTokens(dynamic)).toContain(EnrichLinkConsumer);
  });

  it('is not registered in the tests, so the suite opens no Redis', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.register(await workerTestConfig(), workerTestAiConfig()),
      ],
    }).compile();

    // `get` de Nest 11 no admite `{ optional: true }`: un token ausente lanza `UnknownElementException`.
    expect(() => moduleRef?.get(EnrichLinkConsumer, { strict: false })).toThrow(
      UnknownElementException,
    );
  });

  it('leaves the rest of the module wired, so the graph is still checked', async () => {
    const dynamic = EnrichmentModule.register(await workerTestConfig(), noAi);

    // Todo menos el consumidor: si el módulo entero desapareciera en tests, nada comprobaría que resuelve.
    expect(providerTokens(dynamic)).not.toContain(EnrichLinkConsumer);
    expect(providerTokens(dynamic).length).toBeGreaterThan(5);
  });

  it('is the worker who writes the preview state now', () => {
    // Lo contrario de lo que decía `no-enrich-link-consumer.spec.ts`: el `previewStatus` de un link lo cambia quien lo
    // enriquece, y a partir de este change ese es el worker.
    expect(sourcesMatching(/previewStatus/).length).toBeGreaterThan(0);
    expect(sourcesMatching(/ENRICH_LINK_QUEUE/)).not.toEqual([]);
  });
});
