import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryUserRepository } from '../../users/application/testing/in-memory-user.repository';
import { UsersFacade } from '../../users/application/users.facade';
import { MovableClock } from '../application/testing/groups-test-doubles';
import { UsersFacadeMemberDirectory } from './users-facade-member-directory';

// Adaptador GROUP_MEMBER_DIRECTORY sobre UsersFacade (D7), con el repositorio en memoria de `users`: `groups` nunca
// toca la colección `users`.

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

describe('UsersFacadeMemberDirectory', () => {
  let users: UsersFacade;
  let directory: UsersFacadeMemberDirectory;

  beforeEach(() => {
    users = new UsersFacade(new InMemoryUserRepository(), new MovableClock());
    directory = new UsersFacadeMemberDirectory(users);
  });

  async function register(email: string, displayName: string) {
    const { id } = await users.createWithPassword({
      email,
      passwordHash: HASH,
      displayName,
    });
    return id;
  }

  it('returns the display name of every member', async () => {
    const ana = await register('ana@example.com', 'Ana');
    const bruno = await register('bruno@example.com', 'Bruno');

    expect(await directory.displayNamesOf([ana, bruno])).toEqual(
      new Map([
        [ana, 'Ana'],
        [bruno, 'Bruno'],
      ]),
    );
  });

  it('leaves ids without a user out of the map', async () => {
    const ana = await register('ana@example.com', 'Ana');

    const names = await directory.displayNamesOf([ana, 'user-404']);

    expect(names.has('user-404')).toBe(false);
    expect([...names]).toEqual([[ana, 'Ana']]);
  });

  it('returns an empty map for an empty list', async () => {
    await register('ana@example.com', 'Ana');

    expect(await directory.displayNamesOf([])).toEqual(new Map());
  });

  it('exposes only display names, never the email', async () => {
    const ana = await register('ana@example.com', 'Ana');

    const names = await directory.displayNamesOf([ana]);

    expect([...names.values()]).toEqual(['Ana']);
    expect(JSON.stringify([...names])).not.toContain('example.com');
  });
});
