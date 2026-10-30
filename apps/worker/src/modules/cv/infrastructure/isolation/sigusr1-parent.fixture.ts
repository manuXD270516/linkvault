import { connect } from 'node:net';
import { dirname } from 'node:path';
import inspector from 'node:inspector';
import { IsolatedExtractionRunner } from './isolated-extraction.runner';

// Padre de prueba de `sigusr1.spec.ts` (1.9 de cv-extract-isolation, N1). Lo lanza el test con `node [--disable-sigusr1]
// --import tsx`, así que es un proceso Node de verdad, con el runner real, que arranca un hijo de prueba que le manda
// `SIGUSR1`. Pasado medio segundo publica por `stdout` si su inspector quedó abierto.
//
// Argumento: la ruta del script del hijo de prueba. Los bytes que le da al hijo no importan.

const script = process.argv[2];
if (script === undefined) {
  process.stderr.write('usage: sigusr1-parent <child script>\n');
  process.exit(2);
}

const runner = new IsolatedExtractionRunner({
  scriptPath: script,
  allowRead: [dirname(script)],
  contentTimeoutMs: 5_000,
  bootTimeoutMs: 5_000,
  logger: { warn: () => undefined, error: () => undefined },
  metrics: { record: () => undefined },
});

function tryConnect(port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve('CONNECTED');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code ?? 'ERROR');
    });
  });
}

async function main(): Promise<void> {
  await runner.run('pdf', new Uint8Array([1]));
  await new Promise((resolve) => setTimeout(resolve, 500));
  const report = {
    alive: true,
    url: inspector.url() ?? null,
    debugPort: process.debugPort,
    connect: await tryConnect(process.debugPort),
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(0);
}

void main();
