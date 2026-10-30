import { cvFileKey } from '@linkvault/shared';
import { Logger, type LoggerService } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Registry } from 'prom-client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkerApp } from '../../../../app/create-worker-app';
import { workerMetricsRegistry } from '../../../../infrastructure/metrics/worker-metrics-registry';
import {
  workerTestAiConfig,
  workerTestConfig,
} from '../../../../test-support/test-config';
import { ExtractCvUseCase } from '../../application/extract-cv.usecase';
import {
  InMemoryCvFileReader,
  InMemoryCvRepository,
  MovableClock,
} from '../../application/testing/cv-test-doubles';
import { PrometheusCvExtractionMetrics } from '../isolation/cv-extraction.metrics';
import { IsolatedCvTextExtractor } from '../isolation/isolated-cv-text-extractor';
import {
  ChildScripts,
  realChildRunner,
  runnerFor,
} from '../isolation/isolation-test-kit';
import { docxWithText, pdfWithText } from './fixtures/cv-fixtures';
import {
  bombDocx,
  docxWithNestedEntities,
  pdfWithDeepNesting,
  pdfWithEndlessText,
  pdfWithPageMarks,
} from './fixtures/pathological-fixtures';

// Archivos patológicos **generados en el test** (grupo 5 de cv-extract-isolation, D10), leídos por el hijo real con los
// flags de producción. Nada malicioso se commitea: cada archivo se construye al vuelo. El proyecto `worker-isolation`
// los corre en serie.

const CV_ID = '66e9a0000000000000000c01';
const USER_ID = '66e9a0000000000000000a01';

let repository: InMemoryCvRepository;
let files: InMemoryCvFileReader;
let registry: Registry;

beforeEach(() => {
  repository = new InMemoryCvRepository().withCv(CV_ID, {
    userId: USER_ID,
    fileType: 'pdf',
  });
  files = new InMemoryCvFileReader();
  registry = new Registry();
});

function useCaseOver(
  runner: ReturnType<typeof realChildRunner>['runner'],
): ExtractCvUseCase {
  return new ExtractCvUseCase(
    repository,
    files,
    {
      pdf: new IsolatedCvTextExtractor('pdf', runner),
      docx: new IsolatedCvTextExtractor('docx', runner),
    },
    new MovableClock(),
    { timeoutMs: 30_000 },
    { upsert: async () => undefined, delete: async () => undefined },
  );
}

async function readAs(
  fileType: 'pdf' | 'docx',
  bytes: Uint8Array,
): Promise<Awaited<ReturnType<ExtractCvUseCase['execute']>>> {
  repository.withCv(CV_ID, { userId: USER_ID, fileType });
  files.withObject(cvFileKey(USER_ID, CV_ID), bytes);
  const { runner } = realChildRunner({
    metrics: new PrometheusCvExtractionMetrics(registry),
  });
  return await useCaseOver(runner).execute({ cvId: CV_ID, userId: USER_ID });
}

async function counter(labels: string): Promise<number> {
  const body = await registry.metrics();
  const line = body
    .split('\n')
    .find((entry) =>
      entry.startsWith(`linkvault_cv_extractions_total{${labels}}`),
    );
  return line === undefined ? 0 : Number(line.split(' ').pop());
}

describe('pathological PDF', () => {
  it('a 200-page pdf yields pages 1 to 50 only', async () => {
    const { runner } = realChildRunner({
      metrics: new PrometheusCvExtractionMetrics(registry),
    });

    const outcome = await runner.run('pdf', pdfWithPageMarks(200));

    expect(outcome.kind).toBe('text');
    if (outcome.kind === 'text') {
      expect(outcome.text).toContain('PAGE-50');
      expect(outcome.text).not.toContain('PAGE-51');
      expect(outcome.pagesCapped).toBe(true);
    }
    expect(
      await counter('format="pdf",outcome="text",cause="pages_capped"'),
    ).toBe(1);

    // Y por el caso de uso, de punta a punta: la lectura no es un fallo.
    expect((await readAs('pdf', pdfWithPageMarks(200))).kind).toBe('extracted');
  }, 30_000);

  it('an endless-text pdf is capped and extracted before the deadline', async () => {
    const started = Date.now();

    const result = await readAs('pdf', pdfWithEndlessText());

    expect(result).toEqual({ kind: 'extracted', chars: 200_000 });
    expect(repository.texts.get(CV_ID)?.truncated).toBe(true);
    expect(Date.now() - started).toBeLessThan(25_000);
    expect(
      await counter('format="pdf",outcome="text",cause="raw_text_capped"'),
    ).toBe(1);
  }, 40_000);

  it('deep nesting ends before the deadline and the process survives', async () => {
    const { runner } = realChildRunner({ contentTimeoutMs: 20_000 });

    const started = Date.now();
    const outcome = await runner.run('pdf', pdfWithDeepNesting());

    expect(['unreadable', 'text']).toContain(outcome.kind);
    expect(Date.now() - started).toBeLessThan(20_000);
    // El proceso del worker sigue: otra lectura posterior devuelve texto.
    const next = await runner.run('pdf', pdfWithText());
    expect(next.kind).toBe('text');
  }, 40_000);
});

describe('pathological DOCX', () => {
  it('a zip bomb docx is unreadable by input budget', async () => {
    const { runner } = realChildRunner({
      metrics: new PrometheusCvExtractionMetrics(registry),
    });
    const bomb = await bombDocx(100);
    expect(bomb.byteLength).toBeLessThan(5 * 1024 * 1024);

    const outcome = await runner.run('docx', bomb);

    expect(outcome).toEqual({ kind: 'unreadable', cause: 'input_budget' });
    expect(
      await counter('format="docx",outcome="unreadable",cause="input_budget"'),
    ).toBe(1);
    expect(
      await counter(
        'format="docx",outcome="unreadable",cause="memory_ceiling"',
      ),
    ).toBe(0);
  }, 30_000);

  it('the worker rss grows less than 128 MiB during a zip bomb', async () => {
    const bomb = await bombDocx(100);
    const { runner } = realChildRunner();
    global.gc?.();
    const before = process.memoryUsage().rss;

    await runner.run('docx', bomb);

    global.gc?.();
    expect(process.memoryUsage().rss - before).toBeLessThan(128 * 1024 * 1024);
  }, 30_000);

  it('a lying-header docx is unreadable end to end', async () => {
    // El directorio central declara 1 KiB para una entrada que infla a 80 MiB.
    const result = await readAs('docx', await bombDocx(80, 1024));

    expect(result).toEqual({ kind: 'failed', reason: 'unreadable_file' });
    expect(repository.failures.get(CV_ID)).toBe('unreadable_file');
  }, 30_000);

  it('entity expansion ends before the deadline without the expanded text', async () => {
    const { runner } = realChildRunner({ contentTimeoutMs: 20_000 });

    const started = Date.now();
    const outcome = await runner.run('docx', docxWithNestedEntities());

    expect(Date.now() - started).toBeLessThan(20_000);
    if (outcome.kind === 'text') {
      expect(outcome.text.split('ha').length - 1).toBeLessThanOrEqual(10);
    } else {
      expect(outcome.kind).toBe('unreadable');
    }
    // El proceso del worker sigue.
    expect((await runner.run('docx', docxWithText())).kind).toBe('text');
  }, 40_000);
});

describe('the worker keeps answering', () => {
  let app: NestFastifyApplication | undefined;
  const scripts = new ChildScripts();

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  afterAll(() => {
    scripts.dispose();
  });

  it('health/live answers while a child spins', async () => {
    const config = await workerTestConfig();
    app = await createWorkerApp(config, workerTestAiConfig());
    await app.listen(config.WORKER_HEALTH_PORT, '127.0.0.1');
    const script = scripts.write(`
      await ready();
      await readAll();
      spin(3000);
      await text('done');
      hold();
    `);
    const { runner } = runnerFor(scripts, script, { contentTimeoutMs: 10_000 });

    const reading = runner.run('pdf', new Uint8Array([1]));
    await new Promise((resolve) => setTimeout(resolve, 800));
    const startedAt = Date.now();
    const response = await fetch(
      `http://127.0.0.1:${config.WORKER_HEALTH_PORT}/health/live`,
    );
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(1_000);
    expect((await reading).kind).toBe('text');
  }, 30_000);
});

/** Captura todo lo que pasa por el `Logger` de Nest (el mismo por el que sale el de pino en la aplicación). */
class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  log(message: unknown): void {
    this.lines.push(String(message));
  }
  error(message: unknown): void {
    this.lines.push(String(message));
  }
  warn(message: unknown): void {
    this.lines.push(String(message));
  }
  debug(message: unknown): void {
    this.lines.push(String(message));
  }
  verbose(message: unknown): void {
    this.lines.push(String(message));
  }
}

describe('logs and metrics without the cv', () => {
  const captured = new CapturingLogger();

  beforeEach(() => {
    captured.lines.length = 0;
    Logger.overrideLogger(captured);
  });
  afterEach(() => {
    Logger.overrideLogger(['error', 'warn']);
  });

  function canaryPdf(text: string): Uint8Array {
    return pdfWithText([
      text,
      'Nadia Quispe Almaraz - Ingeniera de software y otras cosas',
    ]);
  }

  it('no log line carries cv text, file name or parser messages', async () => {
    // Subida simulada: nombre `CANARY_FILE.pdf` (que nunca entra al worker), un PDF y un DOCX con el texto marcado y un
    // PDF corrupto cuyo contenido lleva la marca del mensaje del parser.
    const corrupt = new TextEncoder().encode(
      `%PDF-1.4\nCANARY-PARSER-MSG ${'x'.repeat(400)}`,
    );
    const { runner } = realChildRunner({
      logger: undefined,
      metrics: new PrometheusCvExtractionMetrics(workerMetricsRegistry),
    });
    const useCase = useCaseOver(runner);

    for (const [fileType, bytes] of [
      ['pdf', canaryPdf('CANARY-CV-TEXT')],
      [
        'docx',
        docxWithText([
          'CANARY-CV-TEXT Nadia Quispe Almaraz',
          'Experiencia: node y typescript y mucho mas texto de relleno.',
          'Herramientas: mongodb redis docker colas.',
        ]),
      ],
      ['pdf', corrupt],
    ] as const) {
      repository.withCv(CV_ID, { userId: USER_ID, fileType });
      files.withObject(cvFileKey(USER_ID, CV_ID), bytes);
      await useCase.execute({ cvId: CV_ID, userId: USER_ID });
    }

    const all = captured.lines.join('\n');
    expect(all).not.toContain('CANARY');
    // Y las métricas: ni el texto ni el nombre del archivo.
    const metrics = await workerMetricsRegistry.metrics();
    expect(metrics).not.toContain('CANARY-CV-TEXT');
    expect(metrics).not.toContain('CANARY_FILE');
    expect(metrics).toContain('linkvault_cv_extractions_total');
  }, 40_000);

  it('the use case line names the cv id and unreadable_file', async () => {
    repository.withCv(CV_ID, { userId: USER_ID, fileType: 'pdf' });
    files.withObject(
      cvFileKey(USER_ID, CV_ID),
      new TextEncoder().encode(
        `%PDF-1.4\nCANARY-PARSER-MSG ${'y'.repeat(400)}`,
      ),
    );
    const { runner } = realChildRunner({ logger: undefined });

    await useCaseOver(runner).execute({ cvId: CV_ID, userId: USER_ID });

    const line = captured.lines.find((entry) => entry.includes(CV_ID));
    expect(line).toBeDefined();
    expect(line).toContain('unreadable_file');
    expect(captured.lines.join('\n')).not.toContain('CANARY');
  }, 30_000);
});
