import { describe, expect, it } from 'vitest';
import { evaluateListeners, type ListenerRow, parseSsListeners } from './listeners';

const RUNNER_PID = 100;
const OWN = 200;
const FOREIGN = 300;
/** El árbol lanzado **sin** el PID del runner (design D3). */
const ownPids = new Set([OWN, 201]);

const row = (address: string, pid: number | null): ListenerRow => ({ port: 3101, address, pid });

describe('evaluateListeners (design D3, tarea 2.6b)', () => {
  it.each<[string, ListenerRow[], RegExp]>([
    ['[propio, ajeno]', [row('0.0.0.0', OWN), row('127.0.0.1', FOREIGN)], /port 3101 \(127\.0\.0\.1\): PID 300 /],
    ['[ajeno, propio]', [row('127.0.0.1', FOREIGN), row('0.0.0.0', OWN)], /port 3101 \(127\.0\.0\.1\): PID 300 /],
    ['[propio, sin PID]', [row('0.0.0.0', OWN), row('::', null)], /port 3101 \(::\): a listener without PID/],
    ['[PID del runner]', [row('127.0.0.1', RUNNER_PID)], /port 3101 \(127\.0\.0\.1\): PID 100 /],
  ])('%s falla nombrando el puerto y el PID', (_case, rows, message) => {
    const verdict = evaluateListeners(rows, ownPids);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? [] : verdict.problems.join('\n')).toMatch(message);
  });

  it('[propio] en verde (control)', () => {
    expect(evaluateListeners([row('0.0.0.0', OWN)], ownPids)).toEqual({ ok: true });
  });

  it('un puerto sin ninguna fila de escucha no se da por bueno', () => {
    expect(evaluateListeners([], ownPids).ok).toBe(false);
  });
});

describe('parseSsListeners', () => {
  it('saca una fila por PID y una sin PID cuando ss no lo muestra', () => {
    const output = [
      'LISTEN 0 511 0.0.0.0:3101 0.0.0.0:* users:(("node",pid=4242,fd=21))',
      'LISTEN 0 511 [::]:3101 [::]:*',
      'LISTEN 0 511 127.0.0.1:9999 0.0.0.0:* users:(("x",pid=1,fd=3))',
    ].join('\n');
    expect(parseSsListeners(output, new Set([3101]))).toEqual([
      { port: 3101, address: '0.0.0.0', pid: 4242 },
      { port: 3101, address: '[::]', pid: null },
    ]);
  });
});
