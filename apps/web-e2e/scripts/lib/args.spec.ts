import { describe, expect, it } from 'vitest';
import { parseRunnerArgs, playwrightGrepArgs } from './args';

describe('parseRunnerArgs (design D3: las anulaciones son flags)', () => {
  it('separa las flags del runner de los argumentos de Playwright', () => {
    const args = parseRunnerArgs([
      '--api-port=3200',
      '--mongo-port',
      '27200',
      '--keep-stack',
      '--stack-fault=listen-after-preflight:127.0.0.1:3101',
      '--grep',
      'x',
      'critical-path.spec.ts',
      '--project=chromium',
      '--repeat-each=5',
    ]);
    expect(args.portOverrides).toEqual({ api: 3200, mongo: 27200 });
    expect(args.keepStack).toBe(true);
    expect(args.stackFault).toEqual({ kind: 'listen-after-preflight', host: '127.0.0.1', port: 3101 });
    expect(args.playwrightArgs).toEqual(['--grep', 'x', 'critical-path.spec.ts', '--project=chromium', '--repeat-each=5']);
  });

  it('rechaza un --stack-fault desconocido', () => {
    expect(() => parseRunnerArgs(['--stack-fault=nope'])).toThrow(/--stack-fault/);
  });
});

describe('playwrightGrepArgs (design D1: el runner ejecuta @lot1)', () => {
  it('sin --grep del llamador, filtra por el lote', () => {
    expect(playwrightGrepArgs(['--project=chromium'], ['@lot1'])).toEqual(['--grep', '@lot1', '--project=chromium']);
  });

  it('con --grep del llamador, exige las dos condiciones', () => {
    const [, grep] = playwrightGrepArgs(['--grep=camino'], ['@lot1']);
    const pattern = new RegExp(grep ?? '');
    expect(pattern.test('camino crítico @lot1')).toBe(true);
    expect(pattern.test('camino crítico')).toBe(false);
    expect(pattern.test('otra prueba @lot1')).toBe(false);
  });

  it('en remote exige @lot1 y @remote-safe a la vez (design D9)', () => {
    const [, grep] = playwrightGrepArgs(['--list'], ['@lot1', '@remote-safe']);
    const pattern = new RegExp(grep ?? '');
    expect(pattern.test('camino crítico @lot1 @critical-path @remote-safe')).toBe(true);
    expect(pattern.test('otra prueba @lot1')).toBe(false);
    expect(pattern.test('otra prueba @remote-safe')).toBe(false);
  });
});

describe('parseRunnerArgs: target y expectativa', () => {
  it('--e2e-remote marca el target e2e-remote; sin --match-expectation queda sin declarar', () => {
    const args = parseRunnerArgs(['--e2e-remote', '--base-url', 'https://a.example']);
    expect(args.remoteTarget).toBe(true);
    expect(args.baseUrl).toBe('https://a.example');
    expect(args.matchExpectation).toBeUndefined();
    expect(args.playwrightArgs).toEqual([]);
  });

  it('rechaza una --match-expectation desconocida', () => {
    expect(() => parseRunnerArgs(['--match-expectation=synth'])).toThrow(/--match-expectation/);
  });
});
