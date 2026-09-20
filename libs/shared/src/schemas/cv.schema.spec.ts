import { describe, expect, it } from 'vitest';
import {
  cvDocumentSchema,
  cvExtractionFailureReasonSchema,
  cvExtractionSchema,
  cvExtractionStatusSchema,
  cvListResponseSchema,
  cvTextPreviewResponseSchema,
} from './cv.schema';

const document = {
  id: '66e9a0000000000000000001',
  fileName: 'CV_backend.pdf',
  fileType: 'pdf',
  sizeBytes: 319_488,
  version: 1,
  isDefault: true,
  uploadedAt: '2026-09-12T10:00:00.000Z',
  extraction: { status: 'pending', textChars: 0 },
} as const;

describe('cvExtractionStatusSchema', () => {
  it('admite los tres estados y nada más', () => {
    expect(cvExtractionStatusSchema.options).toEqual([
      'pending',
      'extracted',
      'failed',
    ]);
    expect(cvExtractionStatusSchema.safeParse('reading').success).toBe(false);
  });
});

describe('cvExtractionFailureReasonSchema', () => {
  it('admite los tres motivos y nada más', () => {
    expect(cvExtractionFailureReasonSchema.options).toEqual([
      'unreadable_file',
      'no_text',
      'internal_error',
    ]);
    expect(cvExtractionFailureReasonSchema.safeParse('encrypted').success).toBe(
      false,
    );
  });
});

describe('cvExtractionSchema', () => {
  it('acepta una extracción terminada bien', () => {
    const extraction = {
      status: 'extracted',
      textChars: 8412,
      extractedAt: '2026-09-12T10:00:03.000Z',
    } as const;

    expect(cvExtractionSchema.parse(extraction)).toEqual(extraction);
  });

  it('rechaza un failed sin motivo', () => {
    const result = cvExtractionSchema.safeParse({
      status: 'failed',
      textChars: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'failureReason',
    ]);
  });

  it('rechaza un motivo sin failed', () => {
    expect(
      cvExtractionSchema.safeParse({
        status: 'extracted',
        textChars: 10,
        failureReason: 'no_text',
      }).success,
    ).toBe(false);
  });

  it('rechaza la marca de texto recortado', () => {
    expect(
      cvExtractionSchema.safeParse({
        status: 'pending',
        textChars: 0,
        truncated: false,
      }).success,
    ).toBe(false);
  });
});

describe('cvDocumentSchema', () => {
  it('acepta un CV completo', () => {
    expect(cvDocumentSchema.parse(document)).toEqual(document);
  });

  it.each(['extractedText', 'truncated', 'fileKey', 'userId'])(
    'rechaza un objeto con %s',
    (field) => {
      const result = cvDocumentSchema.safeParse({
        ...document,
        [field]: 'lo que sea',
      });

      expect(result.success).toBe(false);
    },
  );

  it('rechaza un tipo de archivo que no admitimos', () => {
    expect(
      cvDocumentSchema.safeParse({ ...document, fileType: 'odt' }).success,
    ).toBe(false);
  });

  it('rechaza una versión que no es un entero positivo', () => {
    expect(
      cvDocumentSchema.safeParse({ ...document, version: 0 }).success,
    ).toBe(false);
  });
});

describe('cvListResponseSchema', () => {
  it('acepta una lista vacía', () => {
    expect(cvListResponseSchema.parse({ items: [] })).toEqual({ items: [] });
  });

  it('rechaza cualquier campo de más', () => {
    expect(
      cvListResponseSchema.safeParse({ items: [], nextCursor: null }).success,
    ).toBe(false);
  });
});

describe('cvTextPreviewResponseSchema', () => {
  it('acepta el texto vacío', () => {
    const body = {
      status: 'pending',
      text: '',
      chars: 0,
      complete: false,
    } as const;

    expect(cvTextPreviewResponseSchema.parse(body)).toEqual(body);
  });

  it('distingue un pending de un failed por su status', () => {
    const pending = cvTextPreviewResponseSchema.parse({
      status: 'pending',
      text: '',
      chars: 0,
      complete: false,
    });
    const failed = cvTextPreviewResponseSchema.parse({
      status: 'failed',
      text: '',
      chars: 0,
      complete: false,
    });

    expect(pending).not.toEqual(failed);
  });

  it('rechaza cualquier campo de más', () => {
    expect(
      cvTextPreviewResponseSchema.safeParse({
        status: 'extracted',
        text: 'hola',
        chars: 4,
        complete: true,
        truncated: false,
      }).success,
    ).toBe(false);
  });

  it('exige los cuatro campos', () => {
    expect(
      cvTextPreviewResponseSchema.safeParse({
        text: 'hola',
        chars: 4,
        complete: true,
      }).success,
    ).toBe(false);
  });
});
