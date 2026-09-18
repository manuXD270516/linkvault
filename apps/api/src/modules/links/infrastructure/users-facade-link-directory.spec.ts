import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryUserRepository } from '../../users/application/testing/in-memory-user.repository';
import { UsersFacade } from '../../users/application/users.facade';
import { MovableClock } from '../application/testing/links-test-doubles';
import { UsersFacadeLinkDirectory } from './users-facade-link-directory';

// Adaptador LINK_USER_DIRECTORY sobre UsersFacade (D1 de job-links), con el repositorio en memoria de `users`: `links`
// nunca toca la colección `users`.

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

let users: UsersFacade;
let directory: UsersFacadeLinkDirectory;

beforeEach(() => {
  users = new UsersFacade(new InMemoryUserRepository(), new MovableClock());
  directory = new UsersFacadeLinkDirectory(users);
});

async function register(email: string, displayName: string) {
  const { id } = await users.createWithPassword({
    email,
    passwordHash: HASH,
    displayName,
  });
  return id;
}

describe('UsersFacadeLinkDirectory', () => {
  it('returns the display name of everybody who shared a link on the page', async () => {
    const ana = await register('ana@example.com', 'Ana');
    const beto = await register('beto@example.com', 'Beto');

    expect(await directory.displayNamesOf([ana, beto])).toEqual(
      new Map([
        [ana, 'Ana'],
        [beto, 'Beto'],
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

    expect(JSON.stringify([...names])).not.toContain('example.com');
  });
});
