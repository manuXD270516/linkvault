import { Writable } from 'node:stream';
import { CV_FILE_TYPES } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCvTestApp,
  pdfBytes,
  type CvTestApp,
  type TestPerson,
} from '../../../test-support/cv-test-app';

// Nada del CV en los registros (D10, ADR-028 §10, spec `cv/documents`), capturado a nivel `debug`.
//
// La redacción de pino tapa **rutas declaradas**, no adivina: lo que garantiza que el nombre del archivo y su texto no
// se escapen es que **nadie los escriba**. Este test es lo que lo comprueba, y el día que alguien registre un
// `fileName` "para depurar", falla aquí.

const FILE_NAME = 'CV_Ana_Perez.pdf';
const CV_TEXT = 'Ana Perez, ingeniera inventada, telefono 700 inventado';

let lines: string[];
let http: CvTestApp;
let ana: TestPerson;

const capture = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    lines.push(chunk.toString('utf8'));
    callback();
  },
});

beforeAll(async () => {
  lines = [];
  http = await createCvTestApp('cv-logging', getMongoTestUri(), {
    logDestination: capture,
  });
  ana = await http.authenticated();
}, 60_000);

afterAll(async () => {
  await http.close();
});

function logged(): string {
  return lines.join('');
}

describe('a CV upload leaves no trace of the file', () => {
  it('Una subida no deja rastro del archivo', async () => {
    const before = logged().length;

    const response = await http.upload(ana, {
      fileName: FILE_NAME,
      content: pdfBytes(),
      contentType: CV_FILE_TYPES.pdf.mimeType,
    });
    expect(response.statusCode).toBe(201);
    const { id } = response.json<{ id: string }>();
    await http.withExtractedText(id, CV_TEXT);
    await http.preview(ana, id);

    const written = logged().slice(before);
    expect(written).not.toContain(FILE_NAME);
    expect(written).not.toContain('Ana_Perez');
    for (const word of CV_TEXT.split(' ')) {
      if (word.length > 4) {
        expect(written).not.toContain(word);
      }
    }
    // La clave del objeto lleva el identificador de la persona dentro: tampoco se escribe.
    expect(written).not.toContain(`${ana.userId}/${id}`);
  });

  it('Un fallo del almacén no filtra la clave', async () => {
    const before = logged().length;
    const message = `NoSuchBucket: could not write ${ana.userId}/whatever`;
    http.files.failure = Object.assign(new Error(message), {
      name: 'NoSuchBucket',
    });
    try {
      const response = await http.upload(ana, {
        fileName: FILE_NAME,
        content: pdfBytes(),
        contentType: CV_FILE_TYPES.pdf.mimeType,
      });

      expect(response.statusCode).toBe(500);
    } finally {
      http.files.failure = undefined;
    }

    const written = logged().slice(before);
    expect(written).toContain('NoSuchBucket');
    expect(written).not.toContain(message);
    expect(written).not.toContain(FILE_NAME);
    expect(written).not.toContain('could not write');
  });
});
