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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { configureApp } from '../../../app/create-app';
import {
  apiTestAiConfig,
  apiTestConfig,
} from '../../../test-support/test-config';
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
// note unset, commentCount/`commentsRevision`, ai_usage, 409 sole_owner_with_members y 204 del camino feliz.
// El deleter de S3 se sustituye para no esperar al puerto cerrado del test-config.

const PASSWORD = 'correct-horse-battery';
const AI_USAGE_COLLECTION = 'ai_usage';
const NOW = new Date('2026-09-22T12:00:00.000Z');

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

  async function authorizationFor(userId: string): Promise<string> {
    const { accessToken } = await signer.sign({
      userId,
      sessionId: randomUUID(),
    });
    return `Bearer ${accessToken}`;
  }

  function deleteMe(authorization: string, password: string) {
    if (app === undefined) {
      throw new Error('app not started');
    }
    return app.inject({
      method: 'DELETE',
      url: '/api/users/me',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      payload: { password },
    });
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

    const response = await deleteMe(await authorizationFor(ana.id), PASSWORD);

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
    await createGroup.execute(ana.id, 'Personal');

    const anaOid = new Types.ObjectId(ana.id);
    const groupOid = new Types.ObjectId(betoGroup.id);
    const linkOid = new Types.ObjectId();
    const otherAuthorOid = new Types.ObjectId(beto.id);

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
        authorId: otherAuthorOid,
        text: 'comentario de Beto',
        createdAt: NOW,
      },
    ]);
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

    const response = await deleteMe(await authorizationFor(ana.id), PASSWORD);

    expect(response.statusCode).toBe(204);
    await expect(userRepo.findById(ana.id)).resolves.toBeNull();
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
    expect(cvFiles.deletedPrefixes).toContain(ana.id);
    expect([...cvFiles.keys]).not.toContain(`${ana.id}/cv.pdf`);
  });
});
