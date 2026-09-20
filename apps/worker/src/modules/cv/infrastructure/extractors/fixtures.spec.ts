import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CV_LINES,
  corruptPdf,
  docxWithText,
  encryptedPdf,
  generatedCvFixtures,
  pdfWithText,
  pdfWithoutText,
  writeCvFixtures,
  zipThatIsNotDocx,
} from './fixtures/cv-fixtures';

// Los fixtures se abren y se comprueban por sus firmas (tareas 7.3 y 7.4). Lo que importa aquí no es el contenido
// —eso lo prueban los extractores— sino que el script escribe lo que dice escribir y que ninguno lleva datos
// personales.

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function asText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

let temporary: string | undefined;

afterAll(async () => {
  if (temporary !== undefined) {
    await rm(temporary, { recursive: true, force: true });
  }
});

describe('the generated CV fixtures', () => {
  it.each([
    ['cv-with-text.pdf', pdfWithText()],
    ['cv-without-text.pdf', pdfWithoutText()],
    ['cv-corrupt.pdf', corruptPdf()],
    ['cv-encrypted.pdf', encryptedPdf()],
  ])('%s starts with the PDF signature', (_name, bytes) => {
    expect(startsWith(bytes, PDF_SIGNATURE)).toBe(true);
  });

  it.each([
    ['cv-with-text.docx', docxWithText()],
    ['not-a-docx.zip', zipThatIsNotDocx()],
  ])('%s starts with the ZIP signature', (_name, bytes) => {
    expect(startsWith(bytes, ZIP_SIGNATURE)).toBe(true);
  });

  it('gives the encrypted PDF its standard encryption dictionary', () => {
    const text = asText(encryptedPdf());

    expect(text).toContain('/Filter /Standard');
    expect(text).toContain('/Encrypt 6 0 R');
    expect(text).toMatch(/\/ID \[</);
  });

  it('is deterministic: the same call gives the same bytes', () => {
    expect(Buffer.from(pdfWithText())).toEqual(Buffer.from(pdfWithText()));
    expect(Buffer.from(docxWithText())).toEqual(Buffer.from(docxWithText()));
    expect(Buffer.from(corruptPdf())).toEqual(Buffer.from(corruptPdf()));
  });

  it('carries an invented CV and no personal data', () => {
    for (const line of FIXTURE_CV_LINES) {
      expect(line).not.toMatch(/@|\+\d{2,}/);
    }
    expect(asText(pdfWithText())).toContain('Nadia Quispe Almaraz');
  });

  it('writes every fixture to disk when the script is run', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'cv-fixtures-'));

    const written = await writeCvFixtures(temporary);

    expect(written).toHaveLength(Object.keys(generatedCvFixtures()).length);
    for (const path of written) {
      const bytes = await readFile(path);
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(
        startsWith(bytes, PDF_SIGNATURE) || startsWith(bytes, ZIP_SIGNATURE),
      ).toBe(true);
    }
  });
});
