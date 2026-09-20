import { randomUUID } from 'node:crypto';
import {
  CV_FILE_TYPES,
  type CvDocument,
  type CvListResponse,
  type CvTextPreviewResponse,
} from '@linkvault/shared';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { expect } from 'vitest';
import { AppModule } from '../app/app.module';
import { configureApp } from '../app/create-app';
import {
  FIXED_WINDOW_COUNTER,
  type FixedWindowCounter,
} from '../infrastructure/limits/fixed-window-counter';
import { InMemoryFixedWindowCounter } from '../infrastructure/limits/testing/in-memory-fixed-window-counter';
import { buildLoggerParams } from '../infrastructure/logging/logger-params';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../modules/auth/application/ports/access-token-signer.port';
import { CV_FILE_STORE } from '../modules/cv/application/ports/cv-file-store.port';
import { InMemoryCvFileStore } from '../modules/cv/application/testing/cv-test-doubles';
import {
  CV_DOCUMENT_MODEL_NAME,
  CV_VERSION_COUNTER_MODEL_NAME,
} from '../modules/cv/infrastructure/cv.schemas';
import { UsersFacade } from '../modules/users/application/users.facade';
import { USER_MODEL_NAME } from '../modules/users/infrastructure/user.schema';
import { apiTestAiConfig, apiTestConfig } from './test-config';

// App completa de `api` para los tests de integración HTTP de `cv` (tarea 6.4): el `AppModule` real con una base de
// datos propia por archivo, el contador de intentos en memoria (esta suite no levanta Redis, ADR-021 §4) y, sobre
// todo, un **doble del almacén de objetos**: ningún test de `api` habla con MinIO, y la comprobación contra el almacén
// real es un paso local del RUNBOOK (ADR-028, "Pruebas").
//
// La URI del replica set la pasa quien llama (`getMongoTestUri()`): este archivo no es un spec, así que no puede
// depender de `@linkvault/testing`.

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

export type InjectResponse = Awaited<
  ReturnType<NestFastifyApplication['inject']>
>;

export interface TestPerson {
  readonly userId: string;
  readonly authorization: string;
}

/** Parte de archivo de una petición multipart, tal y como la manda un navegador. */
export interface UploadPart {
  readonly fileName: string;
  readonly content: Uint8Array;
  /** `undefined` deja la parte **sin** cabecera `Content-Type`, que es lo que mandan algunos clientes. */
  readonly contentType?: string | undefined;
}

export interface CvTestApp {
  readonly app: NestFastifyApplication;
  readonly connection: Connection;
  /** Almacén de objetos doble: sus claves y su posibilidad de estar caído. */
  readonly files: InMemoryCvFileStore;
  /** Persona nueva con su access token. */
  authenticated(): Promise<TestPerson>;
  /** `POST /api/cv` con una o varias partes de archivo y, opcionalmente, campos de texto. */
  upload(
    person: TestPerson,
    parts: UploadPart | readonly UploadPart[],
    fields?: Readonly<Record<string, string>>,
  ): Promise<InjectResponse>;
  /** `POST /api/cv` de un PDF válido, ya comprobado (`201`). */
  uploadPdf(person: TestPerson, fileName?: string): Promise<CvDocument>;
  request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options?: { authorization?: string; body?: unknown },
  ): Promise<InjectResponse>;
  /** `GET /api/cv` ya comprobado. */
  list(person: TestPerson): Promise<CvDocument[]>;
  /** `GET /api/cv/:id/text-preview` tal cual. */
  preview(person: TestPerson, cvId: string): Promise<InjectResponse>;
  /** Escribe el texto extraído de un CV, como lo dejaría el worker. */
  withExtractedText(cvId: string, text: string): Promise<void>;
  close(): Promise<void>;
}

export interface CvTestAppOptions {
  readonly counter?: FixedWindowCounter;
  readonly logDestination?: DestinationStream;
}

/** PDF mínimo con su firma; nada dentro, porque la API no abre archivos. */
export function pdfBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'), 0);
  return bytes;
}

/** DOCX mínimo: la firma de un ZIP y relleno. Que sea o no un documento de Word lo resuelve el worker. */
export function docxBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
  return bytes;
}

export async function createCvTestApp(
  name: string,
  mongoUri: string,
  options: CvTestAppOptions = {},
): Promise<CvTestApp> {
  const config = await apiTestConfig({
    MONGO_URI: withDatabase(mongoUri, `${name}-${randomUUID()}`),
  });
  const files = new InMemoryCvFileStore();
  let builder = Test.createTestingModule({
    imports: [AppModule.register(config, apiTestAiConfig())],
  })
    .overrideProvider(FIXED_WINDOW_COUNTER)
    .useValue(options.counter ?? new InMemoryFixedWindowCounter())
    .overrideProvider(CV_FILE_STORE)
    .useValue(files);
  if (options.logDestination !== undefined) {
    builder = builder
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(
        buildLoggerParams({ LOG_LEVEL: 'debug' }, options.logDestination),
      );
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const connection = app.get<Connection>(getConnectionToken());
  await connection.asPromise();
  for (const model of [
    USER_MODEL_NAME,
    CV_DOCUMENT_MODEL_NAME,
    CV_VERSION_COUNTER_MODEL_NAME,
  ]) {
    await connection.model(model).init();
  }
  const users = app.get(UsersFacade, { strict: false });
  const signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, {
    strict: false,
  });

  const request: CvTestApp['request'] = (method, url, requestOptions = {}) =>
    app.inject({
      method,
      url,
      headers: {
        ...(requestOptions.authorization === undefined
          ? {}
          : { authorization: requestOptions.authorization }),
        ...(requestOptions.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      },
      ...(requestOptions.body === undefined
        ? {}
        : { payload: JSON.stringify(requestOptions.body) }),
    });

  const authenticated = async (): Promise<TestPerson> => {
    const profile = await users.createWithPassword({
      email: `${randomUUID()}@example.com`,
      passwordHash: HASH,
      displayName: 'Ana',
    });
    const { accessToken } = await signer.sign({
      userId: profile.id,
      sessionId: randomUUID(),
    });
    return { userId: profile.id, authorization: `Bearer ${accessToken}` };
  };

  const upload: CvTestApp['upload'] = (person, parts, fields = {}) => {
    const boundary = `----linkvault${randomUUID()}`;
    const list = Array.isArray(parts) ? parts : [parts as UploadPart];
    return app.inject({
      method: 'POST',
      url: '/api/cv',
      headers: {
        authorization: person.authorization,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartBody(boundary, list, fields),
    });
  };

  const uploadPdf: CvTestApp['uploadPdf'] = async (
    person,
    fileName = 'CV_backend.pdf',
  ) => {
    const response = await upload(person, {
      fileName,
      content: pdfBytes(),
      contentType: CV_FILE_TYPES.pdf.mimeType,
    });
    expect(response.statusCode).toBe(201);
    return response.json<CvDocument>();
  };

  const list: CvTestApp['list'] = async (person) => {
    const response = await request('GET', '/api/cv', {
      authorization: person.authorization,
    });
    expect(response.statusCode).toBe(200);
    return response.json<CvListResponse>().items;
  };

  const preview: CvTestApp['preview'] = (person, cvId) =>
    request('GET', `/api/cv/${cvId}/text-preview`, {
      authorization: person.authorization,
    });

  const withExtractedText: CvTestApp['withExtractedText'] = async (
    cvId,
    text,
  ) => {
    await connection.collection('cv_documents').updateOne(
      { _id: new connection.base.Types.ObjectId(cvId) },
      {
        $set: {
          extractedText: text,
          'extraction.status': 'extracted',
          'extraction.textChars': [...text].length,
          'extraction.extractedAt': new Date(),
        },
      },
    );
  };

  return {
    app,
    connection,
    files,
    authenticated,
    request,
    upload,
    uploadPdf,
    list,
    preview,
    withExtractedText,
    async close() {
      await connection.dropDatabase();
      await app.close();
    },
  };
}

/** Cuerpo `multipart/form-data` escrito a mano: es lo que un navegador manda, byte a byte. */
function multipartBody(
  boundary: string,
  parts: readonly UploadPart[],
  fields: Readonly<Record<string, string>>,
): Buffer {
  const pieces: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    pieces.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  for (const part of parts) {
    const contentType =
      part.contentType === undefined
        ? ''
        : `Content-Type: ${part.contentType}\r\n`;
    pieces.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${part.fileName}"\r\n${contentType}\r\n`,
      ),
      Buffer.from(part.content),
      Buffer.from('\r\n'),
    );
  }
  pieces.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(pieces);
}

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Respuesta ya tipada de la vista previa, para los tests que la comprueban entera. */
export function previewBody(response: InjectResponse): CvTextPreviewResponse {
  return response.json<CvTextPreviewResponse>();
}
