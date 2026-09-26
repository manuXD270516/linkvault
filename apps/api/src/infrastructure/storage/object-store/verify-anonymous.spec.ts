import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createS3Client } from '../s3-client.factory';
import { ObjectStoreReport } from './object-store-report';
import { sendOf } from './s3-send';
import {
  classifyAnonymousResponse,
  PROBE_PREFIX,
  verifyAnonymousAccess,
} from './verify-anonymous';

// `object-store verify`, acceso anónimo, contra un servidor HTTP en proceso que responde el estado y el cuerpo
// elegidos (tarea 2.5 de `object-store`, design D4, spec `platform/object-store`, «Sin acceso anónimo al almacén»).
// Las peticiones firmadas (la muestra del objeto y, si hace falta, el borrado de la sonda) las hace el cliente real de
// la fábrica contra el mismo servidor, que registra cada petición y si iba firmada.

type Kind = 'get' | 'list' | 'put';

interface Answer {
  readonly status: number;
  readonly body?: string | Uint8Array;
}

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly signed: boolean;
}

const BUCKET = 'cvs';
const PROBE_ID = 'probe-0001';
const PROBE_KEY = `${PROBE_PREFIX}${PROBE_ID}`;
const OBJECT_KEY = '66e9a0000000000000000a01/66e9a0000000000000000c01';

function s3ErrorXml(code: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>fake</Message><Resource>/${BUCKET}</Resource></Error>`;
}

class FakeStoreServer {
  readonly requests: Recorded[] = [];
  /** Objeto del bucket, si lo hay: lo leen con firma el listado y el `GET` de la muestra. */
  object: { key: string; bytes: Uint8Array } | undefined;
  answer: (kind: Kind) => Answer = () => ({
    status: 403,
    body: s3ErrorXml('AccessDenied'),
  });
  private server: Server | undefined;
  port = 0;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req).then(({ status, body, headers }) => {
        res.writeHead(status, headers);
        res.end(body);
      });
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('unexpected address');
    }
    this.port = address.port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.closeAllConnections();
      this.server?.close(() => resolve());
    });
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  signedWrites(): Recorded[] {
    return this.requests.filter(
      (r) => r.signed && r.method !== 'GET' && r.method !== 'HEAD',
    );
  }

  private async handle(
    req: IncomingMessage,
  ): Promise<{
    status: number;
    body: string | Uint8Array;
    headers: Record<string, string>;
  }> {
    for await (const chunk of req) {
      void chunk;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const signed = typeof req.headers.authorization === 'string';
    const method = req.method ?? 'GET';
    this.requests.push({
      method,
      path: decodeURIComponent(url.pathname),
      query: url.search,
      signed,
    });
    const xml = { 'content-type': 'application/xml' };
    const objectPath = url.pathname.slice(`/${BUCKET}/`.length);

    if (signed) {
      if (method === 'GET' && url.searchParams.get('list-type') === '2') {
        const contents =
          this.object === undefined
            ? ''
            : `<Contents><Key>${this.object.key}</Key><LastModified>2026-09-01T00:00:00.000Z</LastModified><Size>${this.object.bytes.length}</Size></Contents>`;
        return {
          status: 200,
          headers: xml,
          body: `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${BUCKET}</Name><KeyCount>${this.object === undefined ? 0 : 1}</KeyCount><MaxKeys>1</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
        };
      }
      if (method === 'GET' && this.object !== undefined) {
        const bytes = this.object.bytes.subarray(0, 64);
        return {
          status: 206,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(bytes.length),
            'content-range': `bytes 0-${bytes.length - 1}/${this.object.bytes.length}`,
          },
          body: bytes,
        };
      }
      if (method === 'DELETE') {
        return { status: 204, headers: {}, body: '' };
      }
      return { status: 501, headers: xml, body: s3ErrorXml('NotImplemented') };
    }

    const kind: Kind =
      method === 'PUT'
        ? 'put'
        : objectPath === '' || url.pathname === `/${BUCKET}`
          ? 'list'
          : 'get';
    const answer = this.answer(kind);
    return { status: answer.status, headers: xml, body: answer.body ?? '' };
  }
}

describe('verifyAnonymousAccess', () => {
  let store: FakeStoreServer;

  beforeEach(async () => {
    store = new FakeStoreServer();
    await store.start();
  });

  afterEach(async () => {
    await store.stop();
  });

  async function verify(): Promise<ObjectStoreReport> {
    const client = createS3Client(
      {
        endpoint: store.endpoint,
        region: 'us-east-1',
        accessKey: 'verify-test',
        secretKey: 'verify-test-secret',
      },
      {
        env: {},
        timeouts: { connectionTimeoutMs: 2_000, requestTimeoutMs: 5_000 },
      },
    );
    const report = new ObjectStoreReport();
    try {
      await verifyAnonymousAccess(
        {
          endpoint: store.endpoint,
          send: sendOf(client),
          randomId: () => PROBE_ID,
          timeoutMs: 5_000,
        },
        [BUCKET],
        report,
      );
    } finally {
      client.destroy();
    }
    return report;
  }

  function unsigned(): Recorded[] {
    return store.requests.filter((r) => !r.signed);
  }

  it('passes when every unsigned request gets a 403, and writes nothing signed', async () => {
    const report = await verify();

    expect(report.failures).toEqual([]);
    expect(unsigned().map((r) => r.method)).toEqual(['GET', 'GET', 'PUT']);
    expect(store.signedWrites()).toEqual([]);
    expect(report.render('verify')).toContain(
      'ok    cvs: anonymous GET of a missing object rejected (HTTP 403 AccessDenied)',
    );
  });

  it('passes when every unsigned request gets a 400 MissingSecurityHeader', async () => {
    store.answer = () => ({
      status: 400,
      body: s3ErrorXml('MissingSecurityHeader'),
    });

    const report = await verify();

    expect(report.failures).toEqual([]);
    expect(store.signedWrites()).toEqual([]);
  });

  it('passes on a 401 without body', async () => {
    store.answer = () => ({ status: 401 });

    const report = await verify();

    expect(report.failures).toEqual([]);
  });

  it('fails on a 400 with InvalidRequest, naming bucket and code', async () => {
    store.answer = (kind) =>
      kind === 'list'
        ? { status: 400, body: s3ErrorXml('InvalidRequest') }
        : { status: 403, body: s3ErrorXml('AccessDenied') };

    const report = await verify();

    expect(report.failures).toEqual([
      'cvs: anonymous listing: HTTP 400 InvalidRequest is not an authentication error',
    ]);
  });

  it('fails on an authentication 400 whose body carries the object bytes', async () => {
    const bytes = randomBytes(1024);
    store.object = { key: OBJECT_KEY, bytes };
    store.answer = (kind) =>
      kind === 'get'
        ? {
            status: 400,
            body: Buffer.concat([
              Buffer.from('<Error><Code>AccessDenied</Code><Data>'),
              bytes,
              Buffer.from('</Data></Error>'),
            ]),
          }
        : { status: 403, body: s3ErrorXml('AccessDenied') };

    const report = await verify();

    expect(report.failures).toEqual([
      'cvs: anonymous GET of an existing object: HTTP 400 AccessDenied, but the body carries object data',
    ]);
    // La clave del objeto (con el identificador de la persona) no sale en la salida.
    expect(report.render('verify')).not.toContain(OBJECT_KEY);
    // El GET anónimo fue a ese objeto.
    expect(unsigned()[0]?.path).toBe(`/${BUCKET}/${OBJECT_KEY}`);
  });

  it('fails when an anonymous GET gets a 200, naming the bucket', async () => {
    store.answer = (kind) =>
      kind === 'get'
        ? { status: 200, body: 'hello' }
        : { status: 403, body: s3ErrorXml('AccessDenied') };

    const report = await verify();

    expect(report.failures).toEqual([
      'cvs: anonymous GET of a missing object: access granted (HTTP 200)',
    ]);
  });

  it('fails when an anonymous GET gets a 404', async () => {
    store.answer = (kind) =>
      kind === 'get'
        ? { status: 404, body: s3ErrorXml('NoSuchKey') }
        : { status: 403, body: s3ErrorXml('AccessDenied') };

    const report = await verify();

    expect(report.failures).toEqual([
      'cvs: anonymous GET of a missing object: HTTP 404 NoSuchKey: the store let the anonymous request look for it',
    ]);
  });

  it('fails when an anonymous listing is rejected but still lists keys', async () => {
    store.answer = (kind) =>
      kind === 'list'
        ? {
            status: 403,
            body: '<Error><Code>AccessDenied</Code></Error><Contents><Key>a</Key></Contents>',
          }
        : { status: 403, body: s3ErrorXml('AccessDenied') };

    const report = await verify();

    expect(report.failures).toEqual([
      'cvs: anonymous listing: HTTP 403 AccessDenied, but the body carries object data',
    ]);
  });

  it('fails when an anonymous PUT is accepted, deletes the probe with a signed request and says so', async () => {
    store.answer = (kind) =>
      kind === 'put'
        ? { status: 200 }
        : { status: 403, body: s3ErrorXml('AccessDenied') };

    const report = await verify();

    expect(report.failures).toEqual([
      'cvs: anonymous PUT: access granted (HTTP 200)',
    ]);
    expect(store.signedWrites()).toEqual([
      {
        method: 'DELETE',
        path: `/${BUCKET}/${PROBE_KEY}`,
        query: expect.any(String),
        signed: true,
      },
    ]);
    expect(report.render('verify')).toContain(
      `note  cvs: the anonymous probe object ${PROBE_KEY} was deleted with a signed request`,
    );
    const put = unsigned().find((r) => r.method === 'PUT');
    expect(put?.path).toBe(`/${BUCKET}/${PROBE_KEY}`);
  });

  it('does not delete anything when the PUT is refused with a non-authentication error', async () => {
    store.answer = (kind) =>
      kind === 'put'
        ? { status: 400, body: s3ErrorXml('InvalidRequest') }
        : { status: 403, body: s3ErrorXml('AccessDenied') };

    const report = await verify();

    expect(report.failures).toEqual([
      'cvs: anonymous PUT: HTTP 400 InvalidRequest is not an authentication error',
    ]);
    expect(store.signedWrites()).toEqual([]);
  });

  it('fails naming the bucket when the store cannot be reached', async () => {
    const report = new ObjectStoreReport();
    await verifyAnonymousAccess(
      {
        endpoint: store.endpoint,
        send: () => Promise.resolve({ Contents: [] }),
        fetch: () =>
          Promise.reject(
            Object.assign(new Error('refused'), { name: 'TypeError' }),
          ),
        randomId: () => PROBE_ID,
      },
      [BUCKET],
      report,
    );

    expect(report.failures).toEqual([
      'cvs: anonymous GET of a missing object: request failed (TypeError)',
      'cvs: anonymous listing: request failed (TypeError)',
      'cvs: anonymous PUT: request failed (TypeError)',
    ]);
  });
});

describe('classifyAnonymousResponse', () => {
  const body = (text: string): Uint8Array => Buffer.from(text);

  it.each([
    'AccessDenied',
    'MissingSecurityHeader',
    'AuthorizationHeaderMalformed',
    'InvalidAccessKeyId',
    'SignatureDoesNotMatch',
  ])('counts a 400 %s as a rejection', (code) => {
    expect(
      classifyAnonymousResponse({ status: 400, body: body(s3ErrorXml(code)) })
        .rejected,
    ).toBe(true);
  });

  it.each([
    [400, 'InvalidRequest'],
    [400, 'InvalidArgument'],
    [404, 'NoSuchBucket'],
    [405, 'MethodNotAllowed'],
    [500, 'InternalError'],
    [501, 'NotImplemented'],
    [200, 'none'],
    [204, 'none'],
  ])('does not count an HTTP %i %s as a rejection', (status, code) => {
    expect(
      classifyAnonymousResponse({ status, body: body(s3ErrorXml(code)) })
        .rejected,
    ).toBe(false);
  });

  it('does not count a 400 without a code as a rejection', () => {
    expect(
      classifyAnonymousResponse({ status: 400, body: body('bad request') })
        .rejected,
    ).toBe(false);
  });
});
