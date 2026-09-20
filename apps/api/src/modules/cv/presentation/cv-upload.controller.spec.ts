import { CV_FILE_TYPES, CV_MAX_FILE_BYTES } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCvTestApp,
  docxBytes,
  pdfBytes,
  type CvTestApp,
  type TestPerson,
} from '../../../test-support/cv-test-app';
import { UnsupportedCvFile } from '../domain/errors';
import { readCvPart, type MultipartRequest } from './cv.controller';

// `POST /api/cv` por HTTP (tarea 6.5): la puerta del tipo, decidida con el primer trozo, y los errores del parser de
// multipart, **ninguno de los cuales puede acabar en 500**.

let http: CvTestApp;
let ana: TestPerson;

beforeAll(async () => {
  http = await createCvTestApp('cv-upload', getMongoTestUri());
  ana = await http.authenticated();
}, 60_000);

afterAll(async () => {
  await http.close();
});

describe('POST /api/cv', () => {
  it('Primera subida', async () => {
    const person = await http.authenticated();

    const response = await http.upload(person, {
      fileName: 'CV_backend.pdf',
      content: pdfBytes(312),
      contentType: CV_FILE_TYPES.pdf.mimeType,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      fileName: 'CV_backend.pdf',
      fileType: 'pdf',
      sizeBytes: 312,
      version: 1,
      isDefault: true,
      extraction: { status: 'pending', textChars: 0 },
    });
    const { id } = response.json<{ id: string }>();
    expect(http.files.putKeys).toContain(`${person.userId}/${id}`);
  });

  it('Petición sin archivo', async () => {
    const response = await http.upload(ana, [], { note: 'hola' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_error',
      fields: ['file'],
    });
  });

  it('Dos archivos', async () => {
    const before = http.files.putKeys.length;

    const response = await http.upload(ana, [
      { fileName: 'a.pdf', content: pdfBytes() },
      { fileName: 'b.pdf', content: pdfBytes() },
    ]);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_error',
      fields: ['file'],
    });
    expect(http.files.putKeys).toHaveLength(before);
  });

  it('Un campo de más en el formulario', async () => {
    const response = await http.upload(
      ana,
      { fileName: 'CV.pdf', content: pdfBytes() },
      { note: 'un campo oculto de más' },
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'validation_error',
      fields: ['file'],
    });
  });

  it('Cuerpo que no es multipart', async () => {
    const response = await http.request('POST', '/api/cv', {
      authorization: ana.authorization,
      body: { url: 'https://example.com' },
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_media_type' });
    expect(response.json<{ message: string }>().message).not.toMatch(/json/i);
  });

  it('Ejecutable renombrado', async () => {
    const before = http.files.putKeys.length;

    const response = await http.upload(ana, {
      fileName: 'CV.pdf',
      content: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
      contentType: CV_FILE_TYPES.pdf.mimeType,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_file_type' });
    expect(http.files.putKeys).toHaveLength(before);
  });

  it('El archivo inválido no se acumula, y la respuesta llega igual', async () => {
    // 5 MiB de algo que no es PDF ni DOCX: el primer trozo basta para saberlo, y el resto se drena y se tira. Que la
    // respuesta llegue se comprueba aquí; **cuánto se acumula**, en `lo que la subida se queda en memoria`, que mide
    // los bytes que el bucle retiene.
    const junk = new Uint8Array(CV_MAX_FILE_BYTES);
    junk.set(new TextEncoder().encode('NOPE'), 0);

    const response = await http.upload(ana, {
      fileName: 'CV.pdf',
      content: junk,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_file_type' });
  });

  it('Extensión que no corresponde', async () => {
    const response = await http.upload(ana, {
      fileName: 'CV.docx',
      content: pdfBytes(),
      contentType: CV_FILE_TYPES.docx.mimeType,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_file_type' });
  });

  it('PDF enviado como octet-stream', async () => {
    const person = await http.authenticated();

    const response = await http.upload(person, {
      fileName: 'CV.pdf',
      content: pdfBytes(),
      contentType: 'application/octet-stream',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ fileType: 'pdf' });
  });

  it('DOCX sin Content-Type útil', async () => {
    const person = await http.authenticated();

    const response = await http.upload(person, {
      fileName: 'CV.docx',
      content: docxBytes(),
      contentType: undefined,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ fileType: 'docx' });
  });

  it('Content-Type que contradice', async () => {
    const response = await http.upload(ana, {
      fileName: 'CV.pdf',
      content: pdfBytes(),
      contentType: 'image/png',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_file_type' });
  });

  it('PDF con basura por delante', async () => {
    const person = await http.authenticated();
    const withJunk = new Uint8Array(512);
    withJunk.set(new TextEncoder().encode('x'.repeat(300)), 0);
    withJunk.set(new TextEncoder().encode('%PDF-1.4'), 300);

    const response = await http.upload(person, {
      fileName: 'CV.pdf',
      content: withJunk,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ fileType: 'pdf' });
  });

  it('Tipo declarado que no admitimos', async () => {
    const response = await http.upload(ana, {
      fileName: 'CV.odt',
      content: docxBytes(),
      contentType: 'application/vnd.oasis.opendocument.text',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'unsupported_file_type' });
  });

  it('Nombre de archivo con ruta y caracteres raros', async () => {
    const person = await http.authenticated();

    const response = await http.upload(person, {
      fileName: '../../etc/CVa;b.pdf',
      content: pdfBytes(),
    });

    expect(response.statusCode).toBe(201);
    const saved = response.json<{ id: string; fileName: string }>();
    expect(saved.fileName).toBe('CVab.pdf');
    expect(saved.fileName).not.toContain('/');
    expect(http.files.putKeys.at(-1)).toBe(
      `${person.userId}/${saved.id}`,
    );
    expect(http.files.putKeys.at(-1)).not.toContain('CV');
  });

  it('Sin sesión no hay nada', async () => {
    const response = await http.request('GET', '/api/cv');

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthorized' });
  });

  it('never answers 500 to any of the gate branches', async () => {
    const responses = await Promise.all([
      http.upload(ana, []),
      http.upload(ana, { fileName: 'CV.pdf', content: new Uint8Array() }),
      http.upload(ana, { fileName: 'noextension', content: pdfBytes() }),
      http.request('POST', '/api/cv', {
        authorization: ana.authorization,
        body: {},
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).not.toBe(500);
    }
  });
});

// Cuánto se queda el controlador de un envío que no vale. El `415` se comprueba por HTTP ahí arriba; aquí se llama a
// `readCvPart` con una parte de mentira, que es lo único que permite **medir** lo retenido en vez de suponerlo.

const CHUNK_BYTES = 64 * 1024;

/**
 * Trozo que avisa cuando lo acumulan.
 *
 * El bucle de `readCvPart` hace exactamente dos cosas con un trozo que se queda: meterlo en la lista y sumar su
 * `byteLength`. La puerta del tipo (`resolveCvFileType`) mira `length` y los índices, nunca `byteLength`, así que
 * **leer `byteLength` es, en ese bucle, quedarse el trozo**: contar esas lecturas mide los bytes retenidos, no los
 * enviados.
 */
class RetentionMeter {
  /** Trozos que el controlador llegó a acumular. */
  chunks = 0;
  /** Bytes acumulados, sumados como los suma el bucle. */
  bytes = 0;

  watch(chunk: Uint8Array): Uint8Array {
    return new Proxy(chunk, {
      get: (target, property): unknown => {
        if (property === 'byteLength') {
          this.chunks += 1;
          this.bytes += target.byteLength;
        }
        // Con el propio `target` como receptor: un `Uint8Array` lee sus índices por ranuras internas, y el proxy no
        // las tiene.
        return Reflect.get(target, property, target) as unknown;
      },
    });
  }
}

/** El contenido partido en trozos de 64 KiB, como llega un cuerpo multipart de verdad, y todos vigilados. */
function watchedChunks(
  content: Uint8Array,
  meter: RetentionMeter,
): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < content.byteLength; offset += CHUNK_BYTES) {
    chunks.push(meter.watch(content.subarray(offset, offset + CHUNK_BYTES)));
  }
  return chunks;
}

/** Trozos que el controlador llegó a leer del cuerpo, retenidos o no. */
interface Delivery {
  count: number;
}

/** Petición con una sola parte de archivo, que entrega esos trozos y nada más. */
function requestOf(
  fileName: string,
  chunks: readonly Uint8Array[],
  delivery: Delivery = { count: 0 },
): MultipartRequest {
  async function* stream(): AsyncGenerator<Uint8Array> {
    for (const chunk of chunks) {
      delivery.count += 1;
      yield chunk;
    }
  }
  return {
    file: () => Promise.resolve({ filename: fileName, file: stream() }),
  };
}

describe('what the upload keeps in memory', () => {
  it('El archivo inválido no se acumula: retiene como mucho el primer trozo, no los 5 MiB del envío', async () => {
    const meter = new RetentionMeter();
    const delivery: Delivery = { count: 0 };
    const junk = new Uint8Array(CV_MAX_FILE_BYTES);
    junk.set(new TextEncoder().encode('NOPE'), 0);
    const sent = watchedChunks(junk, meter);

    await expect(
      readCvPart(requestOf('CV.pdf', sent, delivery)),
    ).rejects.toBeInstanceOf(UnsupportedCvFile);

    // El envío llega en muchos trozos y el controlador los lee todos —hay que drenar el cuerpo para que el `415` le
    // llegue a quien subió—, pero deja de quedárselos en cuanto el primero descalifica el archivo.
    expect(sent.length).toBeGreaterThan(64);
    expect(delivery.count).toBe(sent.length);
    expect(meter.chunks).toBeLessThanOrEqual(1);
    expect(meter.bytes).toBeLessThanOrEqual(CHUNK_BYTES);
  });

  it('measures what it claims: the same 5 MiB, in a valid PDF, are kept whole', async () => {
    // El control del instrumento. Sin él, cambiar `chunk.byteLength` por `chunk.length` en el bucle dejaría el medidor
    // a cero y el test de arriba pasaría sin medir nada.
    const meter = new RetentionMeter();
    const sent = watchedChunks(pdfBytes(CV_MAX_FILE_BYTES), meter);

    const accepted = await readCvPart(requestOf('CV.pdf', sent));

    expect(accepted.bytes.byteLength).toBe(CV_MAX_FILE_BYTES);
    expect(meter.chunks).toBeGreaterThanOrEqual(sent.length);
    // `>=` y no `===` porque el juntado final vuelve a recorrer los trozos retenidos: lo que importa es que los 5 MiB
    // se acumularon, no cuántas veces se miró la lista.
    expect(meter.bytes).toBeGreaterThanOrEqual(CV_MAX_FILE_BYTES);
  });
});
