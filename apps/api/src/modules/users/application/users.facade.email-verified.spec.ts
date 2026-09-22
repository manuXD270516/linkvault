import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from './ports/clock.port';
import { InMemoryUserRepository } from './testing/in-memory-user.repository';
import { UsersFacade } from './users.facade';

class FixedClock implements Clock {
  constructor(public current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
}

describe('UsersFacade emailVerified', () => {
  let repository: InMemoryUserRepository;
  let facade: UsersFacade;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
    facade = new UsersFacade(
      repository,
      new FixedClock(new Date('2026-09-17T10:00:00.000Z')),
    );
  });

  it('Registro nuevo sin verificar', async () => {
    const profile = await facade.createWithPassword({
      email: 'ana@example.com',
      passwordHash: 'hash',
      displayName: 'Ana',
    });
    expect(profile.emailVerified).toBe(false);
  });

  it('markEmailVerified marca el campo', async () => {
    const profile = await facade.createWithPassword({
      email: 'ana@example.com',
      passwordHash: 'hash',
      displayName: 'Ana',
    });
    await facade.markEmailVerified(profile.id);
    expect((await facade.getProfile(profile.id))?.emailVerified).toBe(true);
  });
});
