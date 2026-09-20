import { mongo } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { duplicateKeyIs } from './duplicate-key';

// Tabla pura de `duplicateKeyIs`, que vivía en `groups/infrastructure/group.schemas.spec.ts` y se mudó con la función
// (D10 de public-preview-share). Los casos con índices reales siguen en los tests de cada módulo, que son los que
// comprueban que distingue **sus** índices.

const OWNER_KEY: Readonly<Record<string, 1>> = { groupId: 1 };
const MEMBERSHIP_KEY: Readonly<Record<string, 1>> = { groupId: 1, userId: 1 };

describe('duplicateKeyIs', () => {
  it.each([
    ['no error', undefined],
    ['a plain error', new Error('E11000 duplicate key error')],
    ['another server error', new mongo.MongoServerError({ code: 112 })],
    [
      'a duplicate key without keyPattern',
      new mongo.MongoServerError({ code: 11_000 }),
    ],
    [
      'a pattern with more fields',
      new mongo.MongoServerError({
        code: 11_000,
        keyPattern: { groupId: 1, role: 1 },
      }),
    ],
  ])('is false for %s', (_case, error) => {
    expect(duplicateKeyIs(error, OWNER_KEY)).toBe(false);
  });

  it('recognizes the index whose whole key pattern matches', () => {
    const error = new mongo.MongoServerError({
      code: 11_000,
      keyPattern: { groupId: 1 },
    });

    expect(duplicateKeyIs(error, OWNER_KEY)).toBe(true);
    // Comparte el campo `groupId` con el de membresía, pero no es él: el `keyPattern` completo los distingue.
    expect(duplicateKeyIs(error, MEMBERSHIP_KEY)).toBe(false);
  });

  it('distinguishes two patterns with the same fields in another order', () => {
    const error = new mongo.MongoServerError({
      code: 11_000,
      keyPattern: { groupId: 1, userId: 1 },
    });

    expect(duplicateKeyIs(error, MEMBERSHIP_KEY)).toBe(true);
    expect(duplicateKeyIs(error, { userId: 1, groupId: 1 })).toBe(false);
  });

  it('distinguishes the direction of the index', () => {
    const error = new mongo.MongoServerError({
      code: 11_000,
      keyPattern: { 'publicShare.slug': 1 },
    });

    expect(duplicateKeyIs(error, { 'publicShare.slug': 1 })).toBe(true);
    expect(duplicateKeyIs(error, { 'publicShare.slug': -1 })).toBe(false);
  });

  it('does not parse errmsg, which carries the duplicated value', () => {
    const error = new mongo.MongoServerError({
      code: 11_000,
      errmsg:
        'E11000 duplicate key error collection: linkvault.users index: email_1 dup key: { email: "ana@example.com" }',
    });

    expect(duplicateKeyIs(error, { email: 1 })).toBe(false);
  });
});
