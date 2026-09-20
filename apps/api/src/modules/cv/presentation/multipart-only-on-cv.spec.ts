import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CV_MULTIPART_LIMITS } from '../../../app/create-app';
import {
  createCvTestApp,
  pdfBytes,
  type CvTestApp,
  type TestPerson,
} from '../../../test-support/cv-test-app';

// Registrar `@fastify/multipart` es **global** (tarea 6.3), así que hay que decir qué pasa con el resto de rutas: el
// plugin solo actúa con `multipart/form-data`, y cualquier otra ruta que reciba uno sigue fallando en su pipe de zod,
// porque su cuerpo no será el objeto que espera. **Solo `POST /api/cv` lee partes.**

let http: CvTestApp;
let ana: TestPerson;

beforeAll(async () => {
  http = await createCvTestApp('cv-multipart-scope', getMongoTestUri());
  ana = await http.authenticated();
}, 60_000);

afterAll(async () => {
  await http.close();
});

describe('the multipart plugin', () => {
  it('declares the limits of D2, with their slack explained', () => {
    expect(CV_MULTIPART_LIMITS).toEqual({
      fileSize: 5 * 1024 * 1024,
      files: 1,
      fields: 0,
      parts: 2,
    });
  });

  it('Multipart en otra ruta: POST /api/links answers 400 and saves nothing', async () => {
    const before = await http.connection
      .collection('job_links')
      .countDocuments({});

    const response = await http.app.inject({
      method: 'POST',
      url: '/api/links',
      headers: {
        authorization: ana.authorization,
        'content-type': 'multipart/form-data; boundary=----probe',
      },
      payload: [
        '------probe',
        'Content-Disposition: form-data; name="url"',
        '',
        'https://www.getonbrd.com/jobs/1',
        '------probe--',
        '',
      ].join('\r\n'),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_error' });
    await expect(
      http.connection.collection('job_links').countDocuments({}),
    ).resolves.toBe(before);
  });

  it('keeps the JSON routes exactly as they were', async () => {
    const response = await http.request('GET', '/api/cv', {
      authorization: ana.authorization,
    });
    const badJson = await http.app.inject({
      method: 'POST',
      url: '/api/links',
      headers: {
        authorization: ana.authorization,
        'content-type': 'application/json',
      },
      payload: '{ not json',
    });

    expect(response.statusCode).toBe(200);
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json()).toMatchObject({ code: 'validation_error' });
  });

  it('starts the app and serves the CV upload', async () => {
    const person = await http.authenticated();

    const response = await http.upload(person, {
      fileName: 'CV.pdf',
      content: pdfBytes(),
    });

    expect(response.statusCode).toBe(201);
  });
});
