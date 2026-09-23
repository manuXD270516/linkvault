import {
  GROUP_WEEKLY_DIGEST_TYPE,
  groupDigestAggregateKey,
} from '@linkvault/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  aggregateDigestLinks,
  digestHasContent,
} from '../domain/digest-content';
import { prefsOf, typeEnabled } from '../domain/fanout';
import { windowForWeekKey } from '../domain/iso-week';
import {
  GROUP_DIGEST_CATALOG,
  GROUP_DIGEST_ENABLED,
  NOTIFY_CLOCK,
  NOTIFY_DELIVERY_LEDGER,
  NOTIFY_GROUP_DIRECTORY,
  NOTIFY_MAILER,
  NOTIFY_PREFERENCES_READER,
  NOTIFY_USER_DIRECTORY,
  NOTIFY_WEB_BASE_URL,
  type Clock,
  type GroupDigestCatalog,
  type NotifyDeliveryLedger,
  type NotifyGroupDirectory,
  type NotifyMailer,
  type NotifyPreferencesReader,
  type NotifyUserDirectory,
} from './ports/notify.ports';

const GROUP_PAGE = 50;
/** Lee filas suficientes para rellenar el tope de títulos (sharedAt desc). */
const LINK_FETCH_LIMIT = 200;

/**
 * Job raíz del digest semanal (ADR-035 B10): por cada grupo con links en W−1,
 * email a miembros verificados sin opt-out. Solo canal email; vacío → sin ledger.
 */
@Injectable()
export class ProcessGroupWeeklyDigest {
  private readonly logger = new Logger(ProcessGroupWeeklyDigest.name);

  constructor(
    @Inject(GROUP_DIGEST_ENABLED) private readonly enabled: boolean,
    @Inject(GROUP_DIGEST_CATALOG) private readonly catalog: GroupDigestCatalog,
    @Inject(NOTIFY_GROUP_DIRECTORY)
    private readonly groups: NotifyGroupDirectory,
    @Inject(NOTIFY_PREFERENCES_READER)
    private readonly preferences: NotifyPreferencesReader,
    @Inject(NOTIFY_USER_DIRECTORY)
    private readonly users: NotifyUserDirectory,
    @Inject(NOTIFY_DELIVERY_LEDGER)
    private readonly ledger: NotifyDeliveryLedger,
    @Inject(NOTIFY_MAILER) private readonly mailer: NotifyMailer,
    @Inject(NOTIFY_WEB_BASE_URL) private readonly webBaseUrl: string,
    @Inject(NOTIFY_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(weekKey: string): Promise<{
    readonly groupsScanned: number;
    readonly emailsSent: number;
  }> {
    if (!this.enabled) {
      return { groupsScanned: 0, emailsSent: 0 };
    }

    const { start, end } = windowForWeekKey(weekKey);
    let afterId: string | null = null;
    let groupsScanned = 0;
    let emailsSent = 0;

    for (;;) {
      const page = await this.catalog.listGroupIds({
        afterId,
        limit: GROUP_PAGE,
      });
      if (page.groupIds.length === 0) {
        break;
      }
      for (const groupId of page.groupIds) {
        groupsScanned += 1;
        emailsSent += await this.processGroup({
          weekKey,
          groupId,
          windowStart: start,
          windowEnd: end,
        });
      }
      if (page.nextCursor === null) {
        break;
      }
      afterId = page.nextCursor;
    }

    return { groupsScanned, emailsSent };
  }

  private async processGroup(params: {
    readonly weekKey: string;
    readonly groupId: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
  }): Promise<number> {
    const total = await this.catalog.countLinksInWindow({
      groupId: params.groupId,
      windowStart: params.windowStart,
      windowEnd: params.windowEnd,
    });
    if (total === 0) {
      return 0;
    }

    const rows = await this.catalog.listLinksInWindow({
      groupId: params.groupId,
      windowStart: params.windowStart,
      windowEnd: params.windowEnd,
      limit: Math.min(total, LINK_FETCH_LIMIT),
    });
    const agg = aggregateDigestLinks(
      rows.map((r) => ({
        linkId: r.linkId,
        sharedAt: r.sharedAt,
        title: r.title,
      })),
    );
    // “y K más” respecto al total de la ventana, no solo los titulados leídos.
    const withMore = {
      ...agg,
      moreCount: Math.max(0, total - agg.items.length),
      totalInWindow: total,
    };
    if (!digestHasContent(withMore)) {
      return 0;
    }

    const groupName = await this.groups.groupNameOf(params.groupId);
    const members = await this.groups.memberIdsOf(params.groupId);
    if (members.length === 0) {
      return 0;
    }

    const prefsEntries = await Promise.all(
      members.map(async (userId) => {
        const stored = await this.preferences.findByUserId(userId);
        return [userId, prefsOf(stored)] as const;
      }),
    );
    const eligibleIds: string[] = [];
    for (const [userId, prefs] of prefsEntries) {
      if (typeEnabled(prefs, GROUP_WEEKLY_DIGEST_TYPE)) {
        eligibleIds.push(userId);
      }
    }
    if (eligibleIds.length === 0) {
      return 0;
    }

    const profiles = await this.users.profilesOf(eligibleIds);
    const aggregateKey = groupDigestAggregateKey(
      params.weekKey,
      params.groupId,
    );
    const actionUrl = `${this.webBaseUrl}/grupos/${params.groupId}`;
    const preferencesUrl = `${this.webBaseUrl}/notificaciones`;
    const linkTitles = withMore.items.map((i) => i.title);
    let sent = 0;

    for (const profile of profiles) {
      if (!profile.emailVerified) {
        continue;
      }
      const now = this.clock.now();
      const key = {
        type: GROUP_WEEKLY_DIGEST_TYPE,
        aggregateKey,
        userId: profile.userId,
        channel: 'email' as const,
      };
      const claim = await this.ledger.claim(key, now);
      if (claim === 'already_done' || claim === 'in_flight') {
        continue;
      }
      try {
        await this.mailer.send({
          to: profile.email,
          templateId: 'group-weekly-digest',
          locale: profile.outputLanguage,
          variables: {
            displayName: profile.displayName,
            actionUrl,
            preferencesUrl,
            linkTitles,
            moreCount: withMore.moreCount,
            ...(groupName === null || groupName === ''
              ? {}
              : { groupName }),
          },
        });
        await this.ledger.markCompleted(key, this.clock.now());
        sent += 1;
      } catch (error: unknown) {
        this.logger.warn(
          `digest email failed: ${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
        await this.ledger.markFailed(key, this.clock.now());
      }
    }
    return sent;
  }
}
