import { describe, expect, it } from 'vitest';
import { CvFileTooLarge, InvalidCvUpload } from '../domain/errors';
import {
  asCvUploadError,
  isNotMultipart,
  translatingMultipartErrors,
} from './multipart-errors';

// La tabla de D2, fila a fila, más la red de seguridad: **ninguno acaba en 500**.

function fstError(code: string): Error {
  return Object.assign(new Error(`multipart said ${code}`), { code });
}

describe('asCvUploadError', () => {
  it('translates the size limit to file_too_large', () => {
    expect(asCvUploadError(fstError('FST_REQ_FILE_TOO_LARGE'))).toBeInstanceOf(
      CvFileTooLarge,
    );
  });

  it.each([
    'FST_FILES_LIMIT',
    'FST_PARTS_LIMIT',
    'FST_FIELDS_LIMIT',
    'FST_PROTO_VIOLATION',
  ])('translates %s to a validation error naming file', (code) => {
    const translated = asCvUploadError(fstError(code));

    expect(translated).toBeInstanceOf(InvalidCvUpload);
    expect((translated as InvalidCvUpload).field).toBe('file');
  });

  it('translates a code the plugin may add tomorrow, instead of letting it be a 500', () => {
    // La lista de códigos es del plugin y crece con una versión menor.
    expect(asCvUploadError(fstError('FST_LO_QUE_SEA'))).toBeInstanceOf(
      InvalidCvUpload,
    );
  });

  it('leaves alone what is not an error of the parser', () => {
    expect(asCvUploadError(new Error('mongo is down'))).toBeUndefined();
    expect(asCvUploadError({ code: 11_000 })).toBeUndefined();
    expect(asCvUploadError(undefined)).toBeUndefined();
    expect(asCvUploadError('a string')).toBeUndefined();
  });
});

describe('isNotMultipart', () => {
  it('recognizes a body that is not multipart at all', () => {
    expect(isNotMultipart(fstError('FST_INVALID_MULTIPART_CONTENT_TYPE'))).toBe(
      true,
    );
  });

  it('does not confuse it with a file we do not accept', () => {
    expect(isNotMultipart(fstError('FST_REQ_FILE_TOO_LARGE'))).toBe(false);
    // Y no llega a la traducción genérica por otro camino: tiene su propia rama, con su propio código HTTP.
    expect(asCvUploadError(fstError('FST_INVALID_MULTIPART_CONTENT_TYPE'))).toBeInstanceOf(
      InvalidCvUpload,
    );
  });
});

describe('translatingMultipartErrors', () => {
  it('returns what the work returned when nothing failed', async () => {
    await expect(translatingMultipartErrors(() => Promise.resolve(7))).resolves.toBe(
      7,
    );
  });

  it('translates what the read loop throws, and not only what getting the part throws', async () => {
    // El error de tamaño sale del bucle: el plugin corta el stream al superar `fileSize`.
    const readLoop = async () => {
      await Promise.resolve();
      throw fstError('FST_REQ_FILE_TOO_LARGE');
    };

    await expect(translatingMultipartErrors(readLoop)).rejects.toBeInstanceOf(
      CvFileTooLarge,
    );
  });

  it('lets a failure of ours through, because that one really is a 500', async () => {
    await expect(
      translatingMultipartErrors(() => Promise.reject(new Error('mongo is down'))),
    ).rejects.toThrow('mongo is down');
  });
});
