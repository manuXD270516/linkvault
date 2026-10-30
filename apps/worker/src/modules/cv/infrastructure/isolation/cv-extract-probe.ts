import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { Readable } from 'node:stream';
import {
  docxWithTextDeflated,
  FIXTURE_CV_LINES,
  pdfWithText,
} from '../extractors/fixtures/cv-fixtures';
import { buildChildCommand } from './child-command';
import { IsolatedCvTextExtractor } from './isolated-cv-text-extractor';
import { IsolatedExtractionRunner } from './isolated-extraction.runner';

// Sonda de la imagen (D11 de cv-extract-isolation): genera en memoria un PDF y un DOCX de texto inventado, los lee con el
// **adaptador aislado real** (proceso hijo con los flags de producción) y sale 0 solo si los dos devuelven el texto
// esperado. Imprime recuentos, **nunca texto**. Después (N8) arranca `bootSamples` hijos hasta `ready`, los mata e imprime
// `boot_p50_ms` y `boot_p95_ms` sin fallar por su valor: el criterio (p95 ≤ 1.500 ms en arm64) se lee en la corrida del
// runner arm64 y en staging.
//
// Códigos de salida: 0 todo como se exige; 1 la lectura falló o el texto no es el esperado.

export interface CvExtractProbeIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CvExtractProbeOptions {
  readonly scriptPath: string;
  readonly allowRead: readonly string[];
  readonly io: CvExtractProbeIo;
  readonly bootSamples?: number;
}

const EXPECTED = FIXTURE_CV_LINES[0] ?? '';

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * fraction) - 1,
  );
  return sorted[Math.max(index, 0)] ?? 0;
}

/** Cuánto tarda un hijo en publicar `ready`, en ms. Lo mata al terminar. */
function measureBoot(options: CvExtractProbeOptions): Promise<number> {
  const command = buildChildCommand({
    script: options.scriptPath,
    allowRead: options.allowRead,
    format: 'pdf',
  });
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(command.command, command.args, command.options);
    const channel = child.stdio[3] as Readable | null;
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGKILL');
      if (error === undefined) {
        resolve(performance.now() - startedAt);
      } else {
        reject(error);
      }
    };
    let received = '';
    channel?.on('data', (chunk: Buffer) => {
      received += chunk.toString('utf8');
      if (received.includes('"ready"')) {
        finish();
      }
    });
    child.once('error', () => finish(new Error('spawn')));
    child.once('exit', () => finish(new Error('exit before ready')));
  });
}

export async function runCvExtractProbe(
  options: CvExtractProbeOptions,
): Promise<number> {
  const { io } = options;
  const runner = new IsolatedExtractionRunner({
    scriptPath: options.scriptPath,
    allowRead: options.allowRead,
    contentTimeoutMs: 30_000,
    // Sin texto del CV en ningún registro: el runner solo escribe formato, causa, duración y tamaño.
    logger: {
      warn: (message) => io.err(`[cv-extract-probe] ${message}\n`),
      error: (message) => io.err(`[cv-extract-probe] ${message}\n`),
    },
    metrics: { record: () => undefined },
  });
  const pdf = new IsolatedCvTextExtractor('pdf', runner);
  const docx = new IsolatedCvTextExtractor('docx', runner);

  const counts: { pdf: number; docx: number } = { pdf: 0, docx: 0 };
  try {
    for (const [format, extractor, bytes] of [
      ['pdf', pdf, pdfWithText()],
      ['docx', docx, docxWithTextDeflated()],
    ] as const) {
      const attempt = await extractor.extract(bytes);
      if (attempt.kind !== 'text' || !attempt.text.includes(EXPECTED)) {
        io.err(`[cv-extract-probe] ${format} was not read as expected\n`);
        return 1;
      }
      counts[format] = attempt.text.length;
    }
  } catch {
    // Solo el hecho: el mensaje de un error puede arrastrar datos del hijo.
    io.err(
      '[cv-extract-probe] failed: the cv-extract-child process could not read the probe documents\n',
    );
    return 1;
  }
  io.out(`pdf chars=${counts.pdf} docx chars=${counts.docx}\n`);

  const samples: number[] = [];
  try {
    for (let i = 0; i < (options.bootSamples ?? 20); i += 1) {
      samples.push(await measureBoot(options));
    }
  } catch {
    io.err(
      '[cv-extract-probe] failed: the cv-extract-child process did not boot\n',
    );
    return 1;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  io.out(
    `boot_p50_ms=${Math.round(percentile(sorted, 0.5))} boot_p95_ms=${Math.round(percentile(sorted, 0.95))}\n`,
  );
  return 0;
}
