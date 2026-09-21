import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_MODEL_NAME, userSchema, type UserDocument } from './user.schema';

// Schema de `users` (tarea 7.1): campos del consentimiento versionado y `redactName` por defecto.

let connection: Connection;

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `users-schema-${randomUUID()}`,
    })
    .asPromise();
  connection.model<UserDocument>(USER_MODEL_NAME, userSchema);
});

afterAll(async () => {
  await connection.close();
});

describe('userSchema', () => {
  it.each([
    ['aiConsent.externalProviders'],
    ['outputLanguage'],
    ['redactName'],
    ['displayName'],
    ['email'],
  ] as const)('requires %s', (path) => {
    const schemaPath = userSchema.path(path);
    expect(schemaPath).toBeDefined();
    expect(schemaPath.isRequired).toBe(true);
  });

  it.each([
    ['aiConsent.consentedAt', null],
    ['aiConsent.textVersion', null],
  ] as const)('defaults %s to %j and does not require it', (path, value) => {
    const schemaPath = userSchema.path(path);
    expect(schemaPath).toBeDefined();
    expect(schemaPath.isRequired).not.toBe(true);
    expect(schemaPath.options['default']).toBe(value);
  });
});
