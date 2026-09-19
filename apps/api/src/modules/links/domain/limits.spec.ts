import { IMPORT_TEXT_MAX_LENGTH, LINK_URL_MAX_LENGTH } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { InvalidUrl, TextTooLong } from './errors';
import {
  COMMENTS_PER_USER,
  assertImportTextWithinLimit,
  assertUrlWithinLimit,
  isImportTextTooLong,
  isUrlTooLong,
  MAX_IMPORT_TEXT_LENGTH,
  MAX_URL_LENGTH,
} from './limits';

const longUrl = `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`;

describe('url length', () => {
  it('allows a url of exactly the maximum', () => {
    const atLimit = `https://example.com/${'a'.repeat(MAX_URL_LENGTH - 20)}`;

    expect(atLimit).toHaveLength(MAX_URL_LENGTH);
    expect(isUrlTooLong(atLimit)).toBe(false);
    expect(() => assertUrlWithinLimit(atLimit)).not.toThrow();
  });

  it('rejects a longer url with invalid_url, not with a validation error', () => {
    expect(isUrlTooLong(longUrl)).toBe(true);
    expect(() => assertUrlWithinLimit(longUrl)).toThrow(InvalidUrl);
  });

  it('is the limit of the shared contract', () => {
    expect(MAX_URL_LENGTH).toBe(2048);
    expect(MAX_URL_LENGTH).toBe(LINK_URL_MAX_LENGTH);
  });
});

describe('imported text length', () => {
  it('allows a text of exactly the maximum', () => {
    const atLimit = 'a'.repeat(MAX_IMPORT_TEXT_LENGTH);

    expect(isImportTextTooLong(atLimit)).toBe(false);
    expect(() => assertImportTextWithinLimit(atLimit)).not.toThrow();
  });

  it('rejects a longer text with text_too_long', () => {
    const overLimit = 'a'.repeat(MAX_IMPORT_TEXT_LENGTH + 1);

    expect(isImportTextTooLong(overLimit)).toBe(true);
    expect(() => assertImportTextWithinLimit(overLimit)).toThrow(TextTooLong);
  });

  it('is the limit of the shared contract', () => {
    expect(MAX_IMPORT_TEXT_LENGTH).toBe(20_000);
    expect(MAX_IMPORT_TEXT_LENGTH).toBe(IMPORT_TEXT_MAX_LENGTH);
  });
});

describe('both limits measure code points, like zod', () => {
  it('counts an emoji as one character', () => {
    expect(isImportTextTooLong('👩‍💻'.repeat(MAX_IMPORT_TEXT_LENGTH))).toBe(true);
    expect(isUrlTooLong(`https://example.com/${'ñ'.repeat(MAX_URL_LENGTH - 20)}`)).toBe(
      false,
    );
  });
});

describe('comment limit', () => {
  it('allows 30 comments per person in the window', () => {
    expect(COMMENTS_PER_USER).toBe(30);
  });
});
