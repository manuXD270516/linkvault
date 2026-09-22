import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('matches node:crypto for UTF-8 strings', () => {
    for (const input of ['', 'a', 'Nest remoto', 'job_preview|l1|title|g1', 'ñ']) {
      const expected = createHash('sha256').update(input, 'utf8').digest('hex');
      expect(sha256Hex(input)).toBe(expected);
    }
  });
});
