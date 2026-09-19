import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import { Logger } from '@nestjs/common';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GroupsFacade } from '../application/groups.facade';
import {
  GROUP_MEMBERS_COLLECTION,
  ONE_OWNER_PER_GROUP_INDEX,
} from '../infrastructure/group.schemas';
import { GroupsModule } from './groups.module';

// Arranque de `GroupsModule` con datos antiguos incoherentes (tarea 2.6, ADR-025 §5): un grupo con dos owners impide
// construir `one_owner_per_group`. El módulo espera a los índices, registra un `error` sin datos personales y arranca.

describe('GroupsModule startup with two owners in a group', () => {
  const dbName = `groups-startup-${randomUUID()}`;
  const groupId = new mongoose.Types.ObjectId();
  const firstOwner = new mongoose.Types.ObjectId();
  const secondOwner = new mongoose.Types.ObjectId();
  const errors: string[] = [];
  let moduleRef: TestingModule;
  let connection: Connection;

  beforeAll(async () => {
    // Los datos se siembran antes de que exista ningún índice: así estaban antes de este change.
    const seed = await mongoose
      .createConnection(getMongoTestUri(), { dbName })
      .asPromise();
    await seed.collection(GROUP_MEMBERS_COLLECTION).insertMany([
      { groupId, userId: firstOwner, role: 'owner', joinedAt: new Date() },
      { groupId, userId: secondOwner, role: 'owner', joinedAt: new Date() },
    ]);
    await seed.close();

    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (message: unknown) => {
        errors.push(String(message));
      },
    );
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(getMongoTestUri(), { dbName }),
        GroupsModule,
      ],
    }).compile();
    await moduleRef.init();
    // El arranque no espera a los índices; el test sí, para leer el `error` sin depender del reloj.
    await moduleRef.get(GroupsModule).indexesReady;
    connection = moduleRef.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await connection.dropDatabase();
    await moduleRef.close();
  });

  it('logs an error naming the index and the reason, without group or user ids', () => {
    const logged = errors.filter((message) =>
      message.includes(ONE_OWNER_PER_GROUP_INDEX),
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/11000/);
    for (const message of errors) {
      expect(message).not.toContain(groupId.toHexString());
      expect(message).not.toContain(firstOwner.toHexString());
      expect(message).not.toContain(secondOwner.toHexString());
    }
  });

  it('starts anyway and keeps answering', async () => {
    await expect(
      moduleRef
        .get(GroupsFacade, { strict: false })
        .membershipOf(groupId.toHexString(), firstOwner.toHexString()),
    ).resolves.toBe('owner');
    const indexes = await connection
      .collection(GROUP_MEMBERS_COLLECTION)
      .indexes();
    expect(indexes.map((index) => index.name)).not.toContain(
      ONE_OWNER_PER_GROUP_INDEX,
    );
  });
});
