import { HttpEventType } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CvDocument } from '@linkvault/shared';
import { lastValueFrom, toArray } from 'rxjs';
import {
  apiError,
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { CvApi } from './cv.api';

const saved: CvDocument = {
  id: 'cv1',
  fileName: 'CV_backend.pdf',
  fileType: 'pdf',
  sizeBytes: 319_488,
  version: 1,
  isDefault: true,
  uploadedAt: '2026-09-12T10:00:00.000Z',
  extraction: { status: 'pending', textChars: 0 },
  matchAnalysesCount: 0,
};

function pdf(name = 'CV_backend.pdf'): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });
}

describe('CvApi', () => {
  let api: CvApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(CvApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  /** Toda petición de CV lleva el Bearer que pone el interceptor. */
  function expectRequest(method: string, url: string): ReturnType<HttpTestingController['expectOne']> {
    const request = http.expectOne(url);
    expect(request.request.method).toBe(method);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    return request;
  }

  it('lists the saved CVs', async () => {
    const result = api.list();

    expectRequest('GET', '/api/cv').flush({ items: [saved] });

    await expect(result).resolves.toEqual([saved]);
  });

  it('sends the file as a single multipart part called "file"', async () => {
    const result = lastValueFrom(api.upload(pdf()));

    const request = expectRequest('POST', '/api/cv');
    const body = request.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()]).toEqual(['file']);
    expect((body.get('file') as File).name).toBe('CV_backend.pdf');
    // El `Content-Type` lo compone el navegador con su `boundary`; ponerlo a mano rompería el parser.
    expect(request.request.headers.has('Content-Type')).toBe(false);
    expect(request.request.reportProgress).toBe(true);
    request.flush(saved);

    await expect(result).resolves.toEqual({ kind: 'uploaded', document: saved });
  });

  it('reports the upload progress and ends with the saved CV', async () => {
    const events = lastValueFrom(api.upload(pdf()).pipe(toArray()));

    const request = expectRequest('POST', '/api/cv');
    request.event({ type: HttpEventType.UploadProgress, loaded: 512, total: 2048 });
    request.event({ type: HttpEventType.UploadProgress, loaded: 2048, total: 2048 });
    request.flush(saved);

    await expect(events).resolves.toEqual([
      { kind: 'progress', percent: 25 },
      { kind: 'progress', percent: 100 },
      { kind: 'uploaded', document: saved },
    ]);
  });

  it('reports a null percentage when the browser does not know the total', async () => {
    const events = lastValueFrom(api.upload(pdf()).pipe(toArray()));

    const request = expectRequest('POST', '/api/cv');
    request.event({ type: HttpEventType.UploadProgress, loaded: 512 });
    request.flush(saved);

    await expect(events).resolves.toEqual([
      { kind: 'progress', percent: null },
      { kind: 'uploaded', document: saved },
    ]);
  });

  it.each([
    ['file_too_large', 413],
    ['unsupported_file_type', 415],
    ['too_many_cvs', 409],
  ])('propagates %s as an error with its status', async (code, status) => {
    const result = lastValueFrom(api.upload(pdf()));

    const { body, options } = apiError(code, status);
    expectRequest('POST', '/api/cv').flush(body, options);

    await expect(result).rejects.toMatchObject({ status, error: { code } });
  });

  it('propagates the rate limit with its Retry-After', async () => {
    const result = lastValueFrom(api.upload(pdf()));

    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '900' });
    expectRequest('POST', '/api/cv').flush(body, options);

    await expect(result).rejects.toMatchObject({ status: 429 });
  });

  it('marks a CV as the default one and answers with the updated list', async () => {
    const result = api.setDefault('cv 2');

    const request = expectRequest('PUT', '/api/cv/cv%202/default');
    expect(request.request.body).toBeNull();
    request.flush({ items: [saved] });

    await expect(result).resolves.toEqual([saved]);
  });

  it('deletes a CV and answers with the updated list', async () => {
    const result = api.remove('cv2');

    expectRequest('DELETE', '/api/cv/cv2').flush({ items: [saved] });

    await expect(result).resolves.toEqual([saved]);
  });

  it('asks for the text preview of a CV', async () => {
    const result = api.textPreview('cv1');

    expectRequest('GET', '/api/cv/cv1/text-preview').flush({
      status: 'extracted',
      text: 'Ana Pérez',
      chars: 9,
      complete: true,
    });

    await expect(result).resolves.toEqual({
      status: 'extracted',
      text: 'Ana Pérez',
      chars: 9,
      complete: true,
    });
  });

  it('never offers a way to download the file', () => {
    const methods = Object.getOwnPropertyNames(CvApi.prototype).filter(
      (name) => name !== 'constructor',
    );

    expect(methods.sort()).toEqual(['list', 'remove', 'setDefault', 'textPreview', 'upload']);
  });
});
