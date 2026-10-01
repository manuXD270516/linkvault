import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
} from 'node:http';

// Servidor HTTP en proceso que hace de almacén S3 para los tests (tarea 2.5 de `object-store`): responde el estado y
// el cuerpo elegidos a las peticiones sin firmar, sirve con firma el listado, la muestra de un objeto y el borrado, y
// **registra cada petición** con sus cabeceras. Lo usan los tests de `verify` (acceso anónimo) y el de si el SDK
// instalado envía SSE-C por `http://` (tarea 2.9b (iii)).

export type Kind = 'get' | 'list' | 'put';

export interface Answer {
  readonly status: number;
  readonly body?: string | Uint8Array;
}

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly signed: boolean;
  readonly headers: IncomingHttpHeaders;
}

export const FAKE_STORE_BUCKET = 'cvs';

export function s3ErrorXml(code: string, bucket = FAKE_STORE_BUCKET): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>fake</Message><Resource>/${bucket}</Resource></Error>`;
}

export class FakeStoreServer {
  readonly requests: Recorded[] = [];
  /** Objeto del bucket, si lo hay: lo leen con firma el listado y el `GET` de la muestra. */
  object: { key: string; bytes: Uint8Array } | undefined;
  answer: (kind: Kind) => Answer;
  /** Respuesta a un `PUT` firmado. Por defecto `501`: `verify` nunca escribe con firma. */
  signedPutAnswer: Answer;
  readonly bucket: string;
  private server: Server | undefined;
  port = 0;

  constructor(bucket: string = FAKE_STORE_BUCKET) {
    this.bucket = bucket;
    this.answer = () => ({
      status: 403,
      body: s3ErrorXml('AccessDenied', bucket),
    });
    this.signedPutAnswer = {
      status: 501,
      body: s3ErrorXml('NotImplemented', bucket),
    };
  }

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

  private async handle(req: IncomingMessage): Promise<{
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
      headers: { ...req.headers },
    });
    const xml = { 'content-type': 'application/xml' };
    const bucket = this.bucket;
    const objectPath = url.pathname.slice(`/${bucket}/`.length);

    if (signed) {
      if (method === 'GET' && url.searchParams.get('list-type') === '2') {
        const contents =
          this.object === undefined
            ? ''
            : `<Contents><Key>${this.object.key}</Key><LastModified>2026-09-01T00:00:00.000Z</LastModified><Size>${this.object.bytes.length}</Size></Contents>`;
        return {
          status: 200,
          headers: xml,
          body: `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><KeyCount>${this.object === undefined ? 0 : 1}</KeyCount><MaxKeys>1</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
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
      if (method === 'PUT') {
        const answer = this.signedPutAnswer;
        return {
          status: answer.status,
          headers: answer.status < 300 ? { etag: '"fake"' } : xml,
          body: answer.body ?? '',
        };
      }
      return {
        status: 501,
        headers: xml,
        body: s3ErrorXml('NotImplemented', bucket),
      };
    }

    const kind: Kind =
      method === 'PUT'
        ? 'put'
        : objectPath === '' || url.pathname === `/${bucket}`
          ? 'list'
          : 'get';
    const answer = this.answer(kind);
    return { status: answer.status, headers: xml, body: answer.body ?? '' };
  }
}
