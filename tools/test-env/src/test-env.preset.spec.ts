import { describe, expect, it } from 'vitest';

// El vitest.config de este proyecto extiende el preset; el test comprueba lo que ve el proceso de test.
describe('testEnvPreset', () => {
  it('exposes the mock AI chain to the test process', () => {
    expect(process.env['AI_CHAIN']).toBe('mock');
    expect(process.env['AI_MOCK_MODE']).toBe('replay');
    expect(process.env['AI_EMBED_CHAIN']).toBe('mock');
  });
});
