import { describe, expect, it } from 'vitest';
import * as limits from './extraction-limits';

describe('extraction limits', () => {
  it('pins the isolation limits', () => {
    expect({ ...limits }).toEqual({
      CV_MAX_PDF_PAGES: 50,
      CV_MAX_RAW_TEXT_CHARS: 1_000_000,
      CV_DOCX_MAX_INFLATED_BYTES: 64 * 1024 * 1024,
      CV_DOCX_MAX_ENTRIES: 2_000,
      CV_CHILD_MAX_OLD_SPACE_MB: 256,
      CV_CHILD_MAX_SEMI_SPACE_MB: 16,
      CV_MEMORY_CEILING_BYTES: 512 * 1024 * 1024,
      CV_MEMORY_SAMPLE_MS: 100,
      CV_CHILD_BOOT_TIMEOUT_MS: 5_000,
      CV_ISOLATION_GRACE_MS: 2_000,
      CV_CHANNEL_MAX_BYTES: 8 * 1024 * 1024,
    });
  });

  it('fits the worst-case escaped result in the channel frame', () => {
    // 6 bytes por unidad UTF-16 en el peor caso (`\uXXXX`) más un sobre pequeño.
    expect(limits.CV_MAX_RAW_TEXT_CHARS * 6 + 1024).toBeLessThan(
      limits.CV_CHANNEL_MAX_BYTES,
    );
  });
});
