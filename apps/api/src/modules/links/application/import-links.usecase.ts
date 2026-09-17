import type {
  ImportLinksRequest,
  ImportLinksResponse,
  JobLinkSummary,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound } from '../../groups/domain/errors';
import type { NewJobLink } from '../domain/job-link';
import { extractUrls } from '../domain/link-text';
import { assertImportTextWithinLimit, MAX_LINKS_PER_IMPORT } from '../domain/limits';
import { toJobLinkSummary, toLinkSharer } from './link.mapper';
import { LINKS_CLOCK, type Clock } from './ports/clock.port';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
} from './ports/group-membership.port';
import {
  JOB_LINK_REPOSITORY,
  type JobLinkRepository,
} from './ports/job-link-repository.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import { OUTBOX, type Outbox } from './ports/outbox.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';
import { draftFrom, saveOneLink, type SavedLink } from './save-one-link';

/**
 * `POST /api/links/import` (spec links/sharing): pegar el chat entero y quedarse con las ofertas. El texto se recorre en
 * memoria y NO se guarda en ninguna colección ni se registra en ningún log: solo salen de aquí las URLs extraídas y lo
 * que de ellas se deriva, que es lo que permite pegar una conversación con nombres y teléfonos sin miedo.
 *
 * El orden es el del texto. Cada link va en su **propia transacción** (D5): un fallo aislado no tira el resto, y una
 * importación de 50 links no es una transacción larga contra `transactionLifetimeLimitSeconds`. El tope de 50 cuenta
 * solo los que hay que guardar, así que volver a pegar el mismo chat avanza con los siguientes.
 */
@Injectable()
export class ImportLinks {
  constructor(
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    request: ImportLinksRequest,
  ): Promise<ImportLinksResponse> {
    assertImportTextWithinLimit(request.text);
    const groupId = request.groupId;
    if (
      groupId !== undefined &&
      (await this.membership.membershipOf(groupId, userId)) === null
    ) {
      throw new GroupNotFound();
    }

    const extracted = extractUrls(request.text);
    const drafts = this.draftsOf(extracted.urls, userId);
    let unrecognized = extracted.unrecognized;
    let created = 0;
    let existing = 0;
    let skipped = 0;
    const saved: SavedLink[] = [];

    for (const draft of drafts) {
      if (created >= MAX_LINKS_PER_IMPORT) {
        // Ya se guardaron 50 en esta llamada: el resto espera a la siguiente pasada, sin error.
        skipped += 1;
        continue;
      }
      try {
        const link = await saveOneLink(this.writers(), {
          draft,
          userId,
          ...(groupId === undefined ? {} : { groupId }),
          now: this.clock.now(),
        });
        saved.push(link);
        if (link.shared === 'created') {
          created += 1;
        } else {
          existing += 1;
        }
      } catch {
        // Un fallo aislado (una carrera perdida, una escritura rechazada) no impide el resto del chat.
        unrecognized += 1;
      }
    }

    return {
      created,
      existing,
      unrecognized,
      skipped,
      links: await this.toSummaries(saved, groupId !== undefined),
    };
  }

  /**
   * Borradores en el orden del texto, sin repetir la misma vacante: dos URLs distintas del mismo puesto (la página de
   * la oferta y la de la búsqueda) comparten clave de dedupe y son una sola entrada de la importación.
   */
  private draftsOf(urls: readonly string[], userId: string): NewJobLink[] {
    const now = this.clock.now();
    const drafts: NewJobLink[] = [];
    const keys = new Set<string>();
    for (const url of urls) {
      const draft = draftFrom(url, userId, now);
      if (draft === null || keys.has(draft.dedupeKey)) {
        continue;
      }
      keys.add(draft.dedupeKey);
      drafts.push(draft);
    }
    return drafts;
  }

  /** Nombres de quien compartió, resueltos de una vez para toda la importación. */
  private async toSummaries(
    saved: readonly SavedLink[],
    inGroup: boolean,
  ): Promise<JobLinkSummary[]> {
    const names = inGroup
      ? await this.directory.displayNamesOf(
          saved.map((entry) => entry.sharedBy),
        )
      : new Map<string, string>();
    return saved.map((entry) =>
      toJobLinkSummary(entry.link, {
        sharedAt: entry.sharedAt,
        ...(inGroup
          ? { sharedBy: toLinkSharer(entry.sharedBy, names.get(entry.sharedBy)) }
          : {}),
      }),
    );
  }

  private writers() {
    return {
      links: this.links,
      groupLinks: this.groupLinks,
      userLinks: this.userLinks,
      outbox: this.outbox,
    };
  }
}
