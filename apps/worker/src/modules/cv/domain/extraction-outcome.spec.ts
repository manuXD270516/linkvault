import { CV_MIN_TEXT_CHARS, CV_TEXT_MAX_CHARS } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { outcomeOfExtractedText } from './extraction-outcome';

describe('outcomeOfExtractedText', () => {
  it('keeps a normal CV text, already normalized', () => {
    const raw = `${'Experiencia en backend. '.repeat(20)}\r\n\r\n\r\nFin`;

    const outcome = outcomeOfExtractedText(raw);

    expect(outcome.kind).toBe('extracted');
    if (outcome.kind === 'extracted') {
      expect(outcome.text).not.toContain('\r');
      expect(outcome.text).not.toMatch(/\n{3}/);
      expect(outcome.chars).toBe([...outcome.text].length);
      expect(outcome.truncated).toBe(false);
    }
  });

  it('calls a text below the minimum no_text', () => {
    expect(outcomeOfExtractedText('a'.repeat(CV_MIN_TEXT_CHARS - 1))).toEqual({
      kind: 'no_text',
    });
  });

  it('accepts a text of exactly the minimum', () => {
    expect(
      outcomeOfExtractedText('a'.repeat(CV_MIN_TEXT_CHARS)).kind,
    ).toBe('extracted');
  });

  it('calls an empty text no_text, which is what a scan gives', () => {
    expect(outcomeOfExtractedText('')).toEqual({ kind: 'no_text' });
    expect(outcomeOfExtractedText('   \n\n  ')).toEqual({ kind: 'no_text' });
  });

  it('cuts a huge text at the cap and marks it, for Mongo only', () => {
    const outcome = outcomeOfExtractedText('a'.repeat(CV_TEXT_MAX_CHARS + 500));

    expect(outcome).toMatchObject({
      kind: 'extracted',
      chars: CV_TEXT_MAX_CHARS,
      truncated: true,
    });
  });

  it('counts what it saves, so textChars never disagrees with the text', () => {
    const outcome = outcomeOfExtractedText(
      `  ${'palabra '.repeat(50)}  `,
    );

    if (outcome.kind === 'extracted') {
      expect(outcome.chars).toBe([...outcome.text].length);
    }
  });
});
