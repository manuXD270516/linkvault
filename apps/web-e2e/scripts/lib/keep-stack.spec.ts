import { describe, expect, it } from 'vitest';
import { keepStackMessage } from './keep-stack';

const BASE = {
  projectName: 'linkvault-e2e-36923de7',
  downCommand: 'pnpm nx run web-e2e:e2e-stack -- --down',
  runnerArgs: ['--rehearse-remote', '--keep-stack'],
} as const;

describe('keepStackMessage', () => {
  it('does not promise the apps after a failure launched by Nx on Windows, and gives the direct command', () => {
    const message = keepStackMessage({ ...BASE, failed: true, platform: 'win32', underNx: true });
    expect(message).toContain('api, worker y web NO');
    expect(message).toContain('node --import tsx apps/web-e2e/scripts/e2e-stack.ts');
    expect(message).toContain('--rehearse-remote --keep-stack');
    expect(message).not.toContain('la pila sigue levantada');
  });

  it.each([
    ['green run under Nx', { failed: false, platform: 'win32', underNx: true }],
    ['failure launched with node', { failed: true, platform: 'win32', underNx: false }],
    ['failure under Nx on Linux (not measured)', { failed: true, platform: 'linux', underNx: true }],
  ] as const)('keeps the whole stack message for a %s', (_name, context) => {
    const message = keepStackMessage({ ...BASE, ...context });
    expect(message).toBe(
      '--keep-stack: la pila sigue levantada (proyecto linkvault-e2e-36923de7). Para apagarla: pnpm nx run web-e2e:e2e-stack -- --down',
    );
  });
});
