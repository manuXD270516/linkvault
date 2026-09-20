import { describe, expect, it } from 'vitest';
import {
  CV_MAX_FILE_BYTES,
  CV_MIN_TEXT_CHARS,
  CV_TEXT_MAX_CHARS,
  CV_TEXT_PREVIEW_CHARS,
  MAX_CV_DOCUMENTS,
} from './cv-limits';

describe('los topes del CV', () => {
  it('son los del diseño y los exporta el contrato', () => {
    expect(CV_MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_CV_DOCUMENTS).toBe(5);
    expect(CV_TEXT_MAX_CHARS).toBe(200_000);
    expect(CV_MIN_TEXT_CHARS).toBe(100);
    expect(CV_TEXT_PREVIEW_CHARS).toBe(2000);
  });

  it('deja la vista previa por debajo del texto guardado', () => {
    expect(CV_TEXT_PREVIEW_CHARS).toBeLessThan(CV_TEXT_MAX_CHARS);
    expect(CV_MIN_TEXT_CHARS).toBeLessThan(CV_TEXT_PREVIEW_CHARS);
  });
});
