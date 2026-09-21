import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailAlreadyRegistered } from '../domain/errors';
import { createUser } from '../domain/user';
import { MongoUserRepository } from './mongo-user.repository';
import { USER_MODEL_NAME, USERS_COLLECTION, userSchema } from './user.schema';

// Adaptador Mongo del puerto USER_REPOSITORY (tarea 3.2 de auth-users), contra el MongoMemoryReplSet del preset de
// @linkvault/testing. Se espera `Model.init()` antes de probar el índice único (D12).

let connection: Connection;
let repository: MongoUserRepository;

const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-18T12:30:00.000Z');
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `users-${randomUUID()}` })
    .asPromise();
  repository = new MongoUserRepository(connection);
  await connection.model(USER_MODEL_NAME).init();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

function newUser(email: string, displayName = 'Ana') {
  return createUser({ email, passwordHash: HASH, displayName, now });
}

describe('MongoUserRepository', () => {
  it('declares bufferCommands false and a unique index on the normalized email', async () => {
    expect(userSchema.get('bufferCommands')).toBe(false);
    const indexes = await connection.collection(USERS_COLLECTION).indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { email: 1 }, unique: true }),
    );
  });

  it('creates a user and returns it with a string id', async () => {
    const created = await repository.create(newUser('alta@example.com'));

    expect(created).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      email: 'alta@example.com',
      passwordHash: HASH,
      passwordChangedAt: now,
      profile: {
        displayName: 'Ana',
        aiConsent: {
          externalProviders: false,
          consentedAt: null,
          textVersion: null,
        },
        outputLanguage: 'es',
        redactName: true,
      },
      createdAt: now,
    });
  });

  it('stores the normalized email and a flat profile without the plain password', async () => {
    const created = await repository.create(newUser('  Guardado@Example.com '));

    const raw = await connection
      .collection(USERS_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(created.id) });

    expect(raw).toEqual({
      _id: expect.any(mongoose.Types.ObjectId),
      email: 'guardado@example.com',
      passwordHash: HASH,
      passwordChangedAt: now,
      displayName: 'Ana',
      aiConsent: {
        externalProviders: false,
        consentedAt: null,
        textVersion: null,
      },
      outputLanguage: 'es',
      redactName: true,
      createdAt: now,
    });
  });

  it('finds a user by email and by id', async () => {
    const created = await repository.create(newUser('busca@example.com'));

    expect(await repository.findByEmail('busca@example.com')).toEqual(created);
    expect(await repository.findById(created.id)).toEqual(created);
  });

  it('returns null for an unknown email, an unknown id and a malformed id', async () => {
    expect(await repository.findByEmail('nadie@example.com')).toBeNull();
    expect(
      await repository.findById(new mongoose.Types.ObjectId().toHexString()),
    ).toBeNull();
    expect(await repository.findById('twelve-bytes')).toBeNull();
  });

  it('translates a duplicate email into EmailAlreadyRegistered', async () => {
    await repository.create(newUser('duplicado@example.com'));

    await expect(
      repository.create(newUser('DUPLICADO@example.com', 'Otra')),
    ).rejects.toBeInstanceOf(EmailAlreadyRegistered);
    expect(
      await connection
        .collection(USERS_COLLECTION)
        .countDocuments({ email: 'duplicado@example.com' }),
    ).toBe(1);
  });

  it('rejects concurrent registrations of the same email except one', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        repository.create(newUser('carrera@example.com')),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const result of results.filter((r) => r.status === 'rejected')) {
      expect(result.reason).toBeInstanceOf(EmailAlreadyRegistered);
    }
  });

  it('finds the display names of several users in one query', async () => {
    const ana = await repository.create(newUser('nombres-ana@example.com'));
    const bruno = await repository.create(
      newUser('nombres-bruno@example.com', 'Bruno'),
    );

    expect(await repository.findDisplayNames([ana.id, bruno.id])).toEqual(
      new Map([
        [ana.id, 'Ana'],
        [bruno.id, 'Bruno'],
      ]),
    );
  });

  it('leaves unknown and malformed ids out of the display names', async () => {
    const ana = await repository.create(newUser('nombres-raros@example.com'));

    expect(
      await repository.findDisplayNames([
        ana.id,
        new mongoose.Types.ObjectId().toHexString(),
        'twelve-bytes',
      ]),
    ).toEqual(new Map([[ana.id, 'Ana']]));
    expect(await repository.findDisplayNames([])).toEqual(new Map());
    expect(await repository.findDisplayNames(['nope'])).toEqual(new Map());
  });

  it('updates only the sent profile fields', async () => {
    const created = await repository.create(newUser('parcial@example.com'));
    const consentedAt = new Date('2026-09-20T12:00:00.000Z');

    const consent = await repository.updateProfile(created.id, {
      aiConsent: {
        externalProviders: true,
        consentedAt,
        textVersion: '2026-09-20',
      },
    });
    const language = await repository.updateProfile(created.id, {
      outputLanguage: 'en',
      displayName: 'Ana María',
    });

    expect(consent?.profile).toEqual({
      ...created.profile,
      aiConsent: {
        externalProviders: true,
        consentedAt,
        textVersion: '2026-09-20',
      },
    });
    expect(language).toEqual({
      ...created,
      profile: {
        displayName: 'Ana María',
        aiConsent: {
          externalProviders: true,
          consentedAt,
          textVersion: '2026-09-20',
        },
        outputLanguage: 'en',
        redactName: true,
      },
    });
    expect(await repository.findById(created.id)).toEqual(language);
  });

  it('returns null when updating the profile of an unknown or malformed id', async () => {
    expect(
      await repository.updateProfile(
        new mongoose.Types.ObjectId().toHexString(),
        { redactName: true },
      ),
    ).toBeNull();
    expect(
      await repository.updateProfile('nope', { redactName: true }),
    ).toBeNull();
  });

  it('setPasswordHash replaces the hash and sets passwordChangedAt', async () => {
    const created = await repository.create(newUser('clave@example.com'));

    expect(
      await repository.setPasswordHash(created.id, '$argon2id$new', later),
    ).toBe(true);

    expect(await repository.findById(created.id)).toEqual({
      ...created,
      passwordHash: '$argon2id$new',
      passwordChangedAt: later,
    });
  });

  it('setPasswordHash returns false for an unknown or malformed id', async () => {
    expect(
      await repository.setPasswordHash(
        new mongoose.Types.ObjectId().toHexString(),
        'h',
        later,
      ),
    ).toBe(false);
    expect(await repository.setPasswordHash('nope', 'h', later)).toBe(false);
  });
});
