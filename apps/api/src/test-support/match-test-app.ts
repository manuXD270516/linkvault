import { randomUUID } from 'node:crypto';
import { PROVIDER_ELIGIBILITY } from '@linkvault/ai';
import {
  AI_CONSENT_TEXT_VERSION,
  CV_FILE_TYPES,
  MATCH_REQUESTED_EVENT_TYPE,
  type CvDocument,
  type MatchDegradedReason,
  type MatchReport,
  type MatchRequestAccepted,
  type MatchAnalysisResponse,
  type MatchLatest,
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
import { FIXED_WINDOW_COUNTER } from '../infrastructure/limits/fixed-window-counter';
import { InMemoryFixedWindowCounter } from '../infrastructure/limits/testing/in-memory-fixed-window-counter';
import { buildLoggerParams } from '../infrastructure/logging/logger-params';
import { OUTBOX_EVENTS_COLLECTION } from '../infrastructure/outbox/outbox-event.schemas';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../modules/auth/application/ports/access-token-signer.port';
import { CV_FILE_STORE } from '../modules/cv/application/ports/cv-file-store.port';
import { InMemoryCvFileStore } from '../modules/cv/application/testing/cv-test-doubles';
import {
  CV_DOCUMENT_MODEL_NAME,
  CV_DOCUMENTS_COLLECTION,
  CV_VERSION_COUNTER_MODEL_NAME,
} from '../modules/cv/infrastructure/cv.schemas';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MODEL_NAME,
} from '../modules/groups/infrastructure/group.schemas';
import {
  enrichedPreview,
  jobLinkDraft,
} from '../modules/links/application/testing/link-fixtures';
import {
  GROUP_LINKS_COLLECTION,
  GROUP_LINK_MODEL_NAME,
  JOB_LINKS_COLLECTION,
  JOB_LINK_MODEL_NAME,
  USER_LINKS_COLLECTION,
  USER_LINK_MODEL_NAME,
} from '../modules/links/infrastructure/link.schemas';
import { ANALYSIS_REPOSITORY } from '../modules/match/application/ports/analysis-repository.port';
import { MATCH_CLOCK } from '../modules/match/application/ports/clock.port';
import {
  MovableMatchClock,
  StubProviderEligibility,
  sampleDegradedReport,
  sampleReport,
} from '../modules/match/application/testing/match-test-doubles';
import {
  AI_ANALYSES_COLLECTION,
  ANALYSIS_MODEL_NAME,
} from '../modules/match/infrastructure/analysis.schemas';
import { UsersFacade } from '../modules/users/application/users.facade';
import { USER_MODEL_NAME } from '../modules/users/infrastructure/user.schema';
import { apiTestAiConfig, apiTestConfig } from './test-config';

// App completa de `api` para los tests de integración HTTP de `match` (tarea 10.2).
// Outbox observable, elegibilidad sustituible; sin contador de match (cuota del historial).

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
const NOW = new Date('2026-09-20T12:00:00.000Z');

export type InjectResponse = Awaited<
  ReturnType<NestFastifyApplication['inject']>
>;

export interface TestPerson {
  readonly userId: string;
  readonly authorization: string;
}

export interface SeededOffer {
  readonly linkId: string;
  readonly previewVersion: number;
}

export interface MatchTestApp {
  readonly app: NestFastifyApplication;
  readonly connection: Connection;
  readonly files: InMemoryCvFileStore;
  readonly eligibility: StubProviderEligibility;
  readonly clock: MovableMatchClock;
  authenticated(displayName?: string): Promise<TestPerson>;
  request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options?: { authorization?: string; body?: unknown },
  ): Promise<InjectResponse>;
  uploadCv(
    person: TestPerson,
    options?: {
      fileName?: string;
      extractedText?: string;
      extractionStatus?: 'pending' | 'extracted' | 'failed';
      isDefault?: boolean;
    },
  ): Promise<CvDocument>;
  seedOffer(
    owner: TestPerson,
    options?: {
      slug?: string;
      ready?: boolean;
      previewVersion?: number;
      title?: string;
      summary?: string;
    },
  ): Promise<SeededOffer>;
  shareInGroup(
    owner: TestPerson,
    member: TestPerson,
    linkId: string,
  ): Promise<void>;
  requestMatch(
    person: TestPerson,
    linkId: string,
    body?: unknown,
  ): Promise<InjectResponse>;
  getMatch(person: TestPerson, linkId: string): Promise<InjectResponse>;
  matchRequestedEvents(): Promise<
    readonly {
      analysisId: string;
      userId: string;
      linkId: string;
      cvId: string;
    }[]
  >;
  completeAnalysis(
    analysisId: string,
    options?: {
      report?: MatchReport;
      provider?: string;
      step?: string;
      degradedReason?: MatchDegradedReason;
      aiQuotaRetryAt?: Date;
      consentRequired?: boolean;
      wentExternal?: boolean;
      finishedAt?: Date;
      failureCode?: 'internal_error';
      status?: 'done' | 'failed';
    },
  ): Promise<void>;
  grantAiConsent(person: TestPerson, granted?: boolean): Promise<void>;
  close(): Promise<void>;
}

export interface MatchTestAppOptions {
  readonly eligibility?: StubProviderEligibility;
  readonly clock?: MovableMatchClock;
  readonly logDestination?: DestinationStream;
  readonly analysesPerUser?: number;
}

export async function createMatchTestApp(
  name: string,
  mongoUri: string,
  options: MatchTestAppOptions = {},
): Promise<MatchTestApp> {
  const eligibility =
    options.eligibility ??
    new StubProviderEligibility({
      status: 'ready',
      hasEligible: true,
      hasEligibleByok: false,
      consentWouldEnable: false,
    });
  const clock = options.clock ?? new MovableMatchClock(NOW);
  const config = await apiTestConfig({
    MONGO_URI: withDatabase(mongoUri, `${name}-${randomUUID()}`),
    ...(options.analysesPerUser === undefined
      ? {}
      : { MATCH_ANALYSES_PER_USER: options.analysesPerUser }),
  });
  const files = new InMemoryCvFileStore();
  let builder = Test.createTestingModule({
    imports: [AppModule.register(config, apiTestAiConfig())],
  })
    .overrideProvider(FIXED_WINDOW_COUNTER)
    .useValue(new InMemoryFixedWindowCounter())
    .overrideProvider(CV_FILE_STORE)
    .useValue(files)
    .overrideProvider(PROVIDER_ELIGIBILITY)
    .useValue(eligibility)
    .overrideProvider(MATCH_CLOCK)
    .useValue(clock);
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
    GROUP_MODEL_NAME,
    GROUP_MEMBER_MODEL_NAME,
    JOB_LINK_MODEL_NAME,
    GROUP_LINK_MODEL_NAME,
    USER_LINK_MODEL_NAME,
    CV_DOCUMENT_MODEL_NAME,
    CV_VERSION_COUNTER_MODEL_NAME,
    ANALYSIS_MODEL_NAME,
  ]) {
    await connection.model(model).init();
  }
  void app.get(ANALYSIS_REPOSITORY, { strict: false });

  const users = app.get(UsersFacade, { strict: false });
  const signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, {
    strict: false,
  });

  const request: MatchTestApp['request'] = (method, url, requestOptions = {}) =>
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

  const authenticated = async (displayName = 'Ana'): Promise<TestPerson> => {
    const profile = await users.createWithPassword({
      email: `${randomUUID()}@example.com`,
      passwordHash: HASH,
      displayName,
    });
    const { accessToken } = await signer.sign({
      userId: profile.id,
      sessionId: randomUUID(),
    });
    return { userId: profile.id, authorization: `Bearer ${accessToken}` };
  };

  const uploadCv: MatchTestApp['uploadCv'] = async (
    person,
    uploadOptions = {},
  ) => {
    const boundary = `----linkvault${randomUUID()}`;
    const fileName = uploadOptions.fileName ?? 'CV_backend.pdf';
    const bytes = pdfBytes();
    const response = await app.inject({
      method: 'POST',
      url: '/api/cv',
      headers: {
        authorization: person.authorization,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipartPdf(boundary, fileName, bytes),
    });
    expect(response.statusCode).toBe(201);
    const document = response.json<CvDocument>();
    const status = uploadOptions.extractionStatus ?? 'extracted';
    const text =
      uploadOptions.extractedText ??
      'Ana Perez ingeniera TypeScript NestJS Bolivia';
    if (status !== 'pending') {
      await connection.collection(CV_DOCUMENTS_COLLECTION).updateOne(
        { _id: new connection.base.Types.ObjectId(document.id) },
        {
          $set: {
            ...(status === 'extracted'
              ? {
                  extractedText: text,
                  'extraction.status': 'extracted',
                  'extraction.textChars': [...text].length,
                  'extraction.extractedAt': clock.now(),
                }
              : {
                  'extraction.status': 'failed',
                  'extraction.failureReason': 'unreadable_file',
                }),
            ...(uploadOptions.isDefault === undefined
              ? {}
              : { isDefault: uploadOptions.isDefault }),
          },
        },
      );
    }
    if (uploadOptions.isDefault === false) {
      await connection.collection(CV_DOCUMENTS_COLLECTION).updateOne(
        { _id: new connection.base.Types.ObjectId(document.id) },
        { $set: { isDefault: false } },
      );
    }
    return document;
  };

  const seedOffer: MatchTestApp['seedOffer'] = async (
    owner,
    seedOptions = {},
  ) => {
    const ready = seedOptions.ready ?? true;
    const previewVersion = seedOptions.previewVersion ?? 2;
    const slug = seedOptions.slug ?? randomUUID().slice(0, 8);
    const draft = jobLinkDraft(`https://empresa.example/careers/${slug}`, {
      createdBy: owner.userId,
      now: clock.now(),
    });
    const linkId = new connection.base.Types.ObjectId();
    const basePreview = enrichedPreview(owner.userId);
    const preview = ready
      ? {
          ...basePreview,
          preview: {
            ...basePreview.preview,
            ...(seedOptions.title === undefined
              ? {}
              : { title: seedOptions.title }),
            ...(seedOptions.summary === undefined
              ? {}
              : { summary: seedOptions.summary }),
          },
        }
      : { preview: {}, previewSources: {} };
    await connection.collection(JOB_LINKS_COLLECTION).insertOne({
      _id: linkId,
      normalizedUrl: draft.normalizedUrl,
      urlHash: draft.urlHash,
      dedupeKey: draft.dedupeKey,
      platform: draft.platform,
      displayUrl: draft.displayUrl,
      originalUrls: [...draft.originalUrls],
      previewStatus: ready ? 'enriched' : 'pending',
      previewVersion,
      ...preview,
      previewRequestedAt: clock.now(),
      createdBy: new connection.base.Types.ObjectId(owner.userId),
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });
    await connection.collection(USER_LINKS_COLLECTION).insertOne({
      userId: new connection.base.Types.ObjectId(owner.userId),
      linkId,
      savedAt: clock.now(),
    });
    return { linkId: linkId.toHexString(), previewVersion };
  };

  const shareInGroup: MatchTestApp['shareInGroup'] = async (
    owner,
    member,
    linkId,
  ) => {
    const created = await request('POST', '/api/groups', {
      authorization: owner.authorization,
      body: { name: `Grupo ${randomUUID().slice(0, 6)}` },
    });
    expect(created.statusCode).toBe(201);
    const group = created.json<{ id: string; inviteCode?: string }>();
    expect(group.inviteCode).toBeDefined();
    const joined = await request('POST', '/api/groups/join', {
      authorization: member.authorization,
      body: { code: group.inviteCode },
    });
    expect(joined.statusCode).toBe(200);
    await connection.collection(GROUP_LINKS_COLLECTION).insertOne({
      groupId: new connection.base.Types.ObjectId(group.id),
      linkId: new connection.base.Types.ObjectId(linkId),
      sharedBy: new connection.base.Types.ObjectId(owner.userId),
      sharedAt: clock.now(),
    });
  };

  const requestMatch: MatchTestApp['requestMatch'] = (
    person,
    linkId,
    body = {},
  ) =>
    request('POST', `/api/links/${linkId}/match`, {
      authorization: person.authorization,
      body,
    });

  const getMatch: MatchTestApp['getMatch'] = (person, linkId) =>
    request('GET', `/api/links/${linkId}/match`, {
      authorization: person.authorization,
    });

  const matchRequestedEvents: MatchTestApp['matchRequestedEvents'] =
    async () => {
      const rows = await connection
        .collection(OUTBOX_EVENTS_COLLECTION)
        .find({ type: MATCH_REQUESTED_EVENT_TYPE })
        .toArray();
      return rows.map((row) => {
        const payload = row['payload'] as {
          analysisId: string;
          userId: string;
          linkId: string;
          cvId: string;
        };
        return payload;
      });
    };

  const completeAnalysis: MatchTestApp['completeAnalysis'] = async (
    analysisId,
    completeOptions = {},
  ) => {
    const status = completeOptions.status ?? 'done';
    const finishedAt = completeOptions.finishedAt ?? clock.now();
    const report =
      completeOptions.report ??
      (status === 'done'
        ? completeOptions.degradedReason === undefined
          ? sampleReport()
          : sampleDegradedReport(
              completeOptions.degradedReason,
              completeOptions.aiQuotaRetryAt,
            )
        : undefined);
    const requested = await connection
      .collection(AI_ANALYSES_COLLECTION)
      .findOne({ _id: new connection.base.Types.ObjectId(analysisId) });
    const requestedAt =
      (requested?.['requestedAt'] as Date | undefined) ?? clock.now();
    await connection.collection(AI_ANALYSES_COLLECTION).updateOne(
      { _id: new connection.base.Types.ObjectId(analysisId) },
      {
        $set: {
          status,
          step:
            completeOptions.step ??
            (status === 'failed'
              ? 'failed'
              : report?.degraded === true
                ? 'done-degraded'
                : 'done'),
          finishedAt,
          durationMs: finishedAt.getTime() - requestedAt.getTime(),
          consentRequired: completeOptions.consentRequired ?? false,
          wentExternal: completeOptions.wentExternal ?? false,
          ...(completeOptions.provider === undefined
            ? status === 'done'
              ? { provider: 'mock' }
              : {}
            : { provider: completeOptions.provider }),
          ...(report === undefined ? {} : { report }),
          ...(report?.degraded === true
            ? {
                degraded: true,
                degradedReason: report.degradedReason,
              }
            : {}),
          ...(completeOptions.aiQuotaRetryAt === undefined
            ? {}
            : { aiQuotaRetryAt: completeOptions.aiQuotaRetryAt }),
          ...(completeOptions.failureCode === undefined
            ? status === 'failed'
              ? { failureCode: 'internal_error' }
              : {}
            : { failureCode: completeOptions.failureCode }),
        },
      },
    );
  };

  const grantAiConsent: MatchTestApp['grantAiConsent'] = async (
    person,
    granted = true,
  ) => {
    const response = await request('PATCH', '/api/users/me', {
      authorization: person.authorization,
      body: granted
        ? {
            aiConsent: {
              externalProviders: true,
              textVersion: AI_CONSENT_TEXT_VERSION,
            },
          }
        : { aiConsent: { externalProviders: false } },
    });
    expect(response.statusCode).toBe(200);
  };

  return {
    app,
    connection,
    files,
    eligibility,
    clock,
    authenticated,
    request,
    uploadCv,
    seedOffer,
    shareInGroup,
    requestMatch,
    getMatch,
    matchRequestedEvents,
    completeAnalysis,
    grantAiConsent,
    async close() {
      await connection.dropDatabase();
      await app.close();
    },
  };
}

function pdfBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'), 0);
  return bytes;
}

function multipartPdf(
  boundary: string,
  fileName: string,
  content: Uint8Array,
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${CV_FILE_TYPES.pdf.mimeType}\r\n\r\n`,
    ),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

export function acceptedBody(response: InjectResponse): MatchRequestAccepted {
  return response.json<MatchRequestAccepted>();
}

export function reusedBody(response: InjectResponse): MatchLatest {
  return response.json<MatchLatest>();
}

export function analysisBody(response: InjectResponse): MatchAnalysisResponse {
  return response.json<MatchAnalysisResponse>();
}
