import { beforeEach, describe, expect, it } from 'vitest';
import {
  APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
  applicationStatusNotifyJobId,
  type ApplicationStatusNotifyPayload,
} from '@linkvault/shared';
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

  function notifyPayloads(): ApplicationStatusNotifyPayload[] {
    return h.outbox.appended
      .filter((e) => e.type === APPLICATION_STATUS_NOTIFY_EVENT_TYPE)
      .map((e) => e.payload as ApplicationStatusNotifyPayload);
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
    const [payload] = notifyPayloads();
    expect(payload?.statusChangedAt).toBe(h.clock.now().toISOString());
  });

  it('con groupId válido incluye groupId y statusChangedAt en el outbox', async () => {
    const id = await trackGroup();
    const app = await h.repository.findOwned(id, ANA);
    await h.changeStatus.execute(ANA, id, {
      status: 'applied',
      version: app!.version,
      groupId: GROUP,
    });
    const [payload] = notifyPayloads();
    expect(payload).toMatchObject({
      applicationId: id,
      linkId: LINK,
      actorUserId: ANA,
      status: 'applied',
      groupId: GROUP,
      statusChangedAt: h.clock.now().toISOString(),
    });
  });

  it('reopen applied→in_process→applied produce jobIds distintos (D6)', async () => {
    const id = await trackGroup();
    let app = await h.repository.findOwned(id, ANA);
    await h.changeStatus.execute(ANA, id, {
      status: 'applied',
      version: app!.version,
    });
    const atApplied = h.clock.now().toISOString();
    h.clock.advance(60_000);
    app = await h.repository.findOwned(id, ANA);
    await h.changeStatus.execute(ANA, id, {
      status: 'in_process',
      version: app!.version,
    });
    h.clock.advance(60_000);
    app = await h.repository.findOwned(id, ANA);
    await h.changeStatus.execute(ANA, id, {
      status: 'applied',
      version: app!.version,
    });
    const atReopen = h.clock.now().toISOString();
    const payloads = notifyPayloads();
    expect(payloads).toHaveLength(3);
    expect(payloads[0]?.status).toBe('applied');
    expect(payloads[2]?.status).toBe('applied');
    expect(payloads[0]?.statusChangedAt).toBe(atApplied);
    expect(payloads[2]?.statusChangedAt).toBe(atReopen);
    const jobIds = payloads.map((p) => applicationStatusNotifyJobId(p));
    expect(jobIds[0]).not.toBe(jobIds[2]);
    expect(jobIds.every((id) => id.split(':').length === 3)).toBe(true);
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
