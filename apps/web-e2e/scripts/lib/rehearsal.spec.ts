import { describe, expect, it } from 'vitest';
import {
  compareListenerPids,
  describeRehearsalWorker,
  REHEARSAL_FAKE_OPENROUTER_KEY,
  rehearsalMatchExpectation,
  rehearsalWorkerEnv,
} from './rehearsal';

const SUITE = { AI_CHAIN: 'mock', AI_MOCK_MODE: 'replay', AI_EMBED_CHAIN: 'mock', NODE_ENV: 'development', API_PORT: '3100' };

describe('rehearsalWorkerEnv', () => {
  it('points the LLM chain at an unreachable external provider and keeps the rest of the suite env', () => {
    const env = rehearsalWorkerEnv(SUITE);
    expect(env).toMatchObject({
      AI_CHAIN: 'openrouter',
      OPENROUTER_API_KEY: REHEARSAL_FAKE_OPENROUTER_KEY,
      OPENROUTER_BASE_URL: 'https://ai.invalid',
      NODE_ENV: 'development',
      AI_MOCK_MODE: 'replay',
      AI_EMBED_CHAIN: 'mock',
      API_PORT: '3100',
    });
    expect(env['OPENROUTER_MODEL']).toMatch(/:free$/);
    expect(new URL(env['OPENROUTER_BASE_URL'] ?? '').hostname.endsWith('.invalid')).toBe(true);
  });

  it('does not change the input', () => {
    rehearsalWorkerEnv(SUITE);
    expect(SUITE.AI_CHAIN).toBe('mock');
  });
});

describe('describeRehearsalWorker', () => {
  it('names the chain, model and origin but never the key', () => {
    const text = describeRehearsalWorker();
    expect(text).toContain('AI_CHAIN=openrouter');
    expect(text).toContain('OPENROUTER_MODEL=cohere/north-mini-code:free');
    expect(text).toContain('OPENROUTER_BASE_URL=https://ai.invalid');
    expect(text).not.toContain(REHEARSAL_FAKE_OPENROUTER_KEY);
  });
});

describe('compareListenerPids', () => {
  it('accepts the same PIDs in any order', () => {
    expect(compareListenerPids('api', [20, 10], [10, 20, 20])).toBeNull();
  });

  it('fails when the PIDs change', () => {
    expect(compareListenerPids('api', [10], [11])).toBe(
      'api: listener PIDs changed across the worker restart (before 10, after 11)',
    );
  });

  it('fails when nothing listens after the restart', () => {
    expect(compareListenerPids('api', [10], [])).toContain('after none');
  });

  it('fails when nothing listened before the restart', () => {
    expect(compareListenerPids('api', [], [])).toBe('api: no listener PID before the worker restart');
  });
});

describe('rehearsalMatchExpectation (tarea 5.7)', () => {
  it('defaults to consent-required, the outcome of the destination the rehearsal imitates', () => {
    expect(rehearsalMatchExpectation(undefined)).toBe('consent-required');
  });

  it('takes --match-expectation like e2e-remote', () => {
    expect(rehearsalMatchExpectation('replay-report')).toBe('replay-report');
    expect(rehearsalMatchExpectation('consent-required')).toBe('consent-required');
  });
});
