import { beforeEach, describe, expect, it } from 'vitest';
import { NotifyGroupNotAllowed } from '../domain/errors';
import { GetNotificationPreferences } from './get-notification-preferences.usecase';
import { UpdateNotificationPreferences } from './update-notification-preferences.usecase';
import {
  AlwaysMemberMembership,
  fixedClock,
  InMemoryNotificationPreferencesRepository,
  NeverMemberMembership,
  SelectiveMembership,
} from './testing/notifications-test-doubles';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const ANA = '66e9a00000000000000000a1';

describe('GetNotificationPreferences', () => {
  let repo: InMemoryNotificationPreferencesRepository;
  let get: GetNotificationPreferences;

  beforeEach(() => {
    repo = new InMemoryNotificationPreferencesRepository();
    get = new GetNotificationPreferences(repo);
  });

  it('sin documento = todo ON y notifyOwnActions true', async () => {
    await expect(get.execute(ANA)).resolves.toEqual({
      groupNewLink: true,
      applicationStatusGroup: true,
      applicationStale: true,
      groupWeeklyDigest: true,
      notifyOwnActions: true,
      applicationStatusGroupId: null,
    });
  });
});

describe('UpdateNotificationPreferences', () => {
  let repo: InMemoryNotificationPreferencesRepository;

  beforeEach(() => {
    repo = new InMemoryNotificationPreferencesRepository();
  });

  it('opt-out de un tipo', async () => {
    const update = new UpdateNotificationPreferences(
      repo,
      new AlwaysMemberMembership(),
      fixedClock(NOW),
    );
    const result = await update.execute(ANA, { groupNewLink: false });
    expect(result.groupNewLink).toBe(false);
    expect(result.applicationStatusGroup).toBe(true);
    expect(result.groupWeeklyDigest).toBe(true);
    expect(await repo.findByUserId(ANA)).toMatchObject({ groupNewLink: false });
  });

  it('opt-out de groupWeeklyDigest', async () => {
    const update = new UpdateNotificationPreferences(
      repo,
      new AlwaysMemberMembership(),
      fixedClock(NOW),
    );
    const result = await update.execute(ANA, { groupWeeklyDigest: false });
    expect(result.groupWeeklyDigest).toBe(false);
    expect(result.groupNewLink).toBe(true);
    expect(await repo.findByUserId(ANA)).toMatchObject({
      groupWeeklyDigest: false,
    });
  });

  it('configura applicationStatusGroupId si es miembro', async () => {
    const groupId = '66e9a00000000000000000g1';
    const update = new UpdateNotificationPreferences(
      repo,
      new SelectiveMembership(new Set([groupId])),
      fixedClock(NOW),
    );
    const result = await update.execute(ANA, {
      applicationStatusGroupId: groupId,
    });
    expect(result.applicationStatusGroupId).toBe(groupId);
  });

  it('rechaza groupId si no es miembro', async () => {
    const update = new UpdateNotificationPreferences(
      repo,
      new NeverMemberMembership(),
      fixedClock(NOW),
    );
    await expect(
      update.execute(ANA, {
        applicationStatusGroupId: '66e9a00000000000000000xx',
      }),
    ).rejects.toBeInstanceOf(NotifyGroupNotAllowed);
    await expect(repo.findByUserId(ANA)).resolves.toBeNull();
  });

  it('permite limpiar applicationStatusGroupId a null', async () => {
    const groupId = '66e9a00000000000000000g1';
    const update = new UpdateNotificationPreferences(
      repo,
      new SelectiveMembership(new Set([groupId])),
      fixedClock(NOW),
    );
    await update.execute(ANA, { applicationStatusGroupId: groupId });
    const cleared = await update.execute(ANA, {
      applicationStatusGroupId: null,
    });
    expect(cleared.applicationStatusGroupId).toBeNull();
  });
});
