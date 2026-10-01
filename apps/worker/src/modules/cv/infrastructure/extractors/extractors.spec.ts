import { CV_MIN_TEXT_CHARS } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  corruptPdf,
  docxWithText,
  encryptedPdf,
  pdfWithText,
  pdfWithoutText,
  zipThatIsNotDocx,
} from './fixtures/cv-fixtures';
import { outcomeOfExtractedText } from '../../domain/extraction-outcome';
import { DocxTextExtractor } from './docx-text.extractor';
import { PdfTextExtractor, withOwnBuffer } from './pdf-text.extractor';

// Los extractores contra los fixtures generados (tareas 7.5 y 7.6). Los fixtures se generan en cada ejecución, así que
// no hay ningún binario en el repositorio y ningún CV real en un test.

const pdf = new PdfTextExtractor();
const docx = new DocxTextExtractor();

describe('PdfTextExtractor', () => {
  it('reads a PDF with a text layer', async () => {
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

  it('calls a corrupt file unreadable instead of throwing', async () => {
    await expect(pdf.extract(corruptPdf())).resolves.toEqual({
      kind: 'unreadable_file',
    });
  });

  it('calls a password protected file unreadable', async () => {
    await expect(pdf.extract(encryptedPdf())).resolves.toEqual({
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
    // Sin la copia a desplazamiento cero, `pdf-parse` lee la tabla `xref` desplazada y este CV legible acabaría en
    // `failed`.
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

describe('DocxTextExtractor', () => {
  it('reads a DOCX with text', async () => {
    const attempt = await docx.extract(docxWithText());

    expect(attempt.kind).toBe('text');
    if (attempt.kind === 'text') {
      expect(attempt.text).toContain('Nadia Quispe Almaraz');
      expect(outcomeOfExtractedText(attempt.text).kind).toBe('extracted');
    }
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
