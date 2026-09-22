import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  type UserProfile,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Types, type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { configureApp } from '../../../app/create-app';
import {
  apiTestAiConfig,
  apiTestConfig,
} from '../../../test-support/test-config';
import { CSRF_HEADERS } from '../../../test-support/auth-test-app';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../../auth/application/ports/access-token-signer.port';
import { PASSWORD_HASHER } from '../../auth/application/ports/password-hasher.port';
import { Argon2PasswordHasher } from '../../auth/infrastructure/argon2-password-hasher';
import { CreateGroup } from '../../groups/application/create-group.usecase';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from '../../groups/application/ports/group-repository.port';
import {
  GROUP_LINK_COMMENTS_COLLECTION,
} from '../../links/infrastructure/group-link-comment.schemas';
import {
  GROUP_LINKS_COLLECTION,
  USER_LINKS_COLLECTION,
} from '../../links/infrastructure/link.schemas';
import {
  USER_MODEL_NAME,
  USERS_COLLECTION,
} from '../infrastructure/user.schema';
import { UsersFacade } from '../application/users.facade';
import { CV_USER_PREFIX_DELETER } from '../application/ports/cv-user-prefix-deleter.port';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../application/ports/user-repository.port';
import { InMemoryCvUserPrefixDeleter } from '../application/testing/in-memory-cv-user-prefix.deleter';

// Cascada de `DELETE /api/users/me` (tarea 5.2 de deploy-prod) sobre AppModule + MongoMemoryReplSet: user_links,
// note unset, commentCount/`commentsRevision`, publicShare, applications, sesiones, AI, 409 sole_owner_with_members,
// 401 password/sesión, rollback mid-txn + reintento, y 204 del camino feliz. El deleter de S3 se sustituye para no
// esperar al puerto cerrado del test-config.

const PASSWORD = 'correct-horse-battery';
const AI_USAGE_COLLECTION = 'ai_usage';
const AUTH_SESSIONS_COLLECTION = 'auth_sessions';
const REFRESH_TOKENS_COLLECTION = 'refresh_tokens';
const APPLICATIONS_COLLECTION = 'applications';
const APPLICATION_EVENTS_COLLECTION = 'application_events';
const AI_ANALYSES_COLLECTION = 'ai_analyses';
const ROADMAPS_COLLECTION = 'roadmaps';
const AI_FEEDBACK_COLLECTION = 'ai_feedback';
const USER_AI_KEYS_COLLECTION = 'user_ai_keys';
const ANA_PUBLIC_SLUG = 'abcdefghjkmn';
const BETO_PUBLIC_SLUG = 'npqrstvwxy23';
const NOW = new Date('2026-09-22T12:00:00.000Z');
const SESSION_EXPIRES = new Date('2026-10-22T12:00:00.000Z');

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

describe('DELETE /api/users/me account deletion cascade', () => {
  let app: NestFastifyApplication | undefined;
  let connection: Connection | undefined;
  let users: UsersFacade;
  let userRepo: UserRepository;
  let signer: AccessTokenSigner;
  let createGroup: CreateGroup;
  let groups: GroupRepository;
  let cvFiles: InMemoryCvUserPrefixDeleter;
  let passwordHash: string;

  beforeAll(async () => {
    cvFiles = new InMemoryCvUserPrefixDeleter();
    passwordHash = await new Argon2PasswordHasher().hash(PASSWORD);

    const config = await apiTestConfig({
      MONGO_URI: withDatabase(
        getMongoTestUri(),
        `account-deletion-${randomUUID()}`,
      ),
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(config, apiTestAiConfig())],
    })
      .overrideProvider(CV_USER_PREFIX_DELETER)
      .useValue(cvFiles)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    connection = app.get<Connection>(getConnectionToken());
    await connection.asPromise();
    await connection.model(USER_MODEL_NAME).init();

    users = app.get(UsersFacade, { strict: false });
    userRepo = app.get<UserRepository>(USER_REPOSITORY, { strict: false });
    signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, { strict: false });
    createGroup = app.get(CreateGroup, { strict: false });
    groups = app.get<GroupRepository>(GROUP_REPOSITORY, { strict: false });
    expect(app.get(PASSWORD_HASHER, { strict: false })).toBeDefined();
  });

  afterAll(async () => {
    if (connection !== undefined) {
      await connection.dropDatabase();
    }
    await app?.close();
  });

  async function createUser(displayName: string): Promise<UserProfile> {
    return users.createWithPassword({
      email: `${randomUUID()}@example.com`,
      passwordHash,
      displayName,
    });
  }

  async function authorizationFor(userId: string): Promise<{
    readonly authorization: string;
    readonly accessToken: string;
    readonly sessionId: string;
  }> {
    const sessionId = randomUUID();
    const { accessToken } = await signer.sign({
      userId,
      sessionId,
    });
    return {
      authorization: `Bearer ${accessToken}`,
      accessToken,
      sessionId,
    };
  }

  function deleteMe(authorization: string | undefined, password: string) {
    if (app === undefined) {
      throw new Error('app not started');
    }
    return app.inject({
      method: 'DELETE',
      url: '/api/users/me',
      headers: {
        ...(authorization === undefined ? {} : { authorization }),
        'content-type': 'application/json',
      },
      payload: { password },
    });
  }

  function login(email: string, password: string) {
    if (app === undefined) {
      throw new Error('app not started');
    }
    return app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        ...CSRF_HEADERS,
        'content-type': 'application/json',
      },
      payload: { email, password },
    });
  }

  function publicPage(slug: string) {
    if (app === undefined) {
      throw new Error('app not started');
    }
    return app.inject({ method: 'GET', url: `/p/${slug}` });
  }

  function db(): Connection {
    if (connection === undefined) {
      throw new Error('connection not started');
    }
    return connection;
  }

  it('returns 409 sole_owner_with_members without mutating data', async () => {
    const ana = await createUser('Ana');
    const luis = await createUser('Luis');
    const group = await createGroup.execute(ana.id, 'Backend');
    await groups.addMember({
      groupId: group.id,
      userId: luis.id,
      now: NOW,
    });

    const response = await deleteMe(
      (await authorizationFor(ana.id)).authorization,
      PASSWORD,
    );

    expect(response.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'sole_owner_with_members',
    });
    await expect(userRepo.findById(ana.id)).resolves.toMatchObject({
      id: ana.id,
    });
    await expect(userRepo.findById(luis.id)).resolves.toMatchObject({
      id: luis.id,
    });
    await expect(groups.findById(group.id)).resolves.toMatchObject({
      id: group.id,
    });
    await expect(
      db().collection(USERS_COLLECTION).countDocuments({
        _id: new Types.ObjectId(ana.id),
      }),
    ).resolves.toBe(1);
  });

  it('returns 401 invalid_credentials when the password is wrong', async () => {
    const ana = await createUser('Ana Wrong Password');
    const auth = await authorizationFor(ana.id);

    const response = await deleteMe(auth.authorization, 'wrong-password-123');

    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'invalid_credentials',
    });
    await expect(userRepo.findById(ana.id)).resolves.toMatchObject({
      id: ana.id,
    });
  });

  it('returns 401 without a session', async () => {
    const response = await deleteMe(undefined, PASSWORD);

    expect(response.statusCode).toBe(401);
  });

  it('rolls back mid-txn failure and allows retry', async () => {
    // Fuerza fallo tras `deletePersonalData` (último paso de la txn = users.delete) para verificar
    // que un abort no deja residuos parciales y que un reintento posterior completa el wipe.
    const ana = await createUser('Ana Mid Txn');
    const anaOid = new Types.ObjectId(ana.id);
    const linkOid = new Types.ObjectId();
    const sessionId = randomUUID();
    const auth = await authorizationFor(ana.id);

    await db().collection(AUTH_SESSIONS_COLLECTION).insertOne({
      _id: sessionId,
      userId: ana.id,
      createdAt: NOW,
      expiresAt: SESSION_EXPIRES,
      revokedAt: null,
    } as never);
    await db().collection(USER_LINKS_COLLECTION).insertOne({
      userId: anaOid,
      linkId: linkOid,
      savedAt: NOW,
    });
    await db().collection(AI_USAGE_COLLECTION).insertOne({
      userId: ana.id,
      task: 'classify-skills',
      providerId: 'mock',
      model: 'mock',
      inputTokens: 1,
      outputTokens: 1,
      estCost: 0,
      latencyMs: 1,
      outcome: 'success',
      promptVersion: 'v1',
      key: `usage-mid-${ana.id}`,
      at: NOW,
    });
    cvFiles.withKey(`${ana.id}/cv.pdf`);

    const deleteSpy = vi
      .spyOn(userRepo, 'delete')
      .mockRejectedValueOnce(new Error('forced mid-txn failure'));

    const failed = await deleteMe(auth.authorization, PASSWORD);
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(deleteSpy).toHaveBeenCalled();
    deleteSpy.mockRestore();

    await expect(userRepo.findById(ana.id)).resolves.toMatchObject({
      id: ana.id,
    });
    await expect(
      db()
        .collection(USER_LINKS_COLLECTION)
        .countDocuments({ userId: anaOid }),
    ).resolves.toBe(1);
    await expect(
      db().collection(AUTH_SESSIONS_COLLECTION).countDocuments({
        userId: ana.id,
      }),
    ).resolves.toBe(1);
    await expect(
      db()
        .collection(AI_USAGE_COLLECTION)
        .countDocuments({ userId: ana.id }),
    ).resolves.toBe(1);
    expect([...cvFiles.keys]).toContain(`${ana.id}/cv.pdf`);

    const retried = await deleteMe(auth.authorization, PASSWORD);
    expect(retried.statusCode).toBe(204);
    await expect(userRepo.findById(ana.id)).resolves.toBeNull();
    await expect(
      db()
        .collection(USER_LINKS_COLLECTION)
        .countDocuments({ userId: anaOid }),
    ).resolves.toBe(0);
    await expect(
      db().collection(AUTH_SESSIONS_COLLECTION).countDocuments({
        userId: ana.id,
      }),
    ).resolves.toBe(0);
    await expect(
      db()
        .collection(AI_USAGE_COLLECTION)
        .countDocuments({ userId: ana.id }),
    ).resolves.toBe(0);
    expect(cvFiles.deletedPrefixes).toContain(ana.id);
    expect([...cvFiles.keys]).not.toContain(`${ana.id}/cv.pdf`);
  });

  it('returns 204 and cascades personal data', async () => {
    const ana = await createUser('Ana');
    const beto = await createUser('Beto');
    const betoGroup = await createGroup.execute(beto.id, 'Frontend');
    await groups.addMember({
      groupId: betoGroup.id,
      userId: ana.id,
      now: NOW,
    });
    // Grupo del que Ana es única dueña y única miembro: se borra en la misma txn.
    const personalGroup = await createGroup.execute(ana.id, 'Personal');

    const anaOid = new Types.ObjectId(ana.id);
    const betoOid = new Types.ObjectId(beto.id);
    const groupOid = new Types.ObjectId(betoGroup.id);
    const linkOid = new Types.ObjectId();
    const betoLinkOid = new Types.ObjectId();
    const applicationOid = new Types.ObjectId();
    const analysisOid = new Types.ObjectId();
    const sessionId = randomUUID();
    const { accessToken, authorization } = await (async () => {
      const { accessToken: token } = await signer.sign({
        userId: ana.id,
        sessionId,
      });
      return { accessToken: token, authorization: `Bearer ${token}` };
    })();

    await db().collection(AUTH_SESSIONS_COLLECTION).insertOne({
      _id: sessionId,
      userId: ana.id,
      createdAt: NOW,
      expiresAt: SESSION_EXPIRES,
      revokedAt: null,
    } as never);
    await db().collection(REFRESH_TOKENS_COLLECTION).insertOne({
      tokenHash: `hash-${sessionId}`,
      sessionId,
      userId: ana.id,
      createdAt: NOW,
      expiresAt: SESSION_EXPIRES,
      rotatedAt: null,
      replacedByHash: null,
    });

    await db().collection(USER_LINKS_COLLECTION).insertOne({
      userId: anaOid,
      linkId: linkOid,
      savedAt: NOW,
    });
    await db().collection(GROUP_LINKS_COLLECTION).insertOne({
      groupId: groupOid,
      linkId: linkOid,
      sharedBy: anaOid,
      sharedAt: NOW,
      note: { text: 'nota de Ana', createdAt: NOW },
      commentCount: 3,
      commentsRevision: 1,
      publicShare: {
        slug: ANA_PUBLIC_SLUG,
        publishedBy: anaOid,
        publishedAt: NOW,
      },
    });
    await db().collection(GROUP_LINKS_COLLECTION).insertOne({
      groupId: groupOid,
      linkId: betoLinkOid,
      sharedBy: betoOid,
      sharedAt: NOW,
      commentCount: 0,
      commentsRevision: 0,
      publicShare: {
        slug: BETO_PUBLIC_SLUG,
        publishedBy: betoOid,
        publishedAt: NOW,
      },
    });
    await db().collection(GROUP_LINK_COMMENTS_COLLECTION).insertMany([
      {
        groupId: groupOid,
        linkId: linkOid,
        authorId: anaOid,
        text: 'comentario uno',
        createdAt: NOW,
      },
      {
        groupId: groupOid,
        linkId: linkOid,
        authorId: anaOid,
        text: 'comentario dos',
        createdAt: NOW,
      },
      {
        groupId: groupOid,
        linkId: linkOid,
        authorId: betoOid,
        text: 'comentario de Beto',
        createdAt: NOW,
      },
    ]);
    await db().collection(APPLICATIONS_COLLECTION).insertOne({
      _id: applicationOid,
      userId: anaOid,
      linkId: linkOid,
      status: 'applied',
      visibility: 'private',
      notes: '',
      statusChangedAt: NOW,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db().collection(APPLICATION_EVENTS_COLLECTION).insertOne({
      applicationId: applicationOid,
      userId: anaOid,
      to: 'applied',
      at: NOW,
    });
    await db().collection(AI_ANALYSES_COLLECTION).insertOne({
      _id: analysisOid,
      userId: anaOid,
      linkId: linkOid,
      cvId: new Types.ObjectId(),
      status: 'failed',
      step: 'failed',
      previewVersion: 1,
      promptVersion: 'v1',
      failureCode: 'internal_error',
      consentRequired: false,
      wentExternal: false,
      requestedAt: NOW,
      finishedAt: NOW,
      durationMs: 1,
    });
    await db().collection(ROADMAPS_COLLECTION).insertOne({
      analysisId: analysisOid,
      userId: anaOid,
      status: 'failed',
      createdAt: NOW,
      updatedAt: NOW,
    });
    await db().collection(AI_FEEDBACK_COLLECTION).insertOne({
      userId: anaOid,
      analysisId: analysisOid,
      suggestionIndex: 0,
      afterHash: 'abcd',
      createdAt: NOW,
    });
    await db().collection(USER_AI_KEYS_COLLECTION).insertOne({
      userId: ana.id,
      vendor: 'openrouter',
      ciphertext: Buffer.from('cipher'),
      keyHint: 'or12',
      updatedAt: NOW,
    });
    await db().collection(AI_USAGE_COLLECTION).insertOne({
      userId: ana.id,
      task: 'classify-skills',
      providerId: 'mock',
      model: 'mock',
      inputTokens: 1,
      outputTokens: 1,
      estCost: 0,
      latencyMs: 1,
      outcome: 'success',
      promptVersion: 'v1',
      key: `usage-${ana.id}`,
      at: NOW,
    });
    cvFiles.withKey(`${ana.id}/cv.pdf`);

    const response = await deleteMe(authorization, PASSWORD);

    expect(response.statusCode).toBe(204);
    await expect(userRepo.findById(ana.id)).resolves.toBeNull();
    await expect(groups.findById(personalGroup.id)).resolves.toBeNull();
    await expect(
      db()
        .collection(USER_LINKS_COLLECTION)
        .countDocuments({ userId: anaOid }),
    ).resolves.toBe(0);
    await expect(
      db()
        .collection(AI_USAGE_COLLECTION)
        .countDocuments({ userId: ana.id }),
    ).resolves.toBe(0);
    await expect(
      db().collection(AUTH_SESSIONS_COLLECTION).countDocuments({
        userId: ana.id,
      }),
    ).resolves.toBe(0);
    await expect(
      db().collection(REFRESH_TOKENS_COLLECTION).countDocuments({
        userId: ana.id,
      }),
    ).resolves.toBe(0);
    await expect(
      db().collection(APPLICATIONS_COLLECTION).countDocuments({
        userId: anaOid,
      }),
    ).resolves.toBe(0);
    await expect(
      db().collection(APPLICATION_EVENTS_COLLECTION).countDocuments({
        userId: anaOid,
      }),
    ).resolves.toBe(0);
    await expect(
      db().collection(AI_ANALYSES_COLLECTION).countDocuments({
        userId: anaOid,
      }),
    ).resolves.toBe(0);
    await expect(
      db().collection(ROADMAPS_COLLECTION).countDocuments({
        userId: anaOid,
      }),
    ).resolves.toBe(0);
    await expect(
      db().collection(AI_FEEDBACK_COLLECTION).countDocuments({
        userId: anaOid,
      }),
    ).resolves.toBe(0);
    await expect(
      db().collection(USER_AI_KEYS_COLLECTION).countDocuments({
        userId: ana.id,
      }),
    ).resolves.toBe(0);
    await expect(
      db().collection(GROUP_LINK_COMMENTS_COLLECTION).countDocuments({
        authorId: anaOid,
      }),
    ).resolves.toBe(0);
    await expect(
      db().collection(GROUP_LINK_COMMENTS_COLLECTION).countDocuments({
        groupId: groupOid,
        linkId: linkOid,
      }),
    ).resolves.toBe(1);

    const groupLink = await db()
      .collection(GROUP_LINKS_COLLECTION)
      .findOne({ groupId: groupOid, linkId: linkOid });
    expect(groupLink).toMatchObject({
      commentCount: 1,
      commentsRevision: 2,
    });
    expect(groupLink).not.toHaveProperty('note');
    expect(groupLink).not.toHaveProperty('publicShare');

    const betoShare = await db()
      .collection(GROUP_LINKS_COLLECTION)
      .findOne({ groupId: groupOid, linkId: betoLinkOid });
    expect(betoShare?.['publicShare']).toMatchObject({
      slug: BETO_PUBLIC_SLUG,
      publishedBy: betoOid,
    });

    expect((await publicPage(ANA_PUBLIC_SLUG)).statusCode).toBe(404);
    expect(cvFiles.deletedPrefixes).toContain(ana.id);
    expect([...cvFiles.keys]).not.toContain(`${ana.id}/cv.pdf`);

    if (app === undefined) {
      throw new Error('app not started');
    }
    const reused = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(reused.statusCode).toBe(401);

    const loginAfter = await login(ana.email, PASSWORD);
    expect(loginAfter.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(loginAfter.json())).toMatchObject({
      code: 'invalid_credentials',
    });
  });
});
