import { describe, expect, it } from 'vitest';
import { CvExtractionMachineryError } from './cv-extraction-machinery.error';

describe('CvExtractionMachineryError', () => {
  it('the machinery error has a fixed message and no cause', () => {
    const error = new CvExtractionMachineryError('boot_timeout');

    expect(error.message).toBe('cv extraction machinery failure: boot_timeout');
    expect(error.cause).toBeUndefined();
    expect(error.code).toBeUndefined();
  });

  it('keeps a code only when it matches the closed pattern', () => {
    expect(new CvExtractionMachineryError('boot_error', 'ERR_X').code).toBe(
      'ERR_X',
    );
    expect(
      new CvExtractionMachineryError('boot_error', 'CANARY-CHILD-MSG').code,
    ).toBeUndefined();
  });
});
