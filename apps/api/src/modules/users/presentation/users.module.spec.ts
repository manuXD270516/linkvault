import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetMyProfile } from '../application/get-my-profile.usecase';
import { UpdateMyProfile } from '../application/update-my-profile.usecase';
import { UsersFacade } from '../application/users.facade';
import { USER_MODEL_NAME } from '../infrastructure/user.schema';
import { UsersModule } from './users.module';

// Cableado de `UsersModule` con la conexión Mongoose por defecto, contra el MongoMemoryReplSet del preset.

describe('UsersModule', () => {
  let moduleRef: TestingModule;
  let connection: Connection;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(getMongoTestUri(), {
          dbName: `users-module-${randomUUID()}`,
        }),
        UsersModule,
      ],
    }).compile();
    connection = moduleRef.get<Connection>(getConnectionToken());
    await connection.model(USER_MODEL_NAME).init();
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await moduleRef.close();
  });

  it('resolves the facade and the use cases over Mongo', async () => {
    const facade = moduleRef.get(UsersFacade);

    const created = await facade.createWithPassword({
      email: 'Modulo@Example.com',
      passwordHash: '$argon2id$hash',
      displayName: 'Ana',
    });
    const updated = await moduleRef
      .get(UpdateMyProfile)
      .execute(created.id, { redactName: true });

    expect(created.email).toBe('modulo@example.com');
    expect(await moduleRef.get(GetMyProfile).execute(created.id)).toEqual(
      updated,
    );
    expect(updated.redactName).toBe(true);
    expect(await facade.getAuthState(created.id)).toEqual({
      userId: created.id,
      passwordChangedAt: new Date(created.createdAt),
    });
  });
});
