import { describe, expect, it } from 'vitest';
import {
  CV_FILE_TYPES,
  CV_PDF_SIGNATURE_MAX_OFFSET,
  resolveCvFileType,
  sniffCvFileType,
  type CvFileType,
} from './cv-file';

const encoder = new TextEncoder();

function bytesOf(text: string): Uint8Array {
  return encoder.encode(text);
}

const pdf = bytesOf('%PDF-1.7\nnada personal aquí');
const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const pdfWithJunk = bytesOf(`${'x'.repeat(300)}%PDF-1.4`);
const pdfTooDeep = bytesOf(`${'x'.repeat(2000)}%PDF-1.4`);
const executable = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);

describe('sniffCvFileType', () => {
  const table: ReadonlyArray<
    readonly [string, Uint8Array, CvFileType | undefined]
  > = [
    ['un PDF normal', pdf, 'pdf'],
    ['un PDF con basura por delante, dentro del kilobyte', pdfWithJunk, 'pdf'],
    ['un PDF con la firma más allá del kilobyte', pdfTooDeep, undefined],
    ['un DOCX', docx, 'docx'],
    ['un ejecutable', executable, undefined],
    ['un archivo de 3 bytes', new Uint8Array([1, 2, 3]), undefined],
    ['un archivo vacío', new Uint8Array(), undefined],
  ];

  it.each(table)('con %s devuelve %s', (_name, bytes, expected) => {
    expect(sniffCvFileType(bytes)).toBe(expected);
  });

  it('busca la firma del PDF justo hasta el límite declarado', () => {
    const atLimit = bytesOf(
      `${'x'.repeat(CV_PDF_SIGNATURE_MAX_OFFSET)}%PDF-1.4`,
    );
    const pastLimit = bytesOf(
      `${'x'.repeat(CV_PDF_SIGNATURE_MAX_OFFSET + 1)}%PDF-1.4`,
    );

    expect(sniffCvFileType(atLimit)).toBe('pdf');
    expect(sniffCvFileType(pastLimit)).toBeUndefined();
  });
});

describe('resolveCvFileType', () => {
  const table: ReadonlyArray<
    readonly [
      string,
      { contentType?: string; fileName: string; bytes: Uint8Array },
      CvFileType | undefined,
    ]
  > = [
    [
      'un PDF con su mime',
      { contentType: 'application/pdf', fileName: 'CV.pdf', bytes: pdf },
      'pdf',
    ],
    [
      'un PDF con application/octet-stream',
      {
        contentType: 'application/octet-stream',
        fileName: 'CV.pdf',
        bytes: pdf,
      },
      'pdf',
    ],
    ['un PDF sin Content-Type', { fileName: 'CV.pdf', bytes: pdf }, 'pdf'],
    [
      'un PDF con image/png',
      { contentType: 'image/png', fileName: 'CV.pdf', bytes: pdf },
      undefined,
    ],
    [
      'un PDF con nombre .docx',
      {
        contentType: CV_FILE_TYPES.docx.mimeType,
        fileName: 'CV.docx',
        bytes: pdf,
      },
      undefined,
    ],
    [
      'un DOCX sin Content-Type',
      { fileName: 'CV.docx', bytes: docx },
      'docx',
    ],
    [
      'un .odt',
      {
        contentType: 'application/vnd.oasis.opendocument.text',
        fileName: 'CV.odt',
        bytes: docx,
      },
      undefined,
    ],
    ['un archivo sin extensión', { fileName: 'CV', bytes: pdf }, undefined],
  ];

  it.each(table)('con %s devuelve %s', (_name, candidate, expected) => {
    expect(resolveCvFileType(candidate)).toBe(expected);
  });

  it('acepta el mime con parámetros y la extensión en mayúsculas', () => {
    expect(
      resolveCvFileType({
        contentType: 'application/pdf; charset=binary',
        fileName: 'CV.PDF',
        bytes: pdf,
      }),
    ).toBe('pdf');
  });

  it('acepta un Content-Type vacío, que no dice nada', () => {
    expect(
      resolveCvFileType({ contentType: '', fileName: 'CV.pdf', bytes: pdf }),
    ).toBe('pdf');
  });
});

describe('CV_FILE_TYPES', () => {
  it('declara el mime, la extensión y la firma de cada tipo', () => {
    expect(CV_FILE_TYPES.pdf.extension).toBe('.pdf');
    expect(CV_FILE_TYPES.pdf.mimeType).toBe('application/pdf');
    expect(CV_FILE_TYPES.docx.extension).toBe('.docx');
    expect(CV_FILE_TYPES.docx.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect([...CV_FILE_TYPES.docx.signature]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});
