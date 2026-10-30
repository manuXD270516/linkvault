import { CV_MIN_TEXT_CHARS } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { outcomeOfExtractedText } from '../../domain/extraction-outcome';
import { realChildRunner } from '../isolation/isolation-test-kit';
import { IsolatedCvTextExtractor } from '../isolation/isolated-cv-text-extractor';
import { withOwnBuffer } from '../isolation/child/pdf-extract';
import {
  corruptPdf,
  docxWithText,
  docxWithTextDeflated,
  encryptedPdf,
  pdfWithText,
  pdfWithoutText,
  zipThatIsNotDocx,
} from './fixtures/cv-fixtures';

// Los extractores contra los fixtures generados (tareas 7.5 y 7.6 de cv-upload-extract), ahora **a través del hijo real**
// compilado a `tmp/cv-child-test/` con los flags de producción (3.4 y 3.5 de cv-extract-isolation). Los fixtures se
// generan en cada ejecución: ningún binario en el repositorio y ningún CV real en un test.

const { runner } = realChildRunner();
const pdf = new IsolatedCvTextExtractor('pdf', runner);
const docx = new IsolatedCvTextExtractor('docx', runner);

describe('PDF through the isolated child', () => {
  it('extracts the fixture PDF with the expected text', async () => {
    const attempt = await pdf.extract(pdfWithText());

    expect(attempt.kind).toBe('text');
    if (attempt.kind === 'text') {
      expect(attempt.text).toContain('Nadia Quispe Almaraz');
      expect(outcomeOfExtractedText(attempt.text).kind).toBe('extracted');
    }
  });

  it('opens a scanned PDF and finds nothing to read', async () => {
    const attempt = await pdf.extract(pdfWithoutText());

    expect(attempt.kind).toBe('text');
    if (attempt.kind === 'text') {
      expect(attempt.text.trim().length).toBeLessThan(CV_MIN_TEXT_CHARS);
      expect(outcomeOfExtractedText(attempt.text)).toEqual({ kind: 'no_text' });
    }
  });

  it('an encrypted PDF fails as password', async () => {
    expect(await runner.run('pdf', encryptedPdf())).toEqual({
      kind: 'unreadable',
      cause: 'password',
    });
    await expect(pdf.extract(encryptedPdf())).resolves.toEqual({
      kind: 'unreadable_file',
    });
  });

  it('a corrupt PDF fails as parse_error', async () => {
    expect(await runner.run('pdf', corruptPdf())).toEqual({
      kind: 'unreadable',
      cause: 'parse_error',
    });
    await expect(pdf.extract(corruptPdf())).resolves.toEqual({
      kind: 'unreadable_file',
    });
  });

  it('calls an empty file unreadable', async () => {
    await expect(pdf.extract(new Uint8Array())).resolves.toEqual({
      kind: 'unreadable_file',
    });
  });

  it('reads a small PDF that arrives in a pooled buffer', async () => {
    // El caso real: el adaptador S3 devuelve un `Buffer` sacado del *pool*, con `byteOffset` distinto de cero.
    const source = pdfWithText();
    const pool = Buffer.allocUnsafe(source.byteLength + 128);
    const pooled = pool.subarray(128);
    pooled.set(source);
    expect(pooled.byteOffset).toBeGreaterThan(0);

    const attempt = await pdf.extract(pooled);

    expect(attempt.kind).toBe('text');
    if (attempt.kind === 'text') {
      expect(attempt.text).toContain('Nadia Quispe Almaraz');
    }
  });

  it('copies into a buffer that starts at zero and shares nothing', () => {
    const pool = Buffer.allocUnsafe(64);
    const pooled = pool.subarray(16);

    const own = withOwnBuffer(pooled);

    expect(own.byteOffset).toBe(0);
    expect(own.buffer.byteLength).toBe(own.byteLength);
    expect(own.buffer).not.toBe(pooled.buffer);
  });
});

describe('DOCX through the isolated child', () => {
  it('reads a DOCX with text', async () => {
    const attempt = await docx.extract(docxWithText());

    expect(attempt.kind).toBe('text');
    if (attempt.kind === 'text') {
      expect(attempt.text).toContain('Nadia Quispe Almaraz');
      expect(outcomeOfExtractedText(attempt.text).kind).toBe('extracted');
    }
  });

  it('reads the same text from a deflated DOCX', async () => {
    const stored = await docx.extract(docxWithText());
    const deflated = await docx.extract(docxWithTextDeflated());

    expect(deflated).toEqual(stored);
  });

  it('calls a ZIP that is not a DOCX unreadable, which is the second gate of D2', async () => {
    await expect(docx.extract(zipThatIsNotDocx())).resolves.toEqual({
      kind: 'unreadable_file',
    });
  });

  it('calls a PDF sent as a DOCX unreadable', async () => {
    await expect(docx.extract(pdfWithText())).resolves.toEqual({
      kind: 'unreadable_file',
    });
  });
});
