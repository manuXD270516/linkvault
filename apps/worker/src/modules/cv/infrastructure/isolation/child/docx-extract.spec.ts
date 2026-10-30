import { describe, expect, it } from 'vitest';
import {
  docxWithText,
  docxWithTextDeflated,
  docxWithZip64Extra,
  zipThatIsNotDocx,
} from '../../extractors/fixtures/cv-fixtures';
import { extractDocx } from './docx-extract';

describe('extractDocx', () => {
  it('a deflated docx gives the same text as the stored one', async () => {
    const stored = await extractDocx(docxWithText());
    const deflated = await extractDocx(docxWithTextDeflated());

    expect(stored.kind).toBe('text');
    expect(deflated).toEqual(stored);
    if (deflated.kind === 'text') {
      expect(deflated.text).toContain('Nadia Quispe Almaraz');
    }
  });

  it('a zip that is not a docx fails as parse_error', async () => {
    expect(await extractDocx(zipThatIsNotDocx())).toEqual({
      kind: 'failed',
      cause: 'parse_error',
    });
  });

  it('small docx with zip64 extra field is extracted', async () => {
    const result = await extractDocx(docxWithZip64Extra());

    expect(result.kind).toBe('text');
    if (result.kind === 'text') {
      expect(result.text).toContain('Nadia Quispe Almaraz');
    }
  });

  it('a pdf sent as a docx fails without leaking its parser message', async () => {
    const result = await extractDocx(
      new TextEncoder().encode('%PDF-1.4 CANARY-DOCX-MSG'),
    );

    expect(result).toEqual({ kind: 'failed', cause: 'parse_error' });
  });
});
