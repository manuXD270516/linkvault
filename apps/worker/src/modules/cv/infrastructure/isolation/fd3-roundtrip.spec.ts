import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';

// Prueba de ida y vuelta del canal (N11, 1.3): el hijo escribe en el descriptor 3 con `net.Socket({ fd: 3 })` y espera
// al callback de cada `write`; el padre lee `stdio[3]`. Se corre en Windows y en Linux.

const directory = mkdtempSync(join(tmpdir(), 'cvx-fd3-'));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const CHILD = `
const net = require('node:net');
const socket = new net.Socket({ fd: 3, readable: false });
const write = (text) => new Promise((resolve, reject) => socket.write(text, (error) => (error ? reject(error) : resolve())));
(async () => {
  await write('short\\n');
  await write('x'.repeat(6 * 1024 * 1024) + '\\n');
  socket.end();
})().catch(() => process.exit(2));
`;

describe('fd3 round trip', () => {
  it('fd3 round trip works on this platform', async () => {
    const script = join(directory, 'fd3-child.cjs');
    writeFileSync(script, CHILD);
    const child = spawn(process.execPath, [script], {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
      env: {},
    });
    const chunks: Buffer[] = [];
    const channel = child.stdio[3] as Readable;
    channel.on('data', (chunk: Buffer) => chunks.push(chunk));
    await new Promise<void>((resolve) => child.once('close', () => resolve()));

    const lines = Buffer.concat(chunks).toString('utf8').split('\n');
    expect(lines[0]).toBe('short');
    expect(lines[1]?.length).toBe(6 * 1024 * 1024);
    expect(lines[2]).toBe('');
  });
});
