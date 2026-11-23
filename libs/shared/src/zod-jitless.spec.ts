import { describe, expect, it } from 'vitest';
import { z } from './zod-jitless';
import { z as plain } from 'zod';

describe('zod-jitless', () => {
  it('configures zod as jitless and hands out the same z', () => {
    expect(z.config().jitless).toBe(true);
    expect(z).toBe(plain);
  });
});
