import {
  APPLICATION_ANALYTICS_STALE_CAP,
  APPLICATION_STALE_AFTER_DAYS,
  applicationAnalyticsResponseSchema,
} from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applicationsHarness,
  objectId,
  type ApplicationsHarness,
} from './testing/applications-test-harness';

const ANA = objectId(0xa1);
const BETO = objectId(0xb2);
const DAY = 24 * 60 * 60 * 1000;

let h: ApplicationsHarness;
let linkSeq = 1;

beforeEach(() => {
  h = applicationsHarness();
  linkSeq = 1;
});

function nextLink(): string {
  const id = objectId(0x1000 + linkSeq);
  linkSeq += 1;
  h.links.withLink(id).readableBy(ANA, id).readableBy(BETO, id);
  return id;
}

async function trackApplied(userId: string, linkId: string) {
  return (
    await h.trackLink.execute(userId, { linkId, status: 'applied' })
  ).application;
}

describe('GetApplicationAnalytics', () => {
  it('returns zeros and empty stale for a user with no applications', async () => {
    const response = await h.analytics.execute(ANA);

    expect(applicationAnalyticsResponseSchema.parse(response)).toEqual({
      byStatus: {
        saved: 0,
        interested: 0,
        applied: 0,
        in_process: 0,
        offer: 0,
        accepted: 0,
        rejected: 0,
        withdrawn: 0,
        expired: 0,
      },
      openCount: 0,
      closedCount: 0,
      acceptedCount: 0,
      stale: [],
    });
  });

  it('counts accepted separately from closed and never lists it as stale', async () => {
    const linkId = nextLink();
    const application = await trackApplied(ANA, linkId);
    await h.changeStatus.execute(ANA, application.id, {
      status: 'accepted',
      version: application.version,
    });
    h.repository.overwrite(application.id, {
      statusChangedAt: new Date(
        h.clock.now().getTime() - (APPLICATION_STALE_AFTER_DAYS + 1) * DAY,
      ),
    });

    const response = await h.analytics.execute(ANA);

    expect(applicationAnalyticsResponseSchema.parse(response)).toMatchObject({
      byStatus: expect.objectContaining({ accepted: 1 }),
      acceptedCount: 1,
      closedCount: 0,
      openCount: 0,
      stale: [],
    });
  });

  it('does not list closed statuses in stale even when old', async () => {
    const linkId = nextLink();
    const application = await trackApplied(ANA, linkId);
    await h.changeStatus.execute(ANA, application.id, {
      status: 'rejected',
      version: application.version,
    });
    h.repository.overwrite(application.id, {
      statusChangedAt: new Date(
        h.clock.now().getTime() - (APPLICATION_STALE_AFTER_DAYS + 1) * DAY,
      ),
    });

    const response = await h.analytics.execute(ANA);

    expect(response.closedCount).toBe(1);
    expect(response.stale).toEqual([]);
  });

  it('lists an applied application stale after 11 days', async () => {
    const linkId = nextLink();
    const application = await trackApplied(ANA, linkId);
    const elevenDaysAgo = new Date(
      h.clock.now().getTime() - (APPLICATION_STALE_AFTER_DAYS + 1) * DAY,
    );
    h.repository.overwrite(application.id, {
      statusChangedAt: elevenDaysAgo,
    });

    const response = await h.analytics.execute(ANA);

    expect(response.stale).toEqual([
      {
        applicationId: application.id,
        linkId,
        status: 'applied',
        statusChangedAt: elevenDaysAgo.toISOString(),
      },
    ]);
    expect(response.openCount).toBe(1);
    expect(response.byStatus.applied).toBe(1);
  });

  it('caps stale at 20 oldest-first when 25 qualify', async () => {
    const created: { id: string; changedAt: Date }[] = [];
    for (let index = 0; index < 25; index += 1) {
      const linkId = nextLink();
      const application = await trackApplied(ANA, linkId);
      const changedAt = new Date(
        h.clock.now().getTime() -
          (APPLICATION_STALE_AFTER_DAYS + 1 + index) * DAY,
      );
      h.repository.overwrite(application.id, { statusChangedAt: changedAt });
      created.push({ id: application.id, changedAt });
    }

    const response = await h.analytics.execute(ANA);

    expect(response.stale).toHaveLength(APPLICATION_ANALYTICS_STALE_CAP);
    const expectedOldest = [...created]
      .sort(
        (left, right) =>
          left.changedAt.getTime() - right.changedAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, APPLICATION_ANALYTICS_STALE_CAP)
      .map((row) => row.id);
    expect(response.stale.map((item) => item.applicationId)).toEqual(
      expectedOldest,
    );
  });

  it('does not leak another user applications into counts or stale', async () => {
    const anaLink = nextLink();
    const betoLink = nextLink();
    await trackApplied(ANA, anaLink);
    const betoApp = await trackApplied(BETO, betoLink);
    const elevenDaysAgo = new Date(
      h.clock.now().getTime() - (APPLICATION_STALE_AFTER_DAYS + 1) * DAY,
    );
    h.repository.overwrite(betoApp.id, {
      status: 'rejected',
      statusChangedAt: elevenDaysAgo,
    });

    const response = await h.analytics.execute(ANA);

    expect(response.byStatus.applied).toBe(1);
    expect(response.byStatus.rejected).toBe(0);
    expect(response.closedCount).toBe(0);
    expect(response.openCount).toBe(1);
    expect(response.stale).toEqual([]);
    expect(response.stale.map((item) => item.applicationId)).not.toContain(
      betoApp.id,
    );
  });

  it('splits open, closed and applied/rejected funnel buckets', async () => {
    const appliedLink = nextLink();
    const rejectedLink = nextLink();
    await trackApplied(ANA, appliedLink);
    const rejected = await trackApplied(ANA, rejectedLink);
    await h.changeStatus.execute(ANA, rejected.id, {
      status: 'rejected',
      version: rejected.version,
    });

    const response = await h.analytics.execute(ANA);

    expect(response.byStatus.applied).toBe(1);
    expect(response.byStatus.rejected).toBe(1);
    expect(response.openCount).toBe(1);
    expect(response.closedCount).toBe(1);
    expect(response.acceptedCount).toBe(0);
  });
});
