import { describe, expect, it } from 'vitest';
import { ProviderUnavailable } from './errors';

// Requisito "Clase del fallo de proveedor" (specs/ai/provider-routing, paste-fallback-honest D1).

describe('ProviderUnavailable.kind', () => {
  it('429 is rate_limited', () => {
    expect(new ProviderUnavailable('p', 429).kind).toBe('rate_limited');
  });

  it('401, 402, 403 and 404 are rejected', () => {
    for (const status of [401, 402, 403, 404]) {
      expect(new ProviderUnavailable('p', status).kind).toBe('rejected');
    }
  });

  it('5xx and missing status are unavailable', () => {
    for (const status of [500, 502, 503, 504, 400, 200]) {
      expect(new ProviderUnavailable('p', status).kind).toBe('unavailable');
    }
    expect(new ProviderUnavailable('p').kind).toBe('unavailable');
  });

  it('keeps the message free of any body', () => {
    expect(new ProviderUnavailable('p', 429).message).toBe(
      'Provider "p" is unavailable (HTTP 429)',
    );
  });
});
