import { describe, expect, it } from 'vitest';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import {
  CvDeletionHooks,
  type CvDeletionHook,
} from './cv-deletion-hooks';

// Registro de hooks del borrado de CV (tarea 11.1 de cv-match-suggestions).

const CV_ID = '66e9a0000000000000000c01';
const USER_ID = '66e9a0000000000000000a01';
const SESSION: TransactionSession = { transaction: true };

/** Hook de mentira que apunta con qué se le llamó. */
class SpyHook implements CvDeletionHook {
  readonly calls: {
    cvId: string;
    userId: string;
    session: TransactionSession;
  }[] = [];

  constructor(private readonly fail = false) {}

  deleteRelationsOf(
    cvId: string,
    userId: string,
    session: TransactionSession,
  ): Promise<void> {
    this.calls.push({ cvId, userId, session });
    return this.fail
      ? Promise.reject(new Error('the hook failed'))
      : Promise.resolve();
  }
}

describe('CvDeletionHooks', () => {
  it('starts with no hooks registered, so deleting behaves as before', async () => {
    const hooks = new CvDeletionHooks();

    expect(hooks.size).toBe(0);
    await expect(
      hooks.runAll(CV_ID, USER_ID, SESSION),
    ).resolves.toBeUndefined();
  });

  it('runs every registered hook with the cv, the owner and the session', async () => {
    const hooks = new CvDeletionHooks();
    const analyses = new SpyHook();
    const other = new SpyHook();
    hooks.register(analyses);
    hooks.register(other);

    await hooks.runAll(CV_ID, USER_ID, SESSION);

    expect(hooks.size).toBe(2);
    expect(analyses.calls).toEqual([
      { cvId: CV_ID, userId: USER_ID, session: SESSION },
    ]);
    expect(other.calls).toEqual([
      { cvId: CV_ID, userId: USER_ID, session: SESSION },
    ]);
  });

  it('runs them in the order they were registered', async () => {
    const hooks = new CvDeletionHooks();
    const order: string[] = [];
    hooks.register({
      deleteRelationsOf: () => {
        order.push('first');
        return Promise.resolve();
      },
    });
    hooks.register({
      deleteRelationsOf: () => {
        order.push('second');
        return Promise.resolve();
      },
    });

    await hooks.runAll(CV_ID, USER_ID, SESSION);

    expect(order).toEqual(['first', 'second']);
  });

  it('lets a failure through, so the whole transaction is undone', async () => {
    const hooks = new CvDeletionHooks();
    const after = new SpyHook();
    hooks.register(new SpyHook(true));
    hooks.register(after);

    await expect(hooks.runAll(CV_ID, USER_ID, SESSION)).rejects.toThrow(
      'the hook failed',
    );
    expect(after.calls).toEqual([]);
  });
});
