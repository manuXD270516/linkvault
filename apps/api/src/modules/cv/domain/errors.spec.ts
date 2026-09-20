import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CV_MAX_FILE_BYTES,
  CV_TEXT_PREVIEW_CHARS,
  MAX_CV_DOCUMENTS,
  apiErrorCodeSchema,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  CvError,
  CvFileTooLarge,
  CvNotFound,
  InvalidCvUpload,
  TooManyCvAttempts,
  TooManyCvDocuments,
  UnsupportedCvFile,
} from './errors';
import {
  CV_LIMIT_WINDOW_MS,
  CV_REJECTS_PER_USER,
  CV_TEXT_PREVIEWS_PER_USER,
  CV_UPLOADS_PER_USER,
} from './limits';

describe('the domain errors of cv', () => {
  const errors: readonly CvError[] = [
    new CvNotFound(),
    new UnsupportedCvFile(),
    new CvFileTooLarge(),
    new InvalidCvUpload(),
    new TooManyCvDocuments(),
    new TooManyCvAttempts(900),
  ];

  it.each(errors.map((error) => [error.name, error] as const))(
    '%s carries a code of the API contract',
    (_name, error) => {
      expect(apiErrorCodeSchema.options).toContain(error.code);
    },
  );

  it('maps each error to the code the spec asks for', () => {
    expect(new CvNotFound().code).toBe('cv_not_found');
    expect(new UnsupportedCvFile().code).toBe('unsupported_file_type');
    expect(new CvFileTooLarge().code).toBe('file_too_large');
    expect(new TooManyCvDocuments().code).toBe('too_many_cvs');
    expect(new TooManyCvAttempts(60).code).toBe('too_many_attempts');
  });

  it('names the file field in the invalid upload, and nothing else', () => {
    const error = new InvalidCvUpload();

    expect(error.code).toBe('validation_error');
    expect(error.field).toBe('file');
  });

  it('carries the wait in the exhausted window', () => {
    expect(new TooManyCvAttempts(742).retryAfterSeconds).toBe(742);
  });

  it.each(errors.map((error) => [error.name, error] as const))(
    '%s says nothing about the file itself',
    (_name, error) => {
      expect(error.message).not.toMatch(/\.pdf|\.docx|\//);
    },
  );
});

describe('the limits of cv', () => {
  it('declares only the windows, and imports the caps from the contract', () => {
    const source = readFileSync(join(import.meta.dirname, 'limits.ts'), 'utf8');

    // Los topes del contrato no se reescriben aquí: se importan. Si alguien los copiara, este test lo vería.
    expect(source).toMatch(/from '@linkvault\/shared'/);
    expect(source).not.toMatch(/5 \* 1024 \* 1024|= 5;|200_000|= 2000;/);
  });

  it('re-exports the shared caps with the same value', () => {
    expect(CV_MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_CV_DOCUMENTS).toBe(5);
    expect(CV_TEXT_PREVIEW_CHARS).toBe(2000);
  });

  it('keeps the three windows of D5', () => {
    expect(CV_UPLOADS_PER_USER).toBe(10);
    expect(CV_TEXT_PREVIEWS_PER_USER).toBe(60);
    expect(CV_REJECTS_PER_USER).toBe(30);
    expect(CV_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
