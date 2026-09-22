import { describe, expect, it } from 'vitest';
import {
  GROUP_LINK_ADDED_EVENT_TYPE,
  groupLinkAddedEvent,
  groupLinkAddedEventSchema,
  groupLinkAddedJobId,
} from './group-link-added.event';
import {
  APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
  applicationStatusNotifyEvent,
  applicationStatusNotifyEventSchema,
  applicationStatusNotifyJobId,
} from './application-status-notify.event';

describe('GroupLinkAdded.v1', () => {
  const payload = {
    groupId: 'g1',
    linkId: 'l1',
    actorUserId: 'u1',
  };

  it('acepta el contrato', () => {
    const event = groupLinkAddedEvent(payload);
    expect(groupLinkAddedEventSchema.parse(event).type).toBe(
      GROUP_LINK_ADDED_EVENT_TYPE,
    );
    expect(groupLinkAddedJobId(payload)).toBe('notify:gla:g1_l1_u1');
    expect(groupLinkAddedJobId(payload).split(':')).toHaveLength(3);
  });

  it('rechaza payload incompleto', () => {
    expect(
      groupLinkAddedEventSchema.safeParse({
        type: GROUP_LINK_ADDED_EVENT_TYPE,
        payload: { groupId: 'g1' },
      }).success,
    ).toBe(false);
  });
});

describe('ApplicationStatusNotify.v1', () => {
  const at = '2026-09-22T12:00:00.000Z';
  const payload = {
    applicationId: 'a1',
    linkId: 'l1',
    actorUserId: 'u1',
    status: 'applied' as const,
    statusChangedAt: at,
  };

  it('acepta sin groupId', () => {
    const event = applicationStatusNotifyEvent(payload);
    expect(applicationStatusNotifyEventSchema.parse(event).type).toBe(
      APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
    );
    expect(applicationStatusNotifyJobId(payload)).toBe(
      'notify:asn:a1_applied_union_2026-09-22T120000.000Z',
    );
    expect(applicationStatusNotifyJobId(payload).split(':')).toHaveLength(3);
  });

  it('acepta con groupId', () => {
    const withGroup = { ...payload, groupId: 'g1' };
    expect(
      applicationStatusNotifyEventSchema.parse(
        applicationStatusNotifyEvent(withGroup),
      ).payload.groupId,
    ).toBe('g1');
    expect(applicationStatusNotifyJobId(withGroup)).toBe(
      'notify:asn:a1_applied_g1_2026-09-22T120000.000Z',
    );
  });

  it('rechaza sin statusChangedAt', () => {
    expect(
      applicationStatusNotifyEventSchema.safeParse({
        type: APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
        payload: {
          applicationId: 'a1',
          linkId: 'l1',
          actorUserId: 'u1',
          status: 'applied',
        },
      }).success,
    ).toBe(false);
  });

  it('reopen applied→X→applied produce jobIds distintos (D6)', () => {
    const first = applicationStatusNotifyJobId({
      ...payload,
      status: 'applied',
      statusChangedAt: '2026-09-22T12:00:00.000Z',
    });
    const middle = applicationStatusNotifyJobId({
      ...payload,
      status: 'in_process',
      statusChangedAt: '2026-09-22T13:00:00.000Z',
    });
    const reopen = applicationStatusNotifyJobId({
      ...payload,
      status: 'applied',
      statusChangedAt: '2026-09-22T14:00:00.000Z',
    });
    expect(first).not.toBe(middle);
    expect(first).not.toBe(reopen);
    expect(first.split(':')).toHaveLength(3);
    expect(reopen.split(':')).toHaveLength(3);
  });
});
