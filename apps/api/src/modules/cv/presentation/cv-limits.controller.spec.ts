import { CV_FILE_TYPES, CV_MAX_FILE_BYTES } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AttemptOutcome,
  FixedWindowCounter,
} from '../../../infrastructure/limits/fixed-window-counter';
import { InMemoryFixedWindowCounter } from '../../../infrastructure/limits/testing/in-memory-fixed-window-counter';
import {
  createCvTestApp,
  pdfBytes,
  type CvTestApp,
} from '../../../test-support/cv-test-app';
import {
  CV_REJECTS_PER_USER,
  CV_UPLOADS_PER_USER,
} from '../domain/limits';

// `POST /api/cv`, tamaño, tope de CV guardados y las **tres** claves del contador (tarea 6.6). Es donde se comprueba
// que un rechazo no gasta una subida, que un `413` sí cuenta como rechazo y que nada de esto llega al almacén.

/** Contador que no responde nunca: las tres claves fallan **abiertas**. */
class DeadCounter implements FixedWindowCounter {
  consume(): Promise<AttemptOutcome | null> {
    return Promise.resolve(null);
  }

  reset(): Promise<boolean> {
    return Promise.resolve(false);
  }

  giveBack(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

let http: CvTestApp;

beforeAll(async () => {
  http = await createCvTestApp('cv-limits', getMongoTestUri());
}, 60_000);

afterAll(async () => {
  await http.close();
});

function hugePdf(bytes: number): Uint8Array {
  const content = new Uint8Array(bytes);
  content.set(new TextEncoder().encode('%PDF-1.7\n'), 0);
  return content;
}

describe('the size of the file', () => {
  it('Archivo de 6 MB', async () => {
    const ana = await http.authenticated();
    const before = http.files.putKeys.length;

    const response = await http.upload(ana, {
      fileName: 'CV.pdf',
      content: hugePdf(6 * 1024 * 1024),
      contentType: CV_FILE_TYPES.pdf.mimeType,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ code: 'file_too_large' });
    expect(http.files.putKeys).toHaveLength(before);
  });

  it('Archivo justo en el límite', async () => {
    const ana = await http.authenticated();

    const response = await http.upload(ana, {
      fileName: 'CV.pdf',
      content: hugePdf(CV_MAX_FILE_BYTES),
      contentType: CV_FILE_TYPES.pdf.mimeType,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ sizeBytes: CV_MAX_FILE_BYTES });
  });

  it('Archivo enorme: se corta al superar el límite y no llega al almacén', async () => {
    const ana = await http.authenticated();
    const before = http.files.putKeys.length;

    const response = await http.upload(ana, {
      fileName: 'CV.pdf',
      content: hugePdf(12 * 1024 * 1024),
      contentType: CV_FILE_TYPES.pdf.mimeType,
    });

    expect(response.statusCode).toBe(413);
    expect(http.files.putKeys).toHaveLength(before);
  });
});

describe('the cap of stored CVs', () => {
  it('Sexto CV', async () => {
    const ana = await http.authenticated();
    for (let i = 0; i < 5; i += 1) {
      await http.uploadPdf(ana);
    }

    const response = await http.upload(ana, {
      fileName: 'CV.pdf',
      content: pdfBytes(),
      contentType: CV_FILE_TYPES.pdf.mimeType,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'too_many_cvs' });
    await expect(http.list(ana)).resolves.toHaveLength(5);
  });
});

describe('the object store failing', () => {
  it('El almacén no responde al subir', async () => {
    const ana = await http.authenticated();
    http.files.failure = new Error('Connection refused');
    try {
      const response = await http.upload(ana, {
        fileName: 'CV.pdf',
        content: pdfBytes(),
        contentType: CV_FILE_TYPES.pdf.mimeType,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ code: 'internal_error' });
      await expect(http.list(ana)).resolves.toEqual([]);
      await expect(
        http.connection
          .collection('outbox_events')
          .countDocuments({ 'payload.userId': ana.userId }),
      ).resolves.toBe(0);
    } finally {
      http.files.failure = undefined;
    }
    // El intento se devolvió: la siguiente subida válida se acepta.
    await expect(http.uploadPdf(ana)).resolves.toMatchObject({ version: 1 });
  });
});

describe('the three counters', () => {
  it('Once subidas, con borrados intercalados', async () => {
    const own = await createCvTestApp('cv-uploads-window', getMongoTestUri());
    try {
      const ana = await own.authenticated();
      for (let i = 0; i < CV_UPLOADS_PER_USER; i += 1) {
        const saved = await own.uploadPdf(ana);
        // Sin borrar, se chocaría antes con el máximo de 5 y nunca se llegaría al contador.
        await own.request('DELETE', `/api/cv/${saved.id}`, {
          authorization: ana.authorization,
        });
      }

      const eleventh = await own.upload(ana, {
        fileName: 'CV.pdf',
        content: pdfBytes(),
        contentType: CV_FILE_TYPES.pdf.mimeType,
      });

      expect(eleventh.statusCode).toBe(429);
      expect(eleventh.json()).toMatchObject({ code: 'too_many_attempts' });
      expect(eleventh.headers['retry-after']).toMatch(/^\d+$/);
    } finally {
      await own.close();
    }
  }, 60_000);

  it('Ráfaga de archivos inválidos', async () => {
    const own = await createCvTestApp('cv-rejects-window', getMongoTestUri());
    try {
      const ana = await own.authenticated();
      const junk = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);
      for (let i = 0; i < CV_REJECTS_PER_USER; i += 1) {
        const rejected = await own.upload(ana, {
          fileName: 'CV.pdf',
          content: junk,
        });
        expect(rejected.statusCode).toBe(415);
      }

      const last = await own.upload(ana, { fileName: 'CV.pdf', content: junk });

      expect(last.statusCode).toBe(429);
      expect(last.headers['retry-after']).toMatch(/^\d+$/);
      // Los rechazos no gastan subidas: el PDF válido entra.
      await expect(own.uploadPdf(ana)).resolves.toMatchObject({ version: 1 });
    } finally {
      await own.close();
    }
  }, 60_000);

  it('Ráfaga de archivos enormes', async () => {
    const own = await createCvTestApp('cv-huge-window', getMongoTestUri());
    try {
      const ana = await own.authenticated();
      const huge = hugePdf(6 * 1024 * 1024);
      for (let i = 0; i < CV_REJECTS_PER_USER; i += 1) {
        const rejected = await own.upload(ana, {
          fileName: 'CV.pdf',
          content: huge,
          contentType: CV_FILE_TYPES.pdf.mimeType,
        });
        expect(rejected.statusCode).toBe(413);
      }

      const last = await own.upload(ana, {
        fileName: 'CV.pdf',
        content: huge,
        contentType: CV_FILE_TYPES.pdf.mimeType,
      });

      expect(last.statusCode).toBe(429);
    } finally {
      await own.close();
    }
  }, 120_000);

  it('Un tope de versiones alcanzado no gasta intento', async () => {
    const counter = new InMemoryFixedWindowCounter();
    const own = await createCvTestApp('cv-cap-refund', getMongoTestUri(), {
      counter,
    });
    try {
      const ana = await own.authenticated();
      for (let i = 0; i < 5; i += 1) {
        await own.uploadPdf(ana);
      }
      const key = `cv:upload:${ana.userId}`;
      await counter.reset(key);

      const sixth = await own.upload(ana, {
        fileName: 'CV.pdf',
        content: pdfBytes(),
        contentType: CV_FILE_TYPES.pdf.mimeType,
      });

      expect(sixth.statusCode).toBe(409);
      // Consumido y devuelto: el contador vuelve a cero, así que la clave ni siquiera queda viva.
      await expect(
        counter.consume(key, { limit: 1, windowMs: 1000 }),
      ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    } finally {
      await own.close();
    }
  }, 60_000);

  it('Contador caído: la subida y la lista siguen', async () => {
    const own = await createCvTestApp('cv-dead-counter', getMongoTestUri(), {
      counter: new DeadCounter(),
    });
    try {
      const ana = await own.authenticated();

      const saved = await own.uploadPdf(ana);

      const preview = await own.preview(ana, saved.id);
      expect(preview.statusCode).toBe(200);
    } finally {
      await own.close();
    }
  }, 60_000);
});
