import { beforeEach, describe, expect, it } from 'vitest';
import { APPLICATION_STATUS_NOTIFY_EVENT_TYPE } from '@linkvault/shared';
import { InvalidNotifyGroupId } from '../domain/errors';
import {
  applicationsHarness,
  objectId,
  type ApplicationsHarness,
} from './testing/applications-test-harness';

const ANA = objectId(0xa1);
const LINK = objectId(1);
const GROUP = objectId(20);

describe('ChangeApplicationStatus notification outbox', () => {
  let h: ApplicationsHarness;

  beforeEach(() => {
    h = applicationsHarness();
    h.links.withLink(LINK).readableBy(ANA, LINK).sharedIn(GROUP, LINK);
    h.groups.withMember(GROUP, ANA);
  });

  async function trackGroup(): Promise<string> {
    const { application } = await h.trackLink.execute(ANA, {
      linkId: LINK,
      status: 'interested',
    });
    await h.update.execute(ANA, application.id, { visibility: 'group' });
    return application.id;
  }

  it('encola ApplicationStatusNotify al cambiar status canónico con visibility=group', async () => {
    const id = await trackGroup();
    const app = await h.repository.findOwned(id, ANA);
    await h.changeStatus.execute(ANA, id, {
      status: 'applied',
      version: app!.version,
    });
    expect(h.outbox.appended.map((e) => e.type)).toContain(
      APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
    );
  });

  it('no encola si visibility=private', async () => {
    const { application } = await h.trackLink.execute(ANA, {
      linkId: LINK,
      status: 'interested',
    });
    await h.changeStatus.execute(ANA, application.id, {
      status: 'applied',
      version: application.version,
    });
    expect(
      h.outbox.appended.filter(
        (e) => e.type === APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
      ),
    ).toHaveLength(0);
  });

  it('no encola si solo cambia stageLabel', async () => {
    const id = await trackGroup();
    await h.changeStatus.execute(ANA, id, {
      status: 'in_process',
      stageLabel: 'Entrevista 1',
      version: 1,
    });
    const before = h.outbox.appended.filter(
      (e) => e.type === APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
    ).length;
    const app = await h.repository.findOwned(id, ANA);
    await h.changeStatus.execute(ANA, id, {
      status: 'in_process',
      stageLabel: 'Entrevista 2',
      version: app!.version,
    });
    const after = h.outbox.appended.filter(
      (e) => e.type === APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
    ).length;
    expect(after).toBe(before);
  });

  it('rechaza groupId inválido', async () => {
    const id = await trackGroup();
    const app = await h.repository.findOwned(id, ANA);
    await expect(
      h.changeStatus.execute(ANA, id, {
        status: 'applied',
        version: app!.version,
        groupId: objectId(99),
      }),
    ).rejects.toBeInstanceOf(InvalidNotifyGroupId);
  });
});
