import { describe, expect, it } from 'vitest';
import {
  GroupDeletionHooks,
  type GroupDeletionHook,
  type GroupDeletionSession,
} from './group-deletion-hooks';

// Registro de hooks del borrado de grupo (tarea 6.1 de job-links).

const GROUP_ID = '66e9a0000000000000000001';
const SESSION: GroupDeletionSession = { transaction: true };

/** Hook de mentira que apunta con qué se le llamó. */
class SpyHook implements GroupDeletionHook {
  readonly calls: { groupId: string; session: GroupDeletionSession }[] = [];

  constructor(private readonly fail = false) {}

  deleteRelationsOf(
    groupId: string,
    session: GroupDeletionSession,
  ): Promise<void> {
    this.calls.push({ groupId, session });
    return this.fail
      ? Promise.reject(new Error('the hook failed'))
      : Promise.resolve();
  }
}

describe('GroupDeletionHooks', () => {
  it('starts with no hooks registered, so deleting behaves as before', async () => {
    const hooks = new GroupDeletionHooks();

    expect(hooks.size).toBe(0);
    await expect(hooks.runAll(GROUP_ID, SESSION)).resolves.toBeUndefined();
  });

  it('runs every registered hook with the group and the session', async () => {
    const hooks = new GroupDeletionHooks();
    const links = new SpyHook();
    const comments = new SpyHook();
    hooks.register(links);
    hooks.register(comments);

    await hooks.runAll(GROUP_ID, SESSION);

    expect(hooks.size).toBe(2);
    expect(links.calls).toEqual([{ groupId: GROUP_ID, session: SESSION }]);
    expect(comments.calls).toEqual([{ groupId: GROUP_ID, session: SESSION }]);
  });

  it('runs them in the order they were registered', async () => {
    const hooks = new GroupDeletionHooks();
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

    await hooks.runAll(GROUP_ID, SESSION);

    expect(order).toEqual(['first', 'second']);
  });

  it('lets a failure through, so the whole transaction is undone', async () => {
    const hooks = new GroupDeletionHooks();
    const after = new SpyHook();
    hooks.register(new SpyHook(true));
    hooks.register(after);

    await expect(hooks.runAll(GROUP_ID, SESSION)).rejects.toThrow(
      'the hook failed',
    );
    expect(after.calls).toEqual([]);
  });
});
