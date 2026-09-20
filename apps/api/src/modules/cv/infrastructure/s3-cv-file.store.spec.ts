import { CV_FILE_TYPES, cvFileKey } from '@linkvault/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  S3CvFileStore,
  type CvFileUploader,
} from './s3-cv-file.store';

// El almacén se prueba sobre su doble: lo que importa aquí es con qué clave y con qué `ContentType` sube, y que un
// error no filtre la clave al registro. La prueba contra el MinIO del compose es un paso local del RUNBOOK
// (ADR-028, "Pruebas"), porque un test de `api` no debe necesitar un contenedor.

const USER = '66e9a0000000000000000a01';
const CV = '66e9a0000000000000000c01';

class RecordingUploader implements CvFileUploader {
  readonly calls: { key: string; body: Uint8Array; contentType: string }[] = [];
  failure: Error | undefined;

  put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.calls.push({ key, body, contentType });
    return this.failure === undefined
      ? Promise.resolve()
      : Promise.reject(this.failure);
  }
}

describe('S3CvFileStore', () => {
  it('uploads with the key it was given and the mime of its type', async () => {
    const uploader = new RecordingUploader();
    const store = new S3CvFileStore(uploader);
    const body = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

    await store.put(cvFileKey(USER, CV), body, 'pdf');

    expect(uploader.calls).toEqual([
      {
        key: `${USER}/${CV}`,
        body,
        contentType: CV_FILE_TYPES.pdf.mimeType,
      },
    ]);
  });

  it('uses the DOCX mime for a DOCX', async () => {
    const uploader = new RecordingUploader();

    await new S3CvFileStore(uploader).put('k', new Uint8Array(), 'docx');

    expect(uploader.calls[0]?.contentType).toBe(CV_FILE_TYPES.docx.mimeType);
  });

  it('rethrows what the store could not do, so nothing gets saved', async () => {
    const uploader = new RecordingUploader();
    uploader.failure = new Error('Connection refused');

    await expect(
      new S3CvFileStore(uploader).put('k', new Uint8Array(), 'pdf'),
    ).rejects.toThrow('Connection refused');
  });

  it('logs the kind of failure and never the key nor the message', async () => {
    const uploader = new RecordingUploader();
    const key = cvFileKey(USER, CV);
    uploader.failure = Object.assign(
      new Error(`NoSuchBucket: the key ${key} could not be written`),
      { name: 'NoSuchBucket' },
    );
    const warnings: string[] = [];
    const store = new S3CvFileStore(uploader);
    const logger = (
      store as unknown as { logger: { warn: (message: string) => void } }
    ).logger;
    vi.spyOn(logger, 'warn').mockImplementation((message: string) => {
      warnings.push(message);
    });

    await expect(
      store.put(key, new Uint8Array(), 'pdf'),
    ).rejects.toThrow();

    expect(warnings).toEqual(['CV file not stored: NoSuchBucket']);
    expect(JSON.stringify(warnings)).not.toContain(USER);
    expect(JSON.stringify(warnings)).not.toContain(CV);
  });
});
