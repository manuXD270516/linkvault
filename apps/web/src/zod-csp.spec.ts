import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import './zod-csp';

describe('zod-csp', () => {
  it('configures zod as jitless', () => {
    expect(z.config().jitless).toBe(true);
  });
});
