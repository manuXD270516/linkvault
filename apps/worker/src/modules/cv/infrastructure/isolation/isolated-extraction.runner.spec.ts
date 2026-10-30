import { Test } from '@nestjs/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CvExtractionMachineryError } from './cv-extraction-machinery.error';
import { ChildScripts, isAlive, runnerFor } from './isolation-test-kit';
import {
  killLiveChildren,
  type RunnerOutcome,
} from './isolated-extraction.runner';

// El núcleo de la lectura aislada contra hijos de prueba que escribe el test (D10): bucle síncrono acotado, heap
// creciente, salidas con código, basura en el descriptor 3, etc. Todos los bucles de los hijos son acotados (N6).

const scripts = new ChildScripts();
afterAll(() => {
  scripts.dispose();
});

const BYTES = new Uint8Array([1, 2, 3]);

function textOf(outcome: RunnerOutcome): string {
  expect(outcome.kind).toBe('text');
  return outcome.kind === 'text' ? outcome.text : '';
}

async function machineryOf(
  promise: Promise<unknown>,
): Promise<CvExtractionMachineryError> {
  const error: unknown = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(CvExtractionMachineryError);
  return error as CvExtractionMachineryError;
}

describe('IsolatedExtractionRunner core', () => {
  it('returns the text a well-behaved child posts', async () => {
    const script = scripts.write(`
      await ready();
      const bytes = await readAll();
      await text('got ' + bytes.length + ' bytes');
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    expect(textOf(await runner.run('pdf', BYTES))).toBe('got 3 bytes');
  });

  it('kills a child that never yields when the deadline passes', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      spin(10000);
    `);
    const { runner, metrics } = runnerFor(scripts, script, {
      contentTimeoutMs: 500,
    });

    const started = Date.now();
    const outcome = await runner.run('pdf', BYTES);

    expect(outcome).toEqual({ kind: 'unreadable', cause: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1_500 + 1_000);
    expect(metrics.records[0]?.combination).toEqual({
      outcome: 'unreadable',
      cause: 'timeout',
    });
  });

  it('always reaps the child, also on success', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      await text(String(process.pid));
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    const pid = Number(textOf(await runner.run('docx', BYTES)));

    expect(pid).toBeGreaterThan(0);
    expect(isAlive(pid)).toBe(false);
  });

  it('one process per cv', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      await text(String(process.pid));
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    const first = Number(textOf(await runner.run('pdf', BYTES)));
    const second = Number(textOf(await runner.run('pdf', BYTES)));

    expect(first).not.toBe(second);
    expect(isAlive(first)).toBe(false);
    expect(isAlive(second)).toBe(false);
  });

  it('the content deadline starts at ready', async () => {
    const script = scripts.write(`
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await ready();
      await readAll();
      await new Promise((resolve) => setTimeout(resolve, 400));
      await text('late but in time');
      hold();
    `);
    const { runner } = runnerFor(scripts, script, { contentTimeoutMs: 500 });

    expect(textOf(await runner.run('pdf', BYTES))).toBe('late but in time');
  });

  it('afterEach reaps leftover children', async () => {
    const script = scripts.write(`
      await ready();
      spin(8000);
    `);
    const { runner } = runnerFor(scripts, script, { contentTimeoutMs: 20_000 });
    const pending = runner.run('pdf', BYTES);
    await new Promise((resolve) => setTimeout(resolve, 600));

    const killed = killLiveChildren();
    const outcome = await pending;

    expect(killed).toBe(1);
    expect(outcome.kind).toBe('unreadable');
    expect(killLiveChildren()).toBe(0);
  });
});

describe('before ready (machinery)', () => {
  it('a missing child script throws a machinery error', async () => {
    const { runner } = runnerFor(
      scripts,
      `${scripts.directory}/does-not-exist.cjs`,
    );

    const error = await machineryOf(runner.run('pdf', BYTES));

    expect(error.machineryCause).toBe('boot_error');
  });

  it('a child that never says ready throws a machinery error', async () => {
    const script = scripts.write(`
      await new Promise((resolve) => setTimeout(resolve, 5000));
    `);
    const { runner, metrics } = runnerFor(scripts, script, {
      bootTimeoutMs: 300,
    });

    const error = await machineryOf(runner.run('pdf', BYTES));

    expect(error.machineryCause).toBe('boot_timeout');
    expect(metrics.records[0]?.combination).toEqual({
      outcome: 'machinery_error',
      cause: 'boot_timeout',
    });
  });

  it('boot_error throws a machinery error with the code only', async () => {
    const script = scripts.write(`
      await send({ type: 'boot_error', code: 'ERR_MODULE_NOT_FOUND' });
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    const error = await machineryOf(runner.run('pdf', BYTES));

    expect(error.machineryCause).toBe('boot_error');
    expect(error.code).toBe('ERR_MODULE_NOT_FOUND');
    expect(error.message).toBe('cv extraction machinery failure: boot_error');
  });

  it('an invalid frame before ready is a machinery error', async () => {
    const script = scripts.write(`
      await raw('not json' + NL);
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    const error = await machineryOf(runner.run('pdf', BYTES));

    expect(error.machineryCause).toBe('protocol');
  });

  it('listeners settle the read only once, also when the exit follows a result', async () => {
    // El hijo publica su resultado y sale de inmediato: llegan el resultado, el cierre del canal, el `exit` y el
    // `close` del proceso. Solo el primero resuelve; los demás se ignoran.
    const script = scripts.write(`
      await ready();
      await readAll();
      await text('result then exit');
      process.exit(0);
    `);
    const { runner, metrics, logs } = runnerFor(scripts, script);

    const outcome = await runner.run('pdf', BYTES);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(outcome.kind).toBe('text');
    expect(metrics.records).toHaveLength(1);
    expect(
      logs.warnings.filter((line) => /unreadable/.test(line)),
    ).toHaveLength(0);
  });

  it('listeners settle the read only once', async () => {
    // Cierra `stdin` y sale a la vez: `error` de `stdin`, cierre del canal y `exit` llegan juntos.
    const script = scripts.write(`
      await ready();
      process.exit(3);
    `);
    const { runner, metrics, logs } = runnerFor(scripts, script);

    const outcome = await runner.run('pdf', new Uint8Array(4 * 1024 * 1024));

    expect(outcome.kind).toBe('unreadable');
    expect(metrics.records).toHaveLength(1);
    expect(
      logs.warnings.filter((line) => /unreadable/.test(line)),
    ).toHaveLength(1);
  });
});

describe('after ready (content)', () => {
  it('heap exhaustion is unreadable and the process survives', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      const keep = [];
      const end = Date.now() + 10000;
      while (Date.now() < end) { keep.push(new Array(100000).fill(1)); }
    `);
    const { runner } = runnerFor(scripts, script, {
      maxOldSpaceMb: 32,
      contentTimeoutMs: 30_000,
    });

    const outcome = await runner.run('pdf', BYTES);

    expect(outcome).toEqual({ kind: 'unreadable', cause: 'heap_limit' });

    const next = scripts.write(`
      await ready();
      await readAll();
      await text('still alive');
      hold();
    `);
    expect(
      textOf(await runnerFor(scripts, next).runner.run('pdf', BYTES)),
    ).toBe('still alive');
  });

  it('a child exiting with code 3 after ready is unreadable', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      process.exit(3);
    `);
    const { runner } = runnerFor(scripts, script);

    expect(await runner.run('pdf', BYTES)).toEqual({
      kind: 'unreadable',
      cause: 'child_exit',
    });
  });

  it('a clean exit after ready without a result is unreadable', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      process.exit(0);
    `);
    const { runner } = runnerFor(scripts, script);

    expect(await runner.run('pdf', BYTES)).toEqual({
      kind: 'unreadable',
      cause: 'child_exit',
    });
  });

  it('an invalid frame after ready is unreadable', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      await raw('{"type":"nonsense"}' + NL);
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    expect(await runner.run('pdf', BYTES)).toEqual({
      kind: 'unreadable',
      cause: 'protocol',
    });
  });

  it('boot_error or ready after ready is unreadable protocol', async () => {
    const secondReady = scripts.write(`
      await ready();
      await readAll();
      await ready();
      hold();
    `);
    const lateBootError = scripts.write(`
      await ready();
      await readAll();
      await send({ type: 'boot_error', code: 'ERR_LATE' });
      hold();
    `);

    for (const script of [secondReady, lateBootError]) {
      const { runner } = runnerFor(scripts, script);
      expect(await runner.run('pdf', BYTES)).toEqual({
        kind: 'unreadable',
        cause: 'protocol',
      });
    }
  });

  it('garbage on the channel does not crash the worker', async () => {
    const uncaught = vi.fn();
    process.on('uncaughtException', uncaught);
    try {
      const script = scripts.write(`
        await raw('not json' + NL);
        await ready();
        await readAll();
        await raw('also not json' + NL);
        hold();
      `);
      const { runner } = runnerFor(scripts, script);
      await runner.run('pdf', BYTES).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.off('uncaughtException', uncaught);
    }

    expect(uncaught).not.toHaveBeenCalled();
  });
});

describe('the channel frame', () => {
  it('a frame over 8 MiB is protocol', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      await raw('x'.repeat(9 * 1024 * 1024));
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    expect(await runner.run('pdf', BYTES)).toEqual({
      kind: 'unreadable',
      cause: 'protocol',
    });
  });

  it('the frame limit counts bytes, not characters', async () => {
    // 5 M de caracteres de 2 bytes en UTF-8 son 10 MB: pasan el tope de 8 MiB en bytes, no en caracteres.
    const script = scripts.write(`
      await ready();
      await readAll();
      await raw('ñ'.repeat(5 * 1000 * 1000));
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    expect(await runner.run('pdf', BYTES)).toEqual({
      kind: 'unreadable',
      cause: 'protocol',
    });
  });

  it('a 1M-char worst-case escaped result arrives intact', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      const unit = String.fromCharCode(1) + String.fromCharCode(0xd800);
      await text(unit.repeat(500000));
      hold();
    `);
    const { runner } = runnerFor(scripts, script, { contentTimeoutMs: 20_000 });

    const outcome = await runner.run('pdf', BYTES);

    const unit = String.fromCharCode(1) + String.fromCharCode(0xd800);
    expect(textOf(outcome)).toBe(unit.repeat(500_000));
  });

  it('a multibyte character split across chunks is decoded once', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      const frame = Buffer.from(JSON.stringify({ type: 'text', text: 'ñ😀 ok', pagesCapped: false, rawCapped: false }) + NL);
      const cut = frame.indexOf(0xc3) + 1;
      await raw(frame.subarray(0, cut));
      await new Promise((resolve) => setTimeout(resolve, 100));
      await raw(frame.subarray(cut));
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    expect(textOf(await runner.run('pdf', BYTES))).toBe('ñ😀 ok');
  });

  it('the child is killed after its result, not before', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      await text(String(process.pid));
      await new Promise((resolve) => setTimeout(resolve, 10000));
    `);
    const { runner } = runnerFor(scripts, script);

    const started = Date.now();
    const pid = Number(textOf(await runner.run('pdf', BYTES)));

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(isAlive(pid)).toBe(false);
  });
});

describe('machinery error and the child text', () => {
  it('a child cannot put text into the machinery error', async () => {
    const withCode = scripts.write(`
      await send({ type: 'boot_error', code: 'CANARY-CHILD-MSG' });
      hold();
    `);
    const withField = scripts.write(`
      await send({ type: 'boot_error', code: 'ERR_X', message: 'CANARY-CHILD-MSG' });
      hold();
    `);

    for (const script of [withCode, withField]) {
      const { runner, logs } = runnerFor(scripts, script);
      const error = await machineryOf(runner.run('pdf', BYTES));

      expect(error.message).not.toContain('CANARY');
      expect(JSON.stringify(error)).not.toContain('CANARY');
      expect(logs.all()).not.toContain('CANARY');
    }
  });

  it('nothing the child writes reaches the logs', async () => {
    const script = scripts.write(`
      process.stdout.write('CANARY-CHILD-OUTPUT');
      process.stderr.write('CANARY-CHILD-OUTPUT');
      await ready();
      await readAll();
      process.stdout.write('CANARY-CHILD-OUTPUT');
      process.exit(3);
    `);
    const { runner, logs } = runnerFor(scripts, script);

    await runner.run('pdf', BYTES);

    expect(logs.all()).not.toContain('CANARY-CHILD-OUTPUT');
    const lines = logs.warnings.filter((line) => /unreadable/.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/cause=child_exit/);
  });
});

describe('the child has no secrets and no voice', () => {
  it('the child sees none of the worker variables', async () => {
    process.env['S3_SECRET_KEY'] = 'worker-secret';
    process.env['AI_VAULT_KEY'] = 'worker-vault';
    try {
      const script = scripts.write(`
        await ready();
        await readAll();
        await text(JSON.stringify(Object.keys(process.env)));
        hold();
      `);
      const { runner } = runnerFor(scripts, script);

      const keys = JSON.parse(
        textOf(await runner.run('pdf', BYTES)),
      ) as string[];

      expect(keys).not.toContain('S3_SECRET_KEY');
      expect(keys).not.toContain('AI_VAULT_KEY');
      if (process.platform === 'linux') {
        expect(keys).toEqual([]);
      }
    } finally {
      delete process.env['S3_SECRET_KEY'];
      delete process.env['AI_VAULT_KEY'];
    }
  });

  it('the child cannot read outside its allowed paths', async () => {
    const outside = scripts.write('hold();');
    const secret = `${scripts.directory}/../cvx-outside-${process.pid}.txt`;
    const { writeFileSync, rmSync } = await import('node:fs');
    writeFileSync(secret, 'outside');
    try {
      const script = scripts.write(`
        await ready();
        await readAll();
        let code = 'READ_OK';
        try { require('node:fs').readFileSync(${JSON.stringify(secret)}, 'utf8'); } catch (e) { code = e.code; }
        await text(code);
        hold();
      `);
      const { runner } = runnerFor(scripts, script);

      expect(textOf(await runner.run('pdf', BYTES))).toBe('ERR_ACCESS_DENIED');
      expect(outside).toBeTruthy();
    } finally {
      rmSync(secret, { force: true });
    }
  });

  it('the child cannot spawn processes or threads', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      const results = [];
      try { require('node:child_process').spawnSync(process.execPath, ['-p', '1']); results.push('SPAWN_OK'); } catch (e) { results.push(e.code); }
      try { new (require('node:worker_threads').Worker)('1', { eval: true }); results.push('WORKER_OK'); } catch (e) { results.push(e.code); }
      await text(results.join(','));
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    expect(textOf(await runner.run('pdf', BYTES))).toBe(
      'ERR_ACCESS_DENIED,ERR_ACCESS_DENIED',
    );
  });

  it('the child cannot write files, evaluate strings or load native code', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      const results = [];
      try { require('node:fs').writeFileSync(${JSON.stringify(`${scripts.directory}/written.txt`)}, 'x'); results.push('WRITE_OK'); } catch (e) { results.push(e.code); }
      try { eval('1'); results.push('EVAL_OK'); } catch (e) { results.push(e.name); }
      try { new Function('return 1'); results.push('FUNCTION_OK'); } catch (e) { results.push(e.name); }
      await text(results.join(','));
      hold();
    `);
    const { runner } = runnerFor(scripts, script);

    expect(textOf(await runner.run('pdf', BYTES))).toBe(
      'ERR_ACCESS_DENIED,EvalError,EvalError',
    );
  });
});

describe.runIf(process.platform === 'linux')(
  'linux only: environ and memory',
  () => {
    it('the child cannot read the parent environ', async () => {
      const script = scripts.write(`
      await ready();
      await readAll();
      let code = 'READ_OK';
      try { require('node:fs').readFileSync('/proc/' + process.ppid + '/environ'); } catch (e) { code = e.code; }
      await text(code);
      hold();
    `);
      const { runner } = runnerFor(scripts, script);

      expect(textOf(await runner.run('pdf', BYTES))).toBe('ERR_ACCESS_DENIED');
    });

    it('the memory watchdog kills a child that allocates off-heap buffers', async () => {
      const script = scripts.write(`
      await ready();
      await readAll();
      const keep = [];
      const end = Date.now() + 10000;
      while (Date.now() < end) { keep.push(Buffer.alloc(32 * 1024 * 1024, 1)); await new Promise((r) => setTimeout(r, 5)); }
    `);
      const { runner } = runnerFor(scripts, script, {
        memoryCeilingBytes: 128 * 1024 * 1024,
        contentTimeoutMs: 20_000,
      });

      expect(await runner.run('pdf', BYTES)).toEqual({
        kind: 'unreadable',
        cause: 'memory_ceiling',
      });
    });

    it('a huge allocation kills only the child', async () => {
      const script = scripts.write(`
      await ready();
      await readAll();
      const keep = [];
      const end = Date.now() + 10000;
      while (Date.now() < end) { keep.push(Buffer.alloc(256 * 1024 * 1024, 1)); }
    `);
      const { runner } = runnerFor(scripts, script, {
        contentTimeoutMs: 20_000,
        memoryCeilingBytes: 512 * 1024 * 1024,
      });
      global.gc?.();
      const before = process.memoryUsage().rss;

      const outcome = await runner.run('pdf', BYTES);

      global.gc?.();
      expect(outcome.kind).toBe('unreadable');
      expect(process.memoryUsage().rss - before).toBeLessThan(64 * 1024 * 1024);
    });

    it('the watchdog interval is cleared after every extraction', async () => {
      const script = scripts.write(`
      await ready();
      await readAll();
      await text('ok');
      hold();
    `);
      const { runner } = runnerFor(scripts, script);

      await runner.run('pdf', BYTES);
      await runner.run('docx', BYTES);

      expect(runner.watchdogCount).toBe(0);
    });
  },
);

describe('without /proc', () => {
  it('without /proc the watchdog is disabled with one warning', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      await text('ok');
      hold();
    `);
    const { runner, logs } = runnerFor(scripts, script, {
      readResidentBytes: () => {
        throw new Error('no /proc here');
      },
    });

    await runner.run('pdf', BYTES);
    await runner.run('pdf', BYTES);

    expect(
      logs.warnings.filter((line) => /watchdog disabled/.test(line)),
    ).toHaveLength(1);
    expect(runner.watchdogCount).toBe(0);
  });
});

describe('shutdown', () => {
  it('shutdown kills live children', async () => {
    const script = scripts.write(`
      await ready();
      spin(8000);
    `);
    const { runner } = runnerFor(scripts, script, { contentTimeoutMs: 20_000 });
    const pending = runner.run('pdf', BYTES);
    await new Promise((resolve) => setTimeout(resolve, 600));

    // El cierre ordenado de la aplicación: Nest llama a `onApplicationShutdown` de los proveedores.
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: 'RUNNER', useValue: runner }],
    }).compile();
    await moduleRef.init();
    await moduleRef.close();
    const outcome = await pending;

    expect(outcome.kind).toBe('unreadable');
    expect(killLiveChildren()).toBe(0);
  });
});
