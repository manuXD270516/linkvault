import type {
  ImportLinksRequest,
  ImportLinksResponse,
  JobLinkSummary,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound } from '../../groups/domain/errors';
import { TooManyLinkAttempts } from '../domain/errors';
import type { NewJobLink } from '../domain/job-link';
import { extractUrls } from '../domain/link-text';
import { assertImportTextWithinLimit, MAX_LINKS_PER_IMPORT } from '../domain/limits';
import { displayNameIdsOf, toJobLinkSummary, toLinkSharer } from './link.mapper';
import { LINKS_CLOCK, type Clock } from './ports/clock.port';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
  type UserGroup,
} from './ports/group-membership.port';
import {
  JOB_LINK_REPOSITORY,
  type JobLinkRepository,
} from './ports/job-link-repository.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import { LINK_LIMITER, type LinkLimiter } from './ports/link-limiter.port';
import { OUTBOX, type Outbox } from './ports/outbox.port';
import { PUBLIC_URLS, type PublicUrls } from './ports/public-urls.port';
import { toPublicShareView } from './public-share.mapper';
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
 *
 * El límite por ventana se cuenta **lo primero**, antes de tocar el texto o la base de datos: es lo que protege de
 * cincuenta chats pegados seguidos. Falla **abierto** (D13): si el contador no responde, la importación sigue, porque
 * negarla por un Redis lento sería peor que dejarla pasar. Guardar un link de uno en uno NO cuenta contra él: es otra
 * operación y otro coste.
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
    @Inject(LINK_LIMITER) private readonly limiter: LinkLimiter,
    @Inject(PUBLIC_URLS) private readonly urls: PublicUrls,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    request: ImportLinksRequest,
  ): Promise<ImportLinksResponse> {
    const decision = await this.limiter.consume({ kind: 'import', userId });
    if (!decision.allowed) {
      throw new TooManyLinkAttempts(decision.retryAfterSeconds);
    }
    assertImportTextWithinLimit(request.text);
    const groupId = request.groupId;
    // `groupsOf` en vez de `membershipOf`: da a la vez la pertenencia y la visibilidad por defecto del grupo en **una
    // sola lectura**, igual que en `SaveLink` (D3 de public-preview-share). El resto del comportamiento no cambia.
    const destination =
      groupId === undefined
        ? undefined
        : groupOf(await this.membership.groupsOf(userId), groupId);
    if (groupId !== undefined && destination === undefined) {
      throw new GroupNotFound();
    }
    const publish = destination?.defaultVisibility === 'public';

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
          // La visibilidad por defecto se aplica a **cada relación nueva** (D3): los 50 links de un chat entran igual
          // que uno suelto. Es lo contrario que la nota, y a propósito: la nota se escribe para un link y la
          // visibilidad es una política del grupo sobre todo lo que entra.
          ...(publish ? { publish: true } : {}),
          now: this.clock.now(),
        });
        saved.push(link);
        if (link.shared === 'created') {
          created += 1;
        } else {
          existing += 1;
        }
      } catch {
        // `unrecognized` cuenta lo que no se pudo leer **ni guardar** (spec links/sharing): un fallo aislado —una
        // carrera perdida, una escritura rechazada— se suma aquí y no impide el resto del chat.
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
    const ids = displayNameIdsOf(
      saved.map((entry) => entry.link),
      inGroup ? saved.map((entry) => entry.sharedBy) : [],
    );
    const names =
      ids.length === 0
        ? new Map<string, string>()
        : await this.directory.displayNamesOf(ids);
    return saved.map((entry) =>
      toJobLinkSummary(entry.link, {
        sharedAt: entry.sharedAt,
        names,
        ...(inGroup
          ? { sharedBy: toLinkSharer(entry.sharedBy, names.get(entry.sharedBy)) }
          : {}),
        ...(inGroup && entry.publicShare !== undefined
          ? { publicShare: toPublicShareView(entry.publicShare, this.urls) }
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

/** El grupo de destino entre los del usuario, o `undefined` si no es miembro: el mismo 404 que si no existiera. */
function groupOf(
  groups: readonly UserGroup[],
  groupId: string,
): UserGroup | undefined {
  return groups.find((group) => group.groupId === groupId);
}
